import { describe, expect, it } from 'vitest';
import { BASE_BUNNY_STATS, computeStats, StatBlock } from './stats';

describe('stat modifiers', () => {
  it('defaults to (base + Σadd) × Πmul regardless of insertion order', () => {
    const a = computeStats(BASE_BUNNY_STATS, [
      { stat: 'speed', op: 'mul', value: 1.5, source: 'x' },
      { stat: 'speed', op: 'add', value: 0.2, source: 'y' },
      { stat: 'speed', op: 'mul', value: 2, source: 'z' },
    ]);
    expect(a.speed).toBeCloseTo((1 + 0.2) * 1.5 * 2);
  });

  it('honours explicit priority (add after mul)', () => {
    const s = computeStats(BASE_BUNNY_STATS, [
      { stat: 'speed', op: 'add', value: 1, source: 'late', priority: 300 },
      { stat: 'speed', op: 'mul', value: 2, source: 'x' },
    ]);
    expect(s.speed).toBeCloseTo(1 * 2 + 1);
  });

  it('stacks the same modifier multiple times', () => {
    const s = computeStats(BASE_BUNNY_STATS, [
      { stat: 'absorbRatio', op: 'add', value: 0.05, source: 'perk:sticky' },
      { stat: 'absorbRatio', op: 'add', value: 0.05, source: 'perk:sticky' },
    ]);
    expect(s.absorbRatio).toBeCloseTo(0.8);
  });

  it('clamps to stat limits', () => {
    const s = computeStats(BASE_BUNNY_STATS, [
      { stat: 'absorbRatio', op: 'add', value: 5, source: 'x' },
      { stat: 'knockbackResistance', op: 'add', value: -3, source: 'y' },
    ]);
    expect(s.absorbRatio).toBe(0.95);
    expect(s.knockbackResistance).toBe(0);
  });

  it('StatBlock supports remove by handle / source and timed expiry', () => {
    const b = new StatBlock({ ...BASE_BUNNY_STATS });
    let changes = 0;
    b.onChange = () => changes++;
    const h = b.add({ stat: 'speed', op: 'mul', value: 1.1, source: 'perk:aero' });
    b.add({ stat: 'speed', op: 'mul', value: 1.5, source: 'pickup:sugar', duration: 8 });
    expect(b.get('speed')).toBeCloseTo(1.65);
    b.tick(7.9);
    expect(b.get('speed')).toBeCloseTo(1.65);
    b.tick(0.2);
    expect(b.get('speed')).toBeCloseTo(1.1);
    expect(b.remove(h)).toBe(true);
    expect(b.get('speed')).toBe(1);
    b.add({ stat: 'growthMultiplier', op: 'mul', value: 2, source: 'pickup:glue' });
    b.add({ stat: 'growthMultiplier', op: 'add', value: 0.15, source: 'pickup:glue' });
    expect(b.removeSource('pickup:glue')).toBe(2);
    expect(b.get('growthMultiplier')).toBe(1);
    expect(changes).toBeGreaterThan(0);
  });
});
