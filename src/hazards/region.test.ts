import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/events';
import { rect } from '../core/math';
import { bossArrivalRadius, AREA_BOSSES, AREA_DIRECTORS, CITY_DIRECTOR, CROP_DUSTER, DIRECTOR, DIRECTOR_EXCLUDE, FREIGHT_TRAIN, INCINERATOR, MINI_COMPACTOR, NEIGHBORHOOD_DIRECTOR, REGION_DIRECTOR, RIVER_BARGE, tierValue } from '../data/hazards';
import { getTier } from '../data/tiers';
import { getHazardDirector, installGameplay } from '../game/assembly';
import { Run } from '../game/run';
import { REGION } from '../world/region';
import type { AreaId } from '../world/types';
import { absorbRadiusFor, setLure, type Lure } from './common';
import { spawnWeights } from './director';
import { hazardRegistry, type Hazard } from './index';
import type { Mop } from './mop';
import { type RoboVac9000 } from './robovac';
import type { SprayBottle } from './sprayBottle';
import type { UprightVacuum } from './uprightVacuum';

const REGION_HAZARDS = ['landfill_compactor', 'snowplow', 'freight_train', 'crop_duster', 'river_barge', 'water_bomber'];
const BOSS_IDS = ['incinerator', 'mini_compactor'];

/** A Run in the Region (placeholder field, 200 × 150 units of 10 m); the Bunny starts at r ≈ 0.9 units. */
const makeRun = (seed = 'region-hazards') => {
  const events = new EventBus();
  const run = new Run(events, { seed, characterId: 'lint', area: 'region' });
  return { events, run };
};

/** Bunny radius (Region units) at the start of a Tier. */
const tierRadius = (run: Run, tier: number) => getTier(tier).minRadius / run.unit;

/** Puts the Bunny in the middle of the map (open field, whatever the layout). */
function moveToCentre(run: Run): void {
  const bd = run.house.bounds;
  run.bunny.teleport((bd.minX + bd.maxX) / 2, (bd.minZ + bd.maxZ) / 2);
}

function firstTableTier(id: string, area: AreaId): number {
  const { firstTier, tiers } = AREA_DIRECTORS[area];
  const i = tiers.findIndex((t) => id in t.types);
  if (i < 0) throw new Error(`${id} is not in the ${area} spawn tables`);
  return firstTier + i;
}

const step = (run: Run, seconds: number) => {
  for (let i = 0; i < 60 * seconds && !run.ended; i++) run.update(1 / 60);
};

describe('region Hazards', () => {
  it('run in Region units (1 = 10 m)', () => {
    const { run } = makeRun();
    expect(run.unit).toBe(1000);
    expect(run.bunny.radius).toBeCloseTo(REGION.debugStartRadius);
  });

  it('are a threat on arrival in the region and absorbable before the Incinerator is', () => {
    const tier11 = getTier(11).minRadius / 1000;
    const boss = absorbRadiusFor(INCINERATOR.size, 0.7);
    for (const id of REGION_HAZARDS) {
      const { run } = makeRun(`absorb-${id}`);
      moveToCentre(run);
      const h = run.hazards.spawn(id, run.bunny.x + 12, run.bunny.z);
      expect(h.dead, id).toBeFalsy();
      const need = absorbRadiusFor(h.size, 0.7);
      expect(need, id).toBeGreaterThan(REGION.debugStartRadius);
      const first = firstTableTier(id, 'region');
      expect(need, id).toBeGreaterThan(tierRadius(run, first));
      expect(need, id).toBeLessThan(boss);
      // Tier 10 Hazards are food by early Tier 11; the Tier 11 newcomers before the boss.
      if (first === 10) expect(need, id).toBeLessThan(tier11 * 1.1);
    }
    expect(absorbRadiusFor(MINI_COMPACTOR.size, 0.7)).toBeLessThan(tier11);
    expect(hazardRegistry.require('incinerator').boss).toBe(true);
  });


  it('region spawn tables only list region Hazards, trains and water bombers from Tier 11, and never the boss or its minis', () => {
    for (let t = REGION_DIRECTOR.firstTier; t <= 11; t++) {
      const ids = Object.keys(spawnWeights(t, {}, 'region'));
      expect(ids.length).toBeGreaterThan(0);
      for (const id of ids) expect(REGION_HAZARDS).toContain(id);
    }
    // The Bunny arrives at Tier 9 and uses the Tier 10 table.
    expect(Object.keys(spawnWeights(9, {}, 'region'))).toEqual(Object.keys(spawnWeights(10, {}, 'region')));
    for (const id of ['freight_train', 'water_bomber']) {
      expect(Object.keys(spawnWeights(10, {}, 'region'))).not.toContain(id);
      expect(Object.keys(spawnWeights(11, {}, 'region'))).toContain(id);
    }
    for (const id of BOSS_IDS) expect(DIRECTOR_EXCLUDE).toContain(id);
    for (const t of [...DIRECTOR.tiers, ...NEIGHBORHOOD_DIRECTOR.tiers, ...CITY_DIRECTOR.tiers]) for (const id of REGION_HAZARDS) expect(Object.keys(t.types)).not.toContain(id);
    expect(tierValue(FREIGHT_TRAIN.speed, 9)).toBe(FREIGHT_TRAIN.speed[9]);
    expect(tierValue(FREIGHT_TRAIN.speed, 11)).toBe(FREIGHT_TRAIN.speed[10]);
  });

  it('the director spawns region Hazards (never earlier areas’ ones) and brings the Incinerator at its arrival size', () => {
    const { run, events } = makeRun('region-director');
    installGameplay(run);
    const spawned: string[] = [];
    const bosses: string[] = [];
    events.on('hazardSpawned', (e) => spawned.push(e.defId));
    events.on('bossSpawned', (e) => bosses.push(e.name));
    run.bunny.health = 999;
    step(run, 30);
    expect(spawned.length).toBeGreaterThan(0);
    // Late in Tier 10 the alive budget is up to 4 (2 at its start).
    run.bunny.setRadius(bossArrivalRadius('region', run.bunny.stats.get('absorbRatio')) * 0.95);
    step(run, 60);
    expect(spawned.length).toBeGreaterThan(2);
    expect(bosses).toEqual([]);

    run.bunny.setRadius(bossArrivalRadius('region', run.bunny.stats.get('absorbRatio')) * 1.02);
    step(run, AREA_BOSSES.region.arrivalDelay + 1);
    expect(bosses).toEqual(['Incinerator']);
    expect(run.hazards.count('incinerator')).toBe(1);
    for (const id of spawned) expect([...REGION_HAZARDS, ...BOSS_IDS]).toContain(id);
    // Hazards spawn just outside the view: in Region units, not hundreds of units away.
    const b = run.bunny;
    for (const h of run.hazards.hazards) expect(Math.hypot(h.x - b.x, h.z - b.z), h.def.id).toBeLessThan(150);
  });

  it('places the River Barge in river zones when the map has one', () => {
    const { run } = makeRun('barge-zone');
    installGameplay(run);
    const director = getHazardDirector(run)!;
    // A single river strip across the map (the map's own river reaches are taken out).
    const bd = run.house.bounds;
    const river = rect(bd.minX, 60, bd.maxX, 80);
    run.house.rooms = run.house.rooms.filter((r) => r.type !== 'river');
    run.house.rooms.unshift({ id: 'river', type: 'river', rect: river, floor: 'water' } as (typeof run.house.rooms)[number]);
    run.bunny.teleport(100, 40);
    const fp = hazardRegistry.require('river_barge').footprint;
    for (let i = 0; i < 20; i++) {
      const spot = director.findSpot(run, fp.radius, fp.height, 10, 60, hazardRegistry.require('river_barge').spawnZones);
      expect(spot).not.toBeNull();
      expect(spot!.z).toBeGreaterThanOrEqual(60);
      expect(spot!.z).toBeLessThanOrEqual(80);
    }
    // Without a river zone in the layout it is placed anywhere it fits.
    run.house.rooms.shift();
    expect(director.findSpot(run, fp.radius, fp.height, 10, 30, ['river'])).not.toBeNull();
  });

  it('the Landfill Compactor pulls the Bunny in', () => {
    const { run } = makeRun('compactor');
    moveToCentre(run);
    const b = run.bunny;
    const h = run.hazards.spawn('landfill_compactor', b.x + b.radius + 1.3, b.z);
    h.x = b.x + b.radius + 1.3;
    (h as unknown as { yaw: number }).yaw = Math.PI / 2; // driving away (+X)
    const x0 = b.x;
    for (let i = 0; i < 10; i++) run.hazards.update(1 / 60, run);
    expect(b.x).toBeGreaterThan(x0 + 0.05);
  });

  for (const id of ['snowplow', 'freight_train']) {
    it(`a ${id} hit knocks the Bunny off its lane and sheds mass (no sticking)`, () => {
      const { run, events } = makeRun(`lane-${id}`);
      moveToCentre(run);
      const b = run.bunny;
      const h = run.hazards.spawn(id, b.x + 4, b.z);
      expect(h.dead).toBeFalsy();
      let shed = 0;
      events.on('bunnyShed', (e) => e.source === id && shed++);
      const r0 = b.radius;
      h.onContact!(run);
      expect(b.health).toBe(b.maxHealth - 1);
      expect(shed).toBe(1);
      expect(b.radius).toBeLessThan(r0);
      expect(b.rooted).toBe(0);
    });
  }

  it('the Crop Duster fires from on screen and its pesticide soaks the Bunny', () => {
    const { run } = makeRun('duster');
    moveToCentre(run);
    const b = run.bunny;
    const speed0 = b.stats.get('speed');
    // Above the Bunny on screen (−Z is up), well inside range.
    const h = run.hazards.spawn('crop_duster', b.x, b.z - 5) as SprayBottle;
    expect(tierValue(CROP_DUSTER.range, run.tier)).toBeGreaterThan(5);
    let hit = false;
    let flying = 0;
    for (let i = 0; i < 60 * 8 && !hit; i++) {
      run.hazards.update(1 / 60, run);
      flying = Math.max(flying, h.droplets.length);
      hit = b.health < b.maxHealth;
    }
    expect(hit).toBe(true);
    expect(flying).toBeGreaterThan(0);
    expect(b.stats.get('speed')).toBeLessThan(speed0);
  });

  it("the River Barge's wide wake slows the Bunny", () => {
    const { run } = makeRun('barge');
    moveToCentre(run);
    const b = run.bunny;
    const speed0 = b.stats.get('speed');
    const h = run.hazards.spawn('river_barge', b.x + 12, b.z) as Mop;
    for (let i = 0; i < 60 * 4; i++) run.hazards.update(1 / 60, run);
    expect(h.puddles.length).toBeGreaterThan(3);
    expect(b.stats.get('speed')).toBe(speed0);
    const p = h.puddles.reduce((far, q) => (Math.hypot(q.x - h.x, q.z - h.z) > Math.hypot(far.x - h.x, far.z - h.z) ? q : far));
    expect(Math.hypot(p.x - h.x, p.z - h.z)).toBeGreaterThan(RIVER_BARGE.size + b.radius);
    b.teleport(p.x, p.z);
    run.hazards.update(1 / 60, run);
    expect(b.stats.get('speed')).toBeCloseTo(speed0 * RIVER_BARGE.slowMultiplier);
  });

  it("the Water Bomber's blast pushes the Bunny away and soaks it", () => {
    const { run } = makeRun('bomber');
    moveToCentre(run);
    const b = run.bunny;
    const speed0 = b.stats.get('speed');
    const h = run.hazards.spawn('water_bomber', b.x + 6, b.z) as UprightVacuum;
    h.yaw = -Math.PI / 2; // nozzle (+Z model forward) facing the Bunny (−X)
    h.state = 'on';
    const d0 = Math.hypot(b.x - h.x, b.z - h.z);
    for (let i = 0; i < 20; i++) run.hazards.update(1 / 60, run);
    expect(Math.hypot(b.x - h.x, b.z - h.z)).toBeGreaterThan(d0 + 0.5);
    expect(b.stats.get('speed')).toBeLessThan(speed0);
    expect(h.ranged).toBe(true);
  });

  it('the Incinerator hunts, summons mini compactors, is stunned when a charge hits the map edge and takes a hit', () => {
    const { run, events } = makeRun('incinerator-hunt');
    const b = run.bunny;
    b.health = 999;
    // Mid Tier 10: too small to absorb it by size.
    b.setRadius(tierRadius(run, 10) * 2);
    // Close to the east edge, so a charge at the Bunny ends in the ridge.
    const home = { x: run.house.bounds.maxX - 10, z: 75 };
    b.teleport(home.x, home.z);
    const boss = run.hazards.spawn('incinerator', b.x - 30, b.z) as RoboVac9000;
    const d0 = Math.hypot(boss.x - b.x, boss.z - b.z);
    let minis = 0;
    let stuns = 0;
    let closest = d0;
    events.on('hazardSpawned', (e) => e.defId === 'mini_compactor' && minis++);
    events.on('bossStunned', (e) => e.cause === 'wall' && stuns++);
    for (let i = 0; i < 60 * 40 && (minis === 0 || stuns === 0); i++) {
      run.hazards.update(1 / 60, run);
      // No collision System here: hold the Bunny at its spot instead of letting hits push it through the ridge.
      b.teleport(home.x, home.z);
      closest = Math.min(closest, Math.hypot(boss.x - b.x, boss.z - b.z));
    }
    expect(minis).toBeGreaterThan(0);
    expect(stuns).toBeGreaterThan(0);
    expect(closest).toBeLessThan(d0 - 5);
    expect(boss.dead).toBe(false);
    // Ramming it while stunned lands a hit.
    boss.abilityStun(run, 2, 'amass');
    const hits: string[] = [];
    events.on('bossHit', (e) => hits.push(`${e.hits}/${e.maxHits}`));
    boss.onContact(run);
    expect(hits).toEqual(['1/3']);
    // A hit no longer shrinks it.
    expect(boss.size).toBe(INCINERATOR.size);
  });

  /**
   * A hunting Incinerator with the Bunny (and optionally a Lure) re-placed every tick at a fixed
   * offset from it, so it never closes in and only its ash can reach them.
   */
  function ashFight(seed: string, place: (run: Run, boss: RoboVac9000) => void, until: () => boolean, seconds = 14) {
    const { run, events } = makeRun(seed);
    const b = run.bunny;
    b.health = 999;
    b.setRadius(tierRadius(run, 11) * 1.05);
    const boss = run.hazards.spawn('incinerator', 30, 75) as RoboVac9000;
    place(run, boss);
    let telegraphs = 0;
    let pellets = 0;
    let touched = false;
    const sheds: string[] = [];
    events.on('hazardTelegraph', (e) => e.attack === 'ash' && telegraphs++);
    events.on('bunnyShed', (e) => sheds.push(e.source));
    for (let i = 0; i < 60 * seconds && !until() && sheds.length === 0; i++) {
      run.hazards.update(1 / 60, run);
      place(run, boss);
      pellets = Math.max(pellets, boss.ash.length);
      if (Math.hypot(b.x - boss.x, b.z - boss.z) < INCINERATOR.contactRadius * boss.scale + b.radius) touched = true;
    }
    return { run, boss, telegraphs, pellets, touched, sheds };
  }

  it('the Incinerator fires ash volleys from its chimney that shed mass', () => {
    const { run, telegraphs, pellets, touched, sheds } = ashFight(
      'incinerator-ash',
      (run, boss) => run.bunny.teleport(boss.x + 14, boss.z),
      () => false,
    );
    expect(telegraphs).toBeGreaterThan(0);
    expect(pellets).toBeGreaterThan(0);
    expect(touched).toBe(false);
    expect(sheds).toEqual(['incinerator']);
    expect(run.bunny.health).toBeLessThan(999);
  });

  it('ash aims at the Decoy and pops it', () => {
    const shots: Hazard[] = [];
    let lure: Lure | null = null;
    const { telegraphs, sheds } = ashFight(
      'incinerator-decoy',
      (run, boss) => {
        lure ??= { x: 0, z: 0, radius: run.bunny.radius * 0.8, rangeMul: 1, wanderRange: 0, shot: (h) => shots.push(h) };
        setLure(run, lure);
        lure.x = boss.x + 12;
        lure.z = boss.z;
        // The Bunny watches from the side, off the lane.
        run.bunny.teleport(boss.x + 12, boss.z + 10);
      },
      () => shots.length > 0,
    );
    expect(telegraphs).toBeGreaterThan(0);
    expect(shots.length).toBeGreaterThan(0);
    expect(shots[0]!.def.id).toBe('incinerator');
    expect(sheds).toEqual([]);
  });

  it('a hidden Bunny (Dust Cloud) draws no ash', () => {
    const { telegraphs } = ashFight(
      'incinerator-hidden',
      (run, boss) => {
        run.bunny.hiddenFromHazards = true;
        run.bunny.teleport(boss.x + 14, boss.z);
      },
      () => false,
      10,
    );
    expect(telegraphs).toBe(0);
  });

  it('absorbing the Incinerator clears the Region (bossDefeated → exitOpened west) and clears its minis', () => {
    const { run, events } = makeRun('incinerator-win');
    moveToCentre(run);
    const b = run.bunny;
    const order: string[] = [];
    events.on('bossDefeated', (e) => order.push(`bossDefeated:${e.defId}`));
    events.on('exitOpened', (e) => order.push(`exitOpened:${e.area}`));
    events.on('victory', () => order.push('victory'));
    events.on('runEnded', (e) => order.push(`runEnded:${e.reason}`));
    b.setRadius(absorbRadiusFor(INCINERATOR.size, b.stats.get('absorbRatio')) + 0.05);
    const boss = run.hazards.spawn('incinerator', b.x + b.radius + 20, b.z) as RoboVac9000;
    const mini = run.hazards.spawn('mini_compactor', b.x, b.z + b.radius + 6);
    boss.minis.add(mini.id);
    boss.x = b.x + b.radius;
    boss.z = b.z;
    run.update(1 / 60);
    expect(order).toEqual(['bossDefeated:incinerator', 'exitOpened:region']);
    expect(run.ended).toBe(false);
    expect(run.isAreaCleared('region')).toBe(true);
    expect(run.house.exit).toMatchObject({ open: true, dir: { x: -1, z: 0 } });
    expect(run.canLeaveArea).toBe(true);
    expect(run.hazards.count('mini_compactor')).toBe(0);
  });
});
