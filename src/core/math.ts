/** Small math helpers. The floor plane is XZ; "2D" here means (x, z). */

export interface Vec2 {
  x: number;
  z: number;
}

/** Axis-aligned rectangle on the floor plane (cm). */
export interface Rect {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export const clamp = (v: number, min: number, max: number): number => (v < min ? min : v > max ? max : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const invLerp = (a: number, b: number, v: number): number => (a === b ? 0 : (v - a) / (b - a));

/** Frame-rate independent exponential smoothing towards `target`. `rate` ~ 1/seconds. */
export const damp = (current: number, target: number, rate: number, dt: number): number =>
  lerp(current, target, 1 - Math.exp(-rate * dt));

export const len2 = (x: number, z: number): number => Math.sqrt(x * x + z * z);

export function rect(minX: number, minZ: number, maxX: number, maxZ: number): Rect {
  return { minX, minZ, maxX, maxZ };
}

export function rectFromCenter(cx: number, cz: number, w: number, d: number): Rect {
  return { minX: cx - w / 2, minZ: cz - d / 2, maxX: cx + w / 2, maxZ: cz + d / 2 };
}

export const rectWidth = (r: Rect): number => r.maxX - r.minX;
export const rectDepth = (r: Rect): number => r.maxZ - r.minZ;

export function rectsOverlap(a: Rect, b: Rect, pad = 0): boolean {
  return a.minX < b.maxX + pad && a.maxX > b.minX - pad && a.minZ < b.maxZ + pad && a.maxZ > b.minZ - pad;
}

export function rectContains(r: Rect, x: number, z: number, pad = 0): boolean {
  return x >= r.minX + pad && x <= r.maxX - pad && z >= r.minZ + pad && z <= r.maxZ - pad;
}

export function expandRect(r: Rect, by: number): Rect {
  return { minX: r.minX - by, minZ: r.minZ - by, maxX: r.maxX + by, maxZ: r.maxZ + by };
}

export interface PushOut {
  x: number;
  z: number;
  /** Unit collision normal pointing from the obstacle towards the circle. */
  nx: number;
  nz: number;
  depth: number;
}

/**
 * Circle vs AABB. Returns the push-out vector that moves the circle out of the box,
 * or null if they do not overlap. Handles the centre-inside-box case.
 */
export function circleVsRect(cx: number, cz: number, r: number, box: Rect): PushOut | null {
  const px = clamp(cx, box.minX, box.maxX);
  const pz = clamp(cz, box.minZ, box.maxZ);
  const dx = cx - px;
  const dz = cz - pz;
  const d2 = dx * dx + dz * dz;
  if (d2 > 0) {
    if (d2 >= r * r) return null;
    const d = Math.sqrt(d2);
    const depth = r - d;
    const nx = dx / d;
    const nz = dz / d;
    return { x: nx * depth, z: nz * depth, nx, nz, depth };
  }
  // Centre inside the box: push out along the axis of least penetration.
  const left = cx - box.minX;
  const right = box.maxX - cx;
  const top = cz - box.minZ;
  const bottom = box.maxZ - cz;
  const m = Math.min(left, right, top, bottom);
  if (m === left) return { x: -(left + r), z: 0, nx: -1, nz: 0, depth: left + r };
  if (m === right) return { x: right + r, z: 0, nx: 1, nz: 0, depth: right + r };
  if (m === top) return { x: 0, z: -(top + r), nx: 0, nz: -1, depth: top + r };
  return { x: 0, z: bottom + r, nx: 0, nz: 1, depth: bottom + r };
}

/** Circle A vs static circle B. Push-out applies fully to A. */
export function circleVsCircle(ax: number, az: number, ar: number, bx: number, bz: number, br: number): PushOut | null {
  const dx = ax - bx;
  const dz = az - bz;
  const rr = ar + br;
  const d2 = dx * dx + dz * dz;
  if (d2 >= rr * rr) return null;
  const d = Math.sqrt(d2);
  if (d < 1e-6) return { x: rr, z: 0, nx: 1, nz: 0, depth: rr };
  const depth = rr - d;
  const nx = dx / d;
  const nz = dz / d;
  return { x: nx * depth, z: nz * depth, nx, nz, depth };
}
