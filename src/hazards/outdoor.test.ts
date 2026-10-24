/** This Area's own Hazard behaviour. The contract every Area keeps (units, sizes, spawn tables, director, boss arrival) is checked over AREA_ORDER in areaContract.test.ts. */
import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/events';
import { Rng } from '../core/rng';
import { LAWN_MOWER, LEAF_BLOWER, STREET_SWEEPER } from '../data/hazards';
import { getTier } from '../data/tiers';
import { Run } from '../game/run';
import { NEIGHBORHOOD } from '../world/neighborhood';
import { absorbRadiusFor, hazardFloorFree } from './common';
import { type RoboVac9000 } from './robovac';
import type { SprayBottle } from './sprayBottle';
import type { UprightVacuum } from './uprightVacuum';
import './content';

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
    expect(run.isAreaCleared('neighborhood')).toBe(true);
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
