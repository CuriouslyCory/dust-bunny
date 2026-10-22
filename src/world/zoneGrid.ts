/**
 * Zones painted on a 1-unit grid by feature (a town, a river reach, a mountain belt), merged back
 * into rects: the Region and the Continent paint their maps with it so the zones tile the map
 * without overlapping. Pure data.
 */
import { rect, type Rect } from '../core/math';
import type { FloorMaterialId, Room, RoomType } from './types';

/** Zones painted on a 1-unit grid by feature, merged back into rects (one Room each). */
export class ZoneGrid<T extends RoomType> {
  readonly cells: Uint16Array;
  readonly features: Array<{ name: string; type: T }>;

  /** `base` is the zone type every cell starts as (feature 0, named after it); `floors` maps zone types to floors. */
  constructor(
    readonly w: number,
    readonly d: number,
    base: T,
    private readonly floors: Readonly<Record<T, FloorMaterialId>>,
  ) {
    this.cells = new Uint16Array(w * d);
    this.features = [{ name: base, type: base }];
  }

  feature(name: string, type: T): number {
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

  typeAt(x: number, z: number): T | null {
    const f = this.featureAt(x, z);
    return f < 0 ? null : this.features[f]!.type;
  }

  /** True if `r` lies in the map and every cell it touches is one of `types`. */
  allOf(r: Rect, types: readonly T[]): boolean {
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
        rooms.push({ id: k === 0 ? name : `${name}.${k}`, type, rect: rect(x, z, x1, z1), floor: this.floors[type] });
      }
    }
    return rooms;
  }
}
