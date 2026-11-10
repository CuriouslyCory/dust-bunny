import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import { BIN_MS, FrameHistogram, MAX_MS, Stat } from './frameHistogram';

/** Exact percentile of a sorted list (linear between ranks), to compare with the histogram's. */
function exact(sorted: number[], p: number): number {
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.min(sorted.length - 1, lo + 1);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (rank - lo);
}

const fill = (values: number[]): FrameHistogram => {
  const h = new FrameHistogram();
  for (const v of values) h.add(v);
  return h;
};

describe('FrameHistogram', () => {
  it('is empty at first', () => {
    const h = new FrameHistogram();
    expect(h.count).toBe(0);
    expect(h.percentile(50)).toBeNaN();
    expect(h.toJSON()).toMatchObject({ count: 0, bins: [] });
  });

  it('gives a single value back for every percentile', () => {
    const h = fill([16.7]);
    for (const p of [0, 1, 50, 95, 99, 100]) expect(h.percentile(p)).toBeCloseTo(16.7, 6);
    expect(h.minMs).toBe(16.7);
    expect(h.maxMs).toBe(16.7);
  });

  it('p0 and p100 are the exact min and max', () => {
    const h = fill([3.1, 12.34, 40.05, 99.99]);
    expect(h.percentile(0)).toBe(3.1);
    expect(h.percentile(100)).toBe(99.99);
  });

  it('stays within one bin of the exact percentile on uniform data', () => {
    const rng = new Rng('uniform');
    const values = Array.from({ length: 20_000 }, () => rng.range(4, 60));
    const h = fill(values);
    const sorted = [...values].sort((a, b) => a - b);
    for (const p of [1, 10, 25, 50, 75, 90, 95, 99]) expect(Math.abs(h.percentile(p) - exact(sorted, p))).toBeLessThan(BIN_MS);
  });

  it('stays within one bin on bimodal data (vsync frames plus hitches)', () => {
    const rng = new Rng('bimodal');
    const values = Array.from({ length: 10_000 }, (_, i) => (i % 10 === 0 ? rng.range(30, 45) : rng.range(16.4, 17)));
    const h = fill(values);
    const sorted = [...values].sort((a, b) => a - b);
    for (const p of [50, 85, 91, 95, 99]) expect(Math.abs(h.percentile(p) - exact(sorted, p))).toBeLessThan(BIN_MS);
  });

  it('reports percentiles in the overflow as MAX_MS, keeping the exact max', () => {
    const h = fill([...Array.from({ length: 90 }, () => 16), ...Array.from({ length: 10 }, () => 400)]);
    expect(h.overflow).toBe(10);
    expect(h.percentile(50)).toBeLessThan(16 + BIN_MS);
    expect(h.percentile(95)).toBe(MAX_MS);
    expect(h.percentile(100)).toBe(400);
    expect(h.maxMs).toBe(400);
  });

  it('counts frames over 33 and 50 ms strictly', () => {
    const h = fill([33, 33.01, 50, 50.01, 16.7]);
    expect(h.over33).toBe(3);
    expect(h.over50).toBe(1);
  });

  it('treats negative times as 0', () => {
    const h = fill([-1]);
    expect(h.percentile(50)).toBe(0);
  });

  it('merges into the same histogram as adding everything to one', () => {
    const rng = new Rng('merge');
    const a = Array.from({ length: 3000 }, () => rng.range(0, 140));
    const b = Array.from({ length: 2000 }, () => rng.range(8, 30));
    const merged = fill(a);
    merged.merge(fill(b));
    expect(merged.toJSON()).toEqual(fill([...a, ...b]).toJSON());
  });

  it('keeps a fixed size however many frames it sees', () => {
    const h = new FrameHistogram();
    const rng = new Rng('memory');
    const bins = h.bins;
    for (let i = 0; i < 1_000_000; i++) h.add(rng.range(0, 200));
    expect(h.count).toBe(1_000_000);
    expect(h.bins).toBe(bins);
    expect(h.bins.length).toBe(MAX_MS / BIN_MS);
    expect(h.toJSON().bins.length).toBeLessThanOrEqual(MAX_MS / BIN_MS);
  });

  it('stores bins sparsely as [index, count] pairs', () => {
    const json = fill([0.1, 0.2, 16.7, 16.7]).toJSON();
    expect(json.bins).toEqual([
      [0, 2],
      [Math.floor(16.7 / BIN_MS), 2],
    ]);
  });
});

describe('Stat', () => {
  it('keeps count, mean, min and max', () => {
    const s = new Stat();
    expect(s.toJSON()).toEqual({ count: 0, mean: null, min: null, max: null });
    for (const v of [10, 30, 20]) s.add(v);
    expect(s.toJSON()).toEqual({ count: 3, mean: 20, min: 10, max: 30 });
  });

  it('merges', () => {
    const a = new Stat();
    const b = new Stat();
    a.add(1);
    b.add(5);
    b.add(3);
    a.merge(b);
    expect(a.toJSON()).toEqual({ count: 3, mean: 3, min: 1, max: 5 });
  });
});
