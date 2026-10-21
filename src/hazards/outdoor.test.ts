import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/events';
import { Rng } from '../core/rng';
import { AREA_BOSSES, DIRECTOR, DIRECTOR_EXCLUDE, LAWN_MOWER, LEAF_BLOWER, NEIGHBORHOOD_DIRECTOR, STREET_SWEEPER } from '../data/hazards';
import { getTier } from '../data/tiers';
import { Run } from '../game/run';
import { NEIGHBORHOOD } from '../world/neighborhood';
import { absorbRadiusFor, hazardFloorFree } from './common';
import { spawnWeights } from './director';
import { hazardRegistry } from './index';
import { installRunHazards } from './install';
import { bossSizeAfterHits, type RoboVac9000 } from './robovac';
import type { SprayBottle } from './sprayBottle';
import type { UprightVacuum } from './uprightVacuum';

const OUTDOOR = ['robo_mower', 'lawn_mower', 'leaf_blower', 'sprinkler'];
const HOUSE = ['roomba', 'lint_roller', 'broom', 'spray_bottle', 'mop', 'upright_vacuum', 'robovac_9000', 'mini_roomba'];

const makeRun = (seed = 'outdoor') => {
  const events = new EventBus();
  const run = new Run(events, { seed, characterId: 'lint', area: 'neighborhood' });
  return { events, run };
};

/** Puts the Bunny in the middle of the main street, away from the cross street. */
function moveToStreet(run: Run): void {
  const z = NEIGHBORHOOD.streetZ + NEIGHBORHOOD.streetWidth / 2;
  for (let x = 800; x < NEIGHBORHOOD.crossX - 800; x += 50) {
    if (hazardFloorFree(run.house, x, z, 250, 500)) {
      run.bunny.teleport(x, z);
      return;
    }
  }
  throw new Error('no open street');
}

describe('outdoor Hazards', () => {
  it('are a threat on arrival outside and absorbable by Tier 7 (except the boss at full size)', () => {
    const tier7 = getTier(7).minRadius;
    for (const id of OUTDOOR) {
      const { run } = makeRun(`absorb-${id}`);
      moveToStreet(run);
      const h = run.hazards.spawn(id, run.bunny.x + 400, run.bunny.z);
      expect(h.dead, id).toBeFalsy();
      const need = absorbRadiusFor(h.size, 0.7);
      expect(need, id).toBeGreaterThan(NEIGHBORHOOD.debugStartRadius);
      expect(need, id).toBeGreaterThan(getTier(hazardRegistry.require(id).minTier).minRadius);
      expect(need, id).toBeLessThan(tier7);
    }
    expect(absorbRadiusFor(STREET_SWEEPER.size, 0.7)).toBeGreaterThan(tier7);
  });

  it('keeps the Street Sweeper out of reach at Tier 7 entry, but reachable after two stun hits', () => {
    const ratio = 0.7;
    const tier7 = getTier(7).minRadius;
    const { size, chipFactor } = STREET_SWEEPER;
    expect(absorbRadiusFor(size, ratio)).toBeGreaterThan(tier7);
    expect(absorbRadiusFor(bossSizeAfterHits(1, size, chipFactor), ratio)).toBeGreaterThan(tier7);
    expect(absorbRadiusFor(bossSizeAfterHits(2, size, chipFactor), ratio)).toBeLessThan(tier7);
  });

  it('outdoor spawn tables only list outdoor Hazards, and bosses / summons are never random picks', () => {
    for (let t = NEIGHBORHOOD_DIRECTOR.firstTier; t <= 7; t++) {
      const ids = Object.keys(spawnWeights(t, {}, 'neighborhood'));
      expect(ids.length).toBeGreaterThan(0);
      for (const id of ids) {
        expect(OUTDOOR).toContain(id);
        expect(hazardRegistry.require(id).minTier).toBeLessThanOrEqual(t);
      }
    }
    expect(Object.keys(spawnWeights(6, {}, 'neighborhood'))).toContain('lawn_mower');
    for (const id of ['street_sweeper', 'mini_mower']) expect(DIRECTOR_EXCLUDE).toContain(id);
    for (const t of DIRECTOR.tiers) for (const id of OUTDOOR) expect(Object.keys(t.types)).not.toContain(id);
  });

  it('the director spawns outdoor Hazards (never house ones) and brings the Street Sweeper at Tier 7', () => {
    const { run, events } = makeRun('outdoor-director');
    installRunHazards(run);
    const spawned: string[] = [];
    const bosses: string[] = [];
    events.on('hazardSpawned', (e) => spawned.push(e.defId));
    events.on('bossSpawned', (e) => bosses.push(e.name));
    run.bunny.health = 999;
    const step = (seconds: number) => {
      for (let i = 0; i < 60 * seconds && !run.ended; i++) run.update(1 / 60);
    };
    step(40);
    expect(run.tier).toBe(5);
    run.bunny.setRadius(getTier(6).minRadius * 1.1);
    step(30);
    expect(spawned.length).toBeGreaterThan(2);
    expect(bosses).toEqual([]);

    run.bunny.setRadius(getTier(7).minRadius * 1.02);
    step(AREA_BOSSES.neighborhood.arrivalDelay + 1);
    expect(run.tier).toBe(7);
    expect(bosses).toEqual(['Street Sweeper']);
    expect(run.hazards.count('street_sweeper')).toBe(1);
    for (const id of spawned) expect(HOUSE).not.toContain(id);
    for (const id of spawned) expect([...OUTDOOR, 'street_sweeper', 'mini_mower']).toContain(id);
  });

  it('absorbing the Street Sweeper opens the road to the city (bossDefeated → exitOpened) and clears its minis', () => {
    const { run, events } = makeRun('sweeper-win');
    moveToStreet(run);
    const b = run.bunny;
    const order: string[] = [];
    events.on('bossDefeated', (e) => order.push(`bossDefeated:${e.defId}`));
    events.on('victory', () => order.push('victory'));
    events.on('runEnded', (e) => order.push(`runEnded:${e.reason}`));
    events.on('exitOpened', (e) => order.push(`exitOpened:${e.area}`));
    events.on('areaEntered', (e) => order.push(`areaEntered:${e.area}`));
    b.setRadius(absorbRadiusFor(STREET_SWEEPER.size, b.stats.get('absorbRatio')) + 1);
    const boss = run.hazards.spawn('street_sweeper', b.x + b.radius + 600, b.z) as RoboVac9000;
    const mini = run.hazards.spawn('mini_mower', b.x, b.z + b.radius + 800);
    boss.minis.add(mini.id);
    boss.x = b.x + b.radius;
    boss.z = b.z;
    run.update(1 / 60);
    expect(order).toEqual(['bossDefeated:street_sweeper', 'exitOpened:neighborhood']);
    expect(run.ended).toBe(false);
    expect(run.neighborhoodCleared).toBe(true);
    expect(run.house.exit?.open).toBe(true);
    expect(run.hazards.count('mini_mower')).toBe(0);
    // Rolling into the opened barrier moves the Run to the city.
    const exit = run.house.exit!;
    b.teleport((exit.rect.minX + exit.rect.maxX) / 2 - exit.dir.x * b.radius, (exit.rect.minZ + exit.rect.maxZ) / 2);
    run.update(1 / 60);
    expect(order.at(-1)).toBe('areaEntered:city');
    expect(run.area).toBe('city');
  });

  it('the Lawn Mower mows fluff off (damage + shed) without sticking', () => {
    const { run, events } = makeRun('mower-hit');
    moveToStreet(run);
    const b = run.bunny;
    let shed = 0;
    events.on('bunnyShed', () => shed++);
    const h = run.hazards.spawn('lawn_mower', b.x + 300, b.z);
    expect(h.dead).toBeFalsy();
    h.x = b.x + b.radius + LAWN_MOWER.size - 4;
    h.z = b.z;
    const r0 = b.radius;
    h.onContact?.(run);
    expect(b.health).toBe(b.maxHealth - 1);
    expect(shed).toBe(1);
    expect(b.radius).toBeLessThan(r0);
    expect(b.rooted).toBe(0);
  });

  it('the Leaf Blower pushes the Bunny away and blows small Debris along', () => {
    const { run } = makeRun('blower');
    moveToStreet(run);
    const b = run.bunny;
    const h = run.hazards.spawn('leaf_blower', b.x + 250, b.z) as UprightVacuum;
    h.yaw = -Math.PI / 2; // nozzle (+Z model forward) pointing at the Bunny (−X)
    h.state = 'on';
    const ball = run.debris.types.findIndex((t) => t.id === 'tennis_ball');
    const d = run.debris.spawn(ball, h.x - LEAF_BLOWER.size - 40, h.z + 6, new Rng('ball'), { size: 8 })!;
    expect(d).toBeTruthy();
    const d0 = Math.hypot(b.x - h.x, b.z - h.z);
    const dx0 = d.x;
    for (let i = 0; i < 20; i++) run.hazards.update(1 / 60, run);
    expect(Math.hypot(b.x - h.x, b.z - h.z)).toBeGreaterThan(d0 + 10);
    expect(d.x).toBeLessThan(dx0 - 5);

    // Hidden (Dust Cloud): no push.
    b.hiddenFromHazards = true;
    h.state = 'on';
    const x1 = b.x;
    run.hazards.update(1 / 60, run);
    expect(b.x).toBe(x1);
  });

  it('the Sprinkler only aims its head, fires from on screen and soaks the Bunny', () => {
    const { run } = makeRun('sprinkler');
    moveToStreet(run);
    const b = run.bunny;
    const speed0 = b.stats.get('speed');
    // Above the Bunny on screen (−Z is up), well inside range.
    const h = run.hazards.spawn('sprinkler', b.x, b.z - 280) as SprayBottle;
    run.hazards.update(1 / 60, run);
    const bodyYaw = h.body.rotation.y;
    let hit = false;
    for (let i = 0; i < 60 * 6 && !hit; i++) {
      run.hazards.update(1 / 60, run);
      hit = b.health < b.maxHealth;
    }
    expect(hit).toBe(true);
    expect(b.stats.get('speed')).toBeLessThan(speed0);
    expect(h.body.rotation.y).toBe(bodyYaw);
  });

  it('the Street Sweeper hunts and summons mini mowers', () => {
    const { run, events } = makeRun('sweeper-summon');
    moveToStreet(run);
    const b = run.bunny;
    b.health = 999;
    b.setRadius(getTier(7).minRadius);
    const boss = run.hazards.spawn('street_sweeper', b.x + 1200, b.z) as RoboVac9000;
    const d0 = Math.hypot(boss.x - b.x, boss.z - b.z);
    let minis = 0;
    let closest = d0;
    events.on('hazardSpawned', (e) => e.defId === 'mini_mower' && minis++);
    // The summon timer only runs while hunting (not during charges), so give it a while.
    for (let i = 0; i < 60 * 30 && minis === 0; i++) {
      run.hazards.update(1 / 60, run);
      closest = Math.min(closest, Math.hypot(boss.x - b.x, boss.z - b.z));
    }
    expect(minis).toBeGreaterThan(0);
    expect(closest).toBeLessThan(d0 - 200);
  });
});
