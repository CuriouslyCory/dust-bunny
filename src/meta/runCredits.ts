/**
 * The Run credit ledger, client side (docs/adr/0003; server: api/run-credit.ts). For a signed-in
 * player the server decides, once per Run key, that a Run is credited: a `run_credits` row is the
 * only thing that means so. This module gets claims there and brings rows back:
 *
 * - `claim` writes a `PendingClaim` to localStorage (`dust-bunny:run-credits:v1`) before its
 *   request goes out, and removes it on a definite answer (200, or a 409 refusal). Claims are sent
 *   one at a time, retried with backoff while the server can't be reached, replayed on page load,
 *   when the browser comes back online (`replay`) and when their Account signs in again
 *   (`setUser`); the ones still waiting go out with `keepalive` on pagehide (`flush`). Claims for
 *   another Account wait for it. A stored file from a newer build is left untouched (docs/adr/0001):
 *   this build's claims then live in memory only.
 * - `apply` credits a ledger row to the progress copy (`MetaProgress.awardRun`, a no-op for a key
 *   in `creditedRuns`): the answer to a claim, a row an upload's replace produced, or one the
 *   `sweep` fetched. The sweep (`GET /api/run-credit`, the 20 newest) applies rows this copy
 *   missed: a lost answer, another device's replace, a Run the cloud save's merge dropped. It runs
 *   from the title once this page's work has settled, and after the queue drains following a
 *   network error. Two tabs replaying one claim is harmless: the server returns one row and
 *   `creditedRuns` applies it once. While the copy's set is unknown (`creditedRunsKnown`: a build
 *   from before the ledger rewrote the save), the sweep holds off and a claim answered with a row
 *   that already existed is not applied: losing the field must never create Fluff.
 * - `onCredit` tells listeners every definite answer to one of this page's claims: a credit applied
 *   (`award`), one this copy already held (`already`: another tab applied it first, or this device
 *   credited the Run before the claim), or a refusal (another device holds the Run, a client from
 *   before the ledger ended it, or the server found the claim malformed). The results screen turns
 *   a pending "+X Fluff" into a settled one (src/meta/install.ts emits `fluffAwarded`), and the
 *   leaderboard posts or unranks the Run (src/ui/leaderboard/posting.ts). An answer another tab
 *   got reaches this one too: a settled claim is recorded in the file (`settled`), and the `storage`
 *   event for it announces the outcome here.
 */
import { pickCreditStats, RUN_CREDIT_LIST_LIMIT, type CreditStats, type RunCredit, type RunCreditReason } from '../shared/runCredit';
import { createJsonCaller, SavedRunAuthError, type JsonCallerOptions } from './accountHttp';
import { fluffForRun } from './fluff';
import type { MetaProgress, RunAward } from './meta';
import type { KeyValueStorage, SaveStorageEvent, StorageEventSource } from './save';

export const RUN_CREDITS_KEY = 'dust-bunny:run-credits:v1';
export const RUN_CREDITS_VERSION = 1;
/** How many settled claims the file remembers for other tabs (the newest). */
export const SETTLED_CLAIMS_MAX = 20;

/** A claim waiting for the server's answer (durable: it survives a reload and an offline spell). */
export interface PendingClaim {
  userId: string;
  runKey: string;
  lease: string;
  prevLease?: string;
  reason: RunCreditReason;
  stats: CreditStats;
  /** When it was recorded (ms since the epoch); oldest go first. */
  at: number;
  /**
   * The Run was credited on this device before the claim went out (the server never saw it, so
   * nobody else could hold it): its answer records the row and brings nothing new. A Universe
   * victory among them is not counted again from the answer (the local credit did; the cloud
   * save's merge keeps the larger count even when a later adopt drops the key).
   */
  local?: boolean;
}

export type ClaimBody = Pick<PendingClaim, 'runKey' | 'lease' | 'prevLease' | 'reason' | 'stats'>;

/** How a claim was settled, for the other tabs (`CreditOutcome` without the award). */
export interface SettledClaim {
  userId: string;
  runKey: string;
  reason: RunCreditReason;
  /** The Fluff the row is worth (0 for a refusal). */
  fluff: number;
  outcome: 'credited' | 'carriedOn' | 'elsewhere' | 'rejected';
  at: number;
}

/**
 * `credit: null`: the server credited the Run (200) but answered with a row this build can't read
 * (the claim's own stats stand in for it). `carriedOn`: another device holds the Run (its holder
 * record, or the slot). `runEnded`: a client from before the ledger ended it, or replaced its
 * stored copy, and credited it itself: already credited elsewhere. `rejected`: 400/413 (a bug on
 * this side: never sent again). A 429 or 5xx throws (`SavedRunNetError`): the queue retries later.
 */
export type ClaimResult = { ok: true; credit: RunCredit | null; created: boolean } | { ok: false; reason: 'carriedOn' | 'runEnded' | 'rejected' };

export interface RunCreditApi {
  claim(body: ClaimBody, keepalive?: boolean): Promise<ClaimResult>;
  list(limit?: number): Promise<RunCredit[]>;
}

export function createRunCreditApi(opts: JsonCallerOptions & { baseUrl?: string } = {}): RunCreditApi {
  const baseUrl = opts.baseUrl ?? '/api/run-credit';
  const call = createJsonCaller(opts);
  const toCredit = (raw: unknown): RunCredit | null => {
    const r = raw as Partial<RunCredit> | null;
    const stats = pickCreditStats(r?.stats);
    if (!r || typeof r.runKey !== 'string' || typeof r.reason !== 'string' || !stats) return null;
    return { id: Number(r.id), runKey: r.runKey, reason: r.reason, stats, creditedAt: String(r.creditedAt ?? '') };
  };
  return {
    async claim(body, keepalive = false) {
      const r = await call('POST', baseUrl, body, keepalive);
      if (r.status === 200) return { ok: true, credit: toCredit(r.body.credit), created: r.body.created === true };
      if (r.status === 409) return { ok: false, reason: r.body.error === 'run_ended' ? 'runEnded' : 'carriedOn' };
      return { ok: false, reason: 'rejected' };
    },
    async list(limit = RUN_CREDIT_LIST_LIMIT) {
      const r = await call('GET', `${baseUrl}?limit=${limit}`);
      if (r.status !== 200) throw new SavedRunAuthError(`run-credit ${r.status}`);
      const raw = Array.isArray(r.body.credits) ? (r.body.credits as unknown[]) : [];
      return raw.map(toCredit).filter((c): c is RunCredit => c !== null);
    },
  };
}

/**
 * What landed for a Run. `award`: a credit applied to this copy. `already` (with `award: null`):
 * the server credited the Run, and this copy already held it (another tab applied the answer first,
 * or this device credited the Run before its claim went out): nothing more to add, the Run counts.
 * `refused` (with `award: null`): `carriedOn`, another device holds the Run (it credits it when it
 * ends; the sweep brings the row here); `elsewhere`, a client from before the ledger already
 * credited it (`409 run_ended`: nothing more will come for it); `rejected`, the server found the
 * claim malformed (400: a bug here, surfaced in the console; the Run is not credited). `fluff` is
 * what the row is worth (0 for a refusal), whether or not this call added it.
 */
export interface CreditOutcome {
  runKey: string;
  reason: RunCreditReason;
  fluff: number;
  award: RunAward | null;
  already?: boolean;
  refused?: 'carriedOn' | 'elsewhere' | 'rejected';
}

export interface RunCreditQueueOptions {
  api: RunCreditApi;
  /** Where claims wait (null: memory only, lost with the page). */
  storage: KeyValueStorage | null;
  /** Where other tabs' `storage` events arrive (null: another tab's answers aren't heard here). */
  events?: StorageEventSource | null;
  meta: Pick<MetaProgress, 'awardRun' | 'credited' | 'creditedRunsKnown'>;
  /** First retry delay (ms); doubles up to `maxRetryMs`. */
  retryMs?: number;
  maxRetryMs?: number;
}

interface StoredClaims {
  version: number;
  claims: PendingClaim[];
  settled: SettledClaim[];
}

type ClaimsFile = Pick<StoredClaims, 'claims' | 'settled'>;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isReason = (v: unknown): v is RunCreditReason => v === 'died' || v === 'victory' || v === 'quit';

function readClaim(raw: unknown): PendingClaim | null {
  if (!isObj(raw)) return null;
  const stats = pickCreditStats(raw.stats);
  if (typeof raw.userId !== 'string' || typeof raw.runKey !== 'string' || typeof raw.lease !== 'string' || !stats) return null;
  if (!isReason(raw.reason)) return null;
  return {
    userId: raw.userId,
    runKey: raw.runKey,
    lease: raw.lease,
    ...(typeof raw.prevLease === 'string' ? { prevLease: raw.prevLease } : {}),
    reason: raw.reason,
    stats,
    at: typeof raw.at === 'number' && Number.isFinite(raw.at) ? raw.at : 0,
    ...(raw.local === true ? { local: true } : {}),
  };
}

function readSettled(raw: unknown): SettledClaim | null {
  if (!isObj(raw)) return null;
  if (typeof raw.userId !== 'string' || typeof raw.runKey !== 'string' || !isReason(raw.reason)) return null;
  const outcome = raw.outcome;
  if (outcome !== 'credited' && outcome !== 'carriedOn' && outcome !== 'elsewhere' && outcome !== 'rejected') return null;
  return {
    userId: raw.userId,
    runKey: raw.runKey,
    reason: raw.reason,
    fluff: typeof raw.fluff === 'number' && Number.isFinite(raw.fluff) ? raw.fluff : 0,
    outcome,
    at: typeof raw.at === 'number' && Number.isFinite(raw.at) ? raw.at : 0,
  };
}

const sameClaim = (a: Pick<PendingClaim, 'userId' | 'runKey'>, b: Pick<PendingClaim, 'userId' | 'runKey'>): boolean => a.userId === b.userId && a.runKey === b.runKey;

export class RunCreditQueue {
  private userId: string | null = null;
  /** Bumped on every Account change: an answer asked under an older generation is left alone. */
  private gen = 0;
  /** This build's claims when the stored file is from a newer build (never written there). */
  private memory: ClaimsFile | null = null;
  private sending = false;
  /** The session is gone (401): nothing goes out until the Account signs in again (`setUser`) or `replay`. */
  private stopped = false;
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** A request failed to reach the server: once the queue drains, sweep (an answer may have been lost before). */
  private needsSweep = false;
  private sweeping: Promise<void> | null = null;
  private listeners = new Set<(o: CreditOutcome) => void>();
  private waiters: (() => void)[] = [];
  /** Runs this page claimed (or found waiting) for the signed-in Account, with the claim's reason: their outcomes are this page's to hear, from whichever tab got the answer. */
  private watching = new Map<string, RunCreditReason>();
  /** Runs whose definite outcome this page already announced (a second answer, from another tab or a retry, is not announced again). */
  private announced = new Set<string>();
  private readonly api: RunCreditApi;
  private readonly storage: KeyValueStorage | null;
  private readonly meta: RunCreditQueueOptions['meta'];
  private readonly retryMs: number;
  private readonly maxRetryMs: number;
  private readonly offEvents: () => void = () => undefined;

  constructor(opts: RunCreditQueueOptions) {
    this.api = opts.api;
    this.storage = opts.storage;
    this.meta = opts.meta;
    this.retryMs = opts.retryMs ?? 1000;
    this.maxRetryMs = opts.maxRetryMs ?? 30_000;
    if (opts.events && opts.storage) {
      const onStorage = (e: SaveStorageEvent) => {
        if (e.key !== null && e.key !== RUN_CREDITS_KEY) return;
        if (e.storageArea != null && e.storageArea !== this.storage) return;
        this.heard();
      };
      opts.events.addEventListener('storage', onStorage);
      this.offEvents = () => opts.events?.removeEventListener('storage', onStorage);
    }
  }

  /** Stops following other tabs. */
  dispose(): void {
    this.offEvents();
  }

  // --- storage -------------------------------------------------------------------------------

  /** The stored file; this build's memory when the stored one is from a newer build (left untouched) or storage is unavailable. */
  private read(): ClaimsFile {
    if (this.memory) return this.memory;
    if (!this.storage) return (this.memory = { claims: [], settled: [] });
    let parsed: unknown;
    try {
      const raw = this.storage.getItem(RUN_CREDITS_KEY);
      if (!raw) return { claims: [], settled: [] };
      parsed = JSON.parse(raw);
    } catch {
      return { claims: [], settled: [] };
    }
    if (!isObj(parsed)) return { claims: [], settled: [] };
    if (typeof parsed.version === 'number' && parsed.version > RUN_CREDITS_VERSION) return (this.memory = { claims: [], settled: [] });
    return {
      claims: Array.isArray(parsed.claims) ? (parsed.claims as unknown[]).map(readClaim).filter((c): c is PendingClaim => c !== null) : [],
      settled: Array.isArray(parsed.settled) ? (parsed.settled as unknown[]).map(readSettled).filter((s): s is SettledClaim => s !== null) : [],
    };
  }

  private write(file: ClaimsFile): void {
    if (this.memory) {
      this.memory = file;
      return;
    }
    const stored: StoredClaims = { version: RUN_CREDITS_VERSION, claims: file.claims, settled: file.settled.slice(-SETTLED_CLAIMS_MAX) };
    try {
      this.storage?.setItem(RUN_CREDITS_KEY, JSON.stringify(stored));
    } catch {
      this.memory = file; // storage full or refused: this page keeps them in memory
    }
  }

  /** Read-modify-write, so two tabs' claims don't overwrite each other's. */
  private change(fn: (file: ClaimsFile) => ClaimsFile): void {
    this.write(fn(this.read()));
  }

  /** The signed-in Account's claims, oldest first. */
  private mine(): PendingClaim[] {
    const userId = this.userId;
    if (!userId) return [];
    return this.read()
      .claims.filter((c) => c.userId === userId)
      .sort((a, b) => a.at - b.at);
  }

  // --- the queue -----------------------------------------------------------------------------

  /** The signed-in Account changed: its waiting claims (from any earlier page) go out now. */
  setUser(userId: string | null): void {
    if (userId === this.userId) return;
    this.userId = userId;
    this.gen++;
    this.watching.clear();
    this.announced.clear();
    this.replay();
  }

  /** Claims waiting for the signed-in Account (tests, debugging). */
  get pending(): number {
    return this.mine().length;
  }

  /** Whether a claim for the Run is still waiting for its answer. */
  has(runKey: string): boolean {
    return this.mine().some((c) => c.runKey === runKey);
  }

  /** Records a claim and sends it. A later claim for the same Run and Account replaces a waiting one. */
  claim(c: Omit<PendingClaim, 'at'> & { at?: number }): void {
    const claim: PendingClaim = { ...c, at: c.at ?? Date.now() };
    this.change((file) => ({ claims: [...file.claims.filter((x) => !sameClaim(x, claim)), claim], settled: file.settled.filter((s) => !sameClaim(s, claim)) }));
    if (claim.userId === this.userId) {
      this.watching.set(claim.runKey, claim.reason);
      this.announced.delete(claim.runKey);
    }
    this.replay();
  }

  /** Sends what is waiting now, dropping any backoff (the browser came back online, say). */
  replay(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.attempt = 0;
    this.stopped = false;
    this.pump();
  }

  private pump(): void {
    if (this.sending || this.timer || this.stopped || !this.userId) return;
    const next = this.mine()[0];
    if (!next) {
      if (this.needsSweep) {
        this.needsSweep = false;
        void this.sweep();
      }
      this.wake();
      return;
    }
    this.watching.set(next.runKey, next.reason);
    this.sending = true;
    const gen = this.gen;
    void this.send(next, gen)
      .then((outcome) => {
        if (gen !== this.gen) return;
        if (outcome === 'retry') {
          this.needsSweep = true;
          const delay = Math.min(this.maxRetryMs, this.retryMs * 2 ** this.attempt++);
          this.timer = setTimeout(() => {
            this.timer = null;
            this.pump();
          }, delay);
        } else if (outcome === 'done') this.attempt = 0;
        else this.stopped = true; // signed out elsewhere: the Account client will say so (setUser replays)
      })
      .finally(() => {
        this.sending = false;
        // Even after an Account switch: the Account signed in now may have claims waiting on this request.
        if (!this.timer) this.pump();
        this.wake();
      });
  }

  private async send(c: PendingClaim, gen: number): Promise<'done' | 'retry' | 'stop'> {
    let res: ClaimResult;
    try {
      res = await this.api.claim({ runKey: c.runKey, lease: c.lease, ...(c.prevLease ? { prevLease: c.prevLease } : {}), reason: c.reason, stats: c.stats });
    } catch (err) {
      return err instanceof SavedRunAuthError ? 'stop' : 'retry';
    }
    // The Account changed while it was out: the answer is nobody's to apply now. The claim stays
    // for its Account (a claim is safe to send again: the server returns the same row) and goes out
    // again when it signs in.
    if (gen !== this.gen) return 'done';
    // A definite answer: the claim is done, and every tab that waits on it hears how.
    let outcome: CreditOutcome;
    if (res.ok) {
      // A row this build can't read: the server credited the Run all the same, with (for a new row) the stats this claim sent.
      const credit = res.credit ?? { id: 0, runKey: c.runKey, reason: c.reason, stats: c.stats, creditedAt: '' };
      if (!res.credit) console.warn(`[run-credits] the ledger row for ${c.runKey} isn't readable by this build: applied from the claim`);
      // A row that was there before this claim, while this copy can't say which credits it holds: some copy applied it, maybe this one. Not again.
      const applicable = res.created || this.meta.creditedRunsKnown();
      const award = applicable ? this.meta.awardRun({ runKey: credit.runKey, reason: credit.reason, stats: credit.stats }, { countUniverse: !c.local }) : null;
      outcome = { runKey: c.runKey, reason: credit.reason, fluff: fluffForRun(credit.reason, credit.stats), award, ...(award ? {} : { already: true }) };
    } else {
      // `rejected`: the server found the claim malformed: a bug here (a Run's own stats always pass), not a 0-Fluff Run. Surfaced, dropped.
      if (res.reason === 'rejected') console.error(`[run-credits] claim for ${c.runKey} rejected by the server (400): not credited; the claim is dropped`, c);
      outcome = { runKey: c.runKey, reason: c.reason, fluff: 0, award: null, refused: res.reason === 'runEnded' ? 'elsewhere' : res.reason === 'rejected' ? 'rejected' : 'carriedOn' };
    }
    const settled: SettledClaim = { userId: c.userId, runKey: c.runKey, reason: outcome.reason, fluff: outcome.fluff, outcome: res.ok ? 'credited' : (outcome.refused as SettledClaim['outcome']), at: Date.now() };
    this.change((file) => ({ claims: file.claims.filter((x) => !(sameClaim(x, c) && x.at === c.at)), settled: [...file.settled.filter((s) => !sameClaim(s, c)), settled] }));
    this.notify(outcome);
    return 'done';
  }

  /**
   * Another tab wrote the file: a claim this page waits on may have been settled there. Its
   * outcome is announced here as it was there, with `award: null` (that tab's `awardRun` wrote the
   * credit into the shared copy; this one already holds it).
   */
  private heard(): void {
    const userId = this.userId;
    if (!userId || this.memory) return;
    const file = this.read();
    for (const [runKey, reason] of this.watching) {
      if (this.announced.has(runKey) || file.claims.some((c) => c.userId === userId && c.runKey === runKey)) continue;
      const s = file.settled.find((x) => x.userId === userId && x.runKey === runKey);
      if (s) {
        this.notify(s.outcome === 'credited' ? { runKey, reason: s.reason, fluff: s.fluff, award: null, already: true } : { runKey, reason: s.reason, fluff: 0, award: null, refused: s.outcome });
      } else if (this.meta.credited(runKey)) {
        // The claim went without a record (a tab of another build settled it): the copy holds the credit, so it landed.
        this.notify({ runKey, reason, fluff: 0, award: null, already: true });
      }
    }
    this.wake();
  }

  /**
   * Credits a ledger row to this copy (once per Run key) and tells listeners when it lands. For a
   * row the sweep or an upload's answer brought (another device's Run, or one this device's claim
   * already settled): Fluff and stats only, no Universe (see `AwardOptions`).
   */
  apply(credit: RunCredit): RunAward | null {
    const award = this.meta.awardRun({ runKey: credit.runKey, reason: credit.reason, stats: credit.stats }, { countUniverse: false });
    if (award) this.notify({ runKey: credit.runKey, reason: credit.reason, fluff: award.fluff, award });
    return award;
  }

  /**
   * Applies the ledger rows this copy missed (the newest `RUN_CREDIT_LIST_LIMIT`). A row for a Run
   * this device's own claim is still out for is left to that claim's answer (it is the one that
   * counts a Universe victory). Held off while the copy's set is unknown (`creditedRunsKnown`).
   * Never throws.
   */
  sweep(): Promise<void> {
    if (!this.userId || !this.meta.creditedRunsKnown()) return Promise.resolve();
    if (this.sweeping) return this.sweeping;
    const gen = this.gen;
    this.sweeping = (async () => {
      try {
        const credits = await this.api.list();
        if (gen !== this.gen || !this.meta.creditedRunsKnown()) return;
        // Oldest first, so the newest keys are the last `creditedRuns` forgets.
        for (const c of [...credits].reverse()) if (!this.has(c.runKey)) this.apply(c);
      } catch {
        // Offline, or the session is gone: the next title visit tries again.
      } finally {
        this.sweeping = null;
        this.wake();
      }
    })();
    return this.sweeping;
  }

  /** The page is going away: claims still waiting go now, with `keepalive`; they are replayed next load if the answer is lost. */
  flush(): void {
    for (const c of this.mine()) {
      void this.api.claim({ runKey: c.runKey, lease: c.lease, ...(c.prevLease ? { prevLease: c.prevLease } : {}), reason: c.reason, stats: c.stats }, true).catch(() => undefined);
    }
  }

  onCredit(fn: (o: CreditOutcome) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** A definite outcome for a Run is announced once per claim; a credit applied (an award) always is. */
  private notify(o: CreditOutcome): void {
    if (!o.award && this.announced.has(o.runKey)) return;
    this.announced.add(o.runKey);
    for (const fn of this.listeners) fn(o);
  }

  /** Resolves once nothing is being sent or swept and no claim waits without a backoff running (tests). */
  async idle(): Promise<void> {
    while (this.sending || this.sweeping || (this.pending > 0 && !this.timer && !this.stopped)) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
  }

  private wake(): void {
    const ws = this.waiters;
    this.waiters = [];
    for (const w of ws) w();
  }
}
