import { afterEach, describe, expect, it } from 'vitest';
import { EventBus } from '../core/events';
import { TUNING } from '../data/tuning';
import { Run } from '../game/run';
import { TIMED_PRIORITY } from '../entities/stats';
import { absorbSystem, canAbsorb, growRadius, magnetSystem } from './absorb';
import { movementSystem } from './movement';

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

describe('magnet pull', () => {
  const chase = TUNING.magnetChase;
  afterEach(() => {
    TUNING.magnetChase = chase;
  });

  /**
   * A boosted Bunny (r 10, Magnet +1, Sugar Rush + maxed Fast Feet speed) Dashes straight away from a crumb at the
   * edge of its field. Only movement, magnet and absorb run, so walls and Hazards don't interfere.
   */
  function dashAway(): boolean {
    const run = new Run(new EventBus(), { seed: 'magnet', characterId: 'lint' });
    run.debris.clear();
    const b = run.bunny;
    b.setRadius(10);
    b.prevX = b.x;
    b.prevZ = b.z;
    b.stats.add({ stat: 'magnetRadius', op: 'add', value: 1, source: 'test', priority: TIMED_PRIORITY });
    b.stats.add({ stat: 'speed', op: 'mul', value: 1.5 * 1.15, source: 'test', priority: TIMED_PRIORITY });
    const i = run.debris.types.findIndex((t) => t.id === 'crumb');
    const crumb = run.debris.spawn(i, b.x - 19, b.z, run.rng, { size: 0.5 })!; // reach is 20
    for (let t = 0; t < 60 && crumb.alive; t++) {
      b.snapshot();
      run.inputState = { moveX: 1, moveZ: 0, dash: t === 0 };
      for (const s of [movementSystem, magnetSystem, absorbSystem]) s.update(1 / 60, run);
    }
    return !crumb.alive;
  }

  it('catches Debris in the field even when the Bunny Dashes away at boosted speed', () => {
    expect(dashAway()).toBe(true);
  });

  it('would leave it behind with a fixed pull speed', () => {
    TUNING.magnetChase = 0;
    expect(dashAway()).toBe(false);
  });
});
