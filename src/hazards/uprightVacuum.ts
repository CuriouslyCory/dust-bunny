/**
 * Upright Vacuum: slow, turns towards the Bunny, and cycles a strong suction cone out of its
 * intake. The cone is drawn on the floor: blinking amber while warming up, blue while on.
 * Contact: 2 damage, knockback, and it sucks some mass off the Bunny.
 */
import type { Rng } from '../core/rng';
import { UPRIGHT_VACUUM } from '../data/hazards';
import type { Run } from '../game/run';
import { BaseHazard } from './base';
import { applySuction, bunnySheltered, hitBunny, moveCircle, pushBunnyOut, suctionFalloff, suctionReachFor, turnTowards, wrapAngle, yawOf } from './common';
import { DECAL_COLORS, sectorDecal } from './decals';
import { hazardRegistry, type HazardDef } from './index';
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
  ) {
    super(id, def, x, z, UPRIGHT_VACUUM.size, 'upright_vacuum');
    this.yaw = rng.range(-Math.PI, Math.PI);
    this.timer = rng.range(0.5, UPRIGHT_VACUUM.off);
    const c = UPRIGHT_VACUUM;
    this.cone = this.addDecal(sectorDecal(0, c.coneRange, c.coneHalfAngle * 2, DECAL_COLORS.warn, 0.35));
    this.cone.visible = false;
  }

  /** Intake point at the front of the base. */
  private intake(): { x: number; z: number } {
    return { x: this.x + Math.sin(this.yaw) * this.size * 0.7, z: this.z + Math.cos(this.yaw) * this.size * 0.7 };
  }

  protected tick(dt: number, run: Run): void {
    const c = UPRIGHT_VACUUM;
    const b = run.bunny;
    this.timer -= dt;
    this.yaw = turnTowards(this.yaw, yawOf(b.x - this.x, b.z - this.z), c.turnRate * dt);
    const speed = this.tierSpeed(run, c.speed) * (this.state === 'on' ? 0.5 : 1);
    const m = moveCircle(run.house, this.x, this.z, this.size, c.height, Math.sin(this.yaw) * speed * dt, Math.cos(this.yaw) * speed * dt);
    this.x = m.x;
    this.z = m.z;

    if (this.timer <= 0) {
      if (this.state === 'off') {
        this.state = 'warmup';
        this.timer = c.warmup;
        this.cone.setColor(DECAL_COLORS.warn);
        this.emitTelegraph(run, 'suction', c.warmup);
      } else if (this.state === 'warmup') {
        this.state = 'on';
        this.timer = c.on;
        this.cone.setColor(DECAL_COLORS.suction);
      } else {
        this.state = 'off';
        this.timer = c.off * this.rng.range(0.8, 1.2);
      }
    }

    const it = this.intake();
    const range = suctionReachFor(c.coneRange, b.stats.get('suctionMultiplier'));
    this.cone.visible = this.state !== 'off';
    this.cone.place(it.x, it.z, this.yaw);
    this.cone.root.scale.setScalar(range / c.coneRange);
    if (this.state === 'warmup') this.cone.pulse(this.time, 1 - this.timer / c.warmup);
    else if (this.state === 'on') this.cone.setOpacity(0.28 + 0.1 * Math.sin(this.time * 14));

    if (this.state === 'on' && !bunnySheltered(run, c.height)) {
      if (inCone(it.x, it.z, this.yaw, c.coneHalfAngle, range, b.x, b.z, b.radius)) {
        const d = Math.hypot(b.x - it.x, b.z - it.z) - b.radius;
        applySuction(run, it.x, it.z, c.suctionStrength, suctionFalloff(d, 0, range), dt);
      }
    }
  }

  onContact(run: Run): void {
    const c = UPRIGHT_VACUUM;
    if (bunnySheltered(run, c.height)) return;
    if (hitBunny(run, this.x, this.z, { damage: c.damage, source: this.def.id, knockbackCm: c.knockbackCm, knockbackRadii: c.knockbackRadii }) && run.bunny.alive) {
      shedMass(run, this.rng, c.shedFraction, this.def.id);
    }
    pushBunnyOut(run, this.x, this.z, this.size);
  }
}

export const uprightVacuumDef = hazardRegistry.register({
  id: 'upright_vacuum',
  name: 'Upright Vacuum',
  minTier: 4,
  spawnWeight: 1,
  mass: UPRIGHT_VACUUM.mass,
  modelId: 'upright_vacuum',
  create(_run, x, z, id, rng) {
    return new UprightVacuum(id, this, x, z, rng);
  },
});
