import { describe, expect, it } from 'vitest';
import { getAbilitySystem, type DecoyAbility, type DischargeAbility } from '../abilities';
import { EventBus } from '../core/events';
import type { InputState } from '../core/input';
import { AREAS } from '../data/areas';
import {
  AREA_BOSSES,
  COLLIDING_GALAXY,
  COSMIC_VOID,
  DARK_ENERGY_GUST,
  DIRECTOR_EXCLUDE,
  GALAXY_DIRECTOR,
  GAMMA_RAY_BURST,
  QUASAR,
  THE_EXPANSION,
  tierValue,
  UNIVERSE_DIRECTOR,
} from '../data/hazards';
import { peakRarityForBoss } from '../data/keepsakes';
import { getTier } from '../data/tiers';
import type { Debris } from '../entities/debris';
import { createRun, installGameplay } from '../game/assembly';
import { Run } from '../game/run';
import { viewRadiusFor } from '../systems/camera';
import { maxSpeedFor } from '../systems/movement';
import { createModel } from '../world/models';
import { absorbRadiusFor } from './common';
import { spawnWeights } from './director';
import { inBurst, type GammaRayBurst } from './gammaRayBurst';
import { HazardManager, hazardRegistry } from './index';
import type { LintRoller } from './lintRoller';
import { HAZARD_MODEL_SIZES } from './models';
import type { Mop } from './mop';
import type { Roomba } from './roomba';
import { expansionRates, hubbleSpeed, tugGain, type TheExpansion } from './theExpansion';
import type { UprightVacuum } from './uprightVacuum';

const UNIVERSE_HAZARDS = ['quasar', 'colliding_galaxy', 'gamma_ray_burst', 'cosmic_void', 'dark_energy_gust'];
const ratio = 0.7;
const STEP = 1 / 60;

/** A Run in the Universe (360 × 360 units of 10 Mly, no obstacles); the Bunny arrives at 0.85 units. */
const makeRun = (seed = 'universe-hazards') => {
  const events = new EventBus();
  const run = new Run(events, { seed, characterId: 'lint', area: 'universe' });
  return { events, run };
};

/** Bunny radius (Universe units) at the start of a Tier. */
const tierRadius = (run: Run, tier: number) => getTier(tier).minRadius / run.unit;

/** The spawn (on a filament near the middle); nothing loose within `clear` units. */
function moveToOpen(run: Run, clear = 0): { x: number; z: number } {
  const p = { x: run.house.spawn.x, z: run.house.spawn.z };
  run.bunny.teleport(p.x, p.z);
  if (clear > 0) for (const d of run.debris.query(p.x, p.z, clear)) run.debris.remove(d);
  return p;
}

function firstTableTier(id: string): number {
  const i = UNIVERSE_DIRECTOR.tiers.findIndex((t) => id in t.types);
  if (i < 0) throw new Error(`${id} is not in the universe spawn tables`);
  return UNIVERSE_DIRECTOR.firstTier + i;
}

/** A universe Debris type a test can spawn (has room weights). */
function universeType(run: Run, maxSize = Infinity): number {
  const i = run.debris.types.findIndex((t) => t.area === 'universe' && t.size <= maxSize && Object.keys(t.rooms).length > 0);
  if (i < 0) throw new Error('no universe Debris type');
  return i;
}

/** Distance from (x, z) to the segment a–b. */
function segmentDistance(x: number, z: number, a: { x: number; z: number }, b: { x: number; z: number }): number {
  const ex = b.x - a.x;
  const ez = b.z - a.z;
  const f = Math.min(1, Math.max(0, ((x - a.x) * ex + (z - a.z) * ez) / (ex * ex + ez * ez)));
  return Math.hypot(a.x + ex * f - x, a.z + ez * f - z);
}

describe('universe Hazards', () => {
  it('run in Universe units (1 = 10 Mly) with their own models, whose fallbacks carry the GLB node names', () => {
    const { run } = makeRun();
    expect(run.unit).toBe(AREAS.universe.unit);
    expect(run.bunny.radius).toBeCloseTo(AREAS.universe.arrivalRadius!);
    for (const id of [...UNIVERSE_HAZARDS, 'the_expansion']) expect(hazardRegistry.require(id).modelId, id).toBe(id);
    const nodes: Record<string, string[]> = {
      quasar: ['disk', 'jets'],
      colliding_galaxy: ['galaxy_a', 'galaxy_b'],
      gamma_ray_burst: ['head'],
      cosmic_void: ['shell'],
      dark_energy_gust: ['core'],
      the_expansion: ['grid', 'ring'],
    };
    for (const [id, names] of Object.entries(nodes)) {
      const m = createModel(id, { ...HAZARD_MODEL_SIZES[id as keyof typeof HAZARD_MODEL_SIZES] });
      for (const n of names) expect(m.getObjectByName(n), `${id} ${n}`).toBeTruthy();
    }
    expect(HAZARD_MODEL_SIZES.the_expansion).toEqual({ w: 6.99, d: 7.24, h: 0.68 });
  });

  it('are a threat on arrival and in their first Tier; the Tier 20 ones are food by early Tier 21', () => {
    const { run } = makeRun();
    const tier21 = tierRadius(run, 21);
    for (const id of UNIVERSE_HAZARDS) {
      const h = run.hazards.spawn(id, run.bunny.x + 20, run.bunny.z);
      const need = absorbRadiusFor(h.size, ratio);
      expect(need, id).toBeGreaterThan(AREAS.universe.arrivalRadius!);
      const first = firstTableTier(id);
      expect(need, id).toBeGreaterThan(tierRadius(run, first));
      if (first === 20) expect(need, id).toBeLessThan(tier21 * 1.1);
      h.dead = true;
    }
  });

  it('universe spawn tables list only universe Hazards, the Dark-energy gust from Tier 21, never the Expansion', () => {
    for (let t = UNIVERSE_DIRECTOR.firstTier; t <= 21; t++) {
      const ids = Object.keys(spawnWeights(t, {}, 'universe'));
      expect(ids.length).toBeGreaterThan(0);
      for (const id of ids) expect(UNIVERSE_HAZARDS).toContain(id);
    }
    expect(Object.keys(spawnWeights(20, {}, 'universe'))).not.toContain('dark_energy_gust');
    expect(Object.keys(spawnWeights(21, {}, 'universe'))).toContain('dark_energy_gust');
    expect(DIRECTOR_EXCLUDE).toContain('the_expansion');
    for (const t of GALAXY_DIRECTOR.tiers) for (const id of UNIVERSE_HAZARDS) expect(Object.keys(t.types)).not.toContain(id);
    expect(tierValue(GAMMA_RAY_BURST.range, 21)).toBe(GAMMA_RAY_BURST.range[20]);
    expect(AREA_BOSSES.universe).toEqual({ id: 'the_expansion', tier: 21, arrivalDelay: 4 });
    expect(peakRarityForBoss('the_expansion')).toBe(5);
  });

  it('the director spawns universe Hazards and brings the Expansion 4 s after Tier 21', () => {
    const { run, events } = makeRun('universe-director');
    installGameplay(run);
    const spawned: string[] = [];
    const bosses: string[] = [];
    events.on('hazardSpawned', (e) => spawned.push(e.defId));
    events.on('bossSpawned', (e) => bosses.push(e.name));
    run.bunny.health = 999;
    run.bunny.setRadius(tierRadius(run, 20) * 1.5);
    for (let i = 0; i < 60 * 50 && !run.ended; i++) run.update(STEP);
    expect(spawned.length).toBeGreaterThan(2);
    expect(bosses).toEqual([]);
    run.bunny.setRadius(tierRadius(run, 21) * 1.02);
    for (let i = 0; i < 60 * (AREA_BOSSES.universe.arrivalDelay + 1) && !run.ended; i++) run.update(STEP);
    expect(bosses).toEqual(['The Expansion']);
    expect(run.hazards.count('the_expansion')).toBe(1);
    for (const id of spawned) expect([...UNIVERSE_HAZARDS, 'the_expansion']).toContain(id);
  });

  it("the Quasar's pull drags the Bunny in and swirls loose Debris round without eating it; its disc spins and its jets pulse", () => {
    const { run } = makeRun('quasar');
    const p = moveToOpen(run, 30);
    const b = run.bunny;
    const h = run.hazards.spawn('quasar', p.x + b.radius + QUASAR.size + 2, p.z) as Roomba;
    h.yaw = Math.PI / 2;
    const disk = h.model.getObjectByName('disk')!;
    const jets = h.model.getObjectByName('jets')!;
    const spin0 = disk.rotation.y;
    const x0 = b.x;
    const jetScales = new Set<number>();
    for (let i = 0; i < 20; i++) {
      run.hazards.update(STEP, run);
      jetScales.add(Math.round(jets.scale.y * 1000));
    }
    expect(b.x).toBeGreaterThan(x0 + 0.03);
    expect(disk.rotation.y).not.toBe(spin0);
    expect(jetScales.size).toBeGreaterThan(3);
    expect(jets.scale.x).toBe(1);
    b.teleport(p.x - 60, p.z);
    const d = run.debris.spawn(universeType(run, QUASAR.debrisPull!.maxSize), h.x, h.z + h.size + 1, run.rng)!;
    const z0 = d.z;
    const dx0 = d.x;
    run.hazards.update(STEP, run);
    expect(d.z).toBeLessThan(z0);
    expect(Math.abs(d.x - dx0)).toBeGreaterThan(1e-4);
    for (let i = 0; i < 60 * 6; i++) run.hazards.update(STEP, run);
    expect(d.alive).toBe(true);
    expect(h.swallowed).toBe(0);
  });

  it('a Colliding Galaxy patrols along the filament nearest its spawn, its two galaxies turning opposite ways', () => {
    const { run } = makeRun('colliding');
    const routes = (run.house.routes ?? []).filter((r) => r.kind === 'filament');
    const route = routes.reduce((best, r) => {
      const len = (q: typeof r) => Math.hypot(q.points[1]!.x - q.points[0]!.x, q.points[1]!.z - q.points[0]!.z);
      return len(r) > len(best) ? r : best;
    });
    const [a, c] = [route.points[0]!, route.points[1]!];
    const len = Math.hypot(c.x - a.x, c.z - a.z);
    const mx = (a.x + c.x) / 2;
    const mz = (a.z + c.z) / 2;
    // 5 units off the filament, square to it.
    const sx = mx + (-(c.z - a.z) / len) * 5;
    const sz = mz + ((c.x - a.x) / len) * 5;
    run.bunny.teleport(sx + 150 > 360 ? sx - 150 : sx + 150, sz);
    const h = run.hazards.spawn('colliding_galaxy', sx, sz) as LintRoller;
    expect(h.dead).toBeFalsy();
    const ga = h.model.getObjectByName('galaxy_a')!;
    const gb = h.model.getObjectByName('galaxy_b')!;
    const seen: Array<{ x: number; z: number }> = [];
    for (let i = 0; i < 60 * 8; i++) {
      run.hazards.update(STEP, run);
      seen.push({ x: h.x, z: h.z });
    }
    for (const q of seen) expect(segmentDistance(q.x, q.z, a, c)).toBeLessThan(0.05);
    const travel = Math.max(...seen.map((q) => Math.hypot(q.x - seen[0]!.x, q.z - seen[0]!.z)));
    expect(travel).toBeGreaterThan(COLLIDING_GALAXY.laneMin * 0.5);
    expect(Math.sign(ga.rotation.y)).toBe(1);
    expect(Math.sign(gb.rotation.y)).toBe(-1);
  });

  it('burst geometry: one beam, from the muzzle out to its front', () => {
    expect(inBurst(0, 5, 0.5, 0, 2, 30, 0.9)).toBe(true);
    expect(inBurst(0, -5, 0.5, 0, 2, 30, 0.9)).toBe(false);
    expect(inBurst(0, 25, 0.5, 0, 2, 20, 0.9)).toBe(false);
    expect(inBurst(2, 10, 0.5, 0, 2, 30, 0.9)).toBe(false);
  });

  it('a Gamma-ray burst locks its lane, telegraphs, then a fast beam hits once; stepping off the lane dodges it', () => {
    const { run, events } = makeRun('burst');
    const p = moveToOpen(run);
    const b = run.bunny;
    b.setRadius(1.5);
    b.health = 999;
    const h = run.hazards.spawn('gamma_ray_burst', p.x, p.z - 14) as GammaRayBurst;
    const head = h.model.getObjectByName('head')!;
    const telegraphs: string[] = [];
    events.on('hazardTelegraph', (e) => e.defId === 'gamma_ray_burst' && telegraphs.push(e.attack));
    for (let i = 0; i < 60 * 8 && h.state !== 'telegraph'; i++) {
      run.hazards.update(STEP, run);
      b.teleport(p.x, p.z);
    }
    expect(h.state).toBe('telegraph');
    expect(telegraphs).toEqual(['burst']);
    // Locked: it no longer follows the Bunny through the telegraph.
    const locked = h.aimYaw;
    b.teleport(p.x + 4, p.z);
    run.hazards.update(STEP, run);
    expect(h.aimYaw).toBe(locked);
    expect(head.rotation.y).not.toBe(0);
    b.teleport(p.x, p.z);
    const hp = b.health;
    const r0 = b.radius;
    for (let i = 0; i < 60 * 3 && h.state !== 'cooldown'; i++) {
      run.hazards.update(STEP, run);
      b.teleport(p.x, p.z);
      b.invulnerable = 0;
    }
    expect(h.hits).toBe(1);
    expect(b.health).toBe(hp - GAMMA_RAY_BURST.damage);
    expect(b.radius).toBeLessThan(r0);
    // Next burst: step off the lane during the telegraph and it misses.
    for (let i = 0; i < 60 * 10 && h.state !== 'telegraph'; i++) {
      run.hazards.update(STEP, run);
      b.teleport(p.x, p.z);
    }
    expect(h.state).toBe('telegraph');
    b.teleport(p.x + 5, p.z);
    for (let i = 0; i < 60 * 3 && h.state !== 'cooldown'; i++) run.hazards.update(STEP, run);
    expect(h.hits).toBe(1);
  });

  it("the Cosmic Void's dark trail slows the Bunny, its shell breathing", () => {
    const { run } = makeRun('void');
    const p = moveToOpen(run);
    const b = run.bunny;
    b.setRadius(1.5);
    const speed0 = b.stats.get('speed');
    const h = run.hazards.spawn('cosmic_void', p.x + 12, p.z) as Mop;
    const shell = h.model.getObjectByName('shell')!;
    const scales = new Set<number>();
    for (let i = 0; i < 60 * 5; i++) {
      run.hazards.update(STEP, run);
      scales.add(Math.round(shell.scale.x * 1000));
    }
    expect(scales.size).toBeGreaterThan(3);
    expect(h.puddles.length).toBeGreaterThan(3);
    const far = h.puddles.reduce((f, q) => (Math.hypot(q.x - h.x, q.z - h.z) > Math.hypot(f.x - h.x, f.z - h.z) ? q : f));
    b.teleport(far.x, far.z);
    run.hazards.update(STEP, run);
    expect(b.stats.get('speed')).toBeCloseTo(speed0 * COSMIC_VOID.slowMultiplier, 5);
  });

  it("the Dark-energy gust's core swells through the warm-up, then the blast pushes the Bunny and loose Debris away", () => {
    const { run } = makeRun('gust');
    const p = moveToOpen(run, 30);
    const b = run.bunny;
    const h = run.hazards.spawn('dark_energy_gust', p.x + 9, p.z) as UprightVacuum;
    h.yaw = -Math.PI / 2;
    h.state = 'warmup';
    (h as unknown as { timer: number }).timer = DARK_ENERGY_GUST.warmup * run.difficulty.attackTiming * 0.3;
    const core = h.model.getObjectByName('core')!;
    run.hazards.update(STEP, run);
    expect(core.scale.x).toBeGreaterThan(1.15);
    h.state = 'on';
    (h as unknown as { timer: number }).timer = DARK_ENERGY_GUST.on;
    const d = run.debris.spawn(universeType(run, DARK_ENERGY_GUST.blowDebrisSize), p.x + 2, p.z + 1.5, run.rng)!;
    const dx0 = d.x;
    const d0 = Math.hypot(b.x - h.x, b.z - h.z);
    for (let i = 0; i < 20; i++) run.hazards.update(STEP, run);
    expect(Math.hypot(b.x - h.x, b.z - h.z)).toBeGreaterThan(d0 + 0.3);
    expect(d.x).toBeLessThan(dx0 - 0.1);
  });
});

describe('the Expansion', () => {
  const T = THE_EXPANSION;

  /** The Expansion round a Tier 21 Bunny at the spawn, past its intro, nothing loose within `clear`. */
  function fight(seed: string, opts: { clear?: number; radius?: number } = {}) {
    const { run, events } = makeRun(seed);
    const p = moveToOpen(run, opts.clear ?? 0);
    const b = run.bunny;
    b.health = 999;
    b.setRadius(opts.radius ?? 3.2);
    const boss = run.hazards.spawn('the_expansion', p.x + 20, p.z) as TheExpansion;
    for (let i = 0; i < 60 * T.introTime + 1; i++) run.hazards.update(STEP, run);
    expect(boss.state).toBe('expanding');
    return { run, events, boss, b, p };
  }

  /** No strands drift in on their own (the test controls what is loose). */
  const noStrands = (boss: TheExpansion) => ((boss as unknown as { strandTimer: number }).strandTimer = 1e9);

  it('bar maths: gains are the absorbed volume over the arrival volume, drain and H ramp, the flow is capped', () => {
    expect(tugGain(T, 1, 2)).toBeCloseTo(T.gravity.gain / 8);
    // Even the fastest eater needs about a minute: 0.7 of the bar at maxRise less the starting drain.
    expect((1 - T.gravity.start) / (T.gravity.maxRise - T.gravity.drain[0])).toBeGreaterThan(40);
    expect(tugGain(T, 3, 3)).toBeCloseTo(T.gravity.gain);
    expect(expansionRates(T, 0)).toEqual({ hubble: T.hubble.rate[0], drain: T.gravity.drain[0] });
    const mid = expansionRates(T, T.ramp / 2);
    expect(mid.hubble).toBeCloseTo((T.hubble.rate[0] + T.hubble.rate[1]) / 2);
    expect(mid.drain).toBeCloseTo((T.gravity.drain[0] + T.gravity.drain[1]) / 2);
    expect(expansionRates(T, T.ramp * 5)).toEqual({ hubble: T.hubble.rate[1], drain: T.gravity.drain[1] });
    expect(hubbleSpeed(0.1, 20, 5)).toBeCloseTo(2);
    expect(hubbleSpeed(0.1, 200, 5)).toBe(5);
    // Near Debris is always catchable: the cap is below the Bunny's speed.
    expect(T.hubble.cap).toBeLessThan(1);
    expect(T.gravity.start).toBeGreaterThan(0);
    expect(T.gravity.ripReset).toBeGreaterThan(0);
  });

  it('is no body: centred on the Bunny, never touched or absorbed, never despawned by the director', () => {
    const { run, events } = makeRun('expansion-body');
    installGameplay(run);
    const p = moveToOpen(run);
    const b = run.bunny;
    b.setRadius(tierRadius(run, 21) * 1.02);
    const spawned: number[] = [];
    events.on('bossSpawned', (e) => spawned.push(e.absorbRadius));
    for (let i = 0; i < 60 * (AREA_BOSSES.universe.arrivalDelay + 0.5); i++) run.update(STEP);
    const boss = run.hazards.hazards.find((h) => h.def.id === 'the_expansion') as TheExpansion;
    expect(boss).toBeTruthy();
    expect(boss.intangible).toBe(true);
    expect(spawned).toEqual([Infinity]);
    expect(boss.x).toBe(b.x);
    expect(HazardManager.touches(run, boss)).toBe(false);
    // Far bigger than anything else: still not absorbed, and still round the Bunny after it moves.
    b.setRadius(9);
    b.teleport(p.x + 30, p.z + 10);
    for (let i = 0; i < 60 * 2; i++) run.update(STEP);
    expect(boss.dead).toBeFalsy();
    expect(run.hazards.hazards).toContain(boss);
    expect(boss.x).toBeCloseTo(b.x, 5);
    expect(boss.z).toBeCloseTo(b.z, 5);
    expect(boss.stunnedFor).toBe(0);
  });

  it('Abilities ignore it: no Decoy clog, no Discharge target, no planted crash', () => {
    const input: InputState = { moveX: 0, moveZ: 0, dash: false, ability: false, abilityHeld: false };
    const setup = (characterId: string) => {
      const events = new EventBus();
      const run = createRun(events, { seed: `expansion-${characterId}`, characterId, area: 'universe' }, { hazards: false, pickups: false });
      run.input = { sample: () => ({ ...input }) };
      run.bunny.setRadius(3.2);
      run.bunny.health = 999;
      const boss = run.hazards.spawn('the_expansion', run.bunny.x, run.bunny.z) as TheExpansion;
      return { run, events, boss, sys: getAbilitySystem(run)! };
    };
    // Lint: a Decoy dropped inside the lattice is never clogged by it.
    {
      const { run, events, sys } = setup('lint');
      const clogs: unknown[] = [];
      events.on('hazardClogged', (e) => clogs.push(e));
      input.ability = true;
      run.update(STEP);
      input.ability = false;
      expect((sys.controller as DecoyAbility).decoy).not.toBeNull();
      for (let i = 0; i < 30; i++) run.update(STEP);
      expect(clogs).toEqual([]);
      expect((sys.controller as DecoyAbility).decoy).not.toBeNull();
    }
    // Zap: a full meter finds no target in it.
    {
      const { run, boss, sys } = setup('zap');
      const ctl = sys.controller as DischargeAbility;
      expect(ctl.canTarget(boss)).toBe(false);
      ctl.charge = 1;
      run.bunny.vx = maxSpeedFor(run.bunny);
      run.update(STEP);
      expect(ctl.findTarget()).toBeNull();
    }
    // Tumble: planted inside it, nothing crashes.
    {
      const { run, events, boss } = setup('tumble');
      const planted: unknown[] = [];
      events.on('hazardHitPlanted', (e) => planted.push(e));
      input.ability = true;
      input.abilityHeld = true;
      for (let i = 0; i < 30; i++) run.update(STEP);
      input.ability = false;
      input.abilityHeld = false;
      expect(planted).toEqual([]);
      expect(boss.dead).toBeFalsy();
    }
  });

  it('absorbing pulls the bar towards gravity (flowing in at maxRise per s); the expansion drains it', () => {
    const { run, boss, b, p } = fight('expansion-bar', { clear: 30 });
    noStrands(boss);
    const g0 = boss.gravity;
    for (let i = 0; i < 60 * 4; i++) run.hazards.update(STEP, run);
    expect(boss.gravity).toBeLessThan(g0);
    expect(boss.gravity).toBeCloseTo(g0 - T.gravity.drain[0] * 4, 2);
    // A big gulp goes into the pending pool, measured against the arrival radius (the Bunny grew).
    const d = run.debris.spawn(universeType(run), p.x, p.z, run.rng, { size: 2 })!;
    const g1 = boss.gravity;
    run.absorbDebris(d);
    const gain = tugGain(T, 2, boss.arrivalRadius);
    expect(gain).toBeGreaterThan(T.gravity.maxRise);
    expect(boss.pending).toBeCloseTo(gain, 9);
    expect(boss.arrivalRadius).toBeCloseTo(3.2);
    expect(b.radius).toBeGreaterThan(3.2);
    // It flows in at maxRise per s, less the drain.
    for (let i = 0; i < 60; i++) run.hazards.update(STEP, run);
    const drain = expansionRates(T, boss.fightTime).drain;
    expect(boss.gravity).toBeCloseTo(g1 + T.gravity.maxRise - drain, 2);
    expect(boss.pending).toBeCloseTo(gain - T.gravity.maxRise, 3);
    // The pool is capped.
    for (let i = 0; i < 20; i++) run.absorbDebris(run.debris.spawn(universeType(run), p.x, p.z, run.rng, { size: 2 })!);
    expect(boss.pending).toBe(T.gravity.maxPending);
  });

  it('the Hubble flow pushes loose Debris away from the Bunny at H × distance (in view only), but not filament strands', () => {
    const { run, boss, p } = fight('expansion-flow', { clear: 400 });
    noStrands(boss);
    const viewR = viewRadiusFor(run.bunny.radius, run.tier);
    const i = universeType(run, 0.5);
    const near = run.debris.spawn(i, p.x + 20, p.z, run.rng)!;
    const far = run.debris.spawn(i, p.x, p.z + viewR + 10, run.rng)!;
    const farZ = far.z;
    for (let k = 0; k < 60; k++) run.hazards.update(STEP, run);
    const d1 = near.x - p.x;
    // One second at H ≈ rate[0]: 20 × e^H.
    expect(d1).toBeGreaterThan(20 * Math.exp(T.hubble.rate[0]) * 0.97);
    expect(d1).toBeLessThan(20 * Math.exp(T.hubble.rate[0]) * 1.03);
    expect(Math.abs(near.z - p.z)).toBeLessThan(1e-6);
    expect(far.z).toBe(farZ);
  });

  it('when food runs low, filament strands land beyond the view and drift in against the flow', () => {
    const { run, boss, p } = fight('expansion-strands', { clear: 400 });
    const viewR = viewRadiusFor(run.bunny.radius, run.tier);
    run.hazards.update(STEP, run);
    expect(boss.strandsSent).toBe(1);
    const strand: Debris[] = [];
    run.debris.forEach((d) => strand.push(d));
    expect(strand.length).toBe(T.strands.count);
    const maxSize = run.bunny.radius * ratio;
    for (const d of strand) {
      expect(Math.hypot(d.x - p.x, d.z - p.z)).toBeGreaterThan(viewR);
      expect(d.size).toBeLessThanOrEqual(maxSize);
      expect(d.size).toBeGreaterThanOrEqual(maxSize * T.strands.size[0] - 1e-9);
    }
    const dist0 = Math.hypot(strand[0]!.x - p.x, strand[0]!.z - p.z);
    for (let k = 0; k < 60 * 2; k++) run.hazards.update(STEP, run);
    expect(Math.hypot(strand[0]!.x - p.x, strand[0]!.z - p.z)).toBeLessThan(dist0 - 5);
  });

  it('the Big Rip: at 0 the Bunny takes 1 damage and sheds, and the bar restarts', () => {
    const { run, events, boss, b } = fight('expansion-rip', { clear: 60 });
    noStrands(boss);
    const rips: Array<{ damaged: boolean }> = [];
    const hits: string[] = [];
    events.on('bossRip', (e) => rips.push(e));
    events.on('bunnyDamaged', (e) => hits.push(e.source));
    const hp = b.health;
    const r0 = b.radius;
    boss.gravity = 0.001;
    for (let i = 0; i < 30; i++) run.hazards.update(STEP, run);
    expect(rips).toMatchObject([{ damaged: true }]);
    expect(hits).toEqual(['the_expansion']);
    expect(b.health).toBe(hp - T.rip.damage);
    expect(b.radius).toBeLessThan(r0);
    expect(boss.gravity).toBeCloseTo(T.gravity.ripReset, 5);
    expect(boss.rips).toBe(1);
  });

  it('a Big Rip that does not land (i-frames) sheds nothing', () => {
    const { run, events, boss, b } = fight('expansion-rip-blocked', { clear: 60 });
    noStrands(boss);
    const rips: Array<{ damaged: boolean; volume: number }> = [];
    events.on('bossRip', (e) => rips.push(e));
    const hp = b.health;
    const r0 = b.radius;
    b.invulnerable = 10;
    boss.gravity = 0.001;
    for (let i = 0; i < 30; i++) run.hazards.update(STEP, run);
    expect(rips).toMatchObject([{ damaged: false, volume: 0 }]);
    expect(b.health).toBe(hp);
    expect(b.radius).toBe(r0);
  });

  it('ignored, it eventually kills the Bunny', () => {
    const { run, boss, b } = fight('expansion-ignore', { clear: 60 });
    noStrands(boss);
    b.health = 3;
    for (let i = 0; i < 60 * 600 && !run.ended; i++) {
      run.hazards.update(STEP, run);
      b.invulnerable = 0;
    }
    expect(boss.rips).toBe(3);
    expect(b.alive).toBe(false);
  });

  it('at 1 it collapses: Debris rushes in (no growth), the other Hazards fall in, then bossDefeated → victory and the Run ends', () => {
    const { run, events, boss, b, p } = fight('expansion-collapse');
    noStrands(boss);
    const order: string[] = [];
    events.on('bossCollapse', () => order.push('collapse'));
    events.on('bossDefeated', (e) => order.push(`defeated:${e.defId}`));
    events.on('victory', () => order.push('victory'));
    events.on('runEnded', (e) => order.push(`ended:${e.reason}`));
    const other = run.hazards.spawn('quasar', p.x + 25, p.z);
    const viewR = viewRadiusFor(b.radius, run.tier);
    const inView = run.debris.query(p.x, p.z, viewR).length;
    expect(inView).toBeGreaterThan(10);
    const r0 = b.radius;
    boss.gravity = 1;
    for (let i = 0; i < 60 * (T.collapse.duration + 1) && !run.ended; i++) run.update(STEP);
    expect(order).toEqual(['collapse', 'defeated:the_expansion', 'victory', 'ended:victory']);
    expect(other.dead).toBe(true);
    expect(boss.crunched).toBeGreaterThan(inView * 0.8);
    expect(run.debris.query(p.x, p.z, viewR * 0.5).length).toBe(0);
    expect(b.radius).toBeLessThan(r0 * 1.05);
    expect(run.universeCleared).toBe(true);
  });
});
