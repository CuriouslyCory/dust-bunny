import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/events';
import { rectContains, rectsOverlap } from '../core/math';
import { AREAS } from '../data/areas';
import { DEBRIS_TYPES, getDebrisType } from '../data/debris';
import { TIERS } from '../data/tiers';
import { BASE_BUNNY_STATS } from '../entities/stats';
import { Run } from '../game/run';
import { DebrisSpawner, isFloorFree } from '../systems/spawner';
import { CITY, generateCity } from './city';
import { roomAt } from './house';
import { generateNeighborhood } from './neighborhood';
import { CITY_ZONE_TYPES, isCityZone } from './types';

describe('city generation', () => {
  it('is deterministic per seed', () => {
    expect(generateCity('x')).toEqual(generateCity('x'));
    expect(generateCity('x').furniture).not.toEqual(generateCity('y').furniture);
  });

  for (const seed of ['a', 'b', 'c', 'd', 'e', 'f']) {
    it(`builds a valid layout (seed ${seed})`, () => {
      const c = generateCity(seed);
      expect(c.area).toBe('city');
      expect(c.bounds).toEqual({ minX: 0, minZ: 0, maxX: CITY.width, maxZ: CITY.depth });
      for (const r of c.rooms) expect(isCityZone(r.type)).toBe(true);
      // Zones tile the map without overlapping.
      for (let i = 0; i < c.rooms.length; i++) for (let j = i + 1; j < c.rooms.length; j++) expect(rectsOverlap(c.rooms[i]!.rect, c.rooms[j]!.rect, -0.5)).toBe(false);
      for (let x = 50; x < CITY.width; x += 700) for (let z = 50; z < CITY.depth; z += 700) expect(roomAt(c, x, z)).toBeDefined();
      // Buildings stand in plazas, never on roads or sidewalks.
      const buildings = c.furniture.filter((f) => f.defId.startsWith('building_'));
      expect(buildings.length).toBeGreaterThan(12);
      for (const b of buildings) {
        for (const r of c.rooms) if (r.type === 'avenue' || r.type === 'pavement') expect(rectsOverlap(b.rect, r.rect)).toBe(false);
      }
      expect(c.rooms.filter((r) => r.type === 'square')).toHaveLength(1);
      expect(c.rooms.filter((r) => r.type === 'parking')).toHaveLength(2);
      // The Bunny arrives on free road, big enough for a Street-Sweeper-sized Bunny.
      expect(isFloorFree(c, c.spawn.x, c.spawn.z, CITY.debugStartRadius)).not.toBeNull();
      expect(rectContains(c.bounds, c.spawn.x, c.spawn.z)).toBe(true);
      // Fixed Debris refers to real city types (plus the neighborhood's cars and benches) and lands in the map.
      for (const p of c.debrisPlacements) {
        const t = getDebrisType(p.typeId);
        expect(t, p.typeId).toBeDefined();
        if (p.typeId !== 'car' && p.typeId !== 'park_bench') expect(t!.area, p.typeId).toBe('city');
        expect(roomAt(c, p.x, p.z)).toBeDefined();
      }
      expect(c.exit).toBeUndefined();
    });
  }
});

describe('road to the city', () => {
  it('the neighborhood has a closed road barrier at one end of the main street', () => {
    const n = generateNeighborhood('gate');
    const exit = n.exit!;
    expect(exit.open).toBe(false);
    expect(n.obstacles.some((o) => o.id === exit.obstacleId)).toBe(true);
    expect(exit.rect.minX <= 0 || exit.rect.maxX >= n.bounds.maxX).toBe(true);
    // The barrier spans the main street, which is wide enough for a Street-Sweeper-sized Bunny.
    const street = n.rooms.find((r) => r.id === 'main_street')!;
    expect(exit.rect.minZ).toBeLessThanOrEqual(street.rect.minZ);
    expect(exit.rect.maxZ).toBeGreaterThanOrEqual(street.rect.maxZ);
  });

  it('a Run can start in the city (debug), keeping its Tier', () => {
    const run = new Run(new EventBus(), { seed: 'city-start', characterId: 'lint', area: 'city' });
    expect(run.area).toBe('city');
    expect(run.houseCleared).toBe(true);
    expect(run.neighborhoodCleared).toBe(true);
    expect(run.bunny.radius).toBeGreaterThanOrEqual(CITY.debugStartRadius);
    expect(run.tier).toBe(7);
    expect(run.debris.count).toBeGreaterThan(500);
  });
});

describe('city Debris catalogue', () => {
  const city = DEBRIS_TYPES.filter((t) => t.area === 'city');
  const ratio = BASE_BUNNY_STATS.absorbRatio;

  it('only uses city zones and the city Tier band', () => {
    const [lo, hi] = AREAS.city.tiers;
    for (const t of city) {
      expect(t.tiers[0], t.id).toBeGreaterThanOrEqual(lo);
      expect(t.tiers[1], t.id).toBeLessThanOrEqual(hi);
      for (const room of Object.keys(t.rooms)) expect(room === 'any' || isCityZone(room as never), `${t.id}.${room}`).toBe(true);
    }
  });

  // Start, middle and end of each city Tier (Tier 7 from the arrival size, Tier 9 up to the boss size).
  const bands: Array<[number, number[]]> = [
    [7, [CITY.debugStartRadius, 275, TIERS[7]!.minRadius - 1]],
    [8, [TIERS[7]!.minRadius, 460, TIERS[8]!.minRadius - 1]],
    [9, [TIERS[8]!.minRadius, 700, 800]],
  ];
  for (const [tier, radii] of bands) {
    for (const r of radii) {
      it(`spawns absorbable, meaningful Debris for a Tier ${tier} Bunny at r=${r}`, () => {
        const ids = new Set<string>();
        for (const t of city) {
          if (t.size > r * ratio) continue;
          if (CITY_ZONE_TYPES.some((room) => DebrisSpawner.spawnWeight(t, r, ratio, tier, room) > 0)) ids.add(t.id);
        }
        expect(ids.size, [...ids].join(',')).toBeGreaterThanOrEqual(4);
      });
    }
  }
});
