/**
 * Shared Hazard helpers: movement with wall/furniture collision, shelter checks, suction,
 * damage + knockback, angles. Headless-safe (no DOM / WebGL).
 */
import { circleVsCircle, circleVsRect, clamp, rectContains } from '../core/math';
import type { Rng } from '../core/rng';
import type { Bunny } from '../entities/bunny';
import type { Run } from '../game/run';
import { canAbsorb } from '../systems/absorb';
import { passesUnder } from '../systems/collision';
import { maxSpeedFor } from '../systems/movement';
import { roomAt } from '../world/house';
import type { HouseLayout, Obstacle } from '../world/types';

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
  const cx = clamp(px, b.minX + radius, b.maxX - radius);
  const cz = clamp(pz, b.minZ + radius, b.maxZ - radius);
  if (cx !== px) {
    nx += cx > px ? 1 : -1;
    hit = true;
  }
  if (cz !== pz) {
    nz += cz > pz ? 1 : -1;
    hit = true;
  }
  return { x: cx, z: cz, hit, nx, nz };
}

/** True if a Hazard disc fits at (x, z): inside a room and clear of anything that blocks it. */
export function hazardFloorFree(house: HouseLayout, x: number, z: number, radius: number, height: number): boolean {
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
  for (const o of run.house.obstacles) {
    if (o.kind !== 'furniture' || !passesUnder(b.radius, o) || o.clearance > hazardHeight) continue;
    if (rectContains(o.rect, b.x, b.z)) return true;
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

/** False while the Bunny is hidden (Dust Cloud): Hazards must not target, chase, aim or pull. */
export function canTarget(run: Run): boolean {
  return !run.bunny.hiddenFromHazards;
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
