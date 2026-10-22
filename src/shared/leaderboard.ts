/**
 * Leaderboard contract shared by the client (`src/net/leaderboard.ts`) and the Vercel
 * function (`api/leaderboard.ts`): types, name sanitising and submission validation.
 * Pure and dependency-free (see the note in `./score.ts` about imports).
 *
 * Boards: the Run board ('run', whole Runs) and one Area board per Area ('house',
 * 'neighborhood', 'city'), which takes an entry each time a Run clears that Area.
 */
import { DEFAULT_DIFFICULTY, DIFFICULTY_IDS, isDifficultyId, type DifficultyId } from './difficulty.js';
import { parseLoadout, type SharedKeepsakeRef } from './keepsakes.js';
import {
  AREA_BOSS_TIER,
  computeAreaScore,
  computeScore,
  isScoreArea,
  SCORE_AREAS,
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
  maxRadius: { min: 0.2, max: 3000 },
  debrisAbsorbed: { min: 0, max: 200_000 },
  durationMs: { min: 1_000, max: 4 * 60 * 60 * 1000 },
  /** Largest plausible starting radius (Tumble 1.2 cm × Head Start upgrades, with headroom). */
  maxStartRadius: 2.5,
  /** Fastest plausible sustained growth, cm of radius per simulated second. */
  maxGrowthPerSec: 2,
  /** Fastest plausible absorb rate, Debris per simulated second. */
  maxDebrisPerSec: 60,
  /** Area boards: headroom on the entry radius for one-off jumps such as absorbing the boss. */
  areaEntryGrowth: 1.6,
  /**
   * Area boards: fastest plausible growth per simulated second in each Area. The City is built at
   * about 10× the House's scale and a Bunny there grows 3–4 cm/s for minutes at a time, so
   * maxGrowthPerSec alone rejected real City clears (`pnpm sim --validate`: up to 116% of the old
   * allowance). Its rate is 5 cm/s; the House and Neighborhood keep maxGrowthPerSec.
   */
  areaGrowthPerSec: { house: 2, neighborhood: 2, city: 5 },
} as const;

/** Largest maxRadius an Area board entry may claim after `sec` seconds in the Area from `radiusIn`. */
export function areaRadiusAllowed(area: ScoreArea, radiusIn: number, sec: number): number {
  return radiusIn * BOUNDS.areaEntryGrowth + 10 + BOUNDS.areaGrowthPerSec[area] * sec;
}

/** The Keepsakes tucked in for a Run (0–2 of the Character's own types, grades 1–10). */
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
 * Radius bounds per Area (cm): arriving needs the previous boss's Tier (Tier 5 = 45, Tier 7 = 160),
 * and the cap is two Tiers above the Area's last Debris Tier, which no real Run approaches.
 */
const AREA_RADIUS: Readonly<Record<AreaBoardId, { minIn: number; max: number }>> = {
  house: { minIn: BOUNDS.maxRadius.min, max: SCORE_TIER_MIN_RADII[6]! },
  neighborhood: { minIn: SCORE_TIER_MIN_RADII[4]!, max: SCORE_TIER_MIN_RADII[8]! },
  city: { minIn: SCORE_TIER_MIN_RADII[6]!, max: BOUNDS.maxRadius.max },
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
    if (!parsed) return fail('loadout', "loadout must hold up to 2 of the character's own Keepsakes, grades 1–10.");
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
  if (victory && tierReached < SCORE_MAX_TIER) return fail('victory', `A victory requires Tier ${SCORE_MAX_TIER}.`);
  const sec = durationMs / 1000;
  if (debrisAbsorbed === 0 && maxRadius > BOUNDS.maxStartRadius)
    return fail('maxRadius', 'Cannot grow without absorbing Debris.');
  if (maxRadius > BOUNDS.maxStartRadius + BOUNDS.maxGrowthPerSec * sec)
    return fail('maxRadius', 'maxRadius is too large for the run duration.');
  if (debrisAbsorbed > 50 + BOUNDS.maxDebrisPerSec * sec)
    return fail('debrisAbsorbed', 'debrisAbsorbed is too large for the run duration.');

  const expected = computeScore({ maxRadius, debrisAbsorbed, tierReached, durationMs, victory, difficulty });
  if (Math.abs(expected - score) > 1) return fail('score', 'score does not match the run stats.');

  return {
    ok: true,
    value: { name, nameCensored: censored, character: c.character, maxRadius, debrisAbsorbed, tierReached, durationMs, victory, difficulty, score: expected, ...(c.runId ? { runId: c.runId } : {}), ...(c.loadout ? { loadout: c.loadout } : {}) },
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

  // A Run starts in the house, and an Area is cleared by absorbing its boss, which arrives at a set Tier.
  if (area === 'house' && radiusIn > BOUNDS.maxStartRadius) return fail('radiusIn', 'radiusIn is too large for the start of a Run.');
  // Later Areas open only after the previous boss, so the Bunny arrives at least at that boss's Tier.
  if (radiusIn < AREA_RADIUS[area].minIn) return fail('radiusIn', `Reaching the ${area} needs a radius of ${AREA_RADIUS[area].minIn} cm.`);
  if (maxRadius > AREA_RADIUS[area].max) return fail('maxRadius', `maxRadius is too large for the ${area}.`);
  if (scoreTierForRadius(maxRadius) < AREA_BOSS_TIER[area]) return fail('maxRadius', `Clearing the ${area} needs Tier ${AREA_BOSS_TIER[area]}.`);
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
