import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/events';
import { Run } from './run';

const makeRun = (seed = 'test') => {
  const events = new EventBus();
  const run = new Run(events, { seed, characterId: 'lint' });
  return { events, run };
};

describe('Run (headless)', () => {
  it('populates Debris deterministically from the seed', () => {
    const a = makeRun('same').run;
    const b = makeRun('same').run;
    expect(a.debris.count).toBeGreaterThan(500);
    expect(a.debris.count).toBe(b.debris.count);
  });

  it('absorbing Debris grows the Bunny and emits events', () => {
    const { run, events } = makeRun();
    const absorbed: string[] = [];
    let grew = 0;
    events.on('debrisAbsorbed', (e) => absorbed.push(e.typeId));
    events.on('bunnyGrew', () => grew++);
    const b = run.bunny;
    const i = run.debris.types.findIndex((t) => t.id === 'lint_ball');
    const d = run.debris.spawn(i, b.x + b.radius * 0.5, b.z, run.rng, { size: 0.4 })!;
    const r0 = b.radius;
    run.update(1 / 60);
    expect(d.alive).toBe(false);
    expect(absorbed).toContain('lint_ball');
    expect(b.radius).toBeGreaterThan(r0);
    expect(grew).toBeGreaterThan(0);
    expect(run.debrisAbsorbed).toBeGreaterThan(0);
  });

  it('emits tierUp for every Tier crossed', () => {
    const { run, events } = makeRun();
    const tiers: number[] = [];
    events.on('tierUp', (e) => tiers.push(e.tier));
    run.bunny.setRadius(25);
    run.update(1 / 60);
    expect(tiers).toEqual([2, 3, 4]);
    expect(run.tier).toBe(4);
  });

  it('damage → death ends the Run with stats', () => {
    const { run, events } = makeRun();
    let ended: string | null = null;
    events.on('runEnded', (e) => (ended = e.reason));
    const b = run.bunny;
    expect(b.damage(1, 'test')).toBe(true);
    expect(b.damage(1, 'test')).toBe(false); // invulnerable
    b.invulnerable = 0;
    b.damage(10, 'test');
    expect(b.alive).toBe(false);
    expect(ended).toBe('died');
    expect(run.getStats().debrisAbsorbed).toBe(0);
  });
});
