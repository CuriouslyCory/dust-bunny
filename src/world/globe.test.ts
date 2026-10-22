import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/events';
import { AREAS } from '../data/areas';
import { DEBRIS_TYPES, getDebrisType, roomWeight } from '../data/debris';
import { getTier } from '../data/tiers';
import { BASE_BUNNY_STATS } from '../entities/stats';
import { Run } from '../game/run';
import { viewRadiusFor } from '../systems/camera';
import { DebrisSpawner } from '../systems/spawner';
import { GLOBE, SHAPES, SURFACE, generateGlobe, globeSurface, latToZ, lonToX } from './globe';
import { roomAt } from './house';
import { GLOBE_ZONE_TYPES, isGlobeZone, zoneArea, type RoomType } from './types';

const ratio = BASE_BUNNY_STATS.absorbRatio;
const W = GLOBE.width;
const D = GLOBE.depth;

describe('globe generation', () => {
  it('is deterministic per seed, and seeds differ', () => {
    expect(JSON.stringify(generateGlobe('a'))).toBe(JSON.stringify(generateGlobe('a')));
    expect(JSON.stringify(generateGlobe('a').rooms)).not.toBe(JSON.stringify(generateGlobe('b').rooms));
  });

  it('keeps half a lap beyond the widest view of a 6-unit Tier 15 Bunny', () => {
    // The camera sits 29 × r away; a 16:9 view reaches ≈1.25 × that sideways at the top of the screen.
    const view = viewRadiusFor(6, 15);
    expect(W / 2).toBeGreaterThan((view / 0.85) * 1.26);
    // Tiled detail must repeat a whole number of times per lap (seamless laps).
    for (const tile of [4, 6, 60, 30, 40]) expect(W % tile, `tile ${tile}`).toBe(0);
  });

  for (const seed of ['test', 'globe-1', 42]) {
    const g = generateGlobe(seed);
    const typeAt = (lon: number, lat: number) => roomAt(g, lonToX(lon), latToZ(lat))?.type;

    it(`draws a recognisable Earth (seed ${seed})`, () => {
      // Continents where they belong, oceans between them.
      expect(typeAt(-100, 45)).toBe('landmasses'); // North America
      expect(typeAt(-60, -15)).toBe('landmasses'); // South America
      expect(typeAt(20, 5)).toBe('landmasses'); // Africa
      expect(typeAt(90, 50)).toBe('landmasses'); // Asia
      expect(typeAt(134, -25)).toBe('landmasses'); // Australia
      expect(typeAt(-40, 30)).toBe('oceans'); // the Atlantic
      expect(typeAt(-140, 0)).toBe('oceans'); // the Pacific
      expect(typeAt(75, -20)).toBe('oceans'); // the Indian Ocean
      expect(typeAt(-42, 72)).toBe('icecaps'); // Greenland
      expect(typeAt(0, 88)).toBe('icecaps'); // the Arctic
      expect(typeAt(60, -85)).toBe('icecaps'); // Antarctica
      expect(typeAt(115, 0)).toBe('archipelagos'); // the Malay Archipelago
      expect(typeAt(34, 43)).toBe('shelves'); // the Black Sea
      for (const t of GLOBE_ZONE_TYPES) expect(g.rooms.some((r) => r.type === t), t).toBe(true);
      // Every continent and island chain is a feature of its own.
      for (const s of SHAPES.filter((s) => s.kind === 'land' || s.kind === 'islands')) expect(g.rooms.some((r) => r.id === s.id || r.id.startsWith(`${s.id}.`)), s.id).toBe(true);
    });

    it(`keeps the date line open and the map free of obstacles (seed ${seed})`, () => {
      const surf = globeSurface(g.seed, 2);
      for (let j = 0; j < surf.rows; j++) {
        for (const i of [0, 1, surf.cols - 2, surf.cols - 1]) {
          const k = surf.kind[j * surf.cols + i]!;
          expect(k === SURFACE.ocean || k === SURFACE.ice, `row ${j} col ${i}`).toBe(true);
        }
      }
      for (let z = 0.5; z < D; z += 1) {
        const a = roomAt(g, 0.2, z)!.type;
        expect(a === 'oceans' || a === 'icecaps').toBe(true);
        expect(roomAt(g, W - 0.2, z)!.type).toBe(a === 'icecaps' ? 'icecaps' : roomAt(g, W - 0.2, z)!.type);
      }
      expect(g.obstacles).toEqual([]);
      expect(g.walls).toEqual([]);
      expect(g.wrapX).toBe(true);
    });

    it(`spawns over open water at the equator and places Moons in the open oceans (seed ${seed})`, () => {
      expect(g.spawn).toMatchObject({ x: W / 2, z: D / 2 });
      expect(['oceans', 'shelves']).toContain(roomAt(g, g.spawn.x, g.spawn.z)!.type);
      const moons = g.debrisPlacements.filter((p) => p.typeId === 'moon');
      expect(moons.length).toBe(GLOBE.moons);
      for (const m of moons) {
        expect(roomAt(g, m.x, m.z)!.type).toBe('oceans');
        expect(Math.hypot(m.x - g.spawn.x, m.z - g.spawn.z)).toBeGreaterThan(40);
        expect(m.x).toBeGreaterThan(GLOBE.seamMargin);
        expect(m.x).toBeLessThan(W - GLOBE.seamMargin);
      }
      const reef = g.debrisPlacements.find((p) => p.typeId === 'great_reef');
      expect(reef && roomAt(g, reef.x, reef.z)!.type).toBe('shelves');
      for (const p of g.debrisPlacements) expect(getDebrisType(p.typeId)?.area, p.typeId).toBe('globe');
    });

    it(`runs orbit lanes round the whole lap, clear of the ice (seed ${seed})`, () => {
      const orbits = g.routes!.filter((r) => r.kind === 'orbit');
      expect(orbits.length).toBe(3);
      for (const o of orbits) {
        expect(o.points.map((p) => p.x)).toEqual([0, W]);
        expect(o.points[0]!.z).toBeGreaterThan(GLOBE.northCap[1] + o.width);
        expect(o.points[0]!.z).toBeLessThan(D - GLOBE.southCap[1] - o.width);
        expect(Math.abs(o.points[0]!.z - g.spawn.z)).toBeGreaterThan(o.width);
      }
    });
  }

  it('a Run can start on the Globe (debug): Ice-Sheet-beaten size, then the arrival leap', () => {
    const run = new Run(new EventBus(), { seed: 'globe-start', characterId: 'lint', area: 'globe' });
    expect(run.area).toBe('globe');
    expect(run.bunny.radius).toBe(AREAS.globe.arrivalRadius);
    expect(run.tier).toBe(13);
    expect(run.debris.count).toBeGreaterThan(1000);
    let near = 0;
    run.debris.forEach((d) => {
      if (Math.hypot(d.x - run.bunny.x, d.z - run.bunny.z) < AREAS.globe.startClusterRadius + 2 && d.size <= run.bunny.radius * ratio) near++;
    });
    expect(near).toBeGreaterThan(40);
    let moons = 0;
    run.debris.forEach((d) => {
      if (d.type.id === 'moon') moons++;
    });
    expect(moons).toBeGreaterThanOrEqual(GLOBE.moons);
  });
});

describe('globe Debris catalogue', () => {
  const globe = DEBRIS_TYPES.filter((t) => t.area === 'globe');
  const unit = AREAS.globe.unit;

  it('only uses globe zones and Tiers 13–15, from satellites to an ocean', () => {
    expect(globe.length).toBeGreaterThanOrEqual(25);
    for (const t of globe) {
      expect(t.tiers[0], t.id).toBeGreaterThanOrEqual(13);
      expect(t.tiers[1], t.id).toBeLessThanOrEqual(15);
      expect(t.tiers[1], `${t.id} spawns past the arrival clamp`).toBeGreaterThanOrEqual(14);
      for (const room of Object.keys(t.rooms)) if (room !== 'any') expect(isGlobeZone(room as never), `${t.id}.${room}`).toBe(true);
    }
    // The GLB props back these ids (or `model`s) on the Globe.
    for (const id of ['island', 'atoll', 'archipelago', 'ocean_patch', 'landmass', 'moon', 'satellite', 'rocket_stage', 'space_junk', 'cloud_swirl']) {
      expect(getDebrisType(id)?.area, id).toBe('globe');
    }
    for (const t of globe) if (t.model) expect(getDebrisType(t.model)?.area, `${t.id} → ${t.model}`).toBe('globe');
  });

  it('keeps the Moon a big Debris, absorbable only late in Tier 14', () => {
    const moon = getDebrisType('moon')!;
    expect(moon.size).toBeCloseTo(1.74, 2);
    expect(moon.size / ratio).toBeGreaterThan(2.3);
    expect(moon.size / ratio).toBeLessThan(getTier(15).minRadius / unit);
    for (const z of GLOBE_ZONE_TYPES) expect(DebrisSpawner.spawnWeight(moon, 3.2, ratio, 15, z), z).toBeGreaterThan(0);
  });

  it('weighs 0 outside the Globe, and Debris of other Areas weighs 0 here', () => {
    const otherZones = (['living', 'yard', 'avenue', 'farmland', 'plains', 'tundra'] as RoomType[]).filter((z) => zoneArea(z) !== 'globe');
    for (const t of globe) for (const z of otherZones) expect(roomWeight(t, z), `${t.id} in ${z}`).toBe(0);
    for (const t of DEBRIS_TYPES.filter((d) => (d.area ?? 'house') !== 'globe')) for (const z of GLOBE_ZONE_TYPES) expect(roomWeight(t, z), `${t.id} in ${z}`).toBe(0);
  });

  it('every type is spawnable and absorbable somewhere between the leap and a 6-unit Bunny', () => {
    const ladder: Array<[number, number]> = [];
    for (let r = AREAS.globe.arrivalRadius!; r <= 6; r += 0.05) ladder.push([r, r * unit >= getTier(15).minRadius ? 15 : 14]);
    for (const t of globe) {
      expect(ladder.some(([r, tier]) => GLOBE_ZONE_TYPES.some((z) => DebrisSpawner.spawnWeight(t, r, ratio, tier, z) > 0)), t.id).toBe(true);
      expect(t.size <= 5 * ratio, `${t.id} absorbable by r=5`).toBe(true);
    }
  });

  // From the arrival leap through Tier 14 and Tier 15 up to a 6-unit Bunny.
  const bands: Array<[number, number[]]> = [
    [14, [AREAS.globe.arrivalRadius!, 1, 1.5, 2.2, getTier(15).minRadius / unit - 0.01]],
    [15, [getTier(15).minRadius / unit, 3.5, 4.5, 6]],
  ];
  for (const [tier, radii] of bands) {
    for (const r of radii) {
      it(`spawns absorbable, meaningful Debris for a Tier ${tier} Bunny at r=${r} units`, () => {
        const ids = new Set<string>();
        for (const t of globe) {
          if (t.size > r * ratio) continue;
          if (GLOBE_ZONE_TYPES.some((room) => DebrisSpawner.spawnWeight(t, r, ratio, tier, room) > 0)) ids.add(t.id);
        }
        expect(ids.size, [...ids].join(',')).toBeGreaterThanOrEqual(6);
      });
    }
  }

  it('feeds every zone at the arrival size and through Tier 15', () => {
    for (const [r, tier] of [[AREAS.globe.arrivalRadius!, 14], [2, 14], [3.5, 15], [6, 15]] as const) {
      for (const room of GLOBE_ZONE_TYPES) {
        const n = globe.filter((t) => t.size <= r * ratio && DebrisSpawner.spawnWeight(t, r, ratio, tier, room) > 0).length;
        expect(n, `${room} at r=${r}`).toBeGreaterThanOrEqual(1);
      }
    }
  });
});
