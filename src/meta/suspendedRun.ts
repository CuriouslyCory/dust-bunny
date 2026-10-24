/**
 * The saved Run slot on this device: one slot in localStorage under `dust-bunny:suspended-run:v1`,
 * holding a `RunSnapshot` (src/game/snapshot.ts). This file holds the slot and its rules; callers
 * go through `SavedRuns` (src/meta/savedRuns.ts), which owns the slot together with the lock, the
 * Account's copy and who credits a Run the slot lets go of.
 *
 * - There is one slot, so the last save wins it (`replace`): a different Run already there (saved
 *   from another tab or window) is handed back to be credited as a quit, once the write has stuck.
 *   Runs are told apart by `RunSnapshot.runKey`; saving the same Run again replaces nothing.
 * - Resume and New run take it (`takeIf`), so a snapshot is resumed or abandoned at most once:
 *   dying after a resume can't be undone by resuming again. Both name the Run the screen showed
 *   (`runKey`) and do nothing if the slot holds another one by then.
 * - Signed in, the slot mirrors the Account's saved Run (docs/adr/0002): every copy written then is
 *   tagged with the Account (`RunSnapshot.account`). A copy tagged for another Account (or any,
 *   signed out) reads as empty (`setViewer`): it is never offered, credited or taken here.
 * - Every tab shares the slot. `watchSuspendedRunStorage` hears other tabs' writes through
 *   `storage` events and tells the `onChange` listeners, marked `external`, so an open title shows
 *   the saved Run as it is.
 * - Pausing stores the Run too, under a fresh `handoffId` the pausing page remembers; unpausing
 *   takes it back only while the slot still holds that id (`takeBackPausedRun`). Until then any
 *   other tab may pick it up with Resume run, and the pausing page steps aside (src/game/handoff.ts).
 *   Takes run under a Web Lock (`withSavedRunLock`).
 * - An older snapshot is migrated as it is read (`parseRunSnapshot`). One from a newer build reads
 *   as empty and is never overwritten or deleted (docs/adr/0001): this page keeps its own writes
 *   in memory instead, and the title says an update is needed (`newer`). Anything else unreadable
 *   reads as empty.
 */
import { parseRunSnapshot, SNAPSHOT_VERSION, type RunSnapshot } from '../game/snapshot';
import type { KeyValueStorage, SaveStorageEvent, StorageEventSource } from './save';
import { type VersionedFormat, VersionedStore } from './versionedStore';

export const SUSPENDED_RUN_KEY = 'dust-bunny:suspended-run:v1';

type Storage = KeyValueStorage;

/**
 * The slot (./versionedStore.ts): a newer build's snapshot is never written over or removed, and a
 * write that doesn't reach storage stays in this page's memory. `parseRunSnapshot` migrates an
 * older snapshot itself, and reads a newer one, or anything else it can't resume, as none.
 */
const SLOT_FORMAT: VersionedFormat<RunSnapshot | null, RunSnapshot> = {
  key: SUSPENDED_RUN_KEY,
  version: SNAPSHOT_VERSION,
  empty: () => null,
  parse: (o) => parseRunSnapshot(o),
};

/** What an `onChange` listener is told. `external`: another tab or window changed the slot. */
export interface SuspendedRunChange {
  external: boolean;
}

export class SuspendedRunStore {
  /** The slot; after a write that didn't reach storage, this page's copy in memory is the truth for it. */
  private readonly slot: VersionedStore<RunSnapshot | null, RunSnapshot>;
  private listeners = new Set<(change: SuspendedRunChange) => void>();
  /** The signed-in Account (null: none). A copy tagged with another Account (or any, signed out) reads as empty. */
  private viewer: string | null = null;

  /** No storage at all: the slot lives in this page's memory, and that is not a failed write. */
  private readonly memoryOnly: boolean;

  constructor(storage: Storage | null) {
    this.slot = new VersionedStore(storage, SLOT_FORMAT);
    this.memoryOnly = storage === null;
  }

  /** Sets who is signed in (src/meta/savedRuns.ts); tells listeners when it changes what the slot shows. */
  setViewer(userId: string | null): void {
    if (userId === this.viewer) return;
    this.viewer = userId;
    this.emit({ external: false });
  }

  /** The slot holds a saved Run from a newer build: kept as it is, unread (docs/adr/0001). */
  get newer(): boolean {
    return this.slot.read().found === 'newer';
  }

  private write(value: RunSnapshot | null): void {
    // A newer build's saved Run is never deleted or overwritten here, and when storage is full or
    // disabled the in-memory copy serves this page (a saved Run is still resumable here, and a
    // taken one can't be taken again).
    if (value) this.slot.write(value);
    else this.slot.remove();
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
    if (!this.memoryOnly) this.slot.dropMemory();
    this.emit({ external: true });
  }

  /**
   * The last write didn't reach storage: this page is serving its own copy, and storage may still
   * hold something else (another tab's Run). Never, without storage at all: memory is the slot then.
   */
  get unsaved(): boolean {
    return !this.memoryOnly && this.slot.inMemory;
  }

  /**
   * After a failed write: drops this page's in-memory copy and reads storage again, without
   * touching storage (whatever it holds was never replaced). No-op when the last write stuck.
   */
  dropUnsaved(): void {
    if (!this.unsaved) return;
    this.slot.dropMemory();
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
    return this.slot.read().value;
  }

  get has(): boolean {
    return this.peek() !== null;
  }

  /** Stores the saved Run. False when it only reached this page's memory (storage full or locked, or a newer build's Run in the slot). */
  save(snapshot: RunSnapshot): boolean {
    this.write(snapshot);
    return !this.unsaved;
  }

  /**
   * Stores `snapshot` over whatever the slot holds. `replaced`: a different Run (another `runKey`)
   * that was there and is gone now, to be credited as a quit. Null when the write only reached this
   * page's memory: the old Run is still in storage, and another tab or a reload can still resume or
   * abandon it (and credit it then).
   */
  replace(snapshot: RunSnapshot): { stored: boolean; replaced: RunSnapshot | null } {
    const prev = this.peek();
    const stored = this.save(snapshot);
    return { stored, replaced: stored && prev && prev.runKey !== snapshot.runKey ? prev : null };
  }

  /** Takes the saved Run if it is the one keyed `runKey` (undefined: any). Null when the slot is empty or holds another Run. */
  takeIf(runKey?: string): RunSnapshot | null {
    const s = this.peek();
    return s && (runKey === undefined || s.runKey === runKey) ? this.take() : null;
  }

  /**
   * Marks the copy in the slot as confirmed by the server, if it still is `runKey` stored under
   * `lease` (src/meta/savedRuns.ts). False when the slot holds something else by now.
   */
  markSynced(runKey: string, lease: string): boolean {
    const s = this.peek();
    if (!s?.account || s.runKey !== runKey || s.account.lease !== lease || s.account.synced) return false;
    s.account = { userId: s.account.userId, lease, synced: true };
    this.write(s);
    return !this.unsaved;
  }

  /** Reads and clears the saved Run (Resume). */
  take(): RunSnapshot | null {
    const s = this.peek();
    if (s) this.write(null);
    return s;
  }

  clear(): void {
    if (this.slot.inMemory || this.slot.read().raw) this.write(null);
  }

  /** Called after every change to the slot: this page's writes and (via `storageChanged`) other tabs'. */
  onChange(fn: (change: SuspendedRunChange) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

/**
 * Forwards `storage` events for the slot (written, removed, or all storage cleared: `key` null)
 * to `store.storageChanged()`. The browser only sends them to the other pages, never the writer.
 * Returns the unsubscribe; a no-op without a source (no `window`).
 */
export function watchSuspendedRunStorage(store: SuspendedRunStore, source: StorageEventSource | null | undefined): () => void {
  if (!source) return () => {};
  const fn = (e: SaveStorageEvent): void => {
    if (e.key === SUSPENDED_RUN_KEY || e.key === null) store.storageChanged();
  };
  source.addEventListener('storage', fn);
  return () => source.removeEventListener('storage', fn);
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
