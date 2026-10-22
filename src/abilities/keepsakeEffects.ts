/**
 * Keepsake effects in a Run (headless; installed with the Abilities, so they run in the browser,
 * `pnpm sim` and Vitest alike). Values: src/data/keepsakes.ts, added up per Loadout by
 * ./keepsakeParams.ts.
 *
 *   Number changes (every type that only edits an Ability number) go through the params modifier
 *   registered below: Long Strand, Quick Shed, Thick Clog, Dinner Bell, Loose Roots, Snowball
 *   (planted magnet, added by Hunker after the cap stage), Dead Weight's stun, Live Wire,
 *   Long Reach, Arc, Static Cling and Grounding (added by Discharge below the cap stage).
 *
 *   Code effects, installed per Run by installKeepsakeEffects (AbilitySystem hooks):
 *     Reclaim          decoyEnded: fibre Debris worth `volume` × the Bunny's volume at the Decoy
 *                      spot, split like shed mass (planShed), so re-absorbing it all gives it back.
 *     Bristle Back     plantedTouched (non-boss): stunned, and knocked back `knockback` r over
 *                      0.2 s (walls stop it). Hazards with their own planted reaction (Broom, Lint
 *                      Roller family) and ranged ones (turrets, Leaf Blower) are stunned only.
 *     Dead Weight      bossStunned by Hunker: the chip that follows keeps the boss stunned
 *                      `bossStun` s longer and knocks `extraParts` more parts loose (boss.chipBonus).
 *     Thick Undercoat  always-on stat modifiers below the cap stage: knockbackResistance + total,
 *                      suctionMultiplier × (1 − total).
 */
import { growthFactorAt } from '../systems/absorb';
import type { Run } from '../game/run';
import type { System } from '../game/system';
import type { Hazard } from '../hazards';
import { BaseHazard } from '../hazards/base';
import { moveCircle } from '../hazards/common';
import { pickShedType, planShed, scatterDebris } from '../hazards/shed';
import { applyLoadout, keepsakeTotals, type KeepsakeTotals } from './keepsakeParams';
import { addAbilityParamsModifier } from './params';
import { hazardRadius, isBoss, type AbilitySystem } from './system';

export const KEEPSAKE_SYSTEM_ID = 'keepsakes';
const UNDERCOAT_SOURCE = 'keepsake:thick_undercoat';
/** Seconds a Bristle Back knockback takes. */
const KNOCKBACK_TIME = 0.2;
/** Debris type Reclaim's fibre uses when the Run has it (else the shed type closest in size). */
const RECLAIM_DEBRIS = 'lint_ball';

// Every Run's Ability params get its Loadout's numbers (and the floors).
addAbilityParamsModifier((p, run) => applyLoadout(p, run.loadout));

interface Knock {
  h: BaseHazard;
  dirX: number;
  dirZ: number;
  /** cm still to travel. */
  left: number;
  speed: number;
}

/** Per-Run code effects (see file header). Order 95: right after the Ability System. */
export class KeepsakeEffects implements System {
  readonly id = KEEPSAKE_SYSTEM_ID;
  readonly order = 95;
  readonly totals: KeepsakeTotals;
  private readonly knocks: Knock[] = [];

  constructor(private readonly system: AbilitySystem) {
    const run = system.run;
    const k = (this.totals = keepsakeTotals(run.loadout));
    const hooks = system.hooks;
    if (k.reclaimVolume > 0) {
      hooks.decoyEnded = (r, reason, x, z) => {
        if (reason !== 'area') this.reclaim(r, x, z);
      };
    }
    if (k.bristleKnockback > 0 || k.bristleStun > 0) {
      hooks.plantedTouched = (r, h) => {
        if (!isBoss(h)) this.bristle(r, h);
      };
    }
    if (k.deadWeightStun > 0 || k.deadWeightParts > 0) {
      hooks.bossStunned = (_r, boss, cause) => {
        if (cause === 'hunker') boss.chipBonus = { hold: system.params.hunker.bossStunBonus, pieces: k.deadWeightParts };
      };
    }
    if (k.undercoatKnockback > 0) run.bunny.stats.add({ stat: 'knockbackResistance', op: 'add', value: k.undercoatKnockback, source: UNDERCOAT_SOURCE });
    if (k.undercoatSuction > 0) run.bunny.stats.add({ stat: 'suctionMultiplier', op: 'mul', value: 1 - k.undercoatSuction, source: UNDERCOAT_SOURCE });
  }

  /** Reclaim: absorbable fibre worth reclaimVolume × the Bunny's volume around (x, z). Returns pieces placed. */
  reclaim(run: Run, x: number, z: number): number {
    const b = run.bunny;
    const ratio = b.stats.get('absorbRatio');
    const fraction = this.totals.reclaimVolume;
    const approx = planShed(b.radius, fraction, ratio);
    const type = run.debris.types.find((t) => t.id === RECLAIM_DEBRIS) ?? pickShedType(run.debris.types, approx.pieceSize, run.tier);
    const plan = planShed(b.radius, fraction, ratio, growthFactorAt(b.radius), type?.mass ?? 1);
    return scatterDebris(run, this.system.rng, x, z, plan.pieces, plan.pieceSize, b.radius * 0.3, b.radius * 2, type);
  }

  /** Bristle Back: stun a non-boss Hazard that ran into the planted Tumble and knock it back. */
  bristle(run: Run, h: Hazard): void {
    const k = this.totals;
    if (k.bristleStun > 0) this.system.stunHazard(h, k.bristleStun);
    if (k.bristleKnockback <= 0 || h.onPlanted || h.ranged || !(h instanceof BaseHazard)) return;
    const b = run.bunny;
    const dx = h.x - b.x;
    const dz = h.z - b.z;
    const d = Math.hypot(dx, dz) || 1;
    const dist = k.bristleKnockback * b.radius;
    this.knocks.push({ h, dirX: dx / d, dirZ: dz / d, left: dist, speed: dist / KNOCKBACK_TIME });
  }

  update(dt: number, run: Run): void {
    for (let i = this.knocks.length - 1; i >= 0; i--) {
      const n = this.knocks[i]!;
      const step = Math.min(n.left, n.speed * dt);
      const m = n.h.dead ? null : moveCircle(run.house, n.h.x, n.h.z, hazardRadius(n.h), n.h.collisionHeight, n.dirX * step, n.dirZ * step);
      if (m) {
        n.h.x = m.x;
        n.h.z = m.z;
      }
      n.left -= step;
      if (!m || m.hit || n.left <= 1e-6) this.knocks.splice(i, 1);
    }
  }

  /** Hazards being knocked back right now (tests). */
  get knocking(): number {
    return this.knocks.length;
  }

  dispose(): void {
    this.knocks.length = 0;
    this.system.run.bunny.stats.removeSource(UNDERCOAT_SOURCE);
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
