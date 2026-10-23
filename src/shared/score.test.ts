import { describe, expect, it } from 'vitest';
import { bossArrivalRadius } from '../data/hazards';
import { STAT_LIMITS } from '../entities/stats';
import { TIERS, tierForRadius } from '../data/tiers';
import { AREA_ORDER } from '../world/types';
import { AREA_CLEAR_RADIUS, computeAreaScore, computeScore, progressRadius, SCORE_AREA_UNIT, SCORE_AREAS, SCORE_ARRIVAL_RADIUS, SCORE_MAX_TIER, SCORE_TIER_MIN_RADII, scoreTierForRadius } from './score';
import { AREAS } from '../data/areas';

const base = { maxRadius: 10, debrisAbsorbed: 100, tierReached: 3, durationMs: 300_000, victory: false };

describe('computeScore', () => {
  it('combines radius, Debris and Tier', () => {
    expect(computeScore(base)).toBe(1000 + 200 + 2000);
  });

  it('adds a victory bonus that rewards faster wins', () => {
    const win = { ...base, maxRadius: 50, tierReached: 5, victory: true };
    const fast = computeScore({ ...win, durationMs: 400_000 });
    const slow = computeScore({ ...win, durationMs: 800_000 });
    expect(fast - slow).toBe(4000);
    expect(computeScore({ ...win, durationMs: 2_500_000 })).toBe(computeScore({ ...win, victory: false }) + 5000);
  });

  it('is monotonic in each stat', () => {
    expect(computeScore({ ...base, maxRadius: 11 })).toBeGreaterThan(computeScore(base));
    expect(computeScore({ ...base, debrisAbsorbed: 101 })).toBeGreaterThan(computeScore(base));
    expect(computeScore({ ...base, tierReached: 4 })).toBeGreaterThan(computeScore(base));
  });

  it('returns an integer and clamps junk input', () => {
    expect(Number.isInteger(computeScore({ ...base, maxRadius: 1.23456 }))).toBe(true);
    expect(computeScore({ maxRadius: -5, debrisAbsorbed: -1, tierReached: 0, durationMs: 0, victory: false })).toBe(0);
  });
});

describe('difficulty multiplier', () => {
  it('leaves casual (and missing) scores unchanged', () => {
    expect(computeScore({ ...base, difficulty: 'casual' })).toBe(computeScore(base));
    expect(computeScore(base)).toBe(3200);
  });

  it('multiplies arcade and hardcore scores and rounds', () => {
    expect(computeScore({ ...base, difficulty: 'arcade' })).toBe(4000);
    expect(computeScore({ ...base, difficulty: 'hardcore' })).toBe(5120);
    // 101 × 1.25 = 126.25 and 101 × 1.6 = 161.6.
    const odd = { maxRadius: 1.01, debrisAbsorbed: 0, tierReached: 1, durationMs: 0, victory: false };
    expect(computeScore(odd)).toBe(101);
    expect(computeScore({ ...odd, difficulty: 'arcade' })).toBe(126);
    expect(computeScore({ ...odd, difficulty: 'hardcore' })).toBe(162);
  });
});

describe('score tiers', () => {
  it('mirror src/data/tiers.ts', () => {
    expect(SCORE_TIER_MIN_RADII).toEqual(TIERS.map((t) => t.minRadius));
    expect(SCORE_MAX_TIER).toBe(TIERS.length);
  });

  it('match tierForRadius', () => {
    for (const r of [0.5, 1, 2.9, 3, 7.99, 8, 20, 44, 45, 300, 4000, 850_000, 1e6, 4.2e6]) expect(scoreTierForRadius(r)).toBe(tierForRadius(r).index);
  });
});

describe('computeAreaScore', () => {
  const clear = { area: 'house' as const, radiusIn: 1, maxRadius: 51, debrisAbsorbed: 500, durationMs: 600_000 };

  it('scores growth, Debris, the clear and time under par', () => {
    // 5000 growth + 1000 Debris + 3000 clear + (720 − 600) × 10.
    expect(computeAreaScore(clear)).toBe(5000 + 1000 + 3000 + 1200);
    expect(computeAreaScore({ ...clear, durationMs: 900_000 })).toBe(9000);
    expect(computeAreaScore({ ...clear, difficulty: 'hardcore' })).toBe(Math.round(10_200 * 1.6));
  });

  it('uses each Area\'s par', () => {
    const at = (area: 'neighborhood' | 'city') => computeAreaScore({ ...clear, area, durationMs: 0 });
    expect(at('city') - at('neighborhood')).toBe((900 - 600) * 10);
  });
});

describe('score areas', () => {
  it('mirror AREA_ORDER, the boss arrival sizes and the Area units', () => {
    expect([...SCORE_AREAS]).toEqual([...AREA_ORDER]);
    // The smallest boss arrival size: the highest absorb ratio (STAT_LIMITS), rounded down.
    const top = STAT_LIMITS.absorbRatio![1];
    for (const a of SCORE_AREAS) {
      const arrival = bossArrivalRadius(a, top);
      expect(AREA_CLEAR_RADIUS[a], a).toBeLessThanOrEqual(arrival);
      expect(AREA_CLEAR_RADIUS[a], a).toBeGreaterThan(arrival * 0.995);
    }
    for (const a of SCORE_AREAS) expect(SCORE_AREA_UNIT[a]).toBe(AREAS[a].unit);
    for (const a of SCORE_AREAS) expect((SCORE_ARRIVAL_RADIUS as Partial<Record<string, number>>)[a], a).toBe(AREAS[a].arrivalRadius);
  });

  it('scores Continent growth in Continent units (10 km) from the radius after the leap', () => {
    const continent = { area: 'continent' as const, radiusIn: 0.85, maxRadius: 4.05, debrisAbsorbed: 0, durationMs: 360_000 };
    expect(computeAreaScore(continent)).toBe(Math.round(3.2 * 10_000) + 3000);
  });

  it('scores Region growth in Region units (10 m)', () => {
    const region = { area: 'region' as const, radiusIn: 0.9, maxRadius: 4.1, debrisAbsorbed: 0, durationMs: 360_000 };
    expect(computeAreaScore(region)).toBe(Math.round(3.2 * 10_000) + 3000);
  });
});

describe('progressRadius (Run board scale)', () => {
  it('is centimetres up to the City and 100 per Region unit beyond 10 m', () => {
    expect(progressRadius(0)).toBe(0);
    expect(progressRadius(45)).toBe(45);
    expect(progressRadius(1000)).toBe(1000);
    expect(progressRadius(3000)).toBeCloseTo(1200);
    // Scores keep growing with the Bunny, without the Region's metres swamping the board.
    expect(computeScore({ ...base, maxRadius: 4000, tierReached: 11 })).toBeGreaterThan(computeScore({ ...base, maxRadius: 900, tierReached: 9 }));
    expect(computeScore({ ...base, maxRadius: 4000, tierReached: 11 })).toBeLessThan(200_000);
  });

  it('counts nothing for the leap into the Continent, then 100 per Continent unit', () => {
    const region50m = progressRadius(5000);
    expect(region50m).toBeCloseTo(1400);
    // The band between 50 m and the arrival radius (8.5 km) is the leap: no growth.
    expect(progressRadius(100_000)).toBeCloseTo(region50m);
    expect(progressRadius(850_000)).toBeCloseTo(region50m);
    // One Continent unit (10 km) of growth after the leap counts as much as one Region unit (10 m).
    expect(progressRadius(1_850_000) - progressRadius(850_000)).toBeCloseTo(progressRadius(2000) - progressRadius(1000));
    // A Continent win (42 km) out-scores a Region win (42 m), without the kilometres swamping the board.
    const regionWin = computeScore({ ...base, maxRadius: 4200, tierReached: 11 });
    const continentWin = computeScore({ ...base, maxRadius: 4_200_000, tierReached: 13 });
    expect(continentWin).toBeGreaterThan(regionWin);
    expect(continentWin - regionWin).toBeLessThan(80_000);
  });
});
