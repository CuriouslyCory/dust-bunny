/** Bunny vs walls / furniture (AABB) and vs Obstacle Debris (circles) on the XZ plane. */
import { circleVsCircle, circleVsRect, clamp, rectContains, type PushOut } from '../core/math';
import type { Debris } from '../entities/debris';
import type { Bunny } from '../entities/bunny';
import type { Obstacle } from '../world/types';
import { SYSTEM_ORDER, type System } from '../game/system';
import { canAbsorb } from './absorb';

/** True if the Bunny can pass under this obstacle (diameter below its clearance). */
export function passesUnder(radius: number, o: Obstacle): boolean {
  return o.clearance > 0 && radius * 2 < o.clearance;
}

function applyPush(b: Bunny, p: PushOut): void {
  b.x += p.x;
  b.z += p.z;
  // Remove the velocity component going into the obstacle.
  const vn = b.vx * p.nx + b.vz * p.nz;
  if (vn < 0) {
    b.vx -= vn * p.nx;
    b.vz -= vn * p.nz;
  }
  const inn = b.impulseX * p.nx + b.impulseZ * p.nz;
  if (inn < 0) {
    b.impulseX -= inn * p.nx;
    b.impulseZ -= inn * p.nz;
  }
}

/** Push a Bunny whose centre is inside `o` out through its open side (o.exitDir). */
function ejectThrough(b: Bunny, o: Obstacle): PushOut {
  const e = o.exitDir!;
  const r = o.rect;
  const dx = e.x > 0 ? r.maxX + b.radius - b.x : e.x < 0 ? r.minX - b.radius - b.x : 0;
  const dz = e.z > 0 ? r.maxZ + b.radius - b.z : e.z < 0 ? r.minZ - b.radius - b.z : 0;
  return { x: dx, z: dz, nx: e.x, nz: e.z, depth: Math.hypot(dx, dz) };
}

const scratch: Debris[] = [];

export const collisionSystem: System = {
  id: 'collision',
  order: SYSTEM_ORDER.collision,
  update(_dt, run) {
    const b = run.bunny;
    const ratio = b.stats.get('absorbRatio');
    for (let iter = 0; iter < 2; iter++) {
      for (const o of run.house.obstacles) {
        if (passesUnder(b.radius, o)) continue;
        const p = o.exitDir && rectContains(o.rect, b.x, b.z) ? ejectThrough(b, o) : circleVsRect(b.x, b.z, b.radius, o.rect);
        if (p) applyPush(b, p);
      }
      scratch.length = 0;
      run.debris.queryOverlapping(b.x, b.z, b.radius, scratch);
      for (const d of scratch) {
        if (canAbsorb(b.radius, ratio, d.size)) continue;
        // Debris collides with a slightly smaller disc so things feel less sticky.
        const p = circleVsCircle(b.x, b.z, b.radius, d.x, d.z, d.size * 0.85);
        if (p) applyPush(b, p);
      }
    }
    const bd = run.house.bounds;
    b.x = clamp(b.x, bd.minX + b.radius, bd.maxX - b.radius);
    b.z = clamp(b.z, bd.minZ + b.radius, bd.maxZ - b.radius);
  },
};
