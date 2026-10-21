/**
 * Versioned save data in localStorage under `dust-bunny:save:v1`.
 *
 * parseSave() never throws: unreadable JSON, wrong types or out-of-range numbers fall back to
 * defaults field by field, and an unversioned legacy object is migrated. When the stored value
 * is corrupt, SaveStore copies it to `<key>:corrupt` before overwriting it on the next save.
 *
 * To change the shape: bump SAVE_VERSION, keep the key, add a step to migrate(). Purely additive
 * fields with a sanitised default (like `lastDifficulty`) don't need a bump.
 */
import { DEFAULT_DIFFICULTY, isDifficultyId, type DifficultyId } from '../shared/difficulty';

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
}

export type SaveStatus = 'empty' | 'ok' | 'migrated' | 'corrupt';

export function defaultSave(): SaveData {
  return {
    version: SAVE_VERSION,
    fluff: 0,
    upgrades: {},
    lastCharacterId: null,
    lastDifficulty: DEFAULT_DIFFICULTY,
    settings: {},
    stats: { runs: 0, wins: 0, bestRadius: 0, bestTier: 0, totalFluffEarned: 0 },
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
  };
  return d;
}

/** Brings any known older shape up to the current version. */
export function migrate(o: Record<string, unknown>): { data: SaveData; migrated: boolean } {
  const version = typeof o.version === 'number' ? o.version : 0;
  if (version === 0) {
    // Pre-versioning prototype shape: { fluff, upgrades, character, bestRadius }.
    return {
      data: sanitizeV1({
        fluff: o.fluff,
        upgrades: o.upgrades,
        lastCharacterId: o.lastCharacterId ?? o.character,
        settings: o.settings,
        stats: isObj(o.stats) ? o.stats : { bestRadius: o.bestRadius },
      }),
      migrated: true,
    };
  }
  // v1, or a newer version written by a later build: read what we understand.
  return { data: sanitizeV1(o), migrated: version !== SAVE_VERSION };
}

export function parseSave(raw: string | null | undefined): { data: SaveData; status: SaveStatus } {
  if (raw == null || raw === '') return { data: defaultSave(), status: 'empty' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { data: defaultSave(), status: 'corrupt' };
  }
  if (!isObj(parsed)) return { data: defaultSave(), status: 'corrupt' };
  const { data, migrated } = migrate(parsed);
  return { data, status: migrated ? 'migrated' : 'ok' };
}

export function serializeSave(data: SaveData): string {
  return JSON.stringify(data);
}

/** The subset of Storage we use (inject a Map-backed one in tests). */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function browserStorage(): KeyValueStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null; // e.g. storage disabled
  }
}

export class SaveStore {
  data: SaveData;
  readonly status: SaveStatus;
  private listeners = new Set<(data: SaveData) => void>();

  constructor(
    private readonly storage: KeyValueStorage | null,
    readonly key = SAVE_KEY,
  ) {
    let raw: string | null = null;
    try {
      raw = storage?.getItem(key) ?? null;
    } catch {
      raw = null;
    }
    const { data, status } = parseSave(raw);
    this.data = data;
    this.status = status;
    if (status === 'corrupt' && raw != null) {
      try {
        storage?.setItem(`${key}:corrupt`, raw);
      } catch {
        /* ignore */
      }
    }
  }

  /** Writes to storage; returns false if storage is unavailable or full. */
  save(): boolean {
    try {
      if (!this.storage) return false;
      this.storage.setItem(this.key, serializeSave(this.data));
      return true;
    } catch {
      return false;
    }
  }

  /** Mutate, persist and notify listeners. */
  update(fn: (data: SaveData) => void): void {
    fn(this.data);
    this.save();
    for (const l of this.listeners) l(this.data);
  }

  onChange(cb: (data: SaveData) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
}
