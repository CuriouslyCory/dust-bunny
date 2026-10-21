/**
 * Seeded neighborhood generator (the area after the house). Pure data, same shape as a house
 * floor (HouseLayout), so collision, spawning and Hazards work unchanged: zones play the part
 * of rooms, houses and trees are furniture, and the hedge around the edge is the walls.
 *
 * Layout: a main street across the middle and a cross street, which split the map into four
 * blocks of two lots each. Lots face the main street (front yard, driveway, house, back yard);
 * one lot is a park. The Bunny starts on the front walk of its own house (a north lot).
 */
import type { Rect } from '../core/math';
import { rect, rectsOverlap } from '../core/math';
import { Rng } from '../core/rng';
import { FURNITURE, furnitureObstacles } from './furniture';
import { wallSegments } from './house';
import type { DebrisPlacement, FurnitureInstance, GroundMarking, HouseLayout, Obstacle, OutdoorZoneType, Room } from './types';

export const NEIGHBORHOOD = {
  width: 9600,
  depth: 7200,
  /** Hedge around the edge. */
  hedgeThickness: 120,
  hedgeHeight: 170,
  /** Main street (along X) and cross street (along Z): asphalt band and sidewalk widths. */
  streetZ: 3300,
  streetWidth: 600,
  crossX: 4500,
  sidewalk: 200,
  /** Front yard depth between the sidewalk and the house front. */
  frontYard: 650,
  drivewayWidth: 300,
  /** Debris spatial hash cell (cm); the house uses TUNING.debris.cellSize. */
  debrisCellSize: 96,
  /** Bunny radius for Runs that start here (?area=neighborhood); about the size after the boss. */
  debugStartRadius: 56,
};

const HOUSE_DEFS = ['house_a', 'house_b', 'house_c'] as const;
const FLOORS: Record<OutdoorZoneType, Room['floor']> = { yard: 'grass', park: 'grass', street: 'asphalt', sidewalk: 'concrete', driveway: 'concrete' };

interface Lot {
  id: string;
  rect: Rect;
  /** True if the street is on the lot's +Z side (north lots). */
  north: boolean;
}

export function generateNeighborhood(seed: string | number): HouseLayout {
  const root = new Rng(seed);
  const rng = root.fork('neighborhood');
  const N = NEIGHBORHOOD;
  const W = N.width;
  const D = N.depth;
  const sw = N.sidewalk;
  const sz0 = N.streetZ;
  const sz1 = sz0 + N.streetWidth;
  const cx0 = N.crossX;
  const cx1 = cx0 + N.streetWidth;

  const rooms: Room[] = [];
  let zoneN = 0;
  const zone = (type: OutdoorZoneType, r: Rect, id = `${type}${zoneN++}`): Room => {
    const room: Room = { id, type, rect: r, floor: FLOORS[type] };
    rooms.push(room);
    return room;
  };

  // ── Streets and sidewalks (non-overlapping) ──
  zone('street', rect(0, sz0, W, sz1), 'main_street');
  zone('street', rect(cx0, 0, cx1, sz0), 'cross_street_n');
  zone('street', rect(cx0, sz1, cx1, D), 'cross_street_s');
  zone('sidewalk', rect(0, sz0 - sw, cx0, sz0));
  zone('sidewalk', rect(cx1, sz0 - sw, W, sz0));
  zone('sidewalk', rect(0, sz1, cx0, sz1 + sw));
  zone('sidewalk', rect(cx1, sz1, W, sz1 + sw));
  zone('sidewalk', rect(cx0 - sw, 0, cx0, sz0 - sw));
  zone('sidewalk', rect(cx1, 0, cx1 + sw, sz0 - sw));
  zone('sidewalk', rect(cx0 - sw, sz1 + sw, cx0, D));
  zone('sidewalk', rect(cx1, sz1 + sw, cx1 + sw, D));

  // ── Lots: two per block ──
  const blocks: Array<[Rect, boolean, string]> = [
    [rect(0, 0, cx0 - sw, sz0 - sw), true, 'nw'],
    [rect(cx1 + sw, 0, W, sz0 - sw), true, 'ne'],
    [rect(0, sz1 + sw, cx0 - sw, D), false, 'sw'],
    [rect(cx1 + sw, sz1 + sw, W, D), false, 'se'],
  ];
  const lots: Lot[] = [];
  for (const [b, north, id] of blocks) {
    const mid = Math.round((b.minX + b.maxX) / 2);
    lots.push({ id: `${id}0`, rect: rect(b.minX, b.minZ, mid, b.maxZ), north });
    lots.push({ id: `${id}1`, rect: rect(mid, b.minZ, b.maxX, b.maxZ), north });
  }
  // Home: one of the north lots next to the cross street. Park: one of the far lots.
  const home = rng.pick([lots[1]!, lots[2]!]);
  const park = rng.pick(lots.filter((l) => l !== home && (l.id.endsWith('0') ? l.rect.minX === 0 : l.rect.maxX === W)));

  const furniture: FurnitureInstance[] = [];
  const debrisPlacements: DebrisPlacement[] = [];
  const markings: GroundMarking[] = [];
  let spawn: HouseLayout['spawn'] | null = null;

  const placeFurniture = (defId: string, roomId: string, x: number, z: number, quarterTurns: number, w: number, d: number): FurnitureInstance => {
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

  /** Scatters trees inside `area`, keeping clear of `avoid` rects (by `margin`) and of each other. */
  const plantTrees = (area: Rect, count: number, roomId: string, avoid: Rect[], margin: number, lrng: Rng) => {
    const placed: Array<{ x: number; z: number }> = [];
    for (let tries = 0; placed.length < count && tries < count * 25; tries++) {
      const x = lrng.range(area.minX + 180, area.maxX - 180);
      const z = lrng.range(area.minZ + 180, area.maxZ - 180);
      if (area.maxX - area.minX < 360 || area.maxZ - area.minZ < 360) return;
      const probe = rect(x - margin, z - margin, x + margin, z + margin);
      if (avoid.some((r) => rectsOverlap(r, probe))) continue;
      if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < 420)) continue;
      if (furniture.some((f) => f.defId.startsWith('tree') && Math.hypot(f.x - x, f.z - z) < 420)) continue;
      const pine = lrng.chance(0.35);
      const def = FURNITURE[pine ? 'tree_pine' : 'tree_oak']!;
      placeFurniture(def.id, roomId, Math.round(x), Math.round(z), 0, def.w, def.d);
      placed.push({ x, z });
    }
  };

  for (const lot of lots) {
    const lrng = root.fork(`lot:${lot.id}`);
    const L = lot.rect;
    if (lot === park) {
      const room = zone('park', L, `park`);
      plantTrees(L, lrng.int(8, 11), room.id, [], 0, lrng);
      for (let i = 0; i < 3; i++) {
        debrisPlacements.push({ typeId: 'park_bench', x: lrng.range(L.minX + 300, L.maxX - 300), z: lrng.range(L.minZ + 300, L.maxZ - 300), rotY: lrng.pick([0, Math.PI / 2, Math.PI, -Math.PI / 2]) });
      }
      continue;
    }

    const isHome = lot === home;
    const defId = isHome ? 'house_a' : lrng.pick(HOUSE_DEFS);
    const def = FURNITURE[defId]!;
    const hw = Math.round(def.w * (isHome ? 1 : lrng.range(0.92, 1.06)));
    const hd = Math.round(def.d * (isHome ? 1 : lrng.range(0.92, 1.06)));
    const front = lot.north ? L.maxZ - N.frontYard : L.minZ + N.frontYard;
    const drivewayLeft = lrng.chance(0.5);
    const dw = N.drivewayWidth;
    const dx0 = drivewayLeft ? L.minX + 140 : L.maxX - 140 - dw;
    const dx1 = dx0 + dw;
    // House centred in the space beside the driveway.
    const spaceMin = drivewayLeft ? dx1 + 120 : L.minX + 140;
    const spaceMax = drivewayLeft ? L.maxX - 140 : dx0 - 120;
    const hx = Math.round((spaceMin + spaceMax) / 2 + lrng.range(-1, 1) * Math.max(0, (spaceMax - spaceMin - hw) / 2 - 20));
    const hz = lot.north ? front - hd / 2 : front + hd / 2;
    const houseInst = placeFurniture(defId, `${lot.id}:yard`, hx, hz, lot.north ? 0 : 2, hw, hd);
    const hr = houseInst.rect;

    // Zones: yard left / right of the driveway column (full depth), driveway beside the house, yard behind it.
    const drive = lot.north ? rect(dx0, hr.minZ, dx1, L.maxZ) : rect(dx0, L.minZ, dx1, hr.maxZ);
    const behind = lot.north ? rect(dx0, L.minZ, dx1, hr.minZ) : rect(dx0, hr.maxZ, dx1, L.maxZ);
    if (dx0 > L.minX) zone('yard', rect(L.minX, L.minZ, dx0, L.maxZ), `${lot.id}:yard`);
    if (dx1 < L.maxX) zone('yard', rect(dx1, L.minZ, L.maxX, L.maxZ), `${lot.id}:yard2`);
    zone('driveway', drive, `${lot.id}:driveway`);
    zone('yard', behind, `${lot.id}:yard3`);

    // Front walk from the door to the sidewalk (render-only).
    const doorX = defId === 'house_b' ? hr.minX + (hr.maxX - hr.minX) * (lot.north ? 0.25 : 0.75) : hx;
    markings.push({ rect: lot.north ? rect(doorX - 70, front, doorX + 70, L.maxZ) : rect(doorX - 70, L.minZ, doorX + 70, front), color: '#cfc6b6' });

    const back = lot.north ? rect(L.minX, L.minZ, L.maxX, hr.minZ - 60) : rect(L.minX, hr.maxZ + 60, L.maxX, L.maxZ);
    const frontArea = lot.north ? rect(L.minX, front + 60, L.maxX, L.maxZ - 60) : rect(L.minX, L.minZ + 60, L.maxX, front - 60);
    const avoid = [rect(hr.minX - 260, hr.minZ - 260, hr.maxX + 260, hr.maxZ + 260), rect(dx0 - 220, L.minZ, dx1 + 220, L.maxZ), rect(doorX - 300, Math.min(front, L.maxZ) - 400, doorX + 300, Math.max(front, L.minZ) + 400)];
    plantTrees(back, lrng.int(2, 3), `${lot.id}:yard`, avoid, 0, lrng);
    plantTrees(frontArea, lrng.int(0, 1), `${lot.id}:yard`, avoid, 0, lrng);

    // Fixed Debris: mailbox by the sidewalk, bin by the driveway, maybe a car in the driveway.
    const curbZ = lot.north ? L.maxZ - 70 : L.minZ + 70;
    const mailX = drivewayLeft ? dx1 + 90 : dx0 - 90;
    debrisPlacements.push({ typeId: 'mailbox', x: mailX, z: curbZ, rotY: lot.north ? 0 : Math.PI });
    const binZ = lot.north ? hr.minZ + 120 : hr.maxZ - 120;
    debrisPlacements.push({ typeId: 'trash_can', x: drivewayLeft ? dx0 - 70 : dx1 + 70, z: binZ, rotY: lot.north ? 0 : Math.PI });
    if (!isHome && lrng.chance(0.65)) {
      debrisPlacements.push({ typeId: 'car', x: (dx0 + dx1) / 2, z: lot.north ? front + 220 : front - 220, rotY: lot.north ? Math.PI : 0 });
    }

    if (isHome) {
      spawn = { x: doorX, z: lot.north ? front + 140 : front - 140, roomId: drivewayLeft ? `${lot.id}:yard2` : `${lot.id}:yard` };
    }
  }

  // Street trees along the outer sidewalk edges of the blocks, and a few parked cars at the curb.
  for (let x = 400; x < W - 300; x += rng.range(900, 1400)) {
    if (Math.abs(x - (cx0 + cx1) / 2) < 700) continue;
    for (const z of [sz0 - sw - 110, sz1 + sw + 110]) {
      if (rng.chance(0.45)) continue;
      const blocked = furniture.some((f) => rectsOverlap(f.rect, rect(x - 300, z - 300, x + 300, z + 300)));
      if (blocked) continue;
      placeFurniture('tree_oak', 'street_trees', Math.round(x), z, 0, FURNITURE.tree_oak!.w, FURNITURE.tree_oak!.d);
    }
  }
  const parked = rng.int(3, 5);
  for (let i = 0, tries = 0; i < parked && tries < 40; tries++) {
    const x = rng.range(500, W - 500);
    if (Math.abs(x - (cx0 + cx1) / 2) < 900) continue;
    const z = rng.chance(0.5) ? sz0 + 150 : sz1 - 150;
    if (debrisPlacements.some((p) => p.typeId === 'car' && Math.hypot(p.x - x, p.z - z) < 900)) continue;
    if (Math.abs(x - home.rect.minX - (home.rect.maxX - home.rect.minX) / 2) < 600 && z < (sz0 + sz1) / 2) continue;
    debrisPlacements.push({ typeId: 'car', x, z, rotY: z < (sz0 + sz1) / 2 ? Math.PI / 2 : -Math.PI / 2 });
    i++;
  }

  // ── Markings: dashed centre lines and crosswalks ──
  const midZ = (sz0 + sz1) / 2;
  const midX = (cx0 + cx1) / 2;
  for (let x = 150; x < W; x += 600) {
    if (x + 300 > cx0 - 100 && x < cx1 + 100) continue;
    markings.push({ rect: rect(x, midZ - 8, x + 300, midZ + 8), color: '#f2c94c' });
  }
  for (let z = 150; z < D; z += 600) {
    if (z + 300 > sz0 - 100 && z < sz1 + 100) continue;
    markings.push({ rect: rect(midX - 8, z, midX + 8, z + 300), color: '#f2c94c' });
  }
  for (let i = 0; i < 6; i++) {
    const t = cx0 + 40 + i * 95;
    markings.push({ rect: rect(t, sz0 - 10 - 140, t + 50, sz0 - 10), color: '#f4f1ea' });
    markings.push({ rect: rect(t, sz1 + 10, t + 50, sz1 + 150), color: '#f4f1ea' });
    const u = sz0 + 40 + i * 95;
    markings.push({ rect: rect(cx0 - 10 - 140, u, cx0 - 10, u + 50), color: '#f4f1ea' });
    markings.push({ rect: rect(cx1 + 10, u, cx1 + 150, u + 50), color: '#f4f1ea' });
  }

  // ── Hedge around the edge ──
  const T = N.hedgeThickness;
  const wallRects: Rect[] = [...wallSegments('h', 0, 0, W, [], T), ...wallSegments('h', D, 0, W, [], T), ...wallSegments('v', 0, 0, D, [], T), ...wallSegments('v', W, 0, D, [], T)];
  const walls: Obstacle[] = wallRects.map((r, i) => ({ id: `hedge${i}`, kind: 'wall', rect: r, height: N.hedgeHeight, clearance: 0 }));
  const obstacles: Obstacle[] = [...walls, ...furniture.flatMap((f) => furnitureObstacles(f, FURNITURE[f.defId]!))];

  return {
    area: 'neighborhood',
    seed: root.seed,
    bounds: rect(0, 0, W, D),
    rooms,
    doorways: [],
    walls,
    furniture,
    obstacles,
    rugs: [],
    debrisPlacements,
    spawn: spawn ?? { x: W / 2, z: sz0 - sw - 100, roomId: rooms[0]!.id },
    markings,
  };
}
