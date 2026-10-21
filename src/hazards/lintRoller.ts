/**
 * Lint Roller: rolls back and forth along a straight lane (shown faintly on the floor).
 * Contact: 1 damage, the Bunny sticks to the drum for ~1 s (carried along), sheds mass
 * onto the floor, then is flung off to the side of the lane.
 */
import type { Rng } from '../core/rng';
import { LINT_ROLLER } from '../data/hazards';
import type { Run } from '../game/run';
import type { HouseLayout } from '../world/types';
import { BaseHazard } from './base';
import { bunnySheltered, freeDistance, knockbackCm, knockbackDistance, pushBunnyOut, yawOf } from './common';
import { DECAL_COLORS, laneDecal } from './decals';
import { hazardRegistry, type HazardDef } from './index';
import { shedMass } from './shed';

export interface Lane {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  length: number;
}

/** Longest axis-aligned lane through (x, z), capped at laneMax; null if shorter than laneMin. */
export function planLane(house: HouseLayout, x: number, z: number, rng: Rng): Lane | null {
  const c = LINT_ROLLER;
  const axes: Array<[number, number]> = rng.chance(0.5) ? [[1, 0], [0, 1]] : [[0, 1], [1, 0]];
  let best: Lane | null = null;
  for (const [dx, dz] of axes) {
    const fwd = freeDistance(house, x, z, dx, dz, c.size, c.height, c.laneMax / 2);
    const back = freeDistance(house, x, z, -dx, -dz, c.size, c.height, c.laneMax / 2);
    const length = fwd + back;
    if (length >= c.laneMin && (!best || length > best.length)) {
      best = { ax: x - dx * back, az: z - dz * back, bx: x + dx * fwd, bz: z + dz * fwd, length };
    }
  }
  return best;
}

export class LintRoller extends BaseHazard {
  private readonly lane: Lane | null;
  /** 0..1 position along the lane, and direction (+1 towards b). */
  private t = 0.5;
  private dir: 1 | -1;
  private pause = 0;
  private stuck = 0;
  private offX = 0;
  private offZ = 0;

  constructor(
    id: number,
    def: HazardDef,
    run: Run,
    x: number,
    z: number,
    private readonly rng: Rng,
  ) {
    super(id, def, x, z, LINT_ROLLER.size, 'lint_roller');
    this.lane = planLane(run.house, x, z, rng);
    this.dir = rng.chance(0.5) ? 1 : -1;
    if (!this.lane) {
      this.dead = true;
      return;
    }
    const l = this.lane;
    this.t = Math.hypot(x - l.ax, z - l.az) / Math.max(1, l.length);
    const decal = this.addDecal(laneDecal(l.length + this.size * 2, this.size * 2, DECAL_COLORS.warn, 0.16));
    const ux = (l.bx - l.ax) / l.length;
    const uz = (l.bz - l.az) / l.length;
    decal.place(l.ax - ux * this.size, l.az - uz * this.size, yawOf(ux, uz));
  }

  protected tick(dt: number, run: Run): void {
    const l = this.lane;
    if (!l) return;
    const c = LINT_ROLLER;
    if (this.pause > 0) {
      this.pause -= dt;
    } else {
      const step = (this.tierSpeed(run, c.speed) * dt) / l.length;
      this.t += step * this.dir;
      if (this.t >= 1 || this.t <= 0) {
        this.t = Math.min(1, Math.max(0, this.t));
        this.dir = this.dir === 1 ? -1 : 1;
        this.pause = c.endPause;
      }
      this.spin('drum', ((step * l.length) / 3) * this.dir, 'x');
    }
    this.x = l.ax + (l.bx - l.ax) * this.t;
    this.z = l.az + (l.bz - l.az) * this.t;
    this.yaw = yawOf((l.bx - l.ax) * this.dir, (l.bz - l.az) * this.dir);

    if (this.stuck > 0) {
      const b = run.bunny;
      this.stuck -= dt;
      b.x = this.x + this.offX;
      b.z = this.z + this.offZ;
      b.vx = b.vz = 0;
      b.impulseX = b.impulseZ = 0;
      if (this.stuck <= 0) this.release(run);
    }
  }

  private release(run: Run): void {
    const l = this.lane!;
    const b = run.bunny;
    // Fling perpendicular to the lane, on the side the Bunny was stuck.
    let px = -(l.bz - l.az);
    let pz = l.bx - l.ax;
    if (px * this.offX + pz * this.offZ < 0) {
      px = -px;
      pz = -pz;
    }
    if (Math.abs(px * this.offX + pz * this.offZ) < 1e-3 && this.rng.chance(0.5)) {
      px = -px;
      pz = -pz;
    }
    const n = Math.hypot(px, pz) || 1;
    b.rooted = 0;
    b.invulnerable = Math.max(b.invulnerable, LINT_ROLLER.releaseInvulnerability);
    b.x = this.x + (px / n) * (this.size + b.radius + 0.5);
    b.z = this.z + (pz / n) * (this.size + b.radius + 0.5);
    knockbackCm(b, px, pz, knockbackDistance(b.radius, LINT_ROLLER.releaseCm, LINT_ROLLER.releaseRadii));
  }

  onContact(run: Run): void {
    if (this.stuck > 0 || bunnySheltered(run, LINT_ROLLER.height)) return;
    const b = run.bunny;
    if (this.stunned || !b.damage(LINT_ROLLER.damage, this.def.id)) {
      pushBunnyOut(run, this.x, this.z, this.size);
      return;
    }
    if (!b.alive) return;
    this.stuck = LINT_ROLLER.stickSeconds;
    b.rooted = LINT_ROLLER.stickSeconds;
    b.invulnerable = Math.max(b.invulnerable, LINT_ROLLER.stickSeconds + 0.05);
    shedMass(run, this.rng, LINT_ROLLER.shedFraction, this.def.id);
    // Stick to the drum surface.
    const dx = b.x - this.x;
    const dz = b.z - this.z;
    const d = Math.hypot(dx, dz) || 1;
    const r = Math.max(this.size * 0.6, d);
    this.offX = (dx / d) * r;
    this.offZ = (dz / d) * r;
  }
}

export const lintRollerDef = hazardRegistry.register({
  id: 'lint_roller',
  name: 'Lint Roller',
  minTier: 1,
  spawnWeight: 1,
  mass: LINT_ROLLER.mass,
  modelId: 'lint_roller',
  create(run, x, z, id, rng) {
    return new LintRoller(id, this, run, x, z, rng);
  },
});
