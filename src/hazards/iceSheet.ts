/**
 * The Ice Sheet (continent boss, Tier 13; ICE_SHEET in src/data/hazards.ts): the bosses' state
 * machine (RoboVac9000: intro, hunt, telegraphed charge, stun, chip, absorb) reskinned as a slab of
 * continental ice. Slow, enormous, and:
 *
 * - **It pushes everything in front of it.** No suction: while it moves (hunting or charging), a
 *   Bunny in the band ahead of its front cliff is pushed away (`applyPush`, the blowers' push), and
 *   loose Debris in that band is shoved along ahead of the cliff. A charge is faster than the push,
 *   so it still rams (damage, knockback, shed mass). A Bunny big enough to absorb it is not pushed.
 * - **Only mountain ranges stun it.** A charge that crashes into a mountain range (`isMountainRange`)
 *   stuns it like a wall crash in the other Areas; the coast, the map edge and any other obstacle
 *   just stop it (no stun). Abilities (a Decoy clog, a Hunker crash, a Discharge) and Spiky Dash
 *   still stun it: they are the Characters' own tools, not the terrain.
 * - **Chips calve off as icebergs.** Every `summonInterval` s while it hunts, an iceberg breaks off a
 *   front corner (`calving_l` / `calving_r`, hidden until it regrows); a mountain crash calves both
 *   corners; ramming it while stunned scatters `chipPieces` icebergs. They are `calved_iceberg`
 *   Debris (src/data/iceSheetDebris.ts), absorbable by the Bunny that knocked them off.
 *
 * Mountain ranges, for the map: an Obstacle counts when it is furniture whose def is one of the
 * Continent's ranges (MOUNTAIN_OBSTACLE_DEFS: `continent_range`, `continent_massif`), whose def id
 * starts with `mountain` (MOUNTAIN_RANGE_PREFIX), or which stands in a `mountains` zone
 * (MOUNTAIN_ZONE). Walls and the coast never count.
 */
import { circleVsRect } from '../core/math';
import type { Rng } from '../core/rng';
import { ICE_SHEET, type IceSheetTuning } from '../data/hazards';
import { CALVED_ICEBERG_ID } from '../data/iceSheetDebris';
import type { Debris } from '../entities/debris';
import type { Run } from '../game/run';
import { isFloorFree } from '../systems/spawner';
import { MOUNTAIN_OBSTACLE_DEFS } from '../world/continent';
import { roomAt } from '../world/house';
import type { HouseLayout, Obstacle, RoomType } from '../world/types';
import { applyPush, bunnyCanAbsorb, bunnySheltered, hazardBlockedBy } from './common';
import { hazardRegistry, type HazardDef } from './index';
import { RoboVac9000 } from './robovac';
import { scatterDebris } from './shed';

/** Furniture def ids starting with this are mountain ranges (they stun the Ice Sheet's charges). */
export const MOUNTAIN_RANGE_PREFIX = 'mountain';
/** Any furniture standing in a zone of this type also counts (the placeholder map's massifs). */
export const MOUNTAIN_ZONE: RoomType = 'mountains';

/** True if `o` is a mountain range: furniture with a `mountain…` def id, or standing in a `mountains` zone. */
export function isMountainRange(house: HouseLayout, o: Obstacle): boolean {
  if (o.kind !== 'furniture' || !o.furnitureId) return false;
  const f = house.furniture.find((i) => i.id === o.furnitureId);
  if (!f) return false;
  return f.defId.startsWith(MOUNTAIN_RANGE_PREFIX) || MOUNTAIN_OBSTACLE_DEFS.includes(f.defId) || roomAt(house, f.x, f.z)?.type === MOUNTAIN_ZONE;
}

/** True if a disc at (x, z), grown by `slack`, touches a mountain range that blocks a Hazard of `height`. */
export function touchesMountainRange(house: HouseLayout, x: number, z: number, radius: number, height: number, slack = 0.05): boolean {
  for (const o of house.obstacles) {
    if (hazardBlockedBy(o, height) && circleVsRect(x, z, radius + slack, o.rect) && isMountainRange(house, o)) return true;
  }
  return false;
}

const _debris: Debris[] = [];
const CORNER_NODES = ['calving_l', 'calving_r'] as const;
/** Where a calved iceberg may land: extra sideways slide, then distance back along the flank (model units). */
const CALVE_SLIDES: ReadonlyArray<readonly [number, number]> = [
  [0.2, 0],
  [0.8, 0],
  [0.2, 1.5],
  [0.8, 3],
  [1.6, 0],
  [1.6, 4.5],
  [2.6, 0],
];

export class IceSheet extends RoboVac9000 {
  private readonly ice: IceSheetTuning;
  /** Seconds until each front corner (`calving_l`, `calving_r`) has a chunk to calve again. */
  readonly regrow: [number, number] = [0, 0];
  /** Icebergs calved so far (corner calvings and chip pieces). */
  calved = 0;
  private nextCorner = 0;

  constructor(id: number, def: HazardDef, x: number, z: number, rng: Rng, cfg: IceSheetTuning = ICE_SHEET) {
    super(id, def, x, z, rng, cfg);
    this.ice = cfg;
  }

  /** Model-unit lengths (BulldozeTuning, CalveTuning) to world units: full-size model scale × chips. */
  private get k(): number {
    return (this.cfg.size / this.cfg.modelSize) * this.scale;
  }

  protected override tick(dt: number, run: Run): void {
    const x0 = this.x;
    const z0 = this.z;
    super.tick(dt, run);
    for (let i = 0; i < 2; i++) {
      if (this.regrow[i] <= 0) continue;
      this.regrow[i] -= dt;
      if (this.regrow[i] <= 0) this.setCornerVisible(i, true);
    }
    if (this.state === 'hunt' || this.state === 'charge') this.bulldoze(dt, run, Math.hypot(this.x - x0, this.z - z0));
  }

  /** Front band: pushes the Bunny away and shoves loose Debris ahead of the cliff. */
  private bulldoze(dt: number, run: Run, moved: number): void {
    const bz = this.ice.bulldoze;
    const k = this.k;
    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    const front = bz.front * k;
    const half = bz.halfWidth * k;
    const reach = bz.reach * k;
    const b = run.bunny;
    const dx = b.x - this.x;
    const dz = b.z - this.z;
    const along = dx * fx + dz * fz;
    const side = Math.abs(dx * fz - dz * fx);
    if (along > 0 && along - b.radius < front + reach && side < half + b.radius * 0.5 && !bunnyCanAbsorb(run, this.size) && !bunnySheltered(run, this.cfg.height)) {
      applyPush(run, this.x, this.z, bz.strength, 1, dt);
    }
    if (moved <= 0) return;
    _debris.length = 0;
    run.debris.query(this.x + fx * front, this.z + fz * front, half + reach, _debris);
    for (const d of _debris) {
      if (!d.alive || d.size > bz.debrisSize) continue;
      const ddx = d.x - this.x;
      const ddz = d.z - this.z;
      const a = ddx * fx + ddz * fz;
      const s = ddx * fz - ddz * fx;
      // Under the front half of the slab or touching the cliff: shove it out to the cliff line.
      if (a < front * 0.5 || a > front + d.size || Math.abs(s) > half) continue;
      const na = front + d.size;
      const nx = this.x + fx * na + fz * s;
      const nz = this.z + fz * na - fx * s;
      if (isFloorFree(run.house, nx, nz, d.size)) run.debris.move(d, nx, nz);
    }
  }

  /** A crash only stuns when the slab is up against a mountain range. */
  protected override crashStuns(run: Run, radius: number): boolean {
    return touchesMountainRange(run.house, this.x, this.z, radius, this.cfg.height, Math.max(0.05, radius * 0.02));
  }

  /** The mountain shakes both front corners loose. */
  protected override onCrashStun(run: Run): void {
    this.calve(run, 0);
    this.calve(run, 1);
  }

  /** Calving replaces the minis: `summonCount` icebergs, alternating corners. */
  protected override summon(run: Run): void {
    for (let n = 0; n < this.cfg.summonCount; n++) {
      if (this.calve(run, this.nextCorner) || this.calve(run, 1 - this.nextCorner)) this.nextCorner = 1 - this.nextCorner;
    }
  }

  /** Chip pieces are icebergs. */
  protected override scatterChips(run: Run, count: number, size: number, inner: number, outer: number): void {
    const type = run.debris.types.find((t) => t.id === CALVED_ICEBERG_ID);
    if (!type) {
      super.scatterChips(run, count, size, inner, outer);
      return;
    }
    this.calved += scatterDebris(run, this.rng, this.x, this.z, count, size, inner, outer, type);
  }

  private setCornerVisible(corner: number, visible: boolean): void {
    const node = this.model.getObjectByName(CORNER_NODES[corner]!);
    if (node) node.visible = visible;
  }

  /** World position of a front corner (`calving_l` is −X in the model), `out` units further sideways and `back` units back. */
  cornerPosition(corner: number, out = 0, back = 0): { x: number; z: number } {
    const c = this.ice.calve;
    const lx = (corner === 0 ? -1 : 1) * (c.cornerX * this.k + out);
    const lz = c.cornerZ * this.k - back;
    const cos = Math.cos(this.yaw);
    const sin = Math.sin(this.yaw);
    return { x: this.x + lx * cos + lz * sin, z: this.z - lx * sin + lz * cos };
  }

  /**
   * Breaks the chunk off a front corner: an iceberg slides off sideways, clear of the slab, and the
   * corner hides until it regrows. False if that corner has no chunk yet or there is no room.
   */
  calve(run: Run, corner: number): boolean {
    if (this.regrow[corner] > 0) return false;
    const index = run.debris.types.findIndex((t) => t.id === CALVED_ICEBERG_ID);
    if (index < 0) return false;
    const c = this.ice.calve;
    const size = Math.min(c.maxSize, Math.max(c.minSize, run.bunny.radius * c.sizeRadii));
    // Slide out past the contact circle so the Bunny can eat it without touching the slab.
    const clear = this.cfg.contactRadius * this.scale - c.cornerX * this.k + size;
    // Up against a mountain (or the coast) the berg slides back along the flank instead.
    for (const [extra, back] of CALVE_SLIDES) {
      const p = this.cornerPosition(corner, Math.max(0, clear) + extra, back * this.k);
      if (!isFloorFree(run.house, p.x, p.z, size)) continue;
      if (!run.debris.spawn(index, p.x, p.z, this.rng, { size })) continue;
      this.calved++;
      this.regrow[corner] = c.regrow;
      this.setCornerVisible(corner, false);
      return true;
    }
    return false;
  }
}

export const iceSheetDef = hazardRegistry.register({
  id: 'ice_sheet',
  name: 'Ice Sheet',
  boss: true,
  // Full-size contact radius: room for the boss before it is chipped.
  footprint: { radius: ICE_SHEET.contactRadius, height: ICE_SHEET.height },
  mass: ICE_SHEET.mass,
  modelId: ICE_SHEET.modelId,
  create(_run, x, z, id, rng: Rng) {
    return new IceSheet(id, this, x, z, rng, ICE_SHEET);
  },
});
