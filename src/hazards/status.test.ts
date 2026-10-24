import { describe, expect, it } from 'vitest';
import { EventBus, type GameEvents } from '../core/events';
import { ABILITY_RULES } from '../data/abilities';
import { createRun } from '../game/assembly';
import type { Hazard, HazardDef } from './index';
import type { RoboVac9000 } from './robovac';
import { HazardStatus, HIT_STUN, hittable, isClogged, isGrounded, isStunned, stunCause, type StunCause } from './status';

const DT = 1 / 60;

/** A stand-in Hazard (no model, no Run) that records its onStunned calls. */
function standIn(boss: boolean, id = 1): Hazard & { calls: [StunCause, number][] } {
  const calls: [StunCause, number][] = [];
  return {
    id,
    def: { id: boss ? 'stand_in_boss' : 'stand_in', name: 'Stand-in', boss } as HazardDef,
    x: 0,
    z: 0,
    size: 10,
    shape: { kind: 'circle', radius: 10 },
    update: () => {},
    onStunned: (cause, seconds) => calls.push([cause, seconds]),
    calls,
  };
}

function setup() {
  const events = new EventBus<GameEvents>();
  const clock = { time: 0, events };
  const status = new HazardStatus(clock);
  const stuns: GameEvents['bossStunned'][] = [];
  events.on('bossStunned', (e) => stuns.push(e));
  const tick = (hazards: Hazard[], seconds: number) => {
    for (let t = 0; t < seconds - 1e-9; t += DT) {
      status.tick(hazards, DT);
      clock.time += DT;
    }
  };
  return { events, clock, status, stuns, tick };
}

const ALL_CAUSES: StunCause[] = ['wall', 'indigestion', 'spiky', 'decoy', 'amass', 'discharge', 'perk'];

describe('HazardStatus timers', () => {
  it('stuns, clogs, grounds and ignores, and ticks every timer down to 0', () => {
    const { status, tick } = setup();
    const h = standIn(false);
    status.stun(h, 1, 'perk');
    status.clog(h, 0.5);
    status.ground(h, 2);
    status.ignoreBunny(h, 1.5);
    expect([isStunned(h), isClogged(h), isGrounded(h), h.ignoresBunnyFor]).toEqual([true, true, true, 1.5]);
    expect(h.calls).toEqual([['perk', 1]]);
    tick([h], 0.75);
    expect(h.stunnedFor).toBeCloseTo(0.25);
    expect(isClogged(h)).toBe(false);
    tick([h], 1.5);
    expect([h.stunnedFor, h.cloggedFor, h.groundedFor, h.ignoresBunnyFor]).toEqual([0, 0, 0, 0]);
  });

  it.each(ALL_CAUSES)('never shortens a running stun (%s)', (cause) => {
    const { status, clock } = setup();
    for (const boss of [false, true]) {
      const h = standIn(boss);
      clock.time += ABILITY_RULES.bossStunInterval;
      status.stun(h, 3, 'wall');
      clock.time += ABILITY_RULES.bossStunInterval;
      expect(status.stun(h, 1, cause)).toBe(true);
      expect(h.stunnedFor).toBe(3);
      status.stun(h, 4, cause === 'decoy' || cause === 'amass' || cause === 'discharge' ? 'wall' : cause);
      expect(h.stunnedFor).toBe(4);
    }
  });

  it('extends a clog, Grounded and Unnoticed but never shortens them', () => {
    const { status } = setup();
    const h = standIn(false);
    status.clog(h, 2);
    status.clog(h, 1);
    status.ground(h, 2);
    status.ground(h, 1);
    status.ignoreBunny(h, 2);
    status.ignoreBunny(h, 1);
    expect([h.cloggedFor, h.groundedFor, h.ignoresBunnyFor]).toEqual([2, 2, 2]);
    status.clog(h, 3);
    expect(h.cloggedFor).toBe(3);
  });

  it('emits hazardUnclogged once when a clog runs out on a live Hazard, never for a dead one', () => {
    const { events, status, tick } = setup();
    const ended: number[] = [];
    events.on('hazardUnclogged', (e) => ended.push(e.hazardId));
    const a = standIn(false, 1);
    const b = standIn(false, 2);
    status.clog(a, 0.2);
    status.clog(b, 0.2);
    b.dead = true;
    tick([a, b], 0.5);
    expect(ended).toEqual([1]);
  });

  it('clear ends every effect at once, with no end event', () => {
    const { events, status } = setup();
    const ended: number[] = [];
    events.on('hazardUnclogged', (e) => ended.push(e.hazardId));
    const h = standIn(false);
    status.stun(h, 1, 'perk');
    status.clog(h, 1);
    status.clear(h);
    expect([isStunned(h), isClogged(h)]).toEqual([false, false]);
    expect(ended).toEqual([]);
  });
});

describe('boss Hit ledger', () => {
  it('arms one Hit per stun, emits bossStunned and calls onStunned for every cause', () => {
    const { status, clock, stuns } = setup();
    const boss = standIn(true);
    for (const cause of ALL_CAUSES) {
      clock.time += ABILITY_RULES.bossStunInterval;
      expect(status.stun(boss, 2, cause)).toBe(true);
      expect(stunCause(boss)).toBe(cause);
      expect(hittable(boss)).toBe(true);
      expect(status.landHit(boss)).toBe(true);
      // One Hit per stun.
      expect(hittable(boss)).toBe(false);
      expect(status.landHit(boss)).toBe(false);
      status.clear(boss);
    }
    expect(stuns.map((e) => e.cause)).toEqual(ALL_CAUSES);
    expect(boss.calls.map(([c]) => c)).toEqual(ALL_CAUSES);
  });

  it("cuts a Hit's stun to HIT_STUN (plus the hold), never lengthening it", () => {
    const { status } = setup();
    const boss = standIn(true);
    status.stun(boss, 3, 'wall');
    status.landHit(boss);
    expect(boss.stunnedFor).toBe(HIT_STUN);
    status.clear(boss);
    status.stun(boss, 3, 'spiky');
    status.landHit(boss, 0.5);
    expect(boss.stunnedFor).toBe(HIT_STUN + 0.5);
    status.clear(boss);
    status.stun(boss, 0.2, 'perk');
    status.landHit(boss);
    expect(boss.stunnedFor).toBe(0.2);
  });

  it('is not hittable once the stun runs out, even with the Hit unused', () => {
    const { status, tick } = setup();
    const boss = standIn(true);
    status.stun(boss, 0.5, 'wall');
    tick([boss], 0.6);
    expect(hittable(boss)).toBe(false);
    expect(status.landHit(boss)).toBe(false);
  });

  it('a new stun during a running one arms another Hit', () => {
    const { status } = setup();
    const boss = standIn(true);
    status.stun(boss, 3, 'wall');
    status.landHit(boss);
    status.stun(boss, 2, 'decoy');
    expect(hittable(boss)).toBe(true);
    expect(boss.stunnedFor).toBe(2);
  });

  it('limits Ability stuns on a boss to one per bossStunInterval; other causes neither count nor wait', () => {
    const { status, clock, stuns } = setup();
    const boss = standIn(true);
    expect(status.stun(boss, 1, 'decoy')).toBe(true);
    for (const cause of ['decoy', 'amass', 'discharge'] as const) {
      expect(status.canStun(boss, cause)).toBe(false);
      expect(status.stun(boss, 5, cause)).toBe(false);
    }
    // A refused stun does nothing at all.
    expect(boss.stunnedFor).toBe(1);
    expect(stuns).toHaveLength(1);
    expect(boss.calls).toHaveLength(1);
    for (const cause of ['wall', 'indigestion', 'spiky', 'perk'] as const) expect(status.stun(boss, 1, cause)).toBe(true);
    clock.time = ABILITY_RULES.bossStunInterval - 0.1;
    expect(status.canStun(boss, 'amass')).toBe(false);
    clock.time = ABILITY_RULES.bossStunInterval;
    expect(status.stun(boss, 1, 'amass')).toBe(true);
    // Each boss has its own limit; non-bosses have none.
    const other = standIn(true, 2);
    expect(status.stun(other, 1, 'discharge')).toBe(true);
    const h = standIn(false, 3);
    expect(status.stun(h, 1, 'decoy')).toBe(true);
    expect(status.stun(h, 1, 'decoy')).toBe(true);
  });
});

describe('in a Run', () => {
  it('counts every timer down in a Run built with createRun alone, whichever Systems are installed', () => {
    for (const rules of [{}, { hazards: false, pickups: false, abilities: false }]) {
      const run = createRun(new EventBus(), { seed: 'status', characterId: 'lint' }, rules);
      const b = run.bunny;
      const h = run.hazards.spawn('roomba', b.x + 400, b.z);
      const boss = run.hazards.spawn('robovac_9000', b.x - 600, b.z) as RoboVac9000;
      const s = run.hazards.status;
      s.stun(h, 0.5, 'perk');
      s.clog(h, 0.5);
      s.ignoreBunny(h, 0.5);
      s.stun(boss, 0.5, 'wall');
      s.ground(boss, 0.5);
      expect(boss.state).toBe('stunned');
      for (let i = 0; i < 40; i++) run.update(DT);
      expect([h.stunnedFor, h.cloggedFor, h.ignoresBunnyFor, boss.stunnedFor, boss.groundedFor]).toEqual([0, 0, 0, 0, 0]);
      expect(boss.state).toBe('recover');
    }
  });

  it('a stunned boss drops its charge and recovers after the stun', () => {
    const run = createRun(new EventBus(), { seed: 'status', characterId: 'tumble' }, { hazards: false, pickups: false });
    const b = run.bunny;
    const boss = run.hazards.spawn('robovac_9000', b.x - 600, b.z) as RoboVac9000;
    boss.state = 'charge';
    run.hazards.status.stun(boss, 1, 'spiky');
    expect(boss.state).toBe('stunned');
    expect(boss.charging).toBe(false);
    expect(boss.hittable).toBe(true);
    expect(boss.stunCause).toBe('spiky');
    for (let i = 0; i < 70; i++) run.update(DT);
    expect(boss.state).toBe('recover');
  });
});
