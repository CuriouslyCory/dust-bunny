/**
 * Shared Hazard helpers: movement with wall/furniture collision, shelter checks, suction,
 * damage + knockback, aim targets (the Bunny, or Lint's Decoy as a Lure), angles.
 * Headless-safe (no DOM / WebGL).
 */
import { circleVsCircle, circleVsRect, clamp, rectContains } from '../core/math';
import type { Rng } from '../core/rng';
import type { Bunny } from '../entities/bunny';
import type { Run } from '../game/run';
import type { Hazard } from './index';
import { canAbsorb } from '../systems/absorb';
import { passesUnder } from '../systems/collision';
import { maxSpeedFor } from '../systems/movement';
import { roomAt } from '../world/house';
import type { HouseLayout, Obstacle } from '../world/types';
import { canonicalX } from '../world/wrap';

/** True if `o` blocks a Hazard of this height (walls always; furniture unless it fits underneath). */
export function hazardBlockedBy(o: Obstacle, height: number): boolean {
  return o.kind === 'wall' || o.clearance <= height;
}

export interface MoveResult {
  x: number;
  z: number;
  /** True if an obstacle or the house bounds stopped part of the move. */
  hit: boolean;
  /** Summed collision normal (not normalised) when hit. */
  nx: number;
  nz: number;
}

/** Moves a circle by (dx, dz) and resolves it against walls, blocking furniture and the house bounds. */
export function moveCircle(house: HouseLayout, x: number, z: number, radius: number, height: number, dx: number, dz: number): MoveResult {
  // On a map that wraps east–west, resolve against the canonical copy of the obstacles and keep the lap.
  const lap = x - canonicalX(house, x);
  x -= lap;
  let px = x + dx;
  let pz = z + dz;
  let hit = false;
  let nx = 0;
  let nz = 0;
  for (let iter = 0; iter < 2; iter++) {
    for (const o of house.obstacles) {
      if (!hazardBlockedBy(o, height)) continue;
      const p = circleVsRect(px, pz, radius, o.rect);
      if (!p) continue;
      px += p.x;
      pz += p.z;
      nx += p.nx;
      nz += p.nz;
      hit = true;
    }
  }
  const b = house.bounds;
  const cx = house.wrapX ? px : clamp(px, b.minX + radius, b.maxX - radius);
  const cz = clamp(pz, b.minZ + radius, b.maxZ - radius);
  if (cx !== px) {
    nx += cx > px ? 1 : -1;
    hit = true;
  }
  if (cz !== pz) {
    nz += cz > pz ? 1 : -1;
    hit = true;
  }
  return { x: cx + lap, z: cz, hit, nx, nz };
}

/** True if a Hazard disc fits at (x, z): inside a room and clear of anything that blocks it. */
export function hazardFloorFree(house: HouseLayout, x: number, z: number, radius: number, height: number): boolean {
  x = canonicalX(house, x);
  if (!roomAt(house, x, z)) return false;
  for (const o of house.obstacles) {
    if (hazardBlockedBy(o, height) && circleVsRect(x, z, radius, o.rect)) return false;
  }
  return true;
}

/** Distance (cm) along (dirX, dirZ) a Hazard can travel from (x, z) before being blocked. */
export function freeDistance(house: HouseLayout, x: number, z: number, dirX: number, dirZ: number, radius: number, height: number, max: number, step = 4): number {
  let d = 0;
  while (d + step <= max && hazardFloorFree(house, x + dirX * (d + step), z + dirZ * (d + step), radius, height)) d += step;
  return d;
}

/**
 * True if the Bunny is hiding under furniture this Hazard cannot get under
 * (e.g. under the couch skirt): no contact, no suction.
 */
export function bunnySheltered(run: Run, hazardHeight: number): boolean {
  const b = run.bunny;
  // Obstacles are stored once on a map that wraps east–west: test the Bunny's canonical copy.
  const bx = canonicalX(run.house, b.x);
  for (const o of run.house.obstacles) {
    if (o.kind !== 'furniture' || !passesUnder(b.radius, o) || o.clearance > hazardHeight) continue;
    if (rectContains(o.rect, bx, b.z)) return true;
  }
  return false;
}

/**
 * Suction falloff: 1 at or inside `inner` (the Hazard's edge), linearly down to 0 at `outer`.
 */
export function suctionFalloff(dist: number, inner: number, outer: number): number {
  if (outer <= inner) return dist <= inner ? 1 : 0;
  return clamp(1 - (dist - inner) / (outer - inner), 0, 1);
}

/** Suction reach scaled by the Bunny's suctionMultiplier (half as strongly as the pull itself). */
export function suctionReachFor(baseReach: number, suctionMultiplier: number): number {
  return baseReach * (1 + (suctionMultiplier - 1) * 0.5);
}

/**
 * Pull speed (cm/s) towards a suction source: strength × falloff × suctionMultiplier,
 * as a fraction of the Bunny's max speed. Weaker while invulnerable so the Bunny can escape.
 */
export function suctionSpeed(bunnyMaxSpeed: number, strength: number, falloff: number, suctionMultiplier: number, invulnerable: boolean): number {
  return bunnyMaxSpeed * strength * falloff * suctionMultiplier * (invulnerable ? 0.35 : 1);
}

/** Displaces the Bunny towards (sx, sz) for one tick. Returns the pull speed applied. */
export function applySuction(run: Run, sx: number, sz: number, strength: number, falloff: number, dt: number): number {
  const b = run.bunny;
  if (falloff <= 0 || b.hiddenFromHazards) return 0;
  const dx = sx - b.x;
  const dz = sz - b.z;
  const d = Math.hypot(dx, dz);
  if (d < 1e-3) return 0;
  const speed = suctionSpeed(maxSpeedFor(b), strength, falloff, b.stats.get('suctionMultiplier'), b.invulnerable > 0);
  const step = Math.min(d, speed * dt);
  b.x += (dx / d) * step;
  b.z += (dz / d) * step;
  return speed;
}

/**
 * Displaces the Bunny away from (sx, sz) for one tick (Leaf Blower): strength × falloff ×
 * suctionMultiplier of the Bunny's max speed. Unlike suction it is not weakened during i-frames:
 * escaping a push only means leaving the cone. Returns the push speed applied.
 */
export function applyPush(run: Run, sx: number, sz: number, strength: number, falloff: number, dt: number): number {
  const b = run.bunny;
  if (falloff <= 0 || b.hiddenFromHazards || b.amassing) return 0;
  const dx = b.x - sx;
  const dz = b.z - sz;
  const d = Math.hypot(dx, dz);
  if (d < 1e-3) return 0;
  const speed = suctionSpeed(maxSpeedFor(b), strength, falloff, b.stats.get('suctionMultiplier'), false);
  b.x += (dx / d) * speed * dt;
  b.z += (dz / d) * speed * dt;
  return speed;
}

/** Knockback distance (cm) for a hit: max(cm, radii × Bunny radius). */
export function knockbackDistance(bunnyRadius: number, cm: number, radii: number): number {
  return Math.max(cm, radii * bunnyRadius);
}

/** Knocks the Bunny ~`distance` cm along (dirX, dirZ), scaled by knockbackResistance. */
export function knockbackCm(b: Bunny, dirX: number, dirZ: number, distance: number): void {
  // Impulses decay at e^(-8t), so total displacement ≈ impulse / 8.
  b.knockback(dirX, dirZ, (distance * 8) / Math.max(b.radius, 0.01));
}

/** Pushes the Bunny out of a solid circle (Hazard body). */
export function pushBunnyOut(run: Run, x: number, z: number, radius: number): void {
  const b = run.bunny;
  const p = circleVsCircle(b.x, b.z, b.radius, x, z, radius);
  if (!p) return;
  b.x += p.x;
  b.z += p.z;
}

/**
 * Separates a Hazard body (circle of `radius` at h.x, h.z) from the Bunny: normally the Bunny is
 * pushed out, but an Amassing Bunny can't be displaced, so the Hazard is pushed back instead
 * (resolved against walls and furniture at `height`).
 */
export function separateFromBunny(run: Run, h: { x: number; z: number }, radius: number, height: number): void {
  const b = run.bunny;
  if (!b.amassing) {
    pushBunnyOut(run, h.x, h.z, radius);
    return;
  }
  const p = circleVsCircle(h.x, h.z, radius, b.x, b.z, b.radius);
  if (!p) return;
  const m = moveCircle(run.house, h.x, h.z, radius, height, p.x, p.z);
  h.x = m.x;
  h.z = m.z;
}

export interface HitSpec {
  damage: number;
  source: string;
  knockbackCm: number;
  knockbackRadii: number;
  /** Knockback direction; defaults to away from (fromX, fromZ). */
  dirX?: number;
  dirZ?: number;
}

/** Damages the Bunny and knocks it back from (fromX, fromZ). Returns true if damage landed. */
export function hitBunny(run: Run, fromX: number, fromZ: number, hit: HitSpec): boolean {
  const b = run.bunny;
  if (!b.damage(hit.damage, hit.source)) return false;
  const dx = hit.dirX ?? b.x - fromX;
  const dz = hit.dirZ ?? b.z - fromZ;
  knockbackCm(b, dx, dz, knockbackDistance(b.radius, hit.knockbackCm, hit.knockbackRadii));
  return true;
}

/**
 * A stand-in target for Hazards that aim (Lint's Decoy). Installed per Run by src/abilities with
 * setLure; Hazards only read it through aimTarget / activeLure.
 */
export interface Lure {
  x: number;
  z: number;
  radius: number;
  /** Multiplies each Hazard's own aggro / trigger range when checking the Lure (1 = base). */
  rangeMul: number;
  /** Wanderers (Roomba family) within this distance (cm) of the Lure steer towards it (0 = off). */
  wanderRange: number;
  /** A ranged attack (spray burst, blower blast) reached the Lure. */
  shot(h: Hazard): void;
}

const lures = new WeakMap<Run, Lure>();

/** Sets (or clears, with null) the Run's Lure. */
export function setLure(run: Run, lure: Lure | null): void {
  if (lure) lures.set(run, lure);
  else lures.delete(run);
}

/** The Run's active Lure (Decoy on the floor), if any. */
export function activeLure(run: Run): Lure | undefined {
  return lures.get(run);
}

/** Where a Hazard aims: the Bunny or a Lure standing in for it. */
export interface AimTarget {
  x: number;
  z: number;
  radius: number;
  /** True when this is the Lure, not the Bunny. */
  lure: boolean;
}

/**
 * The point a Hazard at (fromX, fromZ) with aggro / trigger range `range` (cm) aims at: the Lure
 * while it is within range × lure.rangeMul (plus its radius), otherwise the Bunny unless it is
 * hidden (Dust Cloud), else null. The Bunny is returned at any distance: callers keep their own
 * range checks for it. Suction and contact still act on the Bunny by distance; only aim changes.
 */
export function aimTarget(run: Run, fromX: number, fromZ: number, range: number): AimTarget | null {
  const lure = lures.get(run);
  if (lure && Math.hypot(lure.x - fromX, lure.z - fromZ) <= range * lure.rangeMul + lure.radius) return { x: lure.x, z: lure.z, radius: lure.radius, lure: true };
  const b = run.bunny;
  if (b.hiddenFromHazards) return null;
  return { x: b.x, z: b.z, radius: b.radius, lure: false };
}

/** Drags the Lure towards a suction intake at (sx, sz) by `speed` cm/s (vacuums pull the Decoy in). */
export function pullLure(run: Run, sx: number, sz: number, speed: number, dt: number): void {
  const lure = lures.get(run);
  if (!lure || speed <= 0) return;
  const dx = sx - lure.x;
  const dz = sz - lure.z;
  const d = Math.hypot(dx, dz);
  if (d < 1e-3) return;
  const step = Math.min(d, speed * dt);
  lure.x += (dx / d) * step;
  lure.z += (dz / d) * step;
}

export function bunnyCanAbsorb(run: Run, size: number): boolean {
  return canAbsorb(run.bunny.radius, run.bunny.stats.get('absorbRatio'), size);
}

/** Bunny radius needed to absorb a Hazard of this size. */
export function absorbRadiusFor(size: number, absorbRatio: number): number {
  return size / absorbRatio;
}

/** Wraps an angle to (-π, π]. */
export function wrapAngle(a: number): number {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
}

/** Turns `current` towards `target` by at most `maxStep` radians. */
export function turnTowards(current: number, target: number, maxStep: number): number {
  const d = wrapAngle(target - current);
  return Math.abs(d) <= maxStep ? target : current + Math.sign(d) * maxStep;
}

/** Yaw (radians about +Y) so that +Z model forward faces (dx, dz). */
export const yawOf = (dx: number, dz: number): number => Math.atan2(dx, dz);

export function randomIn(rng: Rng, range: readonly [number, number]): number {
  return rng.range(range[0], range[1]);
}
