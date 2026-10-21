import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/events';
import { Rng } from '../core/rng';
import { TUNING } from '../data/tuning';
import { Run } from '../game/run';
import { installRunHooks } from '../meta/install';
import { upgradeModifiers } from '../meta/upgrades';
import { pickupRegistry } from '../pickups';
import { registerPickups } from '../pickups/pickups';
import { availablePerks, perkRegistry } from './index';
import { draftForRun, draftPerks, rerollDraft, rerollsLeft } from './draft';
import { registerPerks } from './perks';

registerPerks();
registerPickups();

const makeRun = (upgrades: Record<string, number> = {}, characterId = 'lint') => {
  const events = new EventBus();
  const run = new Run(events, { seed: 'perks', characterId, modifiers: upgradeModifiers(upgrades) });
  installRunHooks(run);
  return { run, events };
};

describe('Perk draft', () => {
  it('registers all 12 design Perks', () => {
    expect(perkRegistry.all()).toHaveLength(12);
  });

  it('offers 3 distinct Perks, or 4 with Wide Choice', () => {
    for (let i = 0; i < 20; i++) {
      const { run } = makeRun();
      const a = draftForRun(run);
      expect(a).toHaveLength(3);
      expect(new Set(a.map((p) => p.id)).size).toBe(3);
    }
    const { run } = makeRun({ wide_choice: 1 });
    expect(draftForRun(run)).toHaveLength(4);
  });

  it('never offers an owned unique or a maxed Perk', () => {
    const { run } = makeRun();
    run.applyPerk('second_wind');
    run.applyPerk('spiky_dash');
    for (let i = 0; i < 3; i++) run.applyPerk('quick_dash');
    const ids = availablePerks(run).map((p) => p.id);
    expect(ids).not.toContain('second_wind');
    expect(ids).not.toContain('spiky_dash');
    expect(ids).not.toContain('quick_dash');
    for (let i = 0; i < 50; i++) {
      const offer = draftForRun(run).map((p) => p.id);
      expect(offer).not.toContain('second_wind');
      expect(offer).not.toContain('quick_dash');
    }
  });

  it('returns fewer cards when the pool is small', () => {
    const pool = perkRegistry.all().slice(0, 2);
    expect(draftPerks(pool, 4, new Rng(1))).toHaveLength(2);
    expect(draftPerks([], 3, new Rng(1))).toEqual([]);
  });

  it('rerolls only when the Reroll Upgrade is owned, avoiding the current offer', () => {
    const plain = makeRun().run;
    expect(rerollDraft(plain, draftForRun(plain))).toBeNull();

    const { run } = makeRun({ reroll: 1 });
    expect(rerollsLeft(run)).toBe(1);
    const first = draftForRun(run);
    const second = rerollDraft(run, first)!;
    expect(second).toHaveLength(3);
    for (const p of second) expect(first.map((f) => f.id)).not.toContain(p.id);
    expect(rerollsLeft(run)).toBe(0);
    expect(rerollDraft(run, second)).toBeNull();
  });
});

describe('combat hooks', () => {
  it('Bubble Wrap blocks exactly one hit', () => {
    const { run, events } = makeRun();
    let blocked = 0;
    events.on('shieldBlocked', () => blocked++);
    run.pickups.activate(pickupRegistry.require('bubble_wrap'));
    expect(run.bunny.damage(1, 'roomba')).toBe(false);
    expect(blocked).toBe(1);
    expect(run.bunny.health).toBe(3);
    run.bunny.invulnerable = 0;
    expect(run.bunny.damage(1, 'roomba')).toBe(true);
    expect(run.bunny.health).toBe(2);
  });

  it('Bubble Wrap stacks up to 3 charges', () => {
    const { run } = makeRun();
    const wrap = pickupRegistry.require('bubble_wrap');
    for (let i = 0; i < 5; i++) run.pickups.activate(wrap);
    expect(run.bunny.shield).toBe(3);
    for (let i = 0; i < 3; i++) {
      run.bunny.invulnerable = 0;
      expect(run.bunny.damage(1, 'roomba')).toBe(false);
    }
    run.bunny.invulnerable = 0;
    expect(run.bunny.damage(1, 'roomba')).toBe(true);
    expect(run.bunny.shield).toBe(0);
  });

  it('Dust Cloud hides the Bunny until it expires', () => {
    const { run } = makeRun();
    run.pickups.activate(pickupRegistry.require('dust_cloud'));
    expect(run.bunny.hiddenFromHazards).toBe(true);
    expect(run.bunny.damage(1, 'roomba')).toBe(false);
    for (let t = 0; t < 6.1 * 60; t++) run.update(1 / 60);
    expect(run.bunny.hiddenFromHazards).toBe(false);
  });

  it('Second Wind turns one lethal hit into a full heal', () => {
    const { run, events } = makeRun({}, 'zap');
    let revived = 0;
    events.on('bunnyRevived', () => revived++);
    run.applyPerk('second_wind');
    run.bunny.damage(1, 'x');
    run.bunny.invulnerable = 0;
    expect(run.bunny.damage(1, 'x')).toBe(false);
    expect(revived).toBe(1);
    expect(run.bunny.health).toBe(2);
    expect(run.ended).toBe(false);
    run.bunny.invulnerable = 0;
    run.bunny.damage(5, 'x');
    expect(run.ended).toBe(true);
  });

  it('Regrowth heals over time', () => {
    const { run } = makeRun();
    run.applyPerk('regrowth');
    run.bunny.damage(1, 'x');
    expect(run.bunny.health).toBe(2);
    for (let t = 0; t < 45.1 * 60; t++) run.update(1 / 60);
    expect(run.bunny.health).toBe(3);
  });

  it('Spiky Dash cancels damage while dashing', () => {
    const { run } = makeRun();
    run.applyPerk('spiky_dash');
    run.bunny.dashTime = 0.2;
    expect(run.bunny.damage(1, 'roomba')).toBe(false);
    run.bunny.dashTime = 0;
    run.bunny.invulnerable = 0;
    expect(run.bunny.damage(1, 'roomba')).toBe(true);
  });
});

describe('Pickups', () => {
  it('timed Pickups refresh instead of stacking, scaled by Hoarder', () => {
    const { run } = makeRun();
    const sugar = pickupRegistry.require('sugar_rush');
    run.pickups.activate(sugar);
    run.pickups.activate(sugar);
    expect(run.bunny.stats.get('speed')).toBeCloseTo(1.5);
    expect(run.pickups.active).toHaveLength(1);
    run.applyPerk('hoarder');
    run.pickups.activate(sugar);
    expect(run.pickups.active[0]!.duration).toBeCloseTo(8 * 1.4);
    for (let t = 0; t < 11.3 * 60; t++) run.update(1 / 60);
    expect(run.pickups.active).toHaveLength(0);
    expect(run.bunny.stats.get('speed')).toBeCloseTo(1);
  });

  it('Crumb Cake heals; the director spawns floor Pickups over time', () => {
    const { run } = makeRun({ pickup_luck: 2 });
    run.bunny.damage(1, 'x');
    run.pickups.activate(pickupRegistry.require('crumb_cake'));
    expect(run.bunny.health).toBe(3);
    let spawned = 0;
    run.events.on('pickupSpawned', () => spawned++);
    run.bunny.invulnerable = TUNING.invulnerability;
    for (let t = 0; t < 40 * 60; t++) run.update(1 / 60);
    expect(spawned).toBeGreaterThan(0);
  });
});
