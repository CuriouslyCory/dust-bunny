import { describe, expect, it } from 'vitest';
import { UPGRADES } from '../data/upgrades';
import { defaultSave } from '../meta/save';
import { compareProgress, isEmptyProgress, PROGRESS_BOUNDS, sameProgress, validateProgress, type Progress } from './progress';

const p = (over: Partial<Progress> = {}, stats: Partial<Progress['stats']> = {}): Progress => ({
  fluff: 50,
  upgrades: { fast_feet: 1 },
  ...over,
  stats: { runs: 3, wins: 0, bestRadius: 12.5, bestTier: 3, totalFluffEarned: 90, ...stats },
});

describe('validateProgress', () => {
  it('accepts a normal save and drops zero levels', () => {
    const v = validateProgress(p({ upgrades: { fast_feet: 2, magnetism: 0 } }));
    expect(v).toEqual({ ok: true, value: p({ upgrades: { fast_feet: 2 } }) });
  });

  it('accepts every real Upgrade id at max level, and a fresh save', () => {
    const upgrades = Object.fromEntries(UPGRADES.map((u) => [u.id, u.maxLevel]));
    expect(validateProgress(p({ upgrades })).ok).toBe(true);
    const fresh = defaultSave();
    expect(validateProgress({ fluff: fresh.fluff, upgrades: fresh.upgrades, stats: fresh.stats }).ok).toBe(true);
  });

  it.each([
    ['not an object', 'x', 'body'],
    ['negative fluff', p({ fluff: -1 }), 'fluff'],
    ['fractional fluff', p({ fluff: 1.5 }), 'fluff'],
    ['huge fluff', p({ fluff: PROGRESS_BOUNDS.fluff + 1 }), 'fluff'],
    ['upgrades array', { ...p(), upgrades: [] }, 'upgrades'],
    ['bad upgrade id', p({ upgrades: { 'Bad Id': 1 } }), 'upgrades'],
    ['bad level', p({ upgrades: { fast_feet: 1.2 } }), 'upgrades'],
    ['too many upgrades', p({ upgrades: Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`u${i}`, 1])) }), 'upgrades'],
    ['missing stats', { fluff: 1, upgrades: {} }, 'stats'],
    ['wins above runs', p({}, { wins: 4 }), 'stats.wins'],
    ['NaN radius', p({}, { bestRadius: Number.NaN }), 'stats.bestRadius'],
    ['string total', p({}, { totalFluffEarned: '9' as unknown as number }), 'stats.totalFluffEarned'],
  ])('rejects %s', (_, body, field) => {
    const v = validateProgress(body);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.field).toBe(field);
  });
});

describe('progress comparison', () => {
  it('orders by lifetime Fluff, then Runs', () => {
    expect(compareProgress(p({}, { totalFluffEarned: 100 }), p({}, { totalFluffEarned: 90 }))).toBeGreaterThan(0);
    expect(compareProgress(p({}, { totalFluffEarned: 90, runs: 2 }), p({}, { totalFluffEarned: 90, runs: 3 }))).toBeLessThan(0);
    // Spending changes neither counter.
    expect(compareProgress(p({ fluff: 0, upgrades: { fast_feet: 3 } }), p())).toBe(0);
  });

  it('detects empty and equal saves', () => {
    expect(isEmptyProgress({ fluff: 0, upgrades: {}, stats: { runs: 0, wins: 0, bestRadius: 0, bestTier: 0, totalFluffEarned: 0 } })).toBe(true);
    expect(isEmptyProgress(p())).toBe(false);
    expect(sameProgress(p({ upgrades: { a: 1, b: 2 } }), p({ upgrades: { b: 2, a: 1 } }))).toBe(true);
    expect(sameProgress(p(), p({ fluff: 51 }))).toBe(false);
    expect(sameProgress(p(), p({ upgrades: { fast_feet: 1, magnetism: 1 } }))).toBe(false);
  });
});
