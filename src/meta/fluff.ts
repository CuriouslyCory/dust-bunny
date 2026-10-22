/** Fluff (meta currency) earned per Run. Formula from docs/design.md. */
import { AREAS } from "../data/areas";
import { getDifficulty } from "../data/difficulty";
import type { RunEndReason, RunStats } from "../game/runStats";

export const VICTORY_FLUFF_MULTIPLIER = 1.65;
/** Runs that beat the Robo-Vac 9000 (house cleared) but did not win. */
export const HOUSE_CLEARED_FLUFF_MULTIPLIER = 1.25;
/** Runs that also beat the Street Sweeper (made it to the city) but did not win. */
export const NEIGHBORHOOD_CLEARED_FLUFF_MULTIPLIER = 1.35;
/** Runs that also beat the Garbage Truck (made it to the region) but did not win. */
export const CITY_CLEARED_FLUFF_MULTIPLIER = 1.45;
/** Runs that also beat the Incinerator (made it to the continent) but did not win. */
export const REGION_CLEARED_FLUFF_MULTIPLIER = 1.5;
/** Runs that also beat the Ice Sheet (made it to the globe) but did not win. */
export const CONTINENT_CLEARED_FLUFF_MULTIPLIER = 1.55;
/** Runs that also beat the Orbital Sweeper (made it to the solar system) but did not win. */
export const GLOBE_CLEARED_FLUFF_MULTIPLIER = 1.6;

type FluffStats = Pick<
  RunStats,
  "maxRadius" | "debrisAbsorbed" | "tierReached" | "difficulty" | "areas"
> & {
  houseCleared?: boolean;
  neighborhoodCleared?: boolean;
  cityCleared?: boolean;
  regionCleared?: boolean;
  continentCleared?: boolean;
  globeCleared?: boolean;
};

/**
 * Radius term: each Area's growth in its own unit × `AREAS[area].fluffPerUnit` (House 1/30 per
 * cm, Neighborhood 1/60, City 1/120, Region 1.5 per 10 m, Continent 1.5 per 10 km, Globe 1.5 per
 * 1,000 km, Solar System 1.5 per 0.01 AU, the last three counted from the radius after the arrival leap), so every Act scales its own share and no cap is needed. Payloads without `areas` (older saves) use min(maxRadius, 300) / 30.
 */
export function fluffRadiusTerm(
  stats: Pick<RunStats, "maxRadius" | "areas">,
): number {
  if (!stats.areas?.length) return Math.min(stats.maxRadius, 300) / 30;
  return stats.areas.reduce(
    (sum, a) =>
      sum +
      Math.max(0, a.maxRadius - a.radiusIn) *
        (AREAS[a.area]?.fluffPerUnit ?? 0),
    0,
  );
}

/**
 * floor((tierReached × 4 + radius term + debrisAbsorbed / 1000) × multiplier × difficulty):
 * multiplier 1.65 on victory, 1.6 if the globe was cleared, 1.55 if the continent was cleared, 1.5 if the region was cleared, 1.45 if the city was cleared, 1.35 if
 * the neighborhood was cleared, 1.25 if the house was cleared; difficulty 1 on Casual, 2 on Arcade, 5 on Hardcore
 * (`DifficultyDef.fluff`). Tier reached is the main term, so a Casual win pays about 100 and a
 * Hardcore win about 500.
 */
export function fluffForRun(reason: RunEndReason, stats: FluffStats): number {
  const base =
    stats.tierReached * 4 +
    fluffRadiusTerm(stats) +
    stats.debrisAbsorbed / 1000;
  const mult =
    reason === "victory"
      ? VICTORY_FLUFF_MULTIPLIER
      : stats.globeCleared
        ? GLOBE_CLEARED_FLUFF_MULTIPLIER
        : stats.continentCleared
        ? CONTINENT_CLEARED_FLUFF_MULTIPLIER
        : stats.regionCleared
          ? REGION_CLEARED_FLUFF_MULTIPLIER
          : stats.cityCleared
            ? CITY_CLEARED_FLUFF_MULTIPLIER
            : stats.neighborhoodCleared
              ? NEIGHBORHOOD_CLEARED_FLUFF_MULTIPLIER
              : stats.houseCleared
                ? HOUSE_CLEARED_FLUFF_MULTIPLIER
                : 1;
  return Math.max(
    0,
    Math.floor(base * mult * getDifficulty(stats.difficulty).fluff),
  );
}
