/** Fluff (meta currency) earned per Run. Formula from docs/design.md. */
import { getDifficulty } from '../data/difficulty';
import type { RunEndReason, RunStats } from '../game/runStats';

export const VICTORY_FLUFF_MULTIPLIER = 1.5;
/** Runs that beat the Robo-Vac 9000 (house cleared) but did not win. */
export const HOUSE_CLEARED_FLUFF_MULTIPLIER = 1.25;
/** Runs that also beat the Street Sweeper (made it to the city) but did not win. */
export const NEIGHBORHOOD_CLEARED_FLUFF_MULTIPLIER = 1.35;

/**
 * floor((tierReached × 4 + min(maxRadius, 300) / 30 + debrisAbsorbed / 1000) × multiplier × difficulty):
 * multiplier 1.5 on victory, 1.35 if the neighborhood was cleared, 1.25 if the house was cleared;
 * difficulty 1 on Casual, 2 on Arcade, 5 on Hardcore (`DifficultyDef.fluff`). Tier reached is
 * the main term, so a Casual win pays about 75 (one base-level Upgrade) and a Hardcore win about
 * 375. The radius term is capped at 300 cm so the city's giant radii don't swamp the economy.
 */
export function fluffForRun(
  reason: RunEndReason,
  stats: Pick<RunStats, 'maxRadius' | 'debrisAbsorbed' | 'tierReached' | 'difficulty'> & { houseCleared?: boolean; neighborhoodCleared?: boolean },
): number {
  const base = stats.tierReached * 4 + Math.min(stats.maxRadius, 300) / 30 + stats.debrisAbsorbed / 1000;
  const mult =
    reason === 'victory'
      ? VICTORY_FLUFF_MULTIPLIER
      : stats.neighborhoodCleared
        ? NEIGHBORHOOD_CLEARED_FLUFF_MULTIPLIER
        : stats.houseCleared
          ? HOUSE_CLEARED_FLUFF_MULTIPLIER
          : 1;
  return Math.max(0, Math.floor(base * mult * getDifficulty(stats.difficulty).fluff));
}
