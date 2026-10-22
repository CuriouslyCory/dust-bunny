/**
 * East–west wrap-around for maps with `layout.wrapX` (the Globe). Pure maths, no three.js.
 *
 * World x is unbounded on a wrapping map: the Bunny, Debris, Hazards and Pickups keep continuous
 * coordinates as the Bunny circles the planet, so distances between them need no wrapping and the
 * camera never jumps. Everything static (rooms, obstacles, routes, the exit) is stored once in the
 * canonical strip [bounds.minX, bounds.maxX); lookups go through `canonicalX`. Things far behind
 * the Bunny are moved a lap (`wrapWidth`) so they stay within half a lap of it (Run's `wrap`
 * System), and the view draws the static world at the copies around the camera (`wrapCopies`).
 */
import type { HouseLayout } from './types';

/** Width of one lap (the map's east–west extent), or 0 if the map does not wrap. */
export function wrapWidth(layout: HouseLayout): number {
  return layout.wrapX ? layout.bounds.maxX - layout.bounds.minX : 0;
}

/** `x` moved by whole laps into the canonical strip [minX, maxX) (unchanged on a map that does not wrap). */
export function canonicalX(layout: HouseLayout, x: number): number {
  const w = wrapWidth(layout);
  if (w <= 0) return x;
  const min = layout.bounds.minX;
  const v = min + ((((x - min) % w) + w) % w);
  // Rounding can land exactly on maxX; the strip is half-open.
  return v >= layout.bounds.maxX ? min : v;
}

/** The copy of `x` (moved by whole laps) nearest `ref`: a canonical position seen from the Bunny at `ref`. */
export function nearestImageX(layout: HouseLayout, x: number, ref: number): number {
  const w = wrapWidth(layout);
  if (w <= 0) return x;
  return x + Math.round((ref - x) / w) * w;
}

/** Shortest signed east–west offset from `fromX` to `toX` (plain difference on a map that does not wrap). */
export function wrapDeltaX(layout: HouseLayout, fromX: number, toX: number): number {
  return nearestImageX(layout, toX, fromX) - fromX;
}

/**
 * Lap offsets (multiples of the width) at which to draw the static world so a view centred on `x`
 * sees the map continue past both edges: the lap containing `x` and its two neighbours. `[0]` on a
 * map that does not wrap.
 */
export function wrapCopies(layout: HouseLayout, x: number): number[] {
  const w = wrapWidth(layout);
  if (w <= 0) return [0];
  const lap = Math.floor((x - layout.bounds.minX) / w) * w;
  return [lap - w, lap, lap + w];
}

/** True if (x, z) is inside the map's bounds (any x on a map that wraps east–west). */
export function insideBounds(layout: HouseLayout, x: number, z: number): boolean {
  const b = layout.bounds;
  return z >= b.minZ && z <= b.maxZ && (layout.wrapX || (x >= b.minX && x <= b.maxX));
}
