/**
 * Zap · Discharge (tap when full).
 *
 * Static meter (bunny.staticCharge, 0..1): rolling faster than minSpeedFraction of max speed adds
 * the distance rolled (in Bunny radii, × dashMultiplier while dashing, × fillRate) over
 * fillDistance; below drainSpeedFraction of max speed it drains drainPerSec per second, once Zap has
 * been that slow for longer than drainDelay seconds (Capacitor; 0 = at once).
 *
 * When full, the nearest Hazard whose edge is within `range` Bunny radii of the Bunny's surface
 * is the target (spark marker). Intangible Hazards (the Expansion), absorbable Hazards, Grounded
 * bosses and bosses inside the 6 s Ability-stun limit are skipped. Tapping shorts it out and
 * empties the meter:
 *   - non-boss (minis included): destroyed, bursting into scrapPieces absorbable scrap of
 *     scrapSize × r (scatterDebris), none of its own mass; plus up to extraTargets more non-boss
 *     Hazards within arcRange r of the first (Arc);
 *   - boss: stunned for bossStun (no hit: Zap still has to touch it), then Grounded for
 *     groundedFor seconds.
 * The scrap of one Discharge (Arc targets included) is reported to hooks.dischargeScrap
 * (Recharge Snack). spend() empties the meter without firing (Emergency Discharge).
 */
import type { InputState } from '../core/input';
import type { Debris } from '../entities/debris';
import type { Hazard } from '../hazards';
import { bunnyCanAbsorb } from '../hazards/common';
import { scatterDebrisPieces } from '../hazards/shed';
import { maxSpeedFor } from '../systems/movement';
import { AbilitySystem, hazardRadius, isBoss, registerAbilityController, type AbilityController } from './system';
import { BoltView, SparkMarkerView } from './view';

const CLING_SOURCE = 'ability:discharge:cling';
const GROUNDING_SOURCE = 'ability:discharge:grounding';
/** Conditional Keepsake stat effects (Static Cling, Grounding) sit before the cap stage, so caps still hold. */
const CHARGED_STAT_PRIORITY = 150;

export class DischargeAbility implements AbilityController {
  readonly id = 'discharge';
  /** Nearest valid target while the meter is full (null otherwise). */
  target: Hazard | null = null;
  private readonly marker = new SparkMarkerView();
  private readonly bolts: BoltView[] = [];
  private time = 0;
  private full = false;
  /** Seconds Zap has been below drainSpeedFraction of max speed (Capacitor's drainDelay). */
  private slowFor = 0;
  /** Static Cling's and Grounding's installed values (0 / 1 = not installed). */
  private cling = 0;
  private grounding = 1;

  constructor(private readonly system: AbilitySystem) {
    system.run.bunny.staticCharge = 0;
    system.run.entityRoot.add(this.marker.root);
  }

  private get p() {
    return this.system.params.discharge;
  }

  get charge(): number {
    return this.system.run.bunny.staticCharge ?? 0;
  }

  set charge(v: number) {
    this.system.run.bunny.staticCharge = Math.min(1, Math.max(0, v));
  }

  get ready(): boolean {
    return this.charge >= 1;
  }

  update(dt: number, input: InputState): void {
    const run = this.system.run;
    const b = run.bunny;
    this.time += dt;
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      if (!this.bolts[i]!.update(dt)) {
        this.bolts[i]!.dispose();
        this.bolts.splice(i, 1);
      }
    }
    const p = this.p;
    const max = maxSpeedFor(b);
    const speed = b.speed;
    if (max > 0 && speed > p.minSpeedFraction * max) {
      const radii = (speed * dt) / Math.max(b.radius, 1e-3);
      this.charge += ((radii * (b.dashing ? p.dashMultiplier : 1)) / p.fillDistance) * p.fillRate;
    }
    if (speed < p.drainSpeedFraction * max) {
      this.slowFor += dt;
      if (this.slowFor > p.drainDelay) this.charge -= p.drainPerSec * dt;
    } else this.slowFor = 0;
    const full = this.ready;
    if (full && !this.full) run.events.emit('staticFull', { x: b.x, z: b.z });
    this.full = full;
    this.syncStats();

    this.target = full ? this.findTarget() : null;
    const t = this.target;
    this.marker.update(this.time, t ? { x: t.x, z: t.z, radius: hazardRadius(t), height: Math.min(hazardRadius(t), b.radius * 2) } : null, b.radius);
    if (input.ability && t && b.alive) this.fire(t);
  }

  /**
   * Static Cling (meter ≥ 50%) and Grounding (meter full) stat effects, when their params are set.
   * Compares values, not just on/off, so a copy tucked in mid-Run takes effect while charged.
   */
  private syncStats(): void {
    const stats = this.system.run.bunny.stats;
    const cling = this.charge >= 0.5 ? this.p.chargedMagnetBonus : 0;
    if (cling !== this.cling) {
      this.cling = cling;
      stats.removeSource(CLING_SOURCE);
      if (cling > 0) stats.add({ stat: 'magnetRadius', op: 'add', value: cling, source: CLING_SOURCE, priority: CHARGED_STAT_PRIORITY });
    }
    const grounding = this.full ? this.p.fullSuctionMul : 1;
    if (grounding !== this.grounding) {
      this.grounding = grounding;
      stats.removeSource(GROUNDING_SOURCE);
      if (grounding !== 1) stats.add({ stat: 'suctionMultiplier', op: 'mul', value: grounding, source: GROUNDING_SOURCE, priority: CHARGED_STAT_PRIORITY });
    }
  }

  /** Can this Hazard be shorted out right now? */
  canTarget(h: Hazard): boolean {
    if (h.dead || h.intangible || bunnyCanAbsorb(this.system.run, h.size)) return false;
    if (isBoss(h)) return !(h.groundedFor && h.groundedFor > 0) && this.system.canStunBoss(h);
    return true;
  }

  /** Nearest valid Hazard whose edge is within range × r of the Bunny's surface. */
  findTarget(): Hazard | null {
    const b = this.system.run.bunny;
    const reach = this.p.range * b.radius;
    let best: Hazard | null = null;
    let bestD = Infinity;
    for (const h of this.system.run.hazards.hazards) {
      if (!this.canTarget(h)) continue;
      const gap = Math.hypot(h.x - b.x, h.z - b.z) - b.radius - hazardRadius(h);
      if (gap <= reach && gap < bestD) {
        bestD = gap;
        best = h;
      }
    }
    return best;
  }

  fire(first: Hazard): void {
    const run = this.system.run;
    const b = run.bunny;
    const targets = [first];
    if (this.p.extraTargets > 0 && !isBoss(first)) {
      const reach = this.p.arcRange * b.radius;
      const near = run.hazards.hazards
        .filter((h) => h !== first && !isBoss(h) && this.canTarget(h) && Math.hypot(h.x - first.x, h.z - first.z) - hazardRadius(h) <= reach)
        .sort((a, c) => Math.hypot(a.x - first.x, a.z - first.z) - Math.hypot(c.x - first.x, c.z - first.z));
      targets.push(...near.slice(0, Math.round(this.p.extraTargets)));
    }
    this.spend();
    run.events.emit('abilityUsed', { ability: 'discharge', x: b.x, z: b.z });
    let fromX = b.x;
    let fromZ = b.z;
    const scrap: Debris[] = [];
    for (const h of targets) {
      this.short(h, fromX, fromZ, scrap);
      fromX = h.x;
      fromZ = h.z;
    }
    this.system.hooks.discharged?.(run, targets);
    if (scrap.length > 0) this.system.hooks.dischargeScrap?.(run, scrap);
  }

  /** Empties the meter without firing (Emergency Discharge), keeping the charged-state effects in step. */
  spend(): void {
    this.charge = 0;
    this.full = false;
    this.syncStats();
    this.target = null;
  }

  private short(h: Hazard, fromX: number, fromZ: number, scrap: Debris[]): void {
    const run = this.system.run;
    const b = run.bunny;
    const p = this.p;
    const hr = hazardRadius(h);
    const bolt = new BoltView(this.system.rng, fromX, fromZ, b.radius, h.x, h.z, Math.min(hr, b.radius * 2), Math.max(0.8, b.radius * 0.14));
    run.entityRoot.add(bolt.root);
    this.bolts.push(bolt);
    if (isBoss(h)) {
      this.system.stunBoss(h, p.bossStun, 'discharge');
      h.groundedFor = p.groundedFor;
    } else {
      h.dead = true;
      scrap.push(...scatterDebrisPieces(run, this.system.rng, h.x, h.z, p.scrapPieces, p.scrapSize * b.radius, hr * 0.3, hr + b.radius * 1.5));
    }
    run.events.emit('hazardShorted', { hazardId: h.id, defId: h.def.id, boss: !!h.def.boss, x: h.x, z: h.z, fromX, fromZ });
  }

  hud() {
    return { ready: this.ready, active: false, ring: this.charge, label: null };
  }

  areaChanged(): void {
    this.target = null;
  }

  dispose(): void {
    const b = this.system.run.bunny;
    b.stats.removeSource(CLING_SOURCE);
    b.stats.removeSource(GROUNDING_SOURCE);
    this.marker.dispose();
    for (const bolt of this.bolts) bolt.dispose();
    this.bolts.length = 0;
  }
}

registerAbilityController('discharge', (system) => new DischargeAbility(system));
