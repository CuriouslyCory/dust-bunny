import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/events';
import { rect } from '../core/math';
import { AREAS } from '../data/areas';
import { getDebrisType } from '../data/debris';
import {
  bossAbsorbRadius,
  bossArrivalRadius,
  AREA_BOSSES,
  AREA_DIRECTORS,
  CITY_DIRECTOR,
  CONTINENT_DIRECTOR,
  DIRECTOR,
  DIRECTOR_EXCLUDE,
  GLACIER_TONGUE,
  HURRICANE,
  ICE_SHEET,
  NEIGHBORHOOD_DIRECTOR,
  REGION_DIRECTOR,
  RIVER_SURGE,
  TORNADO,
  VOLCANO,
  tierValue,
} from '../data/hazards';
import { CALVED_ICEBERG_ID } from '../data/iceSheetDebris';
import { getTier } from '../data/tiers';
import type { Debris } from '../entities/debris';
import { getHazardDirector, installGameplay } from '../game/assembly';
import { Run } from '../game/run';
import { roomAt } from '../world/house';
import type { AreaId, HouseLayout, Obstacle } from '../world/types';
import { absorbRadiusFor, hazardFloorFree } from './common';
import { spawnWeights } from './director';
import { IceSheet, isMountainRange, touchesMountainRange } from './iceSheet';
import { hazardRegistry } from './index';
import { GLACIER_ZONES } from './lintRoller';
import type { Mop } from './mop';
import type { SprayBottle } from './sprayBottle';
import type { UprightVacuum } from './uprightVacuum';

const CONTINENT_HAZARDS = ['tornado', 'glacier_tongue', 'volcano', 'river_surge', 'hurricane'];
const TUNINGS = { tornado: TORNADO, glacier_tongue: GLACIER_TONGUE, volcano: VOLCANO, river_surge: RIVER_SURGE, hurricane: HURRICANE } as const;
const ratio = 0.7;

/** A Run in the Continent (placeholder map, 200 × 150 units of 10 km); the Bunny arrives at 0.85 units. */
const makeRun = (seed = 'continent-hazards') => {
  const events = new EventBus();
  const run = new Run(events, { seed, characterId: 'lint', area: 'continent' });
  return { events, run };
};

/** Bunny radius (Continent units) at the start of a Tier. */
const tierRadius = (run: Run, tier: number) => getTier(tier).minRadius / run.unit;

const step = (run: Run, seconds: number) => {
  for (let i = 0; i < 60 * seconds && !run.ended; i++) run.update(1 / 60);
};

/** An open plains spot with `clear` units of free floor around it (no obstacle, inside the map). */
function openSpot(run: Run, clear = 14): { x: number; z: number } {
  const bd = run.house.bounds;
  for (let x = bd.minX + clear; x < bd.maxX - clear; x += 2) {
    for (let z = bd.minZ + clear; z < bd.maxZ - clear; z += 2) {
      if (roomAt(run.house, x, z)?.type === 'plains' && hazardFloorFree(run.house, x, z, clear, 1e4)) return { x, z };
    }
  }
  throw new Error('no open plains');
}

function moveToOpen(run: Run, clear = 14): { x: number; z: number } {
  const p = openSpot(run, clear);
  run.bunny.teleport(p.x, p.z);
  return p;
}

/** The first mountain-range obstacle on the map (the placeholder's massifs in the mountain belt). */
function mountain(house: HouseLayout): Obstacle {
  const o = house.obstacles.find((ob) => isMountainRange(house, ob));
  if (!o) throw new Error('no mountain range');
  return o;
}

function firstTableTier(id: string, area: AreaId): number {
  const { firstTier, tiers } = AREA_DIRECTORS[area];
  const i = tiers.findIndex((t) => id in t.types);
  if (i < 0) throw new Error(`${id} is not in the ${area} spawn tables`);
  return firstTier + i;
}

function icebergs(run: Run): Debris[] {
  const out: Debris[] = [];
  run.debris.forEach((d) => d.alive && d.type.id === CALVED_ICEBERG_ID && out.push(d));
  return out;
}

describe('continent Hazards', () => {
  it('arrives short of its absorb radius (about a minute of growth) and 3 hits break it', () => {
    expect(absorbRadiusFor(ICE_SHEET.size, ratio)).toBeCloseTo(4, 1);
    expect(bossArrivalRadius('continent', ratio)).toBeLessThan(bossAbsorbRadius('continent', ratio));
    expect(bossAbsorbRadius('continent', ratio)).toBeCloseTo(absorbRadiusFor(ICE_SHEET.size, ratio));
    expect(AREA_BOSSES.continent).toMatchObject({ id: 'ice_sheet', hits: 3 });
    expect(hazardRegistry.require('ice_sheet').boss).toBe(true);
    // It summons nothing: it calves icebergs.
    expect(ICE_SHEET.miniId).toBeUndefined();
  });

  it('run in Continent units (1 = 10 km) with their own Blender models', () => {
    const { run } = makeRun();
    expect(run.unit).toBe(1e6);
    expect(run.bunny.radius).toBeCloseTo(AREAS.continent.arrivalRadius!);
    for (const [id, cfg] of Object.entries(TUNINGS)) {
      expect(cfg.modelId, id).toBe(id);
      expect(hazardRegistry.require(id).modelId, id).toBe(id);
    }
    expect(hazardRegistry.require('ice_sheet').modelId).toBe('ice_sheet');
  });

  it('are a threat on arrival and absorbable before the Ice Sheet is; Tier 12 ones are food by early Tier 13', () => {
    const tier13 = tierRadius(makeRun().run, 13);
    const boss = absorbRadiusFor(ICE_SHEET.size, ratio);
    for (const id of CONTINENT_HAZARDS) {
      const { run } = makeRun(`absorb-${id}`);
      const p = moveToOpen(run);
      const h = run.hazards.spawn(id, p.x + 8, p.z);
      expect(h.dead, id).toBeFalsy();
      const need = absorbRadiusFor(h.size, ratio);
      expect(need, id).toBeGreaterThan(AREAS.continent.arrivalRadius!);
      const first = firstTableTier(id, 'continent');
      expect(need, id).toBeGreaterThan(tierRadius(run, first));
      expect(need, id).toBeLessThan(boss);
      if (first === 12) expect(need, id).toBeLessThan(tier13 * 1.1);
    }
  });


  it('continent spawn tables list only continent Hazards, Hurricanes from Tier 13, never the Ice Sheet', () => {
    for (let t = CONTINENT_DIRECTOR.firstTier; t <= 13; t++) {
      const ids = Object.keys(spawnWeights(t, {}, 'continent'));
      expect(ids.length).toBeGreaterThan(0);
      for (const id of ids) expect(CONTINENT_HAZARDS).toContain(id);
    }
    expect(Object.keys(spawnWeights(11, {}, 'continent'))).toEqual(Object.keys(spawnWeights(12, {}, 'continent')));
    expect(Object.keys(spawnWeights(12, {}, 'continent'))).not.toContain('hurricane');
    expect(Object.keys(spawnWeights(13, {}, 'continent'))).toContain('hurricane');
    expect(DIRECTOR_EXCLUDE).toContain('ice_sheet');
    for (const t of [...DIRECTOR.tiers, ...NEIGHBORHOOD_DIRECTOR.tiers, ...CITY_DIRECTOR.tiers, ...REGION_DIRECTOR.tiers]) for (const id of CONTINENT_HAZARDS) expect(Object.keys(t.types)).not.toContain(id);
    expect(tierValue(TORNADO.speed, 11)).toBe(TORNADO.speed[11]);
    expect(tierValue(TORNADO.speed, 13)).toBe(TORNADO.speed[12]);
  });

  it('the director spawns continent Hazards and brings the Ice Sheet at its arrival size, named without a doubled article', () => {
    const { run, events } = makeRun('continent-director');
    installGameplay(run);
    const spawned: string[] = [];
    const bosses: string[] = [];
    events.on('hazardSpawned', (e) => spawned.push(e.defId));
    events.on('bossSpawned', (e) => bosses.push(e.name));
    run.bunny.health = 999;
    step(run, 30);
    run.bunny.setRadius(bossArrivalRadius('continent', run.bunny.stats.get('absorbRatio')) * 0.95);
    step(run, 60);
    expect(spawned.length).toBeGreaterThan(2);
    expect(bosses).toEqual([]);
    run.bunny.setRadius(bossArrivalRadius('continent', run.bunny.stats.get('absorbRatio')) * 1.02);
    step(run, AREA_BOSSES.continent.arrivalDelay + 1);
    expect(bosses).toEqual(['Ice Sheet']);
    // HUD copy reads "the Ice Sheet" (areaHud, Tier-up banner): the def name has no article.
    expect(`hunt the ${bosses[0]}`).toBe('hunt the Ice Sheet');
    expect(run.hazards.count('ice_sheet')).toBe(1);
    for (const id of spawned) expect([...CONTINENT_HAZARDS, 'ice_sheet']).toContain(id);
    const b = run.bunny;
    for (const h of run.hazards.hazards) expect(Math.hypot(h.x - b.x, h.z - b.z), h.def.id).toBeLessThan(150);
  });

  it('the Tornado pulls the Bunny in and spins its funnel', () => {
    const { run } = makeRun('tornado');
    moveToOpen(run);
    const b = run.bunny;
    const h = run.hazards.spawn('tornado', b.x + b.radius + 1.3, b.z) as unknown as { yaw: number; model: { getObjectByName(n: string): { rotation: { y: number } } | undefined } };
    h.yaw = Math.PI / 2; // driving away (+X)
    const funnel = h.model.getObjectByName('funnel')!;
    const spin0 = funnel.rotation.y;
    const x0 = b.x;
    for (let i = 0; i < 10; i++) run.hazards.update(1 / 60, run);
    expect(b.x).toBeGreaterThan(x0 + 0.05);
    expect(funnel.rotation.y).not.toBe(spin0);
  });

  it('a Glacier Tongue creeps along a straight lane; a hit shoves the Bunny off it and sheds mass (no sticking)', () => {
    const { run, events } = makeRun('glacier');
    const p = moveToOpen(run);
    const b = run.bunny;
    const h = run.hazards.spawn('glacier_tongue', p.x + 6, p.z);
    expect(h.dead).toBeFalsy();
    const x0 = h.x;
    const z0 = h.z;
    let travelled = 0;
    let lx = h.x;
    let lz = h.z;
    for (let i = 0; i < 60 * 2; i++) {
      run.hazards.update(1 / 60, run);
      travelled += Math.hypot(h.x - lx, h.z - lz);
      lx = h.x;
      lz = h.z;
      b.teleport(p.x - 40, p.z - 40);
    }
    // Axis-aligned lane: one coordinate never changes.
    expect(Math.min(Math.abs(h.x - x0), Math.abs(h.z - z0))).toBeLessThan(1e-6);
    expect(travelled).toBeGreaterThan(0.5);
    // Slow: at most its Tier speed (+15 % ramp) over the 2 s (end pauses only slow it further).
    expect(travelled).toBeLessThanOrEqual(tierValue(GLACIER_TONGUE.speed, run.tier) * 1.15 * 2 + 1e-6);

    b.teleport(h.x + 2, h.z);
    let shed = 0;
    events.on('bunnyShed', (e) => e.source === 'glacier_tongue' && shed++);
    const r0 = b.radius;
    h.onContact!(run);
    expect(b.health).toBe(b.maxHealth - 1);
    expect(shed).toBe(1);
    expect(b.radius).toBeLessThan(r0);
    expect(b.rooted).toBe(0);
  });

  it('places Glacier Tongues in tundra or mountain zones when the map has them', () => {
    const { run } = makeRun('glacier-zones');
    installGameplay(run);
    const director = getHazardDirector(run)!;
    const def = hazardRegistry.require('glacier_tongue');
    expect(def.spawnZones).toEqual(GLACIER_ZONES);
    run.bunny.teleport(60, 40);
    for (let i = 0; i < 10; i++) {
      const spot = director.findSpot(run, def.footprint.radius, def.footprint.height, 10, 50, def.spawnZones);
      expect(spot).not.toBeNull();
      expect(GLACIER_ZONES).toContain(roomAt(run.house, spot!.x, spot!.z)!.type);
    }
  });

  it('the Volcano stays put, aims its crater, lobs lava bombs from on screen, and the ash slows', () => {
    const { run } = makeRun('volcano');
    const p = moveToOpen(run);
    const b = run.bunny;
    const speed0 = b.stats.get('speed');
    const h = run.hazards.spawn('volcano', p.x, p.z - 5) as SprayBottle;
    expect(tierValue(VOLCANO.range, run.tier)).toBeGreaterThan(5);
    run.hazards.update(1 / 60, run);
    const yaw0 = h.body.rotation.y;
    const crater = h.model.getObjectByName('crater')!;
    const aim0 = crater.rotation.y;
    let hit = false;
    let peak = 0;
    for (let i = 0; i < 60 * 8 && !hit; i++) {
      run.hazards.update(1 / 60, run);
      for (const d of h.droplets) peak = Math.max(peak, d.mesh.position.y);
      hit = b.health < b.maxHealth;
      expect(h.x).toBe(p.x);
    }
    expect(hit).toBe(true);
    // The cone never turns (only `crater` aims) and the bombs are lobbed above the vent.
    expect(h.body.rotation.y).toBe(yaw0);
    expect(crater.rotation.y).not.toBe(aim0);
    expect(peak).toBeGreaterThan(VOLCANO.nozzleHeight);
    expect(b.stats.get('speed')).toBeLessThan(speed0);
  });

  it("the River Surge's muddy trail slows the Bunny", () => {
    const { run } = makeRun('surge');
    const p = moveToOpen(run);
    const b = run.bunny;
    const speed0 = b.stats.get('speed');
    const h = run.hazards.spawn('river_surge', p.x + 10, p.z) as Mop;
    for (let i = 0; i < 60 * 4; i++) run.hazards.update(1 / 60, run);
    expect(h.puddles.length).toBeGreaterThan(3);
    expect(b.stats.get('speed')).toBe(speed0);
    const far = h.puddles.reduce((f, q) => (Math.hypot(q.x - h.x, q.z - h.z) > Math.hypot(f.x - h.x, f.z - h.z) ? q : f));
    expect(Math.hypot(far.x - h.x, far.z - h.z)).toBeGreaterThan(RIVER_SURGE.size + b.radius);
    b.teleport(far.x, far.z);
    run.hazards.update(1 / 60, run);
    expect(b.stats.get('speed')).toBeCloseTo(speed0 * RIVER_SURGE.slowMultiplier);
  });

  it("the Hurricane's wind cone pushes the Bunny away and soaks it, its bands spinning", () => {
    const { run } = makeRun('hurricane');
    const p = moveToOpen(run);
    const b = run.bunny;
    const speed0 = b.stats.get('speed');
    const h = run.hazards.spawn('hurricane', p.x + 6, p.z) as UprightVacuum;
    h.yaw = -Math.PI / 2; // the wind (+Z model forward) towards the Bunny (−X)
    h.state = 'on';
    const bands = h.model.getObjectByName('bands')!;
    const spin0 = bands.rotation.y;
    const d0 = Math.hypot(b.x - h.x, b.z - h.z);
    for (let i = 0; i < 20; i++) run.hazards.update(1 / 60, run);
    expect(Math.hypot(b.x - h.x, b.z - h.z)).toBeGreaterThan(d0 + 0.3);
    expect(b.stats.get('speed')).toBeLessThan(speed0);
    expect(h.ranged).toBe(true);
    expect(bands.rotation.y).not.toBe(spin0);
  });
});

describe('the Ice Sheet', () => {
  /** An Ice Sheet in its hunt, `d` units from a mid-Tier 12 Bunny on open plains (in front of it, +X). */
  function hunting(seed: string, d: number) {
    const { run, events } = makeRun(seed);
    // Room for the Ice Sheet behind it, inside the map.
    const p = moveToOpen(run, Math.max(20, d + 8));
    const b = run.bunny;
    b.health = 999;
    b.setRadius(2);
    const boss = run.hazards.spawn('ice_sheet', p.x - d, p.z) as IceSheet;
    expect(boss.x).toBe(p.x - d);
    boss.yaw = Math.PI / 2;
    boss.state = 'hunt';
    return { run, events, boss, b, p };
  }

  it('bulldozes: pushes a Bunny in front of it away without hurting it', () => {
    const { run, boss, b } = hunting('ice-push', 5.6);
    const d0 = Math.hypot(b.x - boss.x, b.z - boss.z);
    expect(d0).toBeGreaterThan(ICE_SHEET.contactRadius + b.radius);
    for (let i = 0; i < 10; i++) run.hazards.update(1 / 60, run);
    expect(Math.hypot(b.x - boss.x, b.z - boss.z)).toBeGreaterThan(d0 + 0.5);
    expect(b.health).toBe(999);
    // Beside it (outside the slab's width) nothing pushes.
    const side = { x: boss.x, z: boss.z + 7 };
    b.teleport(side.x, side.z);
    for (let i = 0; i < 10; i++) run.hazards.update(1 / 60, run);
    expect(Math.hypot(b.x - side.x, b.z - side.z)).toBeLessThan(0.05);
  });

  it('shoves loose Debris ahead of its front cliff', () => {
    const { run, boss, b } = hunting('ice-debris', 25);
    const index = run.debris.types.findIndex((t) => t.id === 'forest_patch');
    const k = (ICE_SHEET.size / ICE_SHEET.modelSize) * boss.scale;
    const front = ICE_SHEET.bulldoze.front * k;
    const d = run.debris.spawn(index, boss.x + front + 0.2, boss.z, run.rng, { size: 0.3 })!;
    expect(d).toBeTruthy();
    const x0 = d.x;
    for (let i = 0; i < 60; i++) {
      run.hazards.update(1 / 60, run);
      b.teleport(boss.x + 25, boss.z);
    }
    expect(boss.x).toBeGreaterThan(x0 - front - 0.2 + 1.5);
    expect(d.alive).toBe(true);
    expect(d.x).toBeGreaterThan(x0 + 1.5);
    expect(d.x - boss.x).toBeGreaterThanOrEqual(front);
  });

  it('a mountain range is the only obstacle that counts', () => {
    const { run } = makeRun('ice-predicate');
    const house = run.house;
    const m = mountain(house);
    expect(m.kind).toBe('furniture');
    expect(house.walls.length).toBeGreaterThan(0);
    for (const w of house.obstacles.filter((o) => o.kind === 'wall')) expect(isMountainRange(house, w)).toBe(false);
    // A `mountain…` furniture def counts anywhere; other furniture only inside a mountains zone.
    const p = openSpot(run);
    const r = rect(p.x - 2, p.z - 2, p.x + 2, p.z + 2);
    const add = (defId: string, id: string) => {
      house.furniture.push({ id, defId, roomId: roomAt(house, p.x, p.z)!.id, x: p.x, z: p.z, quarterTurns: 0, w: 4, d: 4, height: 3, rect: r });
      return { id: `${id}:body`, kind: 'furniture', rect: r, height: 3, clearance: 0, furnitureId: id } as Obstacle;
    };
    expect(isMountainRange(house, add('mountain_range', 'test:range'))).toBe(true);
    expect(isMountainRange(house, add('region_city_core', 'test:city'))).toBe(false);
    expect(touchesMountainRange(house, (m.rect.minX + m.rect.maxX) / 2, m.rect.minZ - 1, 0.99, ICE_SHEET.height, 0.05)).toBe(true);
    expect(touchesMountainRange(house, (m.rect.minX + m.rect.maxX) / 2, m.rect.minZ - 2, 0.99, ICE_SHEET.height, 0.05)).toBe(false);
  });

  /** Holds the Bunny between the Ice Sheet and an obstacle until a charge ends; returns what happened. */
  function chargeAt(seed: string, place: (run: Run) => { bunny: { x: number; z: number }; boss: { x: number; z: number } }) {
    const { run, events } = makeRun(seed);
    const b = run.bunny;
    b.health = 999;
    b.setRadius(2);
    const spot = place(run);
    b.teleport(spot.bunny.x, spot.bunny.z);
    const boss = run.hazards.spawn('ice_sheet', spot.boss.x, spot.boss.z) as IceSheet;
    let stuns = 0;
    let charges = 0;
    let blocked = 0;
    let regrowAtStun: number[] = [];
    let calvedAtStun = 0;
    let last = boss.state;
    events.on('bossStunned', (e) => {
      if (e.cause !== 'wall') return;
      stuns++;
      regrowAtStun = [...boss.regrow];
      calvedAtStun = boss.calved;
    });
    for (let i = 0; i < 60 * 40 && stuns === 0 && blocked === 0; i++) {
      run.hazards.update(1 / 60, run);
      b.teleport(spot.bunny.x, spot.bunny.z);
      if (last !== 'charge' && boss.state === 'charge') charges++;
      // A charge that ends before its full distance ran into something.
      if (last === 'charge' && boss.state === 'recover' && Math.hypot(boss.x - spot.boss.x, boss.z - spot.boss.z) < ICE_SHEET.chargeDistance - 1) blocked++;
      last = boss.state;
    }
    return { run, boss, stuns, charges, blocked, regrowAtStun, calvedAtStun };
  }

  it('is stunned when a charge crashes into a mountain range, and the crash calves both front corners', () => {
    const { boss, stuns, regrowAtStun, calvedAtStun } = chargeAt('ice-mountain', (run) => {
      const m = mountain(run.house);
      const z = (m.rect.minZ + m.rect.maxZ) / 2;
      // East of the massif, with the Ice Sheet coming from further east.
      return { bunny: { x: m.rect.maxX + 2.2, z }, boss: { x: m.rect.maxX + 20, z } };
    });
    expect(stuns).toBe(1);
    expect(boss.state).toBe('stunned');
    expect(regrowAtStun.every((t) => t > 0)).toBe(true);
    expect(calvedAtStun).toBeGreaterThanOrEqual(2);
  });

  it('is not stunned when a charge ends against the coast (or anything that is not a mountain range)', () => {
    const { stuns, charges, blocked } = chargeAt('ice-coast', (run) => {
      const z = run.house.spawn.z;
      const x = run.house.bounds.maxX - 2 - 2.5;
      return { bunny: { x, z }, boss: { x: x - 20, z } };
    });
    expect(charges).toBeGreaterThan(0);
    expect(blocked).toBeGreaterThan(0);
    expect(stuns).toBe(0);
  });

  it('calves absorbable icebergs while it hunts, and its hits knock icebergs loose', () => {
    const { run, events, boss, b } = hunting('ice-calve', 14);
    expect(getDebrisType(CALVED_ICEBERG_ID)?.area).toBe('continent');
    const before = icebergs(run).length;
    // Calving happens while it hunts (not while it telegraphs or charges).
    for (let i = 0; i < 60 * ICE_SHEET.summonInterval * 3 && boss.calved === 0; i++) {
      run.hazards.update(1 / 60, run);
      b.teleport(boss.x + 14, boss.z);
    }
    expect(boss.calved).toBe(1);
    const bergs = icebergs(run);
    expect(bergs.length).toBe(before + 1);
    const berg = bergs.at(-1)!;
    expect(berg.size).toBeLessThanOrEqual(b.radius * ratio);
    // Clear of the slab: eating it doesn't mean touching the boss.
    expect(Math.hypot(berg.x - boss.x, berg.z - boss.z)).toBeGreaterThan(ICE_SHEET.contactRadius * boss.scale + berg.size);
    expect(boss.regrow.some((t) => t > 0)).toBe(true);

    // The Bunny eats it.
    const r0 = b.radius;
    const absorbed = run.debrisAbsorbed;
    // From the far side of the berg, clear of the slab.
    const ux = (berg.x - boss.x) / Math.hypot(berg.x - boss.x, berg.z - boss.z);
    const uz = (berg.z - boss.z) / Math.hypot(berg.x - boss.x, berg.z - boss.z);
    b.teleport(berg.x + ux * (b.radius + berg.size * 0.8), berg.z + uz * (b.radius + berg.size * 0.8));
    run.update(1 / 60);
    expect(berg.alive).toBe(false);
    expect(run.debrisAbsorbed).toBeGreaterThan(absorbed);
    expect(b.radius).toBeGreaterThan(r0);

    // Ramming it while stunned lands a hit, and the pieces are icebergs.
    b.teleport(boss.x + 20, boss.z);
    boss.abilityStun(run, 2, 'amass');
    const hits: string[] = [];
    events.on('bossHit', (e) => hits.push(`${e.hits}/${e.maxHits}`));
    const n0 = icebergs(run).length;
    boss.onContact(run);
    expect(hits).toEqual(['1/3']);
    // A hit no longer shrinks it.
    expect(boss.size).toBe(ICE_SHEET.size);
    expect(icebergs(run).length).toBeGreaterThan(n0 + 3);
  });

  it('absorbing the Ice Sheet opens the launch corridor to the Globe (bossDefeated → exitOpened)', () => {
    const { run, events } = makeRun('ice-win');
    const p = moveToOpen(run, 20);
    const b = run.bunny;
    const order: string[] = [];
    events.on('bossDefeated', (e) => order.push(`bossDefeated:${e.defId}`));
    events.on('exitOpened', (e) => order.push(`exitOpened:${e.area}`));
    events.on('victory', () => order.push('victory'));
    events.on('runEnded', (e) => order.push(`runEnded:${e.reason}`));
    b.setRadius(absorbRadiusFor(ICE_SHEET.size, b.stats.get('absorbRatio')) + 0.05);
    const boss = run.hazards.spawn('ice_sheet', p.x + b.radius + 20, p.z) as IceSheet;
    boss.x = b.x + b.radius;
    boss.z = b.z;
    run.update(1 / 60);
    expect(order).toEqual(['bossDefeated:ice_sheet', 'exitOpened:continent']);
    expect(run.ended).toBe(false);
    expect(run.isAreaCleared('continent')).toBe(true);
    expect(run.house.exit?.open).toBe(true);
    expect(run.canLeaveArea).toBe(true);
  });
});
