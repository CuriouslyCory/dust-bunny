import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/events';
import { AREAS } from '../data/areas';
import { tierForRadius } from '../data/tiers';
import { createRun } from '../game/assembly';
import { RunPosts } from '../ui/leaderboard/posting';
import type { LeaderboardClient } from '../net/leaderboard';
import { AREA_ORDER } from '../world/types';
import { addPerk, cheatsFor, cheatsUnlocked, isCheatCode, massAt, massRange, massT, maxAllPerks, setMass, unlockCheats, warpTo } from './cheats';

const makeRun = () => {
  const events = new EventBus();
  const run = createRun(events, { seed: 'cheats', characterId: 'lint' });
  return { events, run };
};

describe('cheat code', () => {
  it('is 6767123 (spaces ignored)', () => {
    expect(isCheatCode('6767123')).toBe(true);
    expect(isCheatCode(' 676 7123 ')).toBe(true);
    expect(isCheatCode('6767124')).toBe(false);
    expect(isCheatCode('')).toBe(false);
  });

  it('emits cheatsUnlocked once per Run', () => {
    const { events, run } = makeRun();
    let n = 0;
    events.on('cheatsUnlocked', () => n++);
    expect(cheatsUnlocked(run)).toBe(false);
    unlockCheats(events, run);
    unlockCheats(events, run);
    expect(n).toBe(1);
    expect(cheatsUnlocked(run)).toBe(true);
    run.dispose();
  });
});

describe('mass', () => {
  it('covers each Act from below its first Tier to past its last', () => {
    for (const area of AREA_ORDER) {
      const { min, max } = massRange(area);
      const [lo, hi] = AREAS[area].tiers;
      expect(tierForRadius(min * AREAS[area].unit).index).toBeLessThan(lo === 1 ? 2 : lo);
      expect(tierForRadius(max * AREAS[area].unit).index).toBe(hi);
    }
  });

  it('maps the slider logarithmically and back', () => {
    const range = massRange('house');
    expect(massAt(range, 0)).toBeCloseTo(range.min);
    expect(massAt(range, 1)).toBeCloseTo(range.max);
    expect(massAt(range, 0.5)).toBeCloseTo(Math.sqrt(range.min * range.max));
    expect(massT(range, massAt(range, 0.3))).toBeCloseTo(0.3);
  });

  it('clamps to the Act and moves the Tier both ways without a Perk draft', () => {
    const { events, run } = makeRun();
    let tierUps = 0;
    events.on('tierUp', () => tierUps++);
    setMass(run, 1e6);
    expect(run.bunny.radius).toBeCloseTo(massRange('house').max);
    expect(run.tier).toBe(5);
    setMass(run, 0);
    expect(run.bunny.radius).toBeCloseTo(massRange('house').min);
    expect(run.tier).toBe(1);
    run.update(1 / 60);
    expect(tierUps).toBe(0);
    expect(run.perkDraft.pending).toBe(0);
    run.dispose();
  });
});

describe('warp', () => {
  it('jumps forward, clearing the Acts skipped', () => {
    const { run } = makeRun();
    warpTo(run, 'globe');
    expect(run.area).toBe('globe');
    expect(run.isAreaCleared('house')).toBe(true);
    expect(run.isAreaCleared('continent')).toBe(true);
    expect(run.isAreaCleared('globe')).toBe(false);
    expect(run.tier).toBe(tierForRadius(run.bunny.realRadius).index);
    run.dispose();
  });

  it('jumps back, un-clearing that Act and the ones after it, at its start size', () => {
    const { run } = makeRun();
    warpTo(run, 'universe');
    expect(run.bunny.form).toBe('black_hole');
    warpTo(run, 'neighborhood');
    expect(run.area).toBe('neighborhood');
    expect(run.bunny.unit).toBe(AREAS.neighborhood.unit);
    expect(run.isAreaCleared('house')).toBe(true);
    expect(run.isAreaCleared('neighborhood')).toBe(false);
    expect(run.isAreaCleared('galaxy')).toBe(false);
    expect(run.bunny.form).toBe('dust');
    const { min, max } = massRange('neighborhood');
    expect(run.bunny.radius).toBeGreaterThanOrEqual(min);
    expect(run.bunny.radius).toBeLessThanOrEqual(max);
    expect(run.tier).toBe(tierForRadius(run.bunny.realRadius).index);
    // The house again: its own Debris grid and the starting size.
    warpTo(run, 'house');
    expect(run.area).toBe('house');
    expect(run.bunny.radius).toBe(run.bunny.stats.get('startRadius'));
    expect(run.tier).toBe(1);
    expect(run.debris.count).toBeGreaterThan(500);
    run.update(1 / 60);
    run.dispose();
  });
});

describe('perks and switches', () => {
  it('adds Perks up to their limits', () => {
    const { run } = makeRun();
    expect(addPerk(run, 'second_wind')).toBe(true);
    expect(addPerk(run, 'second_wind')).toBe(false);
    maxAllPerks(run);
    expect(run.perkStacks('glutton')).toBe(5);
    expect(maxAllPerks(run)).toBe(0);
    run.dispose();
  });

  it('Hypoallergenic blocks damage; Zoomies speeds up and switches off cleanly', () => {
    const { run } = makeRun();
    const c = cheatsFor(run);
    const b = run.bunny;
    const hp = b.health;
    c.setInvincible(true);
    expect(b.damage(1, 'test')).toBe(false);
    expect(b.health).toBe(hp);
    c.setInvincible(false);
    expect(b.damage(1, 'test')).toBe(true);
    const speed = b.stats.get('speed');
    c.setZoomies(true);
    expect(b.stats.get('speed')).toBeCloseTo(speed * 2.5);
    c.setZoomies(true);
    expect(b.stats.get('speed')).toBeCloseTo(speed * 2.5);
    c.setZoomies(false);
    expect(b.stats.get('speed')).toBeCloseTo(speed);
    run.dispose();
  });
});

describe('leaderboard entries after cheats', () => {
  it('turn waiting entries invalid and keep posted ones', () => {
    const client = {} as LeaderboardClient;
    const posts = new RunPosts(client, 'lint', 'casual');
    const area = (name: 'house' | 'neighborhood') => ({ area: name, startSec: 0, timeSec: 60, radiusIn: 1, maxRadius: 40, debrisAbsorbed: 10, cleared: true });
    posts.addArea(area('house'));
    expect(posts.get('house')?.state).toBe('unsent');
    posts.unrank('runs played with cheats are not ranked.');
    expect(posts.ranked).toBe(false);
    expect(posts.get('house')?.state).toBe('invalid');
    posts.addArea(area('neighborhood'));
    expect(posts.get('neighborhood')?.state).toBe('invalid');
    expect(posts.pending).toBe(false);
  });
});
