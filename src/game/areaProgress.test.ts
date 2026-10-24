import { describe, expect, it } from 'vitest';
import { AREA_ORDER } from '../world/types';
import { AreaProgress, clearedFlag } from './areaProgress';

describe('Area progress', () => {
  it('names the flat fields RunStats and CreditStats carry', () => {
    expect(AREA_ORDER.map(clearedFlag)).toEqual([
      'houseCleared',
      'neighborhoodCleared',
      'cityCleared',
      'regionCleared',
      'continentCleared',
      'globeCleared',
      'solarSystemCleared',
      'galaxyCleared',
      'universeCleared',
    ]);
  });

  it('entering an Area clears every earlier one and records when (never for the first)', () => {
    const p = new AreaProgress();
    p.enter('house', 0);
    expect(p.entryTimes()).toEqual({});
    p.enter('region', 12);
    expect(AREA_ORDER.filter((a) => p.isCleared(a))).toEqual(['house', 'neighborhood', 'city']);
    expect(p.timeEntered('region')).toBe(12);
    expect(p.timeEntered('city')).toBeNull();
    expect(p.furthestCleared()).toBe('city');
    p.clear('region');
    expect(p.furthestCleared()).toBe('region');
    expect(Object.keys(p.clearedFlags())).toEqual(AREA_ORDER.map(clearedFlag));
  });

  it('is a black hole while the Galaxy counts as cleared; rewinding undoes it', () => {
    const p = new AreaProgress();
    p.enter('galaxy', 5);
    expect(p.blackHole).toBe(false);
    p.enter('universe', 9);
    expect(p.blackHole).toBe(true);
    p.rewindTo('city', 11);
    expect(p.blackHole).toBe(false);
    expect(p.isCleared('city')).toBe(false);
    expect(p.isCleared('neighborhood')).toBe(true);
    expect(p.entryTimes()).toEqual({ city: 11 });
  });

  it('resumes from a snapshot and reads flat flags back', () => {
    const p = new AreaProgress();
    p.resume('globe', { neighborhood: 1, globe: 7, house: 3, atlantis: 4 });
    expect(p.entryTimes()).toEqual({ neighborhood: 1, globe: 7 });
    expect(p.furthestCleared()).toBe('continent');
    const q = AreaProgress.fromFlags({ houseCleared: true, galaxyCleared: true, cityCleared: false });
    expect(q.furthestCleared()).toBe('galaxy');
    expect(q.furthestCleared((a) => a !== 'galaxy')).toBe('house');
    expect(AreaProgress.fromFlags({}).furthestCleared()).toBeNull();
  });
});
