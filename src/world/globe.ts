/**
 * Seeded globe generator (the area after the continent): the Earth seen from orbit, laid out as a
 * flat map that wraps east–west (`layout.wrapX`: roll off the east edge, arrive from the west; see
 * src/world/wrap.ts). Pure data, same shape as a house floor (HouseLayout). World units are the
 * Globe's: 1 unit = 1,000 km (`AREAS.globe.unit`); the Bunny leaps to 0.85 units on arrival
 * (`AREAS.globe.arrivalRadius`) and absorbs the Orbital Sweeper at ≈3–4.
 *
 * Layout (north is −Z): open ocean underneath, landmasses ringed by shallow shelf seas, island
 * chains (archipelagos) and an ice cap along each pole. Zones are painted on a 1-unit grid and
 * merged into rects. Curvature is sold by the sky, the light and the chapter card, not geometry.
 *
 * Wrap rules: the strip within `seamMargin` of the east–west seam is open ocean, and the map has
 * no obstacles (the poles are the bounds), so collision never needs to look across the seam. The
 * width keeps half a lap beyond the largest view so the wrap System's lap moves stay off screen.
 * `layout.routes` carries the orbit lanes (kind 'orbit'): straight east–west lines across the
 * whole map that a lane Hazard can follow round the planet.
 */
import type { Rect } from '../core/math';
import { rect, rectContains } from '../core/math';
import { Rng } from '../core/rng';
import type { FloorMaterialId, GlobeZoneType, HouseLayout, MapRoute } from './types';
import { ZoneGrid } from './zoneGrid';

export const GLOBE = {
  /** Map size in units (1,000 km): a 2:1 lap, like an equirectangular map. */
  width: 400,
  depth: 200,
  /** Ice cap depth at each pole (units, varies along the edge). */
  capMin: 6,
  capMax: 14,
  /** Open ocean on each side of the east–west seam. */
  seamMargin: 14,
  /** Orbit lane width (units). */
  laneWidth: 3,
  /** Debris spatial hash cell (units). */
  debrisCellSize: 1.5,
  /**
   * Real radius (cm) for Runs that start here (?area=globe): about the size after the Ice Sheet
   * (4.4 Continent units, 44 km). Entering the Globe re-bases it, then the arrival leap takes it
   * to 0.85 units.
   */
  debugStartRadiusCm: 4.4e6,
};

const FLOORS: Record<GlobeZoneType, FloorMaterialId> = {
  oceans: 'ocean',
  shelves: 'lakeWater',
  landmasses: 'steppe',
  archipelagos: 'lakeWater',
  icecaps: 'tundraSnow',
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function generateGlobe(seed: string | number): HouseLayout {
  const root = new Rng(seed);
  const rng = root.fork('globe');
  const G = GLOBE;
  const W = G.width;
  const D = G.depth;
  const grid = new ZoneGrid<GlobeZoneType>(W, D, 'oceans', FLOORS);
  // The Bunny arrives over open ocean in the middle of the map.
  const spawn = { x: Math.round(W / 2), z: Math.round(D / 2), roomId: 'oceans' };
  const nearSpawn = (r: Rect, d: number) => Math.hypot(Math.max(0, r.minX - spawn.x, spawn.x - r.maxX), Math.max(0, r.minZ - spawn.z, spawn.z - r.maxZ)) < d;
  const lo = G.seamMargin;
  const hi = W - G.seamMargin;

  // ── Landmasses: clusters of overlapping blocks, each ringed by a shelf sea ──
  const lands: Rect[] = [];
  for (let k = 0, tries = 0; k < 6 && tries < 200; tries++) {
    const w = rng.int(30, 60);
    const d = rng.int(24, 50);
    const x = rng.int(lo + 4, hi - 4 - w);
    const z = rng.int(G.capMax + 8, D - G.capMax - 8 - d);
    const r = rect(x, z, x + w, z + d);
    if (nearSpawn(r, 22) || lands.some((o) => Math.max(o.minX - r.maxX, r.minX - o.maxX, o.minZ - r.maxZ, r.minZ - o.maxZ) < 10)) continue;
    lands.push(r);
    k++;
  }
  const shelf = grid.feature('shelves', 'shelves');
  const blocks: Rect[][] = lands.map((r) => {
    const out: Rect[] = [r];
    for (let i = 0; i < 6; i++) {
      const w = rng.int(8, 20);
      const d = rng.int(8, 18);
      const x = clamp(rng.int(r.minX - 6, r.maxX - w + 6), lo + 3, hi - 3 - w);
      const z = clamp(rng.int(r.minZ - 6, r.maxZ - d + 6), G.capMax + 4, D - G.capMax - 4 - d);
      out.push(rect(x, z, x + w, z + d));
    }
    return out;
  });
  for (const bs of blocks) for (const b of bs) grid.fill(shelf, rect(Math.max(lo, b.minX - 3), b.minZ - 3, Math.min(hi, b.maxX + 3), b.maxZ + 3));
  blocks.forEach((bs, i) => {
    const f = grid.feature(`landmass${i}`, 'landmasses');
    for (const b of bs) grid.fill(f, b);
  });

  // ── Archipelagos: chains of small islands in their own shelf seas ──
  for (let k = 0, tries = 0; k < 7 && tries < 200; tries++) {
    const n = rng.int(4, 8);
    let x = rng.int(lo + 4, hi - 40);
    let z = rng.int(G.capMax + 10, D - G.capMax - 10);
    const r = rect(x - 4, z - 12, x + 36, z + 12);
    if (nearSpawn(r, 14) || lands.some((o) => Math.max(o.minX - r.maxX, r.minX - o.maxX, o.minZ - r.maxZ, r.minZ - o.maxZ) < 4)) continue;
    const f = grid.feature(`archipelago${k}`, 'archipelagos');
    for (let i = 0; i < n; i++) {
      grid.fill(f, rect(x - 2, z - 2, x + 2, z + 2));
      x += rng.int(3, 6);
      z = clamp(z + rng.int(-3, 3), G.capMax + 6, D - G.capMax - 6);
    }
    k++;
  }

  // ── Ice caps along both poles, their edges wandering ──
  {
    const f = grid.feature('icecaps', 'icecaps');
    let n = rng.int(G.capMin, G.capMax);
    let s = rng.int(G.capMin, G.capMax);
    for (let x = 0; x < W; ) {
      const cw = Math.min(W - x, rng.int(8, 18));
      n = clamp(n + rng.int(-3, 3), G.capMin, G.capMax);
      s = clamp(s + rng.int(-3, 3), G.capMin, G.capMax);
      grid.fill(f, rect(x, 0, x + cw, n));
      grid.fill(f, rect(x, D - s, x + cw, D));
      x += cw;
    }
  }

  const rooms = grid.rooms();
  spawn.roomId = rooms.find((r) => rectContains(r.rect, spawn.x, spawn.z))!.id;

  // ── Orbit lanes: east–west lines across the whole lap ──
  const routes: MapRoute[] = [0.28, 0.5, 0.72].map((f, i) => {
    const z = Math.round(D * f) + 0.5 + (i === 1 ? 6 : 0);
    return { id: `orbit${i}`, kind: 'orbit', points: [{ x: 0, z }, { x: W, z }], width: G.laneWidth };
  });

  return {
    area: 'globe',
    seed: root.seed,
    bounds: rect(0, 0, W, D),
    rooms,
    doorways: [],
    walls: [],
    furniture: [],
    obstacles: [],
    rugs: [],
    debrisPlacements: [],
    spawn,
    routes,
    wrapX: true,
  };
}
