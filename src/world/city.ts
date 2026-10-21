/**
 * Seeded city generator (the area after the neighborhood). Pure data, same shape as a house
 * floor (HouseLayout): zones play the part of rooms, buildings are furniture (permanent
 * Obstacles) and a concrete barrier around the edge is the walls.
 *
 * Layout: a grid of avenues (along X) and streets (along Z) split the map into blocks ringed by
 * sidewalks. Blocks hold office towers and plazas downtown, apartments, shops and old brick
 * lofts further out, two parking lots and a park square. The Bunny rolls in at the west end of
 * the main avenue, where the road from the neighborhood arrives.
 */
import type { Rect } from '../core/math';
import { rect, rectsOverlap } from '../core/math';
import { Rng } from '../core/rng';
import { FURNITURE, furnitureObstacles } from './furniture';
import { wallSegments } from './house';
import type { CityZoneType, DebrisPlacement, FurnitureInstance, GroundMarking, HouseLayout, Obstacle, Room } from './types';

export const CITY = {
  width: 32000,
  depth: 24000,
  /** Concrete barrier around the edge. */
  wallThickness: 300,
  wallHeight: 420,
  /** Asphalt width of avenues and streets, and sidewalk width around every block. */
  roadWidth: 1600,
  sidewalk: 500,
  /** Street centre lines (along Z) and avenue centre lines (along X). */
  streetXs: [6400, 12800, 19200, 25600] as readonly number[],
  avenueZs: [6000, 12000, 18000] as readonly number[],
  /** The avenue the Bunny arrives on (index into avenueZs). */
  mainAvenue: 1,
  /** Buildings keep at least this far from the block edge (plaza around them). */
  buildingMargin: 260,
  /** Debris spatial hash cell (cm). */
  debrisCellSize: 300,
  /** Bunny radius for Runs that start here (?area=city); about the size after the Street Sweeper. */
  debugStartRadius: 185,
};

const FLOORS: Record<CityZoneType, Room['floor']> = { avenue: 'asphalt', pavement: 'concrete', plaza: 'paving', parking: 'asphalt', square: 'grass' };
const DOWNTOWN = ['building_office', 'building_tower', 'building_office'] as const;
const UPTOWN = ['building_apartment', 'building_shops', 'building_brick', 'building_apartment'] as const;

type BlockKind = 'downtown' | 'uptown' | 'parking' | 'square';

/** Intervals between road bands along one axis: [lo, hi, roadBefore, roadAfter]. */
function intervals(centres: readonly number[], size: number, roadW: number): Array<[number, number, boolean, boolean]> {
  const out: Array<[number, number, boolean, boolean]> = [];
  let lo = 0;
  let before = false;
  for (const c of centres) {
    out.push([lo, c - roadW / 2, before, true]);
    lo = c + roadW / 2;
    before = true;
  }
  out.push([lo, size, before, false]);
  return out;
}

export function generateCity(seed: string | number): HouseLayout {
  const root = new Rng(seed);
  const rng = root.fork('city');
  const C = CITY;
  const W = C.width;
  const D = C.depth;
  const rw = C.roadWidth;
  const sw = C.sidewalk;

  const rooms: Room[] = [];
  let zoneN = 0;
  const zone = (type: CityZoneType, r: Rect, id = `${type}${zoneN++}`): Room => {
    const room: Room = { id, type, rect: r, floor: FLOORS[type] };
    rooms.push(room);
    return room;
  };

  const furniture: FurnitureInstance[] = [];
  const debrisPlacements: DebrisPlacement[] = [];
  const markings: GroundMarking[] = [];
  const place = (typeId: string, x: number, z: number, rotY = 0) => debrisPlacements.push({ typeId, x: Math.round(x), z: Math.round(z), rotY });

  const placeBuilding = (defId: string, roomId: string, x: number, z: number, quarterTurns: number, w: number, d: number): FurnitureInstance => {
    const def = FURNITURE[defId]!;
    const rs = quarterTurns % 2 === 0 ? { w, d } : { w: d, d: w };
    const inst: FurnitureInstance = {
      id: `${roomId}:${defId}${furniture.length}`,
      defId,
      roomId,
      x,
      z,
      quarterTurns,
      w,
      d,
      height: def.h,
      rect: rect(x - rs.w / 2, z - rs.d / 2, x + rs.w / 2, z + rs.d / 2),
    };
    furniture.push(inst);
    return inst;
  };

  // ── Roads: avenues run the full width; streets fill the gaps between them ──
  C.avenueZs.forEach((z, i) => zone('avenue', rect(0, z - rw / 2, W, z + rw / 2), i === C.mainAvenue ? 'main_avenue' : `avenue${i}`));
  const zSpans = intervals(C.avenueZs, D, rw);
  const xSpans = intervals(C.streetXs, W, rw);
  C.streetXs.forEach((x, i) => {
    zSpans.forEach(([z0, z1], j) => zone('avenue', rect(x - rw / 2, z0, x + rw / 2, z1), `street${i}_${j}`));
  });

  // ── Blocks: sidewalk ring on road-facing sides, the rest is the block ──
  interface Block {
    id: string;
    rect: Rect;
    col: number;
    row: number;
    /** Road on the block's −Z / +Z side. */
    roadN: boolean;
    roadS: boolean;
    kind: BlockKind;
  }
  const blocks: Block[] = [];
  xSpans.forEach(([x0, x1, rW, rE], col) => {
    zSpans.forEach(([z0, z1, rN, rS], row) => {
      const id = `b${col}_${row}`;
      const bx0 = rW ? x0 + sw : x0;
      const bx1 = rE ? x1 - sw : x1;
      const bz0 = rN ? z0 + sw : z0;
      const bz1 = rS ? z1 - sw : z1;
      // Sidewalk strips: full-width along the avenues, between them along the streets.
      if (rN) zone('pavement', rect(x0, z0, x1, z0 + sw), `${id}:walkN`);
      if (rS) zone('pavement', rect(x0, z1 - sw, x1, z1), `${id}:walkS`);
      if (rW) zone('pavement', rect(x0, bz0, x0 + sw, bz1), `${id}:walkW`);
      if (rE) zone('pavement', rect(x1 - sw, bz0, x1, bz1), `${id}:walkE`);
      blocks.push({ id, rect: rect(bx0, bz0, bx1, bz1), col, row, roadN: rN, roadS: rS, kind: 'uptown' });
    });
  });

  // Block kinds: a park square near the middle, two parking lots, towers downtown.
  const cols = xSpans.length;
  const rows = zSpans.length;
  const centre = blocks.filter((b) => b.col > 0 && b.col < cols - 1 && b.row > 0 && b.row < rows - 1);
  const square = rng.pick(centre);
  square.kind = 'square';
  const midCol = (cols - 1) / 2;
  const midRow = (rows - 1) / 2;
  for (const b of blocks) {
    if (b === square) continue;
    const dn = Math.hypot((b.col - midCol) / cols, (b.row - midRow) / rows);
    b.kind = dn < 0.3 ? 'downtown' : 'uptown';
  }
  const parkingCandidates = rng.shuffle(blocks.filter((b) => b.kind === 'uptown'));
  for (const b of parkingCandidates.slice(0, 2)) b.kind = 'parking';

  // ── Block contents ──
  for (const b of blocks) {
    const brng = root.fork(`block:${b.id}`);
    const R = b.rect;
    const bw = R.maxX - R.minX;
    const bd = R.maxZ - R.minZ;
    const cx = (R.minX + R.maxX) / 2;
    const cz = (R.minZ + R.maxZ) / 2;

    if (b.kind === 'square') {
      zone('square', R, 'square');
      // Paved cross paths (render-only) and a fountain in the middle.
      markings.push({ rect: rect(cx - 160, R.minZ, cx + 160, R.maxZ), color: '#cdbfa8' }, { rect: rect(R.minX, cz - 160, R.maxX, cz + 160), color: '#cdbfa8' });
      markings.push({ rect: rect(cx - 700, cz - 700, cx + 700, cz + 700), color: '#cdbfa8' });
      place('fountain', cx, cz);
      const trees: Array<{ x: number; z: number }> = [];
      for (let tries = 0; trees.length < 12 && tries < 300; tries++) {
        const x = brng.range(R.minX + 350, R.maxX - 350);
        const z = brng.range(R.minZ + 350, R.maxZ - 350);
        if (Math.abs(x - cx) < 450 || Math.abs(z - cz) < 450) continue;
        if (trees.some((t) => Math.hypot(t.x - x, t.z - z) < 900)) continue;
        trees.push({ x, z });
        place('city_tree', x, z, brng.range(0, Math.PI * 2));
      }
      for (let i = 0; i < 6; i++) {
        const along = brng.range(-1, 1);
        const vertical = i % 2 === 0;
        place('park_bench', vertical ? cx + (i < 3 ? -320 : 320) : cx + along * (bw / 2 - 600), vertical ? cz + along * (bd / 2 - 600) : cz + (i < 3 ? -320 : 320), vertical ? Math.PI / 2 : 0);
      }
      place('hot_dog_cart', cx + 900, cz + 260, brng.range(0, Math.PI * 2));
      place('hot_dog_cart', cx - 260, cz - 900, brng.range(0, Math.PI * 2));
      continue;
    }

    if (b.kind === 'parking') {
      const room = zone('parking', R, `${b.id}:parking`);
      // Stall rows along X: lines every 300 cm, cars parked in some stalls.
      const rowsN = Math.max(1, Math.floor((bd - 400) / 1300));
      for (let r = 0; r < rowsN; r++) {
        const z0 = R.minZ + 300 + r * 1300;
        for (let x = R.minX + 300; x + 300 < R.maxX - 200; x += 300) {
          markings.push({ rect: rect(x - 6, z0, x + 6, z0 + 560), color: '#f1efe8' });
          if (x + 300 < R.maxX - 200 && brng.chance(0.45)) place(brng.pick(['car', 'car', 'taxi', 'delivery_van']), x + 150, z0 + 280, brng.chance(0.5) ? 0 : Math.PI);
        }
      }
      place('dumpster', R.minX + 260, R.maxZ - 220, 0);
      place('dumpster', R.maxX - 260, R.maxZ - 220, 0);
      if (brng.chance(0.6)) place('food_truck', cx, R.maxZ - 450, Math.PI / 2);
      void room;
      continue;
    }

    const room = zone('plaza', R, `${b.id}:plaza`);
    const defs = b.kind === 'downtown' ? DOWNTOWN : UPTOWN;
    // Split big blocks into sub-lots, one building each.
    const nx = bw > 4600 ? 2 : 1;
    const nz = bd > 4600 ? 2 : 1;
    const m = C.buildingMargin;
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        const L = rect(R.minX + (bw / nx) * i, R.minZ + (bd / nz) * j, R.minX + (bw / nx) * (i + 1), R.minZ + (bd / nz) * (j + 1));
        const lw = L.maxX - L.minX - 2 * m;
        const ld = L.maxZ - L.minZ - 2 * m;
        if (lw < 1100 || ld < 1100) continue;
        if (b.kind === 'uptown' && brng.chance(0.15)) continue; // a small plaza instead
        const defId = brng.pick(defs);
        const def = FURNITURE[defId]!;
        const w = Math.round(Math.min(lw, def.w * brng.range(0.85, 1.1)));
        const d = Math.round(Math.min(ld, def.d * brng.range(0.85, 1.1)));
        const jx = (lw - w) / 2;
        const jz = (ld - d) / 2;
        const x = Math.round((L.minX + L.maxX) / 2 + brng.range(-jx, jx) * 0.6);
        const z = Math.round((L.minZ + L.maxZ) / 2 + brng.range(-jz, jz) * 0.6);
        // Fronts face the nearer avenue.
        const facesS = b.roadS && (!b.roadN || j === nz - 1);
        placeBuilding(defId, room.id, x, z, facesS ? 0 : 2, w, d);
      }
    }
    // Plaza clutter in the gaps.
    const n = b.kind === 'downtown' ? 3 : 2;
    for (let k = 0, tries = 0; k < n && tries < 40; tries++) {
      const x = brng.range(R.minX + 150, R.maxX - 150);
      const z = brng.range(R.minZ + 150, R.maxZ - 150);
      if (furniture.some((f) => rectsOverlap(f.rect, rect(x - 260, z - 260, x + 260, z + 260)))) continue;
      place(brng.pick(['newspaper_box', 'hot_dog_cart', 'phone_booth', 'planter']), x, z, brng.range(0, Math.PI * 2));
      k++;
    }
  }

  // ── Sidewalk furniture: lamps and trees along the curbs, bus stops on the main avenue ──
  const mainZ = C.avenueZs[C.mainAvenue]!;
  const spawn = { x: 900, z: mainZ, roomId: 'main_avenue' };
  const nearSpawn = (x: number, z: number) => Math.hypot(x - spawn.x, z - spawn.z) < 1600;
  for (const r of rooms) {
    if (r.type !== 'pavement') continue;
    const R = r.rect;
    const alongX = R.maxX - R.minX > R.maxZ - R.minZ;
    const len = alongX ? R.maxX - R.minX : R.maxZ - R.minZ;
    // Curb side: the edge touching a road.
    const roadSide = alongX ? (C.avenueZs.some((z) => Math.abs(z - rw / 2 - R.maxZ) < 1) ? 1 : -1) : C.streetXs.some((x) => Math.abs(x - rw / 2 - R.maxX) < 1) ? 1 : -1;
    const curb = alongX ? (roadSide > 0 ? R.maxZ - 110 : R.minZ + 110) : roadSide > 0 ? R.maxX - 110 : R.minX + 110;
    let k = 0;
    for (let t = 700; t < len - 500; t += rng.range(1500, 2100), k++) {
      const x = alongX ? R.minX + t : curb;
      const z = alongX ? curb : R.minZ + t;
      if (nearSpawn(x, z)) continue;
      place(k % 2 === 0 ? 'street_lamp' : 'city_tree', x, z, rng.range(0, Math.PI * 2));
    }
  }
  for (const side of [-1, 1]) {
    for (let x = 4000 + rng.range(0, 2000); x < W - 3000; x += rng.range(7000, 9000)) {
      if (C.streetXs.some((sx) => Math.abs(sx - x) < 1600)) continue;
      const walkZ = mainZ + side * (rw / 2 + sw / 2);
      place('bus_shelter', x, walkZ + side * 40, side > 0 ? Math.PI : 0);
      place('city_bus', x + 200, mainZ + side * (rw / 2 - 260), side > 0 ? -Math.PI / 2 : Math.PI / 2);
    }
  }

  // Parked cars and taxis along the avenue curbs.
  for (const az of C.avenueZs) {
    for (const side of [-1, 1]) {
      for (let x = 1200; x < W - 800; x += rng.range(900, 2400)) {
        if (C.streetXs.some((sx) => Math.abs(sx - x) < 1400)) continue;
        const z = az + side * (rw / 2 - 230);
        if (nearSpawn(x, z) || debrisPlacements.some((p) => Math.hypot(p.x - x, p.z - z) < 700)) continue;
        if (rng.chance(0.4)) continue;
        place(rng.pick(['car', 'car', 'taxi', 'taxi', 'delivery_van']), x, z, side > 0 ? -Math.PI / 2 : Math.PI / 2);
      }
    }
  }

  // ── Markings: avenue centre lines, lane dashes, street centre dashes, crosswalks ──
  const inStreet = (x: number) => C.streetXs.some((sx) => x + 400 > sx - rw / 2 - 200 && x < sx + rw / 2 + 200);
  const inAvenue = (z: number) => C.avenueZs.some((az) => z + 400 > az - rw / 2 - 200 && z < az + rw / 2 + 200);
  for (const az of C.avenueZs) {
    for (let x = 0; x < W; x += 400) {
      if (inStreet(x)) continue;
      markings.push({ rect: rect(x, az - 22, x + 400, az - 8), color: '#f2c94c' }, { rect: rect(x, az + 8, x + 400, az + 22), color: '#f2c94c' });
    }
    for (let x = 100; x < W; x += 900) {
      if (inStreet(x)) continue;
      for (const s of [-1, 1]) markings.push({ rect: rect(x, az + s * rw * 0.25 - 8, x + 400, az + s * rw * 0.25 + 8), color: '#f4f1ea' });
    }
  }
  for (const sx of C.streetXs) {
    for (let z = 100; z < D; z += 900) {
      if (inAvenue(z)) continue;
      markings.push({ rect: rect(sx - 8, z, sx + 8, z + 400), color: '#f4f1ea' });
    }
  }
  for (const sx of C.streetXs) {
    for (const az of C.avenueZs) {
      for (let i = 0; i < 8; i++) {
        const t = -rw / 2 + 60 + i * ((rw - 120) / 8);
        // Crossing the avenue (west / east of the junction) and crossing the street (north / south).
        markings.push({ rect: rect(sx - rw / 2 - 360, az + t, sx - rw / 2 - 60, az + t + 100), color: '#f4f1ea' });
        markings.push({ rect: rect(sx + rw / 2 + 60, az + t, sx + rw / 2 + 360, az + t + 100), color: '#f4f1ea' });
        markings.push({ rect: rect(sx + t, az - rw / 2 - 360, sx + t + 100, az - rw / 2 - 60), color: '#f4f1ea' });
        markings.push({ rect: rect(sx + t, az + rw / 2 + 60, sx + t + 100, az + rw / 2 + 360), color: '#f4f1ea' });
      }
    }
  }

  // The road from the neighborhood arrives at the west end of the main avenue (render-only, outside the bounds).
  markings.push({ rect: rect(-8000, mainZ - rw / 2 - sw, -C.wallThickness / 2, mainZ - rw / 2), color: '#c9c3b8' });
  markings.push({ rect: rect(-8000, mainZ - rw / 2, -C.wallThickness / 2, mainZ + rw / 2), color: '#56585c' });
  markings.push({ rect: rect(-8000, mainZ + rw / 2, -C.wallThickness / 2, mainZ + rw / 2 + sw), color: '#c9c3b8' });

  // ── Concrete barrier around the edge ──
  const T = C.wallThickness;
  const wallRects: Rect[] = [...wallSegments('h', 0, 0, W, [], T), ...wallSegments('h', D, 0, W, [], T), ...wallSegments('v', 0, 0, D, [], T), ...wallSegments('v', W, 0, D, [], T)];
  const walls: Obstacle[] = wallRects.map((r, i) => ({ id: `barrier${i}`, kind: 'wall', rect: r, height: C.wallHeight, clearance: 0 }));
  const obstacles: Obstacle[] = [...walls, ...furniture.flatMap((f) => furnitureObstacles(f, FURNITURE[f.defId]!))];

  return {
    area: 'city',
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
