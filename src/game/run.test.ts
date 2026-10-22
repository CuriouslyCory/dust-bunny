import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/events';
import { Run } from './run';
import type { Debris } from '../entities/debris';

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
    const snapshot = (run: Run) => {
      const instances: Debris[] = [];
      run.debris.forEach((d) => instances.push({ ...d }));
      return instances;
    };
    expect(snapshot(a)).toEqual(snapshot(b));
    a.dispose();
    b.dispose();
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

  it('can leave a cleared area from anywhere (the skip button), but not before', () => {
    const { run, events } = makeRun('skip');
    const entered: string[] = [];
    events.on('areaEntered', (e) => entered.push(e.area));
    expect(run.canLeaveArea).toBe(false);
    expect(run.leaveArea()).toBe(false);
    expect(run.area).toBe('house');

    run.openExit(); // the Robo-Vac 9000 fell; the Bunny is nowhere near the front door
    expect(run.canLeaveArea).toBe(true);
    expect(run.leaveArea()).toBe(true);
    expect(run.area).toBe('neighborhood');
    expect(run.canLeaveArea).toBe(false); // the road barrier is still shut

    run.openExit();
    expect(run.leaveArea()).toBe(true);
    expect(run.area).toBe('city');
    expect(run.canLeaveArea).toBe(false); // the highway on-ramp is still shut
    run.openExit(); // the Garbage Truck fell: the on-ramp opens
    expect(run.leaveArea()).toBe(true);
    expect(run.area).toBe('region');
    run.openExit(); // no exit in the last area: the Incinerator wins the Run instead
    expect(run.canLeaveArea).toBe(false);
    expect(run.leaveArea()).toBe(false);
    expect(entered).toEqual(['neighborhood', 'city', 'region']);
  });

  it('re-bases the Bunny into the Region unit on entry, keeping its real size', () => {
    const { run, events } = makeRun('rebase');
    const rebased: number[] = [];
    let grew = 0;
    events.on('bunnyRebased', (e) => rebased.push(e.factor));
    run.bunny.setRadius(850);
    run.tier = 9;
    events.on('bunnyGrew', () => grew++);
    run.enterArea('region');
    expect(run.unit).toBe(1000);
    expect(run.bunny.radius).toBeCloseTo(0.85);
    expect(run.bunny.realRadius).toBeCloseTo(850);
    expect(rebased).toEqual([0.001]);
    expect(grew).toBe(0); // a re-base is not growth
    expect(run.getStats().maxRadius).toBeCloseTo(850);
    expect(run.getStats().areas!.at(-1)!.radiusIn).toBeCloseTo(0.85);
    // Tiers read the real radius: 1 unit (10 m) is Tier 10.
    run.bunny.setRadius(1.01);
    run.update(1 / 60);
    expect(run.tier).toBe(10);
  });

  it('wins the Run when the last Area is cleared (clearArea), and opens the exit before that', () => {
    const { run, events } = makeRun('clear');
    const order: string[] = [];
    events.on('exitOpened', (e) => order.push(`exit:${e.area}`));
    events.on('victory', () => order.push('victory'));
    events.on('runEnded', (e) => order.push(`end:${e.reason}`));
    run.enterArea('city');
    run.clearArea();
    expect(run.cityCleared).toBe(true);
    expect(run.house.exit?.open).toBe(true);
    run.leaveArea();
    run.clearArea();
    expect(order).toEqual(['exit:city', 'victory', 'end:victory']);
    expect(run.getStats()).toMatchObject({ cityCleared: true, regionCleared: true, area: 'region' });
  });

  it('records each Area it plays and emits areaCompleted on leaving a cleared one', () => {
    const { run, events } = makeRun('areas');
    const completed: Array<{ area: string; cleared: boolean; characterId: string }> = [];
    events.on('areaCompleted', (e) => completed.push({ area: e.stats.area, cleared: e.stats.cleared, characterId: e.characterId }));

    run.debrisAbsorbed = 40;
    run.bunny.setRadius(50);
    run.time = 300;
    run.openExit();
    run.leaveArea();
    const house = run.getStats().areas![0]!;
    expect(house).toMatchObject({ area: 'house', startSec: 0, timeSec: 300, maxRadius: 50, debrisAbsorbed: 40, cleared: true });
    expect(completed).toEqual([{ area: 'house', cleared: true, characterId: 'lint' }]);

    run.debrisAbsorbed = 100;
    run.bunny.setRadius(120);
    run.time = 420;
    const now = run.getStats().areas!;
    expect(now).toHaveLength(2);
    expect(now[1]).toMatchObject({ area: 'neighborhood', startSec: 300, timeSec: 120, radiusIn: 50, maxRadius: 120, debrisAbsorbed: 60, cleared: false });

    run.end('died');
    expect(completed).toHaveLength(1); // dying mid-Area completes nothing
  });

  it('counts the City as cleared once its exit opens, and the Region only on victory', () => {
    const events = new EventBus();
    const run = new Run(events, { seed: 'city', characterId: 'zap', area: 'city' });
    expect(run.getStats().areas!.map((a) => a.area)).toEqual(['city']); // a debug start skips the earlier Areas
    expect(run.getStats().areas![0]!.cleared).toBe(false);
    run.openExit();
    expect(run.getStats().areas![0]!.cleared).toBe(true);
    const region = new Run(new EventBus(), { seed: 'region', characterId: 'zap', area: 'region' });
    expect(region.bunny.realRadius).toBeCloseTo(900);
    expect(region.getStats().areas![0]!.cleared).toBe(false);
    region.clearArea();
    expect(region.endReason).toBe('victory');
    expect(region.getStats().areas![0]!.cleared).toBe(true);
  });
});
