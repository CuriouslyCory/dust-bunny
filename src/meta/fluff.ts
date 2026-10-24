/** Fluff (meta currency) earned per Run. Formula from docs/design.md. */
import { AREAS } from "../data/areas";
import { getDifficulty } from "../data/difficulty";
import { AreaProgress, type ClearedFlag } from "../game/areaProgress";
import type { RunEndReason } from "../game/runStats";
import type { CreditStats } from "../shared/runCredit";
import type { AreaId } from "../world/types";

export const VICTORY_FLUFF_MULTIPLIER = 1.75;
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
/** Runs that also beat the Sun (made it to the galaxy) but did not win. */
export const SOLAR_SYSTEM_CLEARED_FLUFF_MULTIPLIER = 1.65;
/** Runs that also beat Sagittarius A* (made it to the universe) but did not win. */
export const GALAXY_CLEARED_FLUFF_MULTIPLIER = 1.7;

/**
 * Multiplier for a Run whose furthest cleared Area is this one but that did not win. Null for the
 * last Area: clearing it wins the Run (`VICTORY_FLUFF_MULTIPLIER`).
 */
export const CLEARED_FLUFF_MULTIPLIERS: Readonly<Record<AreaId, number | null>> = {
  house: HOUSE_CLEARED_FLUFF_MULTIPLIER,
  neighborhood: NEIGHBORHOOD_CLEARED_FLUFF_MULTIPLIER,
  city: CITY_CLEARED_FLUFF_MULTIPLIER,
  region: REGION_CLEARED_FLUFF_MULTIPLIER,
  continent: CONTINENT_CLEARED_FLUFF_MULTIPLIER,
  globe: GLOBE_CLEARED_FLUFF_MULTIPLIER,
  solar_system: SOLAR_SYSTEM_CLEARED_FLUFF_MULTIPLIER,
  galaxy: GALAXY_CLEARED_FLUFF_MULTIPLIER,
  universe: null,
};

/** What the formula reads: a full `RunStats`, or a ledger row's bounded `CreditStats` (docs/adr/0003). */
type FluffStats = Pick<
  CreditStats,
  "maxRadius" | "debrisAbsorbed" | "tierReached" | "difficulty" | "areas" | ClearedFlag
>;

/**
 * The furthest Area a Run that did not win cleared and its Fluff multiplier
 * (`CLEARED_FLUFF_MULTIPLIERS`); null when it cleared none.
 */
export function clearedFluffBonus(
  stats: Partial<Record<ClearedFlag, boolean>>,
): { area: AreaId; multiplier: number } | null {
  const area = AreaProgress.fromFlags(stats).furthestCleared(
    (a) => CLEARED_FLUFF_MULTIPLIERS[a] !== null,
  );
  return area ? { area, multiplier: CLEARED_FLUFF_MULTIPLIERS[area]! } : null;
}

/**
 * Radius term: each Area's growth in its own unit × `AREAS[area].fluffPerUnit` (House 1/30 per
 * cm, Neighborhood 1/60, City 1/120, Region 1.5 per 10 m, Continent 1.5 per 10 km, Globe 1.5 per
 * 1,000 km, Solar System 1.5 per 0.01 AU, Galaxy 1.5 per 100 ly, Universe 1.5 per 10 Mly, the last five counted from the radius after the arrival leap), so every Act scales its own share and no cap is needed. Payloads without `areas` (older saves) use min(maxRadius, 300) / 30.
 */
export function fluffRadiusTerm(
  stats: Pick<CreditStats, "maxRadius" | "areas">,
): number {
  if (!stats.areas?.length) return Math.min(stats.maxRadius, 300) / 30;
  return stats.areas.reduce(
    (sum, a) =>
      sum +
      Math.max(0, a.maxRadius - a.radiusIn) *
        ((AREAS as Record<string, { fluffPerUnit: number } | undefined>)[a.area]
          ?.fluffPerUnit ?? 0),
    0,
  );
}

/**
 * floor((tierReached × 4 + radius term + debrisAbsorbed / 1000) × multiplier × difficulty):
 * multiplier 1.75 on victory, otherwise the furthest cleared Area's (`CLEARED_FLUFF_MULTIPLIERS`:
 * 1.25 for the house up to 1.7 for the galaxy; 1 when none was cleared); difficulty 1 on Casual, 2 on Arcade, 5 on Hardcore
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
      : (clearedFluffBonus(stats)?.multiplier ?? 1);
  return Math.max(
    0,
    Math.floor(base * mult * getDifficulty(stats.difficulty).fluff),
  );
}
