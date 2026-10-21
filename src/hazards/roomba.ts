/**
 * Roomba: wanders, bounces off walls and furniture, turns at random, and pulls the Bunny in
 * with suction (a faint ring on the floor shows the reach). Contact: 1 damage + knockback.
 * The boss's mini Roombas reuse this with MINI_ROOMBA tuning; outdoors the Robotic Mower
 * (ROBO_MOWER, weak blade pull) and the Street Sweeper's mini mowers (MINI_MOWER) do too.
 */
import type { Rng } from '../core/rng';
import { HAZARD_RECOIL, MINI_MOWER, MINI_ROOMBA, ROBO_MOWER, ROOMBA, type RoombaTuning } from '../data/hazards';
import type { Run } from '../game/run';
import { BaseHazard } from './base';
import { applySuction, bunnySheltered, hitBunny, moveCircle, pushBunnyOut, randomIn, suctionFalloff, suctionReachFor, wrapAngle, yawOf } from './common';
import { DECAL_COLORS, ringDecal } from './decals';
import { hazardRegistry, type HazardDef } from './index';

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
    pushBunnyOut(run, this.x, this.z, this.size);
  }
}

export const roombaDef = hazardRegistry.register({
  id: 'roomba',
  name: 'Roomba',
  minTier: 1,
  spawnWeight: 1,
  mass: ROOMBA.mass,
  modelId: 'roomba',
  create(_run, x, z, id, rng) {
    return new Roomba(id, this, x, z, rng, ROOMBA);
  },
});

export const miniRoombaDef = hazardRegistry.register({
  id: 'mini_roomba',
  name: 'Mini Roomba',
  minTier: 5,
  spawnWeight: 0,
  mass: MINI_ROOMBA.mass,
  modelId: 'roomba',
  create(_run, x, z, id, rng) {
    return new Roomba(id, this, x, z, rng, MINI_ROOMBA);
  },
});

export const roboMowerDef = hazardRegistry.register({
  id: 'robo_mower',
  name: 'Robotic Mower',
  minTier: 5,
  spawnWeight: 1,
  mass: ROBO_MOWER.mass,
  modelId: ROBO_MOWER.modelId,
  create(_run, x, z, id, rng) {
    return new Roomba(id, this, x, z, rng, ROBO_MOWER);
  },
});

export const miniMowerDef = hazardRegistry.register({
  id: 'mini_mower',
  name: 'Mini Mower',
  minTier: 7,
  spawnWeight: 0,
  mass: MINI_MOWER.mass,
  modelId: MINI_MOWER.modelId,
  create(_run, x, z, id, rng) {
    return new Roomba(id, this, x, z, rng, MINI_MOWER);
  },
});
