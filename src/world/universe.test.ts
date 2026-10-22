import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/events';
import { AREAS } from '../data/areas';
import { DEBRIS_TYPES, roomWeight } from '../data/debris';
import { AREA_BOSSES } from '../data/hazards';
import { STORY, STORY_CAPTION_MAX } from '../data/story';
import { UNIVERSE_DEBRIS } from '../data/universeDebris';
import { formatLength } from '../data/units';
import { Run } from '../game/run';
import { roomAt } from './house';
import { generateUniverse, UNIVERSE, universeCentre, universeNodes } from './universe';
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

    it(`has superclusters at the nodes, filaments between them and voids for most of the space (seed ${seed})`, () => {
      const nodes = universeNodes(seed);
      expect(nodes.length).toBeGreaterThanOrEqual(UNIVERSE.nodes * 0.75);
      for (const n of nodes) expect(roomAt(u, n.x, n.z)?.type).toBe('superclusters');
      const area = (t: RoomType) => u.rooms.filter((r) => r.type === t).reduce((s, r) => s + (r.rect.maxX - r.rect.minX) * (r.rect.maxZ - r.rect.minZ), 0);
      expect(area('voids')).toBeGreaterThan(area('sheets'));
      expect(area('sheets')).toBeGreaterThan(area('filaments'));
      expect(area('filaments')).toBeGreaterThan(0);
      const filaments = (u.routes ?? []).filter((r) => r.kind === 'filament');
      expect(filaments.length).toBeGreaterThanOrEqual(nodes.length);
    });

    it(`spawns on a filament near the middle of the map (seed ${seed})`, () => {
      expect(roomAt(u, u.spawn.x, u.spawn.z)?.type).toBe('filaments');
      expect(u.rooms.find((r) => r.id === u.spawn.roomId)).toBeTruthy();
      expect(Math.hypot(u.spawn.x - c.x, u.spawn.z - c.z)).toBeLessThan(UNIVERSE.width / 4);
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

  it('keeps the chapter and Tier lines within two lines', () => {
    const ch = STORY.areas.universe;
    expect(ch.title).toBe('One Place');
    for (const line of [...ch.entered, ...ch.cleared, ...ch.boss, ...STORY.tiers.dust_singularity!, ...STORY.tiers.everything!]) {
      for (const caption of typeof line === 'string' ? [line] : line) expect(caption.length, caption).toBeLessThanOrEqual(STORY_CAPTION_MAX);
    }
  });
});
