import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/events';
import { AREAS } from '../data/areas';
import {
  AREA_BOSSES,
  AREA_DIRECTORS,
  BLACK_HOLE,
  DIRECTOR_EXCLUDE,
  GALAXY_DIRECTOR,
  GLOBULAR_CLUSTER,
  PULSAR,
  SAGITTARIUS_A,
  SOLAR_DIRECTOR,
  SUPERNOVA,
  SUPERNOVA_REMNANT,
  tierValue,
} from '../data/hazards';
import { peakRarityForBoss } from '../data/keepsakes';
import { getTier } from '../data/tiers';
import type { Debris } from '../entities/debris';
import { installGameplay } from '../game/assembly';
import { Run } from '../game/run';
import { galacticCentre } from '../world/galaxy';
import { createModel } from '../world/models';
import type { AreaId } from '../world/types';
import { absorbRadiusFor } from './common';
import { spawnWeights } from './director';
import { hazardRegistry } from './index';
import type { LintRoller } from './lintRoller';
import { HAZARD_MODEL_SIZES } from './models';
import type { Mop } from './mop';
import { beamLead, inBeam, type Pulsar } from './pulsar';
import { bossSizeAfterHits } from './robovac';
import type { Roomba } from './roomba';
import type { SagittariusA } from './sagittariusA';
import type { UprightVacuum } from './uprightVacuum';

const GALAXY_HAZARDS = ['black_hole', 'globular_cluster', 'pulsar', 'supernova_remnant', 'supernova'];
const TUNINGS = { black_hole: BLACK_HOLE, globular_cluster: GLOBULAR_CLUSTER, pulsar: PULSAR, supernova_remnant: SUPERNOVA_REMNANT, supernova: SUPERNOVA } as const;
const CLUSTERS = Object.keys(SAGITTARIUS_A.clusters.meals);
const ratio = 0.7;
const STEP = 1 / 60;

/** A Run in the Galaxy (360 × 360 units of 100 ly, Sagittarius A*'s seat at the centre); the Bunny arrives at 0.85 units. */
const makeRun = (seed = 'galaxy-hazards') => {
  const events = new EventBus();
  const run = new Run(events, { seed, characterId: 'lint', area: 'galaxy' });
  return { events, run };
};

/** Bunny radius (Galaxy units) at the start of a Tier. */
const tierRadius = (run: Run, tier: number) => getTier(tier).minRadius / run.unit;

/** The spawn: open space on an arm (the Galaxy has no obstacles). */
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

/** Removes every loose Debris near (x, z), so a test controls what is about. */
function clearAround(run: Run, x: number, z: number, radius: number): void {
  for (const d of run.debris.query(x, z, radius)) run.debris.remove(d);
}

describe('galaxy Hazards', () => {
  it('run in Galaxy units (1 = 100 ly) with their own models, whose fallbacks carry the GLB node names', () => {
    const { run } = makeRun();
    expect(run.unit).toBe(AREAS.galaxy.unit);
    expect(run.bunny.radius).toBeCloseTo(AREAS.galaxy.arrivalRadius!);
    for (const [id, cfg] of Object.entries(TUNINGS)) {
      expect(cfg.modelId, id).toBe(id);
      expect(hazardRegistry.require(id).modelId, id).toBe(id);
    }
    expect(hazardRegistry.require('sagittarius_a').modelId).toBe('sagittarius_a');
    const nodes: Record<string, string[]> = { black_hole: ['disk'], globular_cluster: ['swarm'], pulsar: ['head'], supernova_remnant: ['shell'], supernova: ['core'], sagittarius_a: ['disk', 'jet_n', 'jet_s'] };
    for (const [id, names] of Object.entries(nodes)) {
      const m = createModel(id, { ...HAZARD_MODEL_SIZES[id as keyof typeof HAZARD_MODEL_SIZES] });
      for (const n of names) expect(m.getObjectByName(n), `${id} ${n}`).toBeTruthy();
    }
    expect(HAZARD_MODEL_SIZES.sagittarius_a).toEqual({ w: 6.4, d: 6.4, h: 5.39 });
  });

  it('are a threat on arrival and absorbable before Sagittarius A* is; Tier 18 ones are food by early Tier 19', () => {
    const tier19 = tierRadius(makeRun().run, 19);
    const boss = absorbRadiusFor(SAGITTARIUS_A.size, ratio);
    for (const id of GALAXY_HAZARDS) {
      const { run } = makeRun(`absorb-${id}`);
      const p = moveToOpen(run);
      const h = run.hazards.spawn(id, p.x + 8, p.z);
      expect(h.dead, id).toBeFalsy();
      const need = absorbRadiusFor(h.size, ratio);
      expect(need, id).toBeGreaterThan(AREAS.galaxy.arrivalRadius!);
      const first = firstTableTier(id, 'galaxy');
      expect(need, id).toBeGreaterThan(tierRadius(run, first));
      expect(need, id).toBeLessThan(boss);
      if (first === 18) expect(need, id).toBeLessThan(tier19 * 1.1);
    }
  });

  it('keeps Sagittarius A* out of reach at Tier 19 entry, but reachable after two chips', () => {
    const tier19 = tierRadius(makeRun().run, 19);
    const { size, chipFactor } = SAGITTARIUS_A;
    expect(absorbRadiusFor(size, ratio)).toBeCloseTo(4, 1);
    expect(absorbRadiusFor(bossSizeAfterHits(1, size, chipFactor), ratio)).toBeGreaterThan(tier19);
    expect(absorbRadiusFor(bossSizeAfterHits(2, size, chipFactor), ratio)).toBeLessThan(tier19);
    expect(hazardRegistry.require('sagittarius_a').boss).toBe(true);
    expect(SAGITTARIUS_A.miniId).toBeUndefined();
    expect(AREA_BOSSES.galaxy).toEqual({ id: 'sagittarius_a', tier: 19, arrivalDelay: 4 });
    expect(peakRarityForBoss('sagittarius_a')).toBe(4);
  });

  it('galaxy spawn tables list only galaxy Hazards, Supernovae from Tier 19, never Sagittarius A*', () => {
    for (let t = GALAXY_DIRECTOR.firstTier; t <= 19; t++) {
      const ids = Object.keys(spawnWeights(t, {}, 'galaxy'));
      expect(ids.length).toBeGreaterThan(0);
      for (const id of ids) expect(GALAXY_HAZARDS).toContain(id);
    }
    expect(Object.keys(spawnWeights(18, {}, 'galaxy'))).not.toContain('supernova');
    expect(Object.keys(spawnWeights(19, {}, 'galaxy'))).toContain('supernova');
    expect(DIRECTOR_EXCLUDE).toContain('sagittarius_a');
    for (const t of SOLAR_DIRECTOR.tiers) for (const id of GALAXY_HAZARDS) expect(Object.keys(t.types)).not.toContain(id);
    expect(tierValue(PULSAR.range, 18)).toBe(PULSAR.range[17]);
    expect(tierValue(PULSAR.range, 19)).toBe(PULSAR.range[18]);
  });

  it('the director spawns galaxy Hazards (placed clear of the map) and brings Sagittarius A* at Tier 19', () => {
    const { run, events } = makeRun('galaxy-director');
    installGameplay(run);
    const spawned: string[] = [];
    const bosses: string[] = [];
    events.on('hazardSpawned', (e) => spawned.push(e.defId));
    events.on('bossSpawned', (e) => bosses.push(e.name));
    run.bunny.health = 999;
    for (let i = 0; i < 60 * 30 && !run.ended; i++) run.update(STEP);
    run.bunny.setRadius(tierRadius(run, 18) * 2.6);
    for (let i = 0; i < 60 * 60 && !run.ended; i++) run.update(STEP);
    expect(spawned.length).toBeGreaterThan(2);
    expect(bosses).toEqual([]);
    run.bunny.setRadius(tierRadius(run, 19) * 1.02);
    for (let i = 0; i < 60 * (AREA_BOSSES.galaxy.arrivalDelay + 1) && !run.ended; i++) run.update(STEP);
    expect(run.tier).toBe(19);
    expect(bosses).toEqual(['Sagittarius A*']);
    expect(run.hazards.count('sagittarius_a')).toBe(1);
    for (const id of spawned) expect([...GALAXY_HAZARDS, 'sagittarius_a']).toContain(id);
  });

  it("the Black Hole's pull drags the Bunny in, spirals loose Debris in and swallows it; its disc turns", () => {
    const { run } = makeRun('black-hole');
    const p = moveToOpen(run);
    const b = run.bunny;
    clearAround(run, p.x, p.z, 20);
    const h = run.hazards.spawn('black_hole', p.x + b.radius + BLACK_HOLE.size + 2, p.z) as Roomba;
    h.yaw = Math.PI / 2; // drifting away (+X)
    const disk = h.model.getObjectByName('disk')!;
    const spin0 = disk.rotation.y;
    const x0 = b.x;
    for (let i = 0; i < 10; i++) run.hazards.update(STEP, run);
    expect(b.x).toBeGreaterThan(x0 + 0.03);
    expect(disk.rotation.y).not.toBe(spin0);
    // A small star beside it spirals in (sideways as well as inwards) and is swallowed.
    b.teleport(p.x - 40, p.z);
    const small = run.debris.types.findIndex((t) => t.area === 'galaxy' && t.size <= BLACK_HOLE.debrisPull!.maxSize && Object.keys(t.rooms).length > 0);
    const d = run.debris.spawn(small, h.x, h.z + h.size + 1.5, run.rng)!;
    const z0 = d.z;
    const dx0 = d.x;
    run.hazards.update(STEP, run);
    expect(d.z).toBeLessThan(z0);
    expect(Math.abs(d.x - dx0)).toBeGreaterThan(1e-4);
    for (let i = 0; i < 60 * 6 && d.alive; i++) run.hazards.update(STEP, run);
    expect(d.alive).toBe(false);
    expect(h.swallowed).toBeGreaterThan(0);
  });

  it('a Globular Cluster rides the nearest galactic orbit ring one way round, its swarm turning', () => {
    const { run } = makeRun('globular');
    const c = galacticCentre(run.house);
    const b = run.bunny;
    b.teleport(c.x, c.z - 170);
    const ringR = 60;
    const h = run.hazards.spawn('globular_cluster', c.x + ringR + 3, c.z) as LintRoller;
    expect(h.ring).not.toBeNull();
    expect(Math.hypot(h.x - c.x, h.z - c.z)).toBeCloseTo(ringR, 0);
    const swarm = h.model.getObjectByName('swarm')!;
    const spin0 = swarm.rotation.y;
    const a0 = Math.atan2(h.z - c.z, h.x - c.x);
    for (let i = 0; i < 60 * 5; i++) {
      run.hazards.update(STEP, run);
      b.teleport(c.x, c.z - 170);
      expect(Math.abs(Math.hypot(h.x - c.x, h.z - c.z) - ringR)).toBeLessThan(0.2);
    }
    expect(Math.atan2(h.z - c.z, h.x - c.x)).not.toBeCloseTo(a0, 2);
    expect(swarm.rotation.y).not.toBe(spin0);
  });

  it('beam geometry: the lead ahead of either beam, and the twin beams both ways', () => {
    expect(beamLead(0, 1, 0.5)).toBeCloseTo(0.5);
    expect(beamLead(0, -1, 0.5)).toBeCloseTo(Math.PI - 0.5);
    expect(beamLead(0, 1, Math.PI + 0.25)).toBeCloseTo(0.25);
    expect(inBeam(0, 5, 0.5, 0, 9, 0.7)).toBe(true);
    expect(inBeam(0, -5, 0.5, 0, 9, 0.7)).toBe(true);
    expect(inBeam(3, 5, 0.5, 0, 9, 0.7)).toBe(false);
    expect(inBeam(0, 11, 0.5, 0, 9, 0.7)).toBe(false);
  });

  it('the Pulsar stays put and turns its beams; it telegraphs, then a burning beam sweeps over the Bunny once per burn', () => {
    const { run, events } = makeRun('pulsar');
    const p = moveToOpen(run);
    const b = run.bunny;
    b.setRadius(1.2);
    b.health = 999;
    const h = run.hazards.spawn('pulsar', p.x, p.z - 6) as Pulsar;
    const head = h.model.getObjectByName('head')!;
    run.hazards.update(STEP, run);
    const yaw0 = h.body.rotation.y;
    const telegraphs: string[] = [];
    events.on('hazardTelegraph', (e) => e.defId === 'pulsar' && telegraphs.push(e.attack));
    let seen = new Set<string>();
    const hp = b.health;
    for (let i = 0; i < 60 * 12 && b.health === hp; i++) {
      run.hazards.update(STEP, run);
      b.teleport(p.x, p.z);
      seen.add(h.state);
      expect(h.x).toBe(p.x);
    }
    expect(telegraphs).toContain('beam');
    expect(seen.has('telegraph')).toBe(true);
    expect(b.health).toBe(hp - PULSAR.damage);
    expect(h.state).toBe('firing');
    expect(h.body.rotation.y).toBe(yaw0);
    expect(head.rotation.y).not.toBe(0);
    // Still in the beam for the rest of the burn: no second hit.
    for (let i = 0; i < 60 * PULSAR.fire && h.state === 'firing'; i++) {
      run.hazards.update(STEP, run);
      b.teleport(p.x, p.z);
      b.invulnerable = 0;
    }
    expect(h.hits).toBe(1);
    // Out of range: never telegraphs at the Bunny.
    seen = new Set();
    b.teleport(p.x, p.z - 6 + tierValue(PULSAR.range, run.tier) + b.radius + 3);
    const t0 = telegraphs.length;
    for (let i = 0; i < 60 * 10; i++) run.hazards.update(STEP, run);
    expect(telegraphs.length).toBe(t0);
  });

  it("the Supernova Remnant's filament trail slows the Bunny, its shell breathing", () => {
    const { run } = makeRun('remnant');
    const p = moveToOpen(run);
    const b = run.bunny;
    b.setRadius(1.5);
    const speed0 = b.stats.get('speed');
    const h = run.hazards.spawn('supernova_remnant', p.x + 10, p.z) as Mop;
    const shell = h.model.getObjectByName('shell')!;
    let scales = new Set<number>();
    for (let i = 0; i < 60 * 5; i++) {
      run.hazards.update(STEP, run);
      scales.add(Math.round(shell.scale.x * 1000));
    }
    expect(scales.size).toBeGreaterThan(3);
    scales = new Set();
    expect(h.puddles.length).toBeGreaterThan(3);
    const far = h.puddles.reduce((f, q) => (Math.hypot(q.x - h.x, q.z - h.z) > Math.hypot(f.x - h.x, f.z - h.z) ? q : f));
    b.teleport(far.x, far.z);
    run.hazards.update(STEP, run);
    expect(b.stats.get('speed')).toBeCloseTo(speed0 * SUPERNOVA_REMNANT.slowMultiplier, 5);
  });

  it("the Supernova's core swells through the warm-up, then the blast pushes the Bunny and loose Debris away", () => {
    const { run } = makeRun('supernova');
    const p = moveToOpen(run);
    const b = run.bunny;
    clearAround(run, p.x, p.z, 30);
    const h = run.hazards.spawn('supernova', p.x + 8, p.z) as UprightVacuum;
    h.yaw = -Math.PI / 2;
    h.state = 'warmup';
    (h as unknown as { timer: number }).timer = SUPERNOVA.warmup * run.difficulty.attackTiming * 0.3;
    const core = h.model.getObjectByName('core')!;
    run.hazards.update(STEP, run);
    expect(core.scale.x).toBeGreaterThan(1.15);
    h.state = 'on';
    (h as unknown as { timer: number }).timer = SUPERNOVA.on;
    const small = run.debris.types.findIndex((t) => t.area === 'galaxy' && t.size <= SUPERNOVA.blowDebrisSize && Object.keys(t.rooms).length > 0);
    const d = run.debris.spawn(small, p.x + 2, p.z + 1.5, run.rng)!;
    const dx0 = d.x;
    const d0 = Math.hypot(b.x - h.x, b.z - h.z);
    for (let i = 0; i < 20; i++) run.hazards.update(STEP, run);
    expect(Math.hypot(b.x - h.x, b.z - h.z)).toBeGreaterThan(d0 + 0.3);
    expect(d.x).toBeLessThan(dx0 - 0.1);
  });
});

describe('Sagittarius A*', () => {
  /** Sagittarius A* in its hunt, `d` units west of a Tier 19 Bunny (facing it, +X), nothing loose about. */
  function hunting(seed: string, d: number, opts: { radius?: number } = {}) {
    const { run, events } = makeRun(seed);
    const p = moveToOpen(run);
    const b = run.bunny;
    b.health = 999;
    b.setRadius(opts.radius ?? 3.2);
    clearAround(run, p.x - d, p.z, 60);
    const boss = run.hazards.spawn('sagittarius_a', p.x - d, p.z) as SagittariusA;
    boss.yaw = Math.PI / 2;
    boss.state = 'hunt';
    return { run, events, boss, b, p };
  }

  /** No clusters drift in on their own, no charge and no jet (the test drives them). */
  const quiet = (boss: SagittariusA) => {
    const s = boss as unknown as { clusterPlaced: boolean; clusterTimer: number; timer: number; ashTimer: number };
    s.clusterPlaced = true;
    s.clusterTimer = 1e9;
    s.timer = 1e9;
    s.ashTimer = 1e9;
  };

  /** Puts a cluster of `id` right at its horizon (swallowed on the next tick). */
  const feedCluster = (run: Run, boss: SagittariusA, id = 'star_cluster', size?: number) =>
    run.debris.spawn(typeIndex(run, id), boss.x + 0.1, boss.z, run.rng, size === undefined ? {} : { size })!;

  it('its pull drags the Bunny in and bends the camera (lens pull and strength rise), but not a hunkered Bunny', () => {
    const { run, boss, b, p } = hunting('pull', 13);
    quiet(boss);
    const strength0 = boss.lens.strength;
    const d0 = Math.hypot(b.x - boss.x, b.z - boss.z);
    for (let i = 0; i < 30; i++) run.hazards.update(STEP, run);
    expect(Math.hypot(b.x - boss.x, b.z - boss.z)).toBeLessThan(d0 - 0.2);
    expect(boss.pull).toBeGreaterThan(0.3);
    expect(boss.lens.pull).toBeGreaterThan(0.1);
    expect(boss.lens.strength).toBeGreaterThan(strength0);
    expect(boss.lens.x).toBe(boss.x);
    expect(boss.lens.horizon).toBeCloseTo((SAGITTARIUS_A.size / SAGITTARIUS_A.modelSize) * 1, 5);
    b.teleport(p.x, p.z);
    b.hunkered = true;
    const x = b.x;
    for (let i = 0; i < 10; i++) run.hazards.update(STEP, run);
    expect(b.x).toBeCloseTo(x, 6);
    expect(boss.pull).toBe(0);
  });

  it('pulls loose Debris in and swallows it, counting only star clusters towards indigestion (bossSwallowed)', () => {
    const { run, events, boss, b, p } = hunting('feed', 30);
    quiet(boss);
    b.teleport(p.x + 40, p.z);
    const swallowed: Array<{ typeId: string; fullness: number }> = [];
    events.on('bossSwallowed', (e) => swallowed.push(e));
    const star = run.debris.spawn(typeIndex(run, 'sun_like_star'), boss.x + SAGITTARIUS_A.contactRadius + 4, boss.z, run.rng)!;
    for (let i = 0; i < 60 * 6 && star.alive; i++) run.hazards.update(STEP, run);
    expect(star.alive).toBe(false);
    expect(boss.swallowed).toBe(1);
    expect(swallowed).toEqual([]);
    feedCluster(run, boss);
    run.hazards.update(STEP, run);
    expect(swallowed.map((e) => e.typeId)).toEqual(['star_cluster']);
    expect(boss.fullness).toBe(1);
    expect(boss.state).toBe('hunt');
  });

  it('two star clusters swallowed within the window stun it (indigestion); two far apart do not', () => {
    const { run, events, boss, b } = hunting('indigestion', 30);
    quiet(boss);
    // No hits: a shed open cluster (the shed ladder is the Galaxy's own) would be half a meal.
    b.invulnerable = 1e9;
    const stuns: Array<string | undefined> = [];
    events.on('bossStunned', (e) => stuns.push(e.cause));
    feedCluster(run, boss);
    run.hazards.update(STEP, run);
    for (let i = 0; i < 60 * (SAGITTARIUS_A.clusters.window + 1); i++) run.hazards.update(STEP, run);
    expect(boss.fullness).toBe(0);
    feedCluster(run, boss);
    run.hazards.update(STEP, run);
    expect(stuns).toEqual([]);
    for (let i = 0; i < 60 * 2; i++) run.hazards.update(STEP, run);
    feedCluster(run, boss);
    run.hazards.update(STEP, run);
    expect(stuns).toEqual(['indigestion']);
    expect(boss.state).toBe('stunned');
    expect(boss.stunCause).toBe('indigestion');
    expect(boss.indigestions).toBe(1);
    // Stunned: no pull on the Bunny, and the camera lets go.
    for (let i = 0; i < 30; i++) run.hazards.update(STEP, run);
    expect(boss.pull).toBe(0);
  });

  it('an open cluster is half a meal; one big cluster is a whole meal on its own', () => {
    const { run, events, boss } = hunting('meals', 30);
    quiet(boss);
    const stuns: Array<string | undefined> = [];
    events.on('bossStunned', (e) => stuns.push(e.cause));
    feedCluster(run, boss, 'open_cluster', 1.3);
    run.hazards.update(STEP, run);
    expect(boss.fullness).toBe(0.5);
    for (let i = 0; i < 60 * (SAGITTARIUS_A.clusters.window + 1); i++) run.hazards.update(STEP, run);
    feedCluster(run, boss, 'star_cluster', SAGITTARIUS_A.clusters.bigSize + 0.1);
    run.hazards.update(STEP, run);
    expect(stuns).toEqual(['indigestion']);
  });

  it('ramming it with indigestion chips it: relativistic jets scatter (and it leaves them alone), the north jet hides', () => {
    const { run, events, boss, b } = hunting('chips', 14);
    quiet(boss);
    feedCluster(run, boss);
    run.hazards.update(STEP, run);
    feedCluster(run, boss);
    run.hazards.update(STEP, run);
    expect(boss.state).toBe('stunned');
    const hits: number[] = [];
    events.on('bossHit', (e) => hits.push(e.size));
    b.teleport(boss.x + SAGITTARIUS_A.contactRadius + b.radius * 0.9, boss.z);
    boss.onContact(run);
    expect(hits).toEqual([bossSizeAfterHits(1, SAGITTARIUS_A.size, SAGITTARIUS_A.chipFactor)]);
    const jets = ofType(run, [SAGITTARIUS_A.chipTypeId]);
    expect(jets.length).toBeGreaterThan(SAGITTARIUS_A.chipPieces / 2);
    expect(boss.model.getObjectByName('jet_n')!.visible).toBe(false);
    expect(boss.jetRegrow).toBeCloseTo(SAGITTARIUS_A.jetRegrow);
    b.teleport(boss.x + 60, boss.z);
    for (let i = 0; i < 60 * 3; i++) run.hazards.update(STEP, run);
    expect(boss.state).not.toBe('stunned');
    expect(ofType(run, [SAGITTARIUS_A.chipTypeId]).length).toBe(jets.length);
  });

  it('clusters drift in between it and the Bunny when none are near, too big for the Bunny to eat; none while two are near', () => {
    const { run, boss, b } = hunting('fallback', 18);
    quiet(boss);
    expect(ofType(run, CLUSTERS).filter((d) => Math.hypot(d.x - boss.x, d.z - boss.z) < SAGITTARIUS_A.clusters.range).length).toBe(0);
    expect(boss.keepClusters(run)).toBe(true);
    const placed = ofType(run, CLUSTERS).filter((d) => Math.hypot(d.x - boss.x, d.z - boss.z) < SAGITTARIUS_A.clusters.range);
    expect(placed.length).toBe(SAGITTARIUS_A.clusters.count);
    for (const d of placed) {
      expect(d.x).toBeLessThan(b.x);
      expect(d.x).toBeGreaterThan(boss.x);
      expect(absorbRadiusFor(d.size, b.stats.get('absorbRatio'))).toBeGreaterThan(b.radius);
    }
    expect(boss.keepClusters(run)).toBe(false);
  });

  it('never soft-locks: with the Bunny standing off and eating nothing, clusters drift in and it gets indigestion', () => {
    const { run, events, boss, b, p } = hunting('no-softlock', 24);
    let stuns = 0;
    events.on('bossStunned', (e) => e.cause === 'indigestion' && stuns++);
    for (let i = 0; i < 60 * 40 && stuns === 0; i++) {
      run.hazards.update(STEP, run);
      // Hold the Bunny out of the pull, staying put (a planted Bunny can't be pulled), like a player waiting.
      b.teleport(p.x, p.z);
      b.invulnerable = 1;
    }
    expect(stuns).toBe(1);
    expect(boss.fallbacks).toBeGreaterThanOrEqual(SAGITTARIUS_A.clusters.count);
  });

  it('a charge into the map edge ends without a stun', () => {
    const { run, events, boss, b } = hunting('edge', 10);
    quiet(boss);
    const stuns: Array<string | undefined> = [];
    events.on('bossStunned', (e) => stuns.push(e.cause));
    // Charge west from near the west edge.
    boss.x = run.house.bounds.minX + SAGITTARIUS_A.contactRadius + 3;
    b.teleport(boss.x - 2, boss.z);
    boss.state = 'charge';
    boss.yaw = -Math.PI / 2;
    const s = boss as unknown as { chargeDirX: number; chargeDirZ: number };
    s.chargeDirX = -1;
    s.chargeDirZ = 0;
    b.teleport(boss.x + 40, boss.z);
    for (let i = 0; i < 60 * 3 && boss.state === 'charge'; i++) run.hazards.update(STEP, run);
    expect(boss.state).toBe('recover');
    expect(stuns).toEqual([]);
  });

  it('its jet volley locks a violet lane on the Bunny, then the bolts hit and shed mass', () => {
    const { run, events, boss, b } = hunting('jets', 14);
    quiet(boss);
    (boss as unknown as { ashTimer: number }).ashTimer = 0.1;
    let shed = 0;
    events.on('bunnyShed', (e) => e.source === 'sagittarius_a' && shed++);
    const hp = b.health;
    for (let i = 0; i < 60 * 12 && b.health === hp; i++) {
      run.hazards.update(STEP, run);
      b.teleport(boss.x + 14, boss.z);
      b.invulnerable = 0;
    }
    expect(b.health).toBeLessThan(hp);
    expect(shed).toBeGreaterThan(0);
  });

  it('absorbing Sagittarius A* clears the Galaxy and opens the intergalactic gate (bossDefeated → exitOpened)', () => {
    const { run, events } = makeRun('sgr-win');
    const p = moveToOpen(run);
    const b = run.bunny;
    const order: string[] = [];
    events.on('bossDefeated', (e) => order.push(`bossDefeated:${e.defId}`));
    events.on('exitOpened', (e) => order.push(`exitOpened:${e.area}`));
    events.on('victory', () => order.push('victory'));
    events.on('runEnded', (e) => order.push(`runEnded:${e.reason}`));
    b.setRadius(absorbRadiusFor(SAGITTARIUS_A.size, b.stats.get('absorbRatio')) + 0.05);
    const boss = run.hazards.spawn('sagittarius_a', p.x + b.radius + 20, p.z) as SagittariusA;
    boss.x = b.x + b.radius;
    boss.z = b.z;
    run.update(STEP);
    expect(order).toEqual(['bossDefeated:sagittarius_a', 'exitOpened:galaxy']);
    expect(run.getStats()).toMatchObject({ galaxyCleared: true });
    expect(run.house.exit?.open).toBe(true);
    expect(run.canLeaveArea).toBe(true);
  });
});
