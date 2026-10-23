import { describe, expect, it } from 'vitest';
import { CompositeInput, NO_INPUT, type InputState } from '../core/input';
import { EventBus } from '../core/events';
import { AMASS, DECOY, DISCHARGE } from '../data/abilities';
import { ROBOVAC_9000 } from '../data/hazards';
import { createRun } from '../game/assembly';
import type { Run } from '../game/run';
import { aimTarget, hazardFloorFree } from '../hazards/common';
import type { RoboVac9000 } from '../hazards/robovac';
import type { SprayBottle } from '../hazards/sprayBottle';
import { maxSpeedFor } from '../systems/movement';
import { Rng } from '../core/rng';
import { addAbilityParamsModifier, baseAbilityParams, getAbilitySystem, type AmassAbility, type DecoyAbility, type DischargeAbility } from './index';

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
    expect(base.amass.cooldownPerSecondHeld).toBe(AMASS.cooldownPerSecondHeld);
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

describe('Tumble · Amass', () => {
  /** Starts an Amass (held) this tick. */
  function amass(run: Run, input: InputState) {
    input.ability = true;
    input.abilityHeld = true;
    run.update(1 / 60);
  }

  /** A Debris type that is never locked (Obstacle). */
  const freeType = (run: Run) => run.debris.types.findIndex((t) => t.lockedUntilTier === undefined);

  it('channels while held: slowed to 25%, no Dash or knockback, 30% less damage, suction 1.2×; cooldown 5 s + 3.5 s per second', () => {
    const { run, input, sys } = setup('tumble');
    const b = run.bunny;
    const [speed0, suction0] = [maxSpeedFor(b), b.stats.get('suctionMultiplier')];
    amass(run, input);
    expect(b.amassing).toBe(true);
    expect(maxSpeedFor(b)).toBeCloseTo(speed0 * AMASS.moveSpeedMul);
    expect(b.stats.get('suctionMultiplier')).toBeCloseTo(suction0 * AMASS.suctionMul);
    input.dash = true;
    run.update(1 / 60);
    expect(b.dashing).toBe(false);
    b.knockback(1, 0, 50);
    expect(b.impulseX).toBe(0);
    const hp = b.health;
    expect(b.damage(1, 'test')).toBe(true);
    expect(b.health).toBeCloseTo(hp - (1 - AMASS.damageReduction));
    step(run, 0.5);
    input.abilityHeld = false;
    run.update(1 / 60);
    expect(b.amassing).toBe(false);
    expect(maxSpeedFor(b)).toBeCloseTo(speed0);
    expect(b.stats.get('suctionMultiplier')).toBeCloseTo(suction0);
    const ctl = sys.controller as AmassAbility;
    expect(ctl.cooldownTotal).toBeCloseTo(AMASS.cooldownBase + AMASS.cooldownPerSecondHeld * ctl.held, 5);
  });

  it('auto-releases at the 2 s max hold with a 12 s cooldown, and cannot start while stuck', () => {
    const { run, input, sys, events } = setup('tumble');
    const ended = collect(events, 'abilityEnded');
    amass(run, input);
    step(run, AMASS.maxHold + 0.1);
    expect(run.bunny.amassing).toBe(false);
    expect(ended).toMatchObject([{ ability: 'amass', reason: 'maxHold' }]);
    expect((sys.controller as AmassAbility).cooldownTotal).toBeCloseTo(12, 1);
    step(run, 12.1);
    run.bunny.rooted = 1;
    amass(run, input);
    expect(run.bunny.amassing).toBe(false);
  });

  it('pulls Debris from across the map with a swirl; oversized Debris only shakes and is left where it was', () => {
    const { run, input } = setup('tumble');
    const b = run.bunny;
    const rng = new Rng('amass-debris');
    const t = freeType(run);
    const r = b.radius;
    const far = run.debris.spawn(t, b.x + 40 * r, b.z, rng, { size: r * 0.3 })!;
    const near = run.debris.spawn(t, b.x, b.z + 4 * r, rng, { size: r * 0.3 })!;
    const big = run.debris.spawn(t, b.x - 3 * r, b.z, rng, { size: r * 1.6 })!;
    const [bigX, bigZ] = [big.x, big.z];
    const [farD0, nearZ0] = [far.x - b.x, near.z - b.z];
    amass(run, input);
    step(run, 0.3);
    expect(big.x !== bigX || big.z !== bigZ).toBe(true); // shaking
    expect(far.x - b.x).toBeLessThan(farD0);
    // The swirl leans the pull off straight inward.
    expect(Math.abs(near.x - b.x)).toBeGreaterThan(0.01 * r);
    expect(near.z - b.z).toBeLessThan(nearZ0);
    step(run, 0.5);
    expect(near.alive).toBe(false); // pulled into the fur and absorbed
    input.abilityHeld = false;
    run.update(1 / 60);
    expect([big.x, big.z]).toEqual([bigX, bigZ]);
  });

  it('swallows a small Hazard too big to absorb normally: scrap, and a shockwave stuns its neighbours', () => {
    const { run, input, events } = setup('tumble');
    const b = run.bunny;
    const swallowed = collect(events, 'hazardSwallowed');
    const removed = collect(events, 'hazardRemoved');
    const h = run.hazards.spawn('roomba', b.x, b.z + 200);
    b.setRadius(h.size / 1);
    expect(h.size).toBeGreaterThan(b.radius * b.stats.get('absorbRatio'));
    amass(run, input);
    const other = run.hazards.spawn('roomba', b.x + b.radius * 2 + h.size, b.z);
    const r0 = b.radius;
    const debris0 = run.debris.count;
    h.x = b.x;
    h.z = b.z - b.radius - h.size + 2;
    run.update(1 / 60);
    expect(swallowed).toMatchObject([{ hazardId: h.id, defId: 'roomba' }]);
    expect(removed).toMatchObject([{ hazardId: h.id, absorbed: true }]);
    expect(b.radius).toBeGreaterThan(r0);
    expect(run.debris.count - debris0).toBeGreaterThan(0);
    expect(other.stunnedFor).toBeGreaterThan(AMASS.shockwaveStun - 0.05);
    expect(b.health).toBe(b.maxHealth);
  });

  it('pulls small non-boss Hazards, never bosses or Hazards over 1.25 r', () => {
    const { run, input } = setup('tumble');
    const b = run.bunny;
    const small = run.hazards.spawn('roomba', b.x + 300, b.z);
    b.setRadius(small.size / 1.2);
    small.x = b.x + b.radius * 6;
    small.z = b.z;
    const boss = run.hazards.spawn('robovac_9000', b.x - b.radius * 4 - ROBOVAC_9000.contactRadius, b.z) as RoboVac9000;
    boss.state = 'stunned';
    const [bossX, bossZ] = [boss.x, boss.z];
    const d0 = Math.hypot(small.x - b.x, small.z - b.z);
    amass(run, input);
    small.stunnedFor = 5; // hold it still so only the pull moves it
    step(run, 0.3);
    expect(Math.hypot(small.x - b.x, small.z - b.z)).toBeLessThan(d0 - b.radius * 0.5);
    expect([boss.x, boss.z]).toEqual([bossX, bossZ]);
  });

  it('a charging boss crashes into the core: stunned and chipped at once with 2 more parts; inside 6 s it hits as usual', () => {
    const { run, input, sys, events } = setup('tumble');
    const b = run.bunny;
    b.setRadius(30);
    const hits = collect(events, 'bossHit');
    const crashes = collect(events, 'bossCrashedIntoAmass');
    amass(run, input);
    const boss = run.hazards.spawn('robovac_9000', b.x + ROBOVAC_9000.contactRadius + b.radius - 3, b.z) as RoboVac9000;
    boss.state = 'charge';
    const [bx, bz] = [b.x, b.z];
    run.update(1 / 60);
    expect(boss.stunCause).toBe('amass');
    expect(boss.chipBonus).toMatchObject({ pieces: AMASS.bossChipParts });
    expect(hits).toHaveLength(1);
    expect(crashes).toHaveLength(1);
    expect(Math.hypot(b.x - bx, b.z - bz)).toBeLessThan(0.5);
    expect(b.health).toBe(b.maxHealth);
    // Again inside the 6 s limit: a normal hit, 30% lighter.
    step(run, 0.5);
    boss.state = 'charge';
    boss.x = b.x + ROBOVAC_9000.contactRadius * boss.scale + b.radius - 3;
    boss.z = b.z;
    run.update(1 / 60);
    expect(hits).toHaveLength(1);
    expect(sys.canStunBoss(boss)).toBe(false);
    expect(b.health).toBeCloseTo(b.maxHealth - ROBOVAC_9000.damage * (1 - AMASS.damageReduction));
  });

  it('a hunting boss that touches the core is not stunned', () => {
    const { run, input } = setup('tumble');
    const b = run.bunny;
    b.setRadius(30);
    amass(run, input);
    const boss = run.hazards.spawn('robovac_9000', b.x + ROBOVAC_9000.contactRadius + b.radius - 3, b.z) as RoboVac9000;
    boss.state = 'hunt';
    run.update(1 / 60);
    expect(boss.stunCause).toBeNull();
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
