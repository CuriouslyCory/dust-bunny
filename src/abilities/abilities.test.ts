import { describe, expect, it } from 'vitest';
import { CompositeInput, NO_INPUT, type InputState } from '../core/input';
import { EventBus } from '../core/events';
import { DECOY, DISCHARGE, HUNKER } from '../data/abilities';
import { ROBOVAC_9000 } from '../data/hazards';
import { createRun } from '../game/assembly';
import type { Run } from '../game/run';
import { aimTarget, applySuction, hazardFloorFree } from '../hazards/common';
import type { RoboVac9000 } from '../hazards/robovac';
import { shedMass } from '../hazards/shed';
import type { SprayBottle } from '../hazards/sprayBottle';
import { maxSpeedFor } from '../systems/movement';
import { addAbilityParamsModifier, baseAbilityParams, getAbilitySystem, type DecoyAbility, type DischargeAbility, type HunkerAbility } from './index';

/** A Run with no spawning (only the Hazards a test places) and a scriptable input. */
function setup(characterId: string, seed = `abilities-${characterId}`) {
  const events = new EventBus();
  const run = createRun(events, { seed, characterId }, { hazards: false, pickups: false });
  const input: InputState = { moveX: 0, moveZ: 0, dash: false, ability: false, abilityHeld: false };
  run.input = {
    sample: () => {
      const s = { ...input };
      input.ability = false;
      input.dash = false;
      return s;
    },
  };
  moveToOpenFloor(run);
  const sys = getAbilitySystem(run)!;
  return { run, events, input, sys };
}

function moveToOpenFloor(run: Run): void {
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

const step = (run: Run, seconds: number) => {
  for (let t = 0; t < seconds - 1e-9; t += 1 / 60) run.update(1 / 60);
};

function collect<K extends string>(events: EventBus, name: K): unknown[] {
  const out: unknown[] = [];
  (events as unknown as { on(n: string, f: (e: unknown) => void): void }).on(name, (e) => out.push(e));
  return out;
}

describe('Ability input', () => {
  it('merges the Ability edge and hold across sources', () => {
    const c = new CompositeInput();
    c.add({ sample: () => ({ moveX: 1, moveZ: 0, dash: false }) });
    c.add({ sample: () => ({ moveX: 0, moveZ: 0, dash: false, ability: true, abilityHeld: true }) });
    expect(c.sample()).toMatchObject({ moveX: 1, ability: true, abilityHeld: true });
  });

  it('installs one Ability System per Run, and none with abilities: false', () => {
    const { run, sys } = setup('lint');
    expect(sys.data.id).toBe('decoy');
    const run2 = createRun(new EventBus(), { seed: 'x', characterId: 'zap' }, { hazards: false, pickups: false, abilities: false });
    expect(getAbilitySystem(run2)).toBeUndefined();
    expect(run.getSystem('ability')).toBe(sys);
  });
});

describe('Ability params', () => {
  it('start from src/data/abilities.ts and take registered modifiers', () => {
    const base = baseAbilityParams();
    expect(base.decoy.duration).toBe(DECOY.duration);
    expect(base.hunker.cooldownPerSecondHeld).toBe(HUNKER.cooldownPerSecondHeld);
    expect(base.discharge.range).toBe(DISCHARGE.range);
    const off = addAbilityParamsModifier((p, run) => {
      if (run.config.seed === 'long-strand') p.decoy.duration += 3;
    });
    try {
      expect(setup('lint', 'long-strand').sys.params.decoy.duration).toBe(DECOY.duration + 3);
      expect(setup('lint', 'other').sys.params.decoy.duration).toBe(DECOY.duration);
    } finally {
      off();
    }
  });
});

describe('Lint · Decoy', () => {
  it('sheds a still Decoy at no volume cost, lasts 4 s, then cools down 16 s', () => {
    const { run, input, sys, events } = setup('lint');
    const ctl = sys.controller as DecoyAbility;
    const used = collect(events, 'abilityUsed');
    const ended = collect(events, 'abilityEnded');
    const r0 = run.bunny.radius;
    input.ability = true;
    run.update(1 / 60);
    expect(ctl.decoy).not.toBeNull();
    expect(ctl.decoy!.radius).toBeCloseTo(DECOY.radius * r0);
    expect(run.bunny.radius).toBe(r0);
    expect(used).toHaveLength(1);
    step(run, DECOY.duration + 0.05);
    expect(ctl.decoy).toBeNull();
    expect(ended).toMatchObject([{ ability: 'decoy', reason: 'expired' }]);
    input.ability = true;
    run.update(1 / 60);
    expect(ctl.decoy).toBeNull();
    expect(sys.hud().ready).toBe(false);
    step(run, DECOY.cooldown);
    expect(sys.hud().ready).toBe(true);
    input.ability = true;
    run.update(1 / 60);
    expect(ctl.decoy).not.toBeNull();
  });

  it('lures aim while inside a Hazard range, not beyond it', () => {
    const { run, input } = setup('lint');
    const b = run.bunny;
    input.ability = true;
    run.update(1 / 60);
    const d = (getAbilitySystem(run)!.controller as DecoyAbility).decoy!;
    b.x += 400;
    const near = aimTarget(run, d.x + 50, d.z, 100);
    expect(near?.lure).toBe(true);
    const far = aimTarget(run, d.x - 300, d.z, 100);
    expect(far?.lure).toBe(false);
    expect(far?.x).toBe(b.x);
    b.hiddenFromHazards = true;
    expect(aimTarget(run, d.x - 300, d.z, 100)).toBeNull();
    expect(aimTarget(run, d.x + 50, d.z, 100)?.lure).toBe(true);
  });

  it('a Hazard that touches it clogs (stunned 1.5 s) and pops it', () => {
    const { run, input, sys, events } = setup('lint');
    const b = run.bunny;
    input.ability = true;
    run.update(1 / 60);
    b.teleport(b.x - 300, b.z);
    const d = (sys.controller as DecoyAbility).decoy!;
    const clogs = collect(events, 'hazardClogged');
    const h = run.hazards.spawn('roomba', d.x + d.radius + 5, d.z);
    run.update(1 / 60);
    expect((sys.controller as DecoyAbility).decoy).toBeNull();
    expect(clogs).toMatchObject([{ defId: 'roomba', boss: false, seconds: DECOY.clogStun }]);
    expect(h.stunnedFor).toBeGreaterThan(DECOY.clogStun - 0.1);
  });

  it('a ranged Hazard is never clogged, but its spray pops the Decoy', () => {
    const { run, input, sys, events } = setup('lint');
    const b = run.bunny;
    b.setRadius(10);
    input.ability = true;
    run.update(1 / 60);
    const d = (sys.controller as DecoyAbility).decoy!;
    b.teleport(b.x, b.z + 60);
    const ended = collect(events, 'abilityEnded');
    const spray = run.hazards.spawn('spray_bottle', d.x + 60, d.z) as SprayBottle;
    spray.yaw = -Math.PI / 2; // facing the Decoy
    step(run, 3.5);
    expect(spray.stunnedFor).toBe(0);
    expect(ended).toMatchObject([{ ability: 'decoy', reason: 'shot' }]);
  });

  it('clogs a boss (chippable while clogged), at most once per 6 s', () => {
    const { run, input, sys, events } = setup('lint');
    const b = run.bunny;
    b.setRadius(30);
    const hits = collect(events, 'bossHit');
    const boss = run.hazards.spawn('robovac_9000', b.x + 300, b.z) as RoboVac9000;
    input.ability = true;
    run.update(1 / 60);
    const d = (sys.controller as DecoyAbility).decoy!;
    b.teleport(b.x - 200, b.z);
    boss.x = d.x + d.radius + ROBOVAC_9000.contactRadius - 2;
    boss.z = d.z;
    run.update(1 / 60);
    expect(boss.state).toBe('stunned');
    expect(boss.stunCause).toBe('decoy');
    // Ram it while it is clogged: one chip.
    b.teleport(boss.x, boss.z + ROBOVAC_9000.contactRadius + b.radius - 4);
    run.update(1 / 60);
    expect(hits).toHaveLength(1);
    expect(sys.canStunBoss(boss)).toBe(false);
    run.time += 6;
    expect(sys.canStunBoss(boss)).toBe(true);
  });
});

describe('Tumble · Hunker', () => {
  it('plants while held: no movement, damage, shedding, knockback or suction', () => {
    const { run, input, sys } = setup('tumble');
    const b = run.bunny;
    input.ability = true;
    input.abilityHeld = true;
    input.moveX = 1;
    run.update(1 / 60);
    expect(b.hunkered).toBe(true);
    const [x0, z0, r0, hp] = [b.x, b.z, b.radius, b.health];
    step(run, 0.5);
    expect([b.x, b.z]).toEqual([x0, z0]);
    expect(b.damage(1, 'test')).toBe(false);
    expect(b.health).toBe(hp);
    shedMass(run, sys.rng, 0.3, 'test');
    expect(b.radius).toBe(r0);
    b.knockback(1, 0, 50);
    expect(b.impulseX).toBe(0);
    expect(applySuction(run, b.x + 50, b.z, 1, 1, 1 / 60)).toBe(0);
    input.abilityHeld = false;
    run.update(1 / 60);
    expect(b.hunkered).toBe(false);
    const ctl = sys.controller as HunkerAbility;
    expect(ctl.cooldownTotal).toBeCloseTo(HUNKER.cooldownBase + HUNKER.cooldownPerSecondHeld * ctl.held, 5);
  });

  it('auto-releases at the max hold with the long cooldown, and cannot start while stuck', () => {
    const { run, input, sys, events } = setup('tumble');
    const ended = collect(events, 'abilityEnded');
    input.ability = true;
    input.abilityHeld = true;
    step(run, HUNKER.maxHold + 0.1);
    expect(run.bunny.hunkered).toBe(false);
    expect(ended).toMatchObject([{ reason: 'maxHold' }]);
    expect((sys.controller as HunkerAbility).cooldownTotal).toBeCloseTo(HUNKER.cooldownBase + HUNKER.maxHold * HUNKER.cooldownPerSecondHeld, 1);
    step(run, 15);
    run.bunny.rooted = 1;
    input.ability = true;
    run.update(1 / 60);
    expect(run.bunny.hunkered).toBe(false);
  });

  it('a charging boss crashes into a planted Tumble: stunned, chipped at once, then bounces within 6 s', () => {
    const { run, input, sys, events } = setup('tumble');
    const b = run.bunny;
    b.setRadius(30);
    const hits = collect(events, 'bossHit');
    const planted = collect(events, 'hazardHitPlanted');
    input.ability = true;
    input.abilityHeld = true;
    run.update(1 / 60);
    const boss = run.hazards.spawn('robovac_9000', b.x + ROBOVAC_9000.contactRadius + b.radius - 3, b.z) as RoboVac9000;
    boss.state = 'charge';
    const [bx, bz] = [b.x, b.z];
    run.update(1 / 60);
    expect(boss.stunCause).toBe('hunker');
    expect(hits).toHaveLength(1);
    expect(planted).toMatchObject([{ boss: true, stunned: true }]);
    expect([b.x, b.z]).toEqual([bx, bz]);
    // Later crash inside the 6 s limit: no stun, it bounces off.
    step(run, 2);
    boss.state = 'charge';
    boss.x = b.x + ROBOVAC_9000.contactRadius * boss.scale + b.radius - 3;
    boss.z = b.z;
    run.update(1 / 60);
    expect(boss.state).toBe('recover');
    expect(hits).toHaveLength(1);
    expect(sys.canStunBoss(boss)).toBe(false);
  });

  it('other Hazards recoil off a planted Tumble without hurting it', () => {
    const { run, input } = setup('tumble');
    const b = run.bunny;
    b.setRadius(5);
    input.ability = true;
    input.abilityHeld = true;
    run.update(1 / 60);
    const h = run.hazards.spawn('roomba', b.x + b.radius + 9, b.z);
    run.update(1 / 60);
    expect(b.health).toBe(b.maxHealth);
    expect((h as unknown as { recoilFor: number }).recoilFor).toBeGreaterThan(0);
  });
});

describe('Zap · Discharge', () => {
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

  it('fills from fast rolling (40 r), twice as fast while dashing, and drains when slow', () => {
    const { run, sys } = setup('zap');
    const ctl = sys.controller as DischargeAbility;
    const b = run.bunny;
    const perSec = maxSpeedFor(b) / b.radius;
    roll(run, ctl, 1, (DISCHARGE.fillDistance / perSec) * 0.5);
    expect(ctl.charge).toBeCloseTo(0.5, 1);
    roll(run, ctl, 0.4, 2); // between drain and fill thresholds: no change
    expect(ctl.charge).toBeCloseTo(0.5, 1);
    roll(run, ctl, 0, 2);
    expect(ctl.charge).toBeCloseTo(0.3, 1);
    roll(run, ctl, 1, (DISCHARGE.fillDistance / perSec) * 0.35 / DISCHARGE.dashMultiplier, true);
    expect(ctl.charge).toBeCloseTo(0.65, 1);
    expect(b.staticCharge).toBe(ctl.charge);
  });

  it('when full, shorts out the nearest Hazard in range into 4 scrap pieces', () => {
    const { run, input, sys, events } = setup('zap');
    const ctl = sys.controller as DischargeAbility;
    const b = run.bunny;
    b.setRadius(6);
    const shorted = collect(events, 'hazardShorted');
    const far = run.hazards.spawn('roomba', b.x + b.radius + DISCHARGE.range * b.radius + 40, b.z);
    const near = run.hazards.spawn('roomba', b.x - b.radius - 15, b.z);
    // Rolling keeps the meter full (it drains below 20% speed).
    const go = () => {
      b.vx = maxSpeedFor(b);
      run.update(1 / 60);
    };
    ctl.charge = 1;
    go();
    expect(ctl.target).toBe(near);
    const debris0 = run.debris.count;
    input.ability = true;
    go();
    expect(near.dead || !run.hazards.hazards.includes(near)).toBe(true);
    expect(far.dead).toBeFalsy();
    expect(shorted).toMatchObject([{ boss: false }]);
    expect(run.debris.count - debris0).toBe(DISCHARGE.scrapPieces);
    expect(ctl.charge).toBe(0);
  });

  it('stuns a boss without chipping it, then Grounds it for 10 s', () => {
    const { run, input, sys, events } = setup('zap');
    const ctl = sys.controller as DischargeAbility;
    const b = run.bunny;
    b.setRadius(20);
    const hits = collect(events, 'bossHit');
    const boss = run.hazards.spawn('robovac_9000', b.x + b.radius + ROBOVAC_9000.contactRadius + 30, b.z) as RoboVac9000;
    const size0 = boss.size;
    ctl.charge = 1;
    input.ability = true;
    b.vx = maxSpeedFor(b);
    run.update(1 / 60);
    expect(boss.state).toBe('stunned');
    expect(boss.stunCause).toBe('discharge');
    expect(boss.size).toBe(size0);
    expect(hits).toHaveLength(0);
    expect(boss.groundedFor).toBeGreaterThan(DISCHARGE.groundedFor - 0.1);
    ctl.charge = 1;
    run.time += 7; // past the 6 s limit, still Grounded
    expect(ctl.findTarget()).toBeNull();
  });

  it('Spiky Dash stuns do not count toward the boss limit', () => {
    const { run, sys } = setup('zap');
    const b = run.bunny;
    b.setRadius(20);
    const boss = run.hazards.spawn('robovac_9000', b.x + 300, b.z) as RoboVac9000;
    boss.stunnedFor = 2.5;
    boss.stun(2.5);
    expect(boss.stunCause).toBe('spiky');
    expect(sys.canStunBoss(boss)).toBe(true);
  });
});
