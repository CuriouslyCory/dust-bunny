import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/events';
import { TUNING } from '../data/tuning';
import { Run } from '../game/run';
import { hazardFloorFree } from '../hazards/common';
import { collisionSystem, wallRadiusAt } from './collision';
import { clutterFree, clutterSpacing, reachableBy } from './spawner';
import { floorPointVisible, spawnView } from './camera';

const makeRun = (seed = 'collision') => new Run(new EventBus(), { seed, characterId: 'lint' });

/** Open floor spot (not under furniture, clear of walls by `clear`). */
function openFloor(run: Run, clear = 90): { x: number; z: number } {
  const bd = run.house.bounds;
  for (let x = bd.minX + clear; x < bd.maxX - clear; x += 20) {
    for (let z = bd.minZ + clear; z < bd.maxZ - clear; z += 20) {
      if (hazardFloorFree(run.house, x, z, clear, 500)) return { x, z };
    }
  }
  throw new Error('no open floor');
}

describe('doorway squeeze', () => {
  it('lets a Bunny wider than the door through it, and only in the doorway', () => {
    const run = makeRun();
    const door = run.house.doorways.find((d) => d.rect.maxX - d.rect.minX > d.rect.maxZ - d.rect.minZ)!;
    const cx = (door.rect.minX + door.rect.maxX) / 2;
    const cz = (door.rect.minZ + door.rect.maxZ) / 2;
    const half = (door.rect.maxX - door.rect.minX) / 2;
    expect(wallRadiusAt(run.house, cx, cz + 40, 50)).toBeLessThan(half);
    expect(wallRadiusAt(run.house, cx, cz + 40, 20)).toBe(20);
    expect(wallRadiusAt(run.house, cx + half + 30, cz + 40, 50)).toBe(50);

    // Drive a r = 55 Bunny straight through the doorway.
    const b = run.bunny;
    b.setRadius(55);
    run.debris.clear();
    b.x = b.prevX = cx;
    b.z = b.prevZ = cz - 70;
    run.input = { sample: () => ({ moveX: 0, moveZ: 1, dash: false }) };
    for (let i = 0; i < 240; i++) run.update(1 / 60);
    expect(b.z).toBeGreaterThan(cz + 50);
  });
});

describe('pushing almost-absorbable Debris', () => {
  it('shoves Debris a bit too big to absorb instead of stopping the Bunny', () => {
    const run = makeRun();
    const spot = openFloor(run);
    run.debris.clear();
    const b = run.bunny;
    b.setRadius(10);
    b.x = b.prevX = spot.x;
    b.z = b.prevZ = spot.z;
    const i = run.debris.types.findIndex((t) => t.id === 'sock');
    const pushable = run.debris.spawn(i, spot.x + 17, spot.z, run.rng, { size: 9 })!; // 0.9 × r
    const x0 = pushable.x;
    collisionSystem.update(1 / 60, run);
    expect(pushable.alive).toBe(true);
    expect(pushable.x).toBeGreaterThan(x0);
    expect(b.x).toBeGreaterThan(spot.x - 1); // barely pushed back

    const heavy = run.debris.spawn(i, spot.x - 22, spot.z, run.rng, { size: 9 * 1.5 })!; // too big to push
    const hx = heavy.x;
    collisionSystem.update(1 / 60, run);
    expect(heavy.x).toBe(hx);
  });

  it('never shoves Debris into walls', () => {
    const run = makeRun();
    run.debris.clear();
    const b = run.bunny;
    b.setRadius(10);
    const wall = run.house.walls[0]!.rect; // top outer wall
    const x = (wall.minX + wall.maxX) / 2;
    const i = run.debris.types.findIndex((t) => t.id === 'sock');
    const d = run.debris.spawn(i, x, wall.maxZ + 8.5, run.rng, { size: 9 })!;
    b.x = b.prevX = x;
    b.z = b.prevZ = d.z + 17;
    for (let n = 0; n < 30; n++) {
      b.z -= 2;
      collisionSystem.update(1 / 60, run);
    }
    expect(d.z - d.size * 0.85).toBeGreaterThanOrEqual(wall.maxZ - 1e-6);
  });
});

describe('spawner placement rules', () => {
  it('treats Debris under furniture the Bunny outgrew as unreachable', () => {
    const run = makeRun();
    const bed = run.house.obstacles.find((o) => o.kind === 'furniture' && o.clearance >= 20 && o.rect.maxX - o.rect.minX > 100)!;
    const cx = (bed.rect.minX + bed.rect.maxX) / 2;
    const cz = (bed.rect.minZ + bed.rect.maxZ) / 2;
    expect(reachableBy(run.house, cx, cz, 2, bed.clearance / 2 - 1)).toBe(true);
    expect(reachableBy(run.house, cx, cz, 2, bed.clearance / 2 + 1)).toBe(false);
    // Poking out past the edge stays reachable.
    expect(reachableBy(run.house, bed.rect.minX + 1, cz, 2, 40)).toBe(true);
  });

  it('keeps clutter far enough apart for a Bunny that can neither absorb nor push it', () => {
    const s = 18;
    const smallest = Math.min(s / 0.7, s / TUNING.push.ratio);
    expect(clutterSpacing(s, s) - 0.85 * 2 * s).toBeCloseTo(2 * smallest);
    const run = makeRun();
    run.debris.clear();
    const i = run.debris.types.findIndex((t) => t.id === 'waste_bin');
    run.debris.spawn(i, 600, 450, run.rng, { size: s });
    expect(clutterFree(run.debris, 600 + s * 2, 450, s)).toBe(false);
    expect(clutterFree(run.debris, 600 + clutterSpacing(s * 1.2, s) + 1, 450, s)).toBe(true);
    expect(clutterFree(run.debris, 600 + s, 450, 1)).toBe(true); // specks never count
  });

  it('tops Debris up off screen only, even late in the Run', () => {
    for (const radius of [2, 12, 30, 46]) {
      const run = makeRun(`offscreen-${radius}`);
      run.bunny.setRadius(radius);
      run.debris.clear();
      run.update(1 / 60);
      for (let n = 0; n < 8; n++) run.spawner.update(1, run);
      const view = spawnView(run);
      let visible = 0;
      run.debris.forEach((d) => {
        if (floorPointVisible(d.x - run.bunny.x, d.z - run.bunny.z, view)) visible++;
      });
      expect(run.debris.count).toBeGreaterThan(0);
      expect(visible).toBe(0);
    }
  });
});
