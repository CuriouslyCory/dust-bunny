import { readFileSync } from 'node:fs';
import { Group, Mesh, MeshStandardMaterial, SphereGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/events';
import { AREAS } from '../data/areas';
import { DEBRIS_TYPES, getDebrisType, roomWeight } from '../data/debris';
import { GALAXY_DEBRIS } from '../data/galaxyDebris';
import { AREA_BOSSES, SAGITTARIUS_A } from '../data/hazards';
import { STORY, STORY_CAPTION_MAX } from '../data/story';
import { getTier } from '../data/tiers';
import { formatLength } from '../data/units';
import { modelDebrisGeometry } from '../entities/debrisGeometry';
import { BASE_BUNNY_STATS } from '../entities/stats';
import { Run } from '../game/run';
import { DebrisSpawner } from '../systems/spawner';
import { GALAXY, armAngle, armDensity, armPhase, barAngleFor, galacticCentre, generateGalaxy } from './galaxy';
import { roomAt } from './house';
import { GALAXY_ZONE_TYPES, isGalaxyZone, zoneArea, type RoomType } from './types';

const ratio = BASE_BUNNY_STATS.absorbRatio;
const unit = AREAS.galaxy.unit;

describe('galaxy generation', () => {
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

    it(`has arms and dust lanes in about equal parts, inner and outer (seed ${seed})`, () => {
      const area = (t: RoomType) => g.rooms.filter((r) => r.type === t).reduce((s, r) => s + (r.rect.maxX - r.rect.minX) * (r.rect.maxZ - r.rect.minZ), 0);
      const arms = area('inner_arms') + area('outer_arms');
      const lanes = area('dust_lanes');
      expect(arms / (arms + lanes)).toBeGreaterThan(0.35);
      expect(arms / (arms + lanes)).toBeLessThan(0.6);
      expect(area('inner_arms')).toBeGreaterThan(0);
      expect(area('outer_arms')).toBeGreaterThan(area('inner_arms'));
    });

    it(`spawns out in an arm, south of the core, within 45° of due south (seed ${seed})`, () => {
      const d = Math.hypot(g.spawn.x - c.x, g.spawn.z - c.z);
      expect(d).toBeCloseTo(GALAXY.spawnDistance, 0);
      expect(g.spawn.z - c.z).toBeGreaterThan(d * Math.cos(Math.PI / 4) - 0.1);
      expect(['inner_arms', 'outer_arms']).toContain(roomAt(g, g.spawn.x, g.spawn.z)?.type);
      expect(g.rooms.find((r) => r.id === g.spawn.roomId)).toBeTruthy();
    });

    it(`places a rogue planet and a sock in the first screen, and star clusters round the core (seed ${seed})`, () => {
      const near = (id: string) => g.debrisPlacements.filter((p) => p.typeId === id && Math.hypot(p.x - g.spawn.x, p.z - g.spawn.z) < 9);
      expect(near('free_floating_planet')).toHaveLength(1);
      expect(near('space_sock')).toHaveLength(1);
      const clusters = g.debrisPlacements.filter((p) => p.typeId === 'star_cluster');
      expect(clusters).toHaveLength(GALAXY.coreClusters);
      for (const p of clusters) {
        const d = Math.hypot(p.x - c.x, p.z - c.z);
        expect(d).toBeGreaterThanOrEqual(GALAXY.clusterRing[0]);
        expect(d).toBeLessThanOrEqual(GALAXY.clusterRing[1]);
        for (const q of clusters) if (q !== p) expect(Math.hypot(p.x - q.x, p.z - q.z)).toBeGreaterThanOrEqual(GALAXY.clusterGap);
      }
      for (const p of g.debrisPlacements) expect(getDebrisType(p.typeId)?.area, p.typeId).toBe('galaxy');
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

  it('winds two major arms everywhere and two minor arms only in the outer disc', () => {
    const a = (d: number) => armAngle(d, 0);
    // Major arms: on the centre line, and half a turn round.
    expect(armPhase(100, a(100), 0)).toBeCloseTo(1);
    expect(armPhase(40, a(40) + Math.PI, 0)).toBeCloseTo(1);
    // Midway between a major and a minor arm: a lane.
    expect(armPhase(140, a(140) + Math.PI / 4, 0)).toBeCloseTo(-1);
    // Where the minor arm runs: a lane in the inner disc, an arm (a little narrower) in the outer disc.
    expect(armPhase(40, a(40) + Math.PI / 2, 0)).toBeCloseTo(-1);
    expect(armPhase(140, a(140) + Math.PI / 2, 0)).toBeGreaterThan(GALAXY.armWidth);
    expect(armPhase(140, a(140) + Math.PI / 2, 0)).toBeLessThan(1);
    for (let d = 5; d < 200; d += 7) for (let t = -3; t < 3; t += 0.37) expect(armDensity(d, t, 0.4)).toBeGreaterThanOrEqual(0), expect(armDensity(d, t, 0.4)).toBeLessThanOrEqual(1);
  });

  it('the bar angle is the generator’s, from the seed alone (the painted floor and the stars use it)', () => {
    const g = generateGalaxy('bar-check');
    expect(barAngleFor(g.seed)).toBe(barAngleFor('bar-check'));
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

  it('absorbing Sagittarius A* turns the Bunny into a black hole for the rest of the Run', () => {
    const run = new Run(new EventBus(), { seed: 'galaxy-hole', characterId: 'dusty', area: 'galaxy' });
    expect(run.bunny.form).toBe('dust');
    run.clearArea();
    expect(run.endReason).toBe('victory');
    expect(run.bunny.form).toBe('black_hole');
    // Earlier Areas' bosses leave it dust.
    const solar = new Run(new EventBus(), { seed: 'solar-dust', characterId: 'dusty', area: 'solar_system' });
    solar.clearArea();
    expect(solar.bunny.form).toBe('dust');
  });
});

describe('galaxy Debris catalogue', () => {
  const galaxy = GALAXY_DEBRIS;
  const manifest = JSON.parse(readFileSync('public/models/manifest.json', 'utf8')) as Record<string, unknown>;

  it('only uses galaxy zones and Tiers 17–19: stars, clusters, nebulae, rogue planets', () => {
    for (const t of galaxy) {
      expect(t.area).toBe('galaxy');
      expect(t.tiers[0]).toBeGreaterThanOrEqual(17);
      expect(t.tiers[1]).toBeLessThanOrEqual(19);
      expect(t.tiers[1], `${t.id} spawns past the arrival clamp`).toBeGreaterThanOrEqual(18);
      for (const room of Object.keys(t.rooms)) if (room !== 'any') expect(isGalaxyZone(room as never), `${t.id}.${room}`).toBe(true);
    }
    for (const id of ['red_dwarf', 'sun_like_star', 'red_giant', 'star_cluster', 'emission_nebula', 'free_floating_planet', 'open_cluster', 'dark_nebula']) expect(getDebrisType(id)?.area, id).toBe('galaxy');
  });

  it('renders a Galaxy Blender prop for every type, self-lit with a fallback glow in its main colour', () => {
    for (const t of galaxy) {
      expect(manifest[t.model ?? t.id], `${t.id} → ${t.model ?? t.id}`).toBeTruthy();
      expect(t.material?.glow, t.id).toBeGreaterThan(0);
      expect(t.material?.emissive, t.id).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(getDebrisType('free_floating_planet')!.model).toBe('rogue_planet');
  });

  it('bakes each part’s emission into the model geometry (glow), and tints every part with tintAll', () => {
    const root = new Group();
    root.add(new Mesh(new SphereGeometry(1, 8, 6), new MeshStandardMaterial({ color: '#ffffff', emissive: '#ff0000', emissiveIntensity: 2 })));
    const dark = new Mesh(new SphereGeometry(0.5, 8, 6), new MeshStandardMaterial({ color: '#202020' }));
    dark.position.x = 1.5;
    root.add(dark);
    const g = modelDebrisGeometry('test-glow', root, true)!;
    const em = g.getAttribute('emission');
    const tint = g.getAttribute('tint');
    let lit = 0;
    for (let i = 0; i < em.count; i++) {
      expect([0, 2]).toContain(em.getX(i));
      expect(em.getY(i)).toBe(0);
      if (em.getX(i) === 2) lit++;
      expect(tint.getX(i)).toBe(1);
    }
    expect(lit).toBeGreaterThan(0);
    expect(lit).toBeLessThan(em.count);
  });

  it("has Sagittarius A*'s chip and stun types; star clusters crowd the core and the bar and stay too big until r = 4", () => {
    expect(getDebrisType(SAGITTARIUS_A.chipTypeId!)?.area).toBe('galaxy');
    expect(Object.keys(getDebrisType('relativistic_jet')!.rooms)).toHaveLength(0);
    for (const id of Object.keys(SAGITTARIUS_A.clusters.meals)) expect(getDebrisType(id)?.area, id).toBe('galaxy');
    expect(AREA_BOSSES.galaxy).toEqual({ id: 'sagittarius_a', tier: 19, arrivalDelay: 4 });
    const cluster = getDebrisType('star_cluster')!;
    expect(cluster.size / ratio).toBeCloseTo(4, 1);
    for (const zone of ['galactic_core', 'bar'] as const) {
      const tier19 = galaxy.filter((t) => t.tiers[1] === 19 && t.id !== 'star_cluster');
      for (const t of tier19) expect(roomWeight(cluster, zone), `${zone}: star_cluster vs ${t.id}`).toBeGreaterThan(roomWeight(t, zone));
    }
  });

  it('weighs 0 outside the Galaxy, and Debris of other Areas weighs 0 here', () => {
    const otherZones = (['living', 'yard', 'avenue', 'farmland', 'plains', 'oceans', 'kuiper_belt'] as RoomType[]).filter((z) => zoneArea(z) !== 'galaxy');
    for (const t of galaxy) for (const z of otherZones) expect(roomWeight(t, z), `${t.id} in ${z}`).toBe(0);
    for (const t of DEBRIS_TYPES.filter((d) => (d.area ?? 'house') !== 'galaxy')) for (const z of GALAXY_ZONE_TYPES) expect(roomWeight(t, z), `${t.id} in ${z}`).toBe(0);
  });

  // From the arrival leap through Tier 18 and Tier 19 up to a 4.8-unit Bunny (the spawner's Tier is clamped to 18–19).
  const bands: Array<[number, number[]]> = [
    [18, [AREAS.galaxy.arrivalRadius!, 1.5, 2.2, getTier(19).minRadius / unit - 0.01]],
    [19, [getTier(19).minRadius / unit, 3.6, 4.2, 4.8]],
  ];
  for (const [tier, radii] of bands) {
    for (const r of radii) {
      it(`spawns absorbable Debris for a Tier ${tier} Bunny at r=${r} units, in the arms and in the dust lanes`, () => {
        for (const room of ['inner_arms', 'outer_arms', 'dust_lanes'] as const) {
          const ids = new Set<string>();
          for (const t of galaxy) {
            if (t.size > r * ratio) continue;
            if (DebrisSpawner.spawnWeight(t, r, ratio, tier, room) > 0) ids.add(t.id);
          }
          expect(ids.size, `${room}: ${[...ids].join(',')}`).toBeGreaterThanOrEqual(3);
        }
      });
    }
  }
});

describe('galaxy story', () => {
  it('has the chapter, its lines, and Tier 18 / 19 lines, every caption within the limit', () => {
    const ch = STORY.areas.galaxy;
    expect(ch.title).toBe('The Biggest Vacuum There Is');
    for (const line of [...ch.entered, ...ch.cleared, ...ch.boss, ...STORY.tiers.dust_nebula!, ...STORY.tiers.dust_cluster!, ...STORY.debris.free_floating_planet!]) {
      for (const caption of typeof line === 'string' ? [line] : line) expect(caption.length, caption).toBeLessThanOrEqual(STORY_CAPTION_MAX);
    }
    // Sagittarius A*'s 210-character arrival line, in at most three captions.
    const boss = ch.boss[0]!;
    expect(typeof boss === 'string' ? 1 : boss.length).toBeLessThanOrEqual(3);
  });
});
