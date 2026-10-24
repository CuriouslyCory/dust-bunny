/**
 * The contract every Area's Hazards keep, checked over `AREA_ORDER`: they run in the Area's unit,
 * are a threat on arrival and absorbable before the boss, the spawn tables list only them, the
 * director spawns them and brings the boss at its arrival size, and the boss arrives short of its
 * absorb radius. Area-specific behaviour stays in each Area's own test file.
 */
import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/events';
import { AREAS } from '../data/areas';
import {
  AREA_BOSSES,
  AREA_DIRECTORS,
  areaTiers,
  bossAbsorbRadius,
  bossArrivalRadius,
  BROOM,
  cityTiers,
  continentTiers,
  DIRECTOR_EXCLUDE,
  FREIGHT_TRAIN,
  GAMMA_RAY_BURST,
  galaxyTiers,
  globeTiers,
  DEBRIS_SATELLITE,
  LEAF_BLOWER,
  outdoorTiers,
  PULSAR,
  regionTiers,
  ROGUE_ASTEROID,
  solarTiers,
  STREET_FLUSHER,
  TORNADO,
  tierValue,
  universeTiers,
  type PerTier,
} from '../data/hazards';
import { getTier } from '../data/tiers';
import { installGameplay } from '../game/assembly';
import { areaStartRadius, Run } from '../game/run';
import { AREA_ORDER, type AreaId } from '../world/types';
import { roomAt } from '../world/house';
import { absorbRadiusFor, hazardFloorFree } from './common';
import { spawnWeights } from './director';
import { hazardRegistry } from './index';

const ratio = 0.7;

interface AreaContract {
  /** The Area's own Hazards (the director's random picks there). */
  hazards: readonly string[];
  /** Centimetres per world unit. */
  unit: number;
  /** The boss's def name, as `bossSpawned` reports it (HUD copy adds "the": no article here). */
  bossName: string;
  hits: number;
  /** What the boss summons (`BossTuning.miniId`). */
  miniId?: string;
  /** Hazards that join the tables at a later Tier of the band (absent the Tier before). */
  newcomers?: Readonly<Record<string, number>>;
  /** A per-Tier table of one of its Hazards: one entry per Tier up to the band's last. */
  perTier: PerTier;
  /** The boss's absorb radius (Area units), where it is tuned to one. */
  bossAbsorb?: number;
  /**
   * Hazards that join in an earlier Tier than the band's last are food by early in the last one:
   * absorbable below its first radius × this.
   */
  foodBy: number;
  /** Open floor the absorb checks spawn on: `clear` units free all round, in a `zone` room if given. */
  open: { clear: number; zone?: string };
  /** Every Hazard the director placed is within this many units of the Bunny (spawned just outside the view). */
  spawnWithin?: number;
}

const CONTRACTS: Record<AreaId, AreaContract> = {
  house: { hazards: ['roomba', 'lint_roller', 'broom', 'spray_bottle', 'mop', 'upright_vacuum'], unit: 1, bossName: 'Robo-Vac 9000', hits: 3, miniId: 'mini_roomba', perTier: BROOM.telegraph, foodBy: 1, open: { clear: 100 } },
  neighborhood: { hazards: ['robo_mower', 'lawn_mower', 'leaf_blower', 'sprinkler'], unit: 1, bossName: 'Street Sweeper', hits: 3, miniId: 'mini_mower', newcomers: { lawn_mower: 6 }, perTier: LEAF_BLOWER.speed, foodBy: 1, open: { clear: 500 } },
  city: { hazards: ['floor_scrubber', 'pressure_washer', 'litter_vacuum', 'street_flusher'], unit: 1, bossName: 'Garbage Truck', hits: 3, miniId: 'mini_scrubber', newcomers: { street_flusher: 8 }, perTier: STREET_FLUSHER.speed, foodBy: 1, open: { clear: 1000 } },
  region: { hazards: ['landfill_compactor', 'snowplow', 'freight_train', 'crop_duster', 'river_barge', 'water_bomber'], unit: 1000, bossName: 'Incinerator', hits: 3, miniId: 'mini_compactor', newcomers: { freight_train: 11, water_bomber: 11 }, perTier: FREIGHT_TRAIN.speed, foodBy: 1.1, open: { clear: 14 }, spawnWithin: 150 },
  continent: { hazards: ['tornado', 'glacier_tongue', 'volcano', 'river_surge', 'hurricane'], unit: 1e6, bossName: 'Ice Sheet', hits: 3, newcomers: { hurricane: 13 }, perTier: TORNADO.speed, bossAbsorb: 4, foodBy: 1.1, open: { clear: 14, zone: 'plains' }, spawnWithin: 150 },
  globe: { hazards: ['debris_satellite', 'space_station', 'asat_laser', 'reentry_burn', 'globe_hurricane'], unit: 1e8, bossName: 'Orbital Sweeper', hits: 3, miniId: 'mini_sweeper', newcomers: { globe_hurricane: 15 }, perTier: DEBRIS_SATELLITE.speed, bossAbsorb: 4, foodBy: 1.1, open: { clear: 14 }, spawnWithin: 150 },
  solar_system: { hazards: ['rogue_asteroid', 'comet', 'sunspot', 'sungrazer', 'solar_flare'], unit: 1.496e11, bossName: 'The Sun', hits: 3, newcomers: { solar_flare: 17 }, perTier: ROGUE_ASTEROID.speed, bossAbsorb: 4, foodBy: 1.1, open: { clear: 14 }, spawnWithin: 150 },
  galaxy: { hazards: ['black_hole', 'globular_cluster', 'pulsar', 'supernova_remnant', 'supernova'], unit: 9.461e19, bossName: 'Sagittarius A*', hits: 5, newcomers: { supernova: 19 }, perTier: PULSAR.range, bossAbsorb: 4, foodBy: 1.1, open: { clear: 14 }, spawnWithin: 150 },
  universe: { hazards: ['quasar', 'colliding_galaxy', 'gamma_ray_burst', 'cosmic_void', 'dark_energy_gust'], unit: 9.461e24, bossName: 'The Expansion', hits: 7, newcomers: { dark_energy_gust: 21 }, perTier: GAMMA_RAY_BURST.range, foodBy: 1.1, open: { clear: 40 } },
};

const makeRun = (area: AreaId, seed = `contract-${area}`) => {
  const events = new EventBus();
  const run = new Run(events, { seed, characterId: 'lint', area });
  return { events, run };
};

const step = (run: Run, seconds: number) => {
  for (let i = 0; i < 60 * seconds && !run.ended; i++) run.update(1 / 60);
};

/** Bunny radius (`area`'s units) at the start of a Tier. */
const tierRadius = (area: AreaId, tier: number) => getTier(tier).minRadius / AREAS[area].unit;

/** First Tier whose spawn table in `area` lists `id` (the tables decide when a Hazard first appears). */
function firstTableTier(id: string, area: AreaId): number {
  const { firstTier, tiers } = AREA_DIRECTORS[area];
  const i = tiers.findIndex((t) => id in t.types);
  if (i < 0) throw new Error(`${id} is not in the ${area} spawn tables`);
  return firstTier + i;
}

/** The open spot nearest the Area's spawn (`AreaContract.open`); the Bunny is moved there. */
function moveToOpen(run: Run, open: AreaContract['open']): { x: number; z: number } {
  const { bounds: bd, spawn } = run.house;
  const stepSize = open.clear / 2;
  const spots: Array<{ x: number; z: number }> = [];
  for (let x = bd.minX + open.clear; x <= bd.maxX - open.clear; x += stepSize) {
    for (let z = bd.minZ + open.clear; z <= bd.maxZ - open.clear; z += stepSize) spots.push({ x, z });
  }
  spots.unshift({ x: spawn.x, z: spawn.z });
  spots.sort((a, b) => Math.hypot(a.x - spawn.x, a.z - spawn.z) - Math.hypot(b.x - spawn.x, b.z - spawn.z));
  const p = spots.find(({ x, z }) => {
    const room = roomAt(run.house, x, z);
    return room && (!open.zone || room.type === open.zone) && hazardFloorFree(run.house, x, z, open.clear, 1e4);
  });
  if (!p) throw new Error(`no open floor in the ${run.area}`);
  run.bunny.teleport(p.x, p.z);
  return p;
}

const tableIds = (area: AreaId, tier: number) => Object.keys(spawnWeights(tier, {}, area));
const bossIds = (area: AreaId) => [AREA_BOSSES[area].id, ...(AREA_BOSSES[area].miniId ? [AREA_BOSSES[area].miniId!] : [])];

describe.each(AREA_ORDER.map((area) => ({ area, c: CONTRACTS[area] })))('$area Hazards', ({ area, c }) => {
  const [firstTier, lastTier] = AREAS[area].tiers;

  it('run in the Area unit, the Bunny arriving at its start size, with their own models', () => {
    const { run } = makeRun(area);
    expect(run.unit).toBe(c.unit);
    expect(run.unit).toBe(AREAS[area].unit);
    expect(run.bunny.radius).toBeCloseTo(AREAS[area].arrivalRadius ?? Math.max(areaStartRadius(area), run.bunny.realRadius) / run.unit);
    for (const id of [...c.hazards, AREA_BOSSES[area].id]) expect(hazardRegistry.require(id).modelId, id).toBe(id);
  });

  it('are a threat on arrival and absorbable before the boss; the early ones are food by early in the last Tier', () => {
    const boss = bossAbsorbRadius(area, ratio);
    const last = tierRadius(area, lastTier);
    for (const id of c.hazards) {
      const { run } = makeRun(area, `absorb-${id}`);
      const arrival = run.bunny.radius;
      const p = moveToOpen(run, c.open);
      const h = run.hazards.spawn(id, p.x + c.open.clear / 2, p.z);
      expect(h.dead, id).toBeFalsy();
      const need = absorbRadiusFor(h.size, ratio);
      expect(need, id).toBeGreaterThan(arrival);
      const first = firstTableTier(id, area);
      expect(need, id).toBeGreaterThan(tierRadius(area, first));
      expect(need, id).toBeLessThan(boss);
      if (first < lastTier) expect(need, id).toBeLessThan(last * c.foodBy);
    }
    expect(hazardRegistry.require(AREA_BOSSES[area].id).boss).toBe(true);
    // The boss is not food in its Area's Tiers; what it summons is.
    expect(boss).toBeGreaterThan(last);
    if (c.miniId) {
      const { run } = makeRun(area, 'absorb-mini');
      const p = moveToOpen(run, c.open);
      const mini = run.hazards.spawn(c.miniId, p.x + c.open.clear / 2, p.z);
      expect(absorbRadiusFor(mini.size, ratio)).toBeLessThan(last);
    }
  });

  it('spawn tables list only its Hazards, newcomers from their Tier, never the boss or its summons', () => {
    const director = AREA_DIRECTORS[area];
    for (let t = director.firstTier; t <= lastTier; t++) {
      const ids = tableIds(area, t);
      expect(ids.length, `Tier ${t}`).toBeGreaterThan(0);
      for (const id of ids) expect(c.hazards, `Tier ${t}`).toContain(id);
    }
    // A Bunny that arrives a Tier early uses the first table of the band.
    expect(tableIds(area, firstTier - 1)).toEqual(tableIds(area, firstTier));
    for (const [id, tier] of Object.entries(c.newcomers ?? {})) {
      expect(tableIds(area, tier - 1)).not.toContain(id);
      expect(tableIds(area, tier)).toContain(id);
    }
    for (const id of bossIds(area)) expect(DIRECTOR_EXCLUDE).toContain(id);
    expect(AREA_BOSSES[area].miniId).toBe(c.miniId);
    for (const other of AREA_ORDER) {
      if (other === area) continue;
      for (const t of AREA_DIRECTORS[other].tiers) for (const id of c.hazards) expect(Object.keys(t.types), `${other} tables`).not.toContain(id);
    }
    // Per-Tier tables run to the band's last Tier: earlier Tiers (a Bunny arriving a Tier early)
    // get the band's first value, later ones the last.
    expect(c.perTier).toHaveLength(lastTier);
    for (let t = 1; t < firstTier; t++) expect(tierValue(c.perTier, t), `Tier ${t}`).toBe(c.perTier[firstTier - 1]);
    expect(tierValue(c.perTier, lastTier + 3)).toBe(c.perTier[lastTier - 1]);
  });

  it('the director spawns its Hazards and brings the boss at its arrival size', () => {
    const { run, events } = makeRun(area, `director-${area}`);
    installGameplay(run);
    const spawned: string[] = [];
    const bosses: string[] = [];
    events.on('hazardSpawned', (e) => spawned.push(e.defId));
    events.on('bossSpawned', (e) => bosses.push(e.name));
    run.bunny.health = 999;
    // It arrives in the band's first Tier, or the Tier before it (after a size leap).
    const tier = run.tier;
    expect([firstTier - 1, firstTier]).toContain(tier);
    step(run, 40);
    expect(run.tier).toBe(tier);
    run.bunny.setRadius(bossArrivalRadius(area, run.bunny.stats.get('absorbRatio')) * 0.95);
    step(run, 60);
    expect(spawned.length).toBeGreaterThan(2);
    expect(bosses).toEqual([]);

    run.bunny.setRadius(bossArrivalRadius(area, run.bunny.stats.get('absorbRatio')) * 1.02);
    step(run, AREA_BOSSES[area].arrivalDelay + 1);
    expect(bosses).toEqual([c.bossName]);
    expect(run.hazards.count(AREA_BOSSES[area].id)).toBe(1);
    for (const id of spawned) expect([...c.hazards, ...bossIds(area)]).toContain(id);
    if (c.spawnWithin !== undefined) {
      // Hazards spawn just outside the view: in the Area's units, not hundreds of units away.
      const b = run.bunny;
      for (const h of run.hazards.hazards) expect(Math.hypot(h.x - b.x, h.z - b.z), h.def.id).toBeLessThan(c.spawnWithin);
    }
  });

  it('the boss arrives short of its absorb radius and its hits break it', () => {
    expect(AREA_BOSSES[area]).toMatchObject({ hits: c.hits });
    expect(hazardRegistry.require(AREA_BOSSES[area].id).name).toBe(c.bossName);
    const absorb = bossAbsorbRadius(area, ratio);
    if (c.bossAbsorb !== undefined) expect(absorb).toBeCloseTo(c.bossAbsorb, 1);
    if (Number.isFinite(absorb)) {
      expect(bossArrivalRadius(area, ratio)).toBeLessThan(absorb);
      expect(absorb).toBeCloseTo(absorbRadiusFor(AREA_BOSSES[area].size, ratio));
    } else {
      // Never absorbed by size: it arrives at a Tier.
      expect(bossArrivalRadius(area, ratio)).toBeCloseTo(tierRadius(area, AREA_BOSSES[area].tier!));
    }
  });
});

describe('derived Area data', () => {
  it('per-Area Tier helpers give the tables the hand-written ones did', () => {
    const v = [3, 5, 7];
    const rep = (n: number, x: number) => Array<number>(n).fill(x);
    // The hand-written helpers before they were derived from AREAS[area].tiers.
    expect(outdoorTiers(3, 5, 7)).toEqual([3, 3, 3, 3, 3, 5, 7]);
    expect(cityTiers(3, 5, 7)).toEqual([...rep(7, 3), 5, 7]);
    expect(regionTiers(3, 5)).toEqual([...rep(10, 3), 5]);
    expect(continentTiers(3, 5)).toEqual([...rep(12, 3), 5]);
    expect(globeTiers(3, 5)).toEqual([...rep(14, 3), 5]);
    expect(solarTiers(3, 5)).toEqual([...rep(16, 3), 5]);
    expect(galaxyTiers(3, 5)).toEqual([...rep(18, 3), 5]);
    expect(universeTiers(3, 5)).toEqual([...rep(20, 3), 5]);
    expect(() => areaTiers('city', ...v.slice(0, 2))).toThrow();
  });

  it('the director exclude list is every boss and its summons, as it was hand-listed', () => {
    expect(DIRECTOR_EXCLUDE).toEqual(['robovac_9000', 'mini_roomba', 'street_sweeper', 'mini_mower', 'garbage_truck', 'mini_scrubber', 'incinerator', 'mini_compactor', 'ice_sheet', 'orbital_sweeper', 'mini_sweeper', 'the_sun', 'sagittarius_a', 'the_expansion']);
  });
});
