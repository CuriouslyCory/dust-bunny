/** Fluff (meta currency) earned per Run. Formula from docs/design.md. */
import type { RunEndReason, RunStats } from '../game/runStats';

export const VICTORY_FLUFF_MULTIPLIER = 1.5;

/** floor((maxRadius × 2 + debrisAbsorbed / 20 + tierReached × 10) × (1.5 on victory)). */
export function fluffForRun(reason: RunEndReason, stats: Pick<RunStats, 'maxRadius' | 'debrisAbsorbed' | 'tierReached'>): number {
  const base = stats.maxRadius * 2 + stats.debrisAbsorbed / 20 + stats.tierReached * 10;
  const mult = reason === 'victory' ? VICTORY_FLUFF_MULTIPLIER : 1;
  return Math.max(0, Math.floor(base * mult));
}
