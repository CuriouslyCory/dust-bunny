import { describe, expect, it } from 'vitest';
import { canAbsorb, growRadius } from './absorb';

describe('absorb rule', () => {
  it('absorbs Debris up to radius × absorbRatio', () => {
    expect(canAbsorb(10, 0.7, 7)).toBe(true);
    expect(canAbsorb(10, 0.7, 6.99)).toBe(true);
    expect(canAbsorb(10, 0.7, 7.01)).toBe(false);
  });

  it('respects a modified absorb ratio', () => {
    expect(canAbsorb(10, 0.75, 7.4)).toBe(true);
    expect(canAbsorb(10, 0.65, 6.8)).toBe(false);
  });
});

describe('growth formula', () => {
  it('adds volume: r = cbrt(r³ + gf × gm × mass × size³)', () => {
    expect(growRadius(1, 1, 1, 1, 1)).toBeCloseTo(Math.cbrt(2), 10);
    expect(growRadius(2, 1, 2, 1.5, 0.5)).toBeCloseTo(Math.cbrt(8 + 0.5 * 1.5 * 2 * 1), 10);
  });

  it('never shrinks and is monotonic in size and multipliers', () => {
    const base = growRadius(5, 1, 1, 1, 0.2);
    expect(base).toBeGreaterThan(5);
    expect(growRadius(5, 2, 1, 1, 0.2)).toBeGreaterThan(base);
    expect(growRadius(5, 1, 2, 1, 0.2)).toBeGreaterThan(base);
    expect(growRadius(5, 1, 1, 2, 0.2)).toBeGreaterThan(base);
    expect(growRadius(5, 0, 1, 1, 0.2)).toBe(5);
  });

  it('is order independent (volume is additive)', () => {
    const a = growRadius(growRadius(3, 1, 1, 1, 0.3), 2, 1, 1, 0.3);
    const b = growRadius(growRadius(3, 2, 1, 1, 0.3), 1, 1, 1, 0.3);
    expect(a).toBeCloseTo(b, 10);
  });
});
