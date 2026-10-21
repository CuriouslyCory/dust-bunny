import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/events';
import { Rng } from '../core/rng';
import { DIRECTOR, ROBOVAC_9000, ROOMBA, UPRIGHT_VACUUM } from '../data/hazards';
import { getTier, MAX_TIER, TIERS } from '../data/tiers';
import { TUNING } from '../data/tuning';
import { Run } from '../game/run';
import { stepBunnyMovement } from '../systems/movement';
import { NO_INPUT } from '../core/input';
import { absorbRadiusFor, hazardFloorFree, suctionFalloff, suctionReachFor, suctionSpeed } from './common';
import { hazardBudget, pickHazardType, spawnInterval, spawnRing, spawnWeights } from './director';
import { installRunHazards } from './install';
import { puddleScale } from './mop';
import { bossSizeAfterHits } from './robovac';
import { planShed } from './shed';
import { inCone, type UprightVacuum } from './uprightVacuum';
import type { SprayBottle } from './sprayBottle';
import { onScreen, spawnView } from '../systems/camera';
import { installRunHooks } from '../meta/install';

const makeRun = (seed = 'hazards') => {
  const events = new EventBus();
  const run = new Run(events, { seed, characterId: 'lint' });
  return { events, run };
};

/** Moves the Bunny to an open floor spot (not under furniture) so Hazards can reach it. */
function moveToOpenFloor(run: Run): void {
  const bd = run.house.bounds;
  for (let x = bd.minX + 80; x < bd.maxX - 80; x += 20) {
    for (let z = bd.minZ + 80; z < bd.maxZ - 80; z += 20) {
      if (hazardFloorFree(run.house, x, z, 90, 500)) {
        run.bunny.x = run.bunny.prevX = x;
        run.bunny.z = run.bunny.prevZ = z;
        return;
      }
    }
  }
  throw new Error('no open floor');
}

describe('spawn director tables', () => {
  it('ramps the alive budget and spawn rate within a Tier', () => {
    expect(hazardBudget(1, 0)).toBe(DIRECTOR.tiers[0]!.budget[0]);
    expect(hazardBudget(1, 1)).toBe(DIRECTOR.tiers[0]!.budget[1]);
    expect(spawnInterval(1, 1)).toBeLessThan(spawnInterval(1, 0));
    for (let t = 1; t < MAX_TIER; t++) expect(hazardBudget(t + 1, 0)).toBeGreaterThanOrEqual(hazardBudget(t, 0));
  });

  it('only spawns Hazards whose minTier has been reached', () => {
    expect(Object.keys(spawnWeights(1, {})).sort()).toEqual(['lint_roller', 'roomba']);
    expect(Object.keys(spawnWeights(2, {}))).toContain('broom');
    expect(Object.keys(spawnWeights(3, {}))).toContain('mop');
    expect(Object.keys(spawnWeights(4, {}))).toContain('upright_vacuum');
    for (let t = 1; t <= MAX_TIER; t++) expect(Object.keys(spawnWeights(t, {}))).not.toContain('robovac_9000');
  });

  it('respects per-type caps and the budget', () => {
    expect(spawnWeights(1, { roomba: 1 }).roomba).toBe(0);
    expect(spawnWeights(1, { roomba: 1 }).lint_roller).toBeGreaterThan(0);
    const rng = new Rng('pick');
    expect(pickHazardType(1, 0, { roomba: 1 }, rng)).toBeNull(); // budget 1 at Tier 1 start
    expect(pickHazardType(1, 1, { roomba: 1 }, rng)).toBe('lint_roller');
    expect(pickHazardType(1, 1, { roomba: 1, lint_roller: 1 }, rng)).toBeNull();
    // The boss and its minis do not use up the budget.
    expect(pickHazardType(5, 0, { robovac_9000: 1, mini_roomba: 4 }, rng)).not.toBeNull();
  });

  it('spawns outside the view', () => {
    const [inner, outer] = spawnRing(100, ROOMBA.size);
    expect(inner).toBeGreaterThan(100 + ROOMBA.size);
    expect(outer).toBeGreaterThan(inner);
  });
});

describe('damage and i-frames', () => {
  it('blocks damage during invulnerability, then allows it again', () => {
    const { run, events } = makeRun();
    const b = run.bunny;
    const hits: number[] = [];
    events.on('bunnyDamaged', (e) => hits.push(e.health));
    expect(b.damage(1, 'test')).toBe(true);
    expect(b.damage(1, 'test')).toBe(false);
    for (let t = 0; t < TUNING.invulnerability + 0.05; t += 1 / 60) stepBunnyMovement(b, NO_INPUT, 1 / 60);
    expect(b.damage(1, 'test')).toBe(true);
    expect(hits).toEqual([b.maxHealth - 1, b.maxHealth - 2]);
  });

  it('ends the Run as died at zero health', () => {
    const { run, events } = makeRun();
    let died = '';
    events.on('bunnyDied', (e) => (died = e.source));
    run.bunny.health = 1;
    run.bunny.damage(1, 'roomba');
    expect(died).toBe('roomba');
    expect(run.ended).toBe(true);
    expect(run.endReason).toBe('died');
  });
});

describe('absorbing Hazards', () => {
  it('damages a small Bunny and is absorbed by a big one', () => {
    const { run, events } = makeRun();
    moveToOpenFloor(run);
    const b = run.bunny;
    b.setRadius(10);
    const h = run.hazards.spawn('roomba', b.x + b.radius + ROOMBA.size - 1, b.z);
    run.update(1 / 60);
    expect(b.health).toBe(b.maxHealth - 1);
    expect(h.dead).toBeFalsy();

    const absorbed: string[] = [];
    events.on('hazardAbsorbed', (e) => absorbed.push(e.defId));
    b.setRadius(absorbRadiusFor(ROOMBA.size, b.stats.get('absorbRatio')) + 0.5);
    const r0 = b.radius;
    h.x = b.x + b.radius;
    h.z = b.z;
    run.update(1 / 60);
    expect(absorbed).toEqual(['roomba']);
    expect(run.hazards.count('roomba')).toBe(0);
    expect(run.hazardsAbsorbed).toBe(1);
    expect(b.radius).toBeGreaterThan(r0 * 1.05);
  });

  it('opens the front door when the Robo-Vac 9000 is absorbed, and the Run continues outside', () => {
    const { run, events } = makeRun();
    moveToOpenFloor(run);
    const b = run.bunny;
    const order: string[] = [];
    events.on('bossDefeated', () => order.push('bossDefeated'));
    events.on('exitOpened', () => order.push('exitOpened'));
    events.on('areaEntered', (e) => order.push(`areaEntered:${e.area}`));
    events.on('runEnded', (e) => order.push(`runEnded:${e.reason}`));
    b.setRadius(absorbRadiusFor(ROBOVAC_9000.size, b.stats.get('absorbRatio')) + 1);
    run.hazards.spawn('robovac_9000', b.x + b.radius, b.z);
    run.update(1 / 60);
    expect(order).toEqual(['bossDefeated', 'exitOpened']);
    expect(run.ended).toBe(false);
    expect(run.houseCleared).toBe(true);
    expect(run.house.obstacles.some((o) => o.id === run.house.exit!.obstacleId)).toBe(false);

    // Rolling into the open doorway leaves the house.
    const exit = run.house.exit!.rect;
    b.teleport((exit.minX + exit.maxX) / 2 - run.house.exit!.dir.x * b.radius * 0.4, (exit.minZ + exit.maxZ) / 2);
    run.update(1 / 60);
    expect(order).toEqual(['bossDefeated', 'exitOpened', 'areaEntered:neighborhood']);
    expect(run.area).toBe('neighborhood');
    expect(run.house.area).toBe('neighborhood');
    expect(run.hazards.hazards).toHaveLength(0);
    expect(run.debris.count).toBeGreaterThan(500);
  });

  it('keeps the boss out of reach at Tier 5 entry, but reachable after two stun hits', () => {
    const ratio = 0.7;
    const tier5 = getTier(5).minRadius;
    expect(absorbRadiusFor(ROBOVAC_9000.size, ratio)).toBeGreaterThan(tier5);
    expect(absorbRadiusFor(bossSizeAfterHits(2), ratio)).toBeLessThan(tier5);
  });

  it('makes every Hazard absorbable by the end of the Tier ladder (except the boss at full size)', () => {
    const top = TIERS[TIERS.length - 1]!.minRadius;
    for (const id of ['roomba', 'lint_roller', 'spray_bottle', 'mop', 'upright_vacuum']) {
      const { run } = makeRun();
      moveToOpenFloor(run);
      const h = run.hazards.spawn(id, run.bunny.x + 200, run.bunny.z);
      expect(absorbRadiusFor(h.size, 0.7)).toBeLessThan(top);
    }
  });
});

describe('suction', () => {
  it('falls off linearly from the Hazard edge to its reach', () => {
    expect(suctionFalloff(5, 10, 30)).toBe(1);
    expect(suctionFalloff(10, 10, 30)).toBe(1);
    expect(suctionFalloff(20, 10, 30)).toBeCloseTo(0.5);
    expect(suctionFalloff(30, 10, 30)).toBe(0);
    expect(suctionFalloff(50, 10, 30)).toBe(0);
  });

  it('scales with suctionMultiplier and stays escapable', () => {
    expect(suctionReachFor(16, 1.5)).toBeGreaterThan(16);
    expect(suctionSpeed(100, 0.4, 1, 1.5, false)).toBeCloseTo(60);
    expect(suctionSpeed(100, 0.4, 1, 1.5, true)).toBeLessThan(60);
    expect(suctionSpeed(100, ROOMBA.suctionStrength, 1, 1.5, false)).toBeLessThan(100);
  });

  it('cone test for the Upright Vacuum', () => {
    expect(inCone(0, 0, 0, 0.5, 100, 0, 50)).toBe(true);
    expect(inCone(0, 0, 0, 0.5, 100, 50, 0)).toBe(false);
    expect(inCone(0, 0, 0, 0.5, 100, 0, -50)).toBe(false);
    expect(inCone(0, 0, 0, 0.5, 100, 0, 120)).toBe(false);
  });
});

describe('mass shedding and wet trail', () => {
  it('splits shed volume into absorbable pieces that give it back', () => {
    const plan = planShed(10, 0.08, 0.7);
    expect(plan.newRadius).toBeLessThan(10);
    expect(plan.pieceSize).toBeLessThanOrEqual(plan.newRadius * 0.7);
    const regained = plan.pieces * TUNING.growthFactor * plan.pieceSize ** 3;
    expect(regained).toBeGreaterThanOrEqual(plan.volume * 0.95);
  });

  it('fades puddles out at the end of their life', () => {
    expect(puddleScale(0, 7, 0.4)).toBe(1);
    expect(puddleScale(5.6, 7, 0.4)).toBeCloseTo(0.5);
    expect(puddleScale(7, 7, 0.4)).toBe(0);
  });
});

describe('roguelike hooks', () => {
  it('does not pull a hidden Bunny (Dust Cloud)', () => {
    const { run } = makeRun();
    moveToOpenFloor(run);
    const b = run.bunny;
    b.setRadius(3);
    run.hazards.spawn('roomba', b.x + ROOMBA.size + b.radius + 4, b.z);
    b.hiddenFromHazards = true;
    const x0 = b.x;
    run.hazards.update(1 / 60, run);
    expect(b.x).toBe(x0);
    b.hiddenFromHazards = false;
    run.hazards.update(1 / 60, run);
    expect(b.x).toBeGreaterThan(x0);
  });

  it('a stunned Hazard neither moves nor hurts', () => {
    const { run } = makeRun();
    moveToOpenFloor(run);
    const b = run.bunny;
    b.setRadius(5);
    const h = run.hazards.spawn('roomba', b.x + 200, b.z);
    h.stunnedFor = 1;
    const [x0, z0] = [h.x, h.z];
    run.hazards.update(1 / 60, run);
    expect([h.x, h.z]).toEqual([x0, z0]);
    h.x = b.x + b.radius + ROOMBA.size - 1;
    run.hazards.update(1 / 60, run);
    expect(b.health).toBe(b.maxHealth);
  });

  it('backs off after a hit instead of pinning the Bunny (no repeat hit when i-frames end)', () => {
    for (const id of ['roomba', 'mop', 'upright_vacuum']) {
      const { run } = makeRun(`recoil-${id}`);
      moveToOpenFloor(run);
      const b = run.bunny;
      b.setRadius(8);
      const h = run.hazards.spawn(id, b.x + b.radius + 10, b.z);
      h.x = b.x + b.radius + h.size - 2;
      run.hazards.update(1 / 60, run);
      expect(b.health).toBe(b.maxHealth - 1);
      const d0 = Math.hypot(h.x - b.x, h.z - b.z);
      // Hold the Bunny in place (as if against a wall) until the i-frames run out.
      const [bx, bz] = [b.x, b.z];
      for (let i = 0; i < 70; i++) {
        b.x = bx;
        b.z = bz;
        b.invulnerable = Math.max(0, b.invulnerable - 1 / 60);
        run.hazards.update(1 / 60, run);
      }
      expect(b.invulnerable).toBe(0);
      expect(b.health).toBe(b.maxHealth - 1);
      expect(Math.hypot(h.x - b.x, h.z - b.z)).toBeGreaterThan(d0);
    }
  });

  it('the Upright Vacuum cuts out after a hit and deals 1 damage', () => {
    const { run } = makeRun('vacuum-hit');
    moveToOpenFloor(run);
    const b = run.bunny;
    b.setRadius(10);
    const h = run.hazards.spawn('upright_vacuum', b.x + b.radius + UPRIGHT_VACUUM.size - 2, b.z) as UprightVacuum;
    h.state = 'on';
    run.hazards.update(1 / 60, run);
    expect(b.health).toBe(b.maxHealth - UPRIGHT_VACUUM.damage);
    expect(UPRIGHT_VACUUM.damage).toBe(1);
    expect(h.state).toBe('off');
  });

  it('a Spray Bottle only shoots from on screen', () => {
    const { run } = makeRun('spray-screen');
    moveToOpenFloor(run);
    const b = run.bunny;
    b.setRadius(10);
    const view = spawnView(run);
    // Straight below the Bunny (towards the camera) and in range, but off the bottom of the screen.
    const below = run.hazards.spawn('spray_bottle', b.x, b.z + view.distance * 0.6) as SprayBottle;
    below.yaw = Math.PI; // already aimed at the Bunny
    expect(onScreen(run, below.x, below.z)).toBe(false);
    for (let i = 0; i < 120; i++) run.hazards.update(1 / 60, run);
    expect(below.state).toBe('idle');
    const above = run.hazards.spawn('spray_bottle', b.x, b.z - view.distance * 0.4) as SprayBottle;
    above.yaw = 0;
    for (let i = 0; i < 30; i++) run.hazards.update(1 / 60, run);
    expect(above.state).not.toBe('idle');
  });

  it('a blocked hit (Bubble Wrap) does not stick or shed', () => {
    const { run, events } = makeRun();
    installRunHooks(run);
    moveToOpenFloor(run);
    const b = run.bunny;
    b.setRadius(4);
    b.shield = 1;
    let shed = 0;
    events.on('bunnyShed', () => shed++);
    run.hazards.spawn('lint_roller', b.x + b.radius + 5, b.z);
    run.hazards.update(1 / 60, run);
    expect(b.health).toBe(b.maxHealth);
    expect(b.rooted).toBe(0);
    expect(shed).toBe(0);
  });
});

describe('director in a headless Run', () => {
  it('spawns Hazards after the grace period and brings the boss at Tier 5', () => {
    const { run, events } = makeRun('director');
    installRunHazards(run);
    let spawned = 0;
    let boss = 0;
    events.on('hazardSpawned', () => spawned++);
    events.on('bossSpawned', () => boss++);
    for (let i = 0; i < 60 * 40 && !run.ended; i++) run.update(1 / 60);
    expect(spawned).toBeGreaterThan(0);
    expect(boss).toBe(0);

    run.bunny.health = 999;
    run.bunny.setRadius(getTier(5).minRadius * 1.02);
    for (let i = 0; i < 60 * (ROBOVAC_9000.arrivalDelay + 1) && !run.ended; i++) run.update(1 / 60);
    expect(run.tier).toBe(5);
    expect(boss).toBe(1);
    expect(run.hazards.count('robovac_9000')).toBe(1);
  });
});
