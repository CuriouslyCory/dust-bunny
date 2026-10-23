/**
 * Leaderboard contract shared by the client (`src/net/leaderboard.ts`) and the Vercel
 * function (`api/leaderboard.ts`): types, name sanitising and submission validation.
 * Pure and dependency-free (see the note in `./score.ts` about imports).
 *
 * Boards: the Run board ('run', whole Runs) and one Area board per Area ('house',
 * 'neighborhood', 'city', 'region', 'continent', 'globe', 'solar_system', 'galaxy', 'universe'), which takes an entry each time a Run clears that Area.
 */
import { DEFAULT_DIFFICULTY, DIFFICULTY_IDS, isDifficultyId, type DifficultyId } from './difficulty.js';
import { parseLoadout, type SharedKeepsakeRef } from './keepsakes.js';
import {
  AREA_CLEAR_RADIUS,
  computeAreaScore,
  computeScore,
  isScoreArea,
  progressRadius,
  SCORE_AREA_UNIT,
  SCORE_AREAS,
  SCORE_ARRIVAL_RADIUS,
  SCORE_MAX_TIER,
  SCORE_TIER_MIN_RADII,
  scoreTierForRadius,
  type ScoreArea,
} from './score.js';

export const BOARD_IDS = ['run', ...SCORE_AREAS] as const;
export type BoardId = (typeof BOARD_IDS)[number];
export type AreaBoardId = ScoreArea;

export function isBoardId(v: unknown): v is BoardId {
  return typeof v === 'string' && (BOARD_IDS as readonly string[]).includes(v);
}
export const isAreaBoardId = isScoreArea;

/** Character ids accepted by the API, mirrored from `src/data/characters.ts` (test-synced). */
export const LEADERBOARD_CHARACTERS = ['lint', 'tumble', 'zap'] as const;
export type LeaderboardCharacter = (typeof LEADERBOARD_CHARACTERS)[number];

export const LEADERBOARD_SIZE = 20;
export const NAME_MAX_LENGTH = 16;
/** Replacement name when the profanity filter trips. */
export const FALLBACK_NAME = 'Anonymous Bunny';

/** Plausibility bounds. Generous on purpose: they reject impossible runs, not good ones. */
export const BOUNDS = {
  /**
   * Run board: real cm, up to 10× the last Tier's threshold (300 Mly). Area boards: the Area's unit
   * (a Region radius of 4 is 40 m), each further capped by AREA_RADIUS.
   */
  maxRadius: { min: 0.2, max: SCORE_TIER_MIN_RADII[SCORE_TIER_MIN_RADII.length - 1]! * 10 },
  debrisAbsorbed: { min: 0, max: 200_000 },
  durationMs: { min: 1_000, max: 4 * 60 * 60 * 1000 },
  /** Largest plausible starting radius (Tumble 1.2 cm × Head Start upgrades, with headroom). */
  maxStartRadius: 2.5,
  /**
   * Fastest plausible sustained growth on the Run board's progress scale (progressRadius) per
   * simulated second. 2 until the Continent: each Act after the City adds ≈ 350 on the scale in a
   * few minutes, and a max-Loadout Zap won at 62 km in 15:30 (`pnpm sim --validate
   * --loadout=max`: 104% of 2/s). The leap into the Continent adds at most the Region band up to
   * 50 m, which the time it takes to get there covers many times over. The Galaxy adds up to ≈ 600
   * more in 2–4 minutes, and a perk-loaded Zap won in 23:21 at 104% of 2.5/s (`pnpm sim --seeds=6
   * --minutes=80 --validate`), so it was 2.8. The Universe adds up to ≈ 420 more (100 per unit to
   * Tier 21, 10 per unit past it), and with the faster magnet a max-Loadout Zap won in 22:36 at 100%
   * of 2.8/s (`pnpm sim --seeds=4 --minutes=90 --chars=zap --loadout=max --validate`), so it is 3.2.
   */
  maxGrowthPerSec: 3.2,
  /** Fastest plausible absorb rate, Debris per simulated second. */
  maxDebrisPerSec: 60,
  /** Area boards: headroom on the entry radius for one-off jumps such as absorbing the boss. */
  areaEntryGrowth: 1.6,
  /**
   * Area boards: fastest plausible growth per simulated second in each Area. The City is built at
   * about 10× the House's scale and a Bunny there grows 3–4 cm/s for minutes at a time, so
   * maxGrowthPerSec alone rejected real City clears (`pnpm sim --validate`: up to 116% of the old
   * allowance). Its rate is 5 cm/s; the House and Neighborhood keep maxGrowthPerSec. Rates and
   * slack are in each Area's unit: the Region's are 10 m units (0.05 units/s = 50 cm/s), the
   * Continent's 10 km units. The Continent repeats the Region's 0.85 → 3 → boss curve, but its
   * placeholder content let a max-Loadout Zap clear it 0.85 → 6.2 units in 96 s (99% of 0.05/s),
   * so it allows 0.08 until the Continent content is tuned. The Globe (1,000 km units) repeats the
   * Continent's curve and allows the same, and so does the Solar System (0.01 AU units). The
   * Galaxy (100 ly units) allows 0.1: a perk-loaded Zap clears it 0.85 → 5.8–7.1 units in 52–62 s
   * (`pnpm sim --seeds=3 --minutes=80 --validate`: 103–111% of 0.08/s, Sagittarius A*'s mass
   * landing at the end of a short Act). The Universe (10 Mly units) repeats the Galaxy's curve with
   * more growth (0.32), and the Expansion fight feeds it whole filaments: perk-loaded Zap Runs
   * reached 13.9–14.6 units 93–94 s after arriving (`pnpm sim --seeds=4 --minutes=90 --validate`),
   * and a max-Loadout Zap peaked at 98% of 0.2, so it allows 0.25.
   */
  areaGrowthPerSec: { house: 2, neighborhood: 2, city: 5, region: 0.05, continent: 0.08, globe: 0.08, solar_system: 0.08, galaxy: 0.1, universe: 0.25 },
  /** Area boards: flat slack on top of the entry radius, in the Area's unit. */
  areaSlack: { house: 10, neighborhood: 10, city: 10, region: 0.1, continent: 0.1, globe: 0.1, solar_system: 0.1, galaxy: 0.1, universe: 0.1 },
  /** A victory needs at least this Tier (the City's boss Tier: clients from before the Region won there). */
  victoryMinTier: 9,
  /** Run board `universes` (Universe victories so far); a victory counts itself, so it needs at least 1. */
  universes: { min: 0, max: 100_000 },
} as const;

/** Largest maxRadius an Area board entry may claim after `sec` seconds in the Area from `radiusIn` (the Area's unit). */
export function areaRadiusAllowed(area: ScoreArea, radiusIn: number, sec: number): number {
  return radiusIn * BOUNDS.areaEntryGrowth + BOUNDS.areaSlack[area] + BOUNDS.areaGrowthPerSec[area] * sec;
}

/** Largest Run board maxRadius (real cm) whose progressRadius fits `sec` seconds. */
export function runRadiusAllowed(sec: number): number {
  return BOUNDS.maxStartRadius + BOUNDS.maxGrowthPerSec * sec;
}

/** The Keepsakes tucked in for a Run (0–2 of the Character's own types, rarities 1–5). */
export type LeaderboardLoadout = SharedKeepsakeRef[];

/** What the client POSTs to `/api/leaderboard`. */
export interface ScoreSubmission {
  name: string;
  character: string;
  maxRadius: number;
  debrisAbsorbed: number;
  tierReached: number;
  durationMs: number;
  victory: boolean;
  /** Difficulty id; optional for older clients (missing counts as casual). */
  difficulty?: string;
  score: number;
  /** Client-generated id of the Run; a second post with the same id returns the first entry. */
  runId?: string;
  /** Keepsakes tucked in; optional for older clients (missing: unknown, stored as NULL). */
  loadout?: LeaderboardLoadout;
  /**
   * Universes the player has ended, this Run included (a victory counts itself, so ≥ 1).
   * Optional for clients from before Act 9 (missing or null: stored as NULL).
   */
  universes?: number;
}

/** What the client POSTs to `/api/leaderboard?board=<area>` when a Run clears an Area. */
export interface AreaScoreSubmission {
  name: string;
  character: string;
  area: string;
  radiusIn: number;
  maxRadius: number;
  debrisAbsorbed: number;
  durationMs: number;
  difficulty?: string;
  score: number;
  runId?: string;
  loadout?: LeaderboardLoadout;
}

/** A row as returned by `GET /api/leaderboard` (and stored by the local fallback). */
export interface LeaderboardEntry {
  id: string;
  name: string;
  character: LeaderboardCharacter;
  score: number;
  maxRadius: number;
  debrisAbsorbed: number;
  tierReached: number;
  durationMs: number;
  victory: boolean;
  difficulty: DifficultyId;
  /** Submitted by a signed-in player. False for anonymous entries and the local fallback board. */
  verified: boolean;
  /** Keepsakes tucked in for the Run (missing on entries from older clients). */
  loadout?: LeaderboardLoadout;
  /** Universes the player had ended when posting (missing on entries from older clients). */
  universes?: number;
  /** ISO timestamp. */
  createdAt: string;
}

/** A row on an Area board. `durationMs` is the time spent in the Area. */
export interface AreaLeaderboardEntry {
  id: string;
  name: string;
  character: LeaderboardCharacter;
  area: AreaBoardId;
  score: number;
  radiusIn: number;
  maxRadius: number;
  debrisAbsorbed: number;
  durationMs: number;
  difficulty: DifficultyId;
  verified: boolean;
  loadout?: LeaderboardLoadout;
  createdAt: string;
}

export type AnyLeaderboardEntry = LeaderboardEntry | AreaLeaderboardEntry;

export interface ValidSubmission extends Omit<ScoreSubmission, 'character' | 'difficulty'> {
  character: LeaderboardCharacter;
  difficulty: DifficultyId;
  /** True if the name was replaced by the profanity filter. */
  nameCensored: boolean;
}

export interface ValidAreaSubmission extends Omit<AreaScoreSubmission, 'character' | 'difficulty' | 'area'> {
  character: LeaderboardCharacter;
  area: AreaBoardId;
  difficulty: DifficultyId;
  nameCensored: boolean;
}

export type Validation<T> = { ok: true; value: T } | { ok: false; field: string; message: string };
export type ValidationResult = Validation<ValidSubmission>;
export type AreaValidationResult = Validation<ValidAreaSubmission>;

const RUN_ID = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * Radius bounds per Area, in the Area's unit: arriving needs the previous boss's smallest arrival
 * size (AREA_CLEAR_RADIUS: 26.1, 137.3, 518.7 cm = 0.5187 Region units), or for an Area the Bunny leaps into, its
 * arrival radius (the Continent, the Globe, the Solar System, the Galaxy and the Universe: 0.85 units, the radius after the leap); the cap is two
 * Tiers above the Area's last Debris Tier (the Region and later Areas: 10× their last Tier), which no real
 * Run approaches.
 */
const AREA_RADIUS: Readonly<Record<AreaBoardId, { minIn: number; max: number }>> = {
  house: { minIn: BOUNDS.maxRadius.min, max: SCORE_TIER_MIN_RADII[6]! },
  neighborhood: { minIn: AREA_CLEAR_RADIUS.house, max: SCORE_TIER_MIN_RADII[8]! },
  city: { minIn: AREA_CLEAR_RADIUS.neighborhood, max: 3000 },
  region: { minIn: AREA_CLEAR_RADIUS.city / SCORE_AREA_UNIT.region, max: (SCORE_TIER_MIN_RADII[10]! * 10) / SCORE_AREA_UNIT.region },
  continent: { minIn: SCORE_ARRIVAL_RADIUS.continent, max: (SCORE_TIER_MIN_RADII[12]! * 10) / SCORE_AREA_UNIT.continent },
  globe: { minIn: SCORE_ARRIVAL_RADIUS.globe, max: (SCORE_TIER_MIN_RADII[14]! * 10) / SCORE_AREA_UNIT.globe },
  solar_system: { minIn: SCORE_ARRIVAL_RADIUS.solar_system, max: (SCORE_TIER_MIN_RADII[16]! * 10) / SCORE_AREA_UNIT.solar_system },
  galaxy: { minIn: SCORE_ARRIVAL_RADIUS.galaxy, max: (SCORE_TIER_MIN_RADII[18]! * 10) / SCORE_AREA_UNIT.galaxy },
  universe: { minIn: SCORE_ARRIVAL_RADIUS.universe, max: (SCORE_TIER_MIN_RADII[20]! * 10) / SCORE_AREA_UNIT.universe },
};

export function isLeaderboardCharacter(id: unknown): id is LeaderboardCharacter {
  return typeof id === 'string' && (LEADERBOARD_CHARACTERS as readonly string[]).includes(id);
}

// ---------------------------------------------------------------------------------------
// Names

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '!': 'i', '3': 'e', '4': 'a', '@': 'a', '5': 's', $: 's', '7': 't', '8': 'b', '9': 'g' };
/** Matched anywhere in the letters-only name (with and without repeated letters collapsed). */
const BLOCKED_SUBSTRINGS = [
  'fuck', 'fuk', 'shit', 'cunt', 'nigger', 'nigga', 'faggot', 'whore', 'slut', 'bitch', 'rapist',
  'hitler', 'nazi', 'penis', 'vagina', 'dildo', 'wank', 'twat', 'kike', 'pussy', 'bastard',
];
/** Matched only as whole words (they occur inside innocent words). */
const BLOCKED_WORDS = new Set(['ass', 'fag', 'dick', 'cock', 'cum', 'tit', 'tits', 'rape', 'porn', 'sex', 'retard', 'chink', 'spic', 'jizz']);

const collapseRepeats = (s: string) => s.replace(/(.)\1+/g, '$1');

/** Light profanity check: catches common words and simple leetspeak, not determined abuse. */
export function containsProfanity(name: string): boolean {
  const lower = name.toLowerCase();
  const deLeet = [...lower].map((c) => LEET[c] ?? c).join('');
  const letters = deLeet.replace(/[^a-z]/g, '');
  const squashed = collapseRepeats(letters);
  if (BLOCKED_SUBSTRINGS.some((w) => letters.includes(w) || squashed.includes(collapseRepeats(w)))) return true;
  const words = deLeet.split(/[^a-z]+/).filter(Boolean);
  return words.some((w) => BLOCKED_WORDS.has(w) || BLOCKED_WORDS.has(collapseRepeats(w)));
}

/**
 * Normalises a player name: NFKC, strips control/invisible characters and anything other
 * than letters, digits, spaces and `_ - . ' ! ?`, collapses whitespace, trims and caps at
 * 16 characters. Returns '' if nothing usable remains.
 */
export function sanitizeName(raw: string): string {
  const cleaned = raw
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .replace(/[^\p{L}\p{M}\p{N} _\-.'!?]/gu, '')
    .replace(/ +/g, ' ')
    .trim();
  return [...cleaned].slice(0, NAME_MAX_LENGTH).join('').trim();
}

/** Sanitises and applies the profanity filter. */
export function cleanName(raw: string): { name: string; censored: boolean } {
  const name = sanitizeName(raw);
  if (name && containsProfanity(name)) return { name: FALLBACK_NAME, censored: true };
  return { name, censored: false };
}

// ---------------------------------------------------------------------------------------
// Submissions

const fail = (field: string, message: string): { ok: false; field: string; message: string } => ({ ok: false, field, message });
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isInt = (v: unknown): v is number => isFiniteNumber(v) && Number.isInteger(v);

/** Checks shared by every board: body shape, name, Character, Difficulty and the optional Run id. */
function validateCommon(body: unknown) {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return fail('body', 'Expected a JSON object.');
  const b = body as Record<string, unknown>;

  if (typeof b.name !== 'string' || b.name.length > 64) return fail('name', 'Name must be a string of 1–16 characters.');
  const { name, censored } = cleanName(b.name);
  if (name.length < 1) return fail('name', 'Name must contain 1–16 letters or digits.');

  if (!isLeaderboardCharacter(b.character)) return fail('character', `Unknown character; expected one of ${LEADERBOARD_CHARACTERS.join(', ')}.`);

  const difficulty = b.difficulty === undefined ? DEFAULT_DIFFICULTY : b.difficulty;
  if (!isDifficultyId(difficulty)) return fail('difficulty', `Unknown difficulty; expected one of ${DIFFICULTY_IDS.join(', ')}.`);

  if (b.runId !== undefined && (typeof b.runId !== 'string' || !RUN_ID.test(b.runId))) return fail('runId', 'runId must be 8–64 letters, digits, - or _.');
  const runId = b.runId as string | undefined;

  let loadout: LeaderboardLoadout | undefined;
  if (b.loadout !== undefined) {
    const parsed = parseLoadout(b.character, b.loadout);
    if (!parsed) return fail('loadout', "loadout must hold up to 2 of the character's own Keepsakes, rarities 1–5.");
    loadout = parsed;
  }

  return { ok: true as const, b, name, censored, character: b.character, difficulty, ...(runId ? { runId } : {}), ...(loadout ? { loadout } : {}) };
}

/** Validates an untrusted Run board submission. Checks types, bounds, cross-field plausibility and the score. */
export function validateSubmission(body: unknown): ValidationResult {
  const c = validateCommon(body);
  if (!c.ok) return c;
  const { b, name, censored, difficulty } = c;

  const { maxRadius, debrisAbsorbed, tierReached, durationMs, victory, score } = b;
  if (!isFiniteNumber(maxRadius) || maxRadius < BOUNDS.maxRadius.min || maxRadius > BOUNDS.maxRadius.max)
    return fail('maxRadius', `maxRadius must be between ${BOUNDS.maxRadius.min} and ${BOUNDS.maxRadius.max}.`);
  if (!isInt(debrisAbsorbed) || debrisAbsorbed < BOUNDS.debrisAbsorbed.min || debrisAbsorbed > BOUNDS.debrisAbsorbed.max)
    return fail('debrisAbsorbed', `debrisAbsorbed must be an integer between 0 and ${BOUNDS.debrisAbsorbed.max}.`);
  if (!isInt(tierReached) || tierReached < 1 || tierReached > SCORE_MAX_TIER)
    return fail('tierReached', `tierReached must be an integer between 1 and ${SCORE_MAX_TIER}.`);
  if (!isInt(durationMs) || durationMs < BOUNDS.durationMs.min || durationMs > BOUNDS.durationMs.max)
    return fail('durationMs', `durationMs must be an integer between ${BOUNDS.durationMs.min} and ${BOUNDS.durationMs.max}.`);
  if (typeof victory !== 'boolean') return fail('victory', 'victory must be a boolean.');
  if (!isInt(score) || score < 0) return fail('score', 'score must be a non-negative integer.');

  // Cross-field plausibility. Tier is derived from radius (it may lag one tick behind).
  const radiusTier = scoreTierForRadius(maxRadius);
  if (tierReached > radiusTier || tierReached < radiusTier - 1)
    return fail('tierReached', 'tierReached does not match maxRadius.');
  if (victory && tierReached < BOUNDS.victoryMinTier) return fail('victory', `A victory requires Tier ${BOUNDS.victoryMinTier}.`);
  const universes = b.universes ?? undefined;
  if (universes !== undefined) {
    if (!isInt(universes) || universes < BOUNDS.universes.min || universes > BOUNDS.universes.max)
      return fail('universes', `universes must be an integer between ${BOUNDS.universes.min} and ${BOUNDS.universes.max}.`);
    if (victory && universes < 1) return fail('universes', 'A victory ends a Universe, so universes must be at least 1.');
  }
  const sec = durationMs / 1000;
  if (debrisAbsorbed === 0 && maxRadius > BOUNDS.maxStartRadius)
    return fail('maxRadius', 'Cannot grow without absorbing Debris.');
  if (progressRadius(maxRadius) > runRadiusAllowed(sec))
    return fail('maxRadius', 'maxRadius is too large for the run duration.');
  if (debrisAbsorbed > 50 + BOUNDS.maxDebrisPerSec * sec)
    return fail('debrisAbsorbed', 'debrisAbsorbed is too large for the run duration.');

  const expected = computeScore({ maxRadius, debrisAbsorbed, tierReached, durationMs, victory, difficulty });
  if (Math.abs(expected - score) > 1) return fail('score', 'score does not match the run stats.');

  return {
    ok: true,
    value: { name, nameCensored: censored, character: c.character, maxRadius, debrisAbsorbed, tierReached, durationMs, victory, difficulty, score: expected, ...(c.runId ? { runId: c.runId } : {}), ...(c.loadout ? { loadout: c.loadout } : {}), ...(universes !== undefined ? { universes } : {}) },
  };
}

/** Validates an untrusted Area board submission (a Run clearing one Area). */
export function validateAreaSubmission(body: unknown): AreaValidationResult {
  const c = validateCommon(body);
  if (!c.ok) return c;
  const { b, name, censored, difficulty } = c;

  if (!isScoreArea(b.area)) return fail('area', `Unknown area; expected one of ${SCORE_AREAS.join(', ')}.`);
  const area = b.area;
  const { radiusIn, maxRadius, debrisAbsorbed, durationMs, score } = b;
  const r = BOUNDS.maxRadius;
  if (!isFiniteNumber(radiusIn) || radiusIn < r.min || radiusIn > r.max) return fail('radiusIn', `radiusIn must be between ${r.min} and ${r.max}.`);
  if (!isFiniteNumber(maxRadius) || maxRadius < radiusIn || maxRadius > r.max) return fail('maxRadius', `maxRadius must be between radiusIn and ${r.max}.`);
  if (!isInt(debrisAbsorbed) || debrisAbsorbed < BOUNDS.debrisAbsorbed.min || debrisAbsorbed > BOUNDS.debrisAbsorbed.max)
    return fail('debrisAbsorbed', `debrisAbsorbed must be an integer between 0 and ${BOUNDS.debrisAbsorbed.max}.`);
  if (!isInt(durationMs) || durationMs < BOUNDS.durationMs.min || durationMs > BOUNDS.durationMs.max)
    return fail('durationMs', `durationMs must be an integer between ${BOUNDS.durationMs.min} and ${BOUNDS.durationMs.max}.`);
  if (!isInt(score) || score < 0) return fail('score', 'score must be a non-negative integer.');

  // A Run starts in the house, and an Area is cleared by beating its boss, which arrives at a set size.
  if (area === 'house' && radiusIn > BOUNDS.maxStartRadius) return fail('radiusIn', 'radiusIn is too large for the start of a Run.');
  // Later Areas open only after the previous boss, so the Bunny arrives at least at that boss's arrival size.
  if (radiusIn < AREA_RADIUS[area].minIn) return fail('radiusIn', `Reaching the ${area} needs a radius of ${AREA_RADIUS[area].minIn * SCORE_AREA_UNIT[area]} cm.`);
  if (maxRadius > AREA_RADIUS[area].max) return fail('maxRadius', `maxRadius is too large for the ${area}.`);
  if (maxRadius < AREA_CLEAR_RADIUS[area]) return fail('maxRadius', `Clearing the ${area} needs a radius of ${AREA_CLEAR_RADIUS[area] * SCORE_AREA_UNIT[area]} cm.`);
  const sec = durationMs / 1000;
  if (maxRadius > areaRadiusAllowed(area, radiusIn, sec)) return fail('maxRadius', 'maxRadius is too large for the time spent in the area.');
  if (debrisAbsorbed > 50 + BOUNDS.maxDebrisPerSec * sec) return fail('debrisAbsorbed', 'debrisAbsorbed is too large for the time spent in the area.');

  const expected = computeAreaScore({ area, radiusIn, maxRadius, debrisAbsorbed, durationMs, difficulty });
  if (Math.abs(expected - score) > 1) return fail('score', 'score does not match the area stats.');

  return {
    ok: true,
    value: { name, nameCensored: censored, character: c.character, area, radiusIn, maxRadius, debrisAbsorbed, durationMs, difficulty, score: expected, ...(c.runId ? { runId: c.runId } : {}), ...(c.loadout ? { loadout: c.loadout } : {}) },
  };
}

/** Sort order for leaderboards: score desc, then earlier submission first. */
export function compareEntries(a: { score: number; createdAt: string }, b: { score: number; createdAt: string }): number {
  return b.score - a.score || a.createdAt.localeCompare(b.createdAt);
}
