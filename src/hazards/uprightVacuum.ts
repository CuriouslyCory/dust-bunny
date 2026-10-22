/**
 * Upright Vacuum: slow, turns towards the Bunny, and cycles a strong suction cone out of its
 * intake. The cone is drawn on the floor: blinking amber while warming up, blue while on.
 * Contact: 1 damage, knockback, and it sucks some mass off the Bunny.
 *
 * The Leaf Blower (outdoors) is the same Hazard in reverse (LEAF_BLOWER tuning, mode 'blow'):
 * after the amber warm-up the cone blasts the Bunny away from the nozzle (stronger up close)
 * and blows small Debris along. It only starts a blast while on screen.
 *
 * The Litter Vacuum (city, LITTER_VACUUM) is a street-scale Upright Vacuum in suction mode. The
 * Water Bomber (region, WATER_BOMBER) is a Leaf Blower whose blast also soaks the Bunny
 * (`wetSeconds`: the `hazard:wet` slow, like the Mop's trail). The Hurricane (continent, HURRICANE)
 * is a Water Bomber that spins its cloud `bands` (`spinNode`): its wind cone blasts the Bunny away
 * from the eyewall and the rain soaks it. The Globe's Hurricane (GLOBE_HURRICANE, a hurricane seen
 * from orbit) does the same, spinning its `spiral`, and is placed over oceans and shelf seas.
 *
 * Lint's Decoy: within reach of the cone it turns to the Decoy instead of the Bunny. The suction
 * cone drags the Decoy into the intake (touching it clogs the vacuum); a blast pops it (the Leaf
 * Blower is ranged, so it is never clogged).
 */
import type { Rng } from '../core/rng';
import { GLOBE_HURRICANE, SOLAR_FLARE, HAZARD_RECOIL, HURRICANE, LEAF_BLOWER, LITTER_VACUUM, UPRIGHT_VACUUM, WATER_BOMBER, type AirConeTuning } from '../data/hazards';
import { TIMED_PRIORITY } from '../entities/stats';
import type { Run } from '../game/run';
import { onScreen } from '../systems/camera';
import { isFloorFree } from '../systems/spawner';
import type { Debris } from '../entities/debris';
import { BaseHazard } from './base';
import { maxSpeedFor } from '../systems/movement';
import { activeLure, aimTarget, applyPush, applySuction, bunnySheltered, hitBunny, moveCircle, pullLure, separateFromBunny, suctionFalloff, suctionReachFor, turnTowards, wrapAngle, yawOf } from './common';
import { DECAL_COLORS, sectorDecal } from './decals';
import { hazardRegistry, tuningFootprint, type HazardDef } from './index';
import { WET_SOURCE } from './mop';
import { shedMass } from './shed';

type VacuumState = 'off' | 'warmup' | 'on';

/** True if (px, pz) is inside a cone from (ox, oz) facing `yaw` with the given half-angle and range. */
export function inCone(ox: number, oz: number, yaw: number, halfAngle: number, range: number, px: number, pz: number, pad = 0): boolean {
  const dx = px - ox;
  const dz = pz - oz;
  const d = Math.hypot(dx, dz);
  if (d > range + pad) return false;
  if (d <= pad) return true;
  // Allow the target's radius to poke into the cone.
  const slack = Math.asin(Math.min(1, pad / d));
  return Math.abs(wrapAngle(yawOf(dx, dz) - yaw)) <= halfAngle + slack;
}

const _debris: Debris[] = [];

export class UprightVacuum extends BaseHazard {
  state: VacuumState = 'off';
  private timer: number;
  private readonly cone;

  constructor(
    id: number,
    def: HazardDef,
    x: number,
    z: number,
    private readonly rng: Rng,
    readonly cfg: AirConeTuning = UPRIGHT_VACUUM,
  ) {
    super(id, def, x, z, cfg.size, cfg.modelId);
    this.model.scale.setScalar(cfg.size / cfg.modelSize);
    this.recoilHeight = cfg.height;
    this.yaw = rng.range(-Math.PI, Math.PI);
    this.timer = rng.range(0.5, cfg.off);
    this.cone = this.addDecal(sectorDecal(0, cfg.coneRange, cfg.coneHalfAngle * 2, DECAL_COLORS.warn, 0.35));
    this.cone.visible = false;
  }

  get blows(): boolean {
    return this.cfg.mode === 'blow';
  }

  /** The Leaf Blower is a ranged Hazard: it aims at the Decoy but is never clogged. */
  get ranged(): boolean {
    return this.blows;
  }

  /** Intake (or nozzle) point at the front. */
  private intake(): { x: number; z: number } {
    const o = this.size * this.cfg.nozzleOffset;
    return { x: this.x + Math.sin(this.yaw) * o, z: this.z + Math.cos(this.yaw) * o };
  }

  protected tick(dt: number, run: Run): void {
    const c = this.cfg;
    const b = run.bunny;
    this.timer -= dt;
    if (c.spinNode) this.spin(c.spinNode, dt * (c.spinRate ?? 0));
    const range = suctionReachFor(c.coneRange, b.stats.get('suctionMultiplier'));
    const t = aimTarget(run, this.x, this.z, range + this.size);
    if (t) this.yaw = turnTowards(this.yaw, yawOf(t.x - this.x, t.z - this.z), c.turnRate * dt);
    const speed = this.tierSpeed(run, c.speed) * (this.state === 'on' ? 0.5 : 1);
    const m = moveCircle(run.house, this.x, this.z, this.size, c.height, Math.sin(this.yaw) * speed * dt, Math.cos(this.yaw) * speed * dt);
    this.x = m.x;
    this.z = m.z;

    if (this.timer <= 0) {
      if (this.state === 'off') {
        // A blast is a ranged attack: only start it where the player can see the telegraph.
        if (this.blows && !onScreen(run, this.x, this.z)) {
          this.timer = 0.3;
        } else {
          this.state = 'warmup';
          this.timer = this.attackTime(run, c.warmup);
          this.cone.setColor(DECAL_COLORS.warn);
          this.emitTelegraph(run, this.blows ? 'blow' : 'suction', this.timer);
        }
      } else if (this.state === 'warmup') {
        this.state = 'on';
        this.timer = c.on;
        this.cone.setColor(this.blows ? DECAL_COLORS.air : DECAL_COLORS.suction);
      } else {
        this.state = 'off';
        this.timer = this.attackTime(run, c.off) * this.rng.range(0.8, 1.2);
      }
    }

    const it = this.intake();
    this.cone.visible = this.state !== 'off';
    this.cone.place(it.x, it.z, this.yaw);
    this.cone.root.scale.setScalar(range / c.coneRange);
    if (this.state === 'warmup') this.cone.pulse(this.time, 1 - this.timer / this.attackTime(run, c.warmup));
    else if (this.state === 'on') this.cone.setOpacity(0.28 + 0.1 * Math.sin(this.time * 14));

    if (this.state !== 'on') return;
    if (this.blows) this.blowDebris(dt, run, it.x, it.z, range);
    const lure = activeLure(run);
    if (lure && inCone(it.x, it.z, this.yaw, c.coneHalfAngle, range, lure.x, lure.z, lure.radius)) {
      if (this.blows) lure.shot(this);
      else pullLure(run, it.x, it.z, maxSpeedFor(b) * c.suctionStrength * suctionFalloff(Math.hypot(lure.x - it.x, lure.z - it.z) - lure.radius, 0, range), dt);
    }
    if (bunnySheltered(run, c.height) || !inCone(it.x, it.z, this.yaw, c.coneHalfAngle, range, b.x, b.z, b.radius)) return;
    const d = Math.hypot(b.x - it.x, b.z - it.z) - b.radius;
    const falloff = suctionFalloff(d, 0, range);
    if (this.blows) {
      if (applyPush(run, it.x, it.z, c.suctionStrength, falloff, dt) > 0 && c.wetSeconds) {
        b.stats.removeSource(WET_SOURCE);
        b.stats.add({ stat: 'speed', op: 'mul', value: c.wetMultiplier ?? 1, source: WET_SOURCE, priority: TIMED_PRIORITY, duration: c.wetSeconds });
      }
    } else applySuction(run, it.x, it.z, c.suctionStrength, falloff, dt);
  }

  /** Blows loose small Debris in the cone away from the nozzle (stronger up close). */
  private blowDebris(dt: number, run: Run, ox: number, oz: number, range: number): void {
    const c = this.cfg;
    _debris.length = 0;
    for (const d of run.debris.query(ox, oz, range, _debris)) {
      if (!d.alive || d.size > c.blowDebrisSize || !inCone(ox, oz, this.yaw, c.coneHalfAngle, range, d.x, d.z)) continue;
      const dx = d.x - ox;
      const dz = d.z - oz;
      const dist = Math.hypot(dx, dz) || 1;
      const step = c.debrisSpeed * suctionFalloff(dist, 0, range) * dt;
      const nx = d.x + (dx / dist) * step;
      const nz = d.z + (dz / dist) * step;
      if (step > 0 && isFloorFree(run.house, nx, nz, d.size)) run.debris.move(d, nx, nz);
    }
  }

  onContact(run: Run): void {
    const c = this.cfg;
    if (bunnySheltered(run, c.height)) return;
    if (!this.stunned && this.recoilFor <= 0 && hitBunny(run, this.x, this.z, { damage: c.damage, source: this.def.id, knockbackCm: c.knockbackCm, knockbackRadii: c.knockbackRadii })) {
      // It chokes on the Bunny and cuts out, so the air can't drag (or shove) it straight back
      // for a second hit as soon as the i-frames end.
      this.state = 'off';
      this.timer = c.off;
      this.cone.visible = false;
      this.recoilFor = HAZARD_RECOIL;
      if (run.bunny.alive && c.shedFraction > 0) shedMass(run, this.rng, c.shedFraction, this.def.id);
    }
    separateFromBunny(run, this, this.size, c.height);
  }
}

export const uprightVacuumDef = hazardRegistry.register({
  id: 'upright_vacuum',
  name: 'Upright Vacuum',
  footprint: tuningFootprint(UPRIGHT_VACUUM),
  mass: UPRIGHT_VACUUM.mass,
  modelId: 'upright_vacuum',
  create(_run, x, z, id, rng) {
    return new UprightVacuum(id, this, x, z, rng, UPRIGHT_VACUUM);
  },
});

export const leafBlowerDef = hazardRegistry.register({
  id: 'leaf_blower',
  name: 'Leaf Blower',
  footprint: tuningFootprint(LEAF_BLOWER),
  mass: LEAF_BLOWER.mass,
  modelId: LEAF_BLOWER.modelId,
  create(_run, x, z, id, rng) {
    return new UprightVacuum(id, this, x, z, rng, LEAF_BLOWER);
  },
});

export const litterVacuumDef = hazardRegistry.register({
  id: 'litter_vacuum',
  name: 'Litter Vacuum',
  footprint: tuningFootprint(LITTER_VACUUM),
  mass: LITTER_VACUUM.mass,
  modelId: LITTER_VACUUM.modelId,
  create(_run, x, z, id, rng) {
    return new UprightVacuum(id, this, x, z, rng, LITTER_VACUUM);
  },
});

export const waterBomberDef = hazardRegistry.register({
  id: 'water_bomber',
  name: 'Water Bomber',
  footprint: tuningFootprint(WATER_BOMBER),
  mass: WATER_BOMBER.mass,
  modelId: WATER_BOMBER.modelId,
  create(_run, x, z, id, rng) {
    return new UprightVacuum(id, this, x, z, rng, WATER_BOMBER);
  },
});

/** Continent cone blaster: wind and rain from the eyewall (HURRICANE). */
export const hurricaneDef = hazardRegistry.register({
  id: 'hurricane',
  name: 'Hurricane',
  footprint: tuningFootprint(HURRICANE),
  mass: HURRICANE.mass,
  modelId: HURRICANE.modelId,
  create(_run, x, z, id, rng) {
    return new UprightVacuum(id, this, x, z, rng, HURRICANE);
  },
});

/** Globe cone blaster: a hurricane seen from orbit, spun up over the oceans (GLOBE_HURRICANE). */
export const globeHurricaneDef = hazardRegistry.register({
  id: 'globe_hurricane',
  name: 'Hurricane',
  footprint: tuningFootprint(GLOBE_HURRICANE),
  spawnZones: ['oceans', 'shelves'],
  mass: GLOBE_HURRICANE.mass,
  modelId: GLOBE_HURRICANE.modelId,
  create(_run, x, z, id, rng) {
    return new UprightVacuum(id, this, x, z, rng, GLOBE_HURRICANE);
  },
});

/** Solar System cone blaster: a solar flare that blasts the Bunny away (SOLAR_FLARE). */
export const solarFlareDef = hazardRegistry.register({
  id: 'solar_flare',
  name: 'Solar Flare',
  footprint: tuningFootprint(SOLAR_FLARE),
  mass: SOLAR_FLARE.mass,
  modelId: SOLAR_FLARE.modelId,
  create(_run, x, z, id, rng) {
    return new UprightVacuum(id, this, x, z, rng, SOLAR_FLARE);
  },
});
