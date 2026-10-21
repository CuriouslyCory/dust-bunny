/** Bunny vs walls / furniture (AABB) and vs Obstacle Debris (circles) on the XZ plane. */
import { circleVsCircle, circleVsRect, clamp, rectContains, type PushOut } from '../core/math';
import type { Debris } from '../entities/debris';
import type { Bunny } from '../entities/bunny';
import { TUNING } from '../data/tuning';
import type { Run } from '../game/run';
import type { HouseLayout, Obstacle } from '../world/types';
import { SYSTEM_ORDER, type System } from '../game/system';
import { canAbsorb } from './absorb';

/** True if the Bunny can pass under this obstacle (diameter below its clearance). */
export function passesUnder(radius: number, o: Obstacle): boolean {
  return o.clearance > 0 && radius * 2 < o.clearance;
}

/**
 * Radius the Bunny collides with against walls: inside a doorway it squeezes (fur squashes)
 * so a big Bunny still fits through the 90 cm doors at Tier 4–5. Returns `radius` elsewhere.
 * The squeeze applies while the Bunny's centre is within the door span and close enough to the
 * wall line to touch it, so it funnels towards the door centre instead of snapping.
 */
export function wallRadiusAt(house: HouseLayout, x: number, z: number, radius: number): number {
  let out = radius;
  for (const d of house.doorways) {
    const r = d.rect;
    const alongX = r.maxX - r.minX >= r.maxZ - r.minZ;
    const half = (alongX ? r.maxX - r.minX : r.maxZ - r.minZ) / 2;
    const thick = (alongX ? r.maxZ - r.minZ : r.maxX - r.minX) / 2;
    const u = alongX ? x - (r.minX + r.maxX) / 2 : z - (r.minZ + r.maxZ) / 2;
    const v = alongX ? z - (r.minZ + r.maxZ) / 2 : x - (r.minX + r.maxX) / 2;
    if (Math.abs(u) <= half && Math.abs(v) <= radius + thick) out = Math.min(out, Math.max(TUNING.minRadius, half - 0.5));
  }
  return out;
}

const contactNx: number[] = [];
const contactNz: number[] = [];
const contactD: number[] = [];

/**
 * Radius the Bunny collides with against walls and furniture when it is wedged in a gap narrower
 * than itself (touching obstacles on roughly opposite sides): the fur squeezes to fit, down to
 * TUNING.squeeze.min × radius, and the push-out centres it in the gap. A Bunny that outgrew the
 * hallway, or the space between a console table and the wall, can still roll on. Head-on into a
 * gap between two corners it only squeezes once the gap is ~1.4 × its radius, so small gaps stay
 * closed. Returns `radius` when not wedged.
 */
export function gapRadiusAt(house: HouseLayout, x: number, z: number, radius: number): number {
  const s = TUNING.squeeze;
  contactNx.length = contactNz.length = contactD.length = 0;
  for (const o of house.obstacles) {
    if (passesUnder(radius, o)) continue;
    const r = o.rect;
    const dx = x - clamp(x, r.minX, r.maxX);
    const dz = z - clamp(z, r.minZ, r.maxZ);
    const d2 = dx * dx + dz * dz;
    // Centre inside the box (no normal) or not touching.
    if (d2 < 1e-6 || d2 >= radius * radius) continue;
    const d = Math.sqrt(d2);
    contactNx.push(dx / d);
    contactNz.push(dz / d);
    contactD.push(d);
  }
  let out = radius;
  for (let i = 0; i < contactD.length; i++) {
    for (let j = i + 1; j < contactD.length; j++) {
      if (contactNx[i]! * contactNx[j]! + contactNz[i]! * contactNz[j]! > s.opposing) continue;
      out = Math.min(out, (contactD[i]! + contactD[j]!) / 2 - 0.5);
    }
  }
  return Math.max(TUNING.minRadius, radius * s.min, out);
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

/** How deep a Debris disc at (x, z) sits in walls, furniture it can't slide under, or the house edge (0 = fits). */
function debrisPenetration(house: HouseLayout, x: number, z: number, size: number): number {
  const bd = house.bounds;
  let pen = Math.max(0, bd.minX - (x - size), x + size - bd.maxX, bd.minZ - (z - size), z + size - bd.maxZ);
  for (const o of house.obstacles) {
    if (o.kind === 'furniture' && o.clearance > size * 2) continue;
    const p = circleVsRect(x, z, size, o.rect);
    if (p && p.depth > pen) pen = p.depth;
  }
  return pen;
}

/**
 * Almost-absorbable Obstacle Debris (size ≤ radius × pushRatio) gets shoved: it takes most of
 * the overlap and the Bunny is slowed rather than stopped. Reads as "nearly big enough" and
 * keeps the Bunny from being boxed in by clutter it can't absorb yet. Returns false (no push)
 * when the Debris is too big or would be shoved into a wall or furniture.
 */
export function pushDebris(run: Run, d: Debris, p: PushOut): boolean {
  const b = run.bunny;
  const c = TUNING.push;
  if (d.size > b.radius * c.ratio) return false;
  const nx = d.x - p.x * c.share;
  const nz = d.z - p.z * c.share;
  // Template Debris (chairs at a table) may start touching furniture: allow any shove that
  // doesn't push it deeper in.
  const ds = d.size * 0.85;
  if (debrisPenetration(run.house, nx, nz, ds) > debrisPenetration(run.house, d.x, d.z, ds) + 1e-3) return false;
  run.debris.move(d, nx, nz);
  b.x += p.x * (1 - c.share);
  b.z += p.z * (1 - c.share);
  // Pushing is heavy work: bleed off part of the velocity going into the Debris.
  const vn = b.vx * p.nx + b.vz * p.nz;
  if (vn < 0) {
    b.vx -= vn * p.nx * c.drag;
    b.vz -= vn * p.nz * c.drag;
  }
  return true;
}

export const collisionSystem: System = {
  id: 'collision',
  order: SYSTEM_ORDER.collision,
  update(_dt, run) {
    const b = run.bunny;
    const ratio = b.stats.get('absorbRatio');
    const gapR = gapRadiusAt(run.house, b.x, b.z, b.radius);
    const wallR = Math.min(gapR, wallRadiusAt(run.house, b.x, b.z, b.radius));
    b.squeeze = wallR / b.radius;
    for (let iter = 0; iter < 2; iter++) {
      for (const o of run.house.obstacles) {
        if (passesUnder(b.radius, o)) continue;
        const rr = o.kind === 'wall' ? wallR : gapR;
        const p = o.exitDir && rectContains(o.rect, b.x, b.z) ? ejectThrough(b, o) : circleVsRect(b.x, b.z, rr, o.rect);
        if (p) applyPush(b, p);
      }
      scratch.length = 0;
      run.debris.queryOverlapping(b.x, b.z, b.radius, scratch);
      for (const d of scratch) {
        if (canAbsorb(b.radius, ratio, d.size)) continue;
        // Debris collides with a slightly smaller disc so things feel less sticky.
        const p = circleVsCircle(b.x, b.z, b.radius, d.x, d.z, d.size * 0.85);
        if (!p) continue;
        if (pushDebris(run, d, p)) continue;
        applyPush(b, p);
      }
    }
    // The outer walls sit on the bounds, so a Bunny squeezed along one may come closer to the edge.
    const bd = run.house.bounds;
    b.x = clamp(b.x, bd.minX + wallR, bd.maxX - wallR);
    b.z = clamp(b.z, bd.minZ + wallR, bd.maxZ - wallR);
  },
};
