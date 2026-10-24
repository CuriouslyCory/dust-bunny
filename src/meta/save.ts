/**
 * Versioned save data in localStorage under `dust-bunny:save:v1`.
 *
 * parseSave() never throws: unreadable JSON, wrong types or out-of-range numbers fall back to
 * defaults field by field, and an unversioned legacy object is migrated. When the stored value
 * is corrupt, SaveStore copies it to `<key>:corrupt` before overwriting it on the next save.
 *
 * Several tabs share the one key: SaveStore.update re-reads it before each write (read-modify-write,
 * never an overwrite with a copy from page load), and with a `storage` event source it follows
 * other tabs' writes as they happen.
 *
 * Storage goes through a VersionedStore (./versionedStore.ts): a save from a newer build is read
 * as far as it is understood and never written (docs/adr/0001).
 *
 * To change the shape: bump SAVE_VERSION, keep the key, add a step to SAVE_FORMAT.migrations (and
 * a test with a stored example of the old shape). Purely additive
 * fields with a sanitised default (like `lastDifficulty`, `characters`, `lastLoadout`, `universes`,
 * `creditedRuns`) don't need a bump.
 */
import type { KeepsakeRef } from '../data/keepsakes';
import { DEFAULT_DIFFICULTY, isDifficultyId, type DifficultyId } from '../shared/difficulty';
import { isRunKey } from '../shared/runCredit';
import { hasKeepsakes, repairLoadout, sanitizeCharacterHoard, type CharacterHoard } from './hoard';
import { decodeVersioned, encodeVersioned, type KeyValueStorage, type Reading, type StoredFound, type StoreStatus, type VersionedFormat, VersionedStore } from './versionedStore';

export const SAVE_KEY = 'dust-bunny:save:v1';
export const SAVE_VERSION = 1;

/** Settings slot (owned by the settings screen). Only JSON primitives are kept. */
export interface SaveSettings {
  masterVolume?: number;
  musicVolume?: number;
  sfxVolume?: number;
  quality?: 'low' | 'medium' | 'high';
  reducedMotion?: boolean;
  [key: string]: string | number | boolean | undefined;
}

export interface SaveStats {
  runs: number;
  wins: number;
  bestRadius: number;
  bestTier: number;
  totalFluffEarned: number;
  /** Keepsakes credited from boss kills (Felting results not counted). */
  keepsakesEarned: number;
  /** Feltings done on this device (not synced; the first one gets a story caption). */
  feltings: number;
}

export interface SaveData {
  version: typeof SAVE_VERSION;
  /** Fluff wallet. */
  fluff: number;
  /** Upgrade id → owned level. */
  upgrades: Record<string, number>;
  lastCharacterId: string | null;
  /** Difficulty picked on character select (unknown values read as casual). */
  lastDifficulty: DifficultyId;
  settings: SaveSettings;
  stats: SaveStats;
  /** Character id → Keepsake Hoard and bosses beaten (synced by the cloud save). */
  characters: Record<string, CharacterHoard>;
  /** Character id → the Loadout last tucked in (repaired against the Hoard; synced by the cloud save). */
  lastLoadout: Record<string, KeepsakeRef[]>;
  /** Universe victories (endings) so far; the title reads "Universe N" with N = universes + 1. */
  universes: number;
  /**
   * The newest Run keys whose credit (Fluff and stats) this save holds, oldest first, at most
   * `CREDITED_RUNS_MAX` (docs/adr/0003). Written in the same update as the Fluff it accounts for and
   * synced with it, so a Run is credited at most once per progress copy.
   */
  creditedRuns: string[];
}

/** How a stored save read. `newer`: a newer build wrote it, so this build reads it but never writes it. */
export type SaveStatus = 'empty' | 'ok' | 'migrated' | 'newer' | 'corrupt';

export function defaultSave(): SaveData {
  return {
    version: SAVE_VERSION,
    fluff: 0,
    upgrades: {},
    lastCharacterId: null,
    lastDifficulty: DEFAULT_DIFFICULTY,
    settings: {},
    stats: { runs: 0, wins: 0, bestRadius: 0, bestTier: 0, totalFluffEarned: 0, keepsakesEarned: 0, feltings: 0 },
    characters: {},
    lastLoadout: {},
    universes: 0,
    creditedRuns: [],
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback);
const int = (v: unknown): number => Math.floor(num(v));

function sanitizeSettings(v: unknown): SaveSettings {
  const out: SaveSettings = {};
  if (!isObj(v)) return out;
  for (const [k, val] of Object.entries(v)) {
    if (typeof val === 'boolean' || typeof val === 'string' || (typeof val === 'number' && Number.isFinite(val))) out[k] = val;
  }
  return out;
}

function sanitizeV1(o: Record<string, unknown>): SaveData {
  const d = defaultSave();
  d.fluff = int(o.fluff);
  if (isObj(o.upgrades)) for (const [k, v] of Object.entries(o.upgrades)) if (int(v) > 0) d.upgrades[k] = int(v);
  d.lastCharacterId = typeof o.lastCharacterId === 'string' ? o.lastCharacterId : null;
  d.lastDifficulty = isDifficultyId(o.lastDifficulty) ? o.lastDifficulty : DEFAULT_DIFFICULTY;
  d.settings = sanitizeSettings(o.settings);
  const s = isObj(o.stats) ? o.stats : {};
  d.stats = {
    runs: int(s.runs),
    wins: int(s.wins),
    bestRadius: num(s.bestRadius),
    bestTier: int(s.bestTier),
    totalFluffEarned: int(s.totalFluffEarned),
    keepsakesEarned: int(s.keepsakesEarned),
    feltings: int(s.feltings),
  };
  if (isObj(o.characters)) {
    for (const [id, c] of Object.entries(o.characters)) {
      if (!hasKeepsakes(id)) continue;
      const hoard = sanitizeCharacterHoard(id, c);
      if (Object.keys(hoard.hoard).length || hoard.bossesBeaten.length) d.characters[id] = hoard;
    }
  }
  if (isObj(o.lastLoadout)) {
    for (const [id, l] of Object.entries(o.lastLoadout)) {
      if (!hasKeepsakes(id) || !Array.isArray(l)) continue;
      const repaired = repairLoadout(id, l, d.characters[id]);
      if (repaired.length) d.lastLoadout[id] = repaired;
    }
  }
  d.universes = int(o.universes);
  // Not capped here: the set may hold older keys beyond `CREDITED_RUNS_MAX` while claims are out
  // for them, and only MetaProgress knows which (`trimCreditedRuns`, applied as the set is written).
  if (Array.isArray(o.creditedRuns)) {
    for (const k of o.creditedRuns as unknown[]) if (isRunKey(k) && !d.creditedRuns.includes(k)) d.creditedRuns.push(k);
  }
  return d;
}

/**
 * The device save as a versioned value (./versionedStore.ts, docs/adr/0001): older shapes are
 * migrated step by step; a newer build's save is read as far as `sanitizeV1` understands it and is
 * never written by this build. A read also says whether the stored value had `creditedRuns` at all.
 */
interface StoredSave {
  data: SaveData;
  lostCreditedRuns: boolean;
}

export const SAVE_FORMAT: VersionedFormat<StoredSave, SaveData> = {
  key: SAVE_KEY,
  version: SAVE_VERSION,
  empty: () => ({ data: defaultSave(), lostCreditedRuns: false }),
  parse: (o) => ({ data: sanitizeV1(o), lostCreditedRuns: !Array.isArray(o.creditedRuns) }),
  migrations: {
    // Pre-versioning prototype shape: { fluff, upgrades, character, bestRadius }.
    0: (o) => ({
      fluff: o.fluff,
      upgrades: o.upgrades,
      lastCharacterId: o.lastCharacterId ?? o.character,
      settings: o.settings,
      stats: isObj(o.stats) ? o.stats : { bestRadius: o.bestRadius },
    }),
  },
  serialize: (data) => data,
};

const STATUS_OF: Record<Exclude<StoredFound, 'memory'>, SaveStatus> = { empty: 'empty', current: 'ok', migrated: 'migrated', newer: 'newer', corrupt: 'corrupt' };

export interface ParsedSave {
  data: SaveData;
  status: SaveStatus;
  /**
   * A readable save that has no `creditedRuns` field at all: a build from before the ledger wrote
   * it last (its sanitiser drops the field), or it is from before the ledger. `MetaProgress` tells
   * the two apart by its mirror (docs/adr/0003). False for an empty or corrupt value.
   */
  lostCreditedRuns: boolean;
}

export function parseSave(raw: string | null | undefined): ParsedSave {
  return fromRead(decodeVersioned(SAVE_FORMAT, raw));
}

function fromRead({ value, found }: { value: StoredSave; found: StoredFound }): ParsedSave {
  return { data: value.data, status: found === 'memory' ? 'ok' : STATUS_OF[found], lostCreditedRuns: value.lostCreditedRuns };
}

export function serializeSave(data: SaveData): string {
  return encodeVersioned(SAVE_FORMAT, data);
}

export type { KeyValueStorage, StoreStatus } from './versionedStore';

export function browserStorage(): KeyValueStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null; // e.g. storage disabled
  }
}

/** A `storage` event as SaveStore reads it (the browser's StorageEvent, or a fake in tests). */
export interface SaveStorageEvent {
  /** The changed key; null when another tab cleared the whole storage. */
  readonly key: string | null;
  readonly storageArea?: unknown;
}

/** Where other tabs' `storage` events arrive (`window` in the browser). */
export interface StorageEventSource {
  addEventListener(type: 'storage', listener: (e: SaveStorageEvent) => void): void;
  removeEventListener(type: 'storage', listener: (e: SaveStorageEvent) => void): void;
}

/** `window`, when there is one (null in node tests and the sim). */
export function browserStorageEvents(): StorageEventSource | null {
  return typeof window !== 'undefined' && typeof window.addEventListener === 'function' ? window : null;
}

/**
 * The save, shared with every other tab of the game on the same storage. Each write starts from
 * what is stored (`update` re-reads it first), so a change from another tab is built on rather
 * than overwritten, and with `events` another tab's write is picked up as it happens (listeners
 * are notified, as for a local change).
 *
 * A save written by a newer build (an old tab still open after a deploy) is read as far as this
 * build understands it and never written (docs/adr/0001): `update`, `updateIf` and `save` refuse,
 * leave `data` and the stored value as they are, and `writeStatus` says `newer`. Nothing this page
 * does is saved until it runs the newer build; the UI says so (src/ui/saveNotice.ts).
 */
export class SaveStore {
  data: SaveData;
  /** How the save read at load (a later unreadable value from another tab is backed up the same way). */
  readonly status: SaveStatus;
  private listeners = new Set<(data: SaveData) => void>();
  /** The stored value `data` was last read from or written as (undefined: never read). */
  private raw: string | null | undefined;
  /** Whether writes reach storage, as of the last read or write. */
  private writable: StoreStatus;
  private readonly slot: VersionedStore<StoredSave, SaveData>;
  private readonly offEvents: () => void = () => undefined;

  /**
   * `repair`: run on every value read from storage (at load and when another tab wrote), before it
   * becomes `data`: puts back what a write by another build may have dropped (MetaProgress uses it
   * for `creditedRuns`, told by `lostCreditedRuns` whether the stored value had the field). It
   * changes `data` in memory; the next write persists it.
   */
  constructor(
    private readonly storage: KeyValueStorage | null,
    readonly key = SAVE_KEY,
    events: StorageEventSource | null = null,
    private readonly repair: ((data: SaveData, read: Pick<ParsedSave, 'status' | 'lostCreditedRuns'>) => void) | null = null,
  ) {
    // `data` is this page's copy, so a refused write needs no second copy in the slot's memory.
    this.slot = new VersionedStore(storage, { ...SAVE_FORMAT, key }, { memory: false });
    const read = this.slot.read();
    this.writable = read.status;
    const { data, status } = read.raw === undefined ? parseSave(null) : this.load(read);
    this.data = data;
    this.status = status;
    if (events) {
      const onStorage = (e: SaveStorageEvent) => {
        if (e.key !== null && e.key !== this.key) return;
        if (e.storageArea != null && e.storageArea !== this.storage) return;
        if (this.refresh()) this.notify();
      };
      events.addEventListener('storage', onStorage);
      this.offEvents = () => events.removeEventListener('storage', onStorage);
    }
  }

  /** Whether this page's changes reach storage: `newer` while a newer build's save is stored (never written here). */
  get writeStatus(): StoreStatus {
    return this.writable;
  }

  /** Parses a stored value, backing a corrupt one up to `<key>:corrupt` (it is overwritten on the next save). */
  private load(read: Reading<StoredSave>): ParsedSave {
    this.raw = read.raw;
    const parsed = fromRead(read);
    if (parsed.status === 'corrupt' && read.raw != null) {
      try {
        this.storage?.setItem(`${this.key}:corrupt`, read.raw);
      } catch {
        /* ignore */
      }
    }
    this.repair?.(parsed.data, parsed);
    return parsed;
  }

  /**
   * Re-reads `data` if the stored value changed since this store last read or wrote it (another
   * tab wrote). Unreadable storage, or a write of ours that failed, keeps `data`. True if replaced.
   */
  refresh(): boolean {
    const read = this.slot.read();
    this.writable = read.status;
    if (read.raw === undefined || read.raw === this.raw) return false;
    this.data = this.load(read).data;
    return true;
  }

  /**
   * Writes `data` to storage. Anything but `ok` wrote nothing: storage is unavailable or full
   * (`unavailable`), or holds a newer build's save (`newer`, left byte for byte as it is).
   */
  save(): StoreStatus {
    const raw = serializeSave(this.data);
    this.writable = this.slot.write(this.data);
    if (this.writable === 'ok') this.raw = raw;
    return this.writable;
  }

  /**
   * Mutate the latest stored data, persist and notify listeners. While a newer build's save is
   * stored, `fn` doesn't run and nothing changes. Returns where the change went (`writeStatus`).
   */
  update(fn: (data: SaveData) => void): StoreStatus {
    this.updateIf((d) => {
      fn(d);
      return true;
    });
    return this.writable;
  }

  /**
   * Like `update`, but only writes and notifies when `fn` returns true: put checks (can this be
   * afforded?) inside `fn`, so they see another tab's changes. Returns what `fn` returned (false,
   * without running it, while a newer build's save is stored).
   */
  updateIf(fn: (data: SaveData) => boolean): boolean {
    const refreshed = this.refresh();
    if (this.writable === 'newer') {
      if (refreshed) this.notify();
      return false;
    }
    const changed = fn(this.data);
    if (changed) this.save();
    if (changed || refreshed) this.notify();
    return changed;
  }

  onChange(cb: (data: SaveData) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** Stops following other tabs. */
  dispose(): void {
    this.offEvents();
  }

  private notify(): void {
    for (const l of this.listeners) l(this.data);
  }
}
