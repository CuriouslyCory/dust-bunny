import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/events';
import { AREAS } from '../data/areas';
import { DEBRIS_TYPES, roomWeight } from '../data/debris';
import { AREA_BOSSES } from '../data/hazards';
import { STORY, STORY_CAPTION_MAX } from '../data/story';
import { UNIVERSE_DEBRIS } from '../data/universeDebris';
import { pickShedType } from '../hazards/shed';
import { formatLength } from '../data/units';
import { Run } from '../game/run';
import { roomAt } from './house';
import { generateUniverse, UNIVERSE, universeCentre, universeNodes, universeWeb } from './universe';
import { rectContains } from '../core/math';
import { VOID_SLOW, VOID_SOURCE } from '../systems/voidSlow';
import { isUniverseZone, UNIVERSE_ZONE_TYPES, zoneArea, type RoomType } from './types';

describe('universe generation', () => {
  it('is deterministic per seed, and seeds differ', () => {
    expect(JSON.stringify(generateUniverse('a'))).toBe(JSON.stringify(generateUniverse('a')));
    expect(JSON.stringify(generateUniverse('a').rooms)).not.toBe(JSON.stringify(generateUniverse('b').rooms));
  });

  for (const seed of ['test', 'universe-1', 42]) {
    const u = generateUniverse(seed);
    const c = universeCentre(u);

    it(`covers the map with the four universe zones, no walls and no exit (seed ${seed})`, () => {
      expect(u.area).toBe('universe');
      expect(new Set(u.rooms.map((r) => r.type))).toEqual(new Set(UNIVERSE_ZONE_TYPES));
      for (const r of u.rooms) expect(zoneArea(r.type)).toBe('universe');
      for (let z = 1; z < UNIVERSE.depth; z += 13) for (let x = 1; x < UNIVERSE.width; x += 13) expect(roomAt(u, x, z), `${x},${z}`).toBeTruthy();
      expect(u.walls).toHaveLength(0);
      expect(u.obstacles).toHaveLength(0);
      expect(u.wrapX).toBeFalsy();
      expect(u.exit).toBeUndefined();
    });

    it(`is a web: superclusters at the nodes, filaments between them, sheets beside them and voids for most of the space (seed ${seed})`, () => {
      const nodes = universeNodes(seed);
      expect(nodes.length).toBeGreaterThanOrEqual(25);
      for (const n of nodes) expect(roomAt(u, n.x, n.z)?.type).toBe('superclusters');
      const area = (t: RoomType) => u.rooms.filter((r) => r.type === t).reduce((s, r) => s + (r.rect.maxX - r.rect.minX) * (r.rect.maxZ - r.rect.minZ), 0);
      const total = UNIVERSE.width * UNIVERSE.depth;
      expect(area('voids') / total).toBeGreaterThan(0.4);
      expect(area('voids')).toBeGreaterThan(area('sheets'));
      expect(area('sheets')).toBeGreaterThan(area('filaments'));
      expect(area('filaments')).toBeGreaterThan(area('superclusters'));
      expect(area('superclusters')).toBeGreaterThan(0);
      // Every node joins at least two filaments (a web, not a tree), and the filaments are routes for Hazards.
      const web = universeWeb(seed);
      const degree = web.nodes.map(() => 0);
      for (const l of web.links) {
        degree[l.a]!++;
        degree[l.b]!++;
      }
      for (const n of nodes) expect(degree[web.nodes.findIndex((m) => m.x === n.x && m.z === n.z)]).toBeGreaterThanOrEqual(2);
      const filaments = (u.routes ?? []).filter((r) => r.kind === 'filament');
      expect(filaments.length).toBeGreaterThanOrEqual(nodes.length);
      for (const r of filaments) {
        expect(r.points).toHaveLength(2);
        for (const p of r.points) expect(rectContains(u.bounds, p.x, p.z)).toBe(true);
        const mid = { x: (r.points[0]!.x + r.points[1]!.x) / 2, z: (r.points[0]!.z + r.points[1]!.z) / 2 };
        expect(['filaments', 'superclusters']).toContain(roomAt(u, mid.x, mid.z)?.type);
      }
    });

    it(`spawns on a filament near the middle of the map, the Great Attractor on a node up the screen and a sock beside the spawn (seed ${seed})`, () => {
      expect(roomAt(u, u.spawn.x, u.spawn.z)?.type).toBe('filaments');
      expect(u.rooms.find((r) => r.id === u.spawn.roomId)).toBeTruthy();
      expect(Math.hypot(u.spawn.x - c.x, u.spawn.z - c.z)).toBeLessThan(UNIVERSE.width / 4);
      const ga = u.debrisPlacements.filter((p) => p.typeId === 'great_attractor');
      expect(ga).toHaveLength(1);
      expect(roomAt(u, ga[0]!.x, ga[0]!.z)?.type).toBe('superclusters');
      expect(Math.hypot(ga[0]!.x - u.spawn.x, ga[0]!.z - u.spawn.z)).toBeCloseTo(UNIVERSE.spawnFromNode, 0);
      expect(ga[0]!.z).toBeLessThan(u.spawn.z);
      const sock = u.debrisPlacements.find((p) => p.typeId === 'universe_sock')!;
      expect(Math.hypot(sock.x - u.spawn.x, sock.z - u.spawn.z)).toBeCloseTo(UNIVERSE.sockDistance, 1);
      for (const p of u.debrisPlacements) expect(DEBRIS_TYPES.find((t) => t.id === p.typeId)?.area, p.typeId).toBe('universe');
    });
  }

  it('a Run can start in the Universe (debug): Sagittarius-A*-beaten size, then the arrival leap to 8.5 Mly', () => {
    const run = new Run(new EventBus(), { seed: 'universe-run', characterId: 'dusty', area: 'universe' });
    expect(run.bunny.radius).toBeCloseTo(AREAS.universe.arrivalRadius!);
    expect(run.tier).toBe(19);
    expect(formatLength(run.bunny.realRadius, AREAS.universe.readout)).toBe('8.50 Mly');
    let n = 0;
    run.debris.forEach((d) => {
      expect(d.type.area).toBe('universe');
      n++;
    });
    expect(n).toBeGreaterThan(200);
    // The voids are nearly empty: far fewer Debris per unit area than on the filaments and nodes.
    const per: Record<string, number> = {};
    run.debris.forEach((d) => {
      const t = roomAt(run.house, d.x, d.z)?.type ?? 'none';
      per[t] = (per[t] ?? 0) + 1;
    });
    const area = (t: RoomType) => run.house.rooms.filter((r) => r.type === t).reduce((s, r) => s + (r.rect.maxX - r.rect.minX) * (r.rect.maxZ - r.rect.minZ), 0);
    const density = (t: RoomType) => (per[t] ?? 0) / area(t);
    expect(density('voids')).toBeLessThan(density('filaments') * 0.15);
    expect(density('sheets')).toBeLessThan(density('filaments'));
    expect(AREA_BOSSES.universe).toEqual({ id: 'the_expansion', tier: 21, arrivalDelay: 4 });
  });
});

describe('universe Debris catalogue', () => {
  it('only uses universe zones and Tiers 19–21, and no other Area spawns it', () => {
    for (const t of UNIVERSE_DEBRIS) {
      expect(t.area).toBe('universe');
      expect(t.tiers[0]).toBeGreaterThanOrEqual(19);
      expect(t.tiers[1]).toBeLessThanOrEqual(21);
      expect(t.tiers[1], `${t.id} spawns past the arrival clamp`).toBeGreaterThanOrEqual(20);
      for (const room of Object.keys(t.rooms)) if (room !== 'any') expect(isUniverseZone(room as never), `${t.id}.${room}`).toBe(true);
      expect(t.material?.emissive, t.id).toMatch(/^#[0-9a-f]{6}$/);
      expect(roomWeight(t, 'outer_arms')).toBe(0);
    }
    for (const t of DEBRIS_TYPES) if (t.area !== 'universe') expect(roomWeight(t, 'filaments'), t.id).toBe(0);
  });

  it('is a ladder of self-lit props over Tiers 20–21: filaments and nodes rich, voids nearly empty', () => {
    const spawned = UNIVERSE_DEBRIS.filter((t) => Object.values(t.rooms).some((w) => (w ?? 0) > 0));
    for (const t of UNIVERSE_DEBRIS) if (t.id !== 'lost_couch') expect(t.material?.glow, t.id).toBeGreaterThan(0);
    const arrival = AREAS.universe.arrivalRadius! * 0.7;
    expect(spawned.filter((t) => t.size <= arrival).length).toBeGreaterThanOrEqual(5);
    expect(spawned.filter((t) => t.tiers[0] === 20).length).toBeGreaterThanOrEqual(8);
    expect(spawned.filter((t) => t.tiers[0] === 21).length).toBeGreaterThanOrEqual(5);
    expect(Math.max(...spawned.map((t) => t.size))).toBeGreaterThan(3 * 0.7 * 1.4);
    const total = (zone: string) => spawned.reduce((s, t) => s + roomWeight(t, zone as never), 0);
    expect(total('filaments')).toBeGreaterThan(total('sheets'));
    expect(total('superclusters')).toBeGreaterThan(total('sheets'));
    expect(total('voids')).toBeLessThan(total('sheets') * 0.25);
    // The one-off is placed only, and too big to absorb at arrival.
    const ga = UNIVERSE_DEBRIS.find((t) => t.id === 'great_attractor')!;
    expect(Object.keys(ga.rooms)).toHaveLength(0);
    expect(ga.size).toBeGreaterThan(AREAS.universe.arrivalRadius! * 0.7);
    // Bosses' chips (the shed ladder) find Universe Debris at every Universe size.
    for (const size of [0.2, 0.6, 1.2, 2.4]) expect(pickShedType(DEBRIS_TYPES, size, 21, 'universe')?.area, `${size}`).toBe('universe');
  });

  it('keeps the chapter and Tier lines within two lines', () => {
    const ch = STORY.areas.universe;
    expect(ch.title).toBe('One Place');
    for (const line of [...ch.entered, ...ch.cleared, ...ch.boss, ...STORY.tiers.dust_singularity!, ...STORY.tiers.everything!, ...STORY.debris.great_attractor!]) {
      for (const caption of typeof line === 'string' ? [line] : line) expect(caption.length, caption).toBeLessThanOrEqual(STORY_CAPTION_MAX);
    }
  });
});

describe('universe voids', () => {
  it('slow the Bunny while its centre is in a void (zone:void at TIMED_PRIORITY), and nowhere else', () => {
    const run = new Run(new EventBus(), { seed: 'universe-void', characterId: 'dusty', area: 'universe' });
    const b = run.bunny;
    const base = b.stats.get('speed');
    run.update(1 / 60);
    expect(roomAt(run.house, b.x, b.z)?.type).toBe('filaments');
    expect(b.stats.get('speed')).toBeCloseTo(base);
    const big = run.house.rooms.filter((r) => r.type === 'voids').sort((p, q) => (q.rect.maxX - q.rect.minX) * (q.rect.maxZ - q.rect.minZ) - (p.rect.maxX - p.rect.minX) * (p.rect.maxZ - p.rect.minZ))[0]!;
    b.x = (big.rect.minX + big.rect.maxX) / 2;
    b.z = (big.rect.minZ + big.rect.maxZ) / 2;
    run.update(1 / 60);
    expect(b.stats.get('speed')).toBeCloseTo(base * VOID_SLOW);
    run.update(1 / 60);
    expect(b.stats.get('speed')).toBeCloseTo(base * VOID_SLOW);
    b.x = run.house.spawn.x;
    b.z = run.house.spawn.z;
    run.update(1 / 60);
    expect(b.stats.get('speed')).toBeCloseTo(base);
    expect(VOID_SOURCE).toBe('zone:void');
  });
});
