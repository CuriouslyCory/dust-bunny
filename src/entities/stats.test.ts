import { describe, expect, it } from 'vitest';
import { BASE_BUNNY_STATS, computeStats, StatBlock, TIMED_PRIORITY } from './stats';

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

describe('stat caps', () => {
  const caps = { speed: { max: 1.05 }, dashCooldown: { min: 2.5 }, maxHealth: { max: 4 } };

  it('clamps base + Shop + Perks to the cap, then applies timed effects on top', () => {
    const s = computeStats(
      { ...BASE_BUNNY_STATS, speed: 0.8, dashCooldown: 4 },
      [
        { stat: 'speed', op: 'mul', value: 1.15, source: 'upgrade:fast_feet' },
        ...Array.from({ length: 5 }, () => ({ stat: 'speed' as const, op: 'mul' as const, value: 1.1, source: 'perk:aerodynamic' })),
        { stat: 'dashCooldown', op: 'mul', value: 0.5, source: 'perk:quick_dash' },
        { stat: 'speed', op: 'mul', value: 1.5, source: 'pickup:sugar_rush', priority: TIMED_PRIORITY },
      ],
      { caps },
    );
    // 0.8 × 1.15 × 1.1⁵ = 1.48 → capped at 1.05, then Sugar Rush × 1.5 at full strength.
    expect(s.speed).toBeCloseTo(1.05 * 1.5);
    expect(s.dashCooldown).toBe(2.5);
  });

  it('a timed slow still goes below a floor', () => {
    const s = computeStats({ ...BASE_BUNNY_STATS, speed: 1.3 }, [{ stat: 'speed', op: 'mul', value: 0.5, source: 'hazard:wet', priority: TIMED_PRIORITY }], { caps: { speed: { min: 1.2 } } });
    expect(s.speed).toBeCloseTo(0.65);
  });

  it('caps a stat even without modifiers, and global limits still apply last', () => {
    expect(computeStats({ ...BASE_BUNNY_STATS, maxHealth: 6 }, [], { caps }).maxHealth).toBe(4);
    const t = computeStats(BASE_BUNNY_STATS, [{ stat: 'speed', op: 'mul', value: 0.01, source: 'x', priority: TIMED_PRIORITY }], { caps });
    expect(t.speed).toBe(0.1);
  });

  it('honours a custom cap priority', () => {
    const mods = [{ stat: 'speed' as const, op: 'add' as const, value: 1, source: 'late', priority: 150 }];
    expect(computeStats(BASE_BUNNY_STATS, mods, { caps }).speed).toBeCloseTo(1.05);
    expect(computeStats(BASE_BUNNY_STATS, mods, { caps, capPriority: 120 }).speed).toBeCloseTo(2);
  });

  it('StatBlock.atCap ignores timed effects and reads floors', () => {
    const b = new StatBlock({ ...BASE_BUNNY_STATS, speed: 1 }, { caps });
    expect(b.atCap('speed')).toBe(false);
    b.add({ stat: 'speed', op: 'mul', value: 2, source: 'pickup:sugar_rush', priority: TIMED_PRIORITY });
    expect(b.atCap('speed')).toBe(false);
    b.add({ stat: 'speed', op: 'mul', value: 1.05, source: 'perk:aerodynamic' });
    expect(b.atCap('speed')).toBe(true);
    expect(b.atCap('dashCooldown')).toBe(false);
    b.add({ stat: 'dashCooldown', op: 'mul', value: 0.7, source: 'perk:quick_dash' });
    expect(b.atCap('dashCooldown')).toBe(true);
    expect(b.atCap('absorbRatio')).toBe(false);
    expect(b.cap('maxHealth')).toEqual({ max: 4 });
  });
});
