import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/events';
import { AREAS } from '../data/areas';
import {
  AREA_BOSSES,
  AREA_DIRECTORS,
  COMET,
  DIRECTOR,
  DIRECTOR_EXCLUDE,
  GLOBE_DIRECTOR,
  ROGUE_ASTEROID,
  SOLAR_DIRECTOR,
  SOLAR_FLARE,
  SUNGRAZER,
  SUNSPOT,
  THE_SUN,
  tierValue,
} from '../data/hazards';
import { HOT_JUPITER_ID, PROMINENCE_ID } from '../data/sunDebris';
import { getTier } from '../data/tiers';
import type { Debris } from '../entities/debris';
import { installGameplay } from '../game/assembly';
import { Run } from '../game/run';
import { debrisLocked } from '../systems/absorb';
import { sunCentre } from '../world/solarSystem';
import type { AreaId } from '../world/types';
import { absorbRadiusFor } from './common';
import { spawnWeights } from './director';
import { hazardRegistry, type Hazard } from './index';
import { ringPath, type LintRoller } from './lintRoller';
import type { Mop } from './mop';
import { bossSizeAfterHits, type BossState } from './robovac';
import type { SprayBottle } from './sprayBottle';
import { TheSun, isBlockingGiant } from './theSun';
import type { UprightVacuum } from './uprightVacuum';

const SOLAR_HAZARDS = ['rogue_asteroid', 'comet', 'sunspot', 'sungrazer', 'solar_flare'];
const TUNINGS = { rogue_asteroid: ROGUE_ASTEROID, comet: COMET, sunspot: SUNSPOT, sungrazer: SUNGRAZER, solar_flare: SOLAR_FLARE } as const;
const ratio = 0.7;
const GIANTS = THE_SUN.giants.typeIds;

/** A Run in the Solar System (360 × 360 units of 0.01 AU, the Sun at the centre); the Bunny arrives at 0.85 units. */
const makeRun = (seed = 'solar-hazards') => {
  const events = new EventBus();
  const run = new Run(events, { seed, characterId: 'lint', area: 'solar_system' });
  return { events, run };
};

/** Bunny radius (Solar System units) at the start of a Tier. */
const tierRadius = (run: Run, tier: number) => getTier(tier).minRadius / run.unit;

/** The spawn: Earth's old orbit, open space (the Solar System has no obstacles). */
function moveToOpen(run: Run): { x: number; z: number } {
  const p = { x: run.house.spawn.x, z: run.house.spawn.z };
  run.bunny.teleport(p.x, p.z);
  return p;
}

function firstTableTier(id: string, area: AreaId): number {
  const { firstTier, tiers } = AREA_DIRECTORS[area];
  const i = tiers.findIndex((t) => id in t.types);
  if (i < 0) throw new Error(`${id} is not in the ${area} spawn tables`);
  return firstTier + i;
}

function typeIndex(run: Run, id: string): number {
  const i = run.debris.types.findIndex((t) => t.id === id);
  if (i < 0) throw new Error(`no ${id} Debris type`);
  return i;
}

function ofType(run: Run, ids: readonly string[]): Debris[] {
  const out: Debris[] = [];
  run.debris.forEach((d) => d.alive && ids.includes(d.type.id) && out.push(d));
  return out;
}

/** Removes every giant planet (the placed Jupiter, any Saturn), so a test controls what the Sun meets. */
function clearGiants(run: Run): void {
  for (const d of ofType(run, GIANTS)) run.debris.remove(d);
}

describe('solar system Hazards', () => {
  it('run in Solar System units (1 = 0.01 AU) with their own models', () => {
    const { run } = makeRun();
    expect(run.unit).toBe(1.496e11);
    expect(run.bunny.radius).toBeCloseTo(AREAS.solar_system.arrivalRadius!);
    for (const [id, cfg] of Object.entries(TUNINGS)) {
      expect(cfg.modelId, id).toBe(id);
      expect(hazardRegistry.require(id).modelId, id).toBe(id);
    }
    expect(hazardRegistry.require('the_sun').modelId).toBe('the_sun');
  });

  it('are a threat on arrival and absorbable before the Sun is; Tier 16 ones are food by early Tier 17', () => {
    const tier17 = tierRadius(makeRun().run, 17);
    const boss = absorbRadiusFor(THE_SUN.size, ratio);
    for (const id of SOLAR_HAZARDS) {
      const { run } = makeRun(`absorb-${id}`);
      const p = moveToOpen(run);
      const h = run.hazards.spawn(id, p.x + 8, p.z);
      expect(h.dead, id).toBeFalsy();
      const need = absorbRadiusFor(h.size, ratio);
      expect(need, id).toBeGreaterThan(AREAS.solar_system.arrivalRadius!);
      const first = firstTableTier(id, 'solar_system');
      expect(need, id).toBeGreaterThan(tierRadius(run, first));
      expect(need, id).toBeLessThan(boss);
      if (first === 16) expect(need, id).toBeLessThan(tier17 * 1.1);
    }
  });

  it('keeps the Sun out of reach at Tier 17 entry, but reachable after two chips', () => {
    const tier17 = tierRadius(makeRun().run, 17);
    const { size, chipFactor } = THE_SUN;
    expect(absorbRadiusFor(size, ratio)).toBeCloseTo(4, 1);
    expect(absorbRadiusFor(bossSizeAfterHits(1, size, chipFactor), ratio)).toBeGreaterThan(tier17);
    expect(absorbRadiusFor(bossSizeAfterHits(2, size, chipFactor), ratio)).toBeLessThan(tier17);
    expect(hazardRegistry.require('the_sun').boss).toBe(true);
    expect(THE_SUN.miniId).toBeUndefined();
    expect(AREA_BOSSES.solar_system).toEqual({ id: 'the_sun', tier: 17, arrivalDelay: 4 });
  });

  it('solar system spawn tables list only solar system Hazards, Solar Flares from Tier 17, never the Sun', () => {
    for (let t = SOLAR_DIRECTOR.firstTier; t <= 17; t++) {
      const ids = Object.keys(spawnWeights(t, {}, 'solar_system'));
      expect(ids.length).toBeGreaterThan(0);
      for (const id of ids) expect(SOLAR_HAZARDS).toContain(id);
    }
    expect(Object.keys(spawnWeights(15, {}, 'solar_system'))).toEqual(Object.keys(spawnWeights(16, {}, 'solar_system')));
    expect(Object.keys(spawnWeights(16, {}, 'solar_system'))).not.toContain('solar_flare');
    expect(Object.keys(spawnWeights(17, {}, 'solar_system'))).toContain('solar_flare');
    expect(DIRECTOR_EXCLUDE).toContain('the_sun');
    for (const t of [...DIRECTOR.tiers, ...GLOBE_DIRECTOR.tiers]) for (const id of SOLAR_HAZARDS) expect(Object.keys(t.types)).not.toContain(id);
    expect(tierValue(ROGUE_ASTEROID.speed, 16)).toBe(ROGUE_ASTEROID.speed[15]);
    expect(tierValue(ROGUE_ASTEROID.speed, 17)).toBe(ROGUE_ASTEROID.speed[16]);
  });

  it('the director spawns solar system Hazards and brings the Sun at Tier 17', () => {
    const { run, events } = makeRun('solar-director');
    installGameplay(run);
    const spawned: string[] = [];
    const bosses: string[] = [];
    events.on('hazardSpawned', (e) => spawned.push(e.defId));
    events.on('bossSpawned', (e) => bosses.push(e.name));
    run.bunny.health = 999;
    for (let i = 0; i < 60 * 30 && !run.ended; i++) run.update(1 / 60);
    run.bunny.setRadius(tierRadius(run, 16) * 2.6);
    for (let i = 0; i < 60 * 60 && !run.ended; i++) run.update(1 / 60);
    expect(spawned.length).toBeGreaterThan(2);
    expect(bosses).toEqual([]);
    run.bunny.setRadius(tierRadius(run, 17) * 1.02);
    for (let i = 0; i < 60 * (AREA_BOSSES.solar_system.arrivalDelay + 1) && !run.ended; i++) run.update(1 / 60);
    expect(run.tier).toBe(17);
    expect(bosses).toEqual(['The Sun']);
    expect(run.hazards.count('the_sun')).toBe(1);
    for (const id of spawned) expect([...SOLAR_HAZARDS, 'the_sun']).toContain(id);
  });

  it("the Rogue Asteroid's gravity pulls the Bunny in, and its rock tumbles", () => {
    const { run } = makeRun('asteroid');
    moveToOpen(run);
    const b = run.bunny;
    const h = run.hazards.spawn('rogue_asteroid', b.x + b.radius + 1.4, b.z) as unknown as Hazard & { yaw: number; model: { getObjectByName(n: string): { rotation: { y: number } } | undefined } };
    h.yaw = Math.PI / 2; // drifting away (+X)
    const rock = h.model.getObjectByName('rock')!;
    const spin0 = rock.rotation.y;
    const x0 = b.x;
    for (let i = 0; i < 10; i++) run.hazards.update(1 / 60, run);
    expect(b.x).toBeGreaterThan(x0 + 0.03);
    expect(rock.rotation.y).not.toBe(spin0);
  });

  it('a Comet rides the nearest orbit ring one way round (no ends, tail fluttering); a hit sheds mass without sticking', () => {
    const { run, events } = makeRun('comet');
    const p = moveToOpen(run);
    const b = run.bunny;
    const sun = sunCentre(run.house);
    const ringR = Math.hypot(p.x - sun.x, p.z - sun.z);
    // 4 units outside Earth's old orbit: it joins that ring (the Bunny out of its way).
    b.teleport(sun.x, sun.z - 120);
    const h = run.hazards.spawn('comet', p.x, p.z + 4) as LintRoller;
    expect(h.dead).toBeFalsy();
    expect(h.ring).not.toBeNull();
    expect(Math.hypot(h.x - sun.x, h.z - sun.z)).toBeCloseTo(ringR, 0);
    const tail = h.model.getObjectByName('tail')!;
    let angle = 0;
    let last = Math.atan2(h.z - sun.z, h.x - sun.x);
    let reversed = false;
    let sign = 0;
    let fluttered = false;
    for (let i = 0; i < 60 * 30; i++) {
      run.hazards.update(1 / 60, run);
      b.teleport(sun.x, sun.z - 120); // out of the way
      expect(Math.abs(Math.hypot(h.x - sun.x, h.z - sun.z) - ringR)).toBeLessThan(0.2);
      const a = Math.atan2(h.z - sun.z, h.x - sun.x);
      let da = a - last;
      if (da > Math.PI) da -= Math.PI * 2;
      if (da < -Math.PI) da += Math.PI * 2;
      if (sign === 0 && Math.abs(da) > 1e-6) sign = Math.sign(da);
      if (sign !== 0 && da * sign < -1e-9) reversed = true;
      angle += Math.abs(da);
      last = a;
      fluttered ||= tail.scale.z !== 1;
    }
    expect(reversed).toBe(false);
    // 30 s at ≈ 3.2–3.7 units/s on a 50-unit ring: about 2 rad, never pausing at an end.
    expect(angle * ringR).toBeGreaterThan(tierValue(COMET.speed, run.tier) * 30 * 0.95);
    expect(fluttered).toBe(true);

    expect(b.health).toBe(b.maxHealth);
    b.teleport(h.x, h.z);
    b.invulnerable = 0;
    let shed = 0;
    events.on('bunnyShed', (e) => e.source === 'comet' && shed++);
    const r0 = b.radius;
    h.onContact!(run);
    expect(b.health).toBe(b.maxHealth - 1);
    expect(shed).toBe(1);
    expect(b.radius).toBeLessThan(r0);
    expect(b.rooted).toBe(0);
  });

  it('ring paths: only closed orbit routes within reach, measured along the ring', () => {
    const { run } = makeRun('ring-path');
    const sun = sunCentre(run.house);
    // Halfway between the 66 and 118 rings: nothing within 20.
    expect(ringPath(run.house, sun.x + 92, sun.z, 20)).toBeNull();
    const r = ringPath(run.house, sun.x + 68, sun.z, 20)!;
    expect(r.path.length).toBeCloseTo(2 * Math.PI * 66, -1);
    expect(r.s).toBeLessThan(1);
    // The Globe's east–west lanes are open routes: no ring.
    const globe = new Run(new EventBus(), { seed: 'g', characterId: 'lint', area: 'globe' });
    const z = globe.house.routes!.find((x) => x.kind === 'orbit')!.points[0]!.z;
    expect(ringPath(globe.house, 200, z, 20)).toBeNull();
  });

  it('the Sunspot stays put, sweeps and aims only its head, and its flare bolts hit without slowing', () => {
    const { run } = makeRun('sunspot');
    const p = moveToOpen(run);
    const b = run.bunny;
    const speed0 = b.stats.get('speed');
    const h = run.hazards.spawn('sunspot', p.x, p.z - 6) as SprayBottle;
    run.hazards.update(1 / 60, run);
    const yaw0 = h.body.rotation.y;
    const head = h.model.getObjectByName('head')!;
    const aim0 = head.rotation.y;
    let hit = false;
    for (let i = 0; i < 60 * 8 && !hit; i++) {
      run.hazards.update(1 / 60, run);
      hit = b.health < b.maxHealth;
      expect(h.x).toBe(p.x);
    }
    expect(hit).toBe(true);
    expect(h.body.rotation.y).toBe(yaw0);
    expect(head.rotation.y).not.toBe(aim0);
    expect(b.stats.get('speed')).toBe(speed0);
    expect(hazardRegistry.require('sunspot').spawnZones).not.toContain('kuiper_belt');
  });

  it("the Sungrazer's icy tail trail slows the Bunny", () => {
    const { run } = makeRun('sungrazer');
    const p = moveToOpen(run);
    const b = run.bunny;
    b.setRadius(1.5);
    const speed0 = b.stats.get('speed');
    const h = run.hazards.spawn('sungrazer', p.x + 10, p.z) as Mop;
    for (let i = 0; i < 60 * 4; i++) run.hazards.update(1 / 60, run);
    expect(h.puddles.length).toBeGreaterThan(3);
    const far = h.puddles.reduce((f, q) => (Math.hypot(q.x - h.x, q.z - h.z) > Math.hypot(f.x - h.x, f.z - h.z) ? q : f));
    b.teleport(far.x, far.z);
    run.hazards.update(1 / 60, run);
    expect(b.stats.get('speed')).toBeCloseTo(speed0 * SUNGRAZER.slowMultiplier, 5);
  });

  it("the Solar Flare's blast pushes the Bunny away without soaking it, its loop swelling and spinning", () => {
    const { run } = makeRun('solar-flare');
    const p = moveToOpen(run);
    const b = run.bunny;
    const speed0 = b.stats.get('speed');
    const h = run.hazards.spawn('solar_flare', p.x + 6, p.z) as UprightVacuum;
    h.yaw = -Math.PI / 2;
    h.state = 'on';
    const loop = h.model.getObjectByName('loop')!;
    const spin0 = loop.rotation.y;
    const d0 = Math.hypot(b.x - h.x, b.z - h.z);
    for (let i = 0; i < 20; i++) run.hazards.update(1 / 60, run);
    expect(Math.hypot(b.x - h.x, b.z - h.z)).toBeGreaterThan(d0 + 0.3);
    expect(b.stats.get('speed')).toBe(speed0);
    expect(loop.rotation.y).not.toBe(spin0);
    expect(loop.scale.x).toBeGreaterThan(1.1);
  });
});

describe('the Sun', () => {
  /** A Sun in its hunt, `d` units west of a Tier 17 Bunny (facing it, +X), no giant planets about. */
  function hunting(seed: string, d: number, opts: { keepGiants?: boolean; radius?: number } = {}) {
    const { run, events } = makeRun(seed);
    const p = moveToOpen(run);
    const b = run.bunny;
    b.health = 999;
    b.setRadius(opts.radius ?? 3.2);
    if (!opts.keepGiants) clearGiants(run);
    const boss = run.hazards.spawn('the_sun', p.x - d, p.z) as TheSun;
    boss.yaw = Math.PI / 2;
    boss.state = 'hunt';
    return { run, events, boss, b, p };
  }

  /** No Hot Jupiter swings round on its own, no charge and no volley (the test drives them). */
  const quiet = (boss: TheSun) => {
    const s = boss as unknown as { giantPlaced: boolean; giantTimer: number; timer: number; ashTimer: number };
    s.giantPlaced = true;
    s.giantTimer = 1e9;
    s.timer = 1e9;
    s.ashTimer = 1e9;
  };

  it('its solar wind pushes the Bunny away while it hunts, but not a hunkered Bunny, nor one that can absorb it', () => {
    const { run, boss, b, p } = hunting('wind', 6);
    quiet(boss);
    const away = () => Math.hypot(b.x - boss.x, b.z - boss.z);
    const d0 = away();
    for (let i = 0; i < 10; i++) run.hazards.update(1 / 60, run);
    expect(away()).toBeGreaterThan(d0 + 0.05);
    // Beyond the wind's reach: nothing.
    b.teleport(boss.x + THE_SUN.contactRadius + b.radius + THE_SUN.wind.reach + 1, p.z);
    let x = b.x;
    run.hazards.update(1 / 60, run);
    expect(b.x).toBeCloseTo(x, 6);
    // Hunkered: planted.
    b.teleport(p.x, p.z);
    b.hunkered = true;
    x = b.x;
    for (let i = 0; i < 10; i++) run.hazards.update(1 / 60, run);
    expect(b.x).toBeCloseTo(x, 6);
    b.hunkered = false;
    // Big enough to absorb it: no wind.
    b.setRadius(absorbRadiusFor(boss.size, ratio) + 0.05);
    b.teleport(boss.x + THE_SUN.contactRadius + b.radius + 1, p.z);
    x = b.x;
    for (let i = 0; i < 10; i++) run.hazards.update(1 / 60, run);
    expect(b.x).toBeCloseTo(x, 6);
  });

  it('blows small loose Debris outward', () => {
    const { run, boss, p } = hunting('wind-debris', 20);
    quiet(boss);
    const i = run.debris.types.findIndex((t) => t.area === 'solar_system' && t.size <= THE_SUN.wind.debrisSize && Object.keys(t.rooms).length > 0);
    const d = run.debris.spawn(i, boss.x + THE_SUN.contactRadius + 1.5, p.z, run.rng)!;
    const x0 = d.x;
    for (let k = 0; k < 20; k++) run.hazards.update(1 / 60, run);
    expect(d.x).toBeGreaterThan(x0 + 0.1);
  });

  /** Holds the Bunny still until a charge ends; returns what happened. */
  function chargeAt(seed: string, opts: { radius: number; giant?: { type: string; dx: number; size: number }; bunnyZ?: (run: Run) => number; bossDz?: number }) {
    const { run, events } = makeRun(seed);
    const b = run.bunny;
    b.health = 999;
    b.setRadius(opts.radius);
    clearGiants(run);
    const spot = { x: run.house.spawn.x, z: opts.bunnyZ ? opts.bunnyZ(run) : run.house.spawn.z };
    b.teleport(spot.x, spot.z);
    const giant = opts.giant ? run.debris.spawn(typeIndex(run, opts.giant.type), spot.x + opts.giant.dx, spot.z, run.rng, { size: opts.giant.size }) : null;
    const boss = run.hazards.spawn('the_sun', spot.x + (opts.bossDz === undefined ? -18 : 0), spot.z + (opts.bossDz ?? 0)) as TheSun;
    quiet(boss);
    boss.state = 'hunt';
    (boss as unknown as { timer: number }).timer = 0.05;
    let stuns = 0;
    let charges = 0;
    let ended = 0;
    const state = (): BossState => boss.state;
    let last = state();
    events.on('bossStunned', (e) => e.cause === 'wall' && stuns++);
    for (let i = 0; i < 60 * 12 && stuns === 0 && ended === 0; i++) {
      run.hazards.update(1 / 60, run);
      b.teleport(spot.x, spot.z);
      const now = state();
      if (last !== 'charge' && now === 'charge') charges++;
      if (last === 'charge' && now === 'recover') ended++;
      last = now;
    }
    return { run, boss, giant, stuns, charges, ended };
  }

  it('is stunned when a CME runs into Jupiter while the Bunny cannot absorb it, and stops against it (an eclipse)', () => {
    const { run, boss, giant, stuns } = chargeAt('jupiter-stun', { radius: 3.2, giant: { type: 'jupiter', dx: -7, size: 2.4 } });
    expect(isBlockingGiant(run, giant!)).toBe(true);
    expect(stuns).toBe(1);
    expect(boss.state).toBe('stunned');
    expect(boss.eclipses).toBe(1);
    expect(Math.hypot(boss.x - giant!.x, boss.z - giant!.z)).toBeGreaterThan(THE_SUN.contactRadius + giant!.size * 0.85);
    expect(giant!.alive).toBe(true);
    // The glow dims in the eclipse.
    for (let i = 0; i < 30; i++) run.hazards.update(1 / 60, run);
    expect(boss.glow).toBeLessThan(0.4);
  });

  it('a Jupiter still locked until Tier 17 blocks it even when small enough to absorb; unlocked and absorbable it does not', () => {
    // Tier 16 (r 2.9): a 1.5-unit Jupiter is small enough, but locked.
    const locked = chargeAt('jupiter-locked', { radius: 2.9, giant: { type: 'jupiter', dx: -7, size: 1.5 } });
    expect(debrisLocked(locked.run.bunny, locked.giant!)).toBe(true);
    expect(locked.stuns).toBe(1);
    // Tier 17 (r 3.2): the same Jupiter is food, and the CME runs through.
    const open = chargeAt('jupiter-open', { radius: 3.2, giant: { type: 'jupiter', dx: -7, size: 1.5 } });
    expect(isBlockingGiant(open.run, open.giant!)).toBe(false);
    expect(open.charges).toBe(1);
    expect(open.stuns).toBe(0);
  });

  it('another giant planet the Bunny cannot absorb stuns it too; the map edge ends a CME without a stun', () => {
    const saturn = chargeAt('saturn', { radius: 3.2, giant: { type: 'saturn', dx: -7, size: 2.8 } });
    expect(saturn.stuns).toBe(1);
    const edge = chargeAt('edge', { radius: 3.2, bunnyZ: (r) => r.house.bounds.maxZ - 3.5, bossDz: -16 });
    expect(edge.charges).toBe(1);
    expect(edge.ended).toBe(1);
    expect(edge.stuns).toBe(0);
  });

  it('swings a Hot Jupiter round near the fight when no blocking giant is near (between them), and another once it is outgrown', () => {
    const { run, boss, b } = hunting('hot-jupiter', 16);
    expect(ofType(run, [HOT_JUPITER_ID]).length).toBe(0);
    run.hazards.update(1 / 60, run);
    expect(boss.giants).toBe(1);
    const m = ofType(run, [HOT_JUPITER_ID])[0]!;
    expect(isBlockingGiant(run, m)).toBe(true);
    expect(m.size).toBeGreaterThanOrEqual(b.radius * ratio * THE_SUN.giants.margin - 1e-9);
    expect(m.x).toBeLessThan(b.x - b.radius);
    expect(m.x).toBeGreaterThan(boss.x);
    expect(boss.keepGiant(run)).toBe(false);
    b.setRadius(m.size / ratio + 0.1);
    expect(isBlockingGiant(run, m)).toBe(false);
    expect(boss.keepGiant(run)).toBe(true);
    expect(ofType(run, [HOT_JUPITER_ID]).find((d) => d !== m)!.size).toBeGreaterThan(m.size);
  });

  it('brings no Hot Jupiter while a blocking Jupiter is near the Bunny', () => {
    const { run, boss, b } = hunting('jupiter-near', 16);
    run.debris.spawn(typeIndex(run, 'jupiter'), b.x + 10, b.z, run.rng, { size: 2.4 });
    expect(boss.keepGiant(run, true)).toBe(false);
    expect(ofType(run, [HOT_JUPITER_ID]).length).toBe(0);
  });

  it('ramming it in an eclipse chips it: prominences scatter and one prominence arc hides', () => {
    const { run, events, boss, b } = hunting('prominences', 12);
    quiet(boss);
    boss.abilityStun(run, 3, 'decoy');
    const hits: number[] = [];
    events.on('bossHit', (e) => hits.push(e.size));
    const before = ofType(run, [PROMINENCE_ID]).length;
    b.teleport(boss.x + THE_SUN.contactRadius + b.radius * 0.9, boss.z);
    boss.onContact(run);
    expect(hits).toEqual([bossSizeAfterHits(1, THE_SUN.size, THE_SUN.chipFactor)]);
    const pieces = ofType(run, [PROMINENCE_ID]).length - before;
    expect(pieces).toBeGreaterThan(THE_SUN.chipPieces / 2);
    expect(boss.model.getObjectByName('prominence_l')!.visible).toBe(false);
    expect(boss.model.getObjectByName('prominence_r')!.visible).toBe(true);
    expect(boss.regrow[0]).toBeCloseTo(THE_SUN.prominenceRegrow);
  });

  it('its flare volley locks an orange lane on the Bunny, then the bolts hit and shed mass', () => {
    const { run, events, boss, b } = hunting('flares', 14);
    const s = boss as unknown as { giantPlaced: boolean; giantTimer: number; timer: number };
    s.giantPlaced = true;
    s.giantTimer = 1e9;
    s.timer = 1e9;
    let shed = 0;
    events.on('bunnyShed', (e) => e.source === 'the_sun' && shed++);
    const hp = b.health;
    for (let i = 0; i < 60 * 12 && b.health === hp; i++) {
      run.hazards.update(1 / 60, run);
      b.teleport(boss.x + 14, boss.z);
      b.invulnerable = 0;
    }
    expect(b.health).toBeLessThan(hp);
    expect(shed).toBeGreaterThan(0);
  });

  it('absorbing the Sun clears the Solar System and wins the Run (bossDefeated → victory → runEnded)', () => {
    const { run, events } = makeRun('sun-win');
    const p = moveToOpen(run);
    const b = run.bunny;
    const order: string[] = [];
    events.on('bossDefeated', (e) => order.push(`bossDefeated:${e.defId}`));
    events.on('victory', () => order.push('victory'));
    events.on('runEnded', (e) => order.push(`runEnded:${e.reason}`));
    b.setRadius(absorbRadiusFor(THE_SUN.size, b.stats.get('absorbRatio')) + 0.05);
    const boss = run.hazards.spawn('the_sun', p.x + b.radius + 20, p.z) as TheSun;
    boss.x = b.x + b.radius;
    boss.z = b.z;
    run.update(1 / 60);
    expect(order).toEqual(['bossDefeated:the_sun', 'victory', 'runEnded:victory']);
    expect(run.ended).toBe(true);
    expect(run.endReason).toBe('victory');
  });
});
