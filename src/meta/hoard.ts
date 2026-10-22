/**
 * Pure helpers for a Character's Hoard (Keepsake counts by "type:rarity") and Loadouts, shared by
 * the save (sanitising), MetaProgress (felting, shedding, drops) and the UI.
 */
import {
  getKeepsakeType,
  hoardKey,
  HOARD_STACK_MAX,
  isLoadoutFor,
  keepsakeTypesFor,
  LOADOUT_SLOTS,
  MAX_RARITY,
  parseHoardKey,
  refFromStored,
  type KeepsakeRef,
  type Loadout,
} from '../data/keepsakes';

/** One Character's Keepsakes in the save. */
export interface CharacterHoard {
  /** "type:rarity" ("thick_clog:epic") → count (1–99; empty cells are left out). */
  hoard: Record<string, number>;
  /** Ids of the bosses this Character has absorbed (sets the Felting ceiling and first kills). */
  bossesBeaten: string[];
}

export const emptyCharacterHoard = (): CharacterHoard => ({ hoard: {}, bossesBeaten: [] });

/** Most boss ids kept per Character (more than the game will ever have). */
export const MAX_BOSSES_BEATEN = 32;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** True for a Character that has Keepsake types. */
export const hasKeepsakes = (characterId: string): boolean => keepsakeTypesFor(characterId).length > 0;

/** Count of one Keepsake in a Hoard. */
export function countOf(h: CharacterHoard | undefined, ref: KeepsakeRef): number {
  return h?.hoard[hoardKey(ref)] ?? 0;
}

/** Adds `n` (may be negative) to a cell, bounded to 0..99. Returns the change actually applied. */
export function addToHoard(h: CharacterHoard, ref: KeepsakeRef, n: number): number {
  const key = hoardKey(ref);
  const before = h.hoard[key] ?? 0;
  const after = Math.max(0, Math.min(HOARD_STACK_MAX, before + n));
  if (after > 0) h.hoard[key] = after;
  else delete h.hoard[key];
  return after - before;
}

/** Every non-empty cell of a Hoard, by type order then rarity. */
export function hoardEntries(characterId: string, h: CharacterHoard | undefined): Array<KeepsakeRef & { count: number }> {
  const out: Array<KeepsakeRef & { count: number }> = [];
  if (!h) return out;
  for (const t of keepsakeTypesFor(characterId)) {
    for (let g = 1; g <= MAX_RARITY; g++) {
      const count = h.hoard[hoardKey({ type: t.id, rarity: g })] ?? 0;
      if (count > 0) out.push({ type: t.id, rarity: g, count });
    }
  }
  return out;
}

/**
 * Keeps the Loadout slots the Hoard can still fill (two slots of the same Keepsake need two of
 * it), in order. Drops anything that isn't the Character's or is malformed.
 */
export function repairLoadout(characterId: string, loadout: readonly unknown[] | undefined, h: CharacterHoard | undefined): KeepsakeRef[] {
  const out: KeepsakeRef[] = [];
  if (!Array.isArray(loadout)) return out;
  const used = new Map<string, number>();
  for (const k of loadout) {
    if (out.length >= LOADOUT_SLOTS || !isObj(k)) continue;
    const ref = refFromStored(k);
    if (!ref || !isLoadoutFor(characterId, [ref])) continue;
    const key = hoardKey(ref);
    const n = (used.get(key) ?? 0) + 1;
    if (countOf(h, ref) < n) continue;
    used.set(key, n);
    out.push({ type: ref.type, rarity: ref.rarity });
  }
  return out;
}

/** Sanitises one Character's stored Hoard (never throws). Keys from before rarities are converted, their counts added up. */
export function sanitizeCharacterHoard(characterId: string, raw: unknown): CharacterHoard {
  const out = emptyCharacterHoard();
  if (!isObj(raw)) return out;
  if (isObj(raw.hoard)) {
    for (const [key, n] of Object.entries(raw.hoard)) {
      const ref = parseHoardKey(key, true);
      if (!ref || getKeepsakeType(ref.type)?.characterId !== characterId) continue;
      if (typeof n !== 'number' || !Number.isFinite(n)) continue;
      const k = hoardKey(ref);
      const c = Math.min(HOARD_STACK_MAX, (out.hoard[k] ?? 0) + Math.floor(n));
      if (c > 0) out.hoard[k] = c;
    }
  }
  if (Array.isArray(raw.bossesBeaten)) {
    for (const b of raw.bossesBeaten) {
      if (typeof b === 'string' && /^[a-z][a-z0-9_]{0,39}$/.test(b) && !out.bossesBeaten.includes(b) && out.bossesBeaten.length < MAX_BOSSES_BEATEN) out.bossesBeaten.push(b);
    }
  }
  return out;
}

/** Same Keepsakes in the same slots. */
export function sameLoadout(a: Loadout | undefined, b: Loadout | undefined): boolean {
  const x = a ?? [];
  const y = b ?? [];
  return x.length === y.length && x.every((k, i) => k.type === y[i]!.type && k.rarity === y[i]!.rarity);
}
