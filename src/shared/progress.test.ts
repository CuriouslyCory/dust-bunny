import { describe, expect, it } from 'vitest';
import { UPGRADES } from '../data/upgrades';
import { defaultSave } from '../meta/save';
import { BOUNDS as LEADERBOARD_BOUNDS } from './leaderboard';
import { compareProgress, isEmptyProgress, PROGRESS_BOUNDS, sameProgress, validateProgress, type Progress } from './progress';

const p = (over: Partial<Progress> = {}, stats: Partial<Progress['stats']> = {}): Progress => ({
  fluff: 50,
  upgrades: { fast_feet: 1 },
  characters: {},
  ...over,
  stats: { runs: 3, wins: 0, bestRadius: 12.5, bestTier: 3, totalFluffEarned: 90, keepsakesEarned: 0, ...stats },
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
    expect(validateProgress({ fluff: fresh.fluff, upgrades: fresh.upgrades, characters: fresh.characters, stats: fresh.stats }).ok).toBe(true);
  });

  it('accepts any best radius the leaderboard accepts (a Globe Run reaches millions of cm)', () => {
    expect(validateProgress(p({}, { bestRadius: 6_711_310, bestTier: 13 })).ok).toBe(true);
    expect(PROGRESS_BOUNDS.bestRadius).toBe(LEADERBOARD_BOUNDS.maxRadius.max);
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
    ['huge radius', p({}, { bestRadius: PROGRESS_BOUNDS.bestRadius * 1.01 }), 'stats.bestRadius'],
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
    expect(isEmptyProgress({ fluff: 0, upgrades: {}, characters: {}, stats: { runs: 0, wins: 0, bestRadius: 0, bestTier: 0, totalFluffEarned: 0, keepsakesEarned: 0 } })).toBe(true);
    expect(isEmptyProgress(p())).toBe(false);
    expect(sameProgress(p({ upgrades: { a: 1, b: 2 } }), p({ upgrades: { b: 2, a: 1 } }))).toBe(true);
    expect(sameProgress(p(), p({ fluff: 51 }))).toBe(false);
    expect(sameProgress(p(), p({ upgrades: { fast_feet: 1, magnetism: 1 } }))).toBe(false);
  });
});

describe('characters (Keepsake Hoards)', () => {
  const hoards = { lint: { hoard: { 'thick_clog:1': 4, 'reclaim:2': 1 }, bossesBeaten: ['robovac_9000', 'street_sweeper'] } };

  it('accepts Hoards, drops empty cells and Characters, and reads a missing field as {}', () => {
    const v = validateProgress(p({ characters: { ...hoards, zap: { hoard: { 'arc:3': 0 }, bossesBeaten: [] } } }));
    expect(v).toEqual({ ok: true, value: p({ characters: hoards }) });
    const { characters: _c, ...older } = p();
    const old = validateProgress(older);
    expect(old.ok && old.value.characters).toEqual({});
    // Older bundles also lack stats.keepsakesEarned.
    const { keepsakesEarned: _k, ...oldStats } = p().stats;
    const o2 = validateProgress({ ...older, stats: oldStats });
    expect(o2.ok && o2.value.stats.keepsakesEarned).toBe(0);
  });

  it.each([
    ['unknown character', { bob: { hoard: {}, bossesBeaten: [] } }, 'characters'],
    ['prototype key', JSON.parse('{"constructor": {"hoard": {}, "bossesBeaten": []}}') as unknown, 'characters'],
    ["another character's type", { lint: { hoard: { 'arc:1': 1 }, bossesBeaten: [] } }, 'characters.lint.hoard'],
    ['grade 11', { lint: { hoard: { 'reclaim:11': 1 }, bossesBeaten: [] } }, 'characters.lint.hoard'],
    ['grade 01', { lint: { hoard: { 'reclaim:01': 1 }, bossesBeaten: [] } }, 'characters.lint.hoard'],
    ['count over 99', { lint: { hoard: { 'reclaim:1': 100 }, bossesBeaten: [] } }, 'characters.lint.hoard'],
    ['fractional count', { lint: { hoard: { 'reclaim:1': 1.5 }, bossesBeaten: [] } }, 'characters.lint.hoard'],
    ['missing bossesBeaten', { lint: { hoard: {} } }, 'characters.lint'],
    ['bad boss id', { lint: { hoard: {}, bossesBeaten: ['Robo Vac'] } }, 'characters.lint.bossesBeaten'],
    ['array', [], 'characters'],
  ])('rejects %s', (_, characters, field) => {
    const v = validateProgress({ ...p(), characters });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.field).toBe(field);
  });

  it('compares Hoards in sameProgress but not in compareProgress', () => {
    const a = p({ characters: hoards });
    const reordered = { lint: { hoard: { 'reclaim:2': 1, 'thick_clog:1': 4 }, bossesBeaten: ['street_sweeper', 'robovac_9000'] } };
    expect(sameProgress(a, p({ characters: reordered }))).toBe(true);
    expect(sameProgress(a, p())).toBe(false);
    expect(sameProgress(a, p({ characters: { lint: { ...hoards.lint, hoard: { 'thick_clog:1': 1, 'thick_clog:2': 1, 'reclaim:2': 1 } } } }))).toBe(false);
    // Felting changes the Hoard (and spends Fluff) but no lifetime counter.
    expect(compareProgress(a, p({ fluff: 0 }))).toBe(0);
    expect(isEmptyProgress(p({ fluff: 0, upgrades: {}, characters: hoards }, { runs: 0, totalFluffEarned: 0 }))).toBe(false);
  });
});
