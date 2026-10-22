import { describe, expect, it } from 'vitest';
import { getTier, MAX_TIER, TIERS, tierForRadius, tierProgress } from './tiers';

describe('tiers', () => {
  it('has the five house thresholds, two neighborhood ones, two city ones and two region ones (real cm)', () => {
    expect(TIERS.map((t) => t.minRadius)).toEqual([1, 3, 8, 20, 45, 75, 160, 320, 600, 1000, 3000]);
    expect(TIERS.map((t) => t.name)).toEqual([
      'Speck',
      'Fluff',
      'Tumbleweed',
      'Dust Devil',
      'Dust Titan',
      'Dust Storm',
      'Dust Cyclone',
      'Dust Hurricane',
      'Dust Colossus',
      'Dust Sprawl',
      'Dust Front',
    ]);
    expect(MAX_TIER).toBe(11);
  });

  it('looks up the Tier for a radius (thresholds inclusive)', () => {
    expect(tierForRadius(0.5).index).toBe(1);
    expect(tierForRadius(1).index).toBe(1);
    expect(tierForRadius(2.99).index).toBe(1);
    expect(tierForRadius(3).index).toBe(2);
    expect(tierForRadius(8).index).toBe(3);
    expect(tierForRadius(19.9).index).toBe(3);
    expect(tierForRadius(20).index).toBe(4);
    expect(tierForRadius(45).index).toBe(5);
    expect(tierForRadius(74.9).index).toBe(5);
    expect(tierForRadius(75).index).toBe(6);
    expect(tierForRadius(300).index).toBe(7);
    expect(tierForRadius(320).index).toBe(8);
    expect(tierForRadius(999).index).toBe(9);
    expect(tierForRadius(1000).index).toBe(10);
    expect(tierForRadius(3000).index).toBe(11);
    expect(tierForRadius(50_000).index).toBe(11);
  });

  it('reports progress towards the next Tier', () => {
    expect(tierProgress(1)).toBe(0);
    expect(tierProgress(2)).toBeCloseTo(0.5);
    expect(tierProgress(14)).toBeCloseTo(0.5);
    expect(tierProgress(60)).toBeCloseTo(0.5);
    expect(tierProgress(2000)).toBeCloseTo(0.5);
    expect(tierProgress(50_000)).toBe(1);
  });

  it('camera scale rises each Tier so Tier-up pulls the camera back', () => {
    for (let i = 1; i < TIERS.length; i++) expect(TIERS[i]!.cameraScale).toBeGreaterThan(TIERS[i - 1]!.cameraScale);
    expect(getTier(99).index).toBe(11);
    expect(getTier(0).index).toBe(1);
  });
});
