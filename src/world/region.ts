/**
 * Seeded region generator (the area after the city): several towns, the motorways between them,
 * patchwork farmland, a river, woods and a landfill, seen from a few kilometres up. Pure data, same
 * shape as a house floor (HouseLayout). World units are the Region's: 1 unit = 10 m
 * (`AREAS.region.unit`), so the Bunny arrives at ≈0.65–0.9 units and leaves at ≈4.5.
 *
 * Layout: zones are painted on a 1-unit grid (farmland underneath, then woods, the landfill, towns,
 * the river and the motorways on top) and merged back into rects, so they tile the map without
 * overlapping. The main motorway (M1) crosses the map west to east; the Bunny rolls in on it at
 * the west edge, where the road from the City arrives. A second motorway (H1) crosses north to
 * south through the big city at the junction, a spur (H2) runs north from M1 and another (H3) east
 * from H1 past the landfill in the south-east. The river runs north to south west of the city in
 * six straight reaches (zones `river0`…`river5`, in course order; M1 bridges it between `river2`
 * and `river3`). Permanent obstacles (city centres, hills, ridges) keep `obstacleGap` clear of each
 * other and of the edge, so a Bunny of any Region size can roll around them. Every motorway leaves
 * the map through a closed roadblock in the wooded ridge around the edge and carries on out of
 * bounds (render-only markings).
 */
import type { Rect } from '../core/math';
import { expandRect, rect, rectContains } from '../core/math';
import { Rng } from '../core/rng';
import { REGION_DEBRIS } from '../data/regionDebris';
import { FURNITURE, furnitureObstacles } from './furniture';
import { wallSegments } from './house';
import type { DebrisPlacement, FloorMaterialId, FurnitureInstance, GroundMarking, HouseLayout, Obstacle, RegionZoneType, Room } from './types';

export const REGION = {
  /** Map size in units (10 m): 2 km × 1.5 km. */
  width: 200,
  depth: 150,
  /** Wooded ridge around the edge. */
  wallThickness: 2,
  wallHeight: 3,
  /** Motorway zone width: two carriageways of two lanes, shoulders and a median. */
  highwayWidth: 6,
  riverWidth: 6,
  /** Clear gap between permanent obstacles and from the edge: a 4.5-unit Bunny (9 across) rolls through. */
  obstacleGap: 12,
  /** Debris spatial hash cell (units). */
  debrisCellSize: 1.5,
  /** Bunny radius (units) for Runs that start here (?area=region); about the size after the Garbage Truck. */
  debugStartRadius: 0.9,
};

const FLOORS: Record<RegionZoneType, FloorMaterialId> = { farmland: 'fields', highway: 'motorway', river: 'water', town: 'townRoofs', woods: 'forest', landfill: 'landfill' };

/** Lane centre offsets from a motorway's centre line (two lanes per carriageway). */
const LANES = [-2.05, -0.95, 0.95, 2.05] as const;
const VEHICLES = [
  { id: 'region_car', w: 0.64 },
  { id: 'lorry', w: 0.18 },
  { id: 'coach', w: 0.08 },
] as const;

const SIZE = new Map(REGION_DEBRIS.map((t) => [t.id, t.size]));
const sizeOf = (id: string): number => SIZE.get(id) ?? 0.2;

/** Distance between two rects (0 if they touch or overlap). */
function rectGap(a: Rect, b: Rect): number {
  return Math.hypot(Math.max(0, a.minX - b.maxX, b.minX - a.maxX), Math.max(0, a.minZ - b.maxZ, b.minZ - a.maxZ));
}

function pointRectDist(x: number, z: number, r: Rect): number {
  return Math.hypot(Math.max(0, r.minX - x, x - r.maxX), Math.max(0, r.minZ - z, z - r.maxZ));
}

/** Zones painted on a 1-unit grid by feature (a town, a river reach, a motorway), merged back into rects. */
class ZoneGrid {
  readonly cells: Uint16Array;
  readonly features: Array<{ name: string; type: RegionZoneType }> = [{ name: 'farmland', type: 'farmland' }];

  constructor(
    readonly w: number,
    readonly d: number,
  ) {
    this.cells = new Uint16Array(w * d);
  }

  feature(name: string, type: RegionZoneType): number {
    this.features.push({ name, type });
    return this.features.length - 1;
  }

  fill(f: number, r: Rect): void {
    const x0 = Math.max(0, Math.round(r.minX));
    const x1 = Math.min(this.w, Math.round(r.maxX));
    const z0 = Math.max(0, Math.round(r.minZ));
    const z1 = Math.min(this.d, Math.round(r.maxZ));
    for (let z = z0; z < z1; z++) this.cells.fill(f, z * this.w + x0, z * this.w + Math.max(x0, x1));
  }

  featureAt(x: number, z: number): number {
    const cx = Math.floor(x);
    const cz = Math.floor(z);
    if (cx < 0 || cz < 0 || cx >= this.w || cz >= this.d) return -1;
    return this.cells[cz * this.w + cx]!;
  }

  typeAt(x: number, z: number): RegionZoneType | null {
    const f = this.featureAt(x, z);
    return f < 0 ? null : this.features[f]!.type;
  }

  /** True if `r` lies in the map and every cell it touches is one of `types`. */
  allOf(r: Rect, types: readonly RegionZoneType[]): boolean {
    if (r.minX < 0 || r.minZ < 0 || r.maxX > this.w || r.maxZ > this.d) return false;
    const x1 = Math.ceil(r.maxX);
    const z1 = Math.ceil(r.maxZ);
    for (let z = Math.floor(r.minZ); z < z1; z++) {
      for (let x = Math.floor(r.minX); x < x1; x++) if (!types.includes(this.features[this.cells[z * this.w + x]!]!.type)) return false;
    }
    return true;
  }

  /** Greedy merge into rects, one Room each; a feature's first rect is named after it, the rest `name.k`. */
  rooms(): Room[] {
    const { w, d, cells } = this;
    const done = new Uint8Array(w * d);
    const count = new Map<number, number>();
    const rooms: Room[] = [];
    for (let z = 0; z < d; z++) {
      for (let x = 0; x < w; x++) {
        const i = z * w + x;
        if (done[i]) continue;
        const f = cells[i]!;
        let x1 = x + 1;
        while (x1 < w && !done[z * w + x1] && cells[z * w + x1] === f) x1++;
        let z1 = z + 1;
        for (; z1 < d; z1++) {
          let ok = true;
          for (let xx = x; xx < x1 && ok; xx++) ok = !done[z1 * w + xx] && cells[z1 * w + xx] === f;
          if (!ok) break;
        }
        for (let zz = z; zz < z1; zz++) done.fill(1, zz * w + x, zz * w + x1);
        const { name, type } = this.features[f]!;
        const k = count.get(f) ?? 0;
        count.set(f, k + 1);
        rooms.push({ id: k === 0 ? name : `${name}.${k}`, type, rect: rect(x, z, x1, z1), floor: FLOORS[type] });
      }
    }
    return rooms;
  }
}

interface Town {
  name: string;
  rect: Rect;
  /** Side the motorway runs along ('n' = the town's −Z edge). */
  road: 'n' | 's' | 'e' | 'w';
  /** Chance of a city centre (permanent obstacle) in it. */
  core: number;
}

interface Highway {
  f: number;
  alongX: boolean;
  /** Centre line (z for alongX, x otherwise) and extent along it. */
  c: number;
  a0: number;
  a1: number;
}

export function generateRegion(seed: string | number): HouseLayout {
  const root = new Rng(seed);
  const rng = root.fork('region');
  const R = REGION;
  const W = R.width;
  const D = R.depth;
  const hw = R.highwayWidth / 2;
  const rw = R.riverWidth;
  const G = R.obstacleGap;
  const grid = new ZoneGrid(W, D);

  // ── Motorways (painted last) ──
  const mainZ = Math.round(rng.range(68, 82));
  const h1X = Math.round(rng.range(112, 126));
  const h2X = Math.round(rng.range(42, 54));
  const h3Z = Math.round(rng.range(112, 120));
  const north = mainZ - hw;
  const south = mainZ + hw;

  // ── River: six reaches north → south, jogging sideways; the two either side of M1 line up under the bridge ──
  const zs = [0, Math.round(north * rng.range(0.3, 0.4)), Math.round(north * rng.range(0.62, 0.72)), north, south, Math.round(south + (D - south) * rng.range(0.3, 0.4)), Math.round(south + (D - south) * rng.range(0.62, 0.72)), D];
  const xLo = h2X + hw + 16;
  const xHi = h1X - hw - 20 - rw;
  const reaches: Rect[] = [];
  let rx = Math.round(rng.range(xLo + 3, xHi - 3));
  for (let i = 0; i < 6; i++) {
    if (i > 0 && i !== 3) rx = Math.min(xHi, Math.max(xLo, rx + rng.sign() * rng.int(2, 4)));
    const k = i < 3 ? i : i + 1;
    reaches.push(rect(rx, zs[k]!, rx + rw, zs[k + 1]!));
  }
  const riverMaxN = Math.max(...reaches.slice(0, 3).map((r) => r.maxX));
  const riverMaxS = Math.max(...reaches.slice(3).map((r) => r.maxX));

  // ── Towns along the motorways; the big city sits in the four corners of the M1 × H1 junction ──
  const towns: Town[] = [];
  {
    const w = rng.int(14, 18);
    const h = rng.int(10, 13);
    const x0 = rng.int(14, 20);
    towns.push(rng.chance(0.5) ? { name: 'town_west', rect: rect(x0, north - h, x0 + w, north), road: 's', core: 0 } : { name: 'town_west', rect: rect(x0, south, x0 + w, south + h), road: 'n', core: 0 });
  }
  {
    const wNW = Math.min(rng.int(14, 18), h1X - hw - (riverMaxN + 3));
    const wSW = Math.min(rng.int(14, 18), h1X - hw - (riverMaxS + 3));
    const wE = rng.int(14, 18);
    const wSE = rng.int(14, 18);
    const hN = rng.int(12, 15);
    const hS = rng.int(12, 15);
    towns.push(
      { name: 'city_nw', rect: rect(h1X - hw - wNW, north - hN, h1X - hw, north), road: 's', core: 0.75 },
      { name: 'city_ne', rect: rect(h1X + hw, north - rng.int(12, 15), h1X + hw + wE, north), road: 's', core: 0.75 },
      { name: 'city_sw', rect: rect(h1X - hw - wSW, south, h1X - hw, south + hS), road: 'n', core: 0.75 },
      { name: 'city_se', rect: rect(h1X + hw, south, h1X + hw + wSE, south + rng.int(12, 15)), road: 'n', core: 0.75 },
    );
  }
  {
    const w = rng.int(12, 15);
    const z0 = rng.int(10, 18);
    towns.push({ name: 'town_north', rect: rect(h2X - hw - w, z0, h2X - hw, z0 + rng.int(14, 17)), road: 'e', core: 0.6 });
  }
  {
    const x0 = rng.int(164, 172);
    const h = rng.int(11, 14);
    towns.push({ name: 'town_east', rect: rect(x0, north - h, x0 + rng.int(14, 18), north), road: 's', core: 0.8 });
  }
  {
    const w = Math.min(rng.int(13, 16), h1X - hw - (riverMaxS + 3));
    const z0 = rng.int(124, 130);
    towns.push({ name: 'town_south', rect: rect(h1X - hw - w, z0, h1X - hw, z0 + rng.int(12, 15)), road: 'e', core: 0.5 });
  }
  {
    const x0 = rng.int(148, 156);
    const h = rng.int(10, 12);
    towns.push({ name: 'town_landfill', rect: rect(x0, h3Z - hw - h, x0 + rng.int(14, 18), h3Z - hw), road: 's', core: 0.4 });
  }
  const landfill = rect(rng.int(150, 158), h3Z + hw + rng.int(3, 5), rng.int(186, 192), rng.int(141, 145));

  // ── Paint: woods, landfill, towns, river, motorways (later wins) ──
  const woods = (name: string, ...rs: Rect[]) => {
    const f = grid.feature(name, 'woods');
    for (const r of rs) grid.fill(f, r);
  };
  woods('woods_nw', rect(0, 0, rng.int(24, 32), rng.int(20, 28)), rect(0, 0, rng.int(12, 18), rng.int(36, 46)));
  woods('woods_sw', rect(0, rng.int(114, 122), rng.int(30, 40), D), rect(rng.int(6, 14), rng.int(104, 110), rng.int(22, 30), D));
  woods('woods_ne', rect(rng.int(138, 148), 0, rng.int(168, 182), rng.int(12, 18)), rect(rng.int(176, 186), 0, W, rng.int(22, 30)));
  {
    const r1 = reaches[1]!;
    const r4 = reaches[4]!;
    woods('woods_river', rect(r1.maxX, r1.minZ + 2, r1.maxX + rng.int(5, 8), r1.maxZ), rect(r4.minX - rng.int(6, 10), r4.minZ + 3, r4.minX, r4.maxZ));
  }
  grid.fill(grid.feature('landfill', 'landfill'), landfill);
  for (const t of towns) grid.fill(grid.feature(t.name, 'town'), t.rect);
  reaches.forEach((r, i) => grid.fill(grid.feature(`river${i}`, 'river'), r));
  const highways: Highway[] = [];
  const motorway = (name: string, alongX: boolean, c: number, a0: number, a1: number) => {
    const f = grid.feature(name, 'highway');
    grid.fill(f, alongX ? rect(a0, c - hw, a1, c + hw) : rect(c - hw, a0, c + hw, a1));
    highways.push({ f, alongX, c, a0, a1 });
  };
  motorway('h2', false, h2X, 0, north);
  motorway('h3', true, h3Z, h1X, W);
  motorway('h1', false, h1X, 0, D);
  motorway('m1', true, mainZ, 0, W);

  const rooms = grid.rooms();
  const spawn = { x: 8, z: mainZ, roomId: 'm1' };

  // ── Edge: wooded ridge with a closed roadblock where each motorway leaves the map ──
  const T = R.wallThickness;
  const gapsW: Array<[number, number]> = [[north, south]];
  const gapsE: Array<[number, number]> = [[north, south], [h3Z - hw, h3Z + hw]];
  const gapsN: Array<[number, number]> = [[h2X - hw, h2X + hw], [h1X - hw, h1X + hw]];
  const gapsS: Array<[number, number]> = [[h1X - hw, h1X + hw]];
  const ridgeRects = [...wallSegments('h', 0, 0, W, gapsN, T), ...wallSegments('h', D, 0, W, gapsS, T), ...wallSegments('v', 0, 0, D, gapsW, T), ...wallSegments('v', W, 0, D, gapsE, T)];
  const walls: Obstacle[] = ridgeRects.map((r, i) => ({ id: `ridge${i}`, kind: 'wall', rect: r, height: R.wallHeight, clearance: 0 }));
  const blocks: Rect[] = [
    ...gapsW.map(([a, b]) => rect(-T / 2, a, T / 2, b)),
    ...gapsE.map(([a, b]) => rect(W - T / 2, a, W + T / 2, b)),
    ...gapsN.map(([a, b]) => rect(a, -T / 2, b, T / 2)),
    ...gapsS.map(([a, b]) => rect(a, D - T / 2, b, D + T / 2)),
  ];
  blocks.forEach((r, i) => walls.push({ id: `roadblock${i}`, kind: 'wall', rect: r, height: R.wallHeight * 0.4, clearance: 0 }));

  // ── Permanent obstacles: city centres, hills, ridges ──
  const furniture: FurnitureInstance[] = [];
  const orng = root.fork('region:obstacles');
  const placeObstacle = (defId: string, x: number, z: number, quarterTurns: number, w: number, d: number, h: number, zones: readonly RegionZoneType[], margin: number): boolean => {
    const rs = quarterTurns % 2 === 0 ? { w, d } : { w: d, d: w };
    const r = rect(x - rs.w / 2, z - rs.d / 2, x + rs.w / 2, z + rs.d / 2);
    if (r.minX < T / 2 + G || r.maxX > W - T / 2 - G || r.minZ < T / 2 + G || r.maxZ > D - T / 2 - G) return false;
    if (!grid.allOf(expandRect(r, margin), zones)) return false;
    if (pointRectDist(spawn.x, spawn.z, r) < 28) return false;
    if (furniture.some((f) => rectGap(f.rect, r) < G)) return false;
    const roomId = rooms.find((room) => rectContains(room.rect, x, z))!.id;
    furniture.push({ id: `${roomId}:${defId}${furniture.length}`, defId, roomId, x, z, quarterTurns, w, d, height: h, rect: r });
    return true;
  };
  for (const t of orng.shuffle([...towns])) {
    if (!orng.chance(t.core)) continue;
    const tw = t.rect.maxX - t.rect.minX;
    const td = t.rect.maxZ - t.rect.minZ;
    const def = FURNITURE.region_city_core!;
    const w = Math.min(orng.int(6, 9), tw - 6);
    const d = Math.min(orng.int(6, 8), td - 6);
    if (w < 5 || d < 5) continue;
    const h = Math.round(def.h * orng.range(0.8, 1.15) * 10) / 10;
    for (let tries = 0; tries < 16; tries++) {
      const x = orng.range(t.rect.minX + 3 + w / 2, t.rect.maxX - 3 - w / 2);
      const z = orng.range(t.rect.minZ + 3 + d / 2, t.rect.maxZ - 3 - d / 2);
      if (placeObstacle('region_city_core', Math.round(x * 2) / 2, Math.round(z * 2) / 2, 0, w, d, h, ['town'], 2.5)) break;
    }
  }
  const scatterObstacle = (defId: string, size: () => [number, number, number], zones: readonly RegionZoneType[]) => {
    const [w, d, h] = size();
    const qt = orng.int(0, 1);
    for (let tries = 0; tries < 80; tries++) {
      if (placeObstacle(defId, Math.round(orng.range(G, W - G)), Math.round(orng.range(G, D - G)), qt, w, d, h, zones, 1.5)) return;
    }
  };
  for (let i = orng.int(1, 2); i > 0; i--) scatterObstacle('region_ridge', () => [orng.int(16, 22), orng.int(6, 8), Math.round(orng.range(3, 4) * 10) / 10], ['woods', 'farmland']);
  for (let i = orng.int(2, 3); i > 0; i--) scatterObstacle('region_hill', () => [orng.int(9, 13), orng.int(7, 10), Math.round(orng.range(3, 4.5) * 10) / 10], ['farmland', 'woods']);

  // ── Fixed Debris: traffic, farms, town buildings, the landfill, boats and cabins ──
  const prng = root.fork('region:debris');
  const debrisPlacements: DebrisPlacement[] = [];
  const solid = [...walls.map((w) => w.rect), ...furniture.map((f) => f.rect)];
  const placed: Array<{ x: number; z: number; s: number }> = [];
  const put = (typeId: string, x: number, z: number, rotY: number) => debrisPlacements.push({ typeId, x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100, rotY: Math.round(rotY * 1000) / 1000 });
  /** Places `typeId` if its disc (with the size jitter) stays inside `zones`, clear of obstacles, the spawn and other placements. */
  const tryPlace = (typeId: string, x: number, z: number, zones: readonly RegionZoneType[], rotY = prng.range(0, Math.PI * 2)): boolean => {
    const s = sizeOf(typeId) * 1.2;
    if (!grid.allOf(rect(x - s, z - s, x + s, z + s), zones)) return false;
    for (const o of solid) if (pointRectDist(x, z, o) < s + 1.6) return false;
    if (Math.hypot(x - spawn.x, z - spawn.z) < s + (s > 0.6 ? 16 : 5)) return false;
    for (const p of placed) if (Math.hypot(p.x - x, p.z - z) < p.s + s + (Math.max(p.s, s) > 0.6 ? 1.6 : 0.3)) return false;
    placed.push({ x, z, s });
    put(typeId, x, z, rotY);
    return true;
  };
  const around = (typeId: string, cx: number, cz: number, dist: number, zones: readonly RegionZoneType[], tries = 6): boolean => {
    for (let i = 0; i < tries; i++) {
      const a = prng.range(0, Math.PI * 2);
      const d = dist * prng.range(0.85, 1.3);
      if (tryPlace(typeId, cx + Math.cos(a) * d, cz + Math.sin(a) * d, zones)) return true;
    }
    return false;
  };
  const scatter = (typeId: string, n: number, zones: readonly RegionZoneType[], area: Rect = rect(0, 0, W, D)) => {
    for (let k = 0, tries = 0; k < n && tries < n * 40; tries++) if (tryPlace(typeId, prng.range(area.minX, area.maxX), prng.range(area.minZ, area.maxZ), zones)) k++;
  };

  // Traffic in the lanes, both directions (right-hand traffic), none in junctions.
  for (const hwy of highways) {
    for (const off of LANES) {
      for (let t = hwy.a0 + prng.range(3, 8); t < hwy.a1 - 3; ) {
        const id = prng.weighted(VEHICLES, (v) => v.w)!.id;
        const s = sizeOf(id);
        const x = hwy.alongX ? t : hwy.c + off;
        const z = hwy.alongX ? hwy.c + off : t;
        const ends = hwy.alongX ? [grid.featureAt(t - s, z), grid.featureAt(t + s, z)] : [grid.featureAt(x, t - s), grid.featureAt(x, t + s)];
        if (grid.featureAt(x, z) === hwy.f && ends.every((f) => f === hwy.f) && Math.hypot(x - spawn.x, z - spawn.z) > (s > 0.5 ? 18 : 6)) {
          put(id, x, z, hwy.alongX ? (off > 0 ? Math.PI / 2 : -Math.PI / 2) : off < 0 ? 0 : Math.PI);
        }
        t += prng.range(3.5, 8) + s * 2;
      }
    }
  }

  // Farms: farmhouse, barn, silos, a tractor and hay in the fields around.
  const FARM: readonly RegionZoneType[] = ['farmland'];
  const farms: Array<{ x: number; z: number }> = [];
  for (let k = 0, n = prng.int(10, 14), tries = 0; k < n && tries < 600; tries++) {
    const x = prng.range(8, W - 8);
    const z = prng.range(8, D - 8);
    if (farms.some((f) => Math.hypot(f.x - x, f.z - z) < 16) || !tryPlace('farmhouse', x, z, FARM)) continue;
    farms.push({ x, z });
    k++;
    around('barn', x, z, 3.7, FARM);
    around('grain_silo', x, z, 3.1, FARM);
    if (prng.chance(0.5)) around('grain_silo', x, z, 3.4, FARM);
    if (prng.chance(0.6)) around('tractor', x, z, 2.6, FARM);
    for (let i = prng.int(1, 3); i > 0; i--) around('hay_bales', x, z, 4.5, FARM);
  }
  // Wind farms: a row of turbines along a field.
  for (let row = prng.int(1, 2), tries = 0; row > 0 && tries < 60; tries++) {
    const x = prng.range(15, W - 15);
    const z = prng.range(15, D - 15);
    const alongX = prng.chance(0.5);
    let n = 0;
    for (let i = 0; i < 5; i++) if (tryPlace('wind_turbine', alongX ? x + i * 5.6 : x, alongX ? z : z + i * 5.6, FARM, 0)) n++;
    if (n >= 2) row--;
  }
  // Towns: a church, a water tower, a petrol station (and a motel) on the motorway side, terraces.
  const TOWN: readonly RegionZoneType[] = ['town'];
  const cityQuarters = towns.filter((t) => t.name.startsWith('city_'));
  const free = (t: Town) => !furniture.some((f) => f.roomId.startsWith(t.name));
  const bigQuarters = prng.shuffle(cityQuarters.filter(free));
  if (bigQuarters[0]) scatter('stadium', 1, TOWN, bigQuarters[0].rect);
  if (bigQuarters[1]) scatter('strip_mall', 1, TOWN, bigQuarters[1].rect);
  for (const t of towns) {
    const r = t.rect;
    const roadside = (id: string) => {
      const inset = sizeOf(id) * 1.2 + 0.3;
      for (let i = 0; i < 10; i++) {
        const along = prng.range(0, 1);
        const x = t.road === 'e' ? r.maxX - inset : t.road === 'w' ? r.minX + inset : r.minX + along * (r.maxX - r.minX);
        const z = t.road === 's' ? r.maxZ - inset : t.road === 'n' ? r.minZ + inset : r.minZ + along * (r.maxZ - r.minZ);
        if (tryPlace(id, x, z, TOWN)) return;
      }
    };
    roadside('petrol_station');
    if (!t.name.startsWith('city_') && prng.chance(0.7)) roadside('motel');
    scatter('church', 1, TOWN, r);
    scatter('town_water_tower', 1, TOWN, r);
    scatter('terraced_houses', prng.int(3, 6), TOWN, r);
  }
  // The landfill, woods and the river.
  scatter('trash_mountain', 2, ['landfill'], landfill);
  scatter('tyre_mountain', 2, ['landfill'], landfill);
  scatter('scrap_heap', 3, ['landfill'], landfill);
  scatter('bulldozer', 4, ['landfill'], landfill);
  scatter('sawmill', 1, ['woods']);
  scatter('log_cabin', 5, ['woods']);
  scatter('log_pile', 8, ['woods']);
  for (const reach of reaches) scatter('fishing_boat', 1, ['river'], reach);
  scatter('houseboats', 3, ['river']);
  scatter('river_ferry', 1, ['river']);

  // ── Markings (render-only): lanes, the bridge, river banks, hedgerows, landfill tracks, roads out of bounds ──
  const mrng = root.fork('region:markings');
  const markings: GroundMarking[] = [];
  const mark = (minX: number, minZ: number, maxX: number, maxZ: number, color: string, layer = 0) => markings.push(layer ? { rect: rect(minX, minZ, maxX, maxZ), color, layer } : { rect: rect(minX, minZ, maxX, maxZ), color });
  /** A strip along a line (z = c for alongX, else x = c) from a0 to a1, spanning offsets o0..o1 across it. */
  const band = (alongX: boolean, c: number, a0: number, a1: number, o0: number, o1: number, color: string, layer = 0) => (alongX ? mark(a0, c + o0, a1, c + o1, color, layer) : mark(c + o0, a0, c + o1, a1, color, layer));
  const roadLines = (alongX: boolean, c: number, a0: number, a1: number, asphalt: boolean) => {
    // Out of bounds there is no motorway floor: lay asphalt first and paint the lines a layer above.
    if (asphalt) band(alongX, c, a0, a1, -hw, hw, '#55575c');
    const L = asphalt ? 1 : 0;
    const strip = (o: number, half: number, color: string, from = a0, to = a1) => band(alongX, c, from, to, o - half, o + half, color, L);
    for (const s of [-1, 1]) {
      // Tyre tracks worn into each lane, the yellow inner edge, the white outer edge and lane dashes.
      for (const lane of [0.97, 2.03]) for (const w of [-0.26, 0.26]) strip(s * (lane + w), 0.08, '#4b4d52');
      strip(s * 0.4, 0.04, '#e3c75a');
      strip(s * 2.6, 0.05, '#ecebe6');
      for (let t = a0 + 0.6; t + 1.2 < a1; t += 3.2) strip(s * 1.5, 0.05, '#ecebe6', t, t + 1.2);
    }
    strip(0, 0.22, '#b3ada1');
  };
  for (const hwy of highways) {
    // Runs of this motorway's own cells along its centre line (junctions belong to the crossing road).
    let start: number | null = null;
    for (let t = hwy.a0; t <= hwy.a1; t++) {
      const own = t < hwy.a1 && grid.featureAt(hwy.alongX ? t + 0.5 : hwy.c, hwy.alongX ? hwy.c : t + 0.5) === hwy.f;
      if (own && start === null) start = t;
      if (!own && start !== null) {
        roadLines(hwy.alongX, hwy.c, start, t, false);
        start = null;
      }
    }
  }
  // M1 bridges the river between reaches 2 and 3: railings and a shadow on the water.
  {
    const r = reaches[3]!;
    mark(r.minX - 1, north, r.maxX + 1, north + 0.22, '#d9d4ca');
    mark(r.minX - 1, south - 0.22, r.maxX + 1, south, '#d9d4ca');
    mark(r.minX + 0.5, south, r.maxX - 0.5, south + 0.9, '#2d4a55');
  }
  // River banks: mud along each reach's sides and the ends exposed at a jog.
  const BANK = '#8c8364';
  const exposed = (a0: number, a1: number, b0: number, b1: number): Array<[number, number]> => {
    const out: Array<[number, number]> = [];
    if (b0 > a0) out.push([a0, Math.min(a1, b0)]);
    if (b1 < a1) out.push([Math.max(a0, b1), a1]);
    return out;
  };
  reaches.forEach((r, i) => {
    mark(r.minX, r.minZ, r.minX + 0.5, r.maxZ, BANK);
    mark(r.maxX - 0.5, r.minZ, r.maxX, r.maxZ, BANK);
    const prev = i === 0 || i === 3 ? null : reaches[i - 1]!;
    const next = i === 2 || i === 5 ? null : reaches[i + 1]!;
    if (prev) for (const [a, b] of exposed(r.minX + 0.5, r.maxX - 0.5, prev.minX, prev.maxX)) mark(a, r.minZ, b, r.minZ + 0.5, BANK);
    if (next) for (const [a, b] of exposed(r.minX + 0.5, r.maxX - 0.5, next.minX, next.maxX)) mark(a, r.maxZ - 0.5, b, r.maxZ, BANK);
  });
  // Hedgerows between the fields, broken here and there, with a tree now and then.
  const HEDGE = '#4b5d33';
  const TREE = '#3c5029';
  const hedgerow = (alongX: boolean, c: number) => {
    const len = alongX ? W : D;
    let start = -1;
    let chunkEnd = 0;
    let keep = true;
    const flush = (end: number) => {
      if (start >= 0 && end - start >= 2) {
        band(alongX, c, start, end, -0.15, 0.15, HEDGE, alongX ? 1 : 0);
        for (let p = start + mrng.range(0.5, 3); p < end - 0.5; p += mrng.range(2, 5)) band(alongX, c, p - 0.35, p + 0.35, -0.35, 0.35, TREE, 2);
      }
      start = -1;
    };
    for (let u = 0; u <= len; u++) {
      if (u >= chunkEnd) {
        flush(u);
        keep = mrng.chance(0.85);
        chunkEnd = u + mrng.int(5, 13);
      }
      const farm = (dx: number, dz: number) => grid.typeAt(alongX ? u + 0.5 : c + dx, alongX ? c + dz : u + 0.5) === 'farmland';
      const ok = u < len && keep && (alongX ? farm(0, -0.5) && farm(0, 0.5) : farm(-0.5, 0) && farm(0.5, 0));
      if (ok && start < 0) start = u;
      if (!ok) flush(u);
    }
  };
  for (let x = Math.round(mrng.range(10, 18)); x < W - 4; x += Math.round(mrng.range(14, 22))) hedgerow(false, x);
  for (let z = Math.round(mrng.range(8, 14)); z < D - 4; z += Math.round(mrng.range(12, 18))) hedgerow(true, z);
  // Haul road from H3 into the landfill.
  {
    const x = Math.round(mrng.range(landfill.minX + 6, landfill.maxX - 12));
    const z = Math.round(mrng.range(landfill.minZ + 6, landfill.maxZ - 6));
    mark(x, h3Z + hw, x + 0.9, z - 0.45, '#857a63');
    mark(x, z - 0.45, Math.round(mrng.range(x + 8, landfill.maxX - 4)), z + 0.45, '#857a63');
  }
  // The motorways carry on out of bounds: M1 west towards the City, the others away into the haze.
  const OUT = 160;
  roadLines(true, mainZ, -OUT, -T / 2, true);
  roadLines(true, mainZ, W + T / 2, W + OUT, true);
  roadLines(true, h3Z, W + T / 2, W + OUT, true);
  roadLines(false, h2X, -OUT, -T / 2, true);
  roadLines(false, h1X, -OUT, -T / 2, true);
  roadLines(false, h1X, D + T / 2, D + OUT, true);

  const obstacles: Obstacle[] = [...walls, ...furniture.flatMap((f) => furnitureObstacles(f, FURNITURE[f.defId]!))];
  return {
    area: 'region',
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
    markings,
  };
}
