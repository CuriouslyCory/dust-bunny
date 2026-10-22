import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/events';
import { rectContains, rectsOverlap, type Rect } from '../core/math';
import { AREAS } from '../data/areas';
import { DEBRIS_TYPES, getDebrisType, roomWeight } from '../data/debris';
import { TIERS } from '../data/tiers';
import { BASE_BUNNY_STATS } from '../entities/stats';
import { Run } from '../game/run';
import { DebrisSpawner, isFloorFree } from '../systems/spawner';
import { roomAt } from './house';
import { generateRegion, REGION } from './region';
import { isRegionZone, REGION_ZONE_TYPES, type HouseLayout } from './types';

const ratio = BASE_BUNNY_STATS.absorbRatio;

function rectGap(a: Rect, b: Rect): number {
  return Math.hypot(Math.max(0, a.minX - b.maxX, b.minX - a.maxX), Math.max(0, a.minZ - b.maxZ, b.minZ - a.maxZ));
}

/**
 * Share of the floor a Bunny of `radius` can stand on that it can also roll to from the spawn
 * (4-neighbour flood fill on a 0.5-unit grid). Obstacles are the walls, the landmarks and the
 * fixed Debris it is too small to absorb. Also returns the standable share of the whole map.
 */
function reach(layout: HouseLayout, radius: number): { reachable: number; standable: number } {
  const cell = 0.5;
  const cols = Math.ceil(layout.bounds.maxX / cell);
  const rows = Math.ceil(layout.bounds.maxZ / cell);
  const big = layout.debrisPlacements.map((p) => ({ ...p, s: getDebrisType(p.typeId)!.size * 1.2 })).filter((p) => p.s > radius * ratio);
  const free = new Uint8Array(cols * rows);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const x = (i + 0.5) * cell;
      const z = (j + 0.5) * cell;
      const blocked =
        layout.obstacles.some((o) => Math.hypot(Math.max(0, o.rect.minX - x, x - o.rect.maxX), Math.max(0, o.rect.minZ - z, z - o.rect.maxZ)) < radius) ||
        big.some((p) => Math.hypot(p.x - x, p.z - z) < radius + p.s);
      free[j * cols + i] = blocked ? 0 : 1;
    }
  }
  const seen = new Uint8Array(cols * rows);
  const start = Math.floor(layout.spawn.z / cell) * cols + Math.floor(layout.spawn.x / cell);
  expect(free[start], 'spawn cell is free').toBe(1);
  const queue = [start];
  seen[start] = 1;
  let reached = 0;
  while (queue.length > 0) {
    const k = queue.pop()!;
    reached++;
    const i = k % cols;
    const j = (k - i) / cols;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const ni = i + di;
      const nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
      const n = nj * cols + ni;
      if (free[n] && !seen[n]) {
        seen[n] = 1;
        queue.push(n);
      }
    }
  }
  const total = free.reduce((a, b) => a + b, 0);
  return { reachable: reached / total, standable: total / (cols * rows) };
}

describe('region generation', () => {
  it('is deterministic per seed', () => {
    expect(generateRegion('x')).toEqual(generateRegion('x'));
    expect(generateRegion('x').rooms).not.toEqual(generateRegion('y').rooms);
  });

  for (const seed of ['a', 'b', 'c', 'd', 'e', 'f']) {
    it(`builds a valid layout (seed ${seed})`, () => {
      const g = generateRegion(seed);
      expect(g.area).toBe('region');
      expect(g.exit).toBeUndefined();
      expect(g.bounds).toEqual({ minX: 0, minZ: 0, maxX: REGION.width, maxZ: REGION.depth });
      for (const r of g.rooms) expect(isRegionZone(r.type)).toBe(true);
      expect(new Set(g.rooms.map((r) => r.type))).toEqual(new Set(REGION_ZONE_TYPES));
      // Zones tile the map without overlapping.
      for (let i = 0; i < g.rooms.length; i++) for (let j = i + 1; j < g.rooms.length; j++) expect(rectsOverlap(g.rooms[i]!.rect, g.rooms[j]!.rect, -0.01)).toBe(false);
      for (let x = 0.5; x < REGION.width; x += 3) for (let z = 0.5; z < REGION.depth; z += 3) expect(roomAt(g, x, z), `${x},${z}`).toBeDefined();
      // Several towns, the landfill, and the river's six reaches in course order, each touching the next
      // (the M1 bridge sits between reaches 2 and 3).
      expect(g.rooms.filter((r) => r.type === 'town').length).toBeGreaterThanOrEqual(6);
      const river = [0, 1, 2, 3, 4, 5].map((i) => g.rooms.find((r) => r.id === `river${i}`)!);
      for (const r of river) expect(r.type).toBe('river');
      for (const i of [0, 1, 3, 4]) {
        expect(river[i]!.rect.maxZ).toBe(river[i + 1]!.rect.minZ);
        expect(rectsOverlap(river[i]!.rect, river[i + 1]!.rect, 0.01)).toBe(true);
      }
      expect(river[0]!.rect.minZ).toBe(0);
      expect(river[5]!.rect.maxZ).toBe(REGION.depth);
      // Landmarks stand off the motorways and the river, keep a Bunny-wide gap between them and from the edge.
      expect(g.furniture.filter((f) => f.defId === 'region_city_core').length).toBeGreaterThanOrEqual(2);
      expect(g.furniture.length).toBeGreaterThanOrEqual(5);
      for (const f of g.furniture) {
        expect(f.defId.startsWith('region_'), f.defId).toBe(true);
        for (const r of g.rooms) if (r.type === 'highway' || r.type === 'river') expect(rectsOverlap(f.rect, r.rect), `${f.id} on ${r.id}`).toBe(false);
        for (const o of g.furniture) if (o !== f) expect(rectGap(f.rect, o.rect)).toBeGreaterThanOrEqual(REGION.obstacleGap);
        for (const w of g.walls) expect(rectGap(f.rect, w.rect)).toBeGreaterThanOrEqual(REGION.obstacleGap);
      }
      // The Bunny arrives on the main motorway at the west edge, on free floor.
      expect(roomAt(g, g.spawn.x, g.spawn.z)?.id).toBe('m1');
      expect(g.spawn.x).toBeLessThan(12);
      expect(isFloorFree(g, g.spawn.x, g.spawn.z, REGION.debugStartRadius)).toBe('highway');
      // Fixed Debris refers to region types, sits in a zone the type spawns in and clear of obstacles.
      expect(g.debrisPlacements.length).toBeGreaterThan(200);
      for (const p of g.debrisPlacements) {
        const t = getDebrisType(p.typeId);
        expect(t?.area, p.typeId).toBe('region');
        const room = roomAt(g, p.x, p.z);
        expect(room, `${p.typeId} at ${p.x},${p.z}`).toBeDefined();
        expect(roomWeight(t!, room!.type), `${p.typeId} in ${room!.type}`).toBeGreaterThan(0);
        expect(isFloorFree(g, p.x, p.z, t!.size), `${p.typeId} at ${p.x},${p.z}`).not.toBeNull();
      }
      // Lane markings exist and nothing floats far beyond the out-of-bounds roads.
      expect(g.markings!.length).toBeGreaterThan(500);
    });
  }

  for (const seed of ['a', 'b', 'c']) {
    it(`lets a Bunny of any Region size roll to almost all of the map (seed ${seed})`, () => {
      const g = generateRegion(seed);
      for (const r of [REGION.debugStartRadius, 2.5, 4.5]) {
        const { reachable, standable } = reach(g, r);
        expect(reachable, `r=${r}`).toBeGreaterThan(0.97);
        expect(standable, `r=${r}`).toBeGreaterThan(0.75);
      }
    });
  }

  it('a Run can start in the region (debug), at the Garbage Truck size', () => {
    const run = new Run(new EventBus(), { seed: 'region-start', characterId: 'lint', area: 'region' });
    expect(run.area).toBe('region');
    expect(run.bunny.radius).toBeCloseTo(REGION.debugStartRadius, 5);
    expect(run.tier).toBe(9);
    expect(run.debris.count).toBeGreaterThan(1000);
    // The start cluster gives the arriving Bunny food right away.
    const near = [] as Array<{ size: number }>;
    run.debris.forEach((d) => {
      if (Math.hypot(d.x - run.bunny.x, d.z - run.bunny.z) < AREAS.region.startClusterRadius + 2 && d.size <= run.bunny.radius * ratio) near.push(d);
    });
    expect(near.length).toBeGreaterThan(40);
    expect(rectContains(run.house.bounds, run.bunny.x, run.bunny.z)).toBe(true);
  });
});

describe('region Debris catalogue', () => {
  const region = DEBRIS_TYPES.filter((t) => t.area === 'region');

  it('only uses region zones and the region Tier band', () => {
    expect(region.length).toBeGreaterThanOrEqual(25);
    const [lo, hi] = AREAS.region.tiers;
    for (const t of region) {
      expect(t.tiers[0], t.id).toBeGreaterThanOrEqual(lo);
      expect(t.tiers[1], t.id).toBeLessThanOrEqual(hi);
      expect(Object.keys(t.rooms).length, t.id).toBeGreaterThan(0);
      for (const room of Object.keys(t.rooms)) expect(room === 'any' || isRegionZone(room as never), `${t.id}.${room}`).toBe(true);
    }
  });

  // From the arrival size (after the Garbage Truck) through Tier 10 and Tier 11 up to past the Incinerator.
  const unit = AREAS.region.unit;
  const bands: Array<[number, number[]]> = [
    [10, [0.65, REGION.debugStartRadius, TIERS[9]!.minRadius / unit, 1.5, 2.2, TIERS[10]!.minRadius / unit - 0.01]],
    [11, [TIERS[10]!.minRadius / unit, 3.5, 4, 4.5]],
  ];
  for (const [tier, radii] of bands) {
    for (const r of radii) {
      it(`spawns absorbable, meaningful Debris for a Tier ${tier} Bunny at r=${r} units`, () => {
        const ids = new Set<string>();
        for (const t of region) {
          if (t.size > r * ratio) continue;
          if (REGION_ZONE_TYPES.some((room) => DebrisSpawner.spawnWeight(t, r, ratio, tier, room) > 0)) ids.add(t.id);
        }
        expect(ids.size, [...ids].join(',')).toBeGreaterThanOrEqual(6);
      });
    }
  }

  it('feeds every zone the Bunny can roll into at the arrival size and at Tier 11', () => {
    for (const [r, tier] of [[0.75, 10], [3.5, 11]] as const) {
      for (const room of REGION_ZONE_TYPES) {
        const n = region.filter((t) => t.size <= r * ratio && DebrisSpawner.spawnWeight(t, r, ratio, tier, room) > 0).length;
        expect(n, `${room} at r=${r}`).toBeGreaterThanOrEqual(1);
      }
    }
  });
});
