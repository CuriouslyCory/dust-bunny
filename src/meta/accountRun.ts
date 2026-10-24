/**
 * The Account's saved Run (issue #54): for a signed-in player, the saved Run slot on the device
 * (./suspendedRun.ts) is mirrored to the server (api/saved-run.ts), so a Run paused on one device
 * can be resumed on another. Players who aren't signed in never reach the server: every call here
 * is then a no-op and the slot works per browser, as before.
 *
 * Leases. The server row names whoever holds the Run with a lease, a random id per device and take.
 * This page's Run in progress (`live`) knows the lease it holds, and while a take hasn't been heard
 * back from, also the one before it (`leases`: the server holds one of them). Every copy written to
 * the device slot while signed in is tagged with the Account, its leases and whether the server has
 * confirmed it (`RunSnapshot.account`); a copy tagged for another Account is never shown, taken or
 * credited (`SuspendedRunStore.setViewer`).
 *
 * - Pause (and Save & quit): the device slot is written first, synchronously (src/game/handoff.ts),
 *   then the copy is uploaded (`stored`, with `ledger: true`). A hidden page uploads with
 *   `keepalive`, and so does `pagehide` for an upload still waiting, so a closing tab still gets it
 *   there. A different Run the upload replaces is recorded in the ledger by the server and its row
 *   comes back in `credits`, which is applied here.
 * - Unpause: optimistic. The Run plays on at once and the server take runs in the background
 *   (`takenBack`), retried with backoff while offline; never awaited. If the server says another
 *   device holds the Run (a refused take, or a 409 on a later upload) the page is told (`onLost`):
 *   it disposes its copy without `runEnded`, so nothing is credited twice, and says so.
 * - Credit (docs/adr/0003): nothing here decides that a Run is credited; the server's ledger does
 *   (src/meta/runCredits.ts, `credits`). The Run ending (`ended`) and every quit of a saved copy
 *   (the device slot's replace, New run's abandon, the title's "server copy wins": `creditQuit`)
 *   send a claim. A Run the server was never told about (never uploaded from here, or kept on this
 *   device only) is credited at once and the claim just records it; one the server knows is
 *   credited from the answer, so the results screen shows its Fluff as pending until then (offline:
 *   until the page is back online). Signed out, every Run is credited at once, on the device.
 *   `creditOf` says where a Run's credit stands for the results screen.
 * - Title: `syncTitle` waits until this page's own uploads (and any Resume or New run on its way,
 *   `titleEpoch`) have settled, then reads the server copy (a read that overlapped one is read
 *   again). The server copy wins over the device slot: it is mirrored into the slot (a different
 *   Run that only this device had is claimed as a quit first). A device copy the server never
 *   confirmed is uploaded instead. One from a newer build is left alone, on both sides, and the
 *   title says an update is needed (docs/adr/0001). The ledger sweep runs once the read is done.
 * - Resume (`resume`) waits for the server take: of two devices racing, one gets the Run and the
 *   other's title refreshes. Offline, it resumes and takes in the background, as unpausing does.
 *   `abandon` and `resume` first wait out an upload of the Run still on its way, so the claim or
 *   take can't land before it.
 * - An answer that arrives after an Account switch is dropped (`gen`): it never credits, or touches
 *   the device slot, for the Account signed in now.
 */
import type { RunSnapshot, SnapshotAccountTag } from '../game/snapshot';
import { isNewerSnapshot, newHandoffId, parseRunSnapshot } from '../game/snapshot';
import type { AccountClient } from '../net/account';
import { pickCreditStats, salvageCreditStats, type CreditStats, type RunCredit } from '../shared/runCredit';
import type { ServerSavedRun } from '../shared/savedRun';
import { createJsonCaller, SavedRunAuthError, SavedRunNetError, type JsonCallerOptions } from './accountHttp';
import type { MetaProgress, RunAward, RunCreditInput } from './meta';
import { createRunCreditApi, RunCreditQueue, type CreditOutcome } from './runCredits';
import { browserStorage, type KeyValueStorage } from './save';
import { getSuspendedRuns, type QuitCreditor, type SuspendedRunStore } from './suspendedRun';

export { SavedRunAuthError, SavedRunNetError } from './accountHttp';

// ---------------------------------------------------------------------------------------------
// HTTP client for api/saved-run.ts
// ---------------------------------------------------------------------------------------------

export type PutResult =
  /** `credits`: ledger rows this upload produced (a different Run it replaced, recorded as a quit). */
  | { ok: true; credits: RunCredit[] }
  /** `carriedOn`: another device holds this Run, or it ended. `newer`: a newer build's Run is stored and kept. `rejected`: 400/413. */
  | { ok: false; reason: 'carriedOn' | 'newer' | 'rejected' };

export type TakeResult = { taken: true; snapshot: Record<string, unknown> | null } | { taken: false; savedRun: ServerSavedRun | null };

export interface SavedRunApi {
  get(): Promise<ServerSavedRun | null>;
  put(body: { runKey: string; lease: string; prevLease?: string; snapshot: unknown; ledger: true }, keepalive?: boolean): Promise<PutResult>;
  take(body: { runKey: string; lease: string; newLease: string }): Promise<TakeResult>;
}

export type SavedRunApiOptions = JsonCallerOptions & { baseUrl?: string };

export function createSavedRunApi(opts: SavedRunApiOptions = {}): SavedRunApi {
  const baseUrl = opts.baseUrl ?? '/api/saved-run';
  const call = createJsonCaller(opts);
  return {
    async get() {
      const r = await call('GET', baseUrl);
      if (r.status !== 200) throw new SavedRunNetError(`saved-run ${r.status}`);
      return (r.body.savedRun as ServerSavedRun | null) ?? null;
    },
    async put(body, keepalive = false) {
      const r = await call('PUT', baseUrl, body, keepalive);
      if (r.status === 200) return { ok: true, credits: Array.isArray(r.body.credits) ? (r.body.credits as RunCredit[]) : [] };
      if (r.status === 409) return { ok: false, reason: r.body.error === 'newer_saved_run' ? 'newer' : 'carriedOn' };
      return { ok: false, reason: 'rejected' };
    },
    async take(body) {
      const r = await call('POST', baseUrl, body);
      if (r.status === 200) return { taken: true, snapshot: (r.body.snapshot as Record<string, unknown> | null) ?? null };
      if (r.status === 409) return { taken: false, savedRun: (r.body.savedRun as ServerSavedRun | undefined) ?? null };
      throw new SavedRunNetError(`saved-run ${r.status}`);
    },
  };
}

// ---------------------------------------------------------------------------------------------
// The page's side
// ---------------------------------------------------------------------------------------------

/** The page's Run in progress, as far as the server is concerned. */
interface Live {
  runKey: string;
  /** Leases the server may hold for it, oldest first: one, or two while a take is unconfirmed. */
  leases: string[];
  /** The server has confirmed this page's claim at least once (an upload or a take). */
  confirmed: boolean;
  /** Not kept on the server (a newer build's Run is stored there, or the upload was rejected). */
  localOnly: boolean;
}

type Op = { kind: 'put'; runKey: string; snapshot: RunSnapshot } | { kind: 'take'; runKey: string };

/**
 * Where a Run's credit stands on this page (the results screen). `refused`: `carriedOn`, another
 * device holds the Run (it credits it when it ends); `elsewhere`, a client from before the ledger
 * already credited it.
 */
export type CreditState = { state: 'credited'; award: RunAward } | { state: 'pending' } | { state: 'refused'; why: 'carriedOn' | 'elsewhere' };

/** localStorage key: the Runs the server was told about from this device (`AccountRuns.ended` defers their credit to it). */
export const KNOWN_RUNS_KEY = 'dust-bunny:known-runs:v1';
export const KNOWN_RUNS_VERSION = 1;
/** How many known Run keys the device remembers (the newest; one Run plays at a time). */
export const KNOWN_RUNS_MAX = 20;

/** What the title shows about the Account's saved Run (`syncTitle`). */
export interface TitleSync {
  /** The server copy was mirrored from another device (or another page) just now. */
  fromAccount: string | null;
  /** The Account holds a saved Run from a newer build: an update is needed to resume it. */
  newerOnAccount: boolean;
  /** The server couldn't be reached: the device slot is shown as it is. */
  offline: boolean;
}

export interface AccountRunsOptions {
  api: SavedRunApi;
  store: SuspendedRunStore;
  meta: Pick<MetaProgress, 'awardRun'>;
  /** The ledger's claim queue (src/meta/runCredits.ts). */
  credits: RunCreditQueue;
  /** First retry delay (ms); doubles up to `maxRetryMs`. */
  retryMs?: number;
  maxRetryMs?: number;
  /** Whether the page is hidden (uploads then use `keepalive`). */
  hidden?: () => boolean;
  /** Where the known Runs are remembered (`KNOWN_RUNS_KEY`; null: memory only, lost with the page). */
  storage?: KeyValueStorage | null;
}

/** Strips the device-only tag before uploading. */
function uploadable(s: RunSnapshot): RunSnapshot {
  const { account: _account, ...rest } = s;
  return rest as RunSnapshot;
}

function leasesOf(tag: SnapshotAccountTag): string[] {
  return tag.prevLease ? [tag.prevLease, tag.lease] : [tag.lease];
}

/** `{ lease, prevLease? }` for a claim or an upload, from the leases the server may hold (oldest first). */
function leaseFields(leases: readonly string[]): { lease: string; prevLease?: string } {
  return { lease: leases[leases.length - 1]!, ...(leases.length > 1 ? { prevLease: leases[0] } : {}) };
}

/**
 * The stats a Run is credited with: the bounded subset of its own (`pickCreditStats`; a Run's own
 * stats always pass). Only a stored copy with broken stats falls back to salvaging what reads
 * (`salvageCreditStats`): never zeros for a real Run. The results screen computes its pending
 * "+X Fluff" from this, so it shows what the claim sends.
 */
export function creditStatsOf(stats: unknown): CreditStats {
  return pickCreditStats(stats) ?? salvageCreditStats(stats);
}

export class AccountRuns implements QuitCreditor {
  private userId: string | null = null;
  /**
   * Bumped on every Account change (`setUser`). Each answer from the server is applied only under
   * the generation it was asked under: one that arrives after a switch (even back to the same
   * Account, whose state was dropped) touches nothing here, in the device slot or in MetaProgress.
   */
  private gen = 0;
  private live: Live | null = null;
  /** Waiting server work, one per Run (a later one supersedes an earlier one), sent one at a time. */
  private ops = new Map<string, Op>();
  private inFlight: Op | null = null;
  private attempt = 0;
  /** A request failed to reach the server: sweep the ledger once the queue drains (its answer may have carried a credit). */
  private sweepAfter = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lostListeners = new Set<(runKey: string) => void>();
  private userListeners = new Set<(userId: string | null) => void>();
  /** What this page's ended Runs were credited (or refused), for `creditOf`; cleared on a new Run. */
  private awards = new Map<string, RunAward>();
  private refused = new Map<string, 'carriedOn' | 'elsewhere'>();
  /** Known Runs this page keeps in memory when `storage` is null or holds a newer build's file. */
  private knownMemory: string[] | null = null;
  private readonly storage: KeyValueStorage | null;
  private waiters: (() => void)[] = [];
  /**
   * Title actions that change who holds the Account's Run (`resume`, `abandon`) send their take or
   * claim themselves, outside the queue, so `pending` doesn't see them. `titleBusy` counts those
   * on their way; `titleEpoch` is bumped when one starts and when it settles. A title read
   * (`syncTitle`) that overlapped either is stale (it may still show a Run just credited, or just
   * taken), so it is read again rather than mirrored.
   */
  private titleBusy = 0;
  private titleEpoch = 0;
  private readonly api: SavedRunApi;
  private readonly store: SuspendedRunStore;
  private readonly meta: Pick<MetaProgress, 'awardRun'>;
  /** The ledger's claim queue: it follows the Account with this, and its outcomes feed `creditOf`. */
  readonly credits: RunCreditQueue;
  private readonly retryMs: number;
  private readonly maxRetryMs: number;
  private readonly hidden: () => boolean;
  /** The last `syncTitle` result (the title reads it on refresh). */
  title: TitleSync = { fromAccount: null, newerOnAccount: false, offline: false };

  constructor(opts: AccountRunsOptions) {
    this.api = opts.api;
    this.store = opts.store;
    this.meta = opts.meta;
    this.credits = opts.credits;
    this.retryMs = opts.retryMs ?? 1000;
    this.maxRetryMs = opts.maxRetryMs ?? 30_000;
    this.hidden = opts.hidden ?? (() => typeof document !== 'undefined' && document.hidden);
    this.storage = opts.storage ?? null;
    this.credits.onCredit((o) => this.settle(o));
  }

  private settle(o: CreditOutcome): void {
    if (o.award) this.awards.set(o.runKey, o.award);
    else this.refused.set(o.runKey, o.refused ?? 'carriedOn');
  }

  // --- known Runs ------------------------------------------------------------------------------
  //
  // A Run the server was told about from this device (an upload queued for it, or a take: it was
  // resumed from the Account) may be taken by another device, so its credit is the server's to
  // decide (`ended`). That is remembered durably, not in `live`: signing out and back in mid-Run
  // (or a reload after a pause) must not make a known Run look like one the server never saw.

  private readKnown(): string[] {
    if (this.knownMemory) return this.knownMemory;
    if (!this.storage) return (this.knownMemory = []);
    try {
      const raw = this.storage.getItem(KNOWN_RUNS_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return [];
      const file = parsed as { version?: unknown; known?: unknown };
      const known = Array.isArray(file.known) ? (file.known as unknown[]).filter((k): k is string => typeof k === 'string') : [];
      if (typeof file.version === 'number' && file.version > KNOWN_RUNS_VERSION) return (this.knownMemory = known); // a newer build's: read, never written
      return known;
    } catch {
      return [];
    }
  }

  /** Remembers that the server knows `runKey` from this device. */
  private know(runKey: string): void {
    const known = this.readKnown();
    if (known.includes(runKey)) return;
    const next = [...known, runKey].slice(-KNOWN_RUNS_MAX);
    if (this.knownMemory) {
      this.knownMemory = next;
      return;
    }
    try {
      this.storage?.setItem(KNOWN_RUNS_KEY, JSON.stringify({ version: KNOWN_RUNS_VERSION, known: next }));
    } catch {
      this.knownMemory = next;
    }
  }

  /** Whether the server was ever told about `runKey` from this device. */
  knows(runKey: string): boolean {
    return this.readKnown().includes(runKey);
  }

  get signedIn(): boolean {
    return this.userId !== null;
  }

  /** Server work still waiting (tests, debugging). */
  get pending(): number {
    return this.ops.size + (this.inFlight ? 1 : 0);
  }

  /** The signed-in Account changed: another Account's Run is never offered, and this page's server state is dropped. */
  setUser(userId: string | null): void {
    if (userId === this.userId) return;
    this.userId = userId;
    this.gen++;
    this.live = null;
    this.ops.clear();
    this.attempt = 0;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.title = { fromAccount: null, newerOnAccount: false, offline: false };
    this.awards.clear();
    this.refused.clear();
    this.store.setViewer(userId);
    this.credits.setUser(userId);
    for (const fn of this.userListeners) fn(userId);
  }

  /** Called when the signed-in Account changes (the title syncs again). */
  onUser(fn: (userId: string | null) => void): () => void {
    this.userListeners.add(fn);
    return () => this.userListeners.delete(fn);
  }

  /** Called with the Run's key when the server says another device holds the Run this page has. */
  onLost(fn: (runKey: string) => void): () => void {
    this.lostListeners.add(fn);
    return () => this.lostListeners.delete(fn);
  }

  // --- the Run in progress ---------------------------------------------------------------------

  /** A new Run started on this page: it isn't on the server until it is first stored. */
  newRun(): void {
    this.live = null;
    this.awards.clear();
    this.refused.clear();
  }

  /**
   * Tags `snapshot` (about to be written to the device slot) with the Account and this page's
   * lease for the Run (a fresh one for a Run the server hasn't seen from here). Signed out: removes
   * any tag, so the copy is an ordinary per-browser one.
   */
  tag(snapshot: RunSnapshot): void {
    if (!this.userId) {
      delete snapshot.account;
      return;
    }
    const live = this.liveFor(snapshot.runKey);
    snapshot.account = { userId: this.userId, lease: live.leases[live.leases.length - 1]!, ...(live.leases.length > 1 ? { prevLease: live.leases[0] } : {}), synced: false };
  }

  private liveFor(runKey: string): Live {
    if (this.live?.runKey !== runKey) this.live = { runKey, leases: [newHandoffId()], confirmed: false, localOnly: false };
    return this.live;
  }

  /** The device slot now holds `snapshot` (tagged by `tag`): uploads it. */
  stored(snapshot: RunSnapshot): void {
    if (!this.userId || !snapshot.account) return;
    if (this.live?.runKey === snapshot.runKey && this.live.localOnly) return;
    this.queue({ kind: 'put', runKey: snapshot.runKey, snapshot });
  }

  /** The paused Run was taken back on the device (unpause): take it back on the server, in the background. */
  takenBack(runKey: string): void {
    if (!this.userId) return;
    const live = this.live;
    if (!live || live.runKey !== runKey || live.localOnly) return;
    // One take at a time: a second unpause before the first is heard back from reuses its lease.
    if (live.leases.length === 1) live.leases.push(newHandoffId());
    this.queue({ kind: 'take', runKey });
  }

  /** Resolves when a request settles (or the page loses a Run), or after `ms`. */
  private nextWake(ms = Infinity): Promise<void> {
    return new Promise<void>((resolve) => {
      const t = Number.isFinite(ms) ? setTimeout(done, ms) : null;
      function done(): void {
        if (t) clearTimeout(t);
        resolve();
      }
      this.waiters.push(done);
    });
  }

  /**
   * The one wait every title action (`syncTitle`, `resume`, `abandon`) goes through, so what it
   * reads or writes on the server lands after this page's own uploads instead of racing them.
   * Waits until no work for `runKey` (for any Run: null) is waiting or on its way, retries included.
   * `drop`: waiting work for `runKey` is dropped rather than sent (the caller supersedes it). False
   * when still unsettled at `deadline` (offline).
   */
  private async settled(runKey: string | null, drop: boolean, deadline = Infinity): Promise<boolean> {
    for (;;) {
      if (drop && runKey !== null) this.ops.delete(runKey);
      const busy = runKey === null ? this.pending > 0 : this.ops.has(runKey) || this.inFlight?.runKey === runKey;
      if (!busy) return true;
      const left = deadline - Date.now();
      if (left <= 0) return false;
      await this.nextWake(left);
    }
  }

  private wake(): void {
    const ws = this.waiters;
    this.waiters = [];
    for (const w of ws) w();
  }

  // --- credit ----------------------------------------------------------------------------------

  /**
   * The Run ended on this page (`runEnded`): credits it. Signed out, or a Run the server was never
   * told about from here: at once, returning the award (signed in, a claim records it on the
   * server too). One the server knows (it was stored from here, or resumed from the Account): a
   * claim under this page's leases, credited from the answer; null meanwhile (`creditOf` reads
   * `pending`, then `credited` or `refused` when another device holds the Run).
   */
  ended(e: RunCreditInput): RunAward | null {
    const live = this.live?.runKey === e.runKey ? this.live : null;
    if (live) this.live = null;
    const userId = this.userId;
    if (!userId) return this.local(e);
    // Known: an upload or take was ever queued for it from this device (durable), unless it is kept here only.
    const known = live ? !live.localOnly : this.knows(e.runKey);
    const award = known ? null : this.local(e);
    this.credits.claim({ userId, runKey: e.runKey, ...leaseFields(live?.leases ?? [newHandoffId()]), reason: e.reason, stats: creditStatsOf(e.stats) });
    return award;
  }

  /** Credits on the device now (and remembers it for `creditOf`). Signed in, the claim's row will match the key. */
  private local(e: RunCreditInput): RunAward | null {
    const award = this.meta.awardRun(e, { ledger: this.userId !== null });
    if (award) this.awards.set(e.runKey, award);
    return award;
  }

  /** Where a Run's credit stands on this page: `pending` until it is credited or refused. */
  creditOf(runKey: string): CreditState {
    const award = this.awards.get(runKey);
    if (award) return { state: 'credited', award };
    const why = this.refused.get(runKey);
    return why ? { state: 'refused', why } : { state: 'pending' };
  }

  /** Whether the Run's credit is the server's to decide and still out: a claim of this page's is waiting for its answer. */
  deferred(runKey: string): boolean {
    return this.creditOf(runKey).state === 'pending' && this.credits.has(runKey);
  }

  /**
   * A saved copy the device lets go of (replaced in its slot, abandoned by New run, or replaced by
   * the server's copy on the title) counts as a quit. One tagged for this Account is claimed from
   * the server, which credits it unless another device plays it by now; an untagged one (saved
   * signed out) is credited here, the claim recording it. Signed out: credited here.
   */
  creditQuit(s: RunSnapshot): void {
    const e: RunCreditInput = { runKey: s.runKey, reason: 'quit', stats: s.stats };
    const userId = this.userId;
    const tag = s.account;
    if (!userId) {
      this.meta.awardRun(e, { ledger: false });
      return;
    }
    if (tag && tag.userId !== userId) return; // another Account's: never credited here
    if (!tag) this.meta.awardRun(e);
    const leases = this.live?.runKey === s.runKey ? this.live.leases : tag ? leasesOf(tag) : [newHandoffId()];
    this.credits.claim({ userId, runKey: s.runKey, ...leaseFields(leases), reason: 'quit', stats: creditStatsOf(s.stats) });
  }

  // --- the title -------------------------------------------------------------------------------

  /**
   * Brings the device slot in line with the Account's saved Run (the title calls it on entry).
   * Resolves what the title should say; never throws.
   */
  async syncTitle(timeoutMs = 6000): Promise<TitleSync> {
    const userId = this.userId;
    const gen = this.gen;
    if (!userId) return (this.title = { fromAccount: null, newerOnAccount: false, offline: false });
    const offline = (): TitleSync => (gen === this.gen ? (this.title = { ...this.title, offline: true }) : this.title);
    // This page's uploads land first (Save & quit's, say): reconciling against a row they are about
    // to change could credit, or replace, the Run they store. Still unsettled: as offline.
    const deadline = Date.now() + timeoutMs;
    let row: ServerSavedRun | null;
    for (;;) {
      if (!(await this.settled(null, false, deadline))) return offline();
      if (gen !== this.gen) return this.title;
      // A Resume or New run on its way changes the row: read it once that has settled.
      if (this.titleBusy > 0) {
        const left = deadline - Date.now();
        if (left <= 0) return offline();
        await this.nextWake(left);
        continue;
      }
      const epoch = this.titleEpoch;
      try {
        row = await this.api.get();
      } catch {
        return offline();
      }
      if (gen !== this.gen) return this.title;
      // Nothing went out while it was on its way: neither an upload nor a title take or claim.
      if (this.pending === 0 && epoch === this.titleEpoch) break;
    }
    // This page's work has settled: credits it missed (a lost answer, another device's replace) land now.
    void this.credits.sweep();
    const view: TitleSync = { fromAccount: null, newerOnAccount: false, offline: false };
    const local = this.store.peek();
    const mine = local?.account?.userId === userId ? local.account : null;
    const sameHolder = (lease: string): boolean => !!mine && leasesOf(mine).includes(lease);
    // This page plays it (or is about to upload it): nothing to reconcile.
    if (this.live && row?.runKey === this.live.runKey && this.live.leases.includes(row.lease)) return (this.title = view);

    if (row?.snapshot && isNewerSnapshot(row.snapshot)) {
      // A newer build's Run: left on the server, and the device slot left as it is.
      view.newerOnAccount = true;
      return (this.title = view);
    }
    const server = row?.snapshot ? parseRunSnapshot(row.snapshot) : null;
    if (row && server) {
      if (local && local.runKey === row.runKey && sameHolder(row.lease) && local.savedAt > server.savedAt) {
        // The device has a later copy from the same holder that never made it up: send it.
        this.reupload(local);
      } else if (local && local.runKey === row.runKey && local.handoffId === server.handoffId && local.savedAt === server.savedAt && mine?.lease === row.lease) {
        if (!mine.synced) this.store.markSynced(row.runKey, row.lease); // the same copy: the server has it
      } else {
        // The server copy wins. A different Run in the slot is replaced: a quit (as the slot credits a
        // Run saved over another), claimed from the server, which knows whether it carried on elsewhere.
        if (local && local.runKey !== row.runKey) this.creditQuit(local);
        const copy: RunSnapshot = { ...server, account: { userId, lease: row.lease, synced: true } };
        this.store.save(copy);
        if (!(local && local.runKey === row.runKey && sameHolder(row.lease))) view.fromAccount = row.runKey;
      }
      return (this.title = view);
    }
    // No stored copy on the server (no row, or a device is playing the Run it holds).
    if (local) {
      if (row && row.runKey === local.runKey && !sameHolder(row.lease)) this.store.clear(); // taken by another device
      else if (row && row.runKey === local.runKey) this.reupload(local); // ours, its upload never landed
      else if (mine?.synced) this.store.clear(); // on the server once, gone since: resumed and ended, or abandoned, elsewhere
      else this.reupload(local); // only on this device: it follows the Account from now on
    }
    return (this.title = view);
  }

  /** Uploads a device copy outside a Run in progress (it keeps its leases, or gets one). */
  private reupload(local: RunSnapshot): void {
    if (!this.userId) return;
    const copy = structuredClone(local);
    const tag = copy.account?.userId === this.userId ? copy.account : null;
    copy.account = { userId: this.userId, lease: tag?.lease ?? newHandoffId(), ...(tag?.prevLease ? { prevLease: tag.prevLease } : {}), synced: false };
    if (!tag) this.store.save(copy);
    this.queue({ kind: 'put', runKey: copy.runKey, snapshot: copy });
  }

  /**
   * Resume run on the title, for the Run the slot shows (`shown`). A copy kept for the Account is
   * taken on the server first, and this waits for it: `lost` when another device got there first
   * (the title should refresh). Offline it resolves `mine` and keeps taking in the background. A
   * copy that isn't the Account's resolves `mine` at once. `resume` then starts it.
   */
  async resume(shown: RunSnapshot, start: () => boolean): Promise<'mine' | 'lost' | 'failed'> {
    const tag = shown.account;
    if (!this.userId || !tag || tag.userId !== this.userId) {
      if (!start()) return 'failed';
      this.live = null;
      return 'mine';
    }
    const gen = this.gen;
    return this.titleAction(() => this.resumeHeld(shown, start, gen));
  }

  private async resumeHeld(shown: RunSnapshot, start: () => boolean, gen: number): Promise<'mine' | 'lost' | 'failed'> {
    const settled = await this.settledTag(shown, gen);
    if (typeof settled === 'string') return settled;
    const leases = leasesOf(settled);
    const take = { runKey: shown.runKey, lease: leases[0]!, newLease: leases[1] ?? newHandoffId() };
    try {
      const res = await this.api.take(take);
      if (gen !== this.gen) return 'failed';
      if (!res.taken && !(settled.synced === false && (!res.savedRun || res.savedRun.runKey !== shown.runKey))) {
        if (this.store.peek()?.runKey === shown.runKey) this.store.clear();
        return 'lost';
      }
      if (!start()) {
        // Taken but not started (the title was left meanwhile): store it again, so it isn't stranded.
        this.putBack(shown, take.newLease);
        return 'failed';
      }
      this.live = { runKey: shown.runKey, leases: [take.newLease], confirmed: true, localOnly: false };
      this.know(shown.runKey);
      return 'mine';
    } catch (err) {
      if (err instanceof SavedRunAuthError || gen !== this.gen) return 'failed';
      // Offline: play it, and take it in the background, as an unpause does.
      if (!start()) return 'failed';
      this.live = { runKey: shown.runKey, leases: [take.lease, take.newLease], confirmed: settled.synced, localOnly: false };
      this.queue({ kind: 'take', runKey: shown.runKey });
      return 'mine';
    }
  }

  private putBack(shown: RunSnapshot, lease: string): void {
    if (!this.userId) return;
    const copy: RunSnapshot = { ...structuredClone(shown), account: { userId: this.userId, lease, synced: false } };
    if (this.store.peek()?.runKey === shown.runKey) this.store.save(copy);
    this.queue({ kind: 'put', runKey: copy.runKey, snapshot: copy });
  }

  /**
   * New run on the title gives up the Run on screen: `abandonLocal` takes it from the slot and
   * credits it through `creditQuit` (a claim, for an Account copy: the server credits it unless
   * another device took it meanwhile). An upload of it still on its way is waited out first, so the
   * claim lands after it; `lost` when the slot lost the Run meanwhile (refresh).
   */
  async abandon(shown: RunSnapshot, abandonLocal: () => boolean): Promise<'done' | 'lost' | 'failed'> {
    const tag = shown.account;
    if (!this.userId || !tag || tag.userId !== this.userId) return abandonLocal() ? 'done' : 'failed';
    const gen = this.gen;
    return this.titleAction(async () => {
      const nowTag = await this.settledTag(shown, gen);
      if (typeof nowTag === 'string') return nowTag;
      return abandonLocal() ? 'done' : 'failed';
    });
  }

  /** Runs a title `resume` or `abandon`, marking the title's reads around it stale (`titleEpoch`). */
  private async titleAction<T>(fn: () => Promise<T>): Promise<T> {
    this.titleBusy++;
    this.titleEpoch++;
    try {
      return await fn();
    } finally {
      this.titleBusy--;
      this.titleEpoch++;
      this.wake();
    }
  }

  /**
   * Before the title takes or claims the Run on screen: an upload of it still on its way would
   * land after that and store it again, so it is waited out (and any still waiting dropped). Returns
   * the Run's tag as that left it in the device slot; `lost` when the slot lost it (a 409 on that
   * upload: another device has it), `failed` when the Account changed meanwhile.
   */
  private async settledTag(shown: RunSnapshot, gen: number): Promise<SnapshotAccountTag | 'lost' | 'failed'> {
    await this.settled(shown.runKey, true);
    if (gen !== this.gen) return 'failed';
    const now = this.store.peek();
    if (now?.runKey !== shown.runKey) return 'lost';
    return now.account?.userId === this.userId ? now.account : shown.account!;
  }

  // --- sending ---------------------------------------------------------------------------------

  private queue(op: Op): void {
    this.know(op.runKey);
    this.ops.delete(op.runKey);
    this.ops.set(op.runKey, op);
    // New work goes out now, not after the backoff (it may settle what the retry is waiting on).
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
      this.attempt = 0;
    }
    this.pump();
  }

  private pump(): void {
    if (this.inFlight || this.timer || !this.userId) return;
    const next = this.ops.values().next();
    if (next.done) {
      // A request failed to reach the server: an answer may have been lost with a credit in it (a replace).
      if (this.sweepAfter) {
        this.sweepAfter = false;
        void this.credits.sweep();
      }
      return;
    }
    const op = next.value;
    this.ops.delete(op.runKey);
    this.inFlight = op;
    const gen = this.gen;
    void this.send(op, gen)
      .then(() => {
        if (gen === this.gen) this.attempt = 0;
      })
      .catch((err: unknown) => {
        if (gen !== this.gen) return; // asked for another Account (or before a switch back): dropped
        if (err instanceof SavedRunAuthError) return; // signed out elsewhere: the Account client will say so
        this.sweepAfter = true;
        // Retry later, unless something newer for the Run superseded it meanwhile.
        if (!this.ops.has(op.runKey)) this.ops.set(op.runKey, op);
        const delay = Math.min(this.maxRetryMs, this.retryMs * 2 ** this.attempt++);
        this.timer = setTimeout(() => {
          this.timer = null;
          this.pump();
        }, delay);
      })
      .finally(() => {
        this.inFlight = null;
        // Even after an Account switch: the current Account's work may be waiting on this request.
        this.pump();
        this.wake();
      });
  }

  /** Sends `op`; its answer is applied only if the Account hasn't changed since (`gen`). */
  private async send(op: Op, gen: number): Promise<void> {
    const live = this.live?.runKey === op.runKey ? this.live : null;
    if (op.kind === 'take') {
      if (!live || live.leases.length < 2) return; // settled meanwhile (an upload confirmed it, or the Run is gone)
      const [lease, newLease] = live.leases as [string, string];
      const res = await this.api.take({ runKey: op.runKey, lease, newLease });
      if (gen !== this.gen || this.live !== live) return;
      if (res.taken || (!live.confirmed && (!res.savedRun || res.savedRun.runKey !== op.runKey))) {
        // Taken; or the server never had this Run from here, so nobody else can have it.
        live.leases = [newLease];
        live.confirmed = true;
      } else this.lose(op.runKey, live.leases);
      return;
    }
    const tag = op.snapshot.account;
    if (!tag) return;
    // The page's newest leases for a Run it is playing; the tag's for a copy it only keeps.
    const leases = live ? [...live.leases] : leasesOf(tag);
    const lease = leases[leases.length - 1]!;
    const res = await this.api.put({ runKey: op.runKey, ...leaseFields(leases), snapshot: uploadable(op.snapshot), ledger: true }, this.hidden());
    if (gen !== this.gen) return; // a credit it returns was another Account's: not applied here
    if (res.ok) {
      if (live && this.live === live) {
        // The server holds `lease` now. A lease added since this was sent (an unpause) is kept: its
        // take still has to move the Run off `lease`, and one that reused `lease` gets a fresh one.
        const at = live.leases.indexOf(lease);
        live.leases = at < 0 ? [lease] : live.leases.slice(at);
        if (live.leases.length === 1 && this.ops.get(op.runKey)?.kind === 'take') live.leases.push(newHandoffId());
        live.confirmed = true;
      }
      this.store.markSynced(op.runKey, lease);
      // A different Run this upload replaced: the server recorded it as a quit; its row lands here.
      for (const credit of res.credits) this.credits.apply(credit);
    } else if (res.reason === 'carriedOn') {
      this.lose(op.runKey, leases);
    } else if (live && this.live === live) {
      live.localOnly = true; // kept on this device only (a newer build's Run holds the Account's slot)
    }
  }

  /** Another device holds the Run: this page's copy is stale (the device slot's too, if it is ours). */
  private lose(runKey: string, leases: string[]): void {
    if (this.live?.runKey === runKey) this.live = null;
    this.ops.delete(runKey);
    const local = this.store.peek();
    if (local?.runKey === runKey && local.account && leases.includes(local.account.lease)) this.store.clear();
    for (const fn of this.lostListeners) fn(runKey);
    this.wake();
  }

  /** The page is going away: uploads and claims still waiting go now, with `keepalive` (pagehide). */
  flush(): void {
    if (!this.userId) return;
    for (const op of this.ops.values()) {
      if (op.kind !== 'put' || !op.snapshot.account) continue;
      const live = this.live?.runKey === op.runKey ? this.live : null;
      const leases = live ? live.leases : leasesOf(op.snapshot.account);
      void this.api.put({ runKey: op.runKey, ...leaseFields(leases), snapshot: uploadable(op.snapshot), ledger: true }, true).catch(() => undefined);
    }
    this.credits.flush();
  }
}

let singleton: AccountRuns | null = null;

/** The browser's instance (signed out until `installAccountRuns` hears from the Account). */
export function getAccountRuns(meta: Pick<MetaProgress, 'awardRun'>): AccountRuns {
  singleton ??= new AccountRuns({
    api: createSavedRunApi(),
    store: getSuspendedRuns(),
    meta,
    credits: new RunCreditQueue({ api: createRunCreditApi(), storage: browserStorage(), meta }),
    storage: browserStorage(),
  });
  return singleton;
}

/**
 * Follows the signed-in Account (which also replays its waiting claims), sends waiting uploads and
 * claims on pagehide, and replays claims when the browser comes back online (call once at boot).
 */
export function installAccountRuns(runs: AccountRuns, account: AccountClient): void {
  account.subscribe((s) => runs.setUser(s.status === 'signedIn' ? (s.user?.id ?? null) : null));
  if (typeof window === 'undefined') return;
  window.addEventListener('pagehide', () => runs.flush());
  window.addEventListener('online', () => runs.credits.replay());
}
