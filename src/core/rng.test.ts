import { describe, expect, it } from 'vitest';
import { hashString, mulberry32, Rng } from './rng';

describe('seeded RNG', () => {
  it('reproduces the same sequence for the same seed', () => {
    const a = new Rng('dusty');
    const b = new Rng('dusty');
    const sa = Array.from({ length: 50 }, () => a.next());
    const sb = Array.from({ length: 50 }, () => b.next());
    expect(sa).toEqual(sb);
    expect(new Rng(42).next()).toBe(mulberry32(42)());
  });

  it('differs between seeds and stays in [0, 1)', () => {
    const a = new Rng('a');
    const b = new Rng('b');
    let same = 0;
    for (let i = 0; i < 100; i++) {
      const x = a.next();
      if (x === b.next()) same++;
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
    expect(same).toBeLessThan(3);
  });

  it('forks independent but deterministic streams', () => {
    const root = new Rng('seed');
    const f1 = root.fork('house').next();
    const f2 = new Rng('seed').fork('house').next();
    expect(f1).toBe(f2);
    expect(root.fork('debris').next()).not.toBe(f1);
  });

  it('int / pick / weighted are deterministic and in range', () => {
    const r = new Rng(7);
    for (let i = 0; i < 200; i++) {
      const n = r.int(2, 5);
      expect(n).toBeGreaterThanOrEqual(2);
      expect(n).toBeLessThanOrEqual(5);
    }
    expect(r.weighted([1, 2, 3], () => 0)).toBeUndefined();
    expect(new Rng(1).weighted(['a', 'b'], (x) => (x === 'b' ? 1 : 0))).toBe('b');
    expect(hashString('abc')).toBe(hashString('abc'));
  });
});
