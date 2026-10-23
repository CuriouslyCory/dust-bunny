/**
 * Keepsake effects in a Run (headless; installed with the Abilities, so they run in the browser,
 * `pnpm sim` and Vitest alike). Values: src/data/keepsakes.ts, added up per Loadout by
 * ./keepsakeParams.ts.
 *
 *   Number changes (every type that only edits an Ability number) go through the params modifier
 *   registered below: Long Strand, Quick Shed, Thick Clog, Dinner Bell, Dense Core, Lingering
 *   Mass, Collapse and Feast (both run by Amass from its params: ./amass.ts), Unmoved's channel
 *   guard, Live Wire, Long Reach, Arc, Static Cling and Grounding (added by Discharge below the
 *   cap stage).
 *
 *   Code effects, installed per Run by installKeepsakeEffects (AbilitySystem hooks), and again on
 *   keepsakeTuckedIn (a Keepsake tucked in mid-Run, `Run.tuckIn`):
 *     Reclaim          decoyEnded: fibre Debris worth `volume` × the Bunny's volume at the Decoy
 *                      spot, split like shed mass (planShed), so re-absorbing it all gives it back.
 *     Unmoved          always-on stat modifiers below the cap stage: knockbackResistance + total,
 *                      suctionMultiplier × (1 − total).
 */
import { growthFactorAt } from '../systems/absorb';
import type { Run } from '../game/run';
import type { System } from '../game/system';
import { pickShedType, planShed, scatterDebris } from '../hazards/shed';
import { applyLoadout, keepsakeTotals, type KeepsakeTotals } from './keepsakeParams';
import { addAbilityParamsModifier } from './params';
import type { AbilitySystem } from './system';

export const KEEPSAKE_SYSTEM_ID = 'keepsakes';
const UNMOVED_SOURCE = 'keepsake:unmoved';
/** Debris type Reclaim's fibre uses when the Run has it (else the shed type closest in size). */
const RECLAIM_DEBRIS = 'lint_ball';

// Every Run's Ability params get its Loadout's numbers (and the floors).
addAbilityParamsModifier((p, run) => applyLoadout(p, run.loadout));

/** Per-Run code effects (see file header). Order 95: right after the Ability System. */
export class KeepsakeEffects implements System {
  readonly id = KEEPSAKE_SYSTEM_ID;
  readonly order = 95;
  totals: KeepsakeTotals;

  constructor(private readonly system: AbilitySystem) {
    const run = system.run;
    this.totals = this.apply();
    // A Keepsake tucked in mid-Run: the Loadout only grows, so applying it again adds its effects.
    run.disposables.add(run.events.on('keepsakeTuckedIn', () => (this.totals = this.apply())));
  }

  /** Installs the current Loadout's code effects (again: Unmoved's modifiers are replaced, not stacked). */
  private apply(): KeepsakeTotals {
    const run = this.system.run;
    const k = keepsakeTotals(run.loadout);
    const hooks = this.system.hooks;
    if (k.reclaimVolume > 0) {
      hooks.decoyEnded = (r, reason, x, z) => {
        if (reason !== 'area') this.reclaim(r, x, z);
      };
    }
    run.bunny.stats.removeSource(UNMOVED_SOURCE);
    if (k.unmovedKnockback > 0) run.bunny.stats.add({ stat: 'knockbackResistance', op: 'add', value: k.unmovedKnockback, source: UNMOVED_SOURCE });
    if (k.unmovedSuction > 0) run.bunny.stats.add({ stat: 'suctionMultiplier', op: 'mul', value: 1 - k.unmovedSuction, source: UNMOVED_SOURCE });
    return k;
  }

  /** Reclaim: absorbable fibre worth reclaimVolume × the Bunny's volume around (x, z). Returns pieces placed. */
  reclaim(run: Run, x: number, z: number): number {
    const b = run.bunny;
    const ratio = b.stats.get('absorbRatio');
    const fraction = this.totals.reclaimVolume;
    const approx = planShed(b.radius, fraction, ratio);
    const type = run.debris.types.find((t) => t.id === RECLAIM_DEBRIS) ?? pickShedType(run.debris.types, approx.pieceSize, run.tier, run.area);
    const plan = planShed(b.radius, fraction, ratio, growthFactorAt(b.realRadius), type?.mass ?? 1);
    return scatterDebris(run, this.system.rng, x, z, plan.pieces, plan.pieceSize, b.radius * 0.3, b.radius * 2, type);
  }

  update(): void {}

  dispose(): void {
    this.system.run.bunny.stats.removeSource(UNMOVED_SOURCE);
  }
}

/** Installs the Run's Keepsake effects for its Ability System (once). */
export function installKeepsakeEffects(system: AbilitySystem): KeepsakeEffects {
  const run = system.run;
  const existing = run.getSystem<KeepsakeEffects>(KEEPSAKE_SYSTEM_ID);
  if (existing) return existing;
  const fx = new KeepsakeEffects(system);
  run.addSystem(fx);
  return fx;
}

/** The Run's Keepsake effects, if installed. */
export function getKeepsakeEffects(run: Run): KeepsakeEffects | undefined {
  return run.getSystem<KeepsakeEffects>(KEEPSAKE_SYSTEM_ID);
}
