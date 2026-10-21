/**
 * Gameplay integration: Runs built by the shared assembly (as the browser and the balance bot
 * build them) and driven through Run.update. Keep this file free of other content registration so
 * the first test exercises the assembly as the first gameplay entry point.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/events';
import { NO_INPUT } from '../core/input';
import { getDifficulty } from '../data/difficulty';
import { DIRECTOR } from '../data/hazards';
import { PICKUP_SPAWN } from '../data/pickups';
import { PERK_EFFECTS } from '../data/perks';
import { hazardFloorFree } from '../hazards/common';
import { upgradeModifiers } from '../meta/upgrades';
import { COMBAT_SYSTEM_ID } from '../perks/combat';
import { createRun, getHazardDirector, installGameplay } from './assembly';
import type { Run, RunConfig } from './run';

const DT = 1 / 60;
const config = (over: Partial<RunConfig> = {}): RunConfig => ({ seed: 'assembly', characterId: 'lint', ...over });

const step = (run: Run, seconds: number, until?: () => boolean) => {
  for (let i = 0; i < Math.round(seconds / DT) && !run.ended && !until?.(); i++) run.update(DT);
};

/** Moves the Bunny to open floor (not under furniture) so Hazards can reach it. */
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
 * Hazard and Pickup spawns plus where the Bunny ends up, for comparing seeded Runs. `midway` runs
 * halfway through.
 */
function record(run: Run, seconds: number, midway?: () => void): string[] {
  const log: string[] = [];
  run.events.on('hazardSpawned', (e) => log.push(`${run.time.toFixed(2)} hazard ${e.defId}`));
  run.events.on('pickupSpawned', (e) => log.push(`${run.time.toFixed(2)} pickup ${e.defId}`));
  run.bunny.health = 999;
  run.input = { sample: () => ({ moveX: Math.sin(run.time), moveZ: Math.cos(run.time * 0.7), dash: false }) };
  step(run, seconds / 2);
  midway?.();
  step(run, seconds / 2);
  log.push(`bunny ${run.bunny.x.toFixed(3)},${run.bunny.z.toFixed(3)} r=${run.bunny.radius.toFixed(3)}`);
  return log;
}

describe('Run assembly', () => {
  it('registers content before configured starting Perks apply, as the first gameplay entry point', () => {
    const run = createRun(new EventBus(), config({ perks: ['spiky_dash', 'second_wind'] }));
    expect(run.perkStacks('spiky_dash')).toBe(1);
    expect(run.bunny.spikyDash).toBe(true);
    expect(run.bunny.revives).toBe(1);
  });

  it('imports and runs in plain Node (no DOM, CSS loading or WebGL)', () => {
    const assembly = fileURLToPath(new URL('./assembly.ts', import.meta.url));
    const script = `
      if (typeof document !== 'undefined' || typeof window !== 'undefined') throw new Error('DOM present');
      const { createRun, getHazardDirector } = await import(${JSON.stringify(assembly)});
      const { EventBus } = await import(${JSON.stringify(fileURLToPath(new URL('../core/events.ts', import.meta.url)))});
      const events = new EventBus();
      let hazards = 0, pickups = 0;
      events.on('hazardSpawned', () => hazards++);
      events.on('pickupSpawned', () => pickups++);
      const run = createRun(events, { seed: 'node', characterId: 'zap', perks: ['regrowth'] });
      run.bunny.health = 999;
      for (let i = 0; i < 60 * 30; i++) run.update(1 / 60);
      console.log(JSON.stringify({ hazards, pickups, director: !!getHazardDirector(run) }));
    `;
    const out = execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], { encoding: 'utf8' });
    const result = JSON.parse(out.trim().split('\n').at(-1)!) as { hazards: number; pickups: number; director: boolean };
    expect(result.director).toBe(true);
    expect(result.hazards).toBeGreaterThan(0);
    expect(result.pickups).toBeGreaterThan(0);
  }, 30_000);

  it('Spiky Dash contact stuns a Hazard without damage; the stun counts down and the Hazard resumes', () => {
    const events = new EventBus();
    const run = createRun(events, config({ seed: 'assembly-spiky', perks: ['spiky_dash'] }));
    moveToOpenFloor(run);
    const b = run.bunny;
    const roomba = run.hazards.spawn('roomba', b.x + b.radius + 6, b.z)!;
    expect(roomba.size).toBeGreaterThan(b.radius * b.stats.get('absorbRatio')); // contact, not absorb
    const stunned: number[] = [];
    let damaged = 0;
    events.on('hazardStunned', (e) => stunned.push(e.hazardId));
    events.on('bunnyDamaged', () => damaged++);

    run.input = { sample: () => ({ moveX: 1, moveZ: 0, dash: true }) };
    step(run, 0.5, () => stunned.length > 0);
    expect(stunned).toEqual([roomba.id]);
    expect(damaged).toBe(0);
    expect(b.health).toBe(b.maxHealth);
    expect(roomba.stunnedFor).toBeGreaterThan(PERK_EFFECTS.spikyStun - 0.1);

    // Out of reach so the Hazard is free to move once the stun wears off.
    run.input = { sample: () => NO_INPUT };
    b.teleport(b.x - 120, b.z);
    b.invulnerable = 99;
    const at = { x: roomba.x, z: roomba.z };
    step(run, PERK_EFFECTS.spikyStun - 0.5);
    expect(roomba.stunnedFor).toBeGreaterThan(0);
    expect(roomba.stunnedFor).toBeLessThan(0.6);
    expect({ x: roomba.x, z: roomba.z }).toEqual(at);

    step(run, 1.5);
    expect(roomba.stunnedFor).toBe(0);
    expect(Math.hypot(roomba.x - at.x, roomba.z - at.z)).toBeGreaterThan(1);
    expect(roomba.dead).toBe(false);
  });

  it('spawns floor Pickups the Bunny can collect', () => {
    const events = new EventBus();
    const run = createRun(events, config({ seed: 'assembly-pickups' }));
    const collected: string[] = [];
    events.on('pickupCollected', (e) => collected.push(e.defId));
    expect(run.pickups.floor).toHaveLength(0);
    step(run, PICKUP_SPAWN.firstDelay - 0.5);
    expect(run.pickups.floor).toHaveLength(0);
    step(run, 20, () => run.pickups.floor.length > 0);
    const p = run.pickups.floor[0]!;
    const bd = run.house.bounds;
    expect(p.x).toBeGreaterThan(bd.minX);
    expect(p.x).toBeLessThan(bd.maxX);
    expect(p.z).toBeGreaterThan(bd.minZ);
    expect(p.z).toBeLessThan(bd.maxZ);

    run.bunny.teleport(p.x, p.z);
    run.update(DT);
    expect(collected).toEqual([p.def.id]);
    expect(run.pickups.floor).not.toContain(p);
  });

  it('spawns Hazards after the grace period', () => {
    const events = new EventBus();
    const run = createRun(events, config({ seed: 'assembly-hazards' }));
    const spawned: number[] = [];
    events.on('hazardSpawned', () => spawned.push(run.time));
    run.bunny.health = 999;
    step(run, 40);
    expect(spawned.length).toBeGreaterThan(0);
    expect(spawned[0]).toBeGreaterThanOrEqual(DIRECTOR.graceSeconds * run.difficulty.graceSeconds);
  });

  it('repeated installation adds nothing and keeps director state', () => {
    const run = createRun(new EventBus(), config({ seed: 'assembly-twice' }));
    const director = getHazardDirector(run);
    const hazardDirector = run.hazards.director;
    const pickupDirector = run.pickups.director;
    const filters = [...run.bunny.damageFilters];
    step(run, 20);
    installGameplay(run);
    installGameplay(run);
    expect(getHazardDirector(run)).toBe(director);
    expect(run.hazards.director).toBe(hazardDirector);
    expect(run.pickups.director).toBe(pickupDirector);
    expect(run.bunny.damageFilters).toEqual(filters);
    // One of each System: removing it once leaves none behind.
    for (const id of [COMBAT_SYSTEM_ID, 'hazardFx']) {
      run.removeSystem(id);
      expect(run.getSystem(id)).toBeUndefined();
    }

    // Same seed, same spawns: reinstalling mid-Run did not restart the director or Pickup timers.
    const once = record(createRun(new EventBus(), config({ seed: 'assembly-twice' })), 60);
    const b = createRun(new EventBus(), config({ seed: 'assembly-twice' }));
    const reinstalled = record(b, 60, () => installGameplay(b));
    expect(once.some((l) => l.includes('hazard'))).toBe(true);
    expect(reinstalled).toEqual(once);
  });

  it('is seeded: the same config plays out the same', () => {
    const cfg = config({ seed: 'assembly-seeded', characterId: 'tumble', difficulty: 'arcade' });
    const a = record(createRun(new EventBus(), cfg), 45);
    const b = record(createRun(new EventBus(), cfg), 45);
    expect(a.some((l) => l.includes('hazard'))).toBe(true);
    expect(a.some((l) => l.includes('pickup'))).toBe(true);
    expect(b).toEqual(a);
    expect(record(createRun(new EventBus(), { ...cfg, seed: 'assembly-other' }), 45)).not.toEqual(a);
  });

  it('keeps Character stats, Upgrades, Perks, Difficulty and Area starts', () => {
    const base = createRun(new EventBus(), config({ characterId: 'zap' }));
    const run = createRun(
      new EventBus(),
      config({ characterId: 'zap', difficulty: 'hardcore', modifiers: upgradeModifiers({ fast_feet: 2 }), perks: ['aerodynamic'], area: 'neighborhood' }),
    );
    expect(run.bunny.stats.get('suctionMultiplier')).toBe(1.5); // Zap
    expect(run.bunny.stats.get('speed')).toBeGreaterThan(base.bunny.stats.get('speed'));
    expect(run.bunny.stats.modifiers().some((m) => m.source === 'upgrade:fast_feet')).toBe(true);
    expect(run.perkStacks('aerodynamic')).toBe(1);
    expect(run.difficulty).toBe(getDifficulty('hardcore'));
    expect(run.bunny.maxHealth).toBe(base.bunny.maxHealth - 1);
    expect(run.area).toBe('neighborhood');

    const spawned: string[] = [];
    run.events.on('hazardSpawned', (e) => spawned.push(e.defId));
    run.bunny.health = 999;
    step(run, 40);
    expect(spawned.length).toBeGreaterThan(0);
    expect(spawned).not.toContain('roomba');
  });

  it('optional rules stay off: no Hazards or Pickups spawn on their own', () => {
    const events = new EventBus();
    const run = createRun(events, config({ seed: 'assembly-growth' }), { hazards: false, pickups: false });
    let spawns = 0;
    events.on('hazardSpawned', () => spawns++);
    events.on('pickupSpawned', () => spawns++);
    step(run, 60);
    expect(spawns).toBe(0);
    expect(getHazardDirector(run)).toBeUndefined();
    expect(run.getSystem('hazardFx')).toBeUndefined();
    // Combat hooks are core rules: a manually spawned Hazard can still be Spiky-Dash stunned.
    expect(run.getSystem(COMBAT_SYSTEM_ID)).toBeDefined();
  });
});
