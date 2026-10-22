import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/events';
import { AREAS } from '../data/areas';
import { DEBRIS_TYPES, getDebrisType, roomWeight } from '../data/debris';
import { GALAXY_DEBRIS } from '../data/galaxyDebris';
import { AREA_BOSSES, SAGITTARIUS_A } from '../data/hazards';
import { STORY, STORY_CAPTION_MAX } from '../data/story';
import { getTier } from '../data/tiers';
import { formatLength } from '../data/units';
import { BASE_BUNNY_STATS } from '../entities/stats';
import { Run } from '../game/run';
import { DebrisSpawner } from '../systems/spawner';
import { GALAXY, armPhase, galacticCentre, generateGalaxy } from './galaxy';
import { roomAt } from './house';
import { GALAXY_ZONE_TYPES, isGalaxyZone, zoneArea, type RoomType } from './types';

const ratio = BASE_BUNNY_STATS.absorbRatio;
const unit = AREAS.galaxy.unit;

describe('galaxy generation (placeholder map)', () => {
  it('is deterministic per seed, and seeds differ', () => {
    expect(JSON.stringify(generateGalaxy('a'))).toBe(JSON.stringify(generateGalaxy('a')));
    expect(JSON.stringify(generateGalaxy('a').rooms)).not.toBe(JSON.stringify(generateGalaxy('b').rooms));
  });

  for (const seed of ['test', 'galaxy-1', 42]) {
    const g = generateGalaxy(seed);
    const c = galacticCentre(g);

    it(`tiles the disc with the six galaxy zones round Sagittarius A*, no walls and no exit (seed ${seed})`, () => {
      expect(g.area).toBe('galaxy');
      expect(new Set(g.rooms.map((r) => r.type))).toEqual(new Set(GALAXY_ZONE_TYPES));
      for (const r of g.rooms) expect(zoneArea(r.type)).toBe('galaxy');
      expect(roomAt(g, c.x, c.z)?.type).toBe('galactic_core');
      expect(roomAt(g, 2, 2)?.type).toBe('halo');
      for (let z = 1; z < GALAXY.depth; z += 23) for (let x = 1; x < GALAXY.width; x += 23) expect(roomAt(g, x, z), `${x},${z}`).toBeTruthy();
      expect(g.walls).toHaveLength(0);
      expect(g.obstacles).toHaveLength(0);
      expect(g.wrapX).toBeFalsy();
      expect(g.exit).toBeUndefined();
    });

    it(`spawns out in an arm, south of the core (seed ${seed})`, () => {
      const d = Math.hypot(g.spawn.x - c.x, g.spawn.z - c.z);
      expect(d).toBeCloseTo(GALAXY.spawnDistance, 0);
      expect(g.spawn.z).toBeGreaterThan(c.z);
      expect(['inner_arms', 'outer_arms']).toContain(roomAt(g, g.spawn.x, g.spawn.z)?.type);
      expect(g.rooms.find((r) => r.id === g.spawn.roomId)).toBeTruthy();
    });

    it(`runs closed orbits round the core (seed ${seed})`, () => {
      const orbits = (g.routes ?? []).filter((r) => r.kind === 'orbit');
      expect(orbits).toHaveLength(GALAXY.orbits.length);
      orbits.forEach((r, i) => {
        expect(r.points[0]).toEqual(r.points[r.points.length - 1]);
        for (const p of r.points) expect(Math.hypot(p.x - c.x, p.z - c.z)).toBeCloseTo(GALAXY.orbits[i]!, 1);
      });
    });
  }

  it('winds two arms: on an arm at its centre line, a dust lane half-way between', () => {
    const a = Math.log(100 / GALAXY.barLength) / GALAXY.pitch;
    expect(armPhase(100, a, 0)).toBeCloseTo(1);
    expect(armPhase(100, a + Math.PI / 2, 0)).toBeCloseTo(-1);
  });

  it('a Run can start in the Galaxy (debug): Sun-beaten size, then the arrival leap to 85 ly', () => {
    const run = new Run(new EventBus(), { seed: 'galaxy-run', characterId: 'dusty', area: 'galaxy' });
    expect(run.bunny.radius).toBeCloseTo(AREAS.galaxy.arrivalRadius!);
    expect(run.tier).toBe(17);
    expect(formatLength(run.bunny.realRadius, AREAS.galaxy.readout)).toBe('85.0 ly');
    let n = 0;
    run.debris.forEach((d) => {
      expect(d.type.area).toBe('galaxy');
      n++;
    });
    expect(n).toBeGreaterThan(200);
  });
});

describe('galaxy Debris catalogue (placeholder ladder)', () => {
  const galaxy = GALAXY_DEBRIS;

  it('only uses galaxy zones and Tiers 17–19: stars, clusters, nebulae, rogue planets', () => {
    for (const t of galaxy) {
      expect(t.area).toBe('galaxy');
      expect(t.tiers[0]).toBeGreaterThanOrEqual(17);
      expect(t.tiers[1]).toBeLessThanOrEqual(19);
      expect(t.tiers[1], `${t.id} spawns past the arrival clamp`).toBeGreaterThanOrEqual(18);
      for (const room of Object.keys(t.rooms)) if (room !== 'any') expect(isGalaxyZone(room as never), `${t.id}.${room}`).toBe(true);
    }
    for (const id of ['red_dwarf', 'sun_like_star', 'red_giant', 'star_cluster', 'emission_nebula', 'free_floating_planet']) expect(getDebrisType(id)?.area, id).toBe('galaxy');
  });

  it("has Sagittarius A*'s chip and stun types", () => {
    expect(getDebrisType(SAGITTARIUS_A.chipTypeId!)?.area).toBe('galaxy');
    expect(Object.keys(getDebrisType('relativistic_jet')!.rooms)).toHaveLength(0);
    for (const id of SAGITTARIUS_A.giants.typeIds) expect(getDebrisType(id)?.area, id).toBe('galaxy');
    expect(AREA_BOSSES.galaxy).toEqual({ id: 'sagittarius_a', tier: 19, arrivalDelay: 4 });
  });

  it('weighs 0 outside the Galaxy, and Debris of other Areas weighs 0 here', () => {
    const otherZones = (['living', 'yard', 'avenue', 'farmland', 'plains', 'oceans', 'kuiper_belt'] as RoomType[]).filter((z) => zoneArea(z) !== 'galaxy');
    for (const t of galaxy) for (const z of otherZones) expect(roomWeight(t, z), `${t.id} in ${z}`).toBe(0);
    for (const t of DEBRIS_TYPES.filter((d) => (d.area ?? 'house') !== 'galaxy')) for (const z of GALAXY_ZONE_TYPES) expect(roomWeight(t, z), `${t.id} in ${z}`).toBe(0);
  });

  // From the arrival leap through Tier 18 and Tier 19 up to a 4.8-unit Bunny (the spawner's Tier is clamped to 18–19).
  const bands: Array<[number, number[]]> = [
    [18, [AREAS.galaxy.arrivalRadius!, 1.5, getTier(19).minRadius / unit - 0.01]],
    [19, [getTier(19).minRadius / unit, 4.2, 4.8]],
  ];
  for (const [tier, radii] of bands) {
    for (const r of radii) {
      it(`spawns absorbable Debris for a Tier ${tier} Bunny at r=${r} units`, () => {
        const ids = new Set<string>();
        for (const t of galaxy) {
          if (t.size > r * ratio) continue;
          if (GALAXY_ZONE_TYPES.some((room) => DebrisSpawner.spawnWeight(t, r, ratio, tier, room) > 0)) ids.add(t.id);
        }
        expect(ids.size, [...ids].join(',')).toBeGreaterThanOrEqual(4);
      });
    }
  }
});

describe('galaxy story', () => {
  it('has the chapter, its lines, and Tier 18 / 19 lines, every caption within the limit', () => {
    const ch = STORY.areas.galaxy;
    expect(ch.title).toBe('The Biggest Vacuum There Is');
    for (const line of [...ch.entered, ...ch.cleared, ...ch.boss, ...STORY.tiers.dust_nebula!, ...STORY.tiers.dust_cluster!]) {
      for (const caption of typeof line === 'string' ? [line] : line) expect(caption.length, caption).toBeLessThanOrEqual(STORY_CAPTION_MAX);
    }
    // Sagittarius A*'s 210-character arrival line, in at most three captions.
    const boss = ch.boss[0]!;
    expect(typeof boss === 'string' ? 1 : boss.length).toBeLessThanOrEqual(3);
  });
});
