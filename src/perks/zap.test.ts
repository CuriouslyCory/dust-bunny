import { describe, expect, it } from 'vitest';
import { getAbilitySystem, type DischargeAbility } from '../abilities';
import { EventBus } from '../core/events';
import { NO_INPUT, type InputState } from '../core/input';
import { DISCHARGE } from '../data/abilities';
import { ROBOVAC_9000 } from '../data/hazards';
import { CHARACTER_PERK_EFFECTS as FX } from '../data/perks';
import { TUNING } from '../data/tuning';
import { createRun } from '../game/assembly';
import type { Run } from '../game/run';
import { parseRunSnapshot } from '../game/snapshot';
import { hazardFloorFree } from '../hazards/common';
import type { RoboVac9000 } from '../hazards/robovac';
import { maxSpeedFor } from '../systems/movement';
import { getZapPerks, installZapPerks } from './zap';

/** A Zap Run with no spawning (only the Hazards a test places) and a scriptable input. */
function setup(perks: string[] = [], seed = 'zap-perks') {
  const events = new EventBus();
  const run = createRun(events, { seed, characterId: 'zap', perks }, { hazards: false, pickups: false });
  const input: InputState = { moveX: 0, moveZ: 0, dash: false, ability: false, abilityHeld: false };
  run.input = {
    sample: () => {
      const s = { ...input };
      input.ability = false;
      input.dash = false;
      return s;
    },
  };
  toOpenFloor(run);
  const ctl = getAbilitySystem(run)!.controller as DischargeAbility;
  return { run, events, input, ctl };
}

function toOpenFloor(run: Run): void {
  const bd = run.house.bounds;
  for (const clear of [140, 110, 90]) {
    for (let x = bd.minX + 120; x < bd.maxX - 120; x += 20) {
      for (let z = bd.minZ + 120; z < bd.maxZ - 120; z += 20) {
        if (hazardFloorFree(run.house, x, z, clear, 500)) {
          run.bunny.teleport(x, z);
          run.debris.clear();
          return;
        }
      }
    }
  }
  throw new Error('no open floor');
}

function collect(events: EventBus, name: string): unknown[] {
  const out: unknown[] = [];
  (events as unknown as { on(n: string, f: (e: unknown) => void): void }).on(name, (e) => out.push(e));
  return out;
}

/** Rolls the Bunny at `fraction` of max speed for `seconds` (velocity forced, position frozen). */
function roll(run: Run, ctl: DischargeAbility, fraction: number, seconds: number, dashing = false) {
  const b = run.bunny;
  for (let t = 0; t < seconds - 1e-9; t += 1 / 60) {
    b.vx = maxSpeedFor(b) * fraction;
    b.vz = 0;
    b.dashTime = dashing ? 1 : 0;
    ctl.update(1 / 60, NO_INPUT);
  }
}

/** One Run tick with Zap held at full speed (so the meter neither drains nor stops the test). */
function tick(run: Run) {
  run.bunny.vx = maxSpeedFor(run.bunny);
  run.bunny.vz = 0;
  run.update(1 / 60);
}

describe('Zap · Emergency Discharge', () => {
  it('spends a full meter to negate a hit and stuns Hazards within reach of Zap’s surface', () => {
    const { run, events, ctl } = setup(['emergency_discharge']);
    const b = run.bunny;
    b.setRadius(6);
    const fired = collect(events, 'emergencyDischarge');
    const near = run.hazards.spawn('roomba', b.x + b.radius + 1.5 * b.radius, b.z);
    const far = run.hazards.spawn('roomba', b.x - b.radius - 2.5 * b.radius - 30, b.z);
    ctl.charge = 1;
    const health = b.health;
    expect(b.damage(1, 'test')).toBe(false);
    expect(b.health).toBe(health);
    expect(ctl.charge).toBe(0);
    expect(b.invulnerable).toBeGreaterThanOrEqual(TUNING.invulnerability);
    expect(near.stunnedFor).toBe(FX.emergencyStun);
    expect(far.stunnedFor ?? 0).toBe(0);
    expect(fired).toMatchObject([{ stunned: 1 }]);
  });

  it('needs a full meter, then waits out its cooldown (6 / 5 / 4 s by stacks)', () => {
    const { run, ctl } = setup(['emergency_discharge', 'emergency_discharge']);
    const b = run.bunny;
    ctl.charge = 0.99;
    expect(b.damage(1, 'test')).toBe(true);
    b.invulnerable = 0;
    b.health = b.maxHealth;
    ctl.charge = 1;
    expect(b.damage(1, 'test')).toBe(false);
    b.invulnerable = 0;
    ctl.charge = 1;
    run.time += FX.emergencyCooldown[1] - 0.1;
    expect(b.damage(1, 'test')).toBe(true); // still cooling down
    b.invulnerable = 0;
    run.time += 0.2;
    ctl.charge = 1;
    expect(b.damage(1, 'test')).toBe(false);
  });

  it('also blocks a lethal hit', () => {
    const { run, ctl } = setup(['emergency_discharge']);
    const b = run.bunny;
    b.health = 1;
    ctl.charge = 1;
    expect(b.damage(5, 'test')).toBe(false);
    expect(b.alive).toBe(true);
  });

  it('gives bosses half the stun, within the shared 6 s limit', () => {
    const { run, ctl } = setup(['emergency_discharge', 'emergency_discharge', 'emergency_discharge']);
    const b = run.bunny;
    b.setRadius(20);
    const boss = run.hazards.spawn('robovac_9000', b.x + b.radius + ROBOVAC_9000.contactRadius + 30, b.z) as RoboVac9000;
    const sys = getAbilitySystem(run)!;
    ctl.charge = 1;
    expect(b.damage(1, 'test')).toBe(false);
    expect(boss.state).toBe('stunned');
    expect(sys.canStunBoss(boss)).toBe(false);
  });

  it('does nothing without the Perk', () => {
    const { run, ctl } = setup();
    ctl.charge = 1;
    expect(run.bunny.damage(1, 'test')).toBe(true);
    expect(ctl.charge).toBe(1);
  });
});

describe('Zap · Hyper Charge', () => {
  it('dashing fills the meter 3× / 4× / 5×', () => {
    const { run, ctl } = setup(['hyper_charge']);
    const sys = getAbilitySystem(run)!;
    expect(sys.params.discharge.dashMultiplier).toBe(3);
    run.applyPerk('hyper_charge');
    expect(sys.params.discharge.dashMultiplier).toBe(4);
    run.applyPerk('hyper_charge');
    expect(sys.params.discharge.dashMultiplier).toBe(5);
    const b = run.bunny;
    const perSec = maxSpeedFor(b) / b.radius;
    roll(run, ctl, 1, ((DISCHARGE.fillDistance / perSec) * 0.5) / 5, true);
    expect(ctl.charge).toBeCloseTo(0.5, 1);
  });
});

describe('Zap · Capacitor', () => {
  it('holds the meter for 2 / 3 / 4 s below 20% speed before draining', () => {
    const { run, ctl } = setup(['capacitor']);
    ctl.charge = 0.5;
    roll(run, ctl, 0, 1.9);
    expect(ctl.charge).toBe(0.5);
    roll(run, ctl, 0, 1.1);
    expect(ctl.charge).toBeCloseTo(0.5 - DISCHARGE.drainPerSec * 1, 1);
    // Speeding up resets the wait.
    const held = ctl.charge;
    roll(run, ctl, 0.3, 0.5);
    roll(run, ctl, 0, 1.5);
    expect(ctl.charge).toBe(held);
    run.applyPerk('capacitor');
    run.applyPerk('capacitor');
    roll(run, ctl, 0, 2);
    expect(ctl.charge).toBe(held);
    roll(run, ctl, 0, 0.6);
    expect(ctl.charge).toBeLessThan(held);
  });
});

describe('Zap · Thunderstruck', () => {
  it('a Discharge kill leaves a 3 s patch that stuns each entering non-boss Hazard once', () => {
    const { run, events, input, ctl } = setup(['thunderstruck']);
    const b = run.bunny;
    b.setRadius(6);
    const stuns = collect(events, 'staticPatchStunned');
    const target = run.hazards.spawn('roomba', b.x + b.radius + 15, b.z);
    const bystander = run.hazards.spawn('roomba', target.x + 200, target.z);
    ctl.charge = 1;
    input.ability = true;
    tick(run);
    expect(target.dead || !run.hazards.hazards.includes(target)).toBe(true);
    const zap = getZapPerks(run)!;
    expect(zap.patches).toHaveLength(1);
    expect(zap.patches[0]!.radius).toBeCloseTo(FX.thunderstruckRadius[0] * b.radius, 5);
    expect(stuns).toHaveLength(0);
    // Walks into the patch: stunned once, not again while inside.
    const patch = zap.patches[0]!;
    bystander.x = patch.x + patch.radius * 0.5;
    bystander.z = patch.z;
    tick(run);
    expect(stuns).toHaveLength(1);
    expect(bystander.stunnedFor).toBeGreaterThan(0);
    run.hazards.status.clear(bystander);
    bystander.x = patch.x;
    bystander.z = patch.z;
    tick(run);
    expect(stuns).toHaveLength(1);
    // Bosses are never affected.
    b.setRadius(20);
    b.invulnerable = 100;
    const boss = run.hazards.spawn('robovac_9000', patch.x, patch.z) as RoboVac9000;
    tick(run);
    expect(boss.stunnedFor ?? 0).toBe(0);
    expect(stuns).toHaveLength(1);
    for (let t = 0; t < FX.thunderstruckDuration; t += 1 / 60) tick(run);
    expect(run.ended).toBe(false);
    expect(zap.patches).toHaveLength(0);
  });

  it('each Arc kill leaves its own patch; a Hazard can be stunned once by each', () => {
    const { run, events, ctl } = setup(['thunderstruck', 'thunderstruck', 'thunderstruck']);
    const b = run.bunny;
    b.setRadius(6);
    const sys = getAbilitySystem(run)!;
    const zap = getZapPerks(run)!;
    const stuns = collect(events, 'staticPatchStunned');
    const first = run.hazards.spawn('roomba', b.x + b.radius + 15, b.z);
    const second = run.hazards.spawn('roomba', first.x + 40, first.z);
    sys.params.discharge.extraTargets = 1;
    ctl.charge = 1;
    ctl.fire(first);
    expect(second.dead).toBe(true);
    expect(zap.patches).toHaveLength(2);
    const walker = run.hazards.spawn('roomba', (first.x + second.x) / 2, first.z);
    tick(run);
    expect(stuns.filter((e) => (e as { hazardId: number }).hazardId === walker.id)).toHaveLength(2);
  });
});

describe('Zap · Recharge Snack', () => {
  it('absorbing Discharge scrap refunds the meter per piece, up to 50% per Discharge', () => {
    const { run, events, ctl } = setup(['recharge_snack', 'recharge_snack', 'recharge_snack']);
    const b = run.bunny;
    b.setRadius(6);
    const refunds = collect(events, 'rechargeSnack');
    const sys = getAbilitySystem(run)!;
    sys.params.discharge.extraTargets = 3;
    sys.params.discharge.scrapPieces = 4;
    const first = run.hazards.spawn('roomba', b.x + b.radius + 15, b.z);
    for (let i = 1; i <= 3; i++) run.hazards.spawn('roomba', first.x + 30 * i, first.z + 20);
    ctl.charge = 1;
    ctl.fire(first);
    const zap = getZapPerks(run)!;
    const scrap = [...zap.scrap.keys()];
    expect(scrap.length).toBeGreaterThan(5);
    const unrelated = run.debris.spawn(0, b.x + 100, b.z, run.rng);
    run.absorbDebris(unrelated!);
    expect(ctl.charge).toBe(0);
    run.absorbDebris(scrap[0]!);
    expect(ctl.charge).toBeCloseTo(FX.rechargeSnackRefund[2], 6);
    for (const d of scrap.slice(1)) run.absorbDebris(d);
    expect(ctl.charge).toBeCloseTo(FX.rechargeSnackCap, 6);
    expect(refunds.length).toBe(5);
  });

  it('a refund that fills the meter makes it full (staticFull)', () => {
    const { run, events, ctl } = setup(['recharge_snack']);
    const b = run.bunny;
    b.setRadius(6);
    const full = collect(events, 'staticFull');
    const target = run.hazards.spawn('roomba', b.x + b.radius + 15, b.z);
    ctl.charge = 1;
    ctl.fire(target);
    const scrap = [...getZapPerks(run)!.scrap.keys()];
    ctl.charge = 0.98;
    run.absorbDebris(scrap[0]!);
    expect(ctl.charge).toBe(1);
    tick(run);
    expect(full).toHaveLength(1);
  });

  it('forgets scrap on Area change', () => {
    const { run, ctl } = setup(['recharge_snack']);
    const b = run.bunny;
    b.setRadius(6);
    const target = run.hazards.spawn('roomba', b.x + b.radius + 15, b.z);
    ctl.charge = 1;
    ctl.fire(target);
    const zap = getZapPerks(run)!;
    expect(zap.scrap.size).toBeGreaterThan(0);
    run.enterArea('neighborhood');
    run.update(1 / 60);
    expect(zap.scrap.size).toBe(0);
  });
});

describe('Zap Perks install and Resume', () => {
  it('installs once', () => {
    const { run } = setup(['emergency_discharge']);
    const zap = getZapPerks(run);
    installZapPerks(run);
    expect(getZapPerks(run)).toBe(zap);
    expect(run['systems'].filter((s: { id: string }) => s.id === 'zap-perks')).toHaveLength(1);
  });

  it('keeps every Perk working after Save & quit', () => {
    const perks = ['emergency_discharge', 'hyper_charge', 'hyper_charge', 'thunderstruck', 'recharge_snack', 'capacitor'];
    const { run } = setup(perks);
    run.update(1 / 60);
    const snap = parseRunSnapshot(JSON.parse(JSON.stringify(run.toSnapshot())))!;
    const back = createRun(new EventBus(), { seed: snap.seed, characterId: snap.characterId, difficulty: snap.difficulty, resume: snap }, { hazards: false, pickups: false });
    for (const id of new Set(perks)) expect(back.perkStacks(id)).toBe(run.perkStacks(id));
    const sys = getAbilitySystem(back)!;
    expect(sys.params.discharge.dashMultiplier).toBe(FX.hyperChargeDash[1]);
    expect(sys.params.discharge.drainDelay).toBe(FX.capacitorDelay[0]);
    const ctl = sys.controller as DischargeAbility;
    ctl.charge = 1;
    expect(back.bunny.damage(1, 'test')).toBe(false);
    expect(ctl.charge).toBe(0);
  });
});
