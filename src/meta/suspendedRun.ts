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
 * - It stays on the device, like settings and the Loadout: cloud saves don't carry it.
 * - Every tab shares the slot. The browser singleton hears other tabs' writes through `storage`
 *   events (`watchSuspendedRunStorage`) and tells its `onChange` listeners, marked `external`, so
 *   an open title shows the saved Run as it is. Resume and New run name the Run the screen showed
 *   (`runKey`) and do nothing if the slot holds another one by then.
 * - An unreadable or outdated slot reads as empty (`parseRunSnapshot`) and is dropped.
 */
import type { Game } from '../game/game';
import { parseRunSnapshot, type RunSnapshot } from '../game/snapshot';
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

  constructor(private readonly storage: Storage | null) {}

  private read(): string | null {
    if (!this.storage || this.stale) return this.memory;
    try {
      return this.storage.getItem(SUSPENDED_RUN_KEY);
    } catch {
      return this.memory;
    }
  }

  private write(value: string | null): void {
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

  /** The saved Run, or null (none, or one that can't be resumed). */
  peek(): RunSnapshot | null {
    const raw = this.read();
    if (!raw) return null;
    try {
      return parseRunSnapshot(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  get has(): boolean {
    return this.peek() !== null;
  }

  save(snapshot: RunSnapshot): void {
    this.write(JSON.stringify(snapshot));
  }

  /** Reads and clears the saved Run (Resume). */
  take(): RunSnapshot | null {
    const s = this.peek();
    if (this.read() !== null) this.write(null);
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
 * Save & quit: stores `snapshot` in the slot. A different Run already there (saved from another
 * tab or window) is replaced and counted as a quit, as New run would (its Fluff and stats
 * credited); the same Run saved again (same `runKey`) credits nothing. True when a different Run
 * was replaced.
 */
export function saveSuspendedRun(store: SuspendedRunStore, snapshot: RunSnapshot, meta: Pick<MetaProgress, 'awardRun'>): boolean {
  const prev = store.peek();
  const replaced = !!prev && prev.runKey !== snapshot.runKey;
  if (prev && replaced) meta.awardRun({ reason: 'quit', stats: prev.stats });
  store.save(snapshot);
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
