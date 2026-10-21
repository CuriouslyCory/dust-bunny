/** Fluff (meta currency) earned per Run. Formula from docs/design.md. */
import type { RunEndReason, RunStats } from '../game/runStats';

export const VICTORY_FLUFF_MULTIPLIER = 1.5;
/** Runs that beat the Robo-Vac 9000 (house cleared) but did not win outside. */
export const HOUSE_CLEARED_FLUFF_MULTIPLIER = 1.25;

/** floor((maxRadius × 2 + debrisAbsorbed / 20 + tierReached × 10) × (1.5 on victory, 1.25 if the house was cleared)). */
export function fluffForRun(reason: RunEndReason, stats: Pick<RunStats, 'maxRadius' | 'debrisAbsorbed' | 'tierReached'> & { houseCleared?: boolean }): number {
  const base = stats.maxRadius * 2 + stats.debrisAbsorbed / 20 + stats.tierReached * 10;
  const mult = reason === 'victory' ? VICTORY_FLUFF_MULTIPLIER : stats.houseCleared ? HOUSE_CLEARED_FLUFF_MULTIPLIER : 1;
  return Math.max(0, Math.floor(base * mult));
}
