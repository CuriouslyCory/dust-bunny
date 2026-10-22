import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/events';
import { AREAS } from '../data/areas';
import { DEBRIS_TYPES, getDebrisType, roomWeight } from '../data/debris';
import { SOLAR_DEBRIS } from '../data/solarDebris';
import { getTier } from '../data/tiers';
import { BASE_BUNNY_STATS } from '../entities/stats';
import { Run } from '../game/run';
import { debrisLocked } from '../systems/absorb';
import { viewRadiusFor } from '../systems/camera';
import { DebrisSpawner } from '../systems/spawner';
import { roomAt } from './house';
import { SOLAR, generateSolarSystem, sunCentre } from './solarSystem';
import { SOLAR_ZONE_TYPES, isSolarZone, zoneArea, type RoomType } from './types';

const ratio = BASE_BUNNY_STATS.absorbRatio;
const unit = AREAS.solar_system.unit;
const W = SOLAR.width;
const D = SOLAR.depth;

describe('solar system generation', () => {
  it('is deterministic per seed, and seeds differ', () => {
    expect(JSON.stringify(generateSolarSystem('a'))).toBe(JSON.stringify(generateSolarSystem('a')));
    expect(JSON.stringify(generateSolarSystem('a').debrisPlacements)).not.toBe(JSON.stringify(generateSolarSystem('b').debrisPlacements));
  });

  it('fits the end of the Act: a 4.5-unit Tier 17 Bunny sees about a third of the map', () => {
    const view = viewRadiusFor(4.5, 17);
    expect(W / 2).toBeGreaterThan(view);
    // At arrival the Sun (on Earth's orbit, 50 units north) is off screen, Voyager 1 on it.
    const arrival = viewRadiusFor(AREAS.solar_system.arrivalRadius!, 15);
    expect(SOLAR.earthOrbit).toBeGreaterThan(arrival * 1.5);
    expect(SOLAR.voyagerDistance).toBeLessThan(arrival * 0.5);
  });

  for (const seed of ['test', 'solar-1', 42]) {
    const g = generateSolarSystem(seed);
    const sun = sunCentre(g);
    const dist = (x: number, z: number) => Math.hypot(x - sun.x, z - sun.z);

    it(`covers the map with zone rings round the Sun (seed ${seed})`, () => {
      expect(sun).toEqual({ x: W / 2, z: D / 2 });
      for (let z = 0.5; z < D; z += 7) {
        for (let x = 0.5; x < W; x += 7) {
          const room = roomAt(g, x, z);
          expect(room, `${x},${z}`).toBeTruthy();
          const d = dist(x, z);
          const want = d < SOLAR.corona - 1 ? 'corona' : d > SOLAR.corona + 1 && d < SOLAR.innerOrbits - 1 ? 'inner_orbits' : d > SOLAR.innerOrbits + 1 && d < SOLAR.belt - 1 ? 'asteroid_belt' : d > SOLAR.belt + 1 && d < SOLAR.outerOrbits - 1 ? 'outer_orbits' : d > SOLAR.outerOrbits + 1 ? 'kuiper_belt' : null;
          if (want) expect(room!.type, `${x},${z} at ${d.toFixed(1)}`).toBe(want);
        }
      }
      expect(g.walls).toHaveLength(0);
      expect(g.obstacles).toHaveLength(0);
      expect(g.wrapX).toBeFalsy();
      expect(g.exit).toBeUndefined();
    });

    it(`spawns on Earth's empty orbit south of the Sun, with open space round it (seed ${seed})`, () => {
      expect(g.spawn.x).toBe(sun.x);
      expect(g.spawn.z).toBe(sun.z + SOLAR.earthOrbit);
      expect(roomAt(g, g.spawn.x, g.spawn.z)?.type).toBe('inner_orbits');
      // Nothing but Voyager 1 within 6 units, and no planet within 12.
      for (const p of g.debrisPlacements) {
        const d = Math.hypot(p.x - g.spawn.x, p.z - g.spawn.z);
        if (p.typeId !== 'voyager_1') expect(d, p.typeId).toBeGreaterThan(12);
      }
    });

    it(`places Voyager 1 near the spawn and Jupiter on its orbit (seed ${seed})`, () => {
      const voyager = g.debrisPlacements.filter((p) => p.typeId === 'voyager_1');
      expect(voyager).toHaveLength(1);
      expect(Math.hypot(voyager[0]!.x - g.spawn.x, voyager[0]!.z - g.spawn.z)).toBeCloseTo(SOLAR.voyagerDistance, 0);
      expect(voyager[0]!.z).toBeLessThan(g.spawn.z); // ahead (up the screen)
      const jupiter = g.debrisPlacements.filter((p) => p.typeId === 'jupiter');
      expect(jupiter).toHaveLength(1);
      expect(dist(jupiter[0]!.x, jupiter[0]!.z)).toBeCloseTo(SOLAR.jupiterOrbit, 0);
      expect(jupiter[0]!.z).toBeLessThan(sun.z); // the far side of the Sun
    });

    it(`puts each planet on its ring, Mars within reach of the spawn (seed ${seed})`, () => {
      for (const [id, k] of SOLAR.planets) {
        const ps = g.debrisPlacements.filter((p) => p.typeId === id);
        expect(ps, id).toHaveLength(1);
        expect(dist(ps[0]!.x, ps[0]!.z), id).toBeCloseTo(SOLAR.orbits[k]!, 0);
        expect(getDebrisType(id)?.area, id).toBe('solar_system');
      }
      const mars = g.debrisPlacements.find((p) => p.typeId === 'mars')!;
      expect(Math.hypot(mars.x - g.spawn.x, mars.z - g.spawn.z)).toBeLessThan(40);
      const pluto = g.debrisPlacements.find((p) => p.typeId === 'pluto')!;
      expect(roomAt(g, pluto.x, pluto.z)?.type).toBe('kuiper_belt');
    });

    it(`clutters the asteroid belt (seed ${seed})`, () => {
      const inBelt = g.debrisPlacements.filter((p) => roomAt(g, p.x, p.z)?.type === 'asteroid_belt');
      expect(inBelt.length).toBeGreaterThan(SOLAR.beltRocks * 0.9);
      for (const p of inBelt) expect(getDebrisType(p.typeId)?.area, p.typeId).toBe('solar_system');
      // Trojans at Jupiter's L4 / L5 points.
      expect(g.debrisPlacements.filter((p) => Math.abs(dist(p.x, p.z) - SOLAR.jupiterOrbit) < 5 && p.typeId !== 'jupiter').length).toBeGreaterThan(SOLAR.trojans);
    });

    it(`runs closed orbit rings round the Sun (seed ${seed})`, () => {
      const orbits = (g.routes ?? []).filter((r) => r.kind === 'orbit');
      expect(orbits).toHaveLength(SOLAR.orbits.length);
      orbits.forEach((r, i) => {
        expect(r.width).toBe(SOLAR.laneWidth);
        expect(r.points[0]).toEqual(r.points[r.points.length - 1]);
        for (const p of r.points) expect(dist(p.x, p.z)).toBeCloseTo(SOLAR.orbits[i]!, 1);
      });
    });
  }

  it('a Run can start in the Solar System (debug): Orbital-Sweeper-beaten size, then the arrival leap', () => {
    const run = new Run(new EventBus(), { seed: 'solar-run', characterId: 'dusty', area: 'solar_system' });
    expect(run.bunny.radius).toBeCloseTo(0.85);
    expect(run.tier).toBe(15);
    const ids = new Set<string>();
    run.debris.forEach((d) => ids.add(d.type.id));
    for (const id of ['voyager_1', 'jupiter', 'mars', 'asteroid']) expect(ids.has(id), id).toBe(true);
    // Jupiter blocks until Tier 17.
    let jupiter = null as Parameters<typeof debrisLocked>[1] | null;
    run.debris.forEach((d) => {
      if (d.type.id === 'jupiter') jupiter = d;
    });
    expect(debrisLocked(run.bunny, jupiter!)).toBe(true);
  });
});

describe('solar system Debris catalogue', () => {
  const solar = SOLAR_DEBRIS;

  it('only uses solar zones and Tiers 15–17, from Voyager 1 to the leftover dust', () => {
    expect(solar.length).toBeGreaterThanOrEqual(25);
    for (const t of solar) {
      expect(t.area).toBe('solar_system');
      expect(t.tiers[0]).toBeGreaterThanOrEqual(15);
      expect(t.tiers[1]).toBeLessThanOrEqual(17);
      expect(t.tiers[1], `${t.id} spawns past the arrival clamp`).toBeGreaterThanOrEqual(16);
      for (const room of Object.keys(t.rooms)) if (room !== 'any') expect(isSolarZone(room as never), `${t.id}.${room}`).toBe(true);
    }
    for (const id of ['jupiter', 'saturn', 'uranus', 'neptune', 'voyager_1', 'mars']) expect(getDebrisType(id)?.area, id).toBe('solar_system');
  });

  it('keeps Jupiter an Obstacle until Tier 17, then absorbable from r ≈ 3.4', () => {
    const jupiter = getDebrisType('jupiter')!;
    expect(jupiter.lockedUntilTier).toBe(17);
    expect(jupiter.size / ratio).toBeGreaterThan(getTier(17).minRadius / unit);
    expect(jupiter.size / ratio).toBeLessThan(3.6);
    expect(Object.keys(jupiter.rooms)).toHaveLength(0);
    expect(Object.keys(getDebrisType('voyager_1')!.rooms)).toHaveLength(0);
  });

  it('lets the Bunny eat Mars just before Tier 16', () => {
    const mars = getDebrisType('mars')!;
    expect(mars.size / ratio).toBeGreaterThan(AREAS.solar_system.arrivalRadius!);
    expect(mars.size / ratio).toBeLessThan(getTier(16).minRadius / unit);
  });

  it('weighs 0 outside the Solar System, and Debris of other Areas weighs 0 here', () => {
    const otherZones = (['living', 'yard', 'avenue', 'farmland', 'plains', 'oceans'] as RoomType[]).filter((z) => zoneArea(z) !== 'solar_system');
    for (const t of solar) for (const z of otherZones) expect(roomWeight(t, z), `${t.id} in ${z}`).toBe(0);
    for (const t of DEBRIS_TYPES.filter((d) => (d.area ?? 'house') !== 'solar_system')) for (const z of SOLAR_ZONE_TYPES) expect(roomWeight(t, z), `${t.id} in ${z}`).toBe(0);
  });

  it('every spawnable type is spawnable and absorbable somewhere between the leap and a 4.8-unit Bunny', () => {
    const ladder: Array<[number, number]> = [];
    for (let r = AREAS.solar_system.arrivalRadius!; r <= 4.8; r += 0.05) ladder.push([r, r * unit >= getTier(17).minRadius ? 17 : r * unit >= getTier(16).minRadius ? 16 : 15]);
    for (const t of solar) {
      expect(t.size <= 4.5 * ratio, `${t.id} absorbable by r=4.5`).toBe(true);
      if (Object.keys(t.rooms).length === 0) continue; // placed one-offs
      expect(ladder.some(([r, tier]) => SOLAR_ZONE_TYPES.some((z) => DebrisSpawner.spawnWeight(t, r, ratio, Math.max(16, tier), z) > 0)), t.id).toBe(true);
    }
  });

  // From the arrival leap through Tier 16 and Tier 17 up to a 4.8-unit Bunny (the spawner's Tier is clamped to 16–17).
  const bands: Array<[number, number[]]> = [
    [16, [AREAS.solar_system.arrivalRadius!, 1, 1.5, 2.2, getTier(17).minRadius / unit - 0.01]],
    [17, [getTier(17).minRadius / unit, 3.5, 4.2, 4.8]],
  ];
  for (const [tier, radii] of bands) {
    for (const r of radii) {
      it(`spawns absorbable, meaningful Debris for a Tier ${tier} Bunny at r=${r} units`, () => {
        const ids = new Set<string>();
        for (const t of solar) {
          if (t.size > r * ratio) continue;
          if (SOLAR_ZONE_TYPES.some((room) => DebrisSpawner.spawnWeight(t, r, ratio, tier, room) > 0)) ids.add(t.id);
        }
        expect(ids.size, [...ids].join(',')).toBeGreaterThanOrEqual(6);
      });
    }
  }

  it('feeds every zone at the arrival size and through Tier 17', () => {
    for (const [r, tier] of [[AREAS.solar_system.arrivalRadius!, 16], [2, 16], [3.5, 17], [4.8, 17]] as const) {
      for (const room of SOLAR_ZONE_TYPES) {
        const n = solar.filter((t) => t.size <= r * ratio && DebrisSpawner.spawnWeight(t, r, ratio, tier, room) > 0).length;
        expect(n, `${room} at r=${r}`).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('leans the belt on rocks and the Kuiper belt on ice', () => {
    const top = (room: RoomType) => [...solar].sort((a, b) => roomWeight(b, room) - roomWeight(a, room))[0]!.id;
    expect(['asteroid', 'asteroid_cluster', 'asteroid_swarm']).toContain(top('asteroid_belt'));
    expect(['comet_nucleus', 'kuiper_object', 'comet_swarm']).toContain(top('kuiper_belt'));
  });
});
