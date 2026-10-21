import { describe, expect, it } from 'vitest';
import { Rng } from './rng';
import { SpatialHash } from './spatialHash';

interface P {
  id: number;
  x: number;
  z: number;
}

describe('spatial hash', () => {
  const rng = new Rng('hash');
  const points: P[] = Array.from({ length: 2000 }, (_, id) => ({ id, x: rng.range(-500, 500), z: rng.range(-300, 300) }));

  const brute = (x: number, z: number, r: number, list: P[]) =>
    list.filter((p) => (p.x - x) ** 2 + (p.z - z) ** 2 <= r * r).map((p) => p.id).sort((a, b) => a - b);

  it('circle queries match brute force', () => {
    const h = new SpatialHash<P>(16);
    points.forEach((p) => h.insert(p));
    expect(h.size).toBe(points.length);
    for (let i = 0; i < 50; i++) {
      const x = rng.range(-500, 500);
      const z = rng.range(-300, 300);
      const r = rng.range(1, 120);
      expect(h.queryCircle(x, z, r).map((p) => p.id).sort((a, b) => a - b)).toEqual(brute(x, z, r, points));
    }
  });

  it('rect queries are inclusive', () => {
    const h = new SpatialHash<P>(10);
    const p = { id: 1, x: 10, z: 10 };
    h.insert(p);
    expect(h.queryRect(0, 0, 10, 10)).toEqual([p]);
    expect(h.queryRect(10.01, 0, 20, 20)).toEqual([]);
  });

  it('handles remove and update after moving', () => {
    const h = new SpatialHash<P>(16);
    const list = points.slice(0, 300).map((p) => ({ ...p }));
    list.forEach((p) => h.insert(p));
    for (const p of list.slice(0, 100)) h.remove(p);
    for (const p of list.slice(100, 200)) {
      p.x += 137;
      p.z -= 61;
      h.update(p);
    }
    const live = list.slice(100);
    expect(h.size).toBe(200);
    expect(h.queryCircle(0, 0, 400).map((p) => p.id).sort((a, b) => a - b)).toEqual(brute(0, 0, 400, live));
    expect(h.remove(list[0]!)).toBe(false);
  });
});
