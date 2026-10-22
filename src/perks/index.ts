/**
 * Perk extension point. The twelve design Perks are registered in ./perks.ts.
 * run.applyPerk(id) tracks stacks, calls def.apply(run, stacks) and emits perkApplied.
 * Typical apply: run.bunny.stats.add({ stat: 'speed', op: 'mul', value: 1.1, source: `perk:${id}` }).
 * Drafting (pick 1 of perkChoices per Tier crossed) is run.perkDraft (./draft.ts), shown by
 * src/ui/screens/perkDraft.ts.
 */
import { Registry } from '../core/registry';
import type { StatKey } from '../entities/stats';
import type { Run } from '../game/run';

export interface PerkDef {
  id: string;
  name: string;
  description: string;
  /** Emoji / short glyph for the draft cards and HUD. */
  icon?: string;
  /** Can only be taken once per Run. */
  unique?: boolean;
  maxStacks?: number;
  /** Relative draft weight. */
  weight?: number;
  /**
   * Stats this Perk only raises (or lowers, for floors). The draft hides it once every one is at
   * the Character's cap. Omit for Perks with any other effect (Thick Fur also heals).
   */
  capStats?: readonly StatKey[];
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
