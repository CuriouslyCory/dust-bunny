/**
 * Zap's Character Perks (drafted only by Zap). Numbers: CHARACTER_PERK_EFFECTS in
 * src/data/perks.ts. Every effect reads run.perkStacks(id) when it acts, so starting Perks,
 * Perks drafted later and Perks re-applied silently on Resume all work the same; the defs'
 * apply() does nothing. Without Abilities (`rules.abilities === false`) there is no Static
 * meter and the meter Perks do nothing. Ranges and sizes are in Bunny radii (r).
 *
 *   Emergency Discharge  a combat guard: when Zap would take damage from any source with a full
 *                        meter and the internal cooldown (from the last trigger) is over, the
 *                        meter is spent (DischargeAbility.spend) to negate the hit with the usual
 *                        i-frames. Tangible Hazards whose edge is within the reach of Zap's
 *                        surface are stunned: non-boss for emergencyStun s, bosses for
 *                        emergencyBossStunShare of it through AbilitySystem.stunBoss (the 6 s
 *                        limit; cause 'discharge'). Emits emergencyDischarge.
 *   Hyper Charge         a params modifier: discharge.dashMultiplier = max(current, per stack).
 *   Thunderstruck        each non-boss hazardShorted (Arc targets too) leaves a static patch at
 *                        the Hazard: thunderstruckDuration s, radius per stack × Zap's radius at
 *                        creation. A tangible non-boss Hazard whose disc overlaps a patch is
 *                        stunned thunderstruckStun s, once per patch (one already inside when
 *                        the patch appears counts as entering). Patches go on Area change.
 *   Recharge Snack       the scrap of each Discharge (hooks.dischargeScrap) shares one budget of
 *                        rechargeSnackCap. Absorbing a piece adds the per-stack refund (stacks
 *                        read at absorb time), clamped to the budget left and the meter's room;
 *                        a meter it fills fires staticFull on the next Discharge update. Tags are
 *                        dropped when a piece leaves any other way and on Area change.
 *   Capacitor            a params modifier: discharge.drainDelay = max(current, per stack).
 */
import { addAbilityParamsModifier } from '../abilities/params';
import { DischargeAbility } from '../abilities/discharge';
import { BoltView } from '../abilities/view';
import { getAbilitySystem, hazardRadius, isBoss, type AbilitySystem } from '../abilities/system';
import { CHARACTER_PERKS, CHARACTER_PERK_EFFECTS as FX, perStack } from '../data/perks';
import { TUNING } from '../data/tuning';
import type { Debris } from '../entities/debris';
import type { Run } from '../game/run';
import type { System } from '../game/system';
import type { Hazard } from '../hazards';
import { COMBAT_SYSTEM_ID, type CombatSystem } from './combat';
import type { PerkDef } from './index';
import { EmergencyBurstView, StaticPatchView } from './zapView';

declare module '../core/events' {
  interface GameEvents {
    /** Emergency Discharge spent Zap's full meter to negate a hit; `stunned` Hazards (bosses included). */
    emergencyDischarge: { x: number; z: number; stunned: number };
    /** A Thunderstruck static patch stunned a Hazard that entered it. */
    staticPatchStunned: { hazardId: number; defId: string; seconds: number };
    /** Recharge Snack refunded `amount` of the meter (now `charge`) for absorbed Discharge scrap. */
    rechargeSnack: { amount: number; charge: number };
  }
}

export const ZAP_PERKS_SYSTEM_ID = 'zap-perks';

export const ZAP_PERK_DEFS: PerkDef[] = [
  { ...CHARACTER_PERKS.emergency_discharge, apply: () => {} },
  { ...CHARACTER_PERKS.hyper_charge, apply: () => {} },
  { ...CHARACTER_PERKS.thunderstruck, apply: () => {} },
  { ...CHARACTER_PERKS.recharge_snack, apply: () => {} },
  { ...CHARACTER_PERKS.capacitor, apply: () => {} },
];

// Hyper Charge and Capacitor edit the Discharge numbers (re-resolved whenever a Perk is applied).
addAbilityParamsModifier((p, run) => {
  const dash = perStack(FX.hyperChargeDash, run.perkStacks('hyper_charge'));
  if (dash !== undefined) p.discharge.dashMultiplier = Math.max(p.discharge.dashMultiplier, dash);
  const delay = perStack(FX.capacitorDelay, run.perkStacks('capacitor'));
  if (delay !== undefined) p.discharge.drainDelay = Math.max(p.discharge.drainDelay, delay);
});

interface StaticPatch {
  x: number;
  z: number;
  radius: number;
  left: number;
  /** Hazards this patch already stunned. */
  hit: Set<Hazard>;
  view: StaticPatchView;
}

/** Refund left from one Discharge's scrap (Recharge Snack). */
interface SnackBudget {
  left: number;
}

/** Zap's Perk effects (see file header). Order 96: after the Ability System, before Hazards. */
export class ZapPerks implements System {
  readonly id = ZAP_PERKS_SYSTEM_ID;
  readonly order = 96;
  readonly patches: StaticPatch[] = [];
  /** Live Discharge scrap and the budget of the Discharge that made it. */
  readonly scrap = new Map<Debris, SnackBudget>();
  /** Run second of the last Emergency Discharge. */
  lastEmergency = -Infinity;
  private readonly bolts: BoltView[] = [];
  private readonly bursts: EmergencyBurstView[] = [];
  private area: string;

  constructor(private readonly run: Run) {
    this.area = run.area;
    run.getSystem<CombatSystem>(COMBAT_SYSTEM_ID)?.guards.push(this.guard);
    const ability = this.ability;
    if (ability) {
      ability.hooks.dischargeScrap = (_run, pieces) => {
        const budget: SnackBudget = { left: FX.rechargeSnackCap };
        for (const d of pieces) this.scrap.set(d, budget);
      };
    }
    run.disposables.add(
      run.events.on('hazardShorted', (e) => {
        if (!e.boss) this.addPatch(e.x, e.z);
      }),
    );
    run.disposables.add(
      run.events.on('debrisAbsorbed', (e) => {
        if (e.kind === 'debris' && this.scrap.size > 0) this.absorbed(e.position.x, e.position.z);
      }),
    );
  }

  private get ability(): AbilitySystem | undefined {
    return getAbilitySystem(this.run);
  }

  /** The Discharge controller (null without Abilities). */
  get discharge(): DischargeAbility | null {
    const c = this.ability?.controller;
    return c instanceof DischargeAbility ? c : null;
  }

  update(dt: number, run: Run): void {
    if (run.area !== this.area) {
      this.area = run.area;
      this.clear();
    }
    for (const [d] of this.scrap) if (!d.alive) this.scrap.delete(d);
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      if (!this.bolts[i]!.update(dt)) this.bolts.splice(i, 1)[0]!.dispose();
    }
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      if (!this.bursts[i]!.update(dt)) this.bursts.splice(i, 1)[0]!.dispose();
    }
    for (let i = this.patches.length - 1; i >= 0; i--) {
      const patch = this.patches[i]!;
      patch.left -= dt;
      if (patch.left <= 0) {
        patch.view.dispose();
        this.patches.splice(i, 1);
        continue;
      }
      patch.view.update(run.time, patch.left);
      this.stunEntering(patch);
    }
  }

  /** Emergency Discharge (a CombatGuard). */
  private guard = (amount: number): boolean => {
    const run = this.run;
    const b = run.bunny;
    const stacks = run.perkStacks('emergency_discharge');
    const discharge = this.discharge;
    if (stacks <= 0 || amount <= 0 || !discharge?.ready || !b.alive) return false;
    if (run.time - this.lastEmergency < perStack(FX.emergencyCooldown, stacks)!) return false;
    this.lastEmergency = run.time;
    discharge.spend();
    b.invulnerable = Math.max(b.invulnerable, TUNING.invulnerability);
    const sys = this.ability!;
    const reach = perStack(FX.emergencyRadius, stacks)! * b.radius;
    let stunned = 0;
    for (const h of run.hazards.hazards) {
      if (h.dead || h.intangible) continue;
      const hr = hazardRadius(h);
      if (Math.hypot(h.x - b.x, h.z - b.z) - b.radius - hr > reach) continue;
      if (h.def.boss) {
        if (!isBoss(h) || !sys.stunBoss(h, FX.emergencyStun * FX.emergencyBossStunShare, 'discharge')) continue;
      } else sys.stunHazard(h, FX.emergencyStun);
      stunned++;
      const bolt = new BoltView(sys.rng, b.x, b.z, b.radius, h.x, h.z, Math.min(hr, b.radius * 2), Math.max(0.6, b.radius * 0.1));
      run.entityRoot.add(bolt.root);
      this.bolts.push(bolt);
    }
    const burst = new EmergencyBurstView(b.x, b.z, b.radius + reach);
    run.entityRoot.add(burst.root);
    this.bursts.push(burst);
    run.events.emit('emergencyDischarge', { x: b.x, z: b.z, stunned });
    return true;
  };

  /** Thunderstruck: a static patch where a Discharge destroyed a Hazard. */
  private addPatch(x: number, z: number): void {
    const radius = perStack(FX.thunderstruckRadius, this.run.perkStacks('thunderstruck'));
    if (radius === undefined) return;
    const r = radius * this.run.bunny.radius;
    const view = new StaticPatchView(x, z, r);
    this.run.entityRoot.add(view.root);
    const patch: StaticPatch = { x, z, radius: r, left: FX.thunderstruckDuration, hit: new Set(), view };
    this.patches.push(patch);
    this.stunEntering(patch);
  }

  private stunEntering(patch: StaticPatch): void {
    const run = this.run;
    const sys = this.ability;
    for (const h of run.hazards.hazards) {
      if (h.dead || h.intangible || h.def.boss || patch.hit.has(h)) continue;
      if (Math.hypot(h.x - patch.x, h.z - patch.z) > patch.radius + hazardRadius(h)) continue;
      patch.hit.add(h);
      if (sys) sys.stunHazard(h, FX.thunderstruckStun);
      else {
        h.stunnedFor = Math.max(h.stunnedFor ?? 0, FX.thunderstruckStun);
        h.stun?.(FX.thunderstruckStun);
      }
      run.events.emit('staticPatchStunned', { hazardId: h.id, defId: h.def.id, seconds: FX.thunderstruckStun });
    }
  }

  /** Recharge Snack: the Debris just absorbed at (x, z), if it was tagged Discharge scrap. */
  private absorbed(x: number, z: number): void {
    for (const [d, budget] of this.scrap) {
      if (d.alive) continue;
      this.scrap.delete(d);
      if (d.x !== x || d.z !== z) continue;
      const refund = perStack(FX.rechargeSnackRefund, this.run.perkStacks('recharge_snack'));
      const discharge = this.discharge;
      if (refund === undefined || !discharge) return;
      const amount = Math.min(refund, budget.left, 1 - discharge.charge);
      if (amount <= 1e-9) return;
      budget.left -= amount;
      discharge.charge += amount;
      this.run.events.emit('rechargeSnack', { amount, charge: discharge.charge });
      return;
    }
  }

  private clear(): void {
    for (const p of this.patches) p.view.dispose();
    this.patches.length = 0;
    this.scrap.clear();
    for (const v of this.bolts) v.dispose();
    this.bolts.length = 0;
    for (const v of this.bursts) v.dispose();
    this.bursts.length = 0;
  }

  dispose(): void {
    this.clear();
  }
}

/** The Run's Zap Perk effects, if installed. */
export function getZapPerks(run: Run): ZapPerks | undefined {
  return run.getSystem<ZapPerks>(ZAP_PERKS_SYSTEM_ID);
}

/** Installs Zap's Perk effects on a Zap Run (once). */
export function installZapPerks(run: Run): void {
  if (getZapPerks(run)) return;
  run.addSystem(new ZapPerks(run));
}
