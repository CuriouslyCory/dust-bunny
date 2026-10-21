/**
 * Perk extension point. No Perks are defined yet; register PerkDefs here.
 * run.applyPerk(id) tracks stacks, calls def.apply(run, stacks) and emits perkApplied.
 * Typical apply: run.bunny.stats.add({ stat: 'speed', op: 'mul', value: 1.1, source: `perk:${id}` }).
 * The draft UI (pick 1 of N on tierUp) is not part of core.
 */
import { Registry } from '../core/registry';
import type { Run } from '../game/run';

export interface PerkDef {
  id: string;
  name: string;
  description: string;
  /** Can only be taken once per Run. */
  unique?: boolean;
  maxStacks?: number;
  /** Relative draft weight. */
  weight?: number;
  /** Called each time the Perk is taken; `stacks` is the new stack count (1-based). */
  apply(run: Run, stacks: number): void;
}

export const perkRegistry = new Registry<PerkDef>('perk');

/** Perks that may still be offered in this Run. */
export function availablePerks(run: Run): PerkDef[] {
  return perkRegistry.all().filter((p) => {
    const stacks = run.perkStacks(p.id);
    if (p.unique && stacks > 0) return false;
    return p.maxStacks === undefined || stacks < p.maxStacks;
  });
}
