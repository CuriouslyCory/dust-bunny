/** This Area's own Hazard behaviour. The contract every Area keeps (units, sizes, spawn tables, director, boss arrival) is checked over AREA_ORDER in areaContract.test.ts. */
import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/events';
import { BROOM, GARBAGE_TRUCK, LEAF_BLOWER, STREET_FLUSHER, tierValue } from '../data/hazards';
import { getTier } from '../data/tiers';
import { Run } from '../game/run';
import { CITY } from '../world/city';
import { absorbRadiusFor, hazardFloorFree } from './common';
import type { Mop } from './mop';
import { type RoboVac9000 } from './robovac';
import type { SprayBottle } from './sprayBottle';
import type { UprightVacuum } from './uprightVacuum';
import './content';

const makeRun = (seed = 'city-hazards') => {
  const events = new EventBus();
  const run = new Run(events, { seed, characterId: 'lint', area: 'city' });
  return { events, run };
};

/** Puts the Bunny on the main avenue, clear of buildings for a Tier 9 Bunny. */
function moveToAvenue(run: Run): void {
  const z = CITY.avenueZs[CITY.mainAvenue]!;
  for (let x = 3000; x < CITY.width - 3000; x += 100) {
    if (hazardFloorFree(run.house, x, z, 1000, 1000)) {
      run.bunny.teleport(x, z);
      return;
    }
  }
  throw new Error('no open avenue');
}

describe('city Hazards', () => {
  it('per-Tier values stay valid at Tiers 8–9 for every area', () => {
    // House tables (5 entries) and outdoor ones (7) clamp to their last Tier.
    expect(tierValue(BROOM.telegraph, 9)).toBe(BROOM.telegraph[4]);
    expect(tierValue(LEAF_BLOWER.speed, 9)).toBe(LEAF_BLOWER.speed[6]);
    expect(tierValue(STREET_FLUSHER.speed, 7)).toBe(STREET_FLUSHER.speed[0]);
    expect(tierValue(STREET_FLUSHER.speed, 9)).toBe(STREET_FLUSHER.speed[8]);
  });

  it('absorbing the Garbage Truck opens the highway on-ramp (bossDefeated → exitOpened) and clears its minis', () => {
    const { run, events } = makeRun('truck-win');
    moveToAvenue(run);
    const b = run.bunny;
    const order: string[] = [];
    events.on('bossDefeated', (e) => order.push(`bossDefeated:${e.defId}`));
    events.on('exitOpened', (e) => order.push(`exitOpened:${e.area}`));
    events.on('victory', () => order.push('victory'));
    events.on('runEnded', (e) => order.push(`runEnded:${e.reason}`));
    b.setRadius(absorbRadiusFor(GARBAGE_TRUCK.size, b.stats.get('absorbRatio')) + 1);
    const boss = run.hazards.spawn('garbage_truck', b.x + b.radius + 2000, b.z) as RoboVac9000;
    const mini = run.hazards.spawn('mini_scrubber', b.x, b.z + b.radius + 600);
    boss.minis.add(mini.id);
    boss.x = b.x + b.radius;
    boss.z = b.z;
    run.update(1 / 60);
    expect(order).toEqual(['bossDefeated:garbage_truck', 'exitOpened:city']);
    expect(run.ended).toBe(false);
    expect(run.isAreaCleared('city')).toBe(true);
    expect(run.canLeaveArea).toBe(true);
    expect(run.hazards.count('mini_scrubber')).toBe(0);
  });

  it("the Street Flusher's wide wet trail slows the Bunny", () => {
    const { run } = makeRun('flusher');
    moveToAvenue(run);
    const b = run.bunny;
    const speed0 = b.stats.get('speed');
    const h = run.hazards.spawn('street_flusher', b.x + 2500, b.z) as Mop;
    for (let i = 0; i < 60 * 3; i++) run.hazards.update(1 / 60, run);
    expect(h.puddles.length).toBeGreaterThan(3);
    expect(b.stats.get('speed')).toBe(speed0);
    // Roll onto the oldest puddle, away from the truck itself.
    const p = h.puddles.reduce((far, q) => (Math.hypot(q.x - h.x, q.z - h.z) > Math.hypot(far.x - h.x, far.z - h.z) ? q : far));
    expect(Math.hypot(p.x - h.x, p.z - h.z)).toBeGreaterThan(STREET_FLUSHER.size + b.radius);
    b.teleport(p.x, p.z);
    run.hazards.update(1 / 60, run);
    expect(b.stats.get('speed')).toBeCloseTo(speed0 * STREET_FLUSHER.slowMultiplier);
  });

  it('the Pressure Washer only aims its head, fires from on screen and soaks the Bunny', () => {
    const { run } = makeRun('washer');
    moveToAvenue(run);
    const b = run.bunny;
    const speed0 = b.stats.get('speed');
    // Above the Bunny on screen (−Z is up), still on the avenue, well inside range.
    const h = run.hazards.spawn('pressure_washer', b.x, b.z - 650) as SprayBottle;
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

  it('the Litter Vacuum pulls the Bunny into its intake and sheds mass on contact', () => {
    const { run, events } = makeRun('litter-vac');
    moveToAvenue(run);
    const b = run.bunny;
    const h = run.hazards.spawn('litter_vacuum', b.x + 700, b.z) as UprightVacuum;
    h.yaw = -Math.PI / 2; // intake (+Z model forward) facing the Bunny (−X)
    h.state = 'on';
    const d0 = Math.hypot(b.x - h.x, b.z - h.z);
    for (let i = 0; i < 20; i++) run.hazards.update(1 / 60, run);
    expect(Math.hypot(b.x - h.x, b.z - h.z)).toBeLessThan(d0 - 20);

    let shed = 0;
    events.on('bunnyShed', () => shed++);
    const r0 = b.radius;
    h.onContact(run);
    expect(b.health).toBe(b.maxHealth - 1);
    expect(shed).toBe(1);
    expect(b.radius).toBeLessThan(r0);
  });

  it('the Garbage Truck hunts, summons mini scrubbers and is stunned when a charge hits a building or the barrier', () => {
    const { run, events } = makeRun('truck-hunt');
    moveToAvenue(run);
    const b = run.bunny;
    b.health = 999;
    b.setRadius(getTier(9).minRadius);
    const boss = run.hazards.spawn('garbage_truck', b.x + 4000, b.z) as RoboVac9000;
    const d0 = Math.hypot(boss.x - b.x, boss.z - b.z);
    let minis = 0;
    let stuns = 0;
    let closest = d0;
    events.on('hazardSpawned', (e) => e.defId === 'mini_scrubber' && minis++);
    events.on('bossStunned', () => stuns++);
    for (let i = 0; i < 60 * 40 && (minis === 0 || stuns === 0); i++) {
      run.hazards.update(1 / 60, run);
      closest = Math.min(closest, Math.hypot(boss.x - b.x, boss.z - b.z));
    }
    expect(minis).toBeGreaterThan(0);
    expect(stuns).toBeGreaterThan(0);
    expect(closest).toBeLessThan(d0 - 500);
  });
});
