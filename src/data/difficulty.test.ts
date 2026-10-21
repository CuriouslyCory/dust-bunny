import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/events';
import { installGameplay } from '../game/assembly';
import { Run } from '../game/run';
import { hazardFloorFree } from '../hazards/common';
import { hazardBudget, pickHazardType } from '../hazards/director';
import { Rng } from '../core/rng';
import { fluffForRun } from '../meta/fluff';
import { DIFFICULTIES, DIFFICULTY_IDS, difficultyModifiers, getDifficulty, type DifficultyId } from './difficulty';
import { DIRECTOR } from './hazards';

const makeRun = (difficulty?: DifficultyId, characterId = 'lint', seed = 'difficulty') => new Run(new EventBus(), { seed, characterId, difficulty });

/** Moves the Bunny to an open floor spot so a Hazard next to it can drive freely. */
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

/** Simulated second of the first Hazard spawn (Infinity if none within `seconds`). */
function firstSpawnAt(difficulty: DifficultyId, seconds = 30): number {
  const run = makeRun(difficulty, 'lint', 'grace');
  installGameplay(run);
  let at = Infinity;
  run.events.on('hazardSpawned', () => (at = Math.min(at, run.time)));
  run.bunny.health = 999;
  for (let i = 0; i < 60 * seconds && at === Infinity && !run.ended; i++) run.update(1 / 60);
  return at;
}

describe('difficulty definitions', () => {
  it('keeps Casual as the original balance', () => {
    const c = DIFFICULTIES.casual;
    for (const k of ['hazardSpeed', 'hazardBudget', 'spawnInterval', 'graceSeconds', 'attackTiming', 'pickupRate', 'fluff'] as const) expect(c[k]).toBe(1);
    expect(c.maxHealth).toBe(0);
    expect(c.areaHeal).toBe(1);
    expect(difficultyModifiers(c)).toEqual([]);
  });

  it('gets strictly harder from Casual to Arcade to Hardcore', () => {
    const [casual, arcade, hardcore] = DIFFICULTY_IDS.map((id) => DIFFICULTIES[id]);
    for (const [easier, harder] of [
      [casual!, arcade!],
      [arcade!, hardcore!],
    ]) {
      expect(harder.hazardSpeed).toBeGreaterThan(easier.hazardSpeed);
      expect(harder.hazardBudget).toBeGreaterThan(easier.hazardBudget);
      expect(harder.spawnInterval).toBeLessThan(easier.spawnInterval);
      expect(harder.graceSeconds).toBeLessThan(easier.graceSeconds);
      expect(harder.attackTiming).toBeLessThan(easier.attackTiming);
      expect(harder.maxHealth).toBeLessThanOrEqual(easier.maxHealth);
      expect(harder.pickupRate).toBeLessThanOrEqual(easier.pickupRate);
      expect(harder.areaHeal).toBeLessThanOrEqual(easier.areaHeal);
      expect(harder.fluff).toBeGreaterThan(easier.fluff);
    }
  });

  it('falls back to Casual for missing or unknown ids', () => {
    expect(getDifficulty(undefined).id).toBe('casual');
    expect(getDifficulty(null).id).toBe('casual');
    expect(getDifficulty('nightmare').id).toBe('casual');
    expect(getDifficulty('hardcore').id).toBe('hardcore');
  });
});

describe('difficulty in a Run', () => {
  it('defaults to Casual and reports the Difficulty in the Run stats', () => {
    expect(makeRun().difficulty.id).toBe('casual');
    expect(makeRun('arcade').getStats().difficulty).toBe('arcade');
  });

  it('Hardcore takes a heart (never the last one) and slows Pickups; Arcade keeps the hearts', () => {
    expect(makeRun('casual').bunny.maxHealth).toBe(3);
    expect(makeRun('arcade').bunny.maxHealth).toBe(3);
    const lint = makeRun('hardcore');
    expect(lint.bunny.maxHealth).toBe(2);
    expect(lint.bunny.health).toBe(2);
    expect(lint.bunny.stats.get('pickupLuck')).toBeCloseTo(DIFFICULTIES.hardcore.pickupRate);
    expect(makeRun('hardcore', 'zap').bunny.maxHealth).toBe(1);
  });

  it('heals a heart on reaching a new area, except on Hardcore', () => {
    for (const [difficulty, healed] of [
      ['casual', 1],
      ['hardcore', 0],
    ] as const) {
      const run = makeRun(difficulty, 'tumble');
      run.bunny.health = 2;
      run.enterNeighborhood();
      expect(run.bunny.health).toBe(2 + healed);
    }
  });

  it('moves Hazards faster on harder difficulties', () => {
    const moved = (difficulty: DifficultyId) => {
      const run = makeRun(difficulty);
      moveToOpenFloor(run);
      const h = run.hazards.spawn('roomba', run.bunny.x + 60, run.bunny.z);
      const [x0, z0] = [h.x, h.z];
      run.hazards.update(1 / 60, run);
      return Math.hypot(h.x - x0, h.z - z0);
    };
    const casual = moved('casual');
    expect(casual).toBeGreaterThan(0);
    expect(moved('arcade') / casual).toBeCloseTo(DIFFICULTIES.arcade.hazardSpeed, 5);
    expect(moved('hardcore') / casual).toBeCloseTo(DIFFICULTIES.hardcore.hazardSpeed, 5);
  });

  it('scales the director budget and shortens the grace period', () => {
    expect(hazardBudget(3, 1, 'house', DIFFICULTIES.hardcore.hazardBudget)).toBeGreaterThan(hazardBudget(3, 1));
    // A full casual budget still leaves room for more on Hardcore.
    const full = { roomba: hazardBudget(1, 1) };
    expect(pickHazardType(1, 1, full, new Rng('budget'))).toBeNull();
    expect(pickHazardType(1, 1, { lint_roller: hazardBudget(1, 1) }, new Rng('budget'), undefined, 'house', 3)).not.toBeNull();

    const casual = firstSpawnAt('casual');
    const hardcore = firstSpawnAt('hardcore');
    expect(casual).toBeGreaterThanOrEqual(DIRECTOR.graceSeconds);
    expect(hardcore).toBeGreaterThanOrEqual(DIRECTOR.graceSeconds * DIFFICULTIES.hardcore.graceSeconds - 1e-6);
    expect(hardcore).toBeLessThan(casual);
  });

  it('pays more Fluff on harder difficulties', () => {
    const stats = { maxRadius: 10, debrisAbsorbed: 400, tierReached: 3 };
    const base = 3 * 4 + 10 / 30 + 400 / 1000;
    expect(fluffForRun('died', stats)).toBe(12);
    expect(fluffForRun('died', { ...stats, difficulty: 'casual' })).toBe(12);
    expect(fluffForRun('died', { ...stats, difficulty: 'arcade' })).toBe(Math.floor(base * DIFFICULTIES.arcade.fluff));
    expect(fluffForRun('died', { ...stats, difficulty: 'hardcore' })).toBe(Math.floor(base * DIFFICULTIES.hardcore.fluff));
  });
});
