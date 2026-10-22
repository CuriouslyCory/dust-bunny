/**
 * Roomba: wanders, bounces off walls and furniture, turns at random, and pulls the Bunny in
 * with suction (a faint ring on the floor shows the reach). Contact: 1 damage + knockback.
 * The boss's mini Roombas reuse this with MINI_ROOMBA tuning; outdoors the Robotic Mower
 * (ROBO_MOWER, weak blade pull) and the Street Sweeper's mini mowers (MINI_MOWER) do too, and in
 * the city the Floor Scrubber (FLOOR_SCRUBBER, weak scrub-brush pull, spins `brush`) and the
 * Garbage Truck's mini scrubbers (MINI_SCRUBBER); in the region the Landfill Compactor
 * (LANDFILL_COMPACTOR, packer-wheel pull, spins its roof `beacon`) and the Incinerator's mini
 * compactors (MINI_COMPACTOR).
 *
 * Its suction also drags Lint's Decoy in (touching the Decoy clogs it), and a Lure with a
 * `wanderRange` (Keepsake effect) makes it home in on the Decoy.
 */
import type { Rng } from '../core/rng';
import { FLOOR_SCRUBBER, HAZARD_RECOIL, LANDFILL_COMPACTOR, MINI_COMPACTOR, MINI_MOWER, MINI_ROOMBA, MINI_SCRUBBER, ROBO_MOWER, ROOMBA, TORNADO, type RoombaTuning } from '../data/hazards';
import type { Run } from '../game/run';
import { BaseHazard } from './base';
import { maxSpeedFor } from '../systems/movement';
import { activeLure, applySuction, bunnySheltered, hitBunny, moveCircle, pullLure, randomIn, separateFromBunny, suctionFalloff, suctionReachFor, turnTowards, wrapAngle, yawOf } from './common';
import { DECAL_COLORS, ringDecal } from './decals';
import { hazardRegistry, tuningFootprint, type HazardDef } from './index';

export class Roomba extends BaseHazard {
  private turnTimer: number;
  private readonly suctionRing;

  constructor(
    id: number,
    def: HazardDef,
    x: number,
    z: number,
    private readonly rng: Rng,
    private readonly cfg: RoombaTuning,
  ) {
    super(id, def, x, z, cfg.size, cfg.modelId);
    this.recoilHeight = this.cfg.height;
    this.model.scale.setScalar(cfg.size / cfg.modelSize);
    this.yaw = rng.range(-Math.PI, Math.PI);
    this.turnTimer = randomIn(rng, cfg.turnInterval);
    this.suctionRing = this.addDecal(ringDecal(0.97, 1, DECAL_COLORS.suction, 0.35, 64));
  }

  /** Random turns every few seconds. */
  private steer(dt: number): void {
    this.turnTimer -= dt;
    if (this.turnTimer <= 0) {
      this.turnTimer = randomIn(this.rng, this.cfg.turnInterval);
      this.yaw = wrapAngle(this.yaw + this.rng.range(-this.cfg.turnAngle, this.cfg.turnAngle));
    }
  }

  protected tick(dt: number, run: Run): void {
    this.steer(dt);
    const lure = activeLure(run);
    if (lure && lure.wanderRange > 0 && Math.hypot(lure.x - this.x, lure.z - this.z) < lure.wanderRange) {
      this.yaw = turnTowards(this.yaw, yawOf(lure.x - this.x, lure.z - this.z), 3 * dt);
    }
    const speed = this.tierSpeed(run, this.cfg.speed);
    const m = moveCircle(run.house, this.x, this.z, this.size, this.cfg.height, Math.sin(this.yaw) * speed * dt, Math.cos(this.yaw) * speed * dt);
    this.x = m.x;
    this.z = m.z;
    if (m.hit) {
      // Reflect the heading about the collision normal, with a little jitter.
      const n = Math.hypot(m.nx, m.nz) || 1;
      const nx = m.nx / n;
      const nz = m.nz / n;
      let dx = Math.sin(this.yaw);
      let dz = Math.cos(this.yaw);
      const dot = dx * nx + dz * nz;
      if (dot < 0) {
        dx -= 2 * dot * nx;
        dz -= 2 * dot * nz;
      }
      this.yaw = wrapAngle(Math.atan2(dx, dz) + this.rng.range(-0.5, 0.5));
      this.turnTimer = randomIn(this.rng, this.cfg.turnInterval);
    }
    this.spin(this.cfg.spinNode, dt * this.cfg.spinRate);

    // Suction towards the Roomba centre.
    const b = run.bunny;
    const reach = this.size + suctionReachFor(this.cfg.suctionReach, b.stats.get('suctionMultiplier'));
    const dist = Math.hypot(b.x - this.x, b.z - this.z);
    if (dist < reach + b.radius && !bunnySheltered(run, this.cfg.height)) {
      applySuction(run, this.x, this.z, this.cfg.suctionStrength, suctionFalloff(dist - b.radius, this.size, reach), dt);
    }
    if (lure) {
      const falloff = suctionFalloff(Math.hypot(lure.x - this.x, lure.z - this.z) - lure.radius, this.size, this.size + this.cfg.suctionReach);
      if (falloff > 0) pullLure(run, this.x, this.z, maxSpeedFor(b) * this.cfg.suctionStrength * falloff, dt);
    }
    this.suctionRing.place(this.x, this.z);
    this.suctionRing.root.scale.set(reach, 1, reach);
    this.suctionRing.setOpacity(0.18 + 0.12 * Math.sin(this.time * 6));
  }

  onContact(run: Run): void {
    if (bunnySheltered(run, this.cfg.height)) return;
    if (!this.stunned && this.recoilFor <= 0 && hitBunny(run, this.x, this.z, { damage: this.cfg.damage, source: this.def.id, knockbackCm: this.cfg.knockbackCm, knockbackRadii: this.cfg.knockbackRadii })) {
      // Pause, then drive off the other way instead of pinning the Bunny.
      this.recoilFor = HAZARD_RECOIL;
      this.yaw = yawOf(this.x - run.bunny.x, this.z - run.bunny.z);
    }
    separateFromBunny(run, this, this.size, this.cfg.height);
  }
}

export const roombaDef = hazardRegistry.register({
  id: 'roomba',
  name: 'Roomba',
  footprint: tuningFootprint(ROOMBA),
  mass: ROOMBA.mass,
  modelId: 'roomba',
  create(_run, x, z, id, rng) {
    return new Roomba(id, this, x, z, rng, ROOMBA);
  },
});

export const miniRoombaDef = hazardRegistry.register({
  id: 'mini_roomba',
  name: 'Mini Roomba',
  footprint: tuningFootprint(MINI_ROOMBA),
  mass: MINI_ROOMBA.mass,
  modelId: 'roomba',
  create(_run, x, z, id, rng) {
    return new Roomba(id, this, x, z, rng, MINI_ROOMBA);
  },
});

export const roboMowerDef = hazardRegistry.register({
  id: 'robo_mower',
  name: 'Robotic Mower',
  footprint: tuningFootprint(ROBO_MOWER),
  mass: ROBO_MOWER.mass,
  modelId: ROBO_MOWER.modelId,
  create(_run, x, z, id, rng) {
    return new Roomba(id, this, x, z, rng, ROBO_MOWER);
  },
});

export const miniMowerDef = hazardRegistry.register({
  id: 'mini_mower',
  name: 'Mini Mower',
  footprint: tuningFootprint(MINI_MOWER),
  mass: MINI_MOWER.mass,
  modelId: MINI_MOWER.modelId,
  create(_run, x, z, id, rng) {
    return new Roomba(id, this, x, z, rng, MINI_MOWER);
  },
});

export const floorScrubberDef = hazardRegistry.register({
  id: 'floor_scrubber',
  name: 'Floor Scrubber',
  footprint: tuningFootprint(FLOOR_SCRUBBER),
  mass: FLOOR_SCRUBBER.mass,
  modelId: FLOOR_SCRUBBER.modelId,
  create(_run, x, z, id, rng) {
    return new Roomba(id, this, x, z, rng, FLOOR_SCRUBBER);
  },
});

export const miniScrubberDef = hazardRegistry.register({
  id: 'mini_scrubber',
  name: 'Mini Scrubber',
  footprint: tuningFootprint(MINI_SCRUBBER),
  mass: MINI_SCRUBBER.mass,
  modelId: MINI_SCRUBBER.modelId,
  create(_run, x, z, id, rng) {
    return new Roomba(id, this, x, z, rng, MINI_SCRUBBER);
  },
});

export const landfillCompactorDef = hazardRegistry.register({
  id: 'landfill_compactor',
  name: 'Landfill Compactor',
  footprint: tuningFootprint(LANDFILL_COMPACTOR),
  mass: LANDFILL_COMPACTOR.mass,
  modelId: LANDFILL_COMPACTOR.modelId,
  create(_run, x, z, id, rng) {
    return new Roomba(id, this, x, z, rng, LANDFILL_COMPACTOR);
  },
});

export const miniCompactorDef = hazardRegistry.register({
  id: 'mini_compactor',
  name: 'Mini Compactor',
  footprint: tuningFootprint(MINI_COMPACTOR),
  mass: MINI_COMPACTOR.mass,
  modelId: MINI_COMPACTOR.modelId,
  create(_run, x, z, id, rng) {
    return new Roomba(id, this, x, z, rng, MINI_COMPACTOR);
  },
});

/** Continent wanderer (placeholder tuning and model, see TORNADO). */
export const tornadoDef = hazardRegistry.register({
  id: 'tornado',
  name: 'Tornado',
  footprint: tuningFootprint(TORNADO),
  mass: TORNADO.mass,
  modelId: TORNADO.modelId,
  create(_run, x, z, id, rng) {
    return new Roomba(id, this, x, z, rng, TORNADO);
  },
});
