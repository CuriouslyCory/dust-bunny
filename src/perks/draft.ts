/**
 * Perk draft logic (pure + per-Run state). The modal is src/ui/screens/perkDraft.ts.
 * Offers `perkChoices` (3, 4 with Wide Choice) distinct Perks, weighted, never a unique or
 * maxed Perk the Run already has. Rerolls per Run come from the perkRerolls stat.
 */
import type { Rng } from '../core/rng';
import type { Run } from '../game/run';
import { availablePerks, type PerkDef } from './index';

/** Weighted sample of up to `count` distinct Perks from `pool`. */
export function draftPerks(pool: readonly PerkDef[], count: number, rng: Rng, exclude: readonly string[] = []): PerkDef[] {
  let left = pool.filter((p) => !exclude.includes(p.id));
  // If excluding (reroll) leaves too few, fall back to the full pool.
  if (left.length < Math.min(count, pool.length)) left = [...pool];
  const out: PerkDef[] = [];
  while (out.length < count && left.length > 0) {
    const pick = rng.weighted(left, (p) => p.weight ?? 1) ?? left[0]!;
    out.push(pick);
    left = left.filter((p) => p !== pick);
  }
  return out;
}

export interface DraftState {
  rerollsUsed: number;
  rng: Rng;
}

const states = new WeakMap<Run, DraftState>();

export function draftState(run: Run): DraftState {
  let s = states.get(run);
  if (!s) {
    s = { rerollsUsed: 0, rng: run.rng.fork('perk-draft') };
    states.set(run, s);
  }
  return s;
}

export function rerollsLeft(run: Run): number {
  return Math.max(0, Math.round(run.bunny.stats.get('perkRerolls')) - draftState(run).rerollsUsed);
}

/** A fresh draft for the Run. Pass the current offer as `exclude` when rerolling. */
export function draftForRun(run: Run, exclude: readonly string[] = []): PerkDef[] {
  const count = Math.round(run.bunny.stats.get('perkChoices'));
  return draftPerks(availablePerks(run), count, draftState(run).rng, exclude);
}

/** Consumes a reroll and returns a new draft, or null when none are left. */
export function rerollDraft(run: Run, current: readonly PerkDef[]): PerkDef[] | null {
  if (rerollsLeft(run) <= 0) return null;
  draftState(run).rerollsUsed++;
  return draftForRun(run, current.map((p) => p.id));
}
