import { describe, expect, it } from 'vitest';
import { PROGRESS_BOUNDS } from './progress';
import { CREDITED_RUNS_MAX, CREDIT_STATS_BOUNDS, MAX_RUN_CREDIT_BYTES, pickCreditStats, salvageCreditStats, sameCreditedRuns, validateCreditedRuns, validateRunCreditClaim } from './runCredit';
import { SCORE_TIER_MIN_RADII } from './score';

const fullStats = {
  seed: 's',
  characterId: 'lint',
  difficulty: 'arcade',
  timeSec: 120,
  maxRadius: 350,
  finalRadius: 300,
  debrisAbsorbed: 420,
  hazardsAbsorbed: 3,
  tierReached: 6,
  tierTimes: { 1: 0, 2: 10 },
  perks: ['sticky'],
  area: 'neighborhood',
  houseCleared: true,
  neighborhoodCleared: false,
  areas: [
    { area: 'house', startSec: 0, timeSec: 60, radiusIn: 1, maxRadius: 200, debrisAbsorbed: 300, cleared: true, loadout: [{ type: 'reclaim', rarity: 1 }] },
    { area: 'neighborhood', startSec: 60, timeSec: 60, radiusIn: 200, maxRadius: 350, debrisAbsorbed: 120, cleared: false },
  ],
  loadout: [{ type: 'reclaim', rarity: 1 }],
};

describe('pickCreditStats', () => {
  it('keeps only what crediting reads, and drops the rest', () => {
    expect(pickCreditStats(fullStats)).toEqual({
      characterId: 'lint',
      difficulty: 'arcade',
      maxRadius: 350,
      debrisAbsorbed: 420,
      tierReached: 6,
      area: 'neighborhood',
      houseCleared: true,
      areas: [
        { area: 'house', radiusIn: 1, maxRadius: 200, debrisAbsorbed: 300, cleared: true },
        { area: 'neighborhood', radiusIn: 200, maxRadius: 350, debrisAbsorbed: 120, cleared: false },
      ],
    });
  });

  it('needs the three numbers, in range, and bounded Areas', () => {
    expect(pickCreditStats({ maxRadius: 1, debrisAbsorbed: 0, tierReached: 0 })).toEqual({ maxRadius: 1, debrisAbsorbed: 0, tierReached: 0 });
    expect(pickCreditStats({ maxRadius: 1, debrisAbsorbed: 0 })).toBeNull();
    expect(pickCreditStats({ maxRadius: -1, debrisAbsorbed: 0, tierReached: 0 })).toBeNull();
    expect(pickCreditStats({ maxRadius: 1, debrisAbsorbed: 0, tierReached: CREDIT_STATS_BOUNDS.tier + 1 })).toBeNull();
    expect(pickCreditStats({ maxRadius: 1, debrisAbsorbed: 0, tierReached: 0, areas: [{ area: 'house', radiusIn: 1, maxRadius: 'big', debrisAbsorbed: 0 }] })).toBeNull();
    const many = Array.from({ length: CREDIT_STATS_BOUNDS.areas + 1 }, () => ({ area: 'house', radiusIn: 1, maxRadius: 1, debrisAbsorbed: 0, cleared: false }));
    expect(pickCreditStats({ maxRadius: 1, debrisAbsorbed: 0, tierReached: 0, areas: many })).toBeNull();
    expect(pickCreditStats(null)).toBeNull();
    expect(pickCreditStats([])).toBeNull();
  });

  it('accepts a Universe-sized Run: radii are real centimetres', () => {
    // A Universe Run's maxRadius is past 2.8e25 cm; the bound is the cloud save's (`bestRadius`).
    expect(CREDIT_STATS_BOUNDS.radius).toBe(PROGRESS_BOUNDS.bestRadius);
    const universe = { maxRadius: SCORE_TIER_MIN_RADII[SCORE_TIER_MIN_RADII.length - 1]! * 1.2, debrisAbsorbed: 2_000_000, tierReached: SCORE_TIER_MIN_RADII.length, area: 'universe', universeCleared: true,
      areas: [{ area: 'galaxy', radiusIn: 9.461e19, maxRadius: 2.8e20, debrisAbsorbed: 5000, cleared: true }, { area: 'universe', radiusIn: 9.461e24, maxRadius: 2.9e25, debrisAbsorbed: 7000, cleared: true }] };
    expect(pickCreditStats(universe)).toEqual(universe);
    expect(validateRunCreditClaim({ runKey: 'u', lease: 'l', reason: 'victory', stats: universe })).toMatchObject({ ok: true });
    expect(pickCreditStats({ ...universe, maxRadius: CREDIT_STATS_BOUNDS.radius * 10 })).toBeNull();
  });

  it('salvages what it can from stats it would otherwise refuse', () => {
    expect(salvageCreditStats(fullStats)).toEqual(pickCreditStats(fullStats));
    expect(salvageCreditStats(null)).toEqual({ maxRadius: 0, debrisAbsorbed: 0, tierReached: 0 });
    // A missing or absurd number is 0 or clamped, not a reason to lose the rest.
    expect(salvageCreditStats({ maxRadius: Infinity, debrisAbsorbed: -3, tierReached: 500, characterId: 'zap' })).toEqual({ maxRadius: 0, debrisAbsorbed: 0, tierReached: CREDIT_STATS_BOUNDS.tier, characterId: 'zap' });
    // Areas that read stay; the broken one goes; the list is capped.
    const many = Array.from({ length: CREDIT_STATS_BOUNDS.areas + 3 }, (_, i) => ({ area: 'house', radiusIn: 1, maxRadius: i, debrisAbsorbed: 0, cleared: false }));
    expect(salvageCreditStats({ maxRadius: 5, debrisAbsorbed: 1, tierReached: 1, areas: [{ area: '', radiusIn: 1 }, ...many] }).areas).toHaveLength(CREDIT_STATS_BOUNDS.areas);
    expect(salvageCreditStats({ maxRadius: 5, debrisAbsorbed: 1, tierReached: 1, areas: [{ area: 'house', radiusIn: 'x', maxRadius: 2, debrisAbsorbed: 1, cleared: true }] }).areas).toEqual([{ area: 'house', radiusIn: 0, maxRadius: 2, debrisAbsorbed: 1, cleared: true }]);
  });

  it('stays small whatever the client sent', () => {
    const bloated = { ...fullStats, perks: Array.from({ length: 5000 }, (_, i) => `perk-${i}`) };
    expect(JSON.stringify(pickCreditStats(bloated)).length).toBeLessThan(MAX_RUN_CREDIT_BYTES / 4);
  });
});

describe('validateRunCreditClaim', () => {
  const claim = { runKey: 'run-1', lease: 'a1', reason: 'died', stats: fullStats };

  it('accepts a claim and picks its stats', () => {
    const v = validateRunCreditClaim(claim);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.value.runKey).toBe('run-1');
      expect(v.value.prevLease).toBeUndefined();
      expect(v.value.stats).toEqual(pickCreditStats(fullStats));
    }
    const prev = validateRunCreditClaim({ ...claim, prevLease: 'a0', reason: 'quit' });
    expect(prev.ok && prev.value.prevLease).toBe('a0');
  });

  it.each([
    ['no runKey', { ...claim, runKey: '' }, 'runKey'],
    ['no lease', { ...claim, lease: 7 }, 'lease'],
    ['bad prevLease', { ...claim, prevLease: '' }, 'prevLease'],
    ['bad reason', { ...claim, reason: 'won' }, 'reason'],
    ['no stats', { ...claim, stats: { maxRadius: 1 } }, 'stats'],
  ])('rejects %s', (_, body, field) => {
    const v = validateRunCreditClaim(body);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.field).toBe(field);
  });
});

describe('creditedRuns', () => {
  it('reads missing as unknown, dedupes, and caps the count', () => {
    expect(validateCreditedRuns(undefined)).toEqual({ ok: true, value: undefined });
    expect(validateCreditedRuns(['a', 'b', 'a'])).toEqual({ ok: true, value: ['a', 'b'] });
    expect(validateCreditedRuns('a').ok).toBe(false);
    expect(validateCreditedRuns(['a', '']).ok).toBe(false);
    expect(validateCreditedRuns(Array.from({ length: CREDITED_RUNS_MAX }, (_, i) => `r${i}`)).ok).toBe(true);
    expect(validateCreditedRuns(Array.from({ length: CREDITED_RUNS_MAX + 1 }, (_, i) => `r${i}`)).ok).toBe(false);
  });

  it('compares as a set, with missing counting as the same', () => {
    expect(sameCreditedRuns(['a', 'b'], ['b', 'a'])).toBe(true);
    expect(sameCreditedRuns(['a'], ['a', 'b'])).toBe(false);
    expect(sameCreditedRuns(undefined, ['a'])).toBe(true);
    expect(sameCreditedRuns([], ['a'])).toBe(false);
  });
});
