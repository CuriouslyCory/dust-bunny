import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/events';
import { createRun } from '../game/assembly';
import { Run } from '../game/run';
import { roomAt } from './house';
import { GLOBE, generateGlobe } from './globe';
import { generateContinent } from './continent';
import { canonicalX, insideBounds, nearestImageX, wrapCopies, wrapDeltaX, wrapWidth } from './wrap';

describe('wrap helpers', () => {
  const globe = generateGlobe('wrap');
  const W = GLOBE.width;

  it('wraps only maps that ask for it', () => {
    const continent = generateContinent('wrap');
    expect(wrapWidth(continent)).toBe(0);
    expect(canonicalX(continent, -5)).toBe(-5);
    expect(nearestImageX(continent, 1e4, 0)).toBe(1e4);
    expect(wrapCopies(continent, 1e4)).toEqual([0]);
    expect(insideBounds(continent, -5, 10)).toBe(false);
    expect(wrapWidth(globe)).toBe(W);
  });

  it('moves x into the canonical strip by whole laps', () => {
    expect(canonicalX(globe, 10)).toBe(10);
    expect(canonicalX(globe, W + 10)).toBeCloseTo(10);
    expect(canonicalX(globe, -10)).toBeCloseTo(W - 10);
    expect(canonicalX(globe, 7 * W + 3)).toBeCloseTo(3);
    expect(canonicalX(globe, W)).toBe(0);
    expect(insideBounds(globe, -3 * W, 10)).toBe(true);
    expect(insideBounds(globe, 0, -1)).toBe(false);
  });

  it('finds the nearest copy and the short way round', () => {
    expect(nearestImageX(globe, 5, W - 5)).toBeCloseTo(W + 5);
    expect(nearestImageX(globe, W - 5, 5)).toBeCloseTo(-5);
    expect(wrapDeltaX(globe, W - 5, 5)).toBeCloseTo(10);
    expect(wrapDeltaX(globe, 5, W - 5)).toBeCloseTo(-10);
    expect(wrapCopies(globe, 2.5 * W)).toEqual([W, 2 * W, 3 * W]);
    expect(wrapCopies(globe, -0.5 * W)).toEqual([-2 * W, -W, 0]);
  });

  it('looks rooms up on any lap', () => {
    for (const x of [3, 120, 260, 399]) {
      expect(roomAt(globe, x + 3 * W, 50)).toBe(roomAt(globe, x, 50));
      expect(roomAt(globe, x - 2 * W, 50)).toBe(roomAt(globe, x, 50));
    }
  });
});

describe('globe layout', () => {
  for (const seed of ['a', 'b', 'c']) {
    it(`is a wrap-around map of zones with open ocean at the seam (seed ${seed})`, () => {
      const g = generateGlobe(seed);
      expect(g.area).toBe('globe');
      expect(g.wrapX).toBe(true);
      expect(g.exit).toBeUndefined();
      expect(g.obstacles).toEqual([]);
      for (let x = 0.5; x < GLOBE.width; x += 4) for (let z = 0.5; z < GLOBE.depth; z += 4) expect(roomAt(g, x, z), `${x},${z}`).toBeDefined();
      for (let z = GLOBE.northCap[1] + 1; z < GLOBE.depth - GLOBE.southCap[1] - 1; z += 2) {
        expect(roomAt(g, 0.5, z)?.type).toBe('oceans');
        expect(roomAt(g, GLOBE.width - 0.5, z)?.type).toBe('oceans');
      }
      expect(roomAt(g, g.spawn.x, g.spawn.z)?.id).toBe(g.spawn.roomId);
      for (const t of ['oceans', 'shelves', 'landmasses', 'archipelagos', 'icecaps']) expect(g.rooms.some((r) => r.type === t), t).toBe(true);
      const orbits = g.routes!.filter((r) => r.kind === 'orbit');
      expect(orbits.length).toBeGreaterThan(0);
      for (const o of orbits) expect([o.points[0]!.x, o.points.at(-1)!.x]).toEqual([0, GLOBE.width]);
    });
  }
});

describe('rolling round the Globe', () => {
  it('rolls off the east edge onto the west, with Debris and Hazards kept around the Bunny', () => {
    const run = createRun(new EventBus(), { seed: 'lap', characterId: 'zap', area: 'globe' });
    const b = run.bunny;
    const W = GLOBE.width;
    // Just short of the east edge, over open ocean.
    b.teleport(W - 1, GLOBE.depth / 2);
    for (let i = 0; i < 60; i++) {
      b.vx = 20;
      b.vz = 0;
      run.update(1 / 60);
    }
    // The collision System no longer stops it at the edge: x carries on past the bounds.
    expect(b.x).toBeGreaterThan(W);
    expect(roomAt(run.house, b.x, b.z)).toBe(roomAt(run.house, canonicalX(run.house, b.x), b.z));
    // After the wrap System's pass nothing is more than half a lap from the Bunny.
    run.update(0.6);
    run.debris.forEach((d) => expect(Math.abs(d.x - b.x)).toBeLessThanOrEqual(W / 2 + 1e-6));
    for (const h of run.hazards.hazards) if (!h.dead) expect(Math.abs(h.x - b.x)).toBeLessThanOrEqual(W / 2);
    // The spawner tops the area beyond the seam up as well.
    const east: number[] = [];
    run.debris.forEach((d) => {
      if (d.x > W) east.push(d.x);
    });
    expect(east.length).toBeGreaterThan(0);
    run.dispose();
  });

  it('keeps the Bunny inside the poles', () => {
    const run = new Run(new EventBus(), { seed: 'pole', characterId: 'lint', area: 'globe' });
    const b = run.bunny;
    b.teleport(GLOBE.width / 2, 0.2);
    run.update(1 / 60);
    expect(b.z).toBeGreaterThanOrEqual(b.radius * 0.39);
  });
});
