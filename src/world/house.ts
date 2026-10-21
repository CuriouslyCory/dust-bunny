/**
 * Seeded house floor generator. Pure data (no three.js): same seed => same layout.
 *
 * Layout: a hallway band across the middle, two rooms above it (living room + kitchen,
 * mirrored by seed) and three below (two bedrooms + bathroom, shuffled). Every room opens
 * onto the hallway; the living room and kitchen also connect directly. The front door sits in
 * the outer wall at one end of the hallway; it stays shut (an obstacle) until the boss is beaten.
 */
import type { Rect } from '../core/math';
import { rect, rectContains, rectsOverlap } from '../core/math';
import { Rng } from '../core/rng';
import { getDebrisType } from '../data/debris';
import { FURNITURE, furnitureObstacles, rotatedSize } from './furniture';
import type { FurnishContext, WallSide } from './rooms';
import { ROOM_TEMPLATES, SIDE_TURNS } from './rooms';
import type { DebrisPlacement, Doorway, ExitDoor, FurnitureInstance, HouseLayout, IndoorRoomType, Obstacle, Room, Rug } from './types';

export const HOUSE = {
  width: 1200,
  depth: 900,
  wallThickness: 10,
  wallHeight: 90,
  doorWidth: 90,
  /** Furniture keeps this far from doorways (cm, along the wall normal). */
  doorClearance: 80,
  /** Front door at one end of the hallway: the way out to the neighborhood. */
  frontDoorWidth: 110,
};

interface DoorSpec {
  /** 'h' = wall runs along X at z = fixed; 'v' = wall runs along Z at x = fixed. */
  axis: 'h' | 'v';
  fixed: number;
  from: number;
  to: number;
  rooms: [string, string];
}

/** Splits a wall line into solid AABBs around the given gaps. */
export function wallSegments(axis: 'h' | 'v', fixed: number, from: number, to: number, gaps: Array<[number, number]>, t: number): Rect[] {
  const sorted = [...gaps].sort((a, b) => a[0] - b[0]);
  const out: Rect[] = [];
  let cur = from - t / 2;
  const end = to + t / 2;
  for (const [g0, g1] of sorted) {
    if (g0 > cur) out.push(seg(axis, fixed, cur, g0, t));
    cur = Math.max(cur, g1);
  }
  if (cur < end) out.push(seg(axis, fixed, cur, end, t));
  return out;
}

function seg(axis: 'h' | 'v', fixed: number, a: number, b: number, t: number): Rect {
  return axis === 'h' ? rect(a, fixed - t / 2, b, fixed + t / 2) : rect(fixed - t / 2, a, fixed + t / 2, b);
}

export function generateHouse(seed: string | number): HouseLayout {
  const root = new Rng(seed);
  const rng = root.fork('house');
  const { width: W, depth: D, wallThickness: T, doorWidth: DW } = HOUSE;

  // ── Room rects (wall centre lines) ──
  const hz0 = Math.round(rng.range(360, 400));
  const hz1 = hz0 + Math.round(rng.range(140, 160));
  const livingW = Math.round(rng.range(620, 720));
  const livingLeft = rng.chance(0.5);
  const split = livingLeft ? livingW : W - livingW;

  const rooms: Room[] = [];
  const addRoom = (id: string, type: IndoorRoomType, r: Rect) => {
    const tpl = ROOM_TEMPLATES[type];
    rooms.push({ id, type, rect: r, floor: rng.pick(tpl.floors) });
  };
  addRoom('living', 'living', livingLeft ? rect(0, 0, split, hz0) : rect(split, 0, W, hz0));
  addRoom('kitchen', 'kitchen', livingLeft ? rect(split, 0, W, hz0) : rect(0, 0, split, hz0));
  addRoom('hallway', 'hallway', rect(0, hz0, W, hz1));

  const bathW = Math.round(rng.range(260, 320));
  const bedTotal = W - bathW;
  const bedA = Math.round(bedTotal * rng.range(0.42, 0.58));
  const bottom: Array<[string, IndoorRoomType, number]> = rng.shuffle([
    ['bedroom1', 'bedroom', bedA],
    ['bedroom2', 'bedroom', bedTotal - bedA],
    ['bathroom', 'bathroom', bathW],
  ] as Array<[string, IndoorRoomType, number]>);
  let x = 0;
  const bottomSplits: number[] = [];
  for (const [id, type, w] of bottom) {
    addRoom(id, type, rect(x, hz1, x + w, D));
    x += w;
    if (x < W) bottomSplits.push(x);
  }

  // ── Doorways ──
  const doors: DoorSpec[] = [];
  const doorOnH = (room: Room, z: number) => {
    const a = rng.range(room.rect.minX + 60, room.rect.maxX - 60 - DW);
    doors.push({ axis: 'h', fixed: z, from: a, to: a + DW, rooms: [room.id, 'hallway'] });
  };
  for (const r of rooms) {
    if (r.id === 'living' || r.id === 'kitchen') doorOnH(r, hz0);
    else if (r.type !== 'hallway') doorOnH(r, hz1);
  }
  const lkW = 120;
  const lkA = rng.range(70, hz0 - 70 - lkW);
  doors.push({ axis: 'v', fixed: split, from: lkA, to: lkA + lkW, rooms: ['living', 'kitchen'] });

  // Front door: hallway end wall (west or east), centred on the hallway.
  const frontWest = rng.chance(0.5);
  const fdMid = (hz0 + hz1) / 2;
  const FDW = HOUSE.frontDoorWidth;
  doors.push({ axis: 'v', fixed: frontWest ? 0 : W, from: fdMid - FDW / 2, to: fdMid + FDW / 2, rooms: ['hallway', 'outside'] });

  const doorRect = (d: DoorSpec): Rect => seg(d.axis, d.fixed, d.from, d.to, T);
  const doorways: Doorway[] = doors.map((d) => ({ rect: doorRect(d), rooms: d.rooms }));

  // ── Walls ──
  const gapsFor = (axis: 'h' | 'v', fixed: number): Array<[number, number]> =>
    doors.filter((d) => d.axis === axis && d.fixed === fixed).map((d) => [d.from, d.to]);
  const wallRects: Rect[] = [
    ...wallSegments('h', 0, 0, W, [], T),
    ...wallSegments('h', D, 0, W, [], T),
    ...wallSegments('v', 0, 0, D, gapsFor('v', 0), T),
    ...wallSegments('v', W, 0, D, gapsFor('v', W), T),
    ...wallSegments('h', hz0, 0, W, gapsFor('h', hz0), T),
    ...wallSegments('h', hz1, 0, W, gapsFor('h', hz1), T),
    ...wallSegments('v', split, 0, hz0, gapsFor('v', split), T),
    ...bottomSplits.flatMap((sx) => wallSegments('v', sx, hz1, D, [], T)),
  ];
  const walls: Obstacle[] = wallRects.map((r, i) => ({ id: `wall${i}`, kind: 'wall', rect: r, height: HOUSE.wallHeight, clearance: 0 }));
  const exitRect = doorRect(doors.find((d) => d.rooms[1] === 'outside')!);
  const exit: ExitDoor = { rect: exitRect, dir: { x: frontWest ? -1 : 1, z: 0 }, obstacleId: 'front_door', open: false };
  const frontDoor: Obstacle = { id: exit.obstacleId, kind: 'wall', rect: exitRect, height: HOUSE.wallHeight, clearance: 0 };

  // ── Furniture ──
  const furniture: FurnitureInstance[] = [];
  const rugs: Rug[] = [];
  const debrisPlacements: DebrisPlacement[] = [];
  let spawn: HouseLayout['spawn'] | null = null;

  for (const room of rooms) {
    const roomRng = root.fork(`room:${room.id}`);
    const interior = rect(room.rect.minX + T / 2, room.rect.minZ + T / 2, room.rect.maxX - T / 2, room.rect.maxZ - T / 2);
    const doorSides = new Set<WallSide>();
    const doorZones: Rect[] = [];
    for (const d of doors) {
      if (!d.rooms.includes(room.id)) continue;
      const dr = doorRect(d);
      if (d.axis === 'h') {
        doorSides.add(Math.abs(d.fixed - room.rect.minZ) < 1 ? 'n' : 's');
        doorZones.push(rect(dr.minX - 15, dr.minZ - HOUSE.doorClearance, dr.maxX + 15, dr.maxZ + HOUSE.doorClearance));
      } else {
        doorSides.add(Math.abs(d.fixed - room.rect.minX) < 1 ? 'w' : 'e');
        doorZones.push(rect(dr.minX - HOUSE.doorClearance, dr.minZ - 15, dr.maxX + HOUSE.doorClearance, dr.maxZ + 15));
      }
    }
    const mine: FurnitureInstance[] = [];

    const place: FurnishContext['place'] = (defId, px, pz, quarterTurns, size) => {
      const def = FURNITURE[defId];
      if (!def) throw new Error(`Unknown furniture "${defId}"`);
      const w = size?.w ?? def.w;
      const d = size?.d ?? def.d;
      const rs = rotatedSize({ w, d }, quarterTurns);
      const fr = rect(px - rs.w / 2, pz - rs.d / 2, px + rs.w / 2, pz + rs.d / 2);
      if (fr.minX < interior.minX - 0.01 || fr.maxX > interior.maxX + 0.01 || fr.minZ < interior.minZ - 0.01 || fr.maxZ > interior.maxZ + 0.01) return null;
      if (doorZones.some((z) => rectsOverlap(z, fr))) return null;
      if (mine.some((f) => rectsOverlap(f.rect, fr, 2))) return null;
      const inst: FurnitureInstance = {
        id: `${room.id}:${defId}${mine.length}`,
        defId,
        roomId: room.id,
        x: px,
        z: pz,
        quarterTurns,
        w,
        d,
        height: def.h,
        rect: fr,
      };
      mine.push(inst);
      furniture.push(inst);
      return inst;
    };

    const placeAgainstWall: FurnishContext['placeAgainstWall'] = (defId, side, t, opts = {}) => {
      const def = FURNITURE[defId];
      if (!def) throw new Error(`Unknown furniture "${defId}"`);
      const turns = SIDE_TURNS[side];
      const rs = rotatedSize({ w: opts.size?.w ?? def.w, d: opts.size?.d ?? def.d }, turns);
      const gap = opts.gap ?? 1;
      const attempts = opts.attempts ?? 8;
      for (let i = 0; i <= attempts; i++) {
        const tt = i === 0 ? t : roomRng.next();
        let px: number;
        let pz: number;
        if (side === 'n' || side === 's') {
          px = interior.minX + rs.w / 2 + tt * (interior.maxX - interior.minX - rs.w);
          pz = side === 'n' ? interior.minZ + rs.d / 2 + gap : interior.maxZ - rs.d / 2 - gap;
        } else {
          pz = interior.minZ + rs.d / 2 + tt * (interior.maxZ - interior.minZ - rs.d);
          px = side === 'w' ? interior.minX + rs.w / 2 + gap : interior.maxX - rs.w / 2 - gap;
        }
        const inst = place(defId, px, pz, turns, opts.size);
        if (inst) return inst;
      }
      return null;
    };

    const ctx: FurnishContext = {
      room,
      interior,
      rng: roomRng,
      doorSides,
      place,
      placeAgainstWall,
      placeDebris(typeId, px, pz, rotY) {
        const type = getDebrisType(typeId);
        if (!type) return false;
        const s = type.size;
        if (!rectContains(interior, px, pz, s)) return false;
        const box = rect(px - s * 0.8, pz - s * 0.8, px + s * 0.8, pz + s * 0.8);
        const blocked = mine.some((f) => rectsOverlap(f.rect, box) && FURNITURE[f.defId]!.clearance < s * 2);
        if (blocked || doorZones.some((z) => rectsOverlap(z, box))) return false;
        debrisPlacements.push({ typeId, x: px, z: pz, rotY: rotY ?? roomRng.range(0, Math.PI * 2) });
        return true;
      },
      addRug(r) {
        const clipped = rect(Math.max(r.minX, interior.minX + 4), Math.max(r.minZ, interior.minZ + 4), Math.min(r.maxX, interior.maxX - 4), Math.min(r.maxZ, interior.maxZ - 4));
        if (clipped.maxX - clipped.minX > 20 && clipped.maxZ - clipped.minZ > 20) rugs.push({ roomId: room.id, rect: clipped, seed: Math.floor(roomRng.next() * 1e9) });
      },
      setSpawn(sx, sz) {
        spawn = { x: sx, z: sz, roomId: room.id };
      },
    };
    ROOM_TEMPLATES[room.type as IndoorRoomType].furnish(ctx);
  }

  const living = rooms[0]!;
  const finalSpawn = spawn ?? { x: (living.rect.minX + living.rect.maxX) / 2, z: (living.rect.minZ + living.rect.maxZ) / 2, roomId: living.id };

  const obstacles: Obstacle[] = [...walls, frontDoor, ...furniture.flatMap((f) => furnitureObstacles(f, FURNITURE[f.defId]!))];

  return {
    area: 'house',
    seed: root.seed,
    bounds: rect(0, 0, W, D),
    rooms,
    doorways,
    walls,
    furniture,
    obstacles,
    rugs,
    debrisPlacements,
    spawn: finalSpawn,
    exit,
  };
}

/** Opens the area exit (front door / road barrier): removes its obstacle. Returns false if already open. */
export function openExit(layout: HouseLayout): boolean {
  const exit = layout.exit;
  if (!exit || exit.open) return false;
  exit.open = true;
  const i = layout.obstacles.findIndex((o) => o.id === exit.obstacleId);
  if (i >= 0) layout.obstacles.splice(i, 1);
  return true;
}

/** Room containing a point (interior test against the wall centre-line rect). */
export function roomAt(layout: HouseLayout, x: number, z: number): Room | undefined {
  return layout.rooms.find((r) => rectContains(r.rect, x, z));
}
