/**
 * Leaderboard score formula, shared by the client (local leaderboard, preview) and the
 * server (`api/leaderboard.ts`), which recomputes it and rejects mismatches.
 *
 * Shared modules are imported by the Vercel function, which runs as native Node ESM:
 * keep them free of runtime imports from the rest of `src/`, and use `.js` extensions on
 * relative imports.
 */
import { DEFAULT_DIFFICULTY, DIFFICULTY_SCORE_MULTIPLIER, type DifficultyId } from './difficulty.js';

/** Tier start radii (cm), mirrored from `src/data/tiers.ts` (a test keeps them in sync). */
export const SCORE_TIER_MIN_RADII: readonly number[] = [1, 3, 8, 20, 45, 75, 160, 320, 600];
export const SCORE_MAX_TIER = SCORE_TIER_MIN_RADII.length;

export const SCORE = {
  /** Points per cm of max radius. */
  perRadiusCm: 100,
  perDebris: 2,
  /** Points per Tier above Tier 1. */
  perTier: 1000,
  victoryBonus: 5000,
  /** Victory only: points per second under `victoryParSec`. */
  victoryPerSecUnderPar: 10,
  victoryParSec: 2100,
} as const;

export interface ScoreInput {
  maxRadius: number;
  debrisAbsorbed: number;
  tierReached: number;
  durationMs: number;
  victory: boolean;
  /** Missing counts as casual (multiplier 1). */
  difficulty?: DifficultyId;
}

/**
 * base  = round(maxRadius × 100) + debrisAbsorbed × 2 + (tierReached − 1) × 1000
 *         + victory ? 5000 + round(max(0, 2100 − seconds) × 10) : 0
 * score = round(base × DIFFICULTY_SCORE_MULTIPLIER[difficulty])   (casual 1, arcade 1.25, hardcore 1.6)
 */
export function computeScore(s: ScoreInput): number {
  const radius = Math.max(0, s.maxRadius);
  const debris = Math.max(0, Math.floor(s.debrisAbsorbed));
  const tier = Math.min(Math.max(Math.floor(s.tierReached), 1), SCORE_MAX_TIER);
  let score = Math.round(radius * SCORE.perRadiusCm) + debris * SCORE.perDebris + (tier - 1) * SCORE.perTier;
  if (s.victory) {
    const sec = Math.max(0, s.durationMs) / 1000;
    score += SCORE.victoryBonus + Math.round(Math.max(0, SCORE.victoryParSec - sec) * SCORE.victoryPerSecUnderPar);
  }
  const mult = DIFFICULTY_SCORE_MULTIPLIER[s.difficulty ?? DEFAULT_DIFFICULTY] ?? 1;
  return Math.round(score * mult);
}

/** Tier index (1-based) for a radius; below the first threshold counts as Tier 1. */
export function scoreTierForRadius(radius: number): number {
  let t = 1;
  SCORE_TIER_MIN_RADII.forEach((min, i) => {
    if (radius >= min) t = i + 1;
  });
  return t;
}
