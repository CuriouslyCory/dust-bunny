import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/events';
import { rectContains, rectsOverlap, type Rect } from '../core/math';
import { AREAS } from '../data/areas';
import { DEBRIS_TYPES, getDebrisType, roomWeight } from '../data/debris';
import { BASE_BUNNY_STATS } from '../entities/stats';
import { Run } from '../game/run';
import { DebrisSpawner, isFloorFree } from '../systems/spawner';
import { CONTINENT, generateContinent } from './continent';
import { roomAt } from './house';
import { CONTINENT_ZONE_TYPES, isContinentZone } from './types';

const ratio = BASE_BUNNY_STATS.absorbRatio;

function rectGap(a: Rect, b: Rect): number {
  return Math.hypot(Math.max(0, a.minX - b.maxX, b.minX - a.maxX), Math.max(0, a.minZ - b.maxZ, b.minZ - a.maxZ));
}

describe('continent generation (placeholder)', () => {
  it('is deterministic per seed', () => {
    expect(generateContinent('x')).toEqual(generateContinent('x'));
    expect(generateContinent('x').rooms).not.toEqual(generateContinent('y').rooms);
  });

  for (const seed of ['a', 'b', 'c', 'd']) {
    it(`builds a valid layout in Continent units (seed ${seed})`, () => {
      const g = generateContinent(seed);
      expect(g.area).toBe('continent');
      // The last built Area: no exit (the Ice Sheet wins the Run).
      expect(g.exit).toBeUndefined();
      expect(g.bounds).toEqual({ minX: 0, minZ: 0, maxX: CONTINENT.width, maxZ: CONTINENT.depth });
      for (const r of g.rooms) expect(isContinentZone(r.type)).toBe(true);
      expect(new Set(g.rooms.map((r) => r.type))).toEqual(new Set(CONTINENT_ZONE_TYPES));
      for (let i = 0; i < g.rooms.length; i++) for (let j = i + 1; j < g.rooms.length; j++) expect(rectsOverlap(g.rooms[i]!.rect, g.rooms[j]!.rect, -0.01)).toBe(false);
      for (let x = 0.5; x < CONTINENT.width; x += 3) for (let z = 0.5; z < CONTINENT.depth; z += 3) expect(roomAt(g, x, z), `${x},${z}`).toBeDefined();
      // The Bunny arrives at the east edge on free floor, sized after the arrival leap.
      expect(g.spawn.x).toBeGreaterThan(CONTINENT.width - 12);
      expect(isFloorFree(g, g.spawn.x, g.spawn.z, AREAS.continent.arrivalRadius!)).not.toBeNull();
      // Massifs stand in the mountain belt, a Bunny-wide gap from each other and the edge.
      expect(g.furniture.length).toBeGreaterThanOrEqual(1);
      for (const f of g.furniture) {
        expect(roomAt(g, f.x, f.z)?.type).toBe('mountains');
        for (const o of g.furniture) if (o !== f) expect(rectGap(f.rect, o.rect)).toBeGreaterThanOrEqual(CONTINENT.obstacleGap);
        for (const w of g.walls) expect(rectGap(f.rect, w.rect)).toBeGreaterThanOrEqual(CONTINENT.obstacleGap);
      }
      // Fixed Debris is continent Debris in a zone it spawns in, clear of obstacles.
      for (const p of g.debrisPlacements) {
        const t = getDebrisType(p.typeId)!;
        expect(t.area, p.typeId).toBe('continent');
        const room = roomAt(g, p.x, p.z)!;
        expect(roomWeight(t, room.type), `${p.typeId} in ${room.type}`).toBeGreaterThan(0);
        expect(isFloorFree(g, p.x, p.z, t.size)).not.toBeNull();
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

describe('continent Debris catalogue (placeholder)', () => {
  const continent = DEBRIS_TYPES.filter((t) => t.area === 'continent');

  it('only uses continent zones and Tiers 11–13', () => {
    expect(continent.length).toBeGreaterThanOrEqual(8);
    for (const t of continent) {
      expect(t.tiers[0], t.id).toBeGreaterThanOrEqual(11);
      expect(t.tiers[1], t.id).toBeLessThanOrEqual(13);
      for (const room of Object.keys(t.rooms)) expect(isContinentZone(room as never), `${t.id}.${room}`).toBe(true);
    }
  });

  it('feeds the arriving Bunny and a Tier 13 Bunny', () => {
    for (const [r, tier] of [[AREAS.continent.arrivalRadius!, 12], [2, 12], [3.5, 13]] as const) {
      const ids = continent.filter((t) => t.size <= r * ratio && CONTINENT_ZONE_TYPES.some((room) => DebrisSpawner.spawnWeight(t, r, ratio, tier, room) > 0));
      expect(ids.length, `r=${r}`).toBeGreaterThanOrEqual(3);
    }
  });
});
