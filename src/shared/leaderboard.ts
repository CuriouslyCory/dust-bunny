/**
 * Leaderboard contract shared by the client (`src/net/leaderboard.ts`) and the Vercel
 * function (`api/leaderboard.ts`): types, name sanitising and submission validation.
 * Pure and dependency-free (see the note in `./score.ts` about imports).
 */
import { DEFAULT_DIFFICULTY, DIFFICULTY_IDS, isDifficultyId, type DifficultyId } from './difficulty.js';
import { computeScore, SCORE_MAX_TIER, scoreTierForRadius } from './score.js';

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
} as const;

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
  /** ISO timestamp. */
  createdAt: string;
}

export interface ValidSubmission extends Omit<ScoreSubmission, 'character' | 'difficulty'> {
  character: LeaderboardCharacter;
  difficulty: DifficultyId;
  /** True if the name was replaced by the profanity filter. */
  nameCensored: boolean;
}

export type ValidationResult = { ok: true; value: ValidSubmission } | { ok: false; field: string; message: string };

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

const fail = (field: string, message: string): ValidationResult => ({ ok: false, field, message });
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isInt = (v: unknown): v is number => isFiniteNumber(v) && Number.isInteger(v);

/** Validates an untrusted submission body. Checks types, bounds, cross-field plausibility and the score. */
export function validateSubmission(body: unknown): ValidationResult {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return fail('body', 'Expected a JSON object.');
  const b = body as Record<string, unknown>;

  if (typeof b.name !== 'string' || b.name.length > 64) return fail('name', 'Name must be a string of 1–16 characters.');
  const { name, censored } = cleanName(b.name);
  if (name.length < 1) return fail('name', 'Name must contain 1–16 letters or digits.');

  if (!isLeaderboardCharacter(b.character)) return fail('character', `Unknown character; expected one of ${LEADERBOARD_CHARACTERS.join(', ')}.`);

  const difficulty = b.difficulty === undefined ? DEFAULT_DIFFICULTY : b.difficulty;
  if (!isDifficultyId(difficulty)) return fail('difficulty', `Unknown difficulty; expected one of ${DIFFICULTY_IDS.join(', ')}.`);

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
    value: { name, nameCensored: censored, character: b.character, maxRadius, debrisAbsorbed, tierReached, durationMs, victory, difficulty, score: expected },
  };
}

/** Sort order for leaderboards: score desc, then earlier submission first. */
export function compareEntries(a: LeaderboardEntry, b: LeaderboardEntry): number {
  return b.score - a.score || a.createdAt.localeCompare(b.createdAt);
}
