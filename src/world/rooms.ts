/**
 * Room templates. Each template furnishes one room through a FurnishContext; placement
 * helpers reject spots that overlap doorways or other furniture, so templates can be
 * optimistic. To add a room type: add it to RoomType and register a template here.
 */
import type { Rect } from '../core/math';
import { rectFromCenter } from '../core/math';
import type { Rng } from '../core/rng';
import type { FloorMaterialId, FurnitureInstance, Room, RoomType } from './types';

export type WallSide = 'n' | 's' | 'e' | 'w';

export interface FurnishContext {
  readonly room: Room;
  /** Room rect minus wall thickness. */
  readonly interior: Rect;
  readonly rng: Rng;
  /** Walls of this room containing a doorway. */
  readonly doorSides: ReadonlySet<WallSide>;
  place(defId: string, x: number, z: number, quarterTurns: number, size?: { w?: number; d?: number }): FurnitureInstance | null;
  /**
   * Places furniture with its back against a wall, facing into the room. `t` (0..1) is the
   * position along the wall; on failure a few random positions are tried.
   */
  placeAgainstWall(
    defId: string,
    side: WallSide,
    t: number,
    opts?: { size?: { w?: number; d?: number }; gap?: number; attempts?: number },
  ): FurnitureInstance | null;
  /** Places a Debris type (chair, basket...) at a fixed spot if it does not clash with solid furniture. */
  placeDebris(typeId: string, x: number, z: number, rotY?: number): boolean;
  addRug(rect: Rect): void;
  setSpawn(x: number, z: number): void;
}

export interface RoomTemplate {
  type: RoomType;
  floors: FloorMaterialId[];
  furnish(ctx: FurnishContext): void;
}

/** Quarter turns that make furniture against `side` face into the room. */
export const SIDE_TURNS: Record<WallSide, number> = { n: 0, w: 1, s: 2, e: 3 };
export const OPPOSITE: Record<WallSide, WallSide> = { n: 's', s: 'n', e: 'w', w: 'e' };

/** Unit vector furniture faces for a quarter-turn rotation. */
export function facing(quarterTurns: number): { x: number; z: number } {
  return [
    { x: 0, z: 1 },
    { x: 1, z: 0 },
    { x: 0, z: -1 },
    { x: -1, z: 0 },
  ][((quarterTurns % 4) + 4) % 4]!;
}

const sidesByPreference = (ctx: FurnishContext, prefer: WallSide[]): WallSide[] =>
  [...prefer].sort((a, b) => Number(ctx.doorSides.has(a)) - Number(ctx.doorSides.has(b)));

const cx = (r: Rect) => (r.minX + r.maxX) / 2;
const cz = (r: Rect) => (r.minZ + r.maxZ) / 2;

function corners(r: Rect, inset: number): Array<[number, number]> {
  return [
    [r.minX + inset, r.minZ + inset],
    [r.maxX - inset, r.minZ + inset],
    [r.minX + inset, r.maxZ - inset],
    [r.maxX - inset, r.maxZ - inset],
  ];
}

const living: RoomTemplate = {
  type: 'living',
  floors: ['wood'],
  furnish(ctx) {
    const { rng, interior } = ctx;
    let couch: FurnitureInstance | null = null;
    let couchSide: WallSide = 'n';
    for (const side of sidesByPreference(ctx, ['n', 's', 'w', 'e'])) {
      couch = ctx.placeAgainstWall('couch', side, rng.range(0.3, 0.7), { gap: 4 });
      if (couch) {
        couchSide = side;
        break;
      }
    }
    if (couch) {
      const f = facing(couch.quarterTurns);
      const lat = { x: Math.abs(f.z), z: Math.abs(f.x) };
      // Start under the front edge of the couch, where the dust lives.
      ctx.setSpawn(couch.x + f.x * (couch.d / 2 - 16), couch.z + f.z * (couch.d / 2 - 16));
      const tableDist = couch.d / 2 + 45 + 30;
      ctx.place('coffee_table', couch.x + f.x * tableDist, couch.z + f.z * tableDist, couch.quarterTurns);
      const rugC = { x: couch.x + f.x * (couch.d / 2 + 70), z: couch.z + f.z * (couch.d / 2 + 70) };
      const rw = 250;
      const rd = 170;
      ctx.addRug(rectFromCenter(rugC.x, rugC.z, lat.x ? rw : rd, lat.x ? rd : rw));
      // Armchair beside the couch, angled in by facing the same way.
      const side = rng.sign();
      const ad = couch.w / 2 + 70;
      ctx.place('armchair', couch.x + lat.x * ad * side + f.x * 60, couch.z + lat.z * ad * side + f.z * 60, couch.quarterTurns);
      ctx.placeAgainstWall('tv_stand', OPPOSITE[couchSide], rng.range(0.35, 0.65));
      ctx.placeDebris('cushion', rugC.x + lat.x * 70 * -side, rugC.z + lat.z * 70 * -side);
    }
    for (const s of sidesByPreference(ctx, ['w', 'e'])) {
      if (ctx.placeAgainstWall('bookshelf', s, rng.range(0.2, 0.8))) break;
    }
    const [px, pz] = rng.pick(corners(interior, 35));
    ctx.placeDebris('potted_plant', px, pz);
    ctx.placeDebris('ottoman', cx(interior) + rng.range(-120, 120), cz(interior) + rng.range(-60, 60));
  },
};

const kitchen: RoomTemplate = {
  type: 'kitchen',
  floors: ['tile'],
  furnish(ctx) {
    const { rng, interior } = ctx;
    const counterSide = sidesByPreference(ctx, ['n', 's'])[0]!;
    const fridgeT = rng.chance(0.5) ? 0 : 1;
    ctx.placeAgainstWall('fridge', counterSide, fridgeT, { attempts: 4 });
    ctx.placeAgainstWall('stove', counterSide, 0.5 + (fridgeT === 0 ? 0.1 : -0.1));
    ctx.placeAgainstWall('kitchen_counter', counterSide, fridgeT === 0 ? 0.28 : 0.72, { size: { w: 120 } });
    ctx.placeAgainstWall('kitchen_counter', counterSide, fridgeT === 0 ? 0.88 : 0.12, { size: { w: 130 } });
    for (const s of sidesByPreference(ctx, ['e', 'w'])) {
      if (!ctx.doorSides.has(s) && ctx.placeAgainstWall('kitchen_counter', s, 0.5, { size: { w: 160 } })) break;
    }
    const tx = cx(interior) + rng.range(-40, 40);
    const tz = cz(interior) + (counterSide === 'n' ? 50 : -50);
    const table = ctx.place('dining_table', tx, tz, 0);
    if (table) {
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          ctx.placeDebris('chair', tx + sx * (table.w / 2 - 38), tz + sz * (table.d / 2 + 12), sz < 0 ? 0 : Math.PI);
        }
      }
    }
    const [bx, bz] = rng.pick(corners(interior, 30));
    ctx.placeDebris('waste_bin', bx, bz);
  },
};

const hallway: RoomTemplate = {
  type: 'hallway',
  floors: ['woodDark'],
  furnish(ctx) {
    const { rng, interior } = ctx;
    ctx.placeAgainstWall('console_table', rng.chance(0.5) ? 'n' : 's', rng.range(0.15, 0.85), { attempts: 12 });
    ctx.placeAgainstWall('shoe_rack', rng.chance(0.5) ? 'n' : 's', rng.chance(0.5) ? 0.05 : 0.95, { attempts: 12 });
    const runnerW = Math.min(500, (interior.maxX - interior.minX) * 0.45);
    ctx.addRug(rectFromCenter(cx(interior) + rng.range(-150, 150), cz(interior), runnerW, 70));
    ctx.placeDebris('potted_plant', interior.minX + 35, cz(interior));
    ctx.placeDebris('potted_plant', interior.maxX - 35, cz(interior));
  },
};

const bedroom: RoomTemplate = {
  type: 'bedroom',
  floors: ['carpet', 'wood'],
  furnish(ctx) {
    const { rng, interior } = ctx;
    let bed: FurnitureInstance | null = null;
    for (const side of sidesByPreference(ctx, ['s', 'n', 'w', 'e'])) {
      bed = ctx.placeAgainstWall('bed', side, rng.range(0.35, 0.65));
      if (bed) {
        const f = facing(bed.quarterTurns);
        const lat = { x: Math.abs(f.z), z: Math.abs(f.x) };
        const back = { x: bed.x - f.x * (bed.d / 2 - 22), z: bed.z - f.z * (bed.d / 2 - 22) };
        for (const s of [-1, 1]) {
          const o = bed.w / 2 + 28;
          ctx.place('nightstand', back.x + lat.x * o * s, back.z + lat.z * o * s, bed.quarterTurns);
        }
        const rugSide = rng.sign();
        const ro = bed.w / 2 + 50;
        ctx.addRug(rectFromCenter(bed.x + lat.x * ro * rugSide, bed.z + lat.z * ro * rugSide, lat.x ? 80 : 150, lat.x ? 150 : 80));
        ctx.placeDebris('laundry_basket', bed.x + lat.x * (ro + 40) * -rugSide + f.x * 60, bed.z + lat.z * (ro + 40) * -rugSide + f.z * 60);
        break;
      }
    }
    for (const s of sidesByPreference(ctx, ['w', 'e', 'n'])) {
      if (ctx.placeAgainstWall('dresser', s, rng.range(0.3, 0.7))) break;
    }
    if (interior.maxX - interior.minX > 420) {
      for (const s of sidesByPreference(ctx, ['e', 'w'])) {
        if (ctx.placeAgainstWall('desk', s, rng.range(0.2, 0.8))) break;
      }
    }
  },
};

const bathroom: RoomTemplate = {
  type: 'bathroom',
  floors: ['tileSmall'],
  furnish(ctx) {
    const { rng, interior } = ctx;
    const tubSide = sidesByPreference(ctx, ['s', 'n'])[0]!;
    ctx.placeAgainstWall('bathtub', tubSide, rng.chance(0.5) ? 0 : 1, { attempts: 6 });
    for (const s of sidesByPreference(ctx, ['e', 'w'])) {
      if (ctx.placeAgainstWall('toilet', s, rng.range(0.3, 0.7))) break;
    }
    for (const s of sidesByPreference(ctx, ['w', 'e', OPPOSITE[tubSide]])) {
      if (ctx.placeAgainstWall('sink_cabinet', s, rng.range(0.2, 0.8))) break;
    }
    ctx.addRug(rectFromCenter(cx(interior), cz(interior), 90, 60));
    const [bx, bz] = rng.pick(corners(interior, 35));
    ctx.placeDebris('laundry_basket', bx, bz);
  },
};

export const ROOM_TEMPLATES: Record<RoomType, RoomTemplate> = { living, kitchen, hallway, bedroom, bathroom };
