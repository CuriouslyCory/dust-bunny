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
 *   `creditedRuns` applies it once.
 * - `onCredit` tells listeners what landed (a credit applied, `award`) or was refused (another
 *   device holds the Run, or a client from before the ledger ended it): the results screen turns a
 *   pending "+X Fluff" into a settled one (src/meta/install.ts emits `fluffAwarded`).
 */
import { pickCreditStats, RUN_CREDIT_LIST_LIMIT, type CreditStats, type RunCredit, type RunCreditReason } from '../shared/runCredit';
import { createJsonCaller, SavedRunAuthError, type JsonCallerOptions } from './accountHttp';
import type { MetaProgress, RunAward } from './meta';
import type { KeyValueStorage } from './save';

export const RUN_CREDITS_KEY = 'dust-bunny:run-credits:v1';
export const RUN_CREDITS_VERSION = 1;

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
}

export type ClaimBody = Pick<PendingClaim, 'runKey' | 'lease' | 'prevLease' | 'reason' | 'stats'>;

/** `carriedOn`: another device holds the Run. `runEnded`: a client from before the ledger ended it. `rejected`: 400/413 (never sent again). */
export type ClaimResult = { ok: true; credit: RunCredit; created: boolean } | { ok: false; reason: 'carriedOn' | 'runEnded' | 'rejected' };

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
      if (r.status === 200) {
        const credit = toCredit(r.body.credit);
        if (!credit) throw new SavedRunAuthError('bad credit'); // never retried: the server answered, but not with a row this build reads
        return { ok: true, credit, created: r.body.created === true };
      }
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

/** What landed for a Run: a credit applied to this copy (`award`), or a refused claim (`award: null`). */
export interface CreditOutcome {
  runKey: string;
  reason: RunCreditReason;
  award: RunAward | null;
}

export interface RunCreditQueueOptions {
  api: RunCreditApi;
  /** Where claims wait (null: memory only, lost with the page). */
  storage: KeyValueStorage | null;
  meta: Pick<MetaProgress, 'awardRun'>;
  /** First retry delay (ms); doubles up to `maxRetryMs`. */
  retryMs?: number;
  maxRetryMs?: number;
}

interface StoredClaims {
  version: number;
  claims: PendingClaim[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function readClaim(raw: unknown): PendingClaim | null {
  if (!isObj(raw)) return null;
  const stats = pickCreditStats(raw.stats);
  if (typeof raw.userId !== 'string' || typeof raw.runKey !== 'string' || typeof raw.lease !== 'string' || !stats) return null;
  if (raw.reason !== 'died' && raw.reason !== 'victory' && raw.reason !== 'quit') return null;
  return {
    userId: raw.userId,
    runKey: raw.runKey,
    lease: raw.lease,
    ...(typeof raw.prevLease === 'string' ? { prevLease: raw.prevLease } : {}),
    reason: raw.reason,
    stats,
    at: typeof raw.at === 'number' && Number.isFinite(raw.at) ? raw.at : 0,
  };
}

export class RunCreditQueue {
  private userId: string | null = null;
  /** Bumped on every Account change: an answer asked under an older generation is left alone. */
  private gen = 0;
  /** This build's claims when the stored file is from a newer build (never written there). */
  private memory: PendingClaim[] | null = null;
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
  private readonly api: RunCreditApi;
  private readonly storage: KeyValueStorage | null;
  private readonly meta: Pick<MetaProgress, 'awardRun'>;
  private readonly retryMs: number;
  private readonly maxRetryMs: number;

  constructor(opts: RunCreditQueueOptions) {
    this.api = opts.api;
    this.storage = opts.storage;
    this.meta = opts.meta;
    this.retryMs = opts.retryMs ?? 1000;
    this.maxRetryMs = opts.maxRetryMs ?? 30_000;
  }

  // --- storage -------------------------------------------------------------------------------

  /** The stored claims; null when the file is from a newer build (left untouched) or unreadable. */
  private read(): PendingClaim[] | null {
    if (this.memory) return this.memory;
    if (!this.storage) return (this.memory = []);
    let parsed: unknown;
    try {
      const raw = this.storage.getItem(RUN_CREDITS_KEY);
      if (!raw) return [];
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
    if (!isObj(parsed)) return [];
    if (typeof parsed.version === 'number' && parsed.version > RUN_CREDITS_VERSION) return (this.memory = []);
    return Array.isArray(parsed.claims) ? (parsed.claims as unknown[]).map(readClaim).filter((c): c is PendingClaim => c !== null) : [];
  }

  private write(claims: PendingClaim[]): void {
    if (this.memory) {
      this.memory = claims;
      return;
    }
    const file: StoredClaims = { version: RUN_CREDITS_VERSION, claims };
    try {
      this.storage?.setItem(RUN_CREDITS_KEY, JSON.stringify(file));
    } catch {
      this.memory = claims; // storage full or refused: this page keeps them in memory
    }
  }

  /** Read-modify-write, so two tabs' claims don't overwrite each other's. */
  private change(fn: (claims: PendingClaim[]) => PendingClaim[]): void {
    this.write(fn(this.read() ?? []));
  }

  /** The signed-in Account's claims, oldest first. */
  private mine(): PendingClaim[] {
    const userId = this.userId;
    if (!userId) return [];
    return (this.read() ?? []).filter((c) => c.userId === userId).sort((a, b) => a.at - b.at);
  }

  // --- the queue -----------------------------------------------------------------------------

  /** The signed-in Account changed: its waiting claims (from any earlier page) go out now. */
  setUser(userId: string | null): void {
    if (userId === this.userId) return;
    this.userId = userId;
    this.gen++;
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
    this.change((claims) => [...claims.filter((x) => !(x.userId === claim.userId && x.runKey === claim.runKey)), claim]);
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
        if (gen === this.gen && !this.timer) this.pump();
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
    // A definite answer: the claim is done, whoever is signed in now; it is applied only for its Account.
    this.change((claims) => claims.filter((x) => !(x.userId === c.userId && x.runKey === c.runKey && x.at === c.at)));
    if (gen !== this.gen) return 'done';
    if (res.ok) this.apply(res.credit);
    else if (res.reason !== 'rejected') this.notify({ runKey: c.runKey, reason: c.reason, award: null });
    else console.warn(`[run-credits] claim for ${c.runKey} rejected by the server`);
    return 'done';
  }

  /** Credits a ledger row to this copy (once per Run key). Listeners hear about it when it lands. */
  apply(credit: RunCredit): RunAward | null {
    const award = this.meta.awardRun({ runKey: credit.runKey, reason: credit.reason, stats: credit.stats });
    if (award) this.notify({ runKey: credit.runKey, reason: credit.reason, award });
    return award;
  }

  /** Applies the ledger rows this copy missed (the newest `RUN_CREDIT_LIST_LIMIT`). Never throws. */
  sweep(): Promise<void> {
    if (!this.userId) return Promise.resolve();
    if (this.sweeping) return this.sweeping;
    const gen = this.gen;
    this.sweeping = (async () => {
      try {
        const credits = await this.api.list();
        if (gen !== this.gen) return;
        // Oldest first, so the newest keys are the last `creditedRuns` forgets.
        for (const c of [...credits].reverse()) this.apply(c);
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

  private notify(o: CreditOutcome): void {
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
