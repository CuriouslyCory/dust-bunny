/** Fluff (meta currency) earned per Run. Formula from docs/design.md. */
import type { RunEndReason, RunStats } from '../game/runStats';

export const VICTORY_FLUFF_MULTIPLIER = 1.5;
/** Runs that beat the Robo-Vac 9000 (house cleared) but did not win. */
export const HOUSE_CLEARED_FLUFF_MULTIPLIER = 1.25;
/** Runs that also beat the Street Sweeper (made it to the city) but did not win. */
export const NEIGHBORHOOD_CLEARED_FLUFF_MULTIPLIER = 1.35;

/**
 * floor((maxRadius × 2 + debrisAbsorbed / 20 + tierReached × 10) × multiplier): 1.5 on victory,
 * 1.35 if the neighborhood was cleared, 1.25 if the house was cleared. The radius term is capped
 * at 300 cm so the city's giant radii don't swamp the economy.
 */
export function fluffForRun(
  reason: RunEndReason,
  stats: Pick<RunStats, 'maxRadius' | 'debrisAbsorbed' | 'tierReached'> & { houseCleared?: boolean; neighborhoodCleared?: boolean },
): number {
  const base = Math.min(stats.maxRadius, 300) * 2 + stats.debrisAbsorbed / 20 + stats.tierReached * 10;
  const mult =
    reason === 'victory'
      ? VICTORY_FLUFF_MULTIPLIER
      : stats.neighborhoodCleared
        ? NEIGHBORHOOD_CLEARED_FLUFF_MULTIPLIER
        : stats.houseCleared
          ? HOUSE_CLEARED_FLUFF_MULTIPLIER
          : 1;
  return Math.max(0, Math.floor(base * mult));
}
