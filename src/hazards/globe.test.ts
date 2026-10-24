/** This Area's own Hazard behaviour. The contract every Area keeps (units, sizes, spawn tables, director, boss arrival) is checked over AREA_ORDER in areaContract.test.ts. */
import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/events';
import {
  ORBITAL_SWEEPER,
  REENTRY_BURN,
  SPACE_STATION,
  tierValue,
} from '../data/hazards';
import type { Debris } from '../entities/debris';
import { Run } from '../game/run';
import { roomAt } from '../world/house';
import { canonicalX } from '../world/wrap';
import { absorbRadiusFor } from './common';
import { hazardRegistry, type Hazard } from './index';
import { orbitLane } from './lintRoller';
import type { Mop } from './mop';
import { OrbitalSweeper, blockingMoonAt, isBlockingMoon } from './orbitalSweeper';
import { type BossState } from './robovac';
import type { SprayBottle } from './sprayBottle';
import type { UprightVacuum } from './uprightVacuum';
import './content';

const GLOBE_HAZARDS = ['debris_satellite', 'space_station', 'asat_laser', 'reentry_burn', 'globe_hurricane'];
const ratio = 0.7;
/** The orbit lanes on the placeholder map run along these z (src/world/globe.ts). */
const MOON = ORBITAL_SWEEPER.moon.typeId;

/** A Run on the Globe (400 × 200 units of 1,000 km, wraps east–west); the Bunny arrives at 0.85 units. */
const makeRun = (seed = 'globe-hazards') => {
  const events = new EventBus();
  const run = new Run(events, { seed, characterId: 'lint', area: 'globe' });
  return { events, run };
};

/** The spawn: open ocean in the middle of the map (the Globe has no obstacles). */
function moveToOpen(run: Run): { x: number; z: number } {
  const p = { x: run.house.spawn.x, z: run.house.spawn.z };
  run.bunny.teleport(p.x, p.z);
  return p;
}

function moonIndex(run: Run): number {
  const i = run.debris.types.findIndex((t) => t.id === MOON);
  if (i < 0) throw new Error('no moon Debris type');
  return i;
}

function moons(run: Run): Debris[] {
  const out: Debris[] = [];
  run.debris.forEach((d) => d.alive && d.type.id === MOON && out.push(d));
  return out;
}

/** Removes every Moon (and the Debris near a spot), so a test controls what the Sweeper meets. */
function clearMoons(run: Run): void {
  for (const d of moons(run)) run.debris.remove(d);
}

describe('globe Hazards', () => {
  it('the Debris-Field Satellite pulls the Bunny in and spins its panels', () => {
    const { run } = makeRun('satellite');
    moveToOpen(run);
    const b = run.bunny;
    const h = run.hazards.spawn('debris_satellite', b.x + b.radius + 1.2, b.z) as unknown as Hazard & { yaw: number; model: { getObjectByName(n: string): { rotation: { y: number } } | undefined } };
    h.yaw = Math.PI / 2; // drifting away (+X)
    const panels = h.model.getObjectByName('panels')!;
    const spin0 = panels.rotation.y;
    const x0 = b.x;
    for (let i = 0; i < 10; i++) run.hazards.update(1 / 60, run);
    expect(b.x).toBeGreaterThan(x0 + 0.03);
    expect(panels.rotation.y).not.toBe(spin0);
  });

  it('a Space Station joins the nearest orbit lane and patrols east–west along it; a hit sheds mass without sticking', () => {
    const { run, events } = makeRun('station');
    const p = moveToOpen(run);
    const b = run.bunny;
    const orbits = run.house.routes!.filter((r) => r.kind === 'orbit');
    expect(orbits.length).toBeGreaterThan(0);
    const nearest = orbits.map((r) => r.points[0]!.z).reduce((a, z) => (Math.abs(z - (p.z + 4)) < Math.abs(a - (p.z + 4)) ? z : a));
    const h = run.hazards.spawn('space_station', p.x + 6, p.z + 4);
    expect(h.dead).toBeFalsy();
    expect(h.z).toBe(nearest);
    let travelled = 0;
    let lx = h.x;
    for (let i = 0; i < 60 * 2; i++) {
      run.hazards.update(1 / 60, run);
      expect(h.z).toBe(nearest);
      travelled += Math.abs(h.x - lx);
      lx = h.x;
      b.teleport(p.x - 40, p.z - 40);
    }
    expect(travelled).toBeGreaterThan(0.5);
    expect(travelled).toBeLessThanOrEqual(tierValue(SPACE_STATION.speed, run.tier) * 1.15 * 2 + 1e-6);

    b.teleport(h.x, h.z + 2);
    let shed = 0;
    events.on('bunnyShed', (e) => e.source === 'space_station' && shed++);
    const r0 = b.radius;
    h.onContact!(run);
    expect(b.health).toBe(b.maxHealth - 1);
    expect(shed).toBe(1);
    expect(b.radius).toBeLessThan(r0);
    expect(b.rooted).toBe(0);
  });

  it('orbit lanes: no lane without an orbit route in reach; the copy of a route nearest the spawn on a wrap-around map', () => {
    const { run } = makeRun('orbit-lane');
    const house = run.house;
    const z = house.routes!.find((r) => r.kind === 'orbit')!.points[0]!.z;
    // Halfway between two lanes (≈ 25 units from each), out of a 10-unit reach.
    expect(orbitLane(house, 200, z + 25, 10, SPACE_STATION)).toBeNull();
    for (const x of [399, 3 * 400 + 5, -7]) {
      const lane = orbitLane(house, x, z + 3, 20, SPACE_STATION)!;
      expect(lane, String(x)).not.toBeNull();
      expect(lane.az).toBe(z);
      expect(lane.ax).toBeLessThan(x);
      expect(lane.bx).toBeGreaterThan(x);
      expect(lane.length).toBeCloseTo(SPACE_STATION.laneMax, 0);
    }
  });

  it('the Anti-Satellite Laser stays put, turns only its head, and its bolts hit without slowing', () => {
    const { run } = makeRun('asat');
    const p = moveToOpen(run);
    const b = run.bunny;
    const speed0 = b.stats.get('speed');
    const h = run.hazards.spawn('asat_laser', p.x, p.z - 6) as SprayBottle;
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
    expect(hazardRegistry.require('asat_laser').spawnZones).toEqual(['landmasses']);
  });

  it("the Re-entry Burn's fire trail burns mass off the Bunny (no slow)", () => {
    const { run, events } = makeRun('reentry');
    const p = moveToOpen(run);
    const b = run.bunny;
    b.setRadius(1.5);
    const speed0 = b.stats.get('speed');
    const h = run.hazards.spawn('reentry_burn', p.x + 10, p.z) as Mop;
    for (let i = 0; i < 60 * 4; i++) run.hazards.update(1 / 60, run);
    expect(h.puddles.length).toBeGreaterThan(3);
    const far = h.puddles.reduce((f, q) => (Math.hypot(q.x - h.x, q.z - h.z) > Math.hypot(f.x - h.x, f.z - h.z) ? q : f));
    expect(Math.hypot(far.x - h.x, far.z - h.z)).toBeGreaterThan(REENTRY_BURN.size + b.radius);
    let burns = 0;
    events.on('bunnyShed', (e) => e.source === 'reentry_burn' && burns++);
    const r0 = b.radius;
    b.invulnerable = 0;
    b.teleport(far.x, far.z);
    run.hazards.update(1 / 60, run);
    expect(burns).toBe(1);
    expect(b.radius).toBeLessThan(r0);
    expect(b.stats.get('speed')).toBe(speed0);
    // Not every frame: the next burn waits for the interval.
    run.hazards.update(1 / 60, run);
    expect(burns).toBe(1);
    expect(h.burns).toBe(1);
  });

  it("the Hurricane's wind cone pushes the Bunny away and soaks it, its spiral spinning; it forms over the oceans", () => {
    const { run } = makeRun('globe-hurricane');
    const p = moveToOpen(run);
    const b = run.bunny;
    const speed0 = b.stats.get('speed');
    const h = run.hazards.spawn('globe_hurricane', p.x + 6, p.z) as UprightVacuum;
    h.yaw = -Math.PI / 2;
    h.state = 'on';
    const spiral = h.model.getObjectByName('spiral')!;
    const spin0 = spiral.rotation.y;
    const d0 = Math.hypot(b.x - h.x, b.z - h.z);
    for (let i = 0; i < 20; i++) run.hazards.update(1 / 60, run);
    expect(Math.hypot(b.x - h.x, b.z - h.z)).toBeGreaterThan(d0 + 0.3);
    expect(b.stats.get('speed')).toBeLessThan(speed0);
    expect(spiral.rotation.y).not.toBe(spin0);
    expect(hazardRegistry.require('globe_hurricane').spawnZones).toContain('oceans');
  });
});

describe('globe Hazards across the east–west seam', () => {
  for (const bx of [399, 3 * 400 + 5]) {
    it(`spawn and run near the Bunny at x = ${bx} (every Globe Hazard, the boss and its swarm)`, () => {
      for (const id of [...GLOBE_HAZARDS, 'mini_sweeper', 'orbital_sweeper']) {
        const { run } = makeRun(`seam-${id}-${bx}`);
        const b = run.bunny;
        b.health = 999;
        b.setRadius(id === 'orbital_sweeper' ? 3.2 : 0.8);
        // On the orbit lane for the Space Station, mid-map otherwise.
        const z = run.house.spawn.z;
        b.teleport(bx, z);
        const h = run.hazards.spawn(id, bx + 7, z + 3);
        expect(h.dead, id).toBeFalsy();
        for (let i = 0; i < 60 * 6 && !run.ended; i++) {
          run.update(1 / 60);
          b.health = 999;
          b.teleport(bx, z);
        }
        expect(Number.isFinite(h.x) && Number.isFinite(h.z), id).toBe(true);
        // Still in the Bunny's lap, near it, inside the map's north–south bounds.
        expect(h.dead, id).toBeFalsy();
        expect(Math.abs(h.x - bx), id).toBeLessThan(60);
        expect(h.z, id).toBeGreaterThanOrEqual(run.house.bounds.minZ);
        expect(h.z, id).toBeLessThanOrEqual(run.house.bounds.maxZ);
        if (id === 'reentry_burn') {
          const m = h as Mop;
          for (const q of m.puddles) expect(Math.abs(q.x - bx), id).toBeLessThan(60);
        }
      }
    });
  }

  it('the Re-entry Burn patrols around its spawn in its lap (the zone rect moves with the lap)', () => {
    const { run } = makeRun('seam-mop');
    const x = 3 * 400 + 205;
    const z = run.house.spawn.z;
    expect(roomAt(run.house, x, z)).toBeTruthy();
    run.bunny.teleport(x - 20, z);
    const h = run.hazards.spawn('reentry_burn', x, z) as Mop;
    let maxD = 0;
    for (let i = 0; i < 60 * 10; i++) {
      run.hazards.update(1 / 60, run);
      maxD = Math.max(maxD, Math.abs(h.x - x));
    }
    expect(maxD).toBeLessThanOrEqual(REENTRY_BURN.patrolRange + 1);
    expect(canonicalX(run.house, h.x)).toBeGreaterThanOrEqual(0);
  });

  it('a Mop kept to its spawn zone patrols that zone in its own lap, not the canonical copy', () => {
    const { run } = makeRun('seam-zone-mop');
    const x = 3 * 400 + 205;
    const z = run.house.spawn.z;
    run.bunny.teleport(x - 20, z);
    const h = run.hazards.spawn('river_surge', x, z) as Mop;
    const waypoints = (h as unknown as { waypoints: Array<{ x: number; z: number }> }).waypoints;
    for (const w of waypoints) expect(Math.abs(w.x - x)).toBeLessThan(30);
  });
});

describe('the Orbital Sweeper', () => {
  /** An Orbital Sweeper in its hunt, `d` units west of a Tier 15 Bunny (facing it, +X). */
  function hunting(seed: string, d: number, opts: { keepMoons?: boolean } = {}) {
    const { run, events } = makeRun(seed);
    const p = moveToOpen(run);
    const b = run.bunny;
    b.health = 999;
    b.setRadius(3.2);
    if (!opts.keepMoons) clearMoons(run);
    const boss = run.hazards.spawn('orbital_sweeper', p.x - d, p.z) as OrbitalSweeper;
    boss.yaw = Math.PI / 2;
    boss.state = 'hunt';
    return { run, events, boss, b, p };
  }

  /** No Moon swings round on its own (the test places them). */
  const noMoonKeeping = (boss: OrbitalSweeper) => {
    const s = boss as unknown as { moonPlaced: boolean; moonTimer: number };
    s.moonPlaced = true;
    s.moonTimer = 1e9;
  };

  it("its net pulls a Bunny in front of it, but not one behind it", () => {
    const { run, boss, b, p } = hunting('net', 8);
    noMoonKeeping(boss);
    (boss as unknown as { timer: number }).timer = 99;
    const tip = boss.netTip;
    expect(tip.x).toBeGreaterThan(boss.x + 2);
    const x0 = b.x;
    for (let i = 0; i < 10; i++) {
      run.hazards.update(1 / 60, run);
      boss.yaw = Math.PI / 2;
    }
    expect(b.x).toBeLessThan(x0 - 0.05);
    // Behind it: no pull.
    b.teleport(boss.x - 6, p.z);
    const bx = b.x;
    for (let i = 0; i < 10; i++) {
      run.hazards.update(1 / 60, run);
      boss.yaw = Math.PI / 2;
    }
    expect(b.x).toBeCloseTo(bx, 5);
  });

  /** Holds the Bunny still until a charge ends; returns what happened. */
  function chargeAt(seed: string, opts: { bunny: (run: Run) => { x: number; z: number }; bossOffset: { x: number; z: number }; moon?: { dx: number; dz: number; size: number } }) {
    const { run, events } = makeRun(seed);
    const b = run.bunny;
    b.health = 999;
    b.setRadius(3.2);
    clearMoons(run);
    const spot = opts.bunny(run);
    b.teleport(spot.x, spot.z);
    let moon: Debris | null = null;
    if (opts.moon) moon = run.debris.spawn(moonIndex(run), spot.x + opts.moon.dx, spot.z + opts.moon.dz, run.rng, { size: opts.moon.size });
    const boss = run.hazards.spawn('orbital_sweeper', spot.x + opts.bossOffset.x, spot.z + opts.bossOffset.z) as OrbitalSweeper;
    noMoonKeeping(boss);
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
    return { run, boss, moon, stuns, charges, ended };
  }

  it('is stunned when a charge runs into a Moon the Bunny cannot absorb, and stops against it', () => {
    const { run, boss, moon, stuns } = chargeAt('moon-stun', {
      bunny: (r) => ({ x: r.house.spawn.x, z: r.house.spawn.z }),
      bossOffset: { x: -18, z: 0 },
      moon: { dx: -7, dz: 0, size: 2.8 },
    });
    expect(moon).toBeTruthy();
    expect(isBlockingMoon(run, moon!)).toBe(true);
    expect(stuns).toBe(1);
    expect(boss.state).toBe('stunned');
    expect(boss.moonStuns).toBe(1);
    // Against the Moon, not through it.
    expect(Math.hypot(boss.x - moon!.x, boss.z - moon!.z)).toBeGreaterThan(ORBITAL_SWEEPER.contactRadius + moon!.size * 0.85);
    expect(moon!.alive).toBe(true);
  });

  it('runs through a Moon the Bunny can already absorb, and the poles end a charge without a stun', () => {
    const small = chargeAt('moon-small', {
      bunny: (r) => ({ x: r.house.spawn.x, z: r.house.spawn.z }),
      bossOffset: { x: -18, z: 0 },
      moon: { dx: -7, dz: 0, size: 1.74 },
    });
    expect(isBlockingMoon(small.run, small.moon!)).toBe(false);
    expect(small.charges).toBe(1);
    expect(small.stuns).toBe(0);
    const pole = chargeAt('pole', {
      bunny: (r) => ({ x: r.house.spawn.x, z: r.house.bounds.maxZ - 3.5 }),
      bossOffset: { x: 0, z: -16 },
    });
    expect(pole.charges).toBe(1);
    expect(pole.ended).toBe(1);
    expect(pole.stuns).toBe(0);
  });

  it('brings a Moon the Bunny cannot absorb near the fight when it arrives (between them), and another once it is outgrown', () => {
    const { run, boss, b } = hunting('moon-keep', 16);
    expect(moons(run).length).toBe(0);
    run.hazards.update(1 / 60, run);
    expect(boss.moons).toBe(1);
    const m = moons(run)[0]!;
    expect(isBlockingMoon(run, m)).toBe(true);
    expect(m.size).toBeGreaterThanOrEqual(b.radius * ratio * ORBITAL_SWEEPER.moon.margin - 1e-9);
    // Between the Bunny and the Sweeper (west of the Bunny), clear of both.
    expect(m.x).toBeLessThan(b.x - b.radius);
    expect(m.x).toBeGreaterThan(boss.x);
    expect(Math.hypot(m.x - b.x, m.z - b.z)).toBeCloseTo(b.radius + ORBITAL_SWEEPER.moon.gap + m.size, 5);
    // One is enough.
    expect(boss.keepMoon(run)).toBe(false);
    // The Bunny outgrows it: the next one is bigger.
    b.setRadius(m.size / ratio + 0.1);
    expect(isBlockingMoon(run, m)).toBe(false);
    expect(boss.keepMoon(run)).toBe(true);
    const next = moons(run).find((d) => d !== m)!;
    expect(next.size).toBeGreaterThan(m.size);
    expect(blockingMoonAt(run, next.x, next.z, 0.1)).toBe(next);
  });

  it('works with whatever size the moon Debris has (a type bigger than the margin keeps its own size)', () => {
    const { run, boss } = hunting('moon-type-size', 16);
    const type = run.debris.types[moonIndex(run)]! as { size: number };
    const size0 = type.size;
    type.size = 9;
    try {
      expect(boss.keepMoon(run, true)).toBe(true);
      expect(moons(run)[0]!.size).toBe(9);
    } finally {
      type.size = size0;
    }
  });

  it('summons a Kessler swarm of mini sweepers (three at a time, up to six)', () => {
    const { run, boss, b } = hunting('kessler', 20);
    noMoonKeeping(boss);
    (boss as unknown as { timer: number }).timer = 999;
    for (let i = 0; i < 60 * ORBITAL_SWEEPER.summonInterval * 3; i++) {
      run.hazards.update(1 / 60, run);
      b.teleport(boss.x + 20, boss.z);
      for (const h of run.hazards.hazards) if (h.def.id === 'mini_sweeper') h.x = boss.x - 10;
    }
    const minis = run.hazards.hazards.filter((h) => !h.dead && h.def.id === 'mini_sweeper');
    expect(minis.length).toBe(ORBITAL_SWEEPER.maxMinis);
    expect(boss.minis.size).toBe(ORBITAL_SWEEPER.maxMinis);
  });

  it('its lasers lock a red lane on the Bunny, then the bolts hit and shed mass', () => {
    const { run, events, boss, b } = hunting('laser', 14);
    noMoonKeeping(boss);
    (boss as unknown as { timer: number }).timer = 999;
    let shed = 0;
    events.on('bunnyShed', (e) => e.source === 'orbital_sweeper' && shed++);
    let telegraphs = 0;
    events.on('hazardTelegraph', (e) => e.defId === 'orbital_sweeper' && e.attack === 'ash' && telegraphs++);
    const hp = b.health;
    for (let i = 0; i < 60 * 10 && b.health === hp; i++) {
      run.hazards.update(1 / 60, run);
      b.teleport(boss.x + 14, boss.z);
      b.invulnerable = 0;
    }
    expect(telegraphs).toBeGreaterThan(0);
    expect(b.health).toBeLessThan(hp);
    expect(shed).toBeGreaterThan(0);
  });

  it('absorbing the Orbital Sweeper clears the Globe and opens the escape trajectory (bossDefeated → exitOpened)', () => {
    const { run, events } = makeRun('sweeper-win');
    const p = moveToOpen(run);
    const b = run.bunny;
    const order: string[] = [];
    events.on('bossDefeated', (e) => order.push(`bossDefeated:${e.defId}`));
    events.on('exitOpened', (e) => order.push(`exitOpened:${e.area}`));
    events.on('victory', () => order.push('victory'));
    events.on('runEnded', (e) => order.push(`runEnded:${e.reason}`));
    b.setRadius(absorbRadiusFor(ORBITAL_SWEEPER.size, b.stats.get('absorbRatio')) + 0.05);
    const boss = run.hazards.spawn('orbital_sweeper', p.x + b.radius + 20, p.z) as OrbitalSweeper;
    boss.x = b.x + b.radius;
    boss.z = b.z;
    run.update(1 / 60);
    expect(order).toEqual(['bossDefeated:orbital_sweeper', 'exitOpened:globe']);
    expect(run.ended).toBe(false);
    expect(run.house.exit?.open).toBe(true);
    expect(run.isAreaCleared('globe')).toBe(true);
  });
});
