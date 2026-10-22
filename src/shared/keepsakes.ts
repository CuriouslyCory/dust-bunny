/**
 * Keepsake ids and bounds shared by the client and the Vercel functions (cloud save Hoards,
 * leaderboard Loadouts). Mirrored from `src/data/keepsakes.ts`; `keepsakes.test.ts` asserts the
 * mirror matches. Pure and dependency-free (see the note in `./score.ts`).
 */

/** Keepsake type ids per Character, mirrored from KEEPSAKE_TYPES (test-synced). */
export const SHARED_KEEPSAKE_TYPES: Readonly<Record<string, readonly string[]>> = {
  lint: ['long_strand', 'quick_shed', 'thick_clog', 'dinner_bell', 'reclaim'],
  tumble: ['loose_roots', 'bristle_back', 'snowball', 'dead_weight', 'thick_undercoat'],
  zap: ['live_wire', 'long_reach', 'arc', 'static_cling', 'grounding'],
};

/** Rarities 1..KEEPSAKE_MAX_RARITY (mirrors MAX_RARITY). */
export const KEEPSAKE_MAX_RARITY = 5;
/** Rarity ids in order, common = 1 (mirrors RARITIES[].id). Hoard keys use these ("thick_clog:epic"). */
export const KEEPSAKE_RARITY_IDS: readonly string[] = ['common', 'rare', 'epic', 'legendary', 'mythic'];
/** Most Keepsakes of one type and rarity a Hoard holds (mirrors HOARD_STACK_MAX). */
export const KEEPSAKE_STACK_MAX = 99;
/** Keepsake slots in a Loadout (mirrors LOADOUT_SLOTS). */
export const KEEPSAKE_LOADOUT_SLOTS = 2;

export interface SharedKeepsakeRef {
  type: string;
  rarity: number;
}

/** The Character's mirrored type ids (undefined for an unknown Character). */
export function keepsakeTypesForCharacter(characterId: string): readonly string[] | undefined {
  return Object.prototype.hasOwnProperty.call(SHARED_KEEPSAKE_TYPES, characterId) ? SHARED_KEEPSAKE_TYPES[characterId] : undefined;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** True if `type` is one of the Character's own Keepsake types. */
export function isKeepsakeTypeFor(characterId: string, type: unknown): type is string {
  return typeof type === 'string' && (keepsakeTypesForCharacter(characterId)?.includes(type) ?? false);
}

export function isKeepsakeRarity(rarity: unknown): rarity is number {
  return typeof rarity === 'number' && Number.isInteger(rarity) && rarity >= 1 && rarity <= KEEPSAKE_MAX_RARITY;
}

/**
 * A grade 1–10 from before rarities as a rarity (1–2 common … 9–10 mythic), or null. Mirrors
 * `rarityFromLegacyGrade`; old leaderboard rows, cloud saves and cached clients still send grades.
 */
export function rarityFromGrade(grade: unknown): number | null {
  return typeof grade === 'number' && Number.isInteger(grade) && grade >= 1 && grade <= 10 ? Math.ceil(grade / 2) : null;
}

/**
 * Validates an untrusted Loadout for a Character: an array of 0–2 `{ type, rarity }` with the
 * Character's own types (duplicates allowed) and rarities 1–5. A slot from an older client,
 * `{ type, grade }` (1–10), is converted. Returns a clean copy or null.
 */
export function parseLoadout(characterId: string, raw: unknown): SharedKeepsakeRef[] | null {
  if (!Array.isArray(raw) || raw.length > KEEPSAKE_LOADOUT_SLOTS) return null;
  const out: SharedKeepsakeRef[] = [];
  for (const k of raw) {
    if (!isObj(k) || !isKeepsakeTypeFor(characterId, k.type)) return null;
    const rarity = k.rarity !== undefined ? (isKeepsakeRarity(k.rarity) ? k.rarity : null) : rarityFromGrade(k.grade);
    if (rarity === null) return null;
    out.push({ type: k.type, rarity });
  }
  return out;
}

/** Hoard key for a type and rarity ("thick_clog:epic"). */
export function sharedHoardKey(ref: SharedKeepsakeRef): string {
  return `${ref.type}:${KEEPSAKE_RARITY_IDS[ref.rarity - 1]}`;
}

/**
 * Parses a Hoard key ("thick_clog:epic") for a Character, or null. A key from before rarities
 * ("thick_clog:6") is converted; callers re-key with `sharedHoardKey` and add counts together.
 */
export function parseSharedHoardKey(characterId: string, key: string): SharedKeepsakeRef | null {
  const i = key.lastIndexOf(':');
  if (i <= 0) return null;
  const type = key.slice(0, i);
  const r = key.slice(i + 1);
  if (!isKeepsakeTypeFor(characterId, type)) return null;
  const id = KEEPSAKE_RARITY_IDS.indexOf(r);
  if (id >= 0) return { type, rarity: id + 1 };
  const grade = Number(r);
  const rarity = /^\d+$/.test(r) && String(grade) === r ? rarityFromGrade(grade) : null;
  return rarity === null ? null : { type, rarity };
}
