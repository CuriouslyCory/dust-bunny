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
  /** Dense per-type instance index; may change when another Debris is removed. */
  slot: number;
  alive: boolean;
}

/** Current per-type state, borrowed until the next field mutation. */
export interface DebrisChanges {
  readonly typeIndex: number;
  readonly instances: readonly Readonly<Debris>[];
  /** Unique, valid indexes into instances. Empty for count-only changes. */
  readonly changedSlots: readonly number[];
}

export class DebrisField {
  hash: SpatialHash<Debris>;
  /** Per type: live Debris, densely packed; index = InstancedMesh instance id. */
  private readonly buckets: Debris[][];
  private readonly dirtySlots: Set<number>[];
  private readonly changedTypes = new Set<number>();
  private nextId = 1;
  private maxSizeCache = -1;
  readonly cap: number;

  constructor(
    readonly types: readonly DebrisType[],
    cap = TUNING.debris.cap,
  ) {
    this.hash = new SpatialHash<Debris>(TUNING.debris.cellSize);
    this.buckets = types.map(() => []);
    this.dirtySlots = types.map(() => new Set<number>());
    this.cap = cap;
  }

  get count(): number {
    return this.hash.size;
  }

  get full(): boolean {
    return this.count >= this.cap;
  }

  /** Retained bookkeeping: at most cap slots and types.length type markers. No entity references. */
  get pendingChanges(): { readonly slots: number; readonly types: number } {
    return {
      slots: this.dirtySlots.reduce((n, slots) => n + slots.size, 0),
      types: this.changedTypes.size,
    };
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
    this.markChanged(d);
    if (this.maxSizeCache >= 0 && size > this.maxSizeCache) this.maxSizeCache = size;
    return d;
  }

  remove(d: Debris): void {
    if (!this.contains(d)) return;
    d.alive = false;
    this.hash.remove(d);
    const bucket = this.buckets[d.typeIndex]!;
    const last = bucket.pop()!;
    this.dirtySlots[d.typeIndex]!.delete(bucket.length);
    this.changedTypes.add(d.typeIndex);
    if (last !== d) {
      bucket[d.slot] = last;
      last.slot = d.slot;
      this.markChanged(last);
    }
    if (d.size >= this.maxSizeCache) this.maxSizeCache = -1;
  }

  move(d: Debris, x: number, z: number): void {
    if (!this.contains(d)) return;
    d.x = x;
    d.z = z;
    this.hash.update(d);
    this.markChanged(d);
  }

  private contains(d: Debris): boolean {
    return d.alive && this.buckets[d.typeIndex]?.[d.slot] === d;
  }

  private markChanged(d: Debris): void {
    this.dirtySlots[d.typeIndex]!.add(d.slot);
    this.changedTypes.add(d.typeIndex);
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

  /**
   * Destructive, single-consumer synchronization. Process borrowed views synchronously,
   * before mutating the field. Includes empty changed types; instances.length is authoritative.
   * Request full state on attachment, even if earlier changes have already been consumed.
   */
  consumeChanges({ full = false }: { full?: boolean } = {}): readonly DebrisChanges[] {
    const indexes = full ? this.types.map((_, i) => i) : [...this.changedTypes];
    const changes = indexes.map((typeIndex): DebrisChanges => {
      const instances = this.buckets[typeIndex]!;
      const slots = this.dirtySlots[typeIndex]!;
      const changedSlots = full ? instances.map((_, i) => i) : [...slots];
      slots.clear();
      return { typeIndex, instances, changedSlots };
    });
    this.changedTypes.clear();
    return changes;
  }

  /** Removes every Debris and switches the spatial hash cell size (bigger cells for bigger areas). */
  reset(cellSize: number): void {
    this.clear();
    if (cellSize !== this.hash.cellSize) this.hash = new SpatialHash<Debris>(cellSize);
  }

  clear(): void {
    this.buckets.forEach((b, i) => {
      if (b.length > 0) this.changedTypes.add(i);
      for (const d of b) d.alive = false;
      b.length = 0;
      this.dirtySlots[i]!.clear();
    });
    this.hash.clear();
    this.maxSizeCache = -1;
  }
}
