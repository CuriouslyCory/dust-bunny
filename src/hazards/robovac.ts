/**
 * Area bosses. Robo-Vac 9000 (house, Tier 5): arrives with an intro, hunts the Bunny with mild
 * suction, telegraphs charges with a red lane on the floor, and summons mini Roombas. A charge
 * that ends in a wall stuns it: ramming it while stunned chips it smaller (and knocks absorbable
 * parts loose). Once size ≤ Bunny radius × absorbRatio it can be absorbed, which clears the
 * house: the front door opens and the Run continues in the neighborhood.
 *
 * Street Sweeper (neighborhood, Tier 7): the same state machine with STREET_SWEEPER tuning. Its
 * charges are stunned by houses, trees and the hedge, it summons mini mowers, and absorbing it
 * opens the road barrier to the city.
 *
 * Garbage Truck (city, Tier 9, GARBAGE_TRUCK): its compactor sucks the Bunny in while it hunts,
 * buildings and the concrete barrier stun its charges, and it summons mini scrubbers. Absorbing
 * it opens the highway on-ramp to the region.
 *
 * The Incinerator (region, Tier 11, INCINERATOR): rail-mounted waste plant. Its feed conveyor sucks
 * the Bunny in while it hunts, towns and the map edge stun its charges, it summons mini compactors,
 * and its chimney fires ash volleys (`BossTuning.ash`): an amber lane locks on the target, then a
 * burst of ash pellets flies along it; a hit deals damage and sheds mass (`shedMass`). The volley
 * aims through `aimTarget` (the Decoy pops it, `lure.shot`; nothing while the Bunny is hidden),
 * only starts on screen, and a planted Tumble takes nothing (its damage filter and `shedMass`).
 *
 * Every boss with onDefeat 'openExit' calls `run.clearArea()`: the exit opens, or in the last
 * built Area the Run is won (bossDefeated → victory → runEnded 'victory').
 *
 * Abilities (src/abilities): bosses hunt and telegraph at Lint's Decoy while it is within
 * `chargeTrigger` (aimTarget) and their suction drags it in. `abilityStun` is the external stun
 * (a clog, a Hunker crash, a Discharge): it enters the same `stunned` state as a wall crash, so
 * one chip lands on contact. `bounceOff` is the crash into a planted Tumble when no stun is
 * allowed (the 6 s Ability-stun limit).
 */
import type { Rng } from '../core/rng';
import { GARBAGE_TRUCK, INCINERATOR, ROBOVAC_9000, STREET_SWEEPER, type AshTuning, type BossTuning } from '../data/hazards';
import type { Run } from '../game/run';
import { onScreen } from '../systems/camera';
import { BaseHazard } from './base';
import { maxSpeedFor } from '../systems/movement';
import { absorbRadiusFor, activeLure, aimTarget, applySuction, bunnySheltered, hazardFloorFree, hitBunny, knockbackCm, moveCircle, pullLure, randomIn, separateFromBunny, suctionFalloff, suctionReachFor, turnTowards, yawOf } from './common';
import { DECAL_COLORS, laneDecal, ringDecal } from './decals';
import { HazardManager, hazardRegistry, type HazardDef } from './index';
import { projectileMaterial, Volley, type Projectile } from './projectiles';
import { scatterDebris, shedMass } from './shed';

/** The ash volley's phase: waiting, amber lane locked on the target, pellets leaving the chimney. */
export type AshState = 'idle' | 'telegraph' | 'firing';

export type BossState = 'intro' | 'hunt' | 'telegraph' | 'charge' | 'stunned' | 'recover';

/** What stunned the boss last: a wall crash, Spiky Dash, or an Ability (src/abilities). */
export type BossStunCause = 'wall' | 'spiky' | 'decoy' | 'hunker' | 'discharge';

/** Size after `hits` chips. */
export function bossSizeAfterHits(hits: number, size = ROBOVAC_9000.size, chipFactor = ROBOVAC_9000.chipFactor): number {
  return size * chipFactor ** hits;
}

export class RoboVac9000 extends BaseHazard {
  state: BossState = 'intro';
  private timer: number;
  private chargeDirX = 0;
  private chargeDirZ = 1;
  private charged = 0;
  private summonTimer: number;
  /** Chip already taken during the current stun. */
  private hitThisStun = false;
  hits = 0;
  /** Cause of the current / last stun (Keepsake effects such as Dead Weight read it on bossHit). */
  stunCause: BossStunCause | null = null;
  /** Grounded: seconds after a Discharge during which it can't be Discharged again (counted down by the Ability System). */
  groundedFor = 0;
  /**
   * Extra effect of the chip taken during the current stun (Dead Weight sets it for Hunker
   * stuns): the stun lasts `hold` more seconds after the chip and `pieces` more parts fall off.
   * Cleared whenever a new stun starts.
   */
  chipBonus: { hold: number; pieces: number } | null = null;
  readonly minis = new Set<number>();
  private readonly lane;
  private readonly stunRing;
  /** Ash volley (bosses with `cfg.ash`): phase, timers, locked aim and pellets in flight. */
  ashState: AshState = 'idle';
  private ashTimer = 0;
  private ashLeft = 0;
  /** Locked volley direction (yaw) and launch point. */
  ashYaw = 0;
  private ashX = 0;
  private ashZ = 0;
  private readonly ashVolley: Volley | null = null;
  private readonly ashLane;

  constructor(
    id: number,
    def: HazardDef,
    x: number,
    z: number,
    private readonly rng: Rng,
    readonly cfg: BossTuning = ROBOVAC_9000,
  ) {
    super(id, def, x, z, cfg.size, cfg.modelId);
    // Full-size model scale; chips shrink `body` on top of it (see sync).
    this.model.scale.setScalar(cfg.size / cfg.modelSize);
    this.timer = cfg.introTime;
    this.summonTimer = cfg.summonInterval * 0.6;
    this.shape = { kind: 'circle', radius: cfg.contactRadius };
    this.lane = this.addDecal(laneDecal(cfg.chargeDistance, cfg.contactRadius * 2, DECAL_COLORS.danger, 0.4));
    this.lane.visible = false;
    this.stunRing = this.addDecal(ringDecal(1, 1.18, DECAL_COLORS.warn, 0.7));
    this.stunRing.visible = false;
    const ash = cfg.ash;
    this.ashLane = this.addDecal(laneDecal(1, (ash?.radius ?? 1) * 4, DECAL_COLORS.warn, 0.45));
    this.ashLane.visible = false;
    if (ash) {
      this.ashVolley = new Volley(this.object3d, projectileMaterial('#3a3836', '#ff6a1a', 1));
      this.ashTimer = ash.interval;
    }
  }

  /** Ash pellets in flight (empty for bosses without `cfg.ash`). */
  get ash(): readonly Projectile[] {
    return this.ashVolley?.items ?? [];
  }

  /** Visual + contact scale relative to full size. */
  get scale(): number {
    return this.size / this.cfg.size;
  }

  absorbRadius(run: Run): number {
    return absorbRadiusFor(this.size, run.bunny.stats.get('absorbRatio'));
  }

  protected tick(dt: number, run: Run): void {
    const c = this.cfg;
    const b = run.bunny;
    const radius = c.contactRadius * this.scale;
    const dx = b.x - this.x;
    const dz = b.z - this.z;
    const dist = Math.hypot(dx, dz);
    this.timer -= dt;
    this.spin('brush_l', dt * c.brushSpin);
    this.spin('brush_r', -dt * c.brushSpin);

    switch (this.state) {
      case 'intro': {
        const t = aimTarget(run, this.x, this.z, c.chargeTrigger);
        if (t) this.yaw = turnTowards(this.yaw, yawOf(t.x - this.x, t.z - this.z), c.turnRate * dt);
        if (this.timer <= 0) {
          // First summon comes sooner than the rest (the constructor has no Run for the Difficulty).
          this.summonTimer = this.attackTime(run, c.summonInterval * 0.6);
          this.enter('hunt', randomIn(this.rng, c.huntTime));
        }
        break;
      }
      case 'hunt': {
        // Aim at the Decoy when it is close, else the Bunny; hidden Bunny (Dust Cloud): wander.
        const t = aimTarget(run, this.x, this.z, c.chargeTrigger);
        if (t) this.yaw = turnTowards(this.yaw, yawOf(t.x - this.x, t.z - this.z), c.turnRate * dt);
        else this.yaw += Math.sin(this.time * 0.7) * dt;
        this.drive(run, this.speed(run, c.huntSpeed) * dt, radius);
        if (!bunnySheltered(run, c.height)) {
          const reach = radius + suctionReachFor(c.suctionReach, b.stats.get('suctionMultiplier'));
          applySuction(run, this.x, this.z, c.suctionStrength, suctionFalloff(dist - b.radius, radius, reach), dt);
        }
        const lure = activeLure(run);
        if (lure) {
          // The intake drags the Decoy in too (touching it clogs the boss).
          const ld = Math.hypot(lure.x - this.x, lure.z - this.z) - lure.radius;
          const falloff = suctionFalloff(ld, radius, radius + c.suctionReach);
          if (falloff > 0) pullLure(run, this.x, this.z, maxSpeedFor(b) * c.suctionStrength * falloff, dt);
        }
        this.summonTimer -= dt;
        if (this.summonTimer <= 0) {
          this.summonTimer = this.attackTime(run, c.summonInterval);
          this.summon(run);
        }
        if (this.timer <= 0 && t && Math.hypot(t.x - this.x, t.z - this.z) < c.chargeTrigger && onScreen(run, this.x, this.z)) {
          this.enter('telegraph', this.attackTime(run, c.telegraph));
          this.yaw = yawOf(t.x - this.x, t.z - this.z);
          this.chargeDirX = Math.sin(this.yaw);
          this.chargeDirZ = Math.cos(this.yaw);
          this.lane.visible = true;
          this.emitTelegraph(run, 'charge', this.timer);
        }
        break;
      }
      case 'telegraph':
        this.lane.place(this.x, this.z, this.yaw);
        this.lane.root.scale.set(this.scale, 1, 1);
        this.lane.pulse(this.time, 1 - this.timer / this.attackTime(run, c.telegraph));
        if (this.timer <= 0) {
          this.enter('charge', 99);
          this.charged = 0;
        }
        break;
      case 'charge': {
        const step = this.speed(run, c.chargeSpeed) * dt;
        const m = this.drive(run, step, radius, this.chargeDirX, this.chargeDirZ);
        this.charged += step;
        this.lane.setOpacity(0.25);
        if (m.hit) {
          this.lane.visible = false;
          this.hitThisStun = false;
          this.chipBonus = null;
          this.stunCause = 'wall';
          this.enter('stunned', c.stunTime);
          run.events.emit('bossStunned', { hazardId: this.id, cause: 'wall' });
        } else if (this.charged >= c.chargeDistance) {
          this.lane.visible = false;
          this.enter('recover', c.recover);
        }
        break;
      }
      case 'stunned':
        this.yaw += Math.sin(this.time * 40) * 0.02;
        if (this.timer <= 0) this.enter('recover', c.recover);
        break;
      case 'recover':
        if (this.timer <= 0) this.enter('hunt', randomIn(this.rng, c.huntTime));
        break;
    }

    if (c.ash) this.updateAsh(dt, run, c.ash);

    this.stunRing.visible = this.state === 'stunned';
    if (this.stunRing.visible) {
      this.stunRing.place(this.x, this.z);
      this.stunRing.root.scale.set(radius * 1.1, 1, radius * 1.1);
      this.stunRing.pulse(this.time, 0.5);
    }
  }

  /** Chimney position on the floor plane (`originOffset` × size along the facing). */
  private ashOrigin(a: AshTuning): { x: number; z: number } {
    const o = this.size * a.originOffset;
    return { x: this.x + Math.sin(this.yaw) * o, z: this.z + Math.cos(this.yaw) * o };
  }

  /**
   * Ash volley: every `interval` s while hunting or recovering on screen it locks a lane from the
   * chimney at its aim target, then fires `count` pellets along it. Pellets in the air keep flying.
   */
  private updateAsh(dt: number, run: Run, a: AshTuning): void {
    // A stun, or losing sight of the Bunny (Dust Cloud), cancels a volley that hasn't fired yet.
    if (this.ashState === 'telegraph' && (this.state === 'stunned' || !aimTarget(run, this.x, this.z, a.range))) {
      this.ashState = 'idle';
      this.ashTimer = this.attackTime(run, a.interval) * 0.5;
    }
    this.ashTimer -= dt;
    if (this.ashState === 'idle') {
      if (this.ashTimer <= 0 && (this.state === 'hunt' || this.state === 'recover')) {
        const o = this.ashOrigin(a);
        const t = aimTarget(run, o.x, o.z, a.range);
        if (t && Math.hypot(t.x - o.x, t.z - o.z) < a.range + t.radius && onScreen(run, this.x, this.z)) {
          this.ashState = 'telegraph';
          this.ashTimer = this.attackTime(run, a.telegraph);
          this.ashYaw = yawOf(t.x - o.x, t.z - o.z);
          this.emitTelegraph(run, 'ash', this.ashTimer);
        } else {
          this.ashTimer = 0.5;
        }
      }
    } else if (this.ashState === 'telegraph') {
      if (this.ashTimer <= 0) {
        this.ashState = 'firing';
        this.ashLeft = a.count;
        this.ashTimer = 0;
      }
    } else if (this.ashTimer <= 0) {
      const o = this.ashOrigin(a);
      const yaw = this.ashYaw + this.rng.range(-a.spread, a.spread);
      this.ashVolley!.fire(o.x, o.z, yaw, this.speed(run, a.speed), a.range, a.radius);
      this.ashLeft--;
      this.ashTimer = a.gap;
      if (this.ashLeft <= 0) {
        this.ashState = 'idle';
        this.ashTimer = this.attackTime(run, a.interval);
      }
    }
    if (this.ashState !== 'idle') {
      // The lane stays locked where the volley was aimed; the launch point follows the chimney.
      const o = this.ashOrigin(a);
      this.ashX = o.x;
      this.ashZ = o.z;
    }
    this.ashLane.visible = this.ashState === 'telegraph';
    if (this.ashLane.visible) {
      this.ashLane.place(this.ashX, this.ashZ, this.ashYaw);
      this.ashLane.root.scale.set(1, 1, a.range);
      this.ashLane.pulse(this.time, 1 - this.ashTimer / this.attackTime(run, a.telegraph));
    }
    const b = run.bunny;
    this.ashVolley!.update(dt, run, this, { radius: a.radius, height: this.cfg.height * this.scale, blockHeight: this.cfg.height }, (p) => {
      if (hitBunny(run, p.x, p.z, { damage: a.damage, source: this.def.id, knockbackCm: a.knockbackCm, knockbackRadii: a.knockbackRadii, dirX: p.vx, dirZ: p.vz }) && b.alive) {
        shedMass(run, this.rng, a.shedFraction, this.def.id);
      }
    });
  }

  /** Spiky Dash stun: it can be chipped once during it, like a wall crash. */
  override stun(_seconds: number): void {
    this.hitThisStun = false;
    this.chipBonus = null;
    this.stunCause = 'spiky';
  }

  /**
   * External stun from an Ability (Decoy clog, Hunker crash, Discharge): cancels any telegraph or
   * charge and enters the `stunned` state for `seconds`, so one chip lands on contact. The Ability
   * System enforces the 6 s boss limit before calling this.
   */
  abilityStun(run: Run, seconds: number, cause: Exclude<BossStunCause, 'wall' | 'spiky'>): void {
    this.lane.visible = false;
    this.hitThisStun = false;
    this.chipBonus = null;
    this.stunCause = cause;
    // Never cut short a stun that is already running.
    this.enter('stunned', this.state === 'stunned' ? Math.max(this.timer, seconds) : seconds);
    run.events.emit('bossStunned', { hazardId: this.id, cause });
  }

  /** True in the states where running into a planted Tumble stuns it (hunting or mid-charge). */
  get crashesIntoPlanted(): boolean {
    return this.state === 'hunt' || this.state === 'charge';
  }

  /** Bounces off a planted Tumble without a stun: a charge ends, and it backs off out of contact. */
  bounceOff(run: Run): void {
    if (this.state === 'charge' || this.state === 'hunt') {
      this.lane.visible = false;
      this.enter('recover', this.cfg.recover);
    }
    separateFromBunny(run, this, this.cfg.contactRadius * this.scale, this.cfg.height);
  }

  private enter(state: BossState, time: number): void {
    this.state = state;
    this.timer = time;
  }

  private drive(run: Run, step: number, radius: number, dirX = Math.sin(this.yaw), dirZ = Math.cos(this.yaw)) {
    const m = moveCircle(run.house, this.x, this.z, radius, this.cfg.height, dirX * step, dirZ * step);
    this.x = m.x;
    this.z = m.z;
    return m;
  }

  private summon(run: Run): void {
    const c = this.cfg;
    for (const id of [...this.minis]) if (!run.hazards.hazards.some((h) => h.id === id && !h.dead)) this.minis.delete(id);
    const fp = HazardManager.footprint(c.miniId);
    for (let n = 0; n < c.summonCount && this.minis.size < c.maxMinis; n++) {
      for (let tries = 0; tries < 8; tries++) {
        const a = this.rng.range(0, Math.PI * 2);
        const d = c.contactRadius * this.scale + fp.radius + 9 / run.unit;
        const x = this.x + Math.cos(a) * d;
        const z = this.z + Math.sin(a) * d;
        if (!hazardFloorFree(run.house, x, z, fp.radius, fp.height)) continue;
        this.minis.add(run.hazards.spawn(c.miniId, x, z).id);
        break;
      }
    }
  }

  protected override sync(run: Run): void {
    this.shape = { kind: 'circle', radius: this.cfg.contactRadius * this.scale };
    this.body.scale.setScalar(this.scale);
    super.sync(run);
  }

  onContact(run: Run): void {
    const c = this.cfg;
    const b = run.bunny;
    if (bunnySheltered(run, c.height)) return;
    const radius = c.contactRadius * this.scale;
    if (this.state === 'stunned' || this.stunned) {
      if (!this.hitThisStun) {
        this.hitThisStun = true;
        this.hits++;
        this.size = bossSizeAfterHits(this.hits, c.size, c.chipFactor);
        // Parts knocked loose: absorbable Debris around the boss.
        const bonus = this.chipBonus;
        scatterDebris(run, this.rng, this.x, this.z, c.chipPieces + (bonus?.pieces ?? 0), b.radius * 0.45, radius + b.radius, radius + b.radius * 4);
        run.events.emit('bossHit', { hazardId: this.id, size: this.size, absorbRadius: this.absorbRadius(run) });
        if (this.state === 'stunned') this.timer = Math.min(this.timer, 0.6 + (bonus?.hold ?? 0));
      }
      knockbackCm(b, b.x - this.x, b.z - this.z, b.radius * 2);
      separateFromBunny(run, this, radius, c.height);
      return;
    }
    const knock = this.state === 'charge' ? 1.5 : 1;
    if (hitBunny(run, this.x, this.z, { damage: c.damage, source: this.def.id, knockbackCm: c.knockbackCm * knock, knockbackRadii: c.knockbackRadii * knock }) && b.alive) {
      shedMass(run, this.rng, c.shedFraction, this.def.id);
    }
    separateFromBunny(run, this, radius, c.height);
  }

  override dispose(): void {
    this.ashVolley?.clear();
    super.dispose();
  }

  override onAbsorbed(run: Run): void {
    super.onAbsorbed(run);
    for (const h of run.hazards.hazards) if (this.minis.has(h.id)) h.dead = true;
    run.events.emit('bossDefeated', { hazardId: this.id, defId: this.def.id, timeSec: run.time });
    if (this.cfg.onDefeat === 'victory') {
      run.events.emit('victory', { timeSec: run.time, radius: run.bunny.realRadius });
      run.end('victory');
    } else {
      // The area is cleared: its exit opens onto the next area, or the last built Area wins the Run.
      run.clearArea();
    }
  }
}

export const robovacDef = hazardRegistry.register({
  id: 'robovac_9000',
  name: 'Robo-Vac 9000',
  boss: true,
  // Full-size contact radius: room for the boss before it is chipped.
  footprint: { radius: ROBOVAC_9000.contactRadius, height: ROBOVAC_9000.height },
  mass: ROBOVAC_9000.mass,
  modelId: 'robovac_9000',
  create(_run, x, z, id, rng: Rng) {
    return new RoboVac9000(id, this, x, z, rng, ROBOVAC_9000);
  },
});

export const streetSweeperDef = hazardRegistry.register({
  id: 'street_sweeper',
  name: 'Street Sweeper',
  boss: true,
  // Full-size contact radius: room for the boss before it is chipped.
  footprint: { radius: STREET_SWEEPER.contactRadius, height: STREET_SWEEPER.height },
  mass: STREET_SWEEPER.mass,
  modelId: STREET_SWEEPER.modelId,
  create(_run, x, z, id, rng: Rng) {
    return new RoboVac9000(id, this, x, z, rng, STREET_SWEEPER);
  },
});

export const garbageTruckDef = hazardRegistry.register({
  id: 'garbage_truck',
  name: 'Garbage Truck',
  boss: true,
  // Full-size contact radius: room for the boss before it is chipped.
  footprint: { radius: GARBAGE_TRUCK.contactRadius, height: GARBAGE_TRUCK.height },
  mass: GARBAGE_TRUCK.mass,
  modelId: GARBAGE_TRUCK.modelId,
  create(_run, x, z, id, rng: Rng) {
    return new RoboVac9000(id, this, x, z, rng, GARBAGE_TRUCK);
  },
});

export const incineratorDef = hazardRegistry.register({
  id: 'incinerator',
  name: 'The Incinerator',
  boss: true,
  // Full-size contact radius: room for the boss before it is chipped.
  footprint: { radius: INCINERATOR.contactRadius, height: INCINERATOR.height },
  mass: INCINERATOR.mass,
  modelId: INCINERATOR.modelId,
  create(_run, x, z, id, rng: Rng) {
    return new RoboVac9000(id, this, x, z, rng, INCINERATOR);
  },
});
