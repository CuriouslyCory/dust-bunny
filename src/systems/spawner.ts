/**
 * Debris spawner. At Run start it populates the house (start cluster under the couch,
 * template placements, a distance-banded scatter). During the Run it keeps the number of
 * meaningful absorbable Debris around the Bunny near a target by spawning outside the
 * camera view, and culls far-away Debris that has become too small to matter.
 */
import { len2 } from '../core/math';
import type { Rng } from '../core/rng';
import { roomWeight, type DebrisType } from '../data/debris';
import { tierForRadius } from '../data/tiers';
import { TUNING } from '../data/tuning';
import type { Debris } from '../entities/debris';
import type { Run } from '../game/run';
import { SYSTEM_ORDER, type System } from '../game/system';
import { roomAt } from '../world/house';
import type { HouseLayout, RoomType } from '../world/types';
import { cameraDistanceFor, DEFAULT_VIEW_ASPECT, framingForAspect, floorPointVisible, viewRadiusFor, type ViewInfo } from './camera';
import { passesUnder } from './collision';

/** True if a Debris disc of radius `size` can sit at (x, z): inside a room, clear of walls and solid furniture. */
export function isFloorFree(house: HouseLayout, x: number, z: number, size: number): RoomType | null {
  const room = roomAt(house, x, z);
  if (!room) return null;
  for (const o of house.obstacles) {
    const r = o.rect;
    if (x > r.minX - size && x < r.maxX + size && z > r.minZ - size && z < r.maxZ + size) {
      // Small Debris may sit under furniture with enough clearance (dust under the couch).
      if (o.kind === 'furniture' && o.clearance > size * 2) continue;
      return null;
    }
  }
  return room.type;
}

/**
 * True if a Bunny of `radius` can touch a Debris disc of `size` at (x, z): the Debris is not
 * tucked under furniture the Bunny is too big to roll under (e.g. lint under the bed once the
 * Bunny outgrew the gap). Debris poking out past the furniture edge stays reachable.
 */
export function reachableBy(house: HouseLayout, x: number, z: number, size: number, radius: number): boolean {
  for (const o of house.obstacles) {
    if (o.kind !== 'furniture' || passesUnder(radius, o)) continue;
    const r = o.rect;
    if (x > r.minX + size && x < r.maxX - size && z > r.minZ + size && z < r.maxZ - size) return false;
  }
  return true;
}

/** Framing to keep spawns out of: the live camera (if rendering), never tighter than the Tier's target framing. */
export function spawnView(run: Run): ViewInfo {
  const target = cameraDistanceFor(run.bunny.radius, run.tier);
  const v = run.viewInfo;
  // The live distance lags a Tier-up zoom; never use less than the Tier's (aspect-framed) target.
  return v ? { ...v, distance: Math.max(v.distance, target * framingForAspect(v.aspect).distanceScale) } : { distance: target, aspect: DEFAULT_VIEW_ASPECT, fovDeg: TUNING.camera.fov };
}

export class DebrisSpawner implements System {
  readonly id = 'spawner';
  readonly order = SYSTEM_ORDER.spawner;
  private timer = 0;
  private readonly scratch: Debris[] = [];

  constructor(private readonly rng: Rng) {}

  private typeIndex(run: Run, type: DebrisType): number {
    return run.debris.types.indexOf(type);
  }

  /** Initial population. Called once by the Run before the first update. */
  populate(run: Run): void {
    const { house, debris } = run;
    const types = debris.types;
    const rng = this.rng;

    for (const p of house.debrisPlacements) {
      const i = types.findIndex((t) => t.id === p.typeId);
      if (i >= 0) debris.spawn(i, p.x, p.z, rng, { rotY: p.rotY });
    }

    // Start cluster: dense Speck-sized Debris around (and under) the couch.
    const r0 = run.bunny.radius;
    const cfg = TUNING.debris;
    const startTypes = types.filter((t) => t.tiers[0] <= 1 && t.size <= r0 * 1.6);
    for (let n = 0, tries = 0; n < cfg.startCluster && tries < cfg.startCluster * 6; tries++) {
      const a = rng.range(0, Math.PI * 2);
      const d = Math.sqrt(rng.next()) * cfg.startClusterRadius + r0 * 1.5;
      const x = house.spawn.x + Math.cos(a) * d;
      const z = house.spawn.z + Math.sin(a) * d;
      const room = roomAt(house, x, z);
      if (!room) continue;
      const t = rng.weighted(startTypes, (tt) => roomWeight(tt, room.type) * (tt.size <= r0 * 0.7 ? 1 : 0.2));
      if (!t || !isFloorFree(house, x, z, t.size)) continue;
      debris.spawn(this.typeIndex(run, t), x, z, rng);
      n++;
    }

    // Scatter: Tier band grows with distance from the spawn point.
    const maxDist = len2(house.bounds.maxX - house.bounds.minX, house.bounds.maxZ - house.bounds.minZ);
    for (let n = 0, tries = 0; n < cfg.initialScatter && tries < cfg.initialScatter * 4; tries++) {
      const x = rng.range(house.bounds.minX, house.bounds.maxX);
      const z = rng.range(house.bounds.minZ, house.bounds.maxZ);
      const room = roomAt(house, x, z);
      if (!room) continue;
      const dn = len2(x - house.spawn.x, z - house.spawn.z) / maxDist;
      const tier = Math.min(5, Math.max(1, Math.round(1 + dn * 5 + rng.range(-1, 1))));
      const t = rng.weighted(types, (tt) => (tier >= tt.tiers[0] && tier <= tt.tiers[1] ? roomWeight(tt, room.type) : 0));
      if (!t || !isFloorFree(house, x, z, t.size)) continue;
      debris.spawn(this.typeIndex(run, t), x, z, rng);
      n++;
    }
  }

  update(dt: number, run: Run): void {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = TUNING.spawner.interval;
    this.cull(run);
    this.topUp(run);
  }

  /** Weight of spawning `t` for a Bunny of radius r. 0 = never. */
  static spawnWeight(t: DebrisType, r: number, absorbRatio: number, tier: number, room: RoomType): number {
    const s = TUNING.spawner;
    if (tier < t.tiers[0] - 1 || tier > t.tiers[1]) return 0;
    if (t.size < r * s.meaningfulRatio) return 0;
    const rw = roomWeight(t, room);
    if (t.size <= r * absorbRatio) return rw;
    if (t.size <= r * 1.5 && tier >= t.tiers[0]) return rw * s.obstacleShare;
    return 0;
  }

  private topUp(run: Run): void {
    const { bunny, debris, house } = run;
    const s = TUNING.spawner;
    const r = bunny.radius;
    const ratio = bunny.stats.get('absorbRatio');
    const tier = tierForRadius(r).index;
    const viewR = viewRadiusFor(r, run.tier);
    const outer = viewR * s.spawnOuter;
    const inner = viewR * s.spawnInner;
    const view = spawnView(run);

    this.scratch.length = 0;
    debris.query(bunny.x, bunny.z, outer, this.scratch);
    let meaningful = 0;
    // Only count Debris the Bunny can actually get to (not stranded under the bed it outgrew).
    for (const d of this.scratch) if (d.size >= r * s.meaningfulRatio && d.size <= r * ratio && reachableBy(house, d.x, d.z, d.size, r)) meaningful++;
    let want = Math.min(s.maxPerPass, s.targetCount - meaningful);
    if (want <= 0) return;

    // Sample the part of the house within `outer` that is off screen. Late in the Run the view
    // covers most of the house, so sample the clipped box rather than a ring (which would mostly
    // land outside the walls) and keep whatever slivers are hidden (usually behind the camera).
    const bd = house.bounds;
    const x0 = Math.max(bd.minX, bunny.x - outer);
    const x1 = Math.min(bd.maxX, bunny.x + outer);
    const z0 = Math.max(bd.minZ, bunny.z - outer);
    const z1 = Math.min(bd.maxZ, bunny.z + outer);
    const types = debris.types;
    for (let tries = 0; want > 0 && tries < s.maxPerPass * s.triesPerSpawn && !debris.full; tries++) {
      const x = this.rng.range(x0, x1);
      const z = this.rng.range(z0, z1);
      const dist = len2(x - bunny.x, z - bunny.z);
      if (dist > outer || dist < inner) continue;
      const room = roomAt(house, x, z);
      if (!room) continue;
      const t = this.rng.weighted(types, (tt) => DebrisSpawner.spawnWeight(tt, r, ratio, tier, room.type));
      if (!t || floorPointVisible(x - bunny.x, z - bunny.z, view, t.size * 1.2) || !isFloorFree(house, x, z, t.size) || !reachableBy(house, x, z, t.size, r)) continue;
      debris.spawn(this.typeIndex(run, t), x, z, this.rng);
      want--;
    }
  }

  private cull(run: Run): void {
    const { bunny, debris } = run;
    const s = TUNING.spawner;
    const r = bunny.radius;
    const viewR = viewRadiusFor(r, run.tier);
    const minSize = r * (debris.full ? s.meaningfulRatio : s.cullRatio);
    const victims: Debris[] = [];
    debris.forEach((d) => {
      if (victims.length >= s.maxCullPerPass) return;
      if (d.size < minSize && len2(d.x - bunny.x, d.z - bunny.z) > viewR) victims.push(d);
    });
    for (const d of victims) debris.remove(d);
  }
}
