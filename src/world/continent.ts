/**
 * Seeded continent generator (the area after the region), seen from the stratosphere. Pure data,
 * same shape as a house floor (HouseLayout). World units are the Continent's: 1 unit = 10 km
 * (`AREAS.continent.unit`); the Bunny leaps to 0.85 units on arrival (`AREAS.continent.arrivalRadius`)
 * and absorbs the Ice Sheet at ≈3–4.
 *
 * Layout (north is −Z): a landmass ringed by sea. The coast (`layout.walls`, ids `coast<i>`) is the
 * sea itself: a band along every edge with bays and headlands, a gulf in the south, a bay in the
 * west and cut-off corners, drawn as ocean by the view. Zones are painted on a 1-unit grid (plains
 * underneath, then tundra along the north, desert in the south-west, a mountain belt (the
 * cordillera) down the middle with two passes, a south-east range and northern highlands, a lake
 * district in the north-east, ruined cities, and three rivers on top) and merged into rects.
 *
 * Rivers are `rivers` zones, one feature per reach in course order (`riverA0`, `riverA1`, … from
 * source to mouth; a reach whose corner a later reach painted over also has `riverA0.1` …): A
 * drains the lake district south and east to the east coast, B is the great river from the tundra
 * south through the west plains and the desert to the south coast, C drains the lake district north
 * to the Arctic coast. `layout.routes` carries the same courses as polylines (kind 'river') plus
 * glacier lanes (kind 'glacier') running south from the north coast across the tundra.
 *
 * Mountain ranges are permanent obstacles (furniture `continent_range` in the cordillera and the
 * south-east range, `continent_massif` in the northern highlands; `mountainObstacleIds`), a
 * Bunny-wide `obstacleGap` from each other and from the sea. The exit (`layout.exit`) is the launch
 * corridor up to orbit: a stretch of the Arctic shore in the middle third of the north coast, barred
 * until the Ice Sheet is absorbed; touching it once open leaves for the Globe. The Bunny arrives at
 * the east edge, rolling west from the Region.
 */
import type { Rect } from '../core/math';
import { expandRect, rect, rectContains } from '../core/math';
import { Rng } from '../core/rng';
import { CONTINENT_DEBRIS } from '../data/continentDebris';
import { FURNITURE, furnitureObstacles } from './furniture';
import type { ContinentZoneType, DebrisPlacement, ExitDoor, FloorMaterialId, FurnitureInstance, GroundMarking, HouseLayout, MapRoute, Obstacle } from './types';
import { ZoneGrid } from './zoneGrid';

export const CONTINENT = {
  /** Map size in units (10 km): 2,000 km × 1,500 km. */
  width: 200,
  depth: 150,
  /** The sea along the edge is at least this deep (inwards from the map edge) and at most coastMax. */
  coastMin: 2,
  coastMax: 7,
  /** River width (30 km: these are drawn for a planet-sized dust bunny, not to scale). */
  riverWidth: 3,
  /** Clear gap between permanent obstacles and from the sea: a 4.5-unit Bunny (9 across) rolls through. */
  obstacleGap: 12,
  /** Debris spatial hash cell (units). */
  debrisCellSize: 1.5,
  /** Width of the launch corridor on the north coast (the exit to the Globe). */
  exitWidth: 8,
  /**
   * Real radius (cm) for Runs that start here (?area=continent): about the size after the
   * Incinerator (4.2 Region units, 42 m). Entering the Continent re-bases it, then the arrival leap
   * takes it to 0.85 units.
   */
  debugStartRadiusCm: 4200,
};

/** Furniture defs of the mountain ranges that stand as obstacles (the Ice Sheet is stunned only by these). */
export const MOUNTAIN_OBSTACLE_DEFS: readonly string[] = ['continent_range', 'continent_massif'];

/** Ids of the obstacles that are mountain ranges (bodies of `MOUNTAIN_OBSTACLE_DEFS` furniture). */
export function mountainObstacleIds(layout: HouseLayout): Set<string> {
  const ranges = new Set(layout.furniture.filter((f) => MOUNTAIN_OBSTACLE_DEFS.includes(f.defId)).map((f) => f.id));
  return new Set(layout.obstacles.filter((o) => o.furnitureId !== undefined && ranges.has(o.furnitureId)).map((o) => o.id));
}

const FLOORS: Record<ContinentZoneType, FloorMaterialId> = {
  plains: 'steppe',
  mountains: 'highlands',
  lakes: 'lakeWater',
  rivers: 'lakeWater',
  desert: 'desertSand',
  tundra: 'tundraSnow',
  ruins: 'ruinsAsh',
};

const SIZE = new Map(CONTINENT_DEBRIS.map((t) => [t.id, t.size]));
const sizeOf = (id: string): number => SIZE.get(id) ?? 0.2;

function rectGap(a: Rect, b: Rect): number {
  return Math.hypot(Math.max(0, a.minX - b.maxX, b.minX - a.maxX), Math.max(0, a.minZ - b.maxZ, b.minZ - a.maxZ));
}

function pointRectDist(x: number, z: number, r: Rect): number {
  return Math.hypot(Math.max(0, r.minX - x, x - r.maxX), Math.max(0, r.minZ - z, z - r.maxZ));
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

type Point = { x: number; z: number };

/** The reach rects of an axis-aligned polyline `w` wide (each reach covers its corners). */
function reachRects(points: readonly Point[], w: number): Rect[] {
  const h = w / 2;
  const out: Rect[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    out.push(rect(Math.min(a.x, b.x) - h, Math.min(a.z, b.z) - h, Math.max(a.x, b.x) + h, Math.max(a.z, b.z) + h));
  }
  return out;
}

export function generateContinent(seed: string | number): HouseLayout {
  const root = new Rng(seed);
  const rng = root.fork('continent');
  const C = CONTINENT;
  const W = C.width;
  const D = C.depth;
  const G = C.obstacleGap;
  const rw = C.riverWidth;
  const grid = new ZoneGrid<ContinentZoneType>(W, D, 'plains', FLOORS);
  const spawn = { x: W - 9, z: rng.int(62, 76), roomId: 'plains' };
  /** Keeps painted features off the arrival strip at the east edge. */
  const clearOfSpawn = (r: Rect, d = 14) => pointRectDist(spawn.x, spawn.z, r) > d;

  // ── The sea: a band along each edge with bays and headlands, a southern gulf, a western bay and cut corners ──
  const sea: Rect[] = [];
  const coastBand = (side: 'n' | 's' | 'w' | 'e', thin?: [number, number]) => {
    const len = side === 'n' || side === 's' ? W : D;
    let depth = rng.int(C.coastMin, C.coastMax);
    for (let t = 0; t < len; ) {
      const seg = Math.min(len - t, rng.int(5, 13));
      depth = clamp(depth + rng.int(-2, 2), C.coastMin, C.coastMax);
      const d = thin && t < thin[1] && t + seg > thin[0] ? C.coastMin : depth;
      if (side === 'n') sea.push(rect(t, -1, t + seg, d));
      else if (side === 's') sea.push(rect(t, D - d, t + seg, D + 1));
      else if (side === 'w') sea.push(rect(-1, t, d, t + seg));
      else sea.push(rect(W - d, t, W + 1, t + seg));
      t += seg;
    }
  };
  coastBand('n');
  coastBand('s');
  coastBand('w');
  coastBand('e', [spawn.z - 14, spawn.z + 14]);
  {
    const gx = rng.int(108, 132);
    const gw = rng.int(15, 20);
    const gd = rng.int(10, 14);
    sea.push(rect(gx, D - gd, gx + gw, D + 1), rect(gx + 3, D - gd - rng.int(3, 5), gx + gw - 3, D + 1));
  }
  const westBay = (() => {
    const bz = rng.int(36, 48);
    const bw = rng.int(12, 16);
    const bd = rng.int(8, 11);
    sea.push(rect(-1, bz, bd, bz + bw), rect(-1, bz + 3, bd + rng.int(2, 4), bz + bw - 3));
    return rect(-1, bz, bd + 4, bz + bw);
  })();
  sea.push(rect(W - rng.int(14, 20), D - rng.int(8, 11), W + 1, D + 1), rect(W - rng.int(6, 9), D - rng.int(16, 22), W + 1, D + 1));
  sea.push(rect(-1, -1, rng.int(14, 22), rng.int(6, 9)), rect(-1, -1, rng.int(5, 8), rng.int(13, 18)));
  sea.push(rect(W - rng.int(18, 26), -1, W + 1, rng.int(6, 8)));
  const inSea = (x: number, z: number, pad = 0) => sea.some((s) => rectContains(expandRect(s, pad), x, z));
  /** Depth of the north coast at x (how far the sea reaches south there). */
  const northCoast = (x: number) => Math.max(0, ...sea.filter((s) => s.minZ < 0 && x >= s.minX && x < s.maxX).map((s) => s.maxZ));

  // ── The exit: the launch corridor up to orbit, a strip of the Arctic shore in the middle of the north coast ──
  const exit: ExitDoor = (() => {
    const erng = root.fork('continent:exit');
    const hw = C.exitWidth / 2;
    const cx = erng.int(Math.round(W * 0.38), Math.round(W * 0.62));
    // The shoreline along the corridor: as far south as the sea reaches there.
    let shore = 0;
    for (let x = Math.floor(cx - hw); x < cx + hw; x++) shore = Math.max(shore, northCoast(x + 0.5));
    return { rect: rect(cx - hw, shore - 1.5, cx + hw, shore), dir: { x: 0, z: -1 }, obstacleId: 'launch_gate', open: false };
  })();
  const exitX = (exit.rect.minX + exit.rect.maxX) / 2;
  const exitZ = exit.rect.maxZ;

  // ── Tundra along the north, its southern edge wandering ──
  const tundraEdge: number[] = new Array(W).fill(0);
  {
    const f = grid.feature('tundra', 'tundra');
    let z1 = rng.int(20, 28);
    for (let x = 0; x < W; ) {
      const cw = Math.min(W - x, rng.int(9, 17));
      z1 = clamp(z1 + rng.int(-4, 4), 18, 30);
      grid.fill(f, rect(x, 0, x + cw, z1));
      tundraEdge.fill(z1, x, x + cw);
      x += cw;
    }
  }

  // ── Desert in the south-west ──
  const desertE = rng.int(62, 72);
  {
    const f = grid.feature('desert', 'desert');
    for (let x = 0; x < desertE; ) {
      const cw = Math.min(desertE - x, rng.int(8, 14));
      grid.fill(f, rect(x, rng.int(90, 102), x + cw, D));
      x += cw;
    }
    grid.fill(f, rect(desertE, rng.int(110, 118), desertE + rng.int(8, 12), D));
  }

  // ── Mountains: the cordillera with two passes, the south-east range, the northern highlands ──
  const beltX = rng.int(84, 92);
  const beltW = rng.int(13, 15);
  const pass1 = rng.int(52, 60);
  const pass2 = rng.int(94, 102);
  const passHalf = rng.int(4, 5);
  const cordillera = [
    rect(beltX, rng.int(18, 24), beltX + beltW, pass1 - passHalf),
    rect(beltX + rng.int(-3, 3), pass1 + passHalf, beltX + beltW + rng.int(-3, 3), pass2 - passHalf),
    rect(beltX + rng.int(-4, 2), pass2 + passHalf, beltX + beltW + rng.int(-2, 2), D - rng.int(18, 22)),
  ];
  const seRange = rect(rng.int(116, 122), rng.int(100, 104), rng.int(158, 166), 0);
  seRange.maxZ = seRange.minZ + rng.int(10, 12);
  const northX = rng.int(26, 40);
  const northRange = rect(northX, rng.int(14, 17), northX + rng.int(24, 30), rng.int(33, 37));
  {
    const f = grid.feature('cordillera', 'mountains');
    for (const r of cordillera) grid.fill(f, r);
    grid.fill(grid.feature('se_range', 'mountains'), seRange);
    grid.fill(grid.feature('north_range', 'mountains'), northRange);
  }

  // ── Lakes: the lake district in the north-east, a glacial lake in the tundra, one on the west plains ──
  const taken: Rect[] = [...cordillera, seRange, northRange, westBay];
  const lakes: Rect[] = [];
  const addLake = (area: Rect, w: [number, number], d: [number, number], tries = 60): Rect | null => {
    for (let i = 0; i < tries; i++) {
      const lw = rng.int(...w);
      const ld = rng.int(...d);
      const x = rng.int(area.minX, area.maxX - lw);
      const z = rng.int(area.minZ, area.maxZ - ld);
      const r = rect(x, z, x + lw, z + ld);
      if (!clearOfSpawn(r) || taken.some((t) => rectGap(t, r) < 4) || sea.some((s) => rectGap(s, r) < 3)) continue;
      taken.push(r);
      lakes.push(r);
      const f = grid.feature(`lake${lakes.length - 1}`, 'lakes');
      // An elliptical lake painted row by row, with a smaller lobe overlapping one side.
      const ellipse = (cx: number, cz: number, rx: number, rz: number) => {
        for (let z = Math.floor(cz - rz); z < Math.ceil(cz + rz); z++) {
          const t = (z + 0.5 - cz) / rz;
          if (Math.abs(t) >= 1) continue;
          const half = rx * Math.sqrt(1 - t * t);
          const x0 = Math.round(cx - half + rng.range(-0.4, 0.4));
          const x1 = Math.round(cx + half + rng.range(-0.4, 0.4));
          if (x1 > x0) grid.fill(f, rect(x0, z, x1, z + 1));
        }
      };
      ellipse(x + lw / 2, z + ld / 2, lw / 2, ld / 2);
      const side = rng.sign();
      ellipse(x + lw / 2 + side * lw * rng.range(0.25, 0.4), z + ld / 2 + rng.range(-1, 1), lw * rng.range(0.2, 0.3), ld * rng.range(0.3, 0.45));
      return r;
    }
    return null;
  };
  const district = rect(110, 30, 176, 64);
  for (let k = rng.int(4, 6); k > 0; k--) addLake(district, [6, 11], [4, 7]);
  addLake(rect(64, 16, 84, 28), [5, 8], [3, 5]);
  addLake(rect(18, 60, 64, 86), [6, 10], [4, 7]);

  // ── Rivers (courses first; painted last, over everything else) ──
  const rivers: Array<{ id: string; points: Point[] }> = [];
  {
    // A: from the southernmost district lake south, then east to the east coast below the arrival.
    const src = lakes.filter((l) => rectContains(district, (l.minX + l.maxX) / 2, (l.minZ + l.maxZ) / 2)).sort((a, b) => b.maxZ - a.maxZ)[0] ?? rect(140, 50, 148, 56);
    const x0 = Math.round((src.minX + src.maxX) / 2) + 0.5;
    const zEast = Math.min(spawn.z + rng.int(18, 22), seRange.minZ - 4) + 0.5;
    const zJog = Math.round((src.maxZ + zEast) / 2) + 0.5;
    const xJog = x0 + rng.int(5, 12);
    rivers.push({ id: 'riverA', points: [{ x: x0, z: src.maxZ - 1 }, { x: x0, z: zJog }, { x: xJog, z: zJog }, { x: xJog, z: zEast }, { x: W, z: zEast }] });
  }
  {
    // B: the great river, from the tundra's edge south through the west plains and the desert.
    const xMax = Math.min(...cordillera.map((r) => r.minX)) - 9;
    const xMin = westBay.maxX + 6;
    let x = rng.int(46, Math.min(60, xMax)) + 0.5;
    // It rises at the tundra's edge (south of the northern highlands if they are in the way).
    const z0 = x > northRange.minX - 3 && x < northRange.maxX + 3 ? northRange.maxZ + 2 : tundraEdge[Math.floor(x)]! - 3;
    const pts: Point[] = [{ x, z: z0 }];
    const zs = [rng.int(42, 50), rng.int(74, 84), rng.int(106, 116)];
    for (const z of zs) {
      pts.push({ x, z: z + 0.5 });
      x = clamp(x + rng.sign() * rng.int(6, 13), xMin + 0.5, xMax + 0.5);
      pts.push({ x, z: z + 0.5 });
    }
    pts.push({ x, z: D });
    rivers.push({ id: 'riverB', points: pts });
  }
  {
    // C: from the northernmost district lake north to the Arctic coast.
    const src = lakes.filter((l) => rectContains(district, (l.minX + l.maxX) / 2, (l.minZ + l.maxZ) / 2)).sort((a, b) => a.minZ - b.minZ)[0];
    if (src) {
      const x0 = Math.round((src.minX + src.maxX) / 2) + 0.5;
      const zJog = rng.int(14, Math.max(15, src.minZ - 6)) + 0.5;
      const x1 = clamp(x0 + rng.sign() * rng.int(5, 10), 110.5, W - 30.5);
      rivers.push({ id: 'riverC', points: [{ x: x0, z: src.minZ + 1 }, { x: x0, z: zJog }, { x: x1, z: zJog }, { x: x1, z: 0 }] });
    }
  }
  const riverReaches = rivers.map((r) => reachRects(r.points, rw));
  const nearRiver = riverReaches.flat();

  // ── Ruined cities: on the plains (some on the desert fringe), most of them on a river ──
  const ruins: Rect[] = [];
  {
    const reachPts = rivers.flatMap((r) => r.points.slice(0, -1).map((p, i) => ({ a: p, b: r.points[i + 1]! })));
    for (let k = 0, n = rng.int(5, 7), tries = 0; k < n && tries < 400; tries++) {
      const w = rng.int(8, 12);
      const d = rng.int(6, 9);
      let cx: number;
      let cz: number;
      if (rng.chance(0.7)) {
        const s = rng.pick(reachPts);
        const t = rng.next();
        cx = s.a.x + (s.b.x - s.a.x) * t + rng.range(-3, 3);
        cz = s.a.z + (s.b.z - s.a.z) * t + rng.range(-3, 3);
      } else {
        cx = rng.range(10, W - 10);
        cz = rng.range(30, D - 15);
      }
      const r = rect(Math.round(cx - w / 2), Math.round(cz - d / 2), Math.round(cx - w / 2) + w, Math.round(cz - d / 2) + d);
      if (!clearOfSpawn(r, 18) || !grid.allOf(expandRect(r, 1), ['plains', 'desert'])) continue;
      if (ruins.some((o) => rectGap(o, r) < 6) || sea.some((s) => rectGap(s, r) < 2)) continue;
      ruins.push(r);
      grid.fill(grid.feature(`ruins${k}`, 'ruins'), r);
      k++;
    }
  }
  rivers.forEach((river, i) => riverReaches[i]!.forEach((r, k) => grid.fill(grid.feature(`${river.id}${k}`, 'rivers'), r)));

  const rooms = grid.rooms();
  spawn.roomId = rooms.find((r) => rectContains(r.rect, spawn.x, spawn.z))!.id;

  // ── The coast: the sea is the edge; the launch gate bars the corridor until the Ice Sheet falls (an obstacle, not a wall) ──
  const walls: Obstacle[] = sea.map((r, i) => ({ id: `coast${i}`, kind: 'wall', rect: r, height: 0.3, clearance: 0 }));
  const gate: Obstacle = { id: exit.obstacleId, kind: 'wall', rect: exit.rect, height: 0.3, clearance: 0 };

  // ── Permanent obstacles: mountain ranges in the cordillera and the south-east range, a massif in the north ──
  const furniture: FurnitureInstance[] = [];
  const orng = root.fork('continent:obstacles');
  const placeObstacle = (defId: string, x: number, z: number, quarterTurns: number, w: number, d: number, h: number): boolean => {
    const rs = quarterTurns % 2 === 0 ? { w, d } : { w: d, d: w };
    const r = rect(x - rs.w / 2, z - rs.d / 2, x + rs.w / 2, z + rs.d / 2);
    if (r.minX < G || r.maxX > W - G || r.minZ < G || r.maxZ > D - G) return false;
    if (sea.some((s) => rectGap(s, r) < G)) return false;
    if (!grid.allOf(expandRect(r, 1), ['mountains'])) return false;
    if (pointRectDist(spawn.x, spawn.z, r) < 28) return false;
    // Keep the shore in front of the launch corridor open.
    if (pointRectDist(exitX, exitZ, r) < 2 * G) return false;
    if (furniture.some((f) => rectGap(f.rect, r) < G)) return false;
    const roomId = rooms.find((room) => rectContains(room.rect, x, z))!.id;
    furniture.push({ id: `${roomId}:${defId}${furniture.length}`, defId, roomId, x, z, quarterTurns, w, d, height: h, rect: r });
    return true;
  };
  const fit = (defId: string, area: Rect, alongZ: boolean, len: [number, number], thick: [number, number], h: [number, number]) => {
    const aw = area.maxX - area.minX;
    const ad = area.maxZ - area.minZ;
    const l = Math.min(orng.int(...len), (alongZ ? ad : aw) - 3);
    const t = Math.min(orng.int(...thick), (alongZ ? aw : ad) - 3);
    if (l < 6 || t < 4) return;
    const height = Math.round(orng.range(...h) * 10) / 10;
    const [sx, sz] = alongZ ? [t, l] : [l, t];
    for (let tries = 0; tries < 30; tries++) {
      const x = Math.round(orng.range(area.minX + 1.5 + sx / 2, area.maxX - 1.5 - sx / 2) * 2) / 2;
      const z = Math.round(orng.range(area.minZ + 1.5 + sz / 2, area.maxZ - 1.5 - sz / 2) * 2) / 2;
      if (placeObstacle(defId, x, z, alongZ ? 1 : 0, l, t, height)) return;
    }
  };
  for (const r of cordillera) fit('continent_range', r, true, [13, 19], [5, 7], [3.8, 5]);
  fit('continent_range', seRange, false, [16, 24], [5, 7], [3.4, 4.4]);
  fit('continent_massif', northRange, false, [9, 12], [7, 9], [4.2, 5.2]);

  // ── Fixed Debris: the ruins, mesa country, volcanoes, sea ice, forests along the rivers, farmland ──
  const prng = root.fork('continent:debris');
  const debrisPlacements: DebrisPlacement[] = [];
  const solid = [...sea, ...furniture.map((f) => f.rect)];
  const placed: Array<{ x: number; z: number; s: number }> = [];
  /** Places `typeId` if its disc (with the size jitter) stays inside `zones`, clear of the sea, landmarks, the spawn and other placements. */
  const tryPlace = (typeId: string, x: number, z: number, zones: readonly ContinentZoneType[]): boolean => {
    const s = sizeOf(typeId) * 1.2;
    if (!grid.allOf(rect(x - s, z - s, x + s, z + s), zones)) return false;
    for (const o of solid) if (pointRectDist(x, z, o) < s + 1.2) return false;
    if (Math.hypot(x - spawn.x, z - spawn.z) < s + (s > 0.6 ? 16 : 6)) return false;
    for (const p of placed) if (Math.hypot(p.x - x, p.z - z) < p.s + s + 0.4) return false;
    placed.push({ x, z, s });
    debrisPlacements.push({ typeId, x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100, rotY: Math.round(prng.range(0, Math.PI * 2) * 1000) / 1000 });
    return true;
  };
  const around = (typeId: string, cx: number, cz: number, dist: number, zones: readonly ContinentZoneType[], tries = 8): boolean => {
    for (let i = 0; i < tries; i++) {
      const a = prng.range(0, Math.PI * 2);
      const d = dist * prng.range(0.8, 1.3);
      if (tryPlace(typeId, cx + Math.cos(a) * d, cz + Math.sin(a) * d, zones)) return true;
    }
    return false;
  };
  const scatter = (typeId: string, n: number, zones: readonly ContinentZoneType[], area: Rect = rect(0, 0, W, D)) => {
    for (let k = 0, tries = 0; k < n && tries < n * 40; tries++) if (tryPlace(typeId, prng.range(area.minX, area.maxX), prng.range(area.minZ, area.maxZ), zones)) k++;
  };
  const RUINS: readonly ContinentZoneType[] = ['ruins'];
  const bySize = [...ruins].sort((a, b) => (b.maxX - b.minX) * (b.maxZ - b.minZ) - (a.maxX - a.minX) * (a.maxZ - a.minZ));
  bySize.forEach((r, i) => {
    const cx = (r.minX + r.maxX) / 2;
    const cz = (r.minZ + r.maxZ) / 2;
    if (i === 0) tryPlace('metropolis_ruins', cx, cz, RUINS) || scatter('metropolis_ruins', 1, RUINS, r);
    else if (i <= 2) tryPlace('ruined_megacity', cx, cz, RUINS) || scatter('ruined_megacity', 1, RUINS, r);
    scatter('city_ruins', prng.int(2, 3), RUINS, r);
    scatter('ruined_suburbs', prng.int(3, 5), RUINS, r);
    // What is left of the farmland that fed it.
    for (let k = prng.int(2, 4); k > 0; k--) around('farmland', cx, cz, Math.max(r.maxX - r.minX, r.maxZ - r.minZ) * 0.6 + 2, ['plains']);
  });
  // Mesa country and salt flats in the desert; oases along the great river.
  scatter('mesa', prng.int(8, 12), ['desert']);
  scatter('salt_flat', prng.int(2, 3), ['desert']);
  scatter('canyon', prng.int(1, 2), ['desert']);
  for (const reach of riverReaches[1] ?? []) {
    if (!grid.allOf(rect((reach.minX + reach.maxX) / 2 - 0.5, (reach.minZ + reach.maxZ) / 2 - 0.5, (reach.minX + reach.maxX) / 2 + 0.5, (reach.minZ + reach.maxZ) / 2 + 0.5), ['rivers'])) continue;
    for (let k = 0; k < 3; k++) {
      const t = prng.next();
      around('oasis', reach.minX + (reach.maxX - reach.minX) * t, reach.minZ + (reach.maxZ - reach.minZ) * t, rw / 2 + 1.2, ['desert'], 4);
    }
  }
  // Volcanoes and loose ranges in the mountains.
  scatter('volcanic_field', 2, ['mountains']);
  scatter('shield_volcano', 1, ['mountains']);
  scatter('mountain_range', 3, ['mountains']);
  // Sea ice and icebergs along the Arctic coast, an ice field and taiga in the tundra.
  for (let k = 0, tries = 0; k < 8 && tries < 200; tries++) {
    const x = prng.range(8, W - 8);
    if (tryPlace(k % 3 === 2 ? 'iceberg' : 'pack_ice', x, northCoast(x) + prng.range(2, 5), ['tundra'])) k++;
  }
  scatter('ice_field', 1, ['tundra']);
  scatter('taiga', 4, ['tundra']);
  // Forests along the rivers, oxbow lakes on the plains, a dam on an upper reach, deltas at the mouths.
  for (const reach of nearRiver) {
    for (let k = 0; k < 2; k++) {
      const t = prng.next();
      around('forest_patch', reach.minX + (reach.maxX - reach.minX) * t, reach.minZ + (reach.maxZ - reach.minZ) * t, rw / 2 + 0.9, ['plains'], 4);
    }
  }
  scatter('oxbow_lake', 3, ['plains', 'rivers']);
  for (const river of rivers) {
    const p = river.points;
    tryPlace('hydro_dam', (p[0]!.x + p[1]!.x) / 2, (p[0]!.z + p[1]!.z) / 2, ['rivers']);
  }

  // ── Routes for Hazards: river courses (clipped at the coast) and glacier lanes across the tundra ──
  const routes: MapRoute[] = rivers.map((river) => {
    const pts = river.points.map((p) => ({ ...p }));
    const last = pts[pts.length - 1]!;
    const prev = pts[pts.length - 2]!;
    const dx = Math.sign(prev.x - last.x);
    const dz = Math.sign(prev.z - last.z);
    while (inSea(last.x, last.z, rw / 2 + 0.5) && (last.x !== prev.x || last.z !== prev.z)) {
      last.x += dx;
      last.z += dz;
    }
    return { id: river.id, kind: 'river', points: pts, width: rw };
  });
  {
    const blocked = [...sea, ...furniture.map((f) => f.rect)];
    // One lane in each third of the north (the longest of a few tries), clear of the rivers' north-south reaches.
    const riverXs = rivers.flatMap((r) => r.points.map((p) => p.x));
    ([[20, 64], [76, 124], [134, 180]] as const).forEach(([a, b], i) => {
      let best: MapRoute | null = null;
      for (let k = 0; k < 10; k++) {
        const x0 = rng.int(a, b);
        const x = x0 + 0.5;
        if (riverXs.some((rx) => Math.abs(rx - x) < rw + 2)) continue;
        const z0 = northCoast(x) + 2;
        let z1 = z0;
        const end = (tundraEdge[x0] ?? 24) + rng.int(4, 10);
        while (z1 < end && !blocked.some((r) => pointRectDist(x, z1 + 1, r) < 1.5)) z1++;
        if (z1 - z0 >= 8 && (!best || z1 - z0 > best.points[1]!.z - best.points[0]!.z)) best = { id: `glacier${i}`, kind: 'glacier', points: [{ x, z: z0 }, { x, z: z1 }], width: 2.5 };
      }
      if (best) routes.push(best);
    });
  }

  // ── Markings (render-only): what is left of the highways between the cities ──
  const markings: GroundMarking[] = [];
  {
    const ROAD = '#6d675e';
    const ok = (x: number, z: number) => {
      const t = grid.typeAt(x, z);
      return (t === 'plains' || t === 'desert' || t === 'ruins' || t === 'tundra') && !inSea(x, z, 0.5) && !solid.some((s) => rectContains(s, x, z));
    };
    const dashes = (alongX: boolean, c: number, a0: number, a1: number) => {
      const [lo, hi] = a0 < a1 ? [a0, a1] : [a1, a0];
      for (let t = lo; t + 1.1 < hi; t += 1.7) {
        const mx = alongX ? t + 0.55 : c;
        const mz = alongX ? c : t + 0.55;
        if (!ok(mx, mz)) continue;
        markings.push({ rect: alongX ? rect(t, c - 0.08, t + 1.1, c + 0.08) : rect(c - 0.08, t, c + 0.08, t + 1.1), color: ROAD });
      }
    };
    const centres = ruins.map((r) => ({ x: Math.round((r.minX + r.maxX) / 2) + 0.5, z: Math.round((r.minZ + r.maxZ) / 2) + 0.5 })).sort((a, b) => a.x - b.x);
    for (let i = 0; i + 1 < centres.length; i++) {
      const a = centres[i]!;
      const b = centres[i + 1]!;
      dashes(true, a.z, a.x, b.x);
      dashes(false, b.x, a.z, b.z);
    }
    // The road the Bunny came in on: from the east coast west to the nearest city.
    const near = [...centres].sort((a, b) => Math.hypot(a.x - spawn.x, a.z - spawn.z) - Math.hypot(b.x - spawn.x, b.z - spawn.z))[0];
    if (near) {
      dashes(true, spawn.z + 0.5, near.x, W);
      dashes(false, near.x, spawn.z + 0.5, near.z);
    }
  }

  const obstacles: Obstacle[] = [...walls, gate, ...furniture.flatMap((f) => furnitureObstacles(f, FURNITURE[f.defId]!))];
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
    exit,
    markings,
    routes,
  };
}
