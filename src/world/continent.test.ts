import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/events';
import { rectContains, rectsOverlap, type Rect } from '../core/math';
import { AREAS } from '../data/areas';
import { DEBRIS_TYPES, getDebrisType, roomWeight } from '../data/debris';
import { TIERS } from '../data/tiers';
import { BASE_BUNNY_STATS } from '../entities/stats';
import { Run } from '../game/run';
import { DebrisSpawner, isFloorFree } from '../systems/spawner';
import { CONTINENT, generateContinent, MOUNTAIN_OBSTACLE_DEFS, mountainObstacleIds } from './continent';
import { roomAt } from './house';
import { AREA_ORDER, CONTINENT_ZONE_TYPES, isContinentZone, zoneArea, type HouseLayout, type RoomType } from './types';

const ratio = BASE_BUNNY_STATS.absorbRatio;

function rectGap(a: Rect, b: Rect): number {
  return Math.hypot(Math.max(0, a.minX - b.maxX, b.minX - a.maxX), Math.max(0, a.minZ - b.maxZ, b.minZ - a.maxZ));
}

/**
 * Share of the land a Bunny of `radius` can stand on that it can also roll to from the spawn
 * (4-neighbour flood fill on a 0.5-unit grid; obstacles are the sea, the ranges and the fixed
 * Debris it is too small to absorb), and the standable share of the map.
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

describe('continent generation', () => {
  it('is deterministic per seed', () => {
    expect(generateContinent('x')).toEqual(generateContinent('x'));
    expect(generateContinent('x').rooms).not.toEqual(generateContinent('y').rooms);
  });

  for (const seed of ['a', 'b', 'c', 'd', 'e', 'f']) {
    it(`builds a valid layout in Continent units (seed ${seed})`, () => {
      const g = generateContinent(seed);
      expect(g.area).toBe('continent');
      // The last built Area: no exit (the Ice Sheet wins the Run).
      expect(g.exit).toBeUndefined();
      expect(g.bounds).toEqual({ minX: 0, minZ: 0, maxX: CONTINENT.width, maxZ: CONTINENT.depth });
      for (const r of g.rooms) expect(isContinentZone(r.type)).toBe(true);
      expect(new Set(g.rooms.map((r) => r.type))).toEqual(new Set(CONTINENT_ZONE_TYPES));
      // Zones tile the map without overlapping.
      for (let i = 0; i < g.rooms.length; i++) for (let j = i + 1; j < g.rooms.length; j++) expect(rectsOverlap(g.rooms[i]!.rect, g.rooms[j]!.rect, -0.01)).toBe(false);
      for (let x = 0.5; x < CONTINENT.width; x += 3) for (let z = 0.5; z < CONTINENT.depth; z += 3) expect(roomAt(g, x, z), `${x},${z}`).toBeDefined();
      // The coast: sea along every edge (walls), no gap anywhere along the map edge.
      for (const w of g.walls) expect(w.id.startsWith('coast'), w.id).toBe(true);
      const inSea = (x: number, z: number) => g.walls.some((w) => rectContains(w.rect, x, z));
      for (let t = 0.5; t < CONTINENT.width; t += 1) expect(inSea(t, 0.5) && inSea(t, CONTINENT.depth - 0.5), `x=${t}`).toBe(true);
      for (let t = 0.5; t < CONTINENT.depth; t += 1) expect(inSea(0.5, t) && inSea(CONTINENT.width - 0.5, t), `z=${t}`).toBe(true);
      // The north is tundra (where the ice comes from), the south-west desert.
      expect(roomAt(g, 100, 9)?.type).toBe('tundra');
      expect(g.rooms.filter((r) => r.type === 'tundra').every((r) => r.rect.minZ < 40)).toBe(true);
      expect(g.rooms.filter((r) => r.type === 'desert').every((r) => r.rect.minZ >= 85 && r.rect.minX < 90)).toBe(true);
      // Ruined cities, a lake district.
      expect(g.rooms.filter((r) => r.type === 'ruins' && !r.id.includes('.')).length).toBeGreaterThanOrEqual(4);
      expect(g.rooms.filter((r) => r.type === 'lakes' && !r.id.includes('.')).length).toBeGreaterThanOrEqual(4);
      // The Bunny arrives at the east edge on free plains, sized after the arrival leap.
      expect(g.spawn.x).toBeGreaterThan(CONTINENT.width - 12);
      expect(isFloorFree(g, g.spawn.x, g.spawn.z, AREAS.continent.arrivalRadius! * 1.5)).toBe('plains');
      // Fixed Debris is continent Debris in a zone it spawns in, clear of the sea and the ranges.
      expect(g.debrisPlacements.length).toBeGreaterThan(80);
      for (const p of g.debrisPlacements) {
        const t = getDebrisType(p.typeId)!;
        expect(t.area, p.typeId).toBe('continent');
        const room = roomAt(g, p.x, p.z)!;
        expect(roomWeight(t, room.type), `${p.typeId} in ${room.type}`).toBeGreaterThan(0);
        expect(isFloorFree(g, p.x, p.z, t.size), `${p.typeId} at ${p.x},${p.z}`).not.toBeNull();
      }
      expect(g.markings!.length).toBeGreaterThan(30);
    });
  }

  for (const seed of ['a', 'b', 'c', 'd']) {
    it(`stands mountain ranges as obstacles a Bunny-wide gap apart (seed ${seed})`, () => {
      const g = generateContinent(seed);
      expect(g.furniture.length).toBeGreaterThanOrEqual(4);
      expect(g.furniture.filter((f) => f.defId === 'continent_range').length).toBeGreaterThanOrEqual(3);
      for (const f of g.furniture) {
        expect(MOUNTAIN_OBSTACLE_DEFS).toContain(f.defId);
        expect(roomAt(g, f.x, f.z)?.type).toBe('mountains');
        for (const r of g.rooms) if (r.type === 'rivers' || r.type === 'lakes') expect(rectsOverlap(f.rect, r.rect), `${f.id} on ${r.id}`).toBe(false);
        for (const o of g.furniture) if (o !== f) expect(rectGap(f.rect, o.rect)).toBeGreaterThanOrEqual(CONTINENT.obstacleGap);
        for (const w of g.walls) expect(rectGap(f.rect, w.rect)).toBeGreaterThanOrEqual(CONTINENT.obstacleGap);
        expect(Math.hypot(f.x - g.spawn.x, f.z - g.spawn.z)).toBeGreaterThan(20);
      }
      // Every range is an obstacle the Hazards can recognise; the sea is not one.
      const ids = mountainObstacleIds(g);
      expect(ids.size).toBe(g.furniture.length);
      for (const o of g.obstacles) expect(ids.has(o.id), o.id).toBe(o.kind === 'furniture');
    });
  }

  for (const seed of ['a', 'b', 'c']) {
    it(`lets a Bunny of any Continent size roll to almost all of the land (seed ${seed})`, () => {
      const g = generateContinent(seed);
      for (const r of [AREAS.continent.arrivalRadius!, 2.5, 4.5]) {
        const { reachable, standable } = reach(g, r);
        expect(reachable, `r=${r}`).toBeGreaterThan(0.97);
        expect(standable, `r=${r}`).toBeGreaterThan(0.6);
      }
    });
  }

  for (const seed of ['a', 'b', 'c', 'd']) {
    it(`exposes the rivers and glacier lanes as routes (seed ${seed})`, () => {
      const g = generateContinent(seed);
      const rivers = g.routes!.filter((r) => r.kind === 'river');
      expect(rivers.map((r) => r.id).sort()).toEqual(['riverA', 'riverB', 'riverC']);
      for (const river of rivers) {
        // Axis-aligned reaches, each a `rivers` zone named in course order (riverA0, riverA1, …).
        for (let i = 0; i + 1 < river.points.length; i++) {
          const a = river.points[i]!;
          const b = river.points[i + 1]!;
          expect(a.x === b.x || a.z === b.z, `${river.id} reach ${i}`).toBe(true);
          const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
          expect(roomAt(g, mid.x, mid.z)?.type, `${river.id} reach ${i}`).toBe('rivers');
          expect(g.rooms.some((r) => r.id === `${river.id}${i}`), `${river.id}${i}`).toBe(true);
        }
        // The course ends at the coast, on land (clipped), not out in the sea.
        const end = river.points[river.points.length - 1]!;
        expect(g.walls.some((w) => rectContains(w.rect, end.x, end.z))).toBe(false);
        expect(g.walls.some((w) => rectGap(w.rect, { minX: end.x - 3, minZ: end.z - 3, maxX: end.x + 3, maxZ: end.z + 3 }) === 0)).toBe(true);
      }
      // Glacier lanes run south across the tundra from the north coast, clear of the sea and ranges.
      const glaciers = g.routes!.filter((r) => r.kind === 'glacier');
      expect(glaciers.length).toBeGreaterThanOrEqual(2);
      for (const lane of glaciers) {
        const [a, b] = lane.points as [{ x: number; z: number }, { x: number; z: number }];
        expect(a.x).toBe(b.x);
        expect(b.z - a.z).toBeGreaterThanOrEqual(8);
        expect(roomAt(g, a.x, a.z + 1)?.type).toBe('tundra');
        for (let z = a.z; z <= b.z; z += 0.5) for (const o of g.obstacles) expect(rectContains(o.rect, a.x, z), `${lane.id} at z=${z} in ${o.id}`).toBe(false);
      }
    });
  }

  it('a Run can start in the continent (debug): Incinerator-beaten size, then the arrival leap', () => {
    const run = new Run(new EventBus(), { seed: 'continent-start', characterId: 'lint', area: 'continent' });
    expect(run.area).toBe('continent');
    expect(run.bunny.radius).toBe(AREAS.continent.arrivalRadius);
    expect(run.tier).toBe(11);
    expect(run.debris.count).toBeGreaterThan(1000);
    const near = [] as Array<{ size: number }>;
    run.debris.forEach((d) => {
      if (Math.hypot(d.x - run.bunny.x, d.z - run.bunny.z) < AREAS.continent.startClusterRadius + 2 && d.size <= run.bunny.radius * ratio) near.push(d);
    });
    expect(near.length).toBeGreaterThan(40);
    expect(rectContains(run.house.bounds, run.bunny.x, run.bunny.z)).toBe(true);
  });
});

describe('continent Debris catalogue', () => {
  const continent = DEBRIS_TYPES.filter((t) => t.area === 'continent');
  const unit = AREAS.continent.unit;

  it('only uses continent zones and Tiers 11–13, from forests to mountain chains', () => {
    expect(continent.length).toBeGreaterThanOrEqual(30);
    for (const t of continent) {
      expect(t.tiers[0], t.id).toBeGreaterThanOrEqual(11);
      expect(t.tiers[1], t.id).toBeLessThanOrEqual(13);
      expect(Object.keys(t.rooms).length, t.id).toBeGreaterThan(0);
      for (const room of Object.keys(t.rooms)) expect(isContinentZone(room as never), `${t.id}.${room}`).toBe(true);
    }
    // The GLB props back the types whose id matches a Continent model.
    for (const id of ['forest_patch', 'lake', 'city_ruins', 'mesa', 'iceberg', 'mountain_range']) expect(getDebrisType(id)?.area, id).toBe('continent');
  });

  it('weighs 0 outside the Continent, and Debris of other Areas weighs 0 here', () => {
    const otherZones = (['living', 'yard', 'avenue', 'farmland', 'river', 'town'] as RoomType[]).filter((z) => zoneArea(z) !== 'continent');
    for (const t of continent) for (const z of otherZones) expect(roomWeight(t, z), `${t.id} in ${z}`).toBe(0);
    for (const t of DEBRIS_TYPES.filter((d) => (d.area ?? 'house') !== 'continent')) for (const z of CONTINENT_ZONE_TYPES) expect(roomWeight(t, z), `${t.id} in ${z}`).toBe(0);
    expect(AREA_ORDER).toContain('continent');
  });

  it('every type is spawnable and absorbable somewhere on the ladder before the Ice Sheet is', () => {
    // Bunny radii from the leap to past the Ice Sheet (≈4 units), with the Tier the spawner uses there.
    const ladder: Array<[number, number]> = [];
    for (let r = AREAS.continent.arrivalRadius!; r <= 4.6; r += 0.05) ladder.push([r, Math.max(12, r * unit >= TIERS[12]!.minRadius ? 13 : 12)]);
    for (const t of continent) {
      const spawnable = ladder.some(([r, tier]) => CONTINENT_ZONE_TYPES.some((z) => DebrisSpawner.spawnWeight(t, r, ratio, tier, z) > 0));
      expect(spawnable, t.id).toBe(true);
      expect(t.size <= 4.5 * ratio, `${t.id} absorbable by r=4.5`).toBe(true);
    }
  });

  // From the arrival leap through Tier 12 and Tier 13 up to past the Ice Sheet.
  const bands: Array<[number, number[]]> = [
    [12, [AREAS.continent.arrivalRadius!, 1, 1.5, 2.2, TIERS[12]!.minRadius / unit - 0.01]],
    [13, [TIERS[12]!.minRadius / unit, 3.5, 4, 4.5]],
  ];
  for (const [tier, radii] of bands) {
    for (const r of radii) {
      it(`spawns absorbable, meaningful Debris for a Tier ${tier} Bunny at r=${r} units`, () => {
        const ids = new Set<string>();
        for (const t of continent) {
          if (t.size > r * ratio) continue;
          if (CONTINENT_ZONE_TYPES.some((room) => DebrisSpawner.spawnWeight(t, r, ratio, tier, room) > 0)) ids.add(t.id);
        }
        expect(ids.size, [...ids].join(',')).toBeGreaterThanOrEqual(6);
      });
    }
  }

  it('feeds every zone at the arrival size and at Tier 13', () => {
    for (const [r, tier] of [[AREAS.continent.arrivalRadius!, 12], [3.5, 13], [4.5, 13]] as const) {
      for (const room of CONTINENT_ZONE_TYPES) {
        const n = continent.filter((t) => t.size <= r * ratio && DebrisSpawner.spawnWeight(t, r, ratio, tier, room) > 0).length;
        expect(n, `${room} at r=${r}`).toBeGreaterThanOrEqual(1);
      }
    }
  });
});
