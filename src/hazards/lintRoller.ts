/**
 * Lint Roller: rolls back and forth along a straight lane (shown faintly on the floor).
 * Contact: 1 damage, the Bunny sticks to the drum for ~1 s (carried along), sheds mass
 * onto the floor, then is flung off to the side of the lane.
 *
 * The Lawn Mower (outdoors) reuses the lane patrol with LAWN_MOWER tuning: no sticking; a hit
 * knocks the Bunny off the lane, mows some fluff off (sheds mass) and the mower stops briefly.
 * In the region the Snowplow (SNOWPLOW) and the Freight Train (FREIGHT_TRAIN,
 * long fast lanes) patrol the same way, with real-size models scaled by size / modelSize. In the
 * continent the Glacier Tongue (GLACIER_TONGUE) creeps along its lane, slow and heavy; its def
 * prefers `tundra` and `mountains` zones (GLACIER_ZONES) when the map has them.
 *
 * A planted (hunkered) Tumble can't be stuck: the roller bounces off it and rolls back the other
 * way (onPlanted). Stunned while carrying the Bunny (a clog, a Discharge), it lets go.
 */
import type { Rng } from '../core/rng';
import { areaUnit } from '../data/areas';
import { FREIGHT_TRAIN, GLACIER_TONGUE, LAWN_MOWER, LINT_ROLLER, SNOWPLOW, type LaneTuning } from '../data/hazards';
import type { Run } from '../game/run';
import type { HouseLayout, RoomType } from '../world/types';
import { BaseHazard } from './base';
import { bunnySheltered, freeDistance, hitBunny, knockbackCm, knockbackDistance, pushBunnyOut, yawOf } from './common';
import { DECAL_COLORS, laneDecal } from './decals';
import { hazardRegistry, tuningFootprint, type HazardDef } from './index';
import { shedMass } from './shed';

export interface Lane {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  length: number;
}

type LaneShape = Pick<LaneTuning, 'size' | 'height' | 'laneMin' | 'laneMax'>;

/** Longest axis-aligned lane through (x, z), capped at laneMax; null if shorter than laneMin. */
export function planLane(house: HouseLayout, x: number, z: number, rng: Rng, c: LaneShape = LINT_ROLLER): Lane | null {
  const axes: Array<[number, number]> = rng.chance(0.5) ? [[1, 0], [0, 1]] : [[0, 1], [1, 0]];
  // Probe step: 4 cm indoors (in the Area's unit), coarser for big outdoor lanes.
  const step = Math.max(4 / areaUnit(house.area), c.size / 4);
  let best: Lane | null = null;
  for (const [dx, dz] of axes) {
    const fwd = freeDistance(house, x, z, dx, dz, c.size, c.height, c.laneMax / 2, step);
    const back = freeDistance(house, x, z, -dx, -dz, c.size, c.height, c.laneMax / 2, step);
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
    private readonly cfg: LaneTuning = LINT_ROLLER,
  ) {
    super(id, def, x, z, cfg.size, cfg.modelId);
    this.model.scale.setScalar(cfg.size / (cfg.modelSize ?? cfg.size));
    this.lane = planLane(run.house, x, z, rng, cfg);
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

  override update(dt: number, run: Run): void {
    // Stunned (clog, Discharge, Spiky Dash) while carrying the Bunny: let go at once.
    if (this.stuck > 0 && this.stunned) {
      this.stuck = 0;
      this.release(run);
    }
    super.update(dt, run);
  }

  /** Bounces off a planted Tumble: turns back along the lane (only if heading into it) and pauses. */
  onPlanted(run: Run): void {
    const l = this.lane;
    if (!l) return;
    const b = run.bunny;
    const towards = ((l.bx - l.ax) * (b.x - this.x) + (l.bz - l.az) * (b.z - this.z)) * this.dir > 0;
    if (towards) {
      this.dir = this.dir === 1 ? -1 : 1;
      this.pause = Math.max(this.pause, this.cfg.endPause);
    }
  }

  protected tick(dt: number, run: Run): void {
    const l = this.lane;
    if (!l) return;
    const c = this.cfg;
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
      if (c.spinNode) this.spin(c.spinNode, ((step * l.length) / 3) * this.dir, 'x');
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

  /** Unit vector perpendicular to the lane, on the side of (dx, dz) (random side if on the lane). */
  private sideOf(dx: number, dz: number): { x: number; z: number } {
    const l = this.lane!;
    let px = -(l.bz - l.az);
    let pz = l.bx - l.ax;
    if (px * dx + pz * dz < 0) {
      px = -px;
      pz = -pz;
    }
    if (Math.abs(px * dx + pz * dz) < 1e-3 && this.rng.chance(0.5)) {
      px = -px;
      pz = -pz;
    }
    const n = Math.hypot(px, pz) || 1;
    return { x: px / n, z: pz / n };
  }

  private release(run: Run): void {
    const c = this.cfg;
    const b = run.bunny;
    // Fling perpendicular to the lane, on the side the Bunny was stuck.
    const side = this.sideOf(this.offX, this.offZ);
    b.rooted = 0;
    b.invulnerable = Math.max(b.invulnerable, c.releaseInvulnerability);
    const gap = 0.5 / run.unit;
    b.x = this.x + side.x * (this.size + b.radius + gap);
    b.z = this.z + side.z * (this.size + b.radius + gap);
    knockbackCm(b, side.x, side.z, knockbackDistance(b.radius, c.releaseCm, c.releaseRadii));
  }

  onContact(run: Run): void {
    const c = this.cfg;
    if (this.stuck > 0 || bunnySheltered(run, c.height)) return;
    if (c.stickSeconds <= 0) {
      this.mow(run);
      return;
    }
    const b = run.bunny;
    if (this.stunned || !b.damage(c.damage, this.def.id)) {
      pushBunnyOut(run, this.x, this.z, this.size);
      return;
    }
    if (!b.alive) return;
    this.stuck = c.stickSeconds;
    b.rooted = c.stickSeconds;
    b.invulnerable = Math.max(b.invulnerable, c.stickSeconds + 0.05);
    shedMass(run, this.rng, c.shedFraction, this.def.id);
    // Stick to the drum surface.
    const dx = b.x - this.x;
    const dz = b.z - this.z;
    const d = Math.hypot(dx, dz) || 1;
    const r = Math.max(this.size * 0.6, d);
    this.offX = (dx / d) * r;
    this.offZ = (dz / d) * r;
  }

  /** Non-sticking hit (Lawn Mower): damage, knock off the lane, shed mass, stop for a moment. */
  private mow(run: Run): void {
    const c = this.cfg;
    const b = run.bunny;
    const side = this.sideOf(b.x - this.x, b.z - this.z);
    const hit = !this.stunned && hitBunny(run, this.x, this.z, { damage: c.damage, source: this.def.id, knockbackCm: c.releaseCm, knockbackRadii: c.releaseRadii, dirX: side.x, dirZ: side.z });
    if (hit) {
      this.pause = Math.max(this.pause, c.hitPause);
      if (b.alive && c.shedFraction > 0) shedMass(run, this.rng, c.shedFraction, this.def.id);
    }
    pushBunnyOut(run, this.x, this.z, this.size);
  }
}

export const lintRollerDef = hazardRegistry.register({
  id: 'lint_roller',
  name: 'Lint Roller',
  footprint: tuningFootprint(LINT_ROLLER),
  mass: LINT_ROLLER.mass,
  modelId: 'lint_roller',
  create(run, x, z, id, rng) {
    return new LintRoller(id, this, run, x, z, rng, LINT_ROLLER);
  },
});

export const lawnMowerDef = hazardRegistry.register({
  id: 'lawn_mower',
  name: 'Lawn Mower',
  footprint: tuningFootprint(LAWN_MOWER),
  mass: LAWN_MOWER.mass,
  modelId: LAWN_MOWER.modelId,
  create(run, x, z, id, rng) {
    return new LintRoller(id, this, run, x, z, rng, LAWN_MOWER);
  },
});

export const snowplowDef = hazardRegistry.register({
  id: 'snowplow',
  name: 'Snowplow',
  footprint: tuningFootprint(SNOWPLOW),
  mass: SNOWPLOW.mass,
  modelId: SNOWPLOW.modelId,
  create(run, x, z, id, rng) {
    return new LintRoller(id, this, run, x, z, rng, SNOWPLOW);
  },
});

export const freightTrainDef = hazardRegistry.register({
  id: 'freight_train',
  name: 'Freight Train',
  footprint: tuningFootprint(FREIGHT_TRAIN),
  mass: FREIGHT_TRAIN.mass,
  modelId: FREIGHT_TRAIN.modelId,
  create(run, x, z, id, rng) {
    return new LintRoller(id, this, run, x, z, rng, FREIGHT_TRAIN);
  },
});

/** Zones a Glacier Tongue is placed in when the layout has any (anywhere it fits otherwise). */
export const GLACIER_ZONES: readonly RoomType[] = ['tundra', 'mountains'];

/** Continent lane patrol: a glacier creeping down its valley (GLACIER_TONGUE). */
export const glacierTongueDef = hazardRegistry.register({
  id: 'glacier_tongue',
  name: 'Glacier Tongue',
  footprint: tuningFootprint(GLACIER_TONGUE),
  spawnZones: GLACIER_ZONES,
  mass: GLACIER_TONGUE.mass,
  modelId: GLACIER_TONGUE.modelId,
  create(run, x, z, id, rng) {
    return new LintRoller(id, this, run, x, z, rng, GLACIER_TONGUE);
  },
});
