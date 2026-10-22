/**
 * Leaderboard score formula, shared by the client (local leaderboard, preview) and the
 * server (`api/leaderboard.ts`), which recomputes it and rejects mismatches.
 *
 * Shared modules are imported by the Vercel function, which runs as native Node ESM:
 * keep them free of runtime imports from the rest of `src/`, and use `.js` extensions on
 * relative imports.
 */
import { DEFAULT_DIFFICULTY, DIFFICULTY_SCORE_MULTIPLIER, type DifficultyId } from './difficulty.js';

/** Tier start radii (real cm), mirrored from `src/data/tiers.ts` (a test keeps them in sync). */
export const SCORE_TIER_MIN_RADII: readonly number[] = [1, 3, 8, 20, 45, 75, 160, 320, 600, 1000, 3000, 1e6, 3e6];
export const SCORE_MAX_TIER = SCORE_TIER_MIN_RADII.length;

/**
 * Arrival radius (in the Area's unit) of the Areas the Bunny leaps into on entry, mirrored from
 * `AREAS[area].arrivalRadius` (test-synced): the Continent's 0.85 units (8.5 km).
 */
export const SCORE_ARRIVAL_RADIUS = { continent: 0.85 } as const;

/** The Continent's arrival radius in real cm (8.5 km): where the Run board's Continent band starts. */
const CONTINENT_ARRIVAL_CM = SCORE_ARRIVAL_RADIUS.continent * 1e6;

/**
 * The Run board's radius scale: each Act counts its growth in its own unit. Up to the City
 * (1 cm units) a centimetre is a centimetre; from `fromCm` on, a cm counts `perCm`, so one Region
 * unit (10 m) is worth 100 "cm" and so is one Continent unit (10 km). Later Acts add a band each,
 * keeping scores in plain float range.
 *
 * The size leap into the Continent (≈40 m → 8.5 km, docs/design.md) is not growth: the band from
 * 50 m (about the most a Region Bunny reaches; the Incinerator falls at ≈30–45 m) to the arrival
 * radius counts nothing, so arriving scores like a 50 m Region Bunny and only Continent growth
 * from 8.5 km adds.
 */
export const SCORE_RADIUS_BANDS: ReadonlyArray<{ fromCm: number; perCm: number }> = [
  { fromCm: 0, perCm: 1 },
  { fromCm: 1000, perCm: 0.1 },
  { fromCm: 5000, perCm: 0 },
  { fromCm: CONTINENT_ARRIVAL_CM, perCm: 1e-4 },
];

/** A real radius (cm) on the Run board's progress scale (see SCORE_RADIUS_BANDS). */
export function progressRadius(cm: number): number {
  let out = 0;
  for (let i = 0; i < SCORE_RADIUS_BANDS.length; i++) {
    const band = SCORE_RADIUS_BANDS[i]!;
    const end = SCORE_RADIUS_BANDS[i + 1]?.fromCm ?? Infinity;
    if (cm <= band.fromCm) break;
    out += (Math.min(cm, end) - band.fromCm) * band.perCm;
  }
  return out;
}

export const SCORE = {
  /** Points per cm of max radius on the progress scale (progressRadius). */
  perRadiusCm: 100,
  perDebris: 2,
  /** Points per Tier above Tier 1. */
  perTier: 1000,
  victoryBonus: 5000,
  /** Victory only: points per second under `victoryParSec`. */
  victoryPerSecUnderPar: 10,
  victoryParSec: 2400,
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
 * base  = round(progressRadius(maxRadius) × 100) + debrisAbsorbed × 2 + (tierReached − 1) × 1000
 *         + victory ? 5000 + round(max(0, 2400 − seconds) × 10) : 0
 * score = round(base × DIFFICULTY_SCORE_MULTIPLIER[difficulty])   (casual 1, arcade 1.25, hardcore 1.6)
 */
export function computeScore(s: ScoreInput): number {
  const radius = Math.max(0, s.maxRadius);
  const debris = Math.max(0, Math.floor(s.debrisAbsorbed));
  const tier = Math.min(Math.max(Math.floor(s.tierReached), 1), SCORE_MAX_TIER);
  let score = Math.round(progressRadius(radius) * SCORE.perRadiusCm) + debris * SCORE.perDebris + (tier - 1) * SCORE.perTier;
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

// ---------------------------------------------------------------------------------------
// Area boards: one entry per Area a Run clears (see docs/architecture.md, Leaderboard).

/** Area ids, in Run order, mirrored from `AREA_ORDER` in `src/world/types.ts` (test-synced). */
export const SCORE_AREAS = ['house', 'neighborhood', 'city', 'region', 'continent'] as const;
export type ScoreArea = (typeof SCORE_AREAS)[number];

export function isScoreArea(v: unknown): v is ScoreArea {
  return typeof v === 'string' && (SCORE_AREAS as readonly string[]).includes(v);
}

/** Tier at which each Area's boss arrives, mirrored from `AREA_BOSSES` (test-synced): a clear needs it. */
export const AREA_BOSS_TIER: Readonly<Record<ScoreArea, number>> = { house: 5, neighborhood: 7, city: 9, region: 11, continent: 13 };

/**
 * Centimetres per world unit in each Area, mirrored from `AREAS[area].unit` (test-synced). Area
 * board radii are in the Area's own unit.
 */
export const SCORE_AREA_UNIT: Readonly<Record<ScoreArea, number>> = { house: 1, neighborhood: 1, city: 1, region: 1000, continent: 1e6 };

export const AREA_SCORE = {
  /** Points per unit (the Area's own unit) the Bunny grew in the Area: 100 per cm up to the City. */
  perRadiusUnit: { house: 100, neighborhood: 100, city: 100, region: 10_000, continent: 10_000 } as Readonly<Record<ScoreArea, number>>,
  perDebris: 2,
  clearBonus: 3000,
  /** Points per second under the Area's par. */
  perSecUnderPar: 10,
  parSec: { house: 720, neighborhood: 600, city: 900, region: 360, continent: 360 } as Readonly<Record<ScoreArea, number>>,
} as const;

export interface AreaScoreInput {
  area: ScoreArea;
  /** Radius on entering the Area, in the Area's unit (SCORE_AREA_UNIT), after any arrival leap. */
  radiusIn: number;
  /** Largest radius reached by the time the Run left the Area, in the Area's unit. */
  maxRadius: number;
  /** Debris absorbed in the Area. */
  debrisAbsorbed: number;
  /** Time spent in the Area. */
  durationMs: number;
  difficulty?: DifficultyId;
}

/**
 * base  = round((maxRadius − radiusIn) × perRadiusUnit) + debrisAbsorbed × 2 + 3000
 *         + round(max(0, par − seconds) × 10)   (par: house 720 s, neighborhood 600 s, city 900 s, region and
 *                                                continent 360 s; perRadiusUnit 100 per cm up to the City,
 *                                                10,000 per Region or Continent unit)
 * score = round(base × DIFFICULTY_SCORE_MULTIPLIER[difficulty])
 */
export function computeAreaScore(s: AreaScoreInput): number {
  const growth = Math.max(0, s.maxRadius - Math.max(0, s.radiusIn));
  const debris = Math.max(0, Math.floor(s.debrisAbsorbed));
  const sec = Math.max(0, s.durationMs) / 1000;
  const par = AREA_SCORE.parSec[s.area] ?? 0;
  const score =
    Math.round(growth * (AREA_SCORE.perRadiusUnit[s.area] ?? 0)) + debris * AREA_SCORE.perDebris + AREA_SCORE.clearBonus + Math.round(Math.max(0, par - sec) * AREA_SCORE.perSecUnderPar);
  const mult = DIFFICULTY_SCORE_MULTIPLIER[s.difficulty ?? DEFAULT_DIFFICULTY] ?? 1;
  return Math.round(score * mult);
}
