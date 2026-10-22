import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/events';
import {
  AREA_BOSSES,
  AREA_DIRECTORS,
  ASAT_LASER,
  BROOM,
  DEBRIS_SATELLITE,
  GLOBE_HURRICANE,
  MINI_SWEEPER,
  ORBITAL_SWEEPER,
  REENTRY_BURN,
  SPACE_STATION,
  CROP_DUSTER,
  DIRECTOR_EXCLUDE,
  FLOOR_SCRUBBER,
  FREIGHT_TRAIN,
  GARBAGE_TRUCK,
  GLACIER_TONGUE,
  HURRICANE,
  ICE_SHEET,
  INCINERATOR,
  LANDFILL_COMPACTOR,
  MINI_COMPACTOR,
  LAWN_MOWER,
  LEAF_BLOWER,
  LINT_ROLLER,
  LITTER_VACUUM,
  MINI_MOWER,
  MINI_ROOMBA,
  MINI_SCRUBBER,
  MOP,
  PRESSURE_WASHER,
  RIVER_BARGE,
  RIVER_SURGE,
  ROBO_MOWER,
  ROBOVAC_9000,
  ROOMBA,
  SNOWPLOW,
  SPRAY_BOTTLE,
  SPRINKLER,
  STREET_FLUSHER,
  STREET_SWEEPER,
  TORNADO,
  UPRIGHT_VACUUM,
  VOLCANO,
  WATER_BOMBER,
  type BossTuning,
  COMET,
  ROGUE_ASTEROID,
  SOLAR_FLARE,
  SUNGRAZER,
  SUNSPOT,
  THE_SUN,
  BLACK_HOLE,
  GLOBULAR_CLUSTER,
  PULSAR,
  SAGITTARIUS_A,
  SUPERNOVA,
  SUPERNOVA_REMNANT,
} from '../data/hazards';
import { areaUnit } from '../data/areas';
import { getTier } from '../data/tiers';
import { getHazardDirector, installGameplay } from '../game/assembly';
import { Run } from '../game/run';
import type { AreaId } from '../world/types';
import { hazardFloorFree } from './common';
import type { HazardDirector } from './director';
import { HazardManager, hazardRegistry, type HazardFootprint } from './index';
import './content';

const BOSSES: Record<string, BossTuning> = { robovac_9000: ROBOVAC_9000, street_sweeper: STREET_SWEEPER, garbage_truck: GARBAGE_TRUCK, incinerator: INCINERATOR, ice_sheet: ICE_SHEET, orbital_sweeper: ORBITAL_SWEEPER, the_sun: THE_SUN, sagittarius_a: SAGITTARIUS_A };

/**
 * The tuning each registered Hazard is built from. A new Hazard must be listed here, so its
 * placement footprint is checked against the tuning it is constructed with.
 */
const TUNING: Record<string, { size: number; height: number }> = {
  roomba: ROOMBA,
  mini_roomba: MINI_ROOMBA,
  lint_roller: LINT_ROLLER,
  spray_bottle: SPRAY_BOTTLE,
  mop: MOP,
  upright_vacuum: UPRIGHT_VACUUM,
  robo_mower: ROBO_MOWER,
  mini_mower: MINI_MOWER,
  lawn_mower: LAWN_MOWER,
  leaf_blower: LEAF_BLOWER,
  sprinkler: SPRINKLER,
  floor_scrubber: FLOOR_SCRUBBER,
  mini_scrubber: MINI_SCRUBBER,
  mini_compactor: MINI_COMPACTOR,
  pressure_washer: PRESSURE_WASHER,
  litter_vacuum: LITTER_VACUUM,
  street_flusher: STREET_FLUSHER,
  landfill_compactor: LANDFILL_COMPACTOR,
  snowplow: SNOWPLOW,
  freight_train: FREIGHT_TRAIN,
  crop_duster: CROP_DUSTER,
  river_barge: RIVER_BARGE,
  water_bomber: WATER_BOMBER,
  tornado: TORNADO,
  glacier_tongue: GLACIER_TONGUE,
  volcano: VOLCANO,
  river_surge: RIVER_SURGE,
  hurricane: HURRICANE,
  debris_satellite: DEBRIS_SATELLITE,
  space_station: SPACE_STATION,
  asat_laser: ASAT_LASER,
  reentry_burn: REENTRY_BURN,
  globe_hurricane: GLOBE_HURRICANE,
  mini_sweeper: MINI_SWEEPER,
  rogue_asteroid: ROGUE_ASTEROID,
  comet: COMET,
  sunspot: SUNSPOT,
  sungrazer: SUNGRAZER,
  solar_flare: SOLAR_FLARE,
  black_hole: BLACK_HOLE,
  globular_cluster: GLOBULAR_CLUSTER,
  pulsar: PULSAR,
  supernova_remnant: SUPERNOVA_REMNANT,
  supernova: SUPERNOVA,
  ...BOSSES,
};

/**
 * Deliberate envelopes: placement dimensions that are not the tuning's size × height. Everything
 * else must match its tuning exactly.
 */
const ENVELOPES: Record<string, HazardFootprint> = {
  // Half the sweep around the pivot, at bristle-head height (BROOM has no size × height pair).
  broom: { radius: BROOM.sweepRadius * 0.5, height: 10 },
  // Bosses use their full-size contact radius rather than their absorb size.
  ...Object.fromEntries(Object.entries(BOSSES).map(([id, c]) => [id, { radius: c.contactRadius, height: c.height }])),
};

const AREAS: AreaId[] = ['house', 'neighborhood', 'city', 'region', 'continent', 'globe', 'solar_system', 'galaxy'];
/** Every Hazard that can show up in an area: its spawn tables, its boss and the boss's minis (if it summons any). */
function areaHazards(area: AreaId): string[] {
  const ids = new Set<string>();
  for (const t of AREA_DIRECTORS[area].tiers) for (const id of Object.keys(t.types)) ids.add(id);
  const boss = AREA_BOSSES[area].id;
  ids.add(boss);
  const mini = BOSSES[boss]!.miniId;
  if (mini) ids.add(mini);
  return [...ids];
}

const makeRun = (area: AreaId, seed = `placement-${area}`) => {
  const events = new EventBus();
  const run = new Run(events, { seed, characterId: 'lint', area });
  installGameplay(run);
  return { events, run, director: getHazardDirector(run)! };
};

/** Bunny radius (in the area's unit) at the first Tier an area covers (a debug-start sized Bunny). */
const areaStartRadius = (area: AreaId) => (getTier(AREA_DIRECTORS[area].firstTier).minRadius * 1.05) / areaUnit(area);

/**
 * Records every spot passed to run.hazards.spawn (the placement point: a Broom moves x / z to
 * its head when built) and whether it was clear for that Hazard's footprint.
 */
function trackPlacements(run: Run): { id: string; x: number; z: number; clear: boolean }[] {
  const out: { id: string; x: number; z: number; clear: boolean }[] = [];
  const mgr = run.hazards;
  const spawn = mgr.spawn.bind(mgr);
  mgr.spawn = (id, x, z) => {
    const fp = HazardManager.footprint(id);
    out.push({ id, x, z, clear: hazardFloorFree(run.house, x, z, fp.radius, fp.height) });
    return spawn(id, x, z);
  };
  return out;
}

describe('Hazard placement knowledge', () => {
  it('every registered Hazard declares a footprint, and every id the director or a boss can spawn is registered', () => {
    const ids = hazardRegistry.all().map((d) => d.id);
    expect(ids.sort()).toEqual(Object.keys({ ...TUNING, ...ENVELOPES }).sort());
    for (const def of hazardRegistry.all()) {
      expect(def.footprint.radius, def.id).toBeGreaterThan(0);
      expect(def.footprint.height, def.id).toBeGreaterThan(0);
    }
    for (const area of AREAS) for (const id of areaHazards(area)) expect(hazardRegistry.has(id), `${area}: ${id}`).toBe(true);
    for (const id of DIRECTOR_EXCLUDE) expect(hazardRegistry.has(id), id).toBe(true);
  });

  it('footprints match the tuning each Hazard is built from, except the explicit envelopes', () => {
    for (const def of hazardRegistry.all()) {
      const expected = ENVELOPES[def.id] ?? { radius: TUNING[def.id]!.size, height: TUNING[def.id]!.height };
      expect(def.footprint, def.id).toEqual(expected);
    }
    // The Broom reserves more room than its bristle head.
    expect(BROOM.sweepRadius * 0.5).toBeGreaterThan(BROOM.headRadius);
  });

  it('a constructed Hazard has the size its footprint was derived from', () => {
    for (const area of AREAS) {
      const { run } = makeRun(area);
      for (const id of areaHazards(area)) {
        if (ENVELOPES[id]) continue;
        const h = run.hazards.spawn(id, run.bunny.x, run.bunny.z);
        expect(h.size, id).toBe(HazardManager.footprint(id).radius);
      }
    }
  });

  it('the Mini Roomba is placed with its own 11 × 7 cm footprint (not a generic 15 × 20 fallback)', () => {
    expect(HazardManager.footprint('mini_roomba')).toEqual({ radius: MINI_ROOMBA.size, height: MINI_ROOMBA.height });
    expect(HazardManager.footprint('mini_roomba')).toEqual({ radius: 11, height: 7 });
    // Debug placement tries the first candidate at radius + footprint + 20 straight along +X.
    const { run, director } = makeRun('house', 'mini-roomba-debug');
    moveToOpenFloor(run);
    const b = run.bunny;
    const h = director.spawnNear(run, run.hazards, 'mini_roomba')!;
    expect(h.def.id).toBe('mini_roomba');
    expect(h.z).toBeCloseTo(b.z, 6);
    expect(h.x - b.x).toBeCloseTo(b.radius + 11 + 20, 6);
    // Boss summons read the same footprint.
    expect(ROBOVAC_9000.miniId).toBe('mini_roomba');
  });

  it('an unknown Hazard id has no silent fallback footprint', () => {
    expect(() => HazardManager.footprint('not_a_hazard')).toThrow();
    const { run, director } = makeRun('house');
    expect(director.spawnNear(run, run.hazards, 'not_a_hazard')).toBeNull();
  });

  it('debug-spawns a Mini Roomba under low furniture its own height clears (the old 15 × 20 fallback did not)', () => {
    // An armchair (9 cm clearance) in some seeded house: 7 cm Mini Roombas drive under it.
    let found: { run: Run; director: HazardDirector; x: number; z: number } | null = null;
    for (let i = 0; i < 20 && !found; i++) {
      const { run, director } = makeRun('house', `low-furniture-${i}`);
      const o = run.house.obstacles.find((o) => o.kind === 'furniture' && o.clearance > MINI_ROOMBA.height && o.clearance <= 20 && o.rect.maxX - o.rect.minX > 60);
      if (o) found = { run, director, x: (o.rect.minX + o.rect.maxX) / 2, z: (o.rect.minZ + o.rect.maxZ) / 2 };
    }
    expect(found).not.toBeNull();
    const { run, director, x, z } = found!;
    const fp = HazardManager.footprint('mini_roomba');
    expect(hazardFloorFree(run.house, x, z, fp.radius, fp.height)).toBe(true);
    expect(hazardFloorFree(run.house, x, z, 15, 20)).toBe(false);
    // The first debug candidate (radius + footprint + 20 along +X) is the middle of that furniture.
    const b = run.bunny;
    b.teleport(x - (b.radius + fp.radius + 20), z);
    const h = director.spawnNear(run, run.hazards, 'mini_roomba')!;
    expect(h.x).toBeCloseTo(x, 6);
    expect(h.z).toBeCloseTo(z, 6);
  });

  for (const area of AREAS) {
    it(`debug spawns place every ${area} Hazard (ordinary, boss and summoned mini) on a spot clear for its footprint`, () => {
      const { run, director } = makeRun(area, `debug-${area}`);
      const placements = trackPlacements(run);
      run.bunny.setRadius(areaStartRadius(area));
      for (const id of areaHazards(area)) {
        for (const spot of obstacleEdges(run, 4)) {
          run.bunny.teleport(spot.x, spot.z);
          const h = director.spawnNear(run, run.hazards, id);
          // One boss per area: the first call spawns it, later calls do nothing.
          if (hazardRegistry.require(id).boss && run.hazards.count(id) === 1 && !h) continue;
          expect(h?.def.id, `${area}: ${id}`).toBe(id);
          const p = placements.at(-1)!;
          expect(p.clear, `${area}: ${id} at ${p.x.toFixed(0)}, ${p.z.toFixed(0)}`).toBe(true);
        }
        for (const h of run.hazards.hazards) if (!h.def.boss) h.dead = true;
        run.update(0);
      }
      expect(run.hazards.count(AREA_BOSSES[area].id)).toBe(1);
    });

    it(`director spawns, the ${area} boss arrival and its summons all land on spots clear for their footprints`, () => {
      const { run } = makeRun(area, `director-${area}`);
      const placements = trackPlacements(run);
      run.bunny.health = 999;
      run.bunny.invulnerable = 1e9;
      const { firstTier, tiers } = AREA_DIRECTORS[area];
      const step = (seconds: number) => {
        for (let i = 0; i < 60 * seconds && !run.ended; i++) run.update(1 / 60);
      };
      for (let t = firstTier; t < firstTier + tiers.length; t++) {
        run.bunny.setRadius((getTier(t).minRadius * 1.05) / run.unit);
        step(25);
      }
      step(AREA_BOSSES[area].arrivalDelay + 20);
      expect(placements.filter((p) => !p.clear)).toEqual([]);
      const ids = new Set(placements.map((p) => p.id));
      expect(ids.has(AREA_BOSSES[area].id), `${area} boss`).toBe(true);
      // Bosses with a summon (the Ice Sheet calves icebergs instead).
      const mini = BOSSES[AREA_BOSSES[area].id]!.miniId;
      if (mini) expect(ids.has(mini), `${area} minis`).toBe(true);
      expect(ids.size).toBeGreaterThan(3);
    });
  }
});

/** Moves the Bunny to an open floor spot (not under furniture) so placement is unobstructed nearby. */
function moveToOpenFloor(run: Run): void {
  const bd = run.house.bounds;
  for (let x = bd.minX + 80; x < bd.maxX - 80; x += 20) {
    for (let z = bd.minZ + 80; z < bd.maxZ - 80; z += 20) {
      if (hazardFloorFree(run.house, x, z, 90, 500)) {
        run.bunny.teleport(x, z);
        return;
      }
    }
  }
  throw new Error('no open floor');
}

/**
 * Up to `n` floor spots for the Bunny right next to furniture (or walls, in a layout with little
 * furniture such as the placeholder Region), so nearby candidates are blocked.
 */
function obstacleEdges(run: Run, n: number): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  const r = run.bunny.radius;
  const obstacles = [...run.house.obstacles.filter((o) => o.kind === 'furniture'), ...run.house.obstacles.filter((o) => o.kind === 'wall')];
  for (const o of obstacles) {
    const x = o.rect.maxX + r + 2;
    const z = (o.rect.minZ + o.rect.maxZ) / 2;
    if (!hazardFloorFree(run.house, x, z, r, 1e4)) continue;
    out.push({ x, z });
    if (out.length >= n) break;
  }
  // A map with no obstacles (the Globe, which wraps east–west): its seam and its polar edges.
  if (!out.length && run.house.obstacles.length === 0) {
    const b = run.house.bounds;
    const mx = (b.minX + b.maxX) / 2;
    const mz = (b.minZ + b.maxZ) / 2;
    out.push({ x: b.minX + 0.5, z: mz }, { x: b.maxX - 0.5, z: mz }, { x: mx, z: b.minZ + r + 1 }, { x: mx, z: b.maxZ - r - 1 });
    return out.slice(0, n);
  }
  if (!out.length) throw new Error('no furniture edge');
  return out;
}
