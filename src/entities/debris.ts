/**
 * DebrisField: all live Debris for a Run. Plain data + spatial hash; DebrisRenderer mirrors
 * it into one InstancedMesh per type using the bucket/slot layout kept here.
 */
import { SpatialHash } from '../core/spatialHash';
import type { Rng } from '../core/rng';
import type { DebrisType } from '../data/debris';
import { TUNING } from '../data/tuning';

export interface Debris {
  id: number;
  type: DebrisType;
  typeIndex: number;
  x: number;
  z: number;
  /** Instance radius (cm), catalogue size with jitter. */
  size: number;
  rotY: number;
  colorIndex: number;
  /** Index inside buckets[typeIndex] (= instance index). */
  slot: number;
  alive: boolean;
}

export class DebrisField {
  readonly hash: SpatialHash<Debris>;
  /** Per type: live Debris, densely packed; index = InstancedMesh instance id. */
  readonly buckets: Debris[][];
  private dirty: Debris[] = [];
  private nextId = 1;
  private maxSizeCache = -1;
  readonly cap: number;

  constructor(
    readonly types: readonly DebrisType[],
    cap = TUNING.debris.cap,
  ) {
    this.hash = new SpatialHash<Debris>(TUNING.debris.cellSize);
    this.buckets = types.map(() => []);
    this.cap = cap;
  }

  get count(): number {
    return this.hash.size;
  }

  get full(): boolean {
    return this.count >= this.cap;
  }

  /** Largest live Debris radius, used to widen proximity queries. */
  get maxSize(): number {
    if (this.maxSizeCache < 0) {
      let m = 0;
      this.buckets.forEach((b) => {
        for (const d of b) if (d.size > m) m = d.size;
      });
      this.maxSizeCache = m;
    }
    return this.maxSizeCache;
  }

  spawn(typeIndex: number, x: number, z: number, rng: Rng, opts: { size?: number; rotY?: number } = {}): Debris | null {
    if (this.full) return null;
    const type = this.types[typeIndex]!;
    const j = TUNING.debris.sizeJitter;
    const size = opts.size ?? type.size * (1 + rng.range(-j, j));
    const bucket = this.buckets[typeIndex]!;
    const d: Debris = {
      id: this.nextId++,
      type,
      typeIndex,
      x,
      z,
      size,
      rotY: opts.rotY ?? rng.range(0, Math.PI * 2),
      colorIndex: rng.int(0, type.colors.length - 1),
      slot: bucket.length,
      alive: true,
    };
    bucket.push(d);
    this.hash.insert(d);
    this.dirty.push(d);
    if (this.maxSizeCache >= 0 && size > this.maxSizeCache) this.maxSizeCache = size;
    return d;
  }

  remove(d: Debris): void {
    if (!d.alive) return;
    d.alive = false;
    this.hash.remove(d);
    const bucket = this.buckets[d.typeIndex]!;
    const last = bucket.pop()!;
    if (last !== d) {
      bucket[d.slot] = last;
      last.slot = d.slot;
      this.dirty.push(last);
    }
    if (d.size >= this.maxSizeCache) this.maxSizeCache = -1;
  }

  move(d: Debris, x: number, z: number): void {
    d.x = x;
    d.z = z;
    this.hash.update(d);
    this.dirty.push(d);
  }

  /** Debris whose centre is within `radius` of (x, z). */
  query(x: number, z: number, radius: number, out: Debris[] = []): Debris[] {
    return this.hash.queryCircle(x, z, radius, out);
  }

  /** Debris whose disc overlaps the circle (x, z, radius). */
  queryOverlapping(x: number, z: number, radius: number, out: Debris[] = []): Debris[] {
    const tmp = this.hash.queryCircle(x, z, radius + this.maxSize);
    for (const d of tmp) {
      const rr = radius + d.size;
      const dx = d.x - x;
      const dz = d.z - z;
      if (dx * dx + dz * dz < rr * rr) out.push(d);
    }
    return out;
  }

  forEach(fn: (d: Debris) => void): void {
    for (const b of this.buckets) for (const d of b) fn(d);
  }

  /** Debris whose instance data changed since the last call (renderer uses this). */
  drainDirty(): Debris[] {
    const out = this.dirty;
    this.dirty = [];
    return out;
  }

  clear(): void {
    for (const b of this.buckets) {
      for (const d of b) d.alive = false;
      b.length = 0;
    }
    this.hash.clear();
    this.dirty = [];
    this.maxSizeCache = -1;
  }
}
