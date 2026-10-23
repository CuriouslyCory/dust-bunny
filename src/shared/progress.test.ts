import { describe, expect, it } from 'vitest';
import { UPGRADES } from '../data/upgrades';
import { defaultSave } from '../meta/save';
import { BOUNDS as LEADERBOARD_BOUNDS } from './leaderboard';
import { compareProgress, isEmptyProgress, mergeUniverses, PROGRESS_BOUNDS, sameProgress, validateProgress, type Progress } from './progress';

const p = (over: Partial<Progress> = {}, stats: Partial<Progress['stats']> = {}): Progress => ({
  fluff: 50,
  upgrades: { fast_feet: 1 },
  characters: {},
  universes: 0,
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
    ['negative universes', p({ universes: -1 }), 'universes'],
    ['fractional universes', p({ universes: 1.5 }), 'universes'],
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
    expect(isEmptyProgress({ fluff: 0, upgrades: {}, characters: {}, universes: 0, stats: { runs: 0, wins: 0, bestRadius: 0, bestTier: 0, totalFluffEarned: 0, keepsakesEarned: 0 } })).toBe(true);
    expect(isEmptyProgress(p())).toBe(false);
    expect(sameProgress(p({ upgrades: { a: 1, b: 2 } }), p({ upgrades: { b: 2, a: 1 } }))).toBe(true);
    expect(sameProgress(p(), p({ fluff: 51 }))).toBe(false);
    expect(sameProgress(p(), p({ upgrades: { fast_feet: 1, magnetism: 1 } }))).toBe(false);
  });
});

describe('universes', () => {
  it('reads a missing field as 0, compares it in sameProgress but not compareProgress, and merges to the max', () => {
    const { universes: _, ...old } = p();
    expect(validateProgress(old)).toEqual({ ok: true, value: p() });
    expect(validateProgress(p({ universes: 3 }))).toEqual({ ok: true, value: p({ universes: 3 }) });
    expect(sameProgress(p({ universes: 1 }), p())).toBe(false);
    expect(compareProgress(p({ universes: 5 }), p())).toBe(0);
    expect(isEmptyProgress(p({ fluff: 0, upgrades: {}, universes: 1 }, { runs: 0, totalFluffEarned: 0 }))).toBe(false);
    expect(mergeUniverses(2, 5)).toBe(5);
    expect(mergeUniverses(4, undefined)).toBe(4);
  });
});

describe('characters (Keepsake Hoards)', () => {
  const hoards = { lint: { hoard: { 'thick_clog:common': 4, 'reclaim:rare': 1 }, bossesBeaten: ['robovac_9000', 'street_sweeper'] } };

  it('accepts Hoards, drops empty cells and Characters, and reads a missing field as {}', () => {
    const v = validateProgress(p({ characters: { ...hoards, zap: { hoard: { 'arc:epic': 0 }, bossesBeaten: [] } } }));
    expect(v).toEqual({ ok: true, value: p({ characters: hoards }) });
    const { characters: _c, ...older } = p();
    const old = validateProgress(older);
    expect(old.ok && old.value.characters).toEqual({});
    // Older bundles also lack stats.keepsakesEarned.
    const { keepsakesEarned: _k, ...oldStats } = p().stats;
    const o2 = validateProgress({ ...older, stats: oldStats });
    expect(o2.ok && o2.value.stats.keepsakesEarned).toBe(0);
  });

  it('converts Hoard keys from before rarities (grades 1–10, two to a rarity), adding their counts', () => {
    // A stored row from before rarities, as production held it.
    const v = validateProgress(p({ characters: { zap: { hoard: { 'arc:5': 1, 'live_wire:1': 1, 'live_wire:2': 1, 'static_cling:9': 60, 'static_cling:10': 60 }, bossesBeaten: ['ice_sheet'] } } }));
    expect(v.ok && v.value.characters).toEqual({ zap: { hoard: { 'arc:epic': 1, 'live_wire:common': 2, 'static_cling:mythic': 99 }, bossesBeaten: ['ice_sheet'] } });
  });

  it.each([
    ['unknown character', { bob: { hoard: {}, bossesBeaten: [] } }, 'characters'],
    ['prototype key', JSON.parse('{"constructor": {"hoard": {}, "bossesBeaten": []}}') as unknown, 'characters'],
    ["another character's type", { lint: { hoard: { 'arc:common': 1 }, bossesBeaten: [] } }, 'characters.lint.hoard'],
    ['an unknown rarity', { lint: { hoard: { 'reclaim:ultra': 1 }, bossesBeaten: [] } }, 'characters.lint.hoard'],
    ['old grade 11', { lint: { hoard: { 'reclaim:11': 1 }, bossesBeaten: [] } }, 'characters.lint.hoard'],
    ['old grade 01', { lint: { hoard: { 'reclaim:01': 1 }, bossesBeaten: [] } }, 'characters.lint.hoard'],
    ['count over 99', { lint: { hoard: { 'reclaim:common': 100 }, bossesBeaten: [] } }, 'characters.lint.hoard'],
    ['fractional count', { lint: { hoard: { 'reclaim:common': 1.5 }, bossesBeaten: [] } }, 'characters.lint.hoard'],
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
    const reordered = { lint: { hoard: { 'reclaim:rare': 1, 'thick_clog:common': 4 }, bossesBeaten: ['street_sweeper', 'robovac_9000'] } };
    expect(sameProgress(a, p({ characters: reordered }))).toBe(true);
    expect(sameProgress(a, p())).toBe(false);
    expect(sameProgress(a, p({ characters: { lint: { ...hoards.lint, hoard: { 'thick_clog:common': 1, 'thick_clog:rare': 1, 'reclaim:rare': 1 } } } }))).toBe(false);
    // Felting changes the Hoard (and spends Fluff) but no lifetime counter.
    expect(compareProgress(a, p({ fluff: 0 }))).toBe(0);
    expect(isEmptyProgress(p({ fluff: 0, upgrades: {}, characters: hoards }, { runs: 0, totalFluffEarned: 0 }))).toBe(false);
  });
});

describe('loadouts (remembered Loadouts)', () => {
  const loadouts = { lint: [{ type: 'reclaim', rarity: 2 }, { type: 'reclaim', rarity: 2 }], zap: [{ type: 'arc', rarity: 5 }] };

  it('accepts Loadouts, drops empty ones, converts old slots and leaves a missing field undefined', () => {
    expect(validateProgress(p({ loadouts: { ...loadouts, tumble: [] } }))).toEqual({ ok: true, value: p({ loadouts }) });
    const v = validateProgress(p());
    expect(v.ok && 'loadouts' in v.value).toBe(false);
    const old = validateProgress({ ...p(), loadouts: { tumble: [{ type: 'snowball', grade: 6 }] } });
    expect(old.ok && old.value.loadouts).toEqual({ tumble: [{ type: 'feast', rarity: 3 }] });
  });

  it.each([
    ['unknown character', { bob: [] }, 'loadouts'],
    ['array', [], 'loadouts'],
    ["another character's type", { lint: [{ type: 'arc', rarity: 1 }] }, 'loadouts.lint'],
    ['three slots', { lint: [{ type: 'reclaim', rarity: 1 }, { type: 'reclaim', rarity: 1 }, { type: 'reclaim', rarity: 1 }] }, 'loadouts.lint'],
    ['rarity 6', { lint: [{ type: 'reclaim', rarity: 6 }] }, 'loadouts.lint'],
  ])('rejects %s', (_, raw, field) => {
    const v = validateProgress({ ...p(), loadouts: raw });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.field).toBe(field);
  });

  it('compares Loadouts (slot order counts; missing reads as none) in sameProgress but not in compareProgress', () => {
    const a = p({ loadouts: { lint: [{ type: 'reclaim', rarity: 1 }, { type: 'thick_clog', rarity: 1 }] } });
    expect(sameProgress(a, p({ loadouts: { lint: [{ type: 'reclaim', rarity: 1 }, { type: 'thick_clog', rarity: 1 }] } }))).toBe(true);
    expect(sameProgress(a, p({ loadouts: { lint: [{ type: 'thick_clog', rarity: 1 }, { type: 'reclaim', rarity: 1 }] } }))).toBe(false);
    expect(sameProgress(a, p())).toBe(false);
    expect(sameProgress(p({ loadouts: {} }), p())).toBe(true);
    expect(compareProgress(a, p())).toBe(0);
  });
});
