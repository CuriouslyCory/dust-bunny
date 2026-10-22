/**
 * Seeded continent generator (the area after the region), seen from the stratosphere. Pure data,
 * same shape as a house floor (HouseLayout). World units are the Continent's: 1 unit = 10 km
 * (`AREAS.continent.unit`); the Bunny leaps to 0.85 units on arrival (`AREAS.continent.arrivalRadius`)
 * and absorbs the Ice Sheet at ≈3–4.
 *
 * PLACEHOLDER (Act 5 groundwork): a plain map so the Area is playable end to end. Zones are painted
 * on a 1-unit grid (plains underneath, then tundra in the north, desert in the south-west, a
 * mountain belt down the middle with passes, lakes and ruined cities scattered over the plains)
 * and merged into rects. The edge is a ridge wall; a few massifs in the mountain belt are
 * permanent obstacles (the boss crashes into them and the edge). There is no exit: the Continent is
 * the last built Area, so the Ice Sheet wins the Run. The Bunny arrives at the east edge, rolling
 * west from the Region.
 */
import type { Rect } from '../core/math';
import { expandRect, rect, rectContains } from '../core/math';
import { Rng } from '../core/rng';
import { FURNITURE, furnitureObstacles } from './furniture';
import { wallSegments } from './house';
import type { ContinentZoneType, DebrisPlacement, FloorMaterialId, FurnitureInstance, HouseLayout, Obstacle } from './types';
import { ZoneGrid } from './zoneGrid';

export const CONTINENT = {
  /** Map size in units (10 km): 2,000 km × 1,500 km. */
  width: 200,
  depth: 150,
  /** Ridge around the edge. */
  wallThickness: 2,
  wallHeight: 3,
  /** Clear gap between permanent obstacles and from the edge: a 4.5-unit Bunny (9 across) rolls through. */
  obstacleGap: 12,
  /** Debris spatial hash cell (units). */
  debrisCellSize: 1.5,
  /**
   * Real radius (cm) for Runs that start here (?area=continent): about the size after the
   * Incinerator (4.2 Region units, 42 m). Entering the Continent re-bases it, then the arrival leap
   * takes it to 0.85 units.
   */
  debugStartRadiusCm: 4200,
};

const FLOORS: Record<ContinentZoneType, FloorMaterialId> = {
  plains: 'steppe',
  mountains: 'highlands',
  lakes: 'lakeWater',
  desert: 'desertSand',
  tundra: 'tundraSnow',
  ruins: 'ruinsAsh',
};

function rectGap(a: Rect, b: Rect): number {
  return Math.hypot(Math.max(0, a.minX - b.maxX, b.minX - a.maxX), Math.max(0, a.minZ - b.maxZ, b.minZ - a.maxZ));
}

function pointRectDist(x: number, z: number, r: Rect): number {
  return Math.hypot(Math.max(0, r.minX - x, x - r.maxX), Math.max(0, r.minZ - z, z - r.maxZ));
}

export function generateContinent(seed: string | number): HouseLayout {
  const root = new Rng(seed);
  const rng = root.fork('continent');
  const C = CONTINENT;
  const W = C.width;
  const D = C.depth;
  const T = C.wallThickness;
  const G = C.obstacleGap;
  const grid = new ZoneGrid<ContinentZoneType>(W, D, 'plains', FLOORS);
  const spawn = { x: W - 8, z: Math.round(rng.range(68, 82)), roomId: 'plains' };
  /** Keeps painted features off the arrival strip at the east edge. */
  const clearOfSpawn = (r: Rect) => pointRectDist(spawn.x, spawn.z, r) > 14;

  // ── Tundra along the north, desert in the south-west ──
  grid.fill(grid.feature('tundra', 'tundra'), rect(0, 0, W, rng.int(16, 24)));
  grid.fill(grid.feature('tundra_east', 'tundra'), rect(rng.int(130, 150), 0, W, rng.int(28, 36)));
  const desert = grid.feature('desert', 'desert');
  grid.fill(desert, rect(0, rng.int(96, 106), rng.int(64, 76), D));
  grid.fill(desert, rect(rng.int(8, 16), rng.int(84, 92), rng.int(40, 52), D));

  // ── Mountain belt down the middle, broken by two passes ──
  const beltX = rng.int(92, 104);
  const beltW = rng.int(12, 16);
  const pass1 = rng.int(44, 54);
  const pass2 = rng.int(96, 106);
  const mountains = grid.feature('mountains', 'mountains');
  const belt = [rect(beltX, 10, beltX + beltW, pass1 - 6), rect(beltX + rng.int(-4, 4), pass1 + 6, beltX + beltW + rng.int(-4, 4), pass2 - 6), rect(beltX + rng.int(-6, 2), pass2 + 6, beltX + beltW, D - 10)];
  for (const r of belt) grid.fill(mountains, r);

  // ── Lakes and ruined cities over the plains ──
  const placed: Rect[] = [...belt];
  const scatterZones = (name: string, type: ContinentZoneType, n: number, w: [number, number], d: [number, number]) => {
    for (let k = 0, tries = 0; k < n && tries < n * 40; tries++) {
      const rw = rng.int(...w);
      const rd = rng.int(...d);
      const x = rng.int(6, W - 6 - rw);
      const z = rng.int(6, D - 6 - rd);
      const r = rect(x, z, x + rw, z + rd);
      if (!clearOfSpawn(r) || placed.some((p) => rectGap(p, r) < 4)) continue;
      placed.push(r);
      grid.fill(grid.feature(`${name}${k}`, type), r);
      k++;
    }
  };
  scatterZones('lake', 'lakes', rng.int(4, 6), [6, 12], [5, 9]);
  scatterZones('ruins', 'ruins', rng.int(4, 6), [8, 14], [6, 10]);

  const rooms = grid.rooms();
  spawn.roomId = rooms.find((r) => rectContains(r.rect, spawn.x, spawn.z))!.id;

  // ── Edge: a ridge all the way round (no exit: the Continent is the last built Area) ──
  const wallRects = [...wallSegments('h', 0, 0, W, [], T), ...wallSegments('h', D, 0, W, [], T), ...wallSegments('v', 0, 0, D, [], T), ...wallSegments('v', W, 0, D, [], T)];
  const walls: Obstacle[] = wallRects.map((r, i) => ({ id: `coast${i}`, kind: 'wall', rect: r, height: C.wallHeight, clearance: 0 }));

  // ── Permanent obstacles: massifs in the mountain belt (placeholder models: the Region's ridges and hills) ──
  const furniture: FurnitureInstance[] = [];
  const orng = root.fork('continent:obstacles');
  /** A massif `len` long north to south and `thick` wide (the model's long axis, local X, turned a quarter). */
  const placeObstacle = (defId: string, x: number, z: number, thick: number, len: number, h: number): boolean => {
    const r = rect(x - thick / 2, z - len / 2, x + thick / 2, z + len / 2);
    if (r.minX < T / 2 + G || r.maxX > W - T / 2 - G || r.minZ < T / 2 + G || r.maxZ > D - T / 2 - G) return false;
    if (!grid.allOf(expandRect(r, 1), ['mountains'])) return false;
    if (furniture.some((f) => rectGap(f.rect, r) < G)) return false;
    const roomId = rooms.find((room) => rectContains(room.rect, x, z))!.id;
    furniture.push({ id: `${roomId}:${defId}${furniture.length}`, defId, roomId, x, z, quarterTurns: 1, w: len, d: thick, height: h, rect: r });
    return true;
  };
  for (const r of belt) {
    const d = Math.min(orng.int(14, 20), r.maxZ - r.minZ - 4);
    const w = Math.min(orng.int(6, 8), r.maxX - r.minX - 4);
    if (d < 6 || w < 4) continue;
    for (let tries = 0; tries < 20; tries++) {
      const x = orng.range(r.minX + 2 + w / 2, r.maxX - 2 - w / 2);
      const z = orng.range(r.minZ + 2 + d / 2, r.maxZ - 2 - d / 2);
      if (placeObstacle(orng.chance(0.5) ? 'region_ridge' : 'region_hill', Math.round(x * 2) / 2, Math.round(z * 2) / 2, w, d, Math.round(orng.range(3, 4.5) * 10) / 10)) break;
    }
  }

  // ── Fixed Debris: the ruined cities ──
  const debrisPlacements: DebrisPlacement[] = [];
  const prng = root.fork('continent:debris');
  for (const room of rooms) {
    if (room.type !== 'ruins') continue;
    const r = room.rect;
    if (r.maxX - r.minX < 4 || r.maxZ - r.minZ < 4) continue;
    debrisPlacements.push({ typeId: 'city_ruins', x: Math.round(prng.range(r.minX + 1.5, r.maxX - 1.5) * 100) / 100, z: Math.round(prng.range(r.minZ + 1.5, r.maxZ - 1.5) * 100) / 100, rotY: Math.round(prng.range(0, Math.PI * 2) * 1000) / 1000 });
  }

  const obstacles: Obstacle[] = [...walls, ...furniture.flatMap((f) => furnitureObstacles(f, FURNITURE[f.defId]!))];
  return {
    area: 'continent',
    seed: root.seed,
    bounds: rect(0, 0, W, D),
    rooms,
    doorways: [],
    walls,
    furniture,
    obstacles,
    rugs: [],
    debrisPlacements,
    spawn,
    markings: [],
  };
}
