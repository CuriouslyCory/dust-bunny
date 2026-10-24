/**
 * The suspended Run (Save & quit) on this device: one slot in localStorage under
 * `dust-bunny:suspended-run:v1`, holding a `RunSnapshot` (src/game/snapshot.ts).
 *
 * - Save & quit writes it (`saveSuspendedRun`). There is one slot, so the last save wins it: a
 *   different Run already there (saved from another tab or window) is credited as a quit first,
 *   as New run would. Runs are told apart by `RunSnapshot.runKey`; saving the same Run again
 *   credits nothing.
 * - Resume reads it and clears it as the Run starts again (`take`),
 *   so a snapshot is resumed at most once: dying after a resume can't be undone by resuming again.
 * - Starting a new Run instead abandons it (`abandonSuspendedRun`): its Fluff and stats are
 *   credited as a quit. The title does it as soon as New run is confirmed; any other new Run start
 *   does it on runStarted.
 * - Not signed in, it stays on the device. Signed in, the slot mirrors the Account's saved Run
 *   (src/meta/accountRun.ts, api/saved-run.ts; docs/adr/0002): every copy written then is tagged
 *   with the Account (`RunSnapshot.account`) and uploaded, and the title takes the server's copy
 *   over the device's, so a Run paused on one device can be resumed on another. A copy tagged for
 *   another Account (or any, signed out) reads as empty (`setViewer`): it is never offered,
 *   credited or taken here.
 * - Every tab shares the slot. The browser singleton hears other tabs' writes through `storage`
 *   events (`watchSuspendedRunStorage`) and tells its `onChange` listeners, marked `external`, so
 *   an open title shows the saved Run as it is. Resume and New run name the Run the screen showed
 *   (`runKey`) and do nothing if the slot holds another one by then.
 * - Pausing stores the Run too, under a fresh `handoffId` the pausing page remembers
 *   (`storePausedRun`); unpausing takes it back only while the slot still holds that id
 *   (`takeBackPausedRun`). Until then any other tab may pick it up with Resume run, and the
 *   pausing page steps aside (src/game/handoff.ts). Takes run under a Web Lock (`withSavedRunLock`).
 * - An older snapshot is migrated as it is read (`parseRunSnapshot`). One from a newer build reads
 *   as empty and is never overwritten or deleted (docs/adr/0001): this page keeps its own writes
 *   in memory instead, and the title says an update is needed (`newer`). Anything else unreadable
 *   reads as empty.
 */
import type { Game } from '../game/game';
import { isNewerSnapshot, parseRunSnapshot, type RunSnapshot } from '../game/snapshot';
import { repairLoadout } from './hoard';
import type { MetaProgress } from './meta';
import { browserStorage, type KeyValueStorage } from './save';

export const SUSPENDED_RUN_KEY = 'dust-bunny:suspended-run:v1';

type Storage = KeyValueStorage & { removeItem?(key: string): void };

/** What an `onChange` listener is told. `external`: another tab or window changed the slot. */
export interface SuspendedRunChange {
  external: boolean;
}

export class SuspendedRunStore {
  private memory: string | null = null;
  /** The last write didn't reach storage: `memory` is the truth for this page from then on. */
  private stale = false;
  private listeners = new Set<(change: SuspendedRunChange) => void>();
  /** The signed-in Account (null: none). A copy tagged with another Account (or any, signed out) reads as empty. */
  private viewer: string | null = null;

  constructor(private readonly storage: Storage | null) {}

  /** Sets who is signed in (src/meta/accountRun.ts); tells listeners when it changes what the slot shows. */
  setViewer(userId: string | null): void {
    if (userId === this.viewer) return;
    this.viewer = userId;
    this.emit({ external: false });
  }

  private parsed(): unknown {
    const raw = this.read();
    if (!raw) return null;
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  }

  /** What storage itself holds is a newer build's saved Run (whatever this page serves from memory). */
  private storageHoldsNewer(): boolean {
    if (!this.storage) return false;
    try {
      const raw = this.storage.getItem(SUSPENDED_RUN_KEY);
      return !!raw && isNewerSnapshot(JSON.parse(raw));
    } catch {
      return false;
    }
  }

  /** The slot holds a saved Run from a newer build: kept as it is, unread (docs/adr/0001). */
  get newer(): boolean {
    return isNewerSnapshot(this.parsed());
  }

  private read(): string | null {
    if (!this.storage || this.stale) return this.memory;
    try {
      return this.storage.getItem(SUSPENDED_RUN_KEY);
    } catch {
      return this.memory;
    }
  }

  private write(value: string | null): void {
    // A newer build's saved Run is never deleted or overwritten here: this page keeps its own copy
    // in memory instead, as when storage is full.
    if (this.storageHoldsNewer()) {
      this.memory = value;
      this.stale = true;
      this.emit({ external: false });
      return;
    }
    this.memory = value;
    if (this.storage) {
      try {
        if (value !== null) this.storage.setItem(SUSPENDED_RUN_KEY, value);
        else if (this.storage.removeItem) this.storage.removeItem(SUSPENDED_RUN_KEY);
        else this.storage.setItem(SUSPENDED_RUN_KEY, '');
        this.stale = false;
      } catch {
        // Storage full or disabled: the in-memory copy serves this page (a saved Run is still
        // resumable here, and a taken one can't be taken again).
        this.stale = true;
      }
    }
    this.emit({ external: false });
  }

  private emit(change: SuspendedRunChange): void {
    for (const fn of this.listeners) fn(change);
  }

  /**
   * Another tab or window changed the slot (a `storage` event). After a failed write this page
   * was serving its in-memory copy; storage now holds something newer, so that is the truth again.
   */
  storageChanged(): void {
    if (this.stale && this.storage) {
      try {
        this.memory = this.storage.getItem(SUSPENDED_RUN_KEY);
        this.stale = false;
      } catch {
        // Still unreadable: keep serving memory.
      }
    }
    this.emit({ external: true });
  }

  /**
   * The last write didn't reach storage: this page is serving its own copy, and storage may still
   * hold something else (another tab's Run).
   */
  get unsaved(): boolean {
    return this.stale;
  }

  /**
   * After a failed write: drops this page's in-memory copy and reads storage again, without
   * touching storage (whatever it holds was never replaced). No-op when the last write stuck.
   */
  dropUnsaved(): void {
    if (!this.stale) return;
    this.stale = false;
    this.memory = null;
    this.emit({ external: false });
  }

  /**
   * The saved Run, or null (none, one that can't be resumed, or one kept for an Account other than
   * the signed-in one: another player's Runs are never offered, credited or taken).
   */
  peek(): RunSnapshot | null {
    const s = this.peekAny();
    if (s?.account && s.account.userId !== this.viewer) return null;
    return s;
  }

  /** The saved Run whoever's Account it is kept for (null: none, or unreadable). */
  peekAny(): RunSnapshot | null {
    return parseRunSnapshot(this.parsed());
  }

  get has(): boolean {
    return this.peek() !== null;
  }

  /** Stores the saved Run. False when it only reached this page's memory (storage full or locked). */
  save(snapshot: RunSnapshot): boolean {
    this.write(JSON.stringify(snapshot));
    return !this.stale;
  }

  /**
   * Marks the copy in the slot as confirmed by the server, if it still is `runKey` stored under
   * `lease` (src/meta/accountRun.ts). False when the slot holds something else by now.
   */
  markSynced(runKey: string, lease: string): boolean {
    const s = this.peek();
    if (!s?.account || s.runKey !== runKey || s.account.lease !== lease || s.account.synced) return false;
    s.account = { userId: s.account.userId, lease, synced: true };
    this.write(JSON.stringify(s));
    return !this.stale;
  }

  /** Reads and clears the saved Run (Resume). */
  take(): RunSnapshot | null {
    const s = this.peek();
    if (s) this.write(null);
    return s;
  }

  clear(): void {
    if (this.read() !== null || this.memory !== null) this.write(null);
  }

  /** Called after every change to the slot: this page's writes and (via `storageChanged`) other tabs'. */
  onChange(fn: (change: SuspendedRunChange) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

/** Where `storage` events arrive: `window` in the browser, any EventTarget in tests. */
export type StorageEventSource = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

/**
 * Forwards `storage` events for the slot (written, removed, or all storage cleared: `key` null)
 * to `store.storageChanged()`. The browser only sends them to the other pages, never the writer.
 * Returns the unsubscribe; a no-op without a source (no `window`).
 */
export function watchSuspendedRunStorage(store: SuspendedRunStore, source: StorageEventSource | null | undefined): () => void {
  if (!source) return () => {};
  const fn = (e: Event): void => {
    const { key } = e as StorageEvent;
    if (key === SUSPENDED_RUN_KEY || key === null) store.storageChanged();
  };
  source.addEventListener('storage', fn);
  return () => source.removeEventListener('storage', fn);
}

let instance: SuspendedRunStore | null = null;

/** Browser singleton backed by localStorage (in-memory only if storage is unavailable), kept current with other tabs. */
export function getSuspendedRuns(): SuspendedRunStore {
  if (!instance) {
    instance = new SuspendedRunStore(browserStorage());
    watchSuspendedRunStorage(instance, typeof window === 'undefined' ? null : window);
  }
  return instance;
}

/** The saved Run, if it is the one keyed `runKey` (undefined: any). Null when the slot is empty or holds another Run. */
function savedRunIf(store: SuspendedRunStore, runKey: string | undefined): RunSnapshot | null {
  const s = store.peek();
  return s && (runKey === undefined || s.runKey === runKey) ? s : null;
}

/**
 * Whether saving `next` over `prev` credits `prev` here, on the device: a different Run, unless
 * `prev` is a copy of the Account's saved Run the server confirmed (mirrored from the server, say,
 * by any tab) and `next` goes to the same Account. The server's copy of that Run may have been
 * taken by another device since, which will credit it when it ends; so it is credited only from
 * the server's answer to `next`'s upload, which hands back a stored copy it really replaced
 * (src/meta/accountRun.ts, `stored`; docs/adr/0002).
 */
export function creditsReplacedOnDevice(prev: RunSnapshot, next: RunSnapshot): boolean {
  if (prev.runKey === next.runKey) return false;
  return !(prev.account?.synced && next.account?.userId === prev.account.userId);
}

/**
 * Save & quit: stores `snapshot` in the slot. A different Run already there (saved from another
 * tab or window) is replaced and counted as a quit, as New run would (its Fluff and stats
 * credited); the same Run saved again (same `runKey`) credits nothing. A write that doesn't reach
 * storage credits nothing either (the replaced Run is still there). True when a different Run was
 * replaced.
 */
export function saveSuspendedRun(store: SuspendedRunStore, snapshot: RunSnapshot, meta: Pick<MetaProgress, 'awardRun'>): boolean {
  const prev = store.peek();
  const replaced = !!prev && prev.runKey !== snapshot.runKey;
  // Credited only once it is really gone: after a failed write the old Run is still in storage, and
  // another tab or a reload can still resume or abandon it (and be credited then).
  if (store.save(snapshot) && prev && replaced && creditsReplacedOnDevice(prev, snapshot)) meta.awardRun({ reason: 'quit', stats: prev.stats });
  return replaced;
}

/**
 * A new Run starts instead of the saved one: the saved Run is dropped and counted as a quit (its
 * Fluff and stats are credited, as Quit to title would have). False when there was none. With
 * `runKey` (the Run a screen showed) it only abandons that Run: another one is left alone.
 */
export function abandonSuspendedRun(store: SuspendedRunStore, meta: Pick<MetaProgress, 'awardRun'>, runKey?: string): boolean {
  if (!savedRunIf(store, runKey)) return false;
  const s = store.take();
  if (!s) return false;
  meta.awardRun({ reason: 'quit', stats: s.stats });
  return true;
}

/**
 * Resumes the saved Run (its Loadout repaired against the Hoard, which may have changed since).
 * False when there is none, or with `runKey` (the Run a screen showed) when the slot holds another.
 */
export function resumeSuspendedRun(game: Game, store: SuspendedRunStore, meta: Pick<MetaProgress, 'data'>, runKey?: string): boolean {
  if (!savedRunIf(store, runKey)) return false;
  const s = store.take();
  if (!s) return false;
  game.resumeRun(s, repairLoadout(s.characterId, s.loadout, meta.data.characters[s.characterId]));
  return true;
}

// ---------------------------------------------------------------------------------------------
// Pause hand-off: a paused Run is a saved Run. The page that pauses stores its Run under a fresh
// `handoffId` and remembers it (src/game/handoff.ts); unpausing takes the Run back only while the
// slot still holds that id. Meanwhile anyone else may take it (another tab's Resume run, or its
// New run): the Run was then picked up elsewhere, and the pausing page steps aside.
// ---------------------------------------------------------------------------------------------

/**
 * What the slot says about the Run (`runKey`) this page stored on pause under `handoffId`:
 * - `mine`: still there, as stored. The page may take it back and play on.
 * - `carriedOn`: taken (resumed elsewhere, or abandoned by New run, which credited it), or stored
 *   again by whoever took it (the same Run under another hand-off). Data this build can't read
 *   counts here too and is left alone (docs/adr/0001): most likely a newer build's copy of it.
 * - `replaced`: another Run was saved over it (and this one credited as a quit then).
 */
export type PausedRunState = 'mine' | 'carriedOn' | 'replaced';

export function pausedRunState(store: SuspendedRunStore, handoffId: string, runKey: string): PausedRunState {
  const s = store.peek();
  if (s && s.handoffId === handoffId && s.runKey === runKey) return 'mine';
  return s && s.runKey !== runKey ? 'replaced' : 'carriedOn';
}

/**
 * Pause: stores `snapshot` under `handoffId`, by the Save & quit rule (`saveSuspendedRun`: a
 * different Run already in the slot is credited as a quit once the write sticks; the same Run again
 * credits nothing). True when the write reached storage, so other tabs can pick it up; false when
 * only this page's memory holds it (still this page's to take back).
 */
export function storePausedRun(store: SuspendedRunStore, snapshot: RunSnapshot, handoffId: string, meta: Pick<MetaProgress, 'awardRun'>): boolean {
  snapshot.handoffId = handoffId;
  const prev = store.peek();
  const stored = store.save(snapshot);
  if (stored && prev && creditsReplacedOnDevice(prev, snapshot)) meta.awardRun({ reason: 'quit', stats: prev.stats });
  return stored;
}

/**
 * Unpause, and End run / Quit to title from pause: clears the slot if it still holds this page's
 * Run (`handoffId`, `runKey`) and returns `mine`: the page is its only owner again and may play on
 * (or end and credit it). Otherwise it touches nothing and returns why (`pausedRunState`): the Run
 * is someone else's now, and this page must neither play nor credit it. Run it inside
 * `withSavedRunLock`. If the pause's write never reached storage, only this page's in-memory copy
 * is dropped: storage still holds whatever was there (another tab's Run, not replaced nor
 * credited), and it must not be deleted.
 */
export function takeBackPausedRun(store: SuspendedRunStore, handoffId: string, runKey: string): PausedRunState {
  const state = pausedRunState(store, handoffId, runKey);
  if (state === 'mine') {
    if (store.unsaved) store.dropUnsaved();
    else store.clear();
  }
  return state;
}

/** The Web Lock every take of the slot runs under (Resume run, New run, the take back on unpause). */
export const SAVED_RUN_LOCK = 'dust-bunny:saved-run';

/** The part of `navigator.locks` used here. */
export interface LockManagerLike {
  request<T>(name: string, callback: () => T | Promise<T>): Promise<T>;
}

function browserLocks(): LockManagerLike | null {
  const nav = (globalThis as { navigator?: { locks?: LockManagerLike } }).navigator;
  return nav?.locks && typeof nav.locks.request === 'function' ? nav.locks : null;
}

/**
 * Runs `fn` (a read then a write of the slot) under the `SAVED_RUN_LOCK` Web Lock, so two tabs
 * can't take the same Run in the same moment. Without Web Locks (`locks` null) `fn` runs at once,
 * synchronously; the race window is then the few milliseconds between its read and write. The
 * store itself stays synchronous: only this wrapper is async.
 */
export function withSavedRunLock<T>(fn: () => T, locks: LockManagerLike | null = browserLocks()): Promise<T> {
  if (!locks) {
    try {
      return Promise.resolve(fn());
    } catch (e) {
      return Promise.reject(e);
    }
  }
  return locks.request(SAVED_RUN_LOCK, fn);
}
