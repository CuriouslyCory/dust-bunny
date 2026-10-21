import { describe, expect, it } from 'vitest';
import { TIERS, tierForRadius } from '../data/tiers';
import { computeScore, SCORE_MAX_TIER, SCORE_TIER_MIN_RADII, scoreTierForRadius } from './score';

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
    expect(computeScore({ ...win, durationMs: 2_200_000 })).toBe(computeScore({ ...win, victory: false }) + 5000);
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
    for (const r of [0.5, 1, 2.9, 3, 7.99, 8, 20, 44, 45, 300]) expect(scoreTierForRadius(r)).toBe(tierForRadius(r).index);
  });
});
