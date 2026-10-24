/** Save & quit: a Run's snapshot round-trips through JSON and resumes in the Area it was left in. */
import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/events';
import { tierForRadius } from '../data/tiers';
import { pickupRegistry } from '../pickups';
import { createRun, getHazardDirector } from './assembly';
import type { Run, RunConfig } from './run';
import { parseRunSnapshot, type RunSnapshot } from './snapshot';

const DT = 1 / 60;
const config = (over: Partial<RunConfig> = {}): RunConfig => ({ seed: 'snapshot', characterId: 'tumble', difficulty: 'arcade', ...over });
const step = (run: Run, seconds: number) => {
  for (let i = 0; i < Math.round(seconds / DT) && !run.ended; i++) run.update(DT);
};
/** Through JSON, as localStorage stores it. */
const stored = (s: RunSnapshot): RunSnapshot => parseRunSnapshot(JSON.parse(JSON.stringify(s)))!;
const resume = (s: RunSnapshot, events = new EventBus()) =>
  createRun(events, { seed: s.seed, characterId: s.characterId, difficulty: s.difficulty, modifiers: s.modifiers, loadout: s.loadout, resume: s });

/** A Run in the neighborhood with Perks, a timed Pickup, a hurt Bunny and a pending draft. */
function playedRun(): Run {
  const run = createRun(new EventBus(), config({ modifiers: [{ stat: 'speed', op: 'mul', value: 1.1, source: 'upgrade:fast_feet' }] }));
  step(run, 2);
  run.enterArea('neighborhood');
  step(run, 3);
  run.applyPerk('thick_fur');
  run.applyPerk('aerodynamic');
  run.applyPerk('aerodynamic');
  run.applyPerk('second_wind');
  run.pickups.activate(pickupRegistry.require('sugar_rush'));
  step(run, 1);
  run.bunny.health = 2;
  run.bunny.revives = 0;
  run.bunny.teleport(run.house.spawn.x + 40, run.house.spawn.z - 30);
  run.perkDraft.queue();
  return run;
}

describe('Run snapshot', () => {
  it('each finished Area keeps the Loadout it was left with, through Save & quit', () => {
    const run = createRun(new EventBus(), config({ characterId: 'lint' }));
    step(run, 1);
    run.enterArea('neighborhood');
    expect(run.tuckIn({ type: 'long_strand', rarity: 2 })).toBe(true);
    const back = resume(stored(run.toSnapshot()));
    expect(back.loadout).toEqual([{ type: 'long_strand', rarity: 2 }]);
    back.enterArea('city');
    const areas = back.getStats().areas!;
    expect(areas.map((a) => [a.area, a.loadout])).toEqual([
      ['house', []],
      ['neighborhood', [{ type: 'long_strand', rarity: 2 }]],
      ['city', [{ type: 'long_strand', rarity: 2 }]],
    ]);
  });

  it('resumes in the saved Area with the same Character, Loadout, Perks, Pickups and Bunny', () => {
    const run = playedRun();
    const snap = stored(run.toSnapshot());
    expect(snap).not.toBeNull();
    const back = resume(snap);

    expect(back.area).toBe('neighborhood');
    expect(back.isAreaCleared('house')).toBe(true);
    expect(back.isAreaCleared('neighborhood')).toBe(false);
    expect(back.config.characterId).toBe('tumble');
    expect(back.difficulty.id).toBe('arcade');
    expect(back.loadout).toEqual(run.loadout);
    expect(back.time).toBeCloseTo(run.time);
    expect(back.areaProgress.timeEntered('neighborhood')).toBeCloseTo(run.areaProgress.timeEntered('neighborhood')!);
    expect(back.perkStacks('aerodynamic')).toBe(2);
    expect(back.perkStacks('thick_fur')).toBe(1);
    expect(back.bunny.stats.get('speed')).toBeCloseTo(run.bunny.stats.get('speed'));
    expect(back.bunny.stats.get('maxHealth')).toBe(run.bunny.stats.get('maxHealth'));
    expect(back.bunny.health).toBe(2);
    // Second Wind's charge was spent before the save: re-applying the Perk doesn't refill it.
    expect(back.bunny.revives).toBe(0);
    expect(back.bunny.unit).toBe(run.bunny.unit);
    expect(back.bunny.realRadius).toBeCloseTo(run.bunny.realRadius);
    expect(back.bunny.x).toBeCloseTo(run.bunny.x);
    expect(back.bunny.z).toBeCloseTo(run.bunny.z);
    expect(back.tier).toBe(run.tier);
    expect(back.pickups.active.map((e) => e.def.id)).toEqual(['sugar_rush']);
    expect(back.pickups.active[0]!.remaining).toBeCloseTo(run.pickups.active[0]!.remaining);
    expect(back.perkDraft.pending).toBe(1);
    expect(back.perkDraft.active).toBe(true);
    expect(back.debris.count).toBeGreaterThan(0);
    // The Area's stats carry on: the house as done, the neighborhood from when it was entered.
    const stats = back.getStats();
    expect(stats.areas?.map((a) => a.area)).toEqual(['house', 'neighborhood']);
    expect(stats.areas?.[1]?.startSec).toBeCloseTo(run.areaProgress.timeEntered('neighborhood')!);
    expect(stats.perks.filter((p) => p === 'aerodynamic')).toHaveLength(2);
    expect(tierForRadius(back.bunny.realRadius).index).toBe(back.tier);
  });

  it('keeps playing after a resume, and the resumed Run can be saved again', () => {
    const back = resume(stored(playedRun().toSnapshot()));
    back.perkDraft.choose(back.perkDraft.offer.perks[0]!.id);
    step(back, 3);
    expect(back.ended).toBe(false);
    const again = resume(stored(back.toSnapshot()));
    expect(again.area).toBe('neighborhood');
    expect(again.time).toBeCloseTo(back.time);
  });

  it('emits no perkApplied, areaEntered or tierUp while restoring', () => {
    const snap = stored(playedRun().toSnapshot());
    const events = new EventBus();
    const seen: string[] = [];
    for (const k of ['perkApplied', 'areaEntered', 'tierUp', 'exitOpened', 'areaCompleted'] as const) events.on(k, () => seen.push(k));
    resume(snap, events);
    expect(seen).toEqual([]);
  });

  it('a cleared Area resumes with its exit open and no boss coming back', () => {
    const run = createRun(new EventBus(), config({ area: 'neighborhood' }));
    step(run, 1);
    run.openExit();
    const back = resume(stored(run.toSnapshot()));
    expect(back.isAreaCleared('neighborhood')).toBe(true);
    expect(back.house.exit?.open).toBe(true);
    expect(back.canLeaveArea).toBe(true);
    // Even at boss size the director doesn't bring the absorbed boss back.
    back.bunny.setRadius(back.bunny.radius * 40);
    // Well past the boss's arrival delay (4 s).
    step(back, 6);
    expect(getHazardDirector(back)?.bossSpawned).toBe(false);
  });

  it('does not place fixed Debris that was absorbed before the save again', () => {
    const run = createRun(new EventBus(), config({ area: 'solar_system' }));
    const first = run.house.debrisPlacements[0]!;
    const d = run.debris.query(first.x, first.z, 1, []).find((x) => x.type.id === first.typeId)!;
    expect(d).toBeDefined();
    run.absorbDebris(d);
    const snap = stored(run.toSnapshot());
    expect(snap.placementsGone).toContain(0);
    const back = resume(snap);
    expect(back.debris.query(first.x, first.z, 1, []).some((x) => x.type.id === first.typeId)).toBe(false);
    // Saving the resumed Run again still remembers it.
    expect(back.toSnapshot().placementsGone).toContain(0);
  });

  it('does not count fixed Debris that was removed without being absorbed as gone', () => {
    const run = createRun(new EventBus(), config({ area: 'solar_system' }));
    const first = run.house.debrisPlacements[0]!;
    const d = run.debris.query(first.x, first.z, 1, []).find((x) => x.type.id === first.typeId)!;
    expect(d).toBeDefined();
    run.debris.remove(d);
    expect(run.toSnapshot().placementsGone).not.toContain(0);
  });

  it('rejects snapshots it cannot resume', () => {
    const good = JSON.parse(JSON.stringify(playedRun().toSnapshot()));
    expect(parseRunSnapshot(good)).not.toBeNull();
    expect(parseRunSnapshot(null)).toBeNull();
    expect(parseRunSnapshot('nope')).toBeNull();
    expect(parseRunSnapshot({ ...good, version: 99 })).toBeNull();
    expect(parseRunSnapshot({ ...good, characterId: 'nobody' })).toBeNull();
    expect(parseRunSnapshot({ ...good, area: 'moon' })).toBeNull();
    expect(parseRunSnapshot({ ...good, bunny: { ...good.bunny, realRadius: 'big' } })).toBeNull();
    expect(parseRunSnapshot({ ...good, perks: { aerodynamic: 'two' } })).toBeNull();
  });
});
