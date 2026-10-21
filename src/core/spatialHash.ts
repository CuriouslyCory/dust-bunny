/**
 * Uniform-grid spatial hash on the XZ plane. Items are points (x, z); callers that care
 * about item radius should widen the query radius by the largest radius they store.
 */
export interface Positioned {
  x: number;
  z: number;
}

export class SpatialHash<T extends Positioned> {
  private cells = new Map<number, T[]>();
  private keyOf = new Map<T, number>();
  readonly cellSize: number;

  constructor(cellSize: number) {
    if (cellSize <= 0) throw new Error('cellSize must be > 0');
    this.cellSize = cellSize;
  }

  get size(): number {
    return this.keyOf.size;
  }

  private cellCoord(v: number): number {
    return Math.floor(v / this.cellSize);
  }

  private static key(cx: number, cz: number): number {
    // Supports coordinates in roughly ±1e9 cells; fine for a house floor.
    return (cx + 0x8000) * 0x10000 + (cz + 0x8000);
  }

  insert(item: T): void {
    if (this.keyOf.has(item)) {
      this.update(item);
      return;
    }
    const k = SpatialHash.key(this.cellCoord(item.x), this.cellCoord(item.z));
    let cell = this.cells.get(k);
    if (!cell) {
      cell = [];
      this.cells.set(k, cell);
    }
    cell.push(item);
    this.keyOf.set(item, k);
  }

  remove(item: T): boolean {
    const k = this.keyOf.get(item);
    if (k === undefined) return false;
    const cell = this.cells.get(k);
    if (cell) {
      const i = cell.indexOf(item);
      if (i >= 0) {
        cell[i] = cell[cell.length - 1]!;
        cell.pop();
      }
      if (cell.length === 0) this.cells.delete(k);
    }
    this.keyOf.delete(item);
    return true;
  }

  /** Call after changing item.x / item.z. Cheap when the item stays in its cell. */
  update(item: T): void {
    const old = this.keyOf.get(item);
    const k = SpatialHash.key(this.cellCoord(item.x), this.cellCoord(item.z));
    if (old === k) return;
    if (old !== undefined) this.remove(item);
    let cell = this.cells.get(k);
    if (!cell) {
      cell = [];
      this.cells.set(k, cell);
    }
    cell.push(item);
    this.keyOf.set(item, k);
  }

  has(item: T): boolean {
    return this.keyOf.has(item);
  }

  /** Items whose position lies within `radius` of (x, z). Appends to `out` and returns it. */
  queryCircle(x: number, z: number, radius: number, out: T[] = []): T[] {
    const r2 = radius * radius;
    const minCx = this.cellCoord(x - radius);
    const maxCx = this.cellCoord(x + radius);
    const minCz = this.cellCoord(z - radius);
    const maxCz = this.cellCoord(z + radius);
    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        const cell = this.cells.get(SpatialHash.key(cx, cz));
        if (!cell) continue;
        for (const it of cell) {
          const dx = it.x - x;
          const dz = it.z - z;
          if (dx * dx + dz * dz <= r2) out.push(it);
        }
      }
    }
    return out;
  }

  /** Items whose position lies inside the rectangle (inclusive). */
  queryRect(minX: number, minZ: number, maxX: number, maxZ: number, out: T[] = []): T[] {
    for (let cx = this.cellCoord(minX); cx <= this.cellCoord(maxX); cx++) {
      for (let cz = this.cellCoord(minZ); cz <= this.cellCoord(maxZ); cz++) {
        const cell = this.cells.get(SpatialHash.key(cx, cz));
        if (!cell) continue;
        for (const it of cell) {
          if (it.x >= minX && it.x <= maxX && it.z >= minZ && it.z <= maxZ) out.push(it);
        }
      }
    }
    return out;
  }

  clear(): void {
    this.cells.clear();
    this.keyOf.clear();
  }
}
