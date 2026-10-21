import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/events';
import { rect } from '../core/math';
import { Run } from '../game/run';
import type { HouseLayout } from '../world/types';
import { gapRadiusAt } from './collision';

const makeRun = (seed: string) => new Run(new EventBus(), { seed, characterId: 'lint' });

function layoutWith(obstacles: Array<[number, number, number, number]>): HouseLayout {
  const run = makeRun('gap');
  return {
    ...run.house,
    obstacles: obstacles.map(([a, b, c, d], i) => ({ id: `o${i}`, kind: 'furniture' as const, rect: rect(a, b, c, d), height: 50, clearance: 0 })),
  };
}

describe('gap squeeze', () => {
  it('fits a Bunny between obstacles on opposite sides, down to the minimum', () => {
    // Two walls 100 cm apart: z ∈ [0, 100] is open.
    const L = layoutWith([
      [0, -20, 1000, 0],
      [0, 100, 1000, 120],
    ]);
    expect(gapRadiusAt(L, 500, 50, 40)).toBe(40);
    expect(gapRadiusAt(L, 500, 50, 70)).toBeCloseTo(49.5);
    expect(gapRadiusAt(L, 500, 50, 200)).toBeCloseTo(80); // 0.4 × radius: too narrow, stays closed
  });

  it('does not squeeze into a corner or against a single wall', () => {
    const L = layoutWith([
      [0, -20, 1000, 0],
      [-20, -20, 0, 1000],
    ]);
    expect(gapRadiusAt(L, 60, 60, 70)).toBe(70);
    expect(gapRadiusAt(L, 500, 60, 70)).toBe(70);
  });
});

/**
 * Drives a Bunny from in front of each room's hallway door to the front door through the real
 * collision system (no Debris, no Hazards): out of the door, along the hallway, out of the house.
 */
function rollsOut(seed: string, radius: number): string[] {
  const failed: string[] = [];
  const probe = makeRun(seed);
  const hall = probe.house.rooms.find((r) => r.id === 'hallway')!.rect;
  const hallZ = (hall.minZ + hall.maxZ) / 2;
  const exit = probe.house.exit!.rect;
  const exitX = (exit.minX + exit.maxX) / 2;
  for (const door of probe.house.doorways) {
    const roomId = door.rooms[0];
    if (door.rooms[1] !== 'hallway') continue;
    const run = makeRun(seed);
    run.openExit();
    run.debris.clear();
    const dx = (door.rect.minX + door.rect.maxX) / 2;
    const dz = (door.rect.minZ + door.rect.maxZ) / 2;
    const into = dz < hallZ ? -1 : 1; // the room side of the door
    const b = run.bunny;
    b.setRadius(radius);
    b.teleport(dx, dz + into * 85);
    // Through the door into the hallway, then straight for the front door, sliding along
    // whatever is in the way (like a player holding the stick towards it).
    let phase = 0;
    run.input = {
      sample: () => {
        if (phase === 0 && Math.hypot(dx - b.x, dz - b.z) < 25) phase = 1;
        if (phase === 1 && (b.z - dz) * -into > 30) phase = 2;
        const tx = phase === 0 ? dx : phase === 1 ? b.x : exitX;
        const tz = phase === 0 ? dz : phase === 1 ? dz - into * 100 : hallZ;
        const l = Math.hypot(tx - b.x, tz - b.z) || 1;
        return { moveX: (tx - b.x) / l, moveZ: (tz - b.z) / l, dash: false };
      },
    };
    for (let i = 0; i < 60 * 25 && run.area === 'house'; i++) run.update(1 / 60);
    if (run.area === 'house') failed.push(`${roomId} (stuck at ${b.x.toFixed(0)}, ${b.z.toFixed(0)})`);
  }
  return failed;
}

describe('a Bunny that outgrew the hallway', () => {
  for (const radius of [55, 75, 95]) {
    it(`still rolls out of every room to the front door at r = ${radius}`, () => {
      for (const seed of ['squeeze-a', 'squeeze-b', 'squeeze-c', 'squeeze-d', 'squeeze-e', 'squeeze-f']) {
        expect(rollsOut(seed, radius), seed).toEqual([]);
      }
    });
  }
});
