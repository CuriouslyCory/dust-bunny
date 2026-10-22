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

/** Grades 1..KEEPSAKE_MAX_GRADE (mirrors MAX_GRADE). */
export const KEEPSAKE_MAX_GRADE = 10;
/** Most Keepsakes of one type and grade a Hoard holds (mirrors HOARD_STACK_MAX). */
export const KEEPSAKE_STACK_MAX = 99;
/** Keepsake slots in a Loadout (mirrors LOADOUT_SLOTS). */
export const KEEPSAKE_LOADOUT_SLOTS = 2;

export interface SharedKeepsakeRef {
  type: string;
  grade: number;
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

export function isKeepsakeGrade(grade: unknown): grade is number {
  return typeof grade === 'number' && Number.isInteger(grade) && grade >= 1 && grade <= KEEPSAKE_MAX_GRADE;
}

/**
 * Validates an untrusted Loadout for a Character: an array of 0–2 `{ type, grade }` with the
 * Character's own types (duplicates allowed) and grades 1–10. Returns a clean copy or null.
 */
export function parseLoadout(characterId: string, raw: unknown): SharedKeepsakeRef[] | null {
  if (!Array.isArray(raw) || raw.length > KEEPSAKE_LOADOUT_SLOTS) return null;
  const out: SharedKeepsakeRef[] = [];
  for (const k of raw) {
    if (!isObj(k) || !isKeepsakeTypeFor(characterId, k.type) || !isKeepsakeGrade(k.grade)) return null;
    out.push({ type: k.type, grade: k.grade });
  }
  return out;
}

/** Parses a Hoard key ("thick_clog:2") for a Character, or null. */
export function parseSharedHoardKey(characterId: string, key: string): SharedKeepsakeRef | null {
  const i = key.lastIndexOf(':');
  if (i <= 0) return null;
  const type = key.slice(0, i);
  const grade = Number(key.slice(i + 1));
  return isKeepsakeTypeFor(characterId, type) && isKeepsakeGrade(grade) && key.slice(i + 1) === String(grade) ? { type, grade } : null;
}
