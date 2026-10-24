/**
 * Cloud save contract shared by the client (`src/meta/cloudSave.ts`) and `api/progress.ts`:
 * the part of the meta save that follows a signed-in player between devices (Fluff wallet,
 * Upgrade levels, each Character's Hoard of Keepsakes and bosses beaten, each Character's
 * remembered Loadout, lifetime stats). Settings, last Character and Difficulty stay per device.
 * Pure and dependency-free (see the note in `./score.ts`).
 *
 * Which copy wins: the one with more lifetime Fluff earned (`stats.totalFluffEarned` only ever
 * grows), then more Runs; on a tie the server copy wins on download and the upload wins on the
 * server (so spending Fluff, which changes neither counter, still syncs). Felting and shedding
 * Keepsakes change neither counter either: they sync like spending, and so does tucking in a
 * Loadout.
 *
 * `universes` (Universe victories) never goes down: both sides keep the larger of the two copies
 * (`mergeUniverses`), whichever copy wins otherwise.
 */
import { KEEPSAKE_STACK_MAX, keepsakeTypesForCharacter, parseLoadout, parseSharedHoardKey, sharedHoardKey, type SharedKeepsakeRef } from './keepsakes.js';
import { sameCreditedRuns, validateCreditedRuns } from './runCredit.js';
import { SCORE_TIER_MIN_RADII } from './score.js';

export interface ProgressStats {
  runs: number;
  wins: number;
  bestRadius: number;
  bestTier: number;
  totalFluffEarned: number;
  /** Keepsakes credited from boss kills (missing on older bundles: 0). */
  keepsakesEarned: number;
}

/** One Character's Keepsakes: Hoard counts by "type:rarity" ("thick_clog:epic", 1–99) and boss ids it has absorbed. */
export interface ProgressCharacter {
  hoard: Record<string, number>;
  bossesBeaten: string[];
}

export interface Progress {
  fluff: number;
  /** Upgrade id → owned level (levels ≥ 1 only). */
  upgrades: Record<string, number>;
  /** Character id → Hoard and bosses beaten (Characters with neither are left out). */
  characters: Record<string, ProgressCharacter>;
  /**
   * Character id → the Loadout last tucked in (Characters with an empty one are left out). Missing
   * (a bundle or stored row from before Loadouts synced) means unknown: the other copy's are kept.
   */
  loadouts?: Record<string, SharedKeepsakeRef[]>;
  stats: ProgressStats;
  /** Universe victories (missing on older bundles: 0, and the stored count is kept). */
  universes: number;
  /**
   * The newest Run keys whose credit this copy holds (docs/adr/0003; at most `CREDITED_RUNS_MAX`).
   * It travels with the Fluff it accounts for, so whichever copy wins a merge keeps the right set.
   * Missing (a bundle or stored row from before the ledger) means unknown: the other copy's is kept.
   */
  creditedRuns?: string[];
}

/** Generous sanity bounds: they stop garbage, not determined cheating (the game runs on the client). */
export const PROGRESS_BOUNDS = {
  fluff: 100_000_000,
  upgradeLevel: 100,
  upgradeCount: 64,
  count: 10_000_000,
  /** Real cm, same ceiling as a leaderboard Run's maxRadius (a Globe Run passes 6,000,000). */
  bestRadius: SCORE_TIER_MIN_RADII[SCORE_TIER_MIN_RADII.length - 1]! * 10,
  bestTier: 100,
  bossesBeaten: 32,
} as const;

const UPGRADE_ID = /^[a-z][a-z0-9_]{0,39}$/;
const BOSS_ID = UPGRADE_ID;

export type ProgressValidation = { ok: true; value: Progress } | { ok: false; field: string; message: string };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isCount = (v: unknown, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max;

type Fail = { ok: false; field: string; message: string };

/**
 * Validates the `characters` field. Missing (an older bundle) reads as `{}`; callers that must
 * tell the two apart (api/progress.ts keeps the stored Hoards) check the raw body. Hoard keys
 * from before rarities are converted (see `parseSharedHoardKey`).
 */
export function validateCharacters(raw: unknown): { ok: true; value: Record<string, ProgressCharacter> } | Fail {
  const fail = (field: string, message: string): Fail => ({ ok: false, field, message });
  if (raw === undefined) return { ok: true, value: {} };
  if (!isObj(raw)) return fail('characters', 'characters must be an object.');
  const out: Record<string, ProgressCharacter> = {};
  for (const [id, c] of Object.entries(raw)) {
    if (!keepsakeTypesForCharacter(id)) return fail('characters', `Unknown character "${id.slice(0, 40)}".`);
    if (!isObj(c) || !isObj(c.hoard) || !Array.isArray(c.bossesBeaten)) return fail(`characters.${id}`, 'Expected { hoard, bossesBeaten }.');
    const hoard: Record<string, number> = {};
    for (const [key, n] of Object.entries(c.hoard)) {
      const ref = parseSharedHoardKey(id, key);
      if (!ref) return fail(`characters.${id}.hoard`, `Invalid Keepsake "${key.slice(0, 40)}".`);
      if (!isCount(n, KEEPSAKE_STACK_MAX)) return fail(`characters.${id}.hoard`, `Invalid count for "${key}".`);
      // Keys from before rarities ("arc:6") become "arc:epic"; two old grades can share a rarity.
      const k = sharedHoardKey(ref);
      if (n > 0) hoard[k] = Math.min(KEEPSAKE_STACK_MAX, (hoard[k] ?? 0) + n);
    }
    if (c.bossesBeaten.length > PROGRESS_BOUNDS.bossesBeaten) return fail(`characters.${id}.bossesBeaten`, 'Too many bosses.');
    const bosses: string[] = [];
    for (const b of c.bossesBeaten) {
      if (typeof b !== 'string' || !BOSS_ID.test(b)) return fail(`characters.${id}.bossesBeaten`, 'Invalid boss id.');
      if (!bosses.includes(b)) bosses.push(b);
    }
    if (Object.keys(hoard).length || bosses.length) out[id] = { hoard, bossesBeaten: bosses };
  }
  return { ok: true, value: out };
}

/**
 * Validates the `loadouts` field: each Character's 0–2 own Keepsakes (`parseLoadout`; empty ones
 * are dropped). Missing stays undefined. The Hoard isn't checked: clients repair a Loadout against
 * it when they adopt one.
 */
export function validateLoadouts(raw: unknown): { ok: true; value: Record<string, SharedKeepsakeRef[]> | undefined } | Fail {
  if (raw === undefined) return { ok: true, value: undefined };
  if (!isObj(raw)) return { ok: false, field: 'loadouts', message: 'loadouts must be an object.' };
  const out: Record<string, SharedKeepsakeRef[]> = {};
  for (const [id, l] of Object.entries(raw)) {
    if (!keepsakeTypesForCharacter(id)) return { ok: false, field: 'loadouts', message: `Unknown character "${id.slice(0, 40)}".` };
    const loadout = parseLoadout(id, l);
    if (!loadout) return { ok: false, field: `loadouts.${id}`, message: 'Invalid Loadout.' };
    if (loadout.length) out[id] = loadout;
  }
  return { ok: true, value: out };
}

/** Validates an untrusted progress body (also used to read rows back from the database). */
export function validateProgress(body: unknown): ProgressValidation {
  const fail = (field: string, message: string): ProgressValidation => ({ ok: false, field, message });
  if (!isObj(body)) return fail('body', 'Expected a JSON object.');
  if (!isCount(body.fluff, PROGRESS_BOUNDS.fluff)) return fail('fluff', 'fluff must be a non-negative integer.');

  if (!isObj(body.upgrades)) return fail('upgrades', 'upgrades must be an object.');
  const entries = Object.entries(body.upgrades);
  if (entries.length > PROGRESS_BOUNDS.upgradeCount) return fail('upgrades', 'Too many upgrades.');
  const upgrades: Record<string, number> = {};
  for (const [id, level] of entries) {
    if (!UPGRADE_ID.test(id)) return fail('upgrades', `Invalid upgrade id "${id.slice(0, 40)}".`);
    if (!isCount(level, PROGRESS_BOUNDS.upgradeLevel)) return fail('upgrades', `Invalid level for "${id}".`);
    if (level > 0) upgrades[id] = level;
  }

  const s = body.stats;
  if (!isObj(s)) return fail('stats', 'stats must be an object.');
  const { runs, wins, bestRadius, bestTier, totalFluffEarned } = s;
  const keepsakesEarned = s.keepsakesEarned ?? 0;
  if (!isCount(runs, PROGRESS_BOUNDS.count)) return fail('stats.runs', 'runs must be a non-negative integer.');
  if (!isCount(wins, PROGRESS_BOUNDS.count) || wins > runs) return fail('stats.wins', 'wins must be an integer between 0 and runs.');
  if (typeof bestRadius !== 'number' || !Number.isFinite(bestRadius) || bestRadius < 0 || bestRadius > PROGRESS_BOUNDS.bestRadius)
    return fail('stats.bestRadius', 'bestRadius out of range.');
  if (!isCount(bestTier, PROGRESS_BOUNDS.bestTier)) return fail('stats.bestTier', 'bestTier out of range.');
  if (!isCount(totalFluffEarned, PROGRESS_BOUNDS.count * 100)) return fail('stats.totalFluffEarned', 'totalFluffEarned out of range.');

  if (!isCount(keepsakesEarned, PROGRESS_BOUNDS.count)) return fail('stats.keepsakesEarned', 'keepsakesEarned out of range.');

  const characters = validateCharacters(body.characters);
  if (!characters.ok) return characters;

  const loadouts = validateLoadouts(body.loadouts);
  if (!loadouts.ok) return loadouts;

  const universes = body.universes ?? 0;
  if (!isCount(universes, PROGRESS_BOUNDS.count)) return fail('universes', 'universes must be a non-negative integer.');

  const creditedRuns = validateCreditedRuns(body.creditedRuns);
  if (!creditedRuns.ok) return fail('creditedRuns', creditedRuns.message);

  const value: Progress = { fluff: body.fluff, upgrades, characters: characters.value, stats: { runs, wins, bestRadius, bestTier, totalFluffEarned, keepsakesEarned }, universes };
  if (loadouts.value) value.loadouts = loadouts.value;
  if (creditedRuns.value) value.creditedRuns = creditedRuns.value;
  return { ok: true, value };
}

/** Positive when `a` holds more progress than `b`, 0 on a tie. */
export function compareProgress(a: Progress, b: Progress): number {
  return a.stats.totalFluffEarned - b.stats.totalFluffEarned || a.stats.runs - b.stats.runs;
}

/** The Universes count after merging two copies: it only ever goes up. */
export function mergeUniverses(a: number | undefined, b: number | undefined): number {
  return Math.max(a ?? 0, b ?? 0);
}

/** True when the progress is a fresh, never-played save. */
export function isEmptyProgress(p: Progress): boolean {
  return (
    p.fluff === 0 &&
    p.stats.runs === 0 &&
    p.stats.totalFluffEarned === 0 &&
    (p.universes ?? 0) === 0 &&
    Object.keys(p.upgrades).length === 0 &&
    Object.keys(p.characters ?? {}).length === 0
  );
}

const sameCounts = (a: Record<string, number>, b: Record<string, number>): boolean => {
  const ka = Object.keys(a).filter((k) => a[k]! > 0);
  return ka.length === Object.keys(b).filter((k) => b[k]! > 0).length && ka.every((k) => a[k] === b[k]);
};

/** Deep equality of two `characters` fields (key order ignored; empty entries count as missing). */
export function sameCharacters(a: Record<string, ProgressCharacter> = {}, b: Record<string, ProgressCharacter> = {}): boolean {
  const empty: ProgressCharacter = { hoard: {}, bossesBeaten: [] };
  for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const ca = a[id] ?? empty;
    const cb = b[id] ?? empty;
    if (!sameCounts(ca.hoard, cb.hoard)) return false;
    if (ca.bossesBeaten.length !== cb.bossesBeaten.length || ca.bossesBeaten.some((x) => !cb.bossesBeaten.includes(x))) return false;
  }
  return true;
}

/** Same Loadouts for every Character (key order ignored; missing and empty count as none). */
export function sameLoadouts(a: Record<string, SharedKeepsakeRef[]> = {}, b: Record<string, SharedKeepsakeRef[]> = {}): boolean {
  for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[id] ?? [];
    const y = b[id] ?? [];
    if (x.length !== y.length || x.some((k, i) => k.type !== y[i]!.type || k.rarity !== y[i]!.rarity)) return false;
  }
  return true;
}

/** Deep equality for the synced fields (upgrade and Hoard key order ignored). */
export function sameProgress(a: Progress, b: Progress): boolean {
  const ka = Object.keys(a.upgrades);
  if (ka.length !== Object.keys(b.upgrades).length || ka.some((k) => a.upgrades[k] !== b.upgrades[k])) return false;
  if (!sameCharacters(a.characters, b.characters)) return false;
  if (!sameLoadouts(a.loadouts, b.loadouts)) return false;
  if (!sameCreditedRuns(a.creditedRuns, b.creditedRuns)) return false;
  const sa = a.stats;
  const sb = b.stats;
  return (
    a.fluff === b.fluff &&
    (a.universes ?? 0) === (b.universes ?? 0) &&
    sa.runs === sb.runs &&
    sa.wins === sb.wins &&
    sa.bestRadius === sb.bestRadius &&
    sa.bestTier === sb.bestTier &&
    sa.totalFluffEarned === sb.totalFluffEarned &&
    (sa.keepsakesEarned ?? 0) === (sb.keepsakesEarned ?? 0)
  );
}
