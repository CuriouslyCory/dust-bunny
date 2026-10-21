/** Seeded RNG (mulberry32). Same seed => same sequence, on every platform. */

/** FNV-1a hash of a string to a uint32. */
export function hashString(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedToNumber(seed: string | number): number {
  return typeof seed === 'number' ? seed >>> 0 : hashString(seed);
}

/** Random human-friendly seed string (uses Math.random; only for picking a new seed). */
export function randomSeed(): string {
  return Math.floor(Math.random() * 0xffffffff)
    .toString(36)
    .padStart(6, '0');
}

export class Rng {
  private readonly nextFn: () => number;
  readonly seed: number;

  constructor(seed: string | number) {
    this.seed = seedToNumber(seed);
    this.nextFn = mulberry32(this.seed);
  }

  /** Independent stream derived from this RNG's seed and a label (does not consume this stream). */
  fork(label: string): Rng {
    return new Rng((this.seed ^ hashString(label)) >>> 0);
  }

  /** [0, 1) */
  next(): number {
    return this.nextFn();
  }

  /** [min, max) */
  range(min: number, max: number): number {
    return min + (max - min) * this.nextFn();
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  chance(p: number): boolean {
    return this.nextFn() < p;
  }

  sign(): 1 | -1 {
    return this.nextFn() < 0.5 ? -1 : 1;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick on empty array');
    return items[Math.floor(this.nextFn() * items.length)]!;
  }

  /** Pick by weight; returns undefined when all weights are <= 0. */
  weighted<T>(items: readonly T[], weight: (item: T) => number): T | undefined {
    let total = 0;
    for (const it of items) total += Math.max(0, weight(it));
    if (total <= 0) return undefined;
    let roll = this.nextFn() * total;
    for (const it of items) {
      roll -= Math.max(0, weight(it));
      if (roll < 0) return it;
    }
    return items[items.length - 1];
  }

  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(this.nextFn() * (i + 1));
      [items[i], items[j]] = [items[j]!, items[i]!];
    }
    return items;
  }
}
