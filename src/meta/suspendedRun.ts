/**
 * The suspended Run (Save & quit) on this device: one slot in localStorage under
 * `dust-bunny:suspended-run:v1`, holding a `RunSnapshot` (src/game/snapshot.ts).
 *
 * - Save & quit writes it (`save`); Resume reads it and clears it as the Run starts again (`take`),
 *   so a snapshot is resumed at most once: dying after a resume can't be undone by resuming again.
 * - Starting a new Run instead abandons it (`abandonSuspendedRun`, on runStarted; the title asks
 *   first): its Fluff and stats are credited as a quit.
 * - It stays on the device, like settings and the Loadout: cloud saves don't carry it.
 * - An unreadable or outdated slot reads as empty (`parseRunSnapshot`) and is dropped.
 */
import type { Game } from '../game/game';
import { parseRunSnapshot, type RunSnapshot } from '../game/snapshot';
import { repairLoadout } from './hoard';
import type { MetaProgress } from './meta';
import { browserStorage, type KeyValueStorage } from './save';

export const SUSPENDED_RUN_KEY = 'dust-bunny:suspended-run:v1';

type Storage = KeyValueStorage & { removeItem?(key: string): void };

export class SuspendedRunStore {
  private memory: string | null = null;
  private listeners = new Set<() => void>();

  constructor(private readonly storage: Storage | null) {}

  private read(): string | null {
    if (!this.storage) return this.memory;
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
      } catch {
        // Storage full or disabled: the in-memory copy still serves this page.
      }
    }
    for (const fn of this.listeners) fn();
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

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

let instance: SuspendedRunStore | null = null;

/** Browser singleton backed by localStorage (in-memory only if storage is unavailable). */
export function getSuspendedRuns(): SuspendedRunStore {
  instance ??= new SuspendedRunStore(browserStorage());
  return instance;
}

/**
 * A new Run starts instead of the saved one: the saved Run is dropped and counted as a quit (its
 * Fluff and stats are credited, as Quit to title would have). False when there was none.
 */
export function abandonSuspendedRun(store: SuspendedRunStore, meta: Pick<MetaProgress, 'awardRun'>): boolean {
  const s = store.take();
  if (!s) return false;
  meta.awardRun({ reason: 'quit', stats: s.stats });
  return true;
}

/** Resumes the saved Run (its Loadout repaired against the Hoard, which may have changed since). False when there is none. */
export function resumeSuspendedRun(game: Game, store: SuspendedRunStore, meta: Pick<MetaProgress, 'data'>): boolean {
  const s = store.take();
  if (!s) return false;
  game.resumeRun(s, repairLoadout(s.characterId, s.loadout, meta.data.characters[s.characterId]));
  return true;
}
