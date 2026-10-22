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
 * prefers `tundra` and `mountains` zones (GLACIER_ZONES) when the map has them. On the Globe the
 * Space Station (SPACE_STATION) joins the nearest orbit lane (`layout.routes` of kind 'orbit',
 * `orbitLane`; the route's copy nearest it on the wrap-around map) and patrols east–west along it.
 * In the Solar System the Comet (COMET, `ringReach`) rides the closed orbit ring nearest its spawn
 * one way round (`ringPath`, `ringPoint`): no ends, a short telegraph lane sliding ahead of it, its
 * `tail` fluttering (`flutterNode`).
 *
 * A planted (hunkered) Tumble can't be stuck: the roller bounces off it and rolls back the other
 * way (onPlanted). Stunned while carrying the Bunny (a clog, a Discharge), it lets go.
 */
import type { Rng } from '../core/rng';
import { areaUnit } from '../data/areas';
import { COMET, FREIGHT_TRAIN, GLACIER_TONGUE, LAWN_MOWER, LINT_ROLLER, SNOWPLOW, SPACE_STATION, type LaneTuning } from '../data/hazards';
import type { Run } from '../game/run';
import { onScreen } from '../systems/camera';
import type { HouseLayout, RoomType } from '../world/types';
import { nearestImageX, wrapWidth } from '../world/wrap';
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

/**
 * An east–west lane along the `orbit` route nearest (x, z), if one runs within `reach` of it: the
 * lane is centred on x (moved onto the route's extent), up to laneMax long and clear of obstacles.
 * On a map that wraps east–west the route's copy nearest x is used (routes are stored in the
 * canonical strip), and a route spanning the whole lap has no ends. Null if no route is in reach
 * or the lane would be shorter than laneMin.
 */
export function orbitLane(house: HouseLayout, x: number, z: number, reach: number, c: LaneShape): Lane | null {
  const width = wrapWidth(house);
  let best: { x: number; z: number; min: number; max: number; d: number } | null = null;
  for (const route of house.routes ?? []) {
    if (route.kind !== 'orbit') continue;
    const xs = route.points.map((p) => p.x);
    const span = Math.max(...xs) - Math.min(...xs);
    const fullLap = width > 0 && span >= width - 1e-6;
    for (let i = 0; i + 1 < route.points.length; i++) {
      const a = route.points[i]!;
      const b = route.points[i + 1]!;
      if (a.z !== b.z) continue; // orbit lanes run east–west
      let min = Math.min(a.x, b.x);
      let max = Math.max(a.x, b.x);
      if (fullLap) {
        min = -Infinity;
        max = Infinity;
      } else {
        // The copy of the segment nearest x.
        const shift = nearestImageX(house, (min + max) / 2, x) - (min + max) / 2;
        min += shift;
        max += shift;
      }
      // The Hazard's disc stays on the route: its centre keeps `size` from each end.
      if (max - min < c.size * 2) continue;
      const px = Math.min(max - c.size, Math.max(min + c.size, x));
      const d = Math.hypot(px - x, a.z - z);
      if (d <= reach && (!best || d < best.d)) best = { x: px, z: a.z, min, max, d };
    }
  }
  if (!best) return null;
  const step = Math.max(4 / areaUnit(house.area), c.size / 4);
  const half = c.laneMax / 2;
  const fwd = Math.min(best.max - c.size - best.x, freeDistance(house, best.x, best.z, 1, 0, c.size, c.height, half, step));
  const back = Math.min(best.x - best.min - c.size, freeDistance(house, best.x, best.z, -1, 0, c.size, c.height, half, step));
  if (fwd + back < c.laneMin) return null;
  return { ax: best.x - back, az: best.z, bx: best.x + fwd, bz: best.z, length: fwd + back };
}

/**
 * The orbit lane for a lane Hazard spawned at (x, z), and where on it (0..1) it starts. A spawn
 * point off screen (the director's) stays off screen: if joining the lane would bring it into
 * view, it starts further along the lane, away from the Bunny.
 */
function joinOrbit(run: Run, x: number, z: number, reach: number, c: LaneShape): { lane: Lane; t: number } | null {
  const lane = orbitLane(run.house, x, z, reach, c);
  if (!lane) return null;
  const onLane = (px: number) => (px - lane.ax) / lane.length;
  if (onScreen(run, x, z, c.size)) return { lane, t: onLane(x) };
  const away = Math.sign(x - run.bunny.x) || 1;
  let px = x;
  for (let i = 0; i < 60 && onScreen(run, px, lane.az, c.size); i++) px += away * c.size;
  if (px === x) return { lane, t: onLane(x) };
  // Re-centre the lane on the new start (it stays on the same route).
  const moved = orbitLane(run.house, px, lane.az, reach, c);
  return moved ? { lane: moved, t: (px - moved.ax) / moved.length } : { lane, t: Math.min(1, Math.max(0, onLane(px))) };
}

/** A closed orbit ring (a `routes` polyline of kind 'orbit' whose last point is its first) as an arc-length path. */
export interface RingPath {
  points: ReadonlyArray<{ x: number; z: number }>;
  /** Arc length from the first point to each point (cum[0] = 0, last = length). */
  cum: number[];
  length: number;
}

/** Position and unit tangent (towards increasing s) at arc length `s` along a ring (wraps). */
export function ringPoint(path: RingPath, s: number): { x: number; z: number; tx: number; tz: number } {
  const L = path.length;
  const t = ((s % L) + L) % L;
  let i = 0;
  while (i < path.cum.length - 2 && path.cum[i + 1]! <= t) i++;
  const a = path.points[i]!;
  const b = path.points[i + 1]!;
  const seg = path.cum[i + 1]! - path.cum[i]! || 1;
  const f = (t - path.cum[i]!) / seg;
  return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, tx: (b.x - a.x) / seg, tz: (b.z - a.z) / seg };
}

/**
 * The closed orbit ring (`routes` of kind 'orbit' whose first and last points coincide: the Solar
 * System's rings round the Sun) nearest (x, z), if one passes within `reach`, and the arc length
 * of the point on it nearest (x, z). Open routes (the Globe's east–west lanes) never count.
 */
export function ringPath(house: HouseLayout, x: number, z: number, reach: number): { path: RingPath; s: number } | null {
  let best: { points: ReadonlyArray<{ x: number; z: number }>; seg: number; f: number; d: number } | null = null;
  for (const route of house.routes ?? []) {
    const pts = route.points;
    if (route.kind !== 'orbit' || pts.length < 4) continue;
    const first = pts[0]!;
    const last = pts[pts.length - 1]!;
    if (Math.hypot(first.x - last.x, first.z - last.z) > 1e-6) continue;
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      const ex = b.x - a.x;
      const ez = b.z - a.z;
      const len2 = ex * ex + ez * ez || 1;
      const f = Math.min(1, Math.max(0, ((x - a.x) * ex + (z - a.z) * ez) / len2));
      const d = Math.hypot(a.x + ex * f - x, a.z + ez * f - z);
      if (d <= reach && (!best || d < best.d)) best = { points: pts, seg: i, f, d };
    }
  }
  if (!best) return null;
  const cum = [0];
  for (let i = 1; i < best.points.length; i++) {
    const a = best.points[i - 1]!;
    const b = best.points[i]!;
    cum.push(cum[i - 1]! + Math.hypot(b.x - a.x, b.z - a.z));
  }
  const path = { points: best.points, cum, length: cum[cum.length - 1]! };
  return { path, s: cum[best.seg]! + (cum[best.seg + 1]! - cum[best.seg]!) * best.f };
}

/**
 * The ring a ring-riding Hazard spawned at (x, z) joins, and where on it (arc length) it starts. A
 * spawn point off screen (the director's) stays off screen: if the snap would bring it into view,
 * it starts further round the ring, whichever way is shorter.
 */
function joinRing(run: Run, x: number, z: number, reach: number, size: number): { path: RingPath; s: number } | null {
  const ring = ringPath(run.house, x, z, reach);
  if (!ring) return null;
  const at = (s: number) => ringPoint(ring.path, s);
  const p = at(ring.s);
  if (onScreen(run, x, z, size) || !onScreen(run, p.x, p.z, size)) return ring;
  for (let k = 1; k * size < ring.path.length / 2; k++) {
    for (const dir of [1, -1]) {
      const q = at(ring.s + dir * k * size);
      if (!onScreen(run, q.x, q.z, size)) return { path: ring.path, s: ring.s + dir * k * size };
    }
  }
  return ring;
}

/** Length of the lane telegraph that slides ahead of a ring rider (world units, plus its size). */
const RING_LOOKAHEAD = 8;

export class LintRoller extends BaseHazard {
  private readonly lane: Lane | null;
  /** Ring riders (`ringReach`, the Comet): the ring, arc position and the telegraph sliding ahead. */
  readonly ring: RingPath | null = null;
  s = 0;
  private readonly ringDecal;
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
    const ring = cfg.ringReach ? joinRing(run, x, z, cfg.ringReach, cfg.size) : null;
    if (ring) {
      this.dir = rng.chance(0.5) ? 1 : -1;
      // Rides the ring one way round: no ends, a short telegraph lane slides ahead of it.
      this.lane = null;
      this.ring = ring.path;
      this.s = ring.s;
      this.ringDecal = this.addDecal(laneDecal(RING_LOOKAHEAD + cfg.size, cfg.size * 2, DECAL_COLORS.warn, 0.16));
      this.placeOnRing();
      return;
    }
    this.ringDecal = null;
    const orbit = cfg.orbitReach ? joinOrbit(run, x, z, cfg.orbitReach, cfg) : null;
    this.lane = orbit?.lane ?? planLane(run.house, x, z, rng, cfg);
    this.dir = rng.chance(0.5) ? 1 : -1;
    if (!this.lane) {
      this.dead = true;
      return;
    }
    const l = this.lane;
    this.t = orbit ? orbit.t : Math.hypot(x - l.ax, z - l.az) / Math.max(1, l.length);
    this.x = l.ax + (l.bx - l.ax) * this.t;
    this.z = l.az + (l.bz - l.az) * this.t;
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
    const a = this.axis();
    if (!a) return;
    const b = run.bunny;
    const towards = (a.x * (b.x - this.x) + a.z * (b.z - this.z)) * this.dir > 0;
    if (towards) {
      this.dir = this.dir === 1 ? -1 : 1;
      this.pause = Math.max(this.pause, this.cfg.endPause);
    }
  }

  /** The course's direction here (towards b on a lane, increasing arc length on a ring); null without one. */
  private axis(): { x: number; z: number } | null {
    if (this.ring) {
      const p = ringPoint(this.ring, this.s);
      return { x: p.tx, z: p.tz };
    }
    const l = this.lane;
    return l ? { x: l.bx - l.ax, z: l.bz - l.az } : null;
  }

  /** Puts it at its arc position on the ring, facing its way round, and slides the telegraph ahead. */
  private placeOnRing(): void {
    const p = ringPoint(this.ring!, this.s);
    this.x = p.x;
    this.z = p.z;
    this.yaw = yawOf(p.tx * this.dir, p.tz * this.dir);
    this.ringDecal?.place(this.x, this.z, this.yaw);
  }

  protected tick(dt: number, run: Run): void {
    const c = this.cfg;
    if (c.flutterNode) {
      const tail = this.model.getObjectByName(c.flutterNode);
      if (tail) tail.scale.set(1 + 0.06 * Math.sin(this.time * 7.3), 1, 1 + 0.08 * Math.sin(this.time * 4.1));
    }
    if (this.ring) {
      if (this.pause > 0) this.pause -= dt;
      else this.s += this.tierSpeed(run, c.speed) * dt * this.dir;
      this.placeOnRing();
      this.carry(dt, run);
      return;
    }
    const l = this.lane;
    if (!l) return;
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
    this.carry(dt, run);
  }

  /** Carries a stuck Bunny along on the drum and releases it when its time is up. */
  private carry(dt: number, run: Run): void {
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
    const a = this.axis()!;
    let px = -a.z;
    let pz = a.x;
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

/** Globe lane patrol: a space station along an orbit lane (SPACE_STATION, `orbitReach`). */
export const spaceStationDef = hazardRegistry.register({
  id: 'space_station',
  name: 'Space Station',
  footprint: tuningFootprint(SPACE_STATION),
  mass: SPACE_STATION.mass,
  modelId: SPACE_STATION.modelId,
  create(run, x, z, id, rng) {
    return new LintRoller(id, this, run, x, z, rng, SPACE_STATION);
  },
});

/** Solar System lane patrol: a comet on its orbit (COMET). */
export const cometDef = hazardRegistry.register({
  id: 'comet',
  name: 'Comet',
  footprint: tuningFootprint(COMET),
  mass: COMET.mass,
  modelId: COMET.modelId,
  create(run, x, z, id, rng) {
    return new LintRoller(id, this, run, x, z, rng, COMET);
  },
});
