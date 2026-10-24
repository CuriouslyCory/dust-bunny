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
 *   then the copy is uploaded (`stored`). A hidden page uploads with `keepalive`, and so does
 *   `pagehide` for an upload still waiting, so a closing tab still gets it there. A different Run
 *   the upload replaces comes back from the server and is credited as a quit, unless the device
 *   slot's own replace just credited it.
 * - Unpause: optimistic. The Run plays on at once and the server take runs in the background
 *   (`takenBack`), retried with backoff while offline; never awaited. If the server says another
 *   device holds the Run (a refused take, or a 409 on a later upload) the page is told (`onLost`):
 *   it disposes its copy without `runEnded`, so nothing is credited twice, and says so.
 * - Title: `syncTitle` reads the server copy, which wins over the device slot: it is mirrored into
 *   the slot (a different Run that only this device had is credited as a quit first). A device copy
 *   the server never confirmed is uploaded instead. One from a newer build is left alone, on both
 *   sides, and the title says an update is needed (docs/adr/0001).
 * - Resume (`resume`) waits for the server take: of two devices racing, one gets the Run and the
 *   other's title refreshes. Offline, it resumes and takes in the background, as unpausing does.
 * - New run (`abandon`) and the Run ending (`ended`) delete the row, only for this page's lease.
 */
import type { RunSnapshot, SnapshotAccountTag } from '../game/snapshot';
import { isNewerSnapshot, newHandoffId, parseRunSnapshot } from '../game/snapshot';
import type { AccountClient } from '../net/account';
import type { ServerSavedRun } from '../shared/savedRun';
import type { MetaProgress } from './meta';
import { abandonSuspendedRun, getSuspendedRuns, type SuspendedRunStore } from './suspendedRun';

// ---------------------------------------------------------------------------------------------
// HTTP client for api/saved-run.ts
// ---------------------------------------------------------------------------------------------

/** The request didn't get a definite answer (offline, timeout, 5xx): try again later. */
export class SavedRunNetError extends Error {}
/** The session is gone (401): stop until the Account says otherwise. */
export class SavedRunAuthError extends Error {}

export type PutResult =
  | { ok: true; replaced: { runKey: string; snapshot: Record<string, unknown> | null } | null }
  /** `carriedOn`: another device holds this Run. `newer`: a newer build's Run is stored and kept. `rejected`: 400/413. */
  | { ok: false; reason: 'carriedOn' | 'newer' | 'rejected' };

export type TakeResult = { taken: true; snapshot: Record<string, unknown> | null } | { taken: false; savedRun: ServerSavedRun | null };

export interface SavedRunApi {
  get(): Promise<ServerSavedRun | null>;
  put(body: { runKey: string; lease: string; prevLease?: string; snapshot: unknown }, keepalive?: boolean): Promise<PutResult>;
  take(body: { runKey: string; lease: string; newLease: string }): Promise<TakeResult>;
  end(body: { runKey: string; lease: string; prevLease?: string }): Promise<{ deleted: boolean }>;
}

export interface SavedRunApiOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
  /** A request without an answer by then counts as offline (ms). */
  timeoutMs?: number;
}

export function createSavedRunApi(opts: SavedRunApiOptions = {}): SavedRunApi {
  const baseUrl = opts.baseUrl ?? '/api/saved-run';
  const doFetch = opts.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const timeoutMs = opts.timeoutMs ?? 8000;

  async function call(method: string, body?: unknown, keepalive = false): Promise<{ status: number; body: Record<string, unknown> }> {
    let res: Response;
    const ctrl = typeof AbortController === 'function' && !keepalive ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
    try {
      res = await doFetch(baseUrl, {
        method,
        credentials: 'same-origin',
        keepalive,
        signal: ctrl?.signal,
        headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      throw new SavedRunNetError(String(err));
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (res.status === 401) throw new SavedRunAuthError('unauthorized');
    if (res.status >= 500 || res.status === 429) throw new SavedRunNetError(`saved-run ${res.status}`);
    let parsed: Record<string, unknown> = {};
    try {
      parsed = ((await res.json()) as Record<string, unknown>) ?? {};
    } catch {
      if (res.ok) throw new SavedRunNetError('bad response');
    }
    return { status: res.status, body: parsed };
  }

  return {
    async get() {
      const r = await call('GET');
      if (r.status !== 200) throw new SavedRunNetError(`saved-run ${r.status}`);
      return (r.body.savedRun as ServerSavedRun | null) ?? null;
    },
    async put(body, keepalive = false) {
      const r = await call('PUT', body, keepalive);
      if (r.status === 200) return { ok: true, replaced: (r.body.replaced as { runKey: string; snapshot: Record<string, unknown> | null } | null) ?? null };
      if (r.status === 409) return { ok: false, reason: r.body.error === 'newer_saved_run' ? 'newer' : 'carriedOn' };
      return { ok: false, reason: 'rejected' };
    },
    async take(body) {
      const r = await call('POST', body);
      if (r.status === 200) return { taken: true, snapshot: (r.body.snapshot as Record<string, unknown> | null) ?? null };
      if (r.status === 409) return { taken: false, savedRun: (r.body.savedRun as ServerSavedRun | undefined) ?? null };
      throw new SavedRunNetError(`saved-run ${r.status}`);
    },
    async end(body) {
      const r = await call('DELETE', body);
      if (r.status !== 200) throw new SavedRunNetError(`saved-run ${r.status}`);
      return { deleted: r.body.deleted === true };
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

type Op =
  | { kind: 'put'; runKey: string; snapshot: RunSnapshot; prevLocalKey: string | null }
  | { kind: 'take'; runKey: string }
  | { kind: 'end'; runKey: string; leases: string[] };

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
  /** First retry delay (ms); doubles up to `maxRetryMs`. */
  retryMs?: number;
  maxRetryMs?: number;
  /** Whether the page is hidden (uploads then use `keepalive`). */
  hidden?: () => boolean;
}

/** Strips the device-only tag before uploading. */
function uploadable(s: RunSnapshot): RunSnapshot {
  const { account: _account, ...rest } = s;
  return rest as RunSnapshot;
}

function leasesOf(tag: SnapshotAccountTag): string[] {
  return tag.prevLease ? [tag.prevLease, tag.lease] : [tag.lease];
}

export class AccountRuns {
  private userId: string | null = null;
  private live: Live | null = null;
  /** Waiting server work, one per Run (a later one supersedes an earlier one), sent one at a time. */
  private ops = new Map<string, Op>();
  private inFlight: Op | null = null;
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lostListeners = new Set<(runKey: string) => void>();
  private userListeners = new Set<(userId: string | null) => void>();
  /** Runs this page was told it lost (for `confirmHeld`). */
  private lostKeys = new Set<string>();
  private waiters: (() => void)[] = [];
  private readonly api: SavedRunApi;
  private readonly store: SuspendedRunStore;
  private readonly meta: Pick<MetaProgress, 'awardRun'>;
  private readonly retryMs: number;
  private readonly maxRetryMs: number;
  private readonly hidden: () => boolean;
  /** The last `syncTitle` result (the title reads it on refresh). */
  title: TitleSync = { fromAccount: null, newerOnAccount: false, offline: false };

  constructor(opts: AccountRunsOptions) {
    this.api = opts.api;
    this.store = opts.store;
    this.meta = opts.meta;
    this.retryMs = opts.retryMs ?? 1000;
    this.maxRetryMs = opts.maxRetryMs ?? 30_000;
    this.hidden = opts.hidden ?? (() => typeof document !== 'undefined' && document.hidden);
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
    this.live = null;
    this.ops.clear();
    this.attempt = 0;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.title = { fromAccount: null, newerOnAccount: false, offline: false };
    this.store.setViewer(userId);
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
    this.lostKeys.clear();
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

  /**
   * The device slot now holds `snapshot` (tagged by `tag`): uploads it. `prevLocalKey`: the Run the
   * slot held before (the slot credited it if it was another one, so the server's copy of it isn't
   * credited again).
   */
  stored(snapshot: RunSnapshot, prevLocalKey: string | null): void {
    if (!this.userId || !snapshot.account) return;
    if (this.live?.runKey === snapshot.runKey && this.live.localOnly) return;
    this.queue({ kind: 'put', runKey: snapshot.runKey, snapshot, prevLocalKey });
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

  /**
   * Before this page ends (and credits) the Run it took back (End run, Quit to title from pause):
   * waits until the server take is settled. False when another device holds the Run (`onLost` was
   * called). True when it is this page's, signed out, or offline after `timeoutMs` (the device's
   * word is then all there is).
   */
  async confirmHeld(runKey: string, timeoutMs = 6000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const live = this.live;
      if (!this.userId || !live || live.runKey !== runKey) return !this.lostKeys.has(runKey);
      const busy = this.ops.has(runKey) || this.inFlight?.runKey === runKey || live.leases.length > 1;
      if (!busy || live.localOnly) return true;
      const left = deadline - Date.now();
      if (left <= 0) return true;
      await new Promise<void>((resolve) => {
        const t = setTimeout(done, left);
        function done(): void {
          clearTimeout(t);
          resolve();
        }
        this.waiters.push(done);
      });
    }
  }

  private wake(): void {
    const ws = this.waiters;
    this.waiters = [];
    for (const w of ws) w();
  }

  /** The Run ended on this page (`runEnded`): its row goes, if this page still holds it. */
  ended(runKey: string): void {
    const live = this.live;
    if (!this.userId || !live || live.runKey !== runKey) return;
    this.live = null;
    if (!live.localOnly) this.queue({ kind: 'end', runKey, leases: [...live.leases] });
  }

  // --- the title -------------------------------------------------------------------------------

  /**
   * Brings the device slot in line with the Account's saved Run (the title calls it on entry).
   * Resolves what the title should say; never throws.
   */
  async syncTitle(): Promise<TitleSync> {
    const userId = this.userId;
    if (!userId) return (this.title = { fromAccount: null, newerOnAccount: false, offline: false });
    let row: ServerSavedRun | null;
    try {
      row = await this.api.get();
    } catch {
      return userId === this.userId ? (this.title = { ...this.title, offline: true }) : this.title;
    }
    if (userId !== this.userId) return this.title;
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
        // The server copy wins. A different Run only this device had is replaced: a quit (as the slot
        // credits a Run saved over another). One the server had confirmed was credited by whoever replaced it there.
        if (local && local.runKey !== row.runKey && !mine?.synced) this.meta.awardRun({ reason: 'quit', stats: local.stats });
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
    this.queue({ kind: 'put', runKey: copy.runKey, snapshot: copy, prevLocalKey: copy.runKey });
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
    const leases = leasesOf(tag);
    const take = { runKey: shown.runKey, lease: leases[0]!, newLease: leases[1] ?? newHandoffId() };
    const userId = this.userId;
    try {
      const res = await this.api.take(take);
      if (userId !== this.userId) return 'failed';
      if (!res.taken && !(tag.synced === false && (!res.savedRun || res.savedRun.runKey !== shown.runKey))) {
        if (this.store.peek()?.runKey === shown.runKey) this.store.clear();
        return 'lost';
      }
      if (!start()) {
        // Taken but not started (the title was left meanwhile): store it again, so it isn't stranded.
        this.putBack(shown, take.newLease);
        return 'failed';
      }
      this.live = { runKey: shown.runKey, leases: [take.newLease], confirmed: true, localOnly: false };
      return 'mine';
    } catch (err) {
      if (err instanceof SavedRunAuthError) return 'failed';
      // Offline: play it, and take it in the background, as an unpause does.
      if (!start()) return 'failed';
      this.live = { runKey: shown.runKey, leases: [take.lease, take.newLease], confirmed: tag.synced, localOnly: false };
      this.queue({ kind: 'take', runKey: shown.runKey });
      return 'mine';
    }
  }

  private putBack(shown: RunSnapshot, lease: string): void {
    if (!this.userId) return;
    const copy: RunSnapshot = { ...structuredClone(shown), account: { userId: this.userId, lease, synced: false } };
    if (this.store.peek()?.runKey === shown.runKey) this.store.save(copy);
    this.queue({ kind: 'put', runKey: copy.runKey, snapshot: copy, prevLocalKey: copy.runKey });
  }

  /**
   * New run on the title gives up the Run on screen: its row is deleted (only if it is still held
   * under the lease shown) and then `abandon` credits it on the device. `lost` when another device
   * took it meanwhile (nothing is credited; refresh). Offline the device abandons it and the delete
   * is retried in the background.
   */
  async abandon(shown: RunSnapshot, abandonLocal: () => boolean): Promise<'done' | 'lost' | 'failed'> {
    const tag = shown.account;
    if (!this.userId || !tag || tag.userId !== this.userId) return abandonLocal() ? 'done' : 'failed';
    const leases = leasesOf(tag);
    const body = { runKey: shown.runKey, lease: leases[leases.length - 1]!, ...(leases.length > 1 ? { prevLease: leases[0] } : {}) };
    try {
      const res = await this.api.end(body);
      // Not deleted: another device holds it now, unless the server never had it.
      if (!res.deleted && tag.synced) {
        if (this.store.peek()?.runKey === shown.runKey) this.store.clear();
        return 'lost';
      }
    } catch (err) {
      if (err instanceof SavedRunAuthError) return 'failed';
      this.queue({ kind: 'end', runKey: shown.runKey, leases });
    }
    return abandonLocal() ? 'done' : 'failed';
  }

  /** A device abandon outside the title (any new Run start): the server row goes too. */
  abandoned(s: RunSnapshot): void {
    if (!this.userId || s.account?.userId !== this.userId) return;
    this.queue({ kind: 'end', runKey: s.runKey, leases: leasesOf(s.account) });
  }

  // --- sending ---------------------------------------------------------------------------------

  private queue(op: Op): void {
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
    if (next.done) return;
    const op = next.value;
    this.ops.delete(op.runKey);
    this.inFlight = op;
    const userId = this.userId;
    void this.send(op)
      .then(() => {
        this.attempt = 0;
      })
      .catch((err: unknown) => {
        if (userId !== this.userId) return;
        if (err instanceof SavedRunAuthError) return; // signed out elsewhere: the Account client will say so
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
        if (userId === this.userId) this.pump();
        this.wake();
      });
  }

  private async send(op: Op): Promise<void> {
    if (op.kind === 'end') {
      const leases = op.leases;
      await this.api.end({ runKey: op.runKey, lease: leases[leases.length - 1]!, ...(leases.length > 1 ? { prevLease: leases[0] } : {}) });
      return;
    }
    const live = this.live?.runKey === op.runKey ? this.live : null;
    if (op.kind === 'take') {
      if (!live || live.leases.length < 2) return; // settled meanwhile (an upload confirmed it, or the Run is gone)
      const [lease, newLease] = live.leases as [string, string];
      const res = await this.api.take({ runKey: op.runKey, lease, newLease });
      if (this.live !== live) return;
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
    const res = await this.api.put({ runKey: op.runKey, lease, ...(leases.length > 1 ? { prevLease: leases[0] } : {}), snapshot: uploadable(op.snapshot) }, this.hidden());
    if (res.ok) {
      if (live && this.live === live) {
        live.leases = [lease];
        live.confirmed = true;
      }
      this.store.markSynced(op.runKey, lease);
      const replaced = res.replaced;
      if (replaced && replaced.runKey !== op.prevLocalKey && replaced.runKey !== op.runKey && replaced.snapshot) {
        const s = parseRunSnapshot(replaced.snapshot);
        if (s) this.meta.awardRun({ reason: 'quit', stats: s.stats });
      }
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
    this.lostKeys.add(runKey);
    for (const fn of this.lostListeners) fn(runKey);
    this.wake();
  }

  /** The page is going away: uploads still waiting go now, with `keepalive` (pagehide). */
  flush(): void {
    if (!this.userId) return;
    for (const op of this.ops.values()) {
      if (op.kind !== 'put' || !op.snapshot.account) continue;
      const live = this.live?.runKey === op.runKey ? this.live : null;
      const leases = live ? live.leases : leasesOf(op.snapshot.account);
      void this.api
        .put({ runKey: op.runKey, lease: leases[leases.length - 1]!, ...(leases.length > 1 ? { prevLease: leases[0] } : {}), snapshot: uploadable(op.snapshot) }, true)
        .catch(() => undefined);
    }
  }
}

let singleton: AccountRuns | null = null;

/** The browser's instance (signed out until `installAccountRuns` hears from the Account). */
export function getAccountRuns(meta: Pick<MetaProgress, 'awardRun'>): AccountRuns {
  singleton ??= new AccountRuns({ api: createSavedRunApi(), store: getSuspendedRuns(), meta });
  return singleton;
}

/** Follows the signed-in Account and sends waiting uploads on pagehide (call once at boot). */
export function installAccountRuns(runs: AccountRuns, account: AccountClient): void {
  account.subscribe((s) => runs.setUser(s.status === 'signedIn' ? (s.user?.id ?? null) : null));
  if (typeof window !== 'undefined') window.addEventListener('pagehide', () => runs.flush());
}

/** `abandonSuspendedRun` for a new Run start, deleting the Account's copy too. */
export function abandonSavedRun(store: SuspendedRunStore, meta: Pick<MetaProgress, 'awardRun'>, runs: AccountRuns | null): boolean {
  const s = store.peek();
  if (!abandonSuspendedRun(store, meta)) return false;
  if (s && runs) runs.abandoned(s);
  return true;
}
