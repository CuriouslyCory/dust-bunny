import { describe, expect, it } from 'vitest';
import { NO_INPUT, type InputState } from '../core/input';
import { EventBus } from '../core/events';
import { AMASS, DECOY, DISCHARGE } from '../data/abilities';
import { ROBOVAC_9000 } from '../data/hazards';
import { effectValue, getKeepsakeType, KEEPSAKE_FLOORS, keepsakeTypesFor, type KeepsakeTypeId, type Loadout } from '../data/keepsakes';
import { createRun } from '../game/assembly';
import type { Run } from '../game/run';
import { aimTarget, hazardFloorFree } from '../hazards/common';
import type { RoboVac9000 } from '../hazards/robovac';
import { growthFactorAt } from '../systems/absorb';
import { maxSpeedFor } from '../systems/movement';
import { hazardRadius } from './system';
import { abilityParamsFor, baseAbilityParams, getAbilitySystem, getKeepsakeEffects, type AmassAbility, type DecoyAbility, type DischargeAbility } from './index';

const CHAR: Record<string, string> = Object.fromEntries(['lint', 'tumble', 'zap'].flatMap((c) => keepsakeTypesFor(c).map((t) => [t.id, c])));

/** One Keepsake's value at a rarity. */
const val = (type: KeepsakeTypeId, key: string, rarity: number) => effectValue(getKeepsakeType(type)!, key, rarity);

/** A Run with no spawning, the given Loadout and a scriptable input (as in abilities.test.ts). */
function setup(loadout: Loadout, characterId = CHAR[loadout[0]?.type ?? 'long_strand']!, seed = `keepsakes-${characterId}`) {
  const events = new EventBus();
  const run = createRun(events, { seed, characterId, loadout }, { hazards: false, pickups: false });
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

function collect(events: EventBus, name: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  (events as unknown as { on(n: string, f: (e: Record<string, unknown>) => void): void }).on(name, (e) => out.push(e));
  return out;
}

/** Starts Tumble's Amass (held) this tick. */
function amass(run: Run, input: InputState) {
  input.ability = true;
  input.abilityHeld = true;
  run.update(1 / 60);
}

describe('Keepsake params', () => {
  it('no Loadout plays the base Ability', () => {
    for (const c of ['lint', 'tumble', 'zap']) expect(setup([], c).sys.params).toEqual(baseAbilityParams());
  });

  it('the Run plays with exactly the numbers Character select shows (abilityParamsFor)', () => {
    for (const c of ['lint', 'tumble', 'zap']) {
      const types = keepsakeTypesFor(c);
      for (const a of types) {
        for (const b of types) {
          const loadout: Loadout = [{ type: a.id, rarity: 4 }, { type: b.id, rarity: 5 }];
          expect(setup(loadout, c).sys.params).toEqual(abilityParamsFor(loadout));
        }
      }
    }
  });

  it('two copies add together', () => {
    const one = abilityParamsFor([{ type: 'long_reach', rarity: 4 }]);
    const two = abilityParamsFor([{ type: 'long_reach', rarity: 4 }, { type: 'long_reach', rarity: 4 }]);
    expect(two.discharge.range - DISCHARGE.range).toBeCloseTo(2 * (one.discharge.range - DISCHARGE.range));
  });
});

describe('Lint · Decoy Keepsakes', () => {
  it('Long Strand: the Decoy lasts longer', () => {
    const extra = val('long_strand', 'duration', 4);
    const { run, input, sys } = setup([{ type: 'long_strand', rarity: 4 }]);
    expect(sys.params.decoy.duration).toBeCloseTo(DECOY.duration + extra);
    const ctl = sys.controller as DecoyAbility;
    input.ability = true;
    run.update(1 / 60);
    step(run, DECOY.duration + extra - 0.1);
    expect(ctl.decoy).not.toBeNull();
    step(run, 0.2);
    expect(ctl.decoy).toBeNull();
  });

  it('Quick Shed: shorter cooldown, never below the Decoy duration', () => {
    const cut = val('quick_shed', 'cooldown', 4);
    expect(abilityParamsFor([{ type: 'quick_shed', rarity: 4 }]).decoy.cooldown).toBeCloseTo(DECOY.cooldown * (1 - cut));
    const twoMythic = abilityParamsFor([{ type: 'quick_shed', rarity: 5 }, { type: 'quick_shed', rarity: 5 }]).decoy;
    expect(DECOY.cooldown * (1 - 0.9)).toBeLessThan(DECOY.duration);
    expect(twoMythic.cooldown).toBe(twoMythic.duration * KEEPSAKE_FLOORS.decoyCooldownPerDuration);
    const { run, input, sys, events } = setup([{ type: 'quick_shed', rarity: 4 }]);
    const ended = collect(events, 'abilityEnded');
    input.ability = true;
    run.update(1 / 60);
    step(run, DECOY.duration + 0.05);
    expect(ended[0]!.cooldown).toBeCloseTo(sys.params.decoy.cooldown);
  });

  it('Thick Clog: longer clog stun, bosses get half the bonus', () => {
    const bonus = val('thick_clog', 'clogStun', 4);
    const { run, input, sys, events } = setup([{ type: 'thick_clog', rarity: 4 }]);
    expect(sys.params.decoy.bossClogStun).toBeCloseTo(DECOY.clogStun + bonus / 2);
    const clogs = collect(events, 'hazardClogged');
    input.ability = true;
    run.update(1 / 60);
    const d = (sys.controller as DecoyAbility).decoy!;
    const h = run.hazards.spawn('roomba', d.x + d.radius + 5, d.z);
    run.update(1 / 60);
    expect(clogs[0]!.seconds).toBeCloseTo(DECOY.clogStun + bonus);
    expect(h.stunnedFor).toBeGreaterThan(DECOY.clogStun + bonus - 0.1);
  });

  it('Dinner Bell: wanderers home in on the Decoy, aimers lure from further away', () => {
    const g = 5;
    const { run, input, sys } = setup([{ type: 'dinner_bell', rarity: g }]);
    const b = run.bunny;
    b.setRadius(5);
    expect(sys.params.decoy.wandererLureRange).toBeCloseTo(val('dinner_bell', 'wanderRange', g));
    expect(sys.params.decoy.lureRangeMul).toBeCloseTo(1 + val('dinner_bell', 'lureRange', g));
    input.ability = true;
    run.update(1 / 60);
    const d = (sys.controller as DecoyAbility).decoy!;
    // Aimers: a Hazard 1.4 × its range away still aims at the Decoy (lure +60%).
    expect(aimTarget(run, d.x - 140, d.z, 100)?.lure).toBe(true);
    // A Roomba 8 r away, driving away from the Decoy, turns round and closes in.
    b.teleport(d.x, d.z + 400);
    const h = run.hazards.spawn('roomba', d.x + 8 * b.radius, d.z);
    (h as unknown as { yaw: number }).yaw = Math.PI / 2; // +X: away from the Decoy
    const d0 = Math.hypot(h.x - d.x, h.z - d.z);
    step(run, 1.5);
    expect(Math.hypot(h.x - d.x, h.z - d.z)).toBeLessThan(d0);
  });

  it('Reclaim: a spent Decoy leaves fibre worth its share of the Bunny volume', () => {
    const g = 4;
    const { run, input, sys } = setup([{ type: 'reclaim', rarity: g }]);
    const b = run.bunny;
    b.setRadius(8);
    const newDebris = (fn: () => void) => {
      const before = new Set<number>();
      run.debris.forEach((x) => before.add(x.id));
      fn();
      const out: { x: number; z: number; size: number; mass: number; type: string }[] = [];
      run.debris.forEach((x) => !before.has(x.id) && out.push({ x: x.x, z: x.z, size: x.size, mass: x.type.mass, type: x.type.id }));
      return out;
    };
    // The hook: when the Decoy expires, lint fibre lands around where it was.
    input.ability = true;
    run.update(1 / 60);
    const d = (sys.controller as DecoyAbility).decoy!;
    const spent = newDebris(() => step(run, DECOY.duration + 0.05)).filter((x) => x.type === 'lint_ball' && Math.hypot(x.x - d.x, x.z - d.z) <= 2 * b.radius + 1);
    expect(spent.length).toBeGreaterThan(0);
    // The amount: re-absorbing every piece gives back about `volume` × the Bunny volume.
    const pieces = newDebris(() => getKeepsakeEffects(run)!.reclaim(run, d.x, d.z));
    expect(pieces.length).toBeGreaterThan(0);
    let worth = 0;
    for (const x of pieces) {
      expect(x.type).toBe('lint_ball');
      expect(x.size).toBeLessThan(b.radius * b.stats.get('absorbRatio'));
      worth += growthFactorAt(b.radius) * x.mass * x.size ** 3;
    }
    // Pieces jitter in size (×0.85–1.1), so the total is close to, not exactly, the target volume.
    const ratio = worth / (val('reclaim', 'volume', g) * b.radius ** 3);
    expect(ratio).toBeGreaterThan(0.75);
    expect(ratio).toBeLessThan(1.3);
  });
});

describe('Tumble · Amass Keepsakes', () => {
  /** Holds the Amass for `seconds`, then lets go; returns the abilityEnded events. */
  function channel(run: Run, input: InputState, events: EventBus, seconds: number) {
    const ended = collect(events, 'abilityEnded');
    amass(run, input);
    step(run, seconds);
    input.abilityHeld = false;
    run.update(1 / 60);
    return ended;
  }

  it('use the hand-set per-rarity ladders', () => {
    expect([1, 2, 3, 4, 5].map((r) => val('dense_core', 'force', r))).toEqual([0.15, 0.25, 0.35, 0.5, 0.65]);
    expect([1, 2, 3, 4, 5].map((r) => val('lingering_mass', 'hold', r))).toEqual([0.3, 0.6, 0.9, 1.2, 1.6]);
    expect([1, 2, 3, 4, 5].map((r) => val('collapse', 'radius', r))).toEqual([1.6, 2.2, 2.9, 3.6, 4.5]);
    expect([1, 2, 3, 4, 5].map((r) => val('feast', 'growth', r))).toEqual([0.12, 0.2, 0.3, 0.42, 0.6]);
    expect([1, 2, 3, 4, 5].map((r) => val('unmoved', 'suction', r))).toEqual([0.03, 0.06, 0.1, 0.15, 0.2]);
    expect(val('unmoved', 'guard', 3)).toBeCloseTo(0.15);
  });

  it('Dense Core: stronger pull and a wider full-strength core', () => {
    const g = 4;
    const p = abilityParamsFor([{ type: 'dense_core', rarity: g }]).amass;
    expect(p.forceMul).toBeCloseTo(1 + val('dense_core', 'force', g));
    expect(p.coreRadius).toBeCloseTo(AMASS.coreRadius + val('dense_core', 'core', g));
    // The same far crumb travels further in the same time.
    const pulled = (loadout: Loadout) => {
      const { run, input } = setup(loadout, 'tumble');
      const b = run.bunny;
      const t = run.debris.types.findIndex((x) => x.lockedUntilTier === undefined);
      const d = run.debris.spawn(t, b.x + 30 * b.radius, b.z, run.rng.fork('t'), { size: b.radius * 0.2 })!;
      const d0 = d.x;
      amass(run, input);
      step(run, 0.5);
      return d0 - d.x;
    };
    expect(pulled([{ type: 'dense_core', rarity: g }]) / pulled([])).toBeGreaterThan(1.3);
  });

  it('Lingering Mass: longer channel, cooldown still 5 s + 3.5 s per second, never past 3.6 s', () => {
    const g = 3;
    const { run, input, events } = setup([{ type: 'lingering_mass', rarity: g }]);
    const ended = channel(run, input, events, 5);
    const hold = AMASS.maxHold + val('lingering_mass', 'hold', g);
    expect(ended).toMatchObject([{ reason: 'maxHold' }]);
    expect(ended[0]!.heldFor).toBeCloseTo(hold);
    expect(ended[0]!.cooldown).toBeCloseTo(AMASS.cooldownBase + AMASS.cooldownPerSecondHeld * hold);
    expect(abilityParamsFor([{ type: 'lingering_mass', rarity: 5 }]).amass.maxHold).toBeCloseTo(3.6);
    expect(abilityParamsFor([{ type: 'lingering_mass', rarity: 5 }, { type: 'lingering_mass', rarity: 5 }]).amass.maxHold).toBe(KEEPSAKE_FLOORS.amassMaxHold);
  });

  it('Collapse: releasing stuns and knocks back nearby Hazards; bosses get half the stun', () => {
    const g = 4;
    const { run, input, events, sys } = setup([{ type: 'collapse', rarity: g }]);
    const b = run.bunny;
    b.setRadius(5);
    const collapsed = collect(events, 'amassCollapsed');
    // A big Roomba (too big to pull or swallow) just inside the radius, and a boss.
    const h = run.hazards.spawn('roomba', b.x + 300, b.z);
    b.setRadius(h.size / 2);
    h.x = b.x + b.radius + hazardRadius(h) + b.radius;
    h.z = b.z;
    const boss = run.hazards.spawn('robovac_9000', b.x - b.radius - ROBOVAC_9000.contactRadius - b.radius, b.z) as RoboVac9000;
    boss.state = 'recover';
    amass(run, input);
    h.stunnedFor = 0;
    const d0 = Math.hypot(h.x - b.x, h.z - b.z);
    input.abilityHeld = false;
    run.update(1 / 60);
    expect(collapsed).toMatchObject([{ hit: 2 }]);
    expect(h.stunnedFor).toBeGreaterThan(val('collapse', 'stun', g) - 0.05);
    expect(boss.stunCause).toBe('amass');
    expect((sys.controller as AmassAbility).knocking).toBe(1);
    step(run, 0.3);
    expect(Math.hypot(h.x - b.x, h.z - b.z) - d0).toBeGreaterThan(AMASS.collapseKnockback * b.radius * 0.5);
  });

  it('Feast: more growth during the channel and for 1 s after', () => {
    const g = 5;
    const { run, input } = setup([{ type: 'feast', rarity: g }]);
    const s = run.bunny.stats;
    const g0 = s.get('growthMultiplier');
    amass(run, input);
    expect(s.get('growthMultiplier')).toBeCloseTo(g0 * (1 + val('feast', 'growth', g)));
    input.abilityHeld = false;
    run.update(1 / 60);
    step(run, 0.8);
    expect(s.get('growthMultiplier')).toBeCloseTo(g0 * (1 + val('feast', 'growth', g)));
    step(run, 0.3);
    expect(s.get('growthMultiplier')).toBeCloseTo(g0);
  });

  it('Unmoved: always-on knockback resistance and suction below the cap, and more channel guard', () => {
    const g = 4;
    const { run, input } = setup([{ type: 'unmoved', rarity: g }]);
    const b = run.bunny;
    const s = b.stats;
    expect(s.get('knockbackResistance')).toBeCloseTo(0.5 + val('unmoved', 'knockbackResistance', g));
    expect(s.get('suctionMultiplier')).toBeCloseTo(1 - val('unmoved', 'suction', g));
    amass(run, input);
    const hp = b.health;
    b.damage(1, 'test');
    expect(b.health).toBeCloseTo(hp - (1 - AMASS.damageReduction - 0.15));
    const two = setup([{ type: 'unmoved', rarity: 5 }, { type: 'unmoved', rarity: 5 }]).run.bunny.stats;
    expect(two.get('knockbackResistance')).toBeCloseTo(0.9);
    expect(two.get('suctionMultiplier')).toBeCloseTo(0.6);
    two.add({ stat: 'knockbackResistance', op: 'add', value: 0.3, source: 'test:perk' });
    expect(two.get('knockbackResistance')).toBeCloseTo(0.9);
  });
});

describe('Zap · Discharge Keepsakes', () => {
  function roll(run: Run, ctl: DischargeAbility, seconds: number) {
    const b = run.bunny;
    for (let t = 0; t < seconds - 1e-9; t += 1 / 60) {
      b.vx = maxSpeedFor(b);
      b.vz = 0;
      b.dashTime = 0;
      ctl.update(1 / 60, NO_INPUT);
    }
  }

  it('Live Wire: the meter fills faster', () => {
    const rate = val('live_wire', 'fillRate', 4);
    const { run, sys } = setup([{ type: 'live_wire', rarity: 4 }]);
    const ctl = sys.controller as DischargeAbility;
    const perSec = maxSpeedFor(run.bunny) / run.bunny.radius;
    roll(run, ctl, (DISCHARGE.fillDistance / perSec) * 0.5);
    expect(ctl.charge).toBeCloseTo(0.5 * (1 + rate), 1);
  });

  it('Long Reach: targets further away', () => {
    const extra = val('long_reach', 'range', 4);
    const { run, sys } = setup([{ type: 'long_reach', rarity: 4 }]);
    const ctl = sys.controller as DischargeAbility;
    const b = run.bunny;
    b.setRadius(6);
    const h = run.hazards.spawn('roomba', 0, 0);
    h.x = b.x + b.radius + (DISCHARGE.range + extra * 0.8) * b.radius + hazardRadius(h);
    h.z = b.z;
    ctl.charge = 1;
    expect(ctl.findTarget()).toBe(h);
    expect(sys.params.discharge.range).toBeCloseTo(DISCHARGE.range + extra);
  });

  it('Arc: the Discharge jumps to another non-boss Hazard near the first', () => {
    const { run, input, sys, events } = setup([{ type: 'arc', rarity: 4 }]);
    const ctl = sys.controller as DischargeAbility;
    const b = run.bunny;
    b.setRadius(6);
    const shorted = collect(events, 'hazardShorted');
    const first = run.hazards.spawn('roomba', b.x + b.radius + 15, b.z);
    const second = run.hazards.spawn('roomba', first.x + 3 * b.radius, first.z);
    const third = run.hazards.spawn('roomba', first.x, first.z + 12 * b.radius);
    ctl.charge = 1;
    input.ability = true;
    b.vx = maxSpeedFor(b);
    run.update(1 / 60);
    expect(shorted).toHaveLength(2);
    expect(first.dead || !run.hazards.hazards.includes(first)).toBe(true);
    expect(second.dead || !run.hazards.hazards.includes(second)).toBe(true);
    expect(third.dead).toBeFalsy();
  });

  it('Static Cling: magnet bonus while the meter is at least half full, capped', () => {
    const bonus = val('static_cling', 'magnet', 4);
    const { run, sys } = setup([{ type: 'static_cling', rarity: 4 }]);
    const ctl = sys.controller as DischargeAbility;
    const s = run.bunny.stats;
    const m0 = s.get('magnetRadius');
    ctl.charge = 0.6;
    roll(run, ctl, 1 / 60);
    expect(s.get('magnetRadius')).toBeCloseTo(m0 + bonus);
    ctl.charge = 0.2;
    roll(run, ctl, 1 / 60);
    expect(s.get('magnetRadius')).toBeCloseTo(m0);
    // Two mythic copies stay under Zap's 2.2 cap, and a Perk on top stops at it.
    const two = setup([{ type: 'static_cling', rarity: 5 }, { type: 'static_cling', rarity: 5 }]);
    const ctl2 = two.sys.controller as DischargeAbility;
    two.run.bunny.stats.add({ stat: 'magnetRadius', op: 'add', value: 3, source: 'test:perk' });
    ctl2.charge = 0.6;
    roll(two.run, ctl2, 1 / 60);
    expect(two.run.bunny.stats.get('magnetRadius')).toBeCloseTo(2.2);
  });

  it('Grounding: less suction while the meter is full, never below the 1.2 floor', () => {
    const cut = val('grounding', 'suction', 4);
    const { run, sys } = setup([{ type: 'grounding', rarity: 4 }]);
    const ctl = sys.controller as DischargeAbility;
    const s = run.bunny.stats;
    ctl.charge = 1;
    roll(run, ctl, 1 / 60);
    expect(s.get('suctionMultiplier')).toBeCloseTo(1.5 * (1 - cut));
    const two = setup([{ type: 'grounding', rarity: 5 }, { type: 'grounding', rarity: 5 }]);
    const ctl2 = two.sys.controller as DischargeAbility;
    two.run.bunny.stats.add({ stat: 'suctionMultiplier', op: 'mul', value: 0.5, source: 'test:perk' });
    ctl2.charge = 1;
    roll(two.run, ctl2, 1 / 60);
    expect(two.run.bunny.stats.get('suctionMultiplier')).toBeCloseTo(1.2);
  });
});

describe('Tucking a Keepsake in mid-Run', () => {
  it('fills open Loadout slots for the rest of the Run, then refuses', () => {
    const { run, events } = setup([], 'lint');
    const tucked = collect(events, 'keepsakeTuckedIn');
    expect(run.openLoadoutSlots).toBe(2);
    // Another Character's Keepsake never goes in.
    expect(run.tuckIn({ type: 'arc', rarity: 3 })).toBe(false);
    expect(run.tuckIn({ type: 'thick_clog', rarity: 2 })).toBe(true);
    expect(run.tuckIn({ type: 'thick_clog', rarity: 4 })).toBe(true);
    expect(run.openLoadoutSlots).toBe(0);
    expect(run.tuckIn({ type: 'reclaim', rarity: 1 })).toBe(false);
    expect(run.loadout).toEqual([
      { type: 'thick_clog', rarity: 2 },
      { type: 'thick_clog', rarity: 4 },
    ]);
    expect(tucked).toEqual([
      { characterId: 'lint', ref: { type: 'thick_clog', rarity: 2 }, loadout: [{ type: 'thick_clog', rarity: 2 }] },
      { characterId: 'lint', ref: { type: 'thick_clog', rarity: 4 }, loadout: run.loadout },
    ]);
    // The Run's stats (leaderboard) and snapshot (Save & quit) carry it.
    expect(run.getStats().loadout).toEqual(run.loadout);
    expect(run.toSnapshot().loadout).toEqual(run.loadout);
  });

  it('no slot opens once the Run has ended', () => {
    const { run } = setup([{ type: 'long_strand', rarity: 1 }]);
    expect(run.openLoadoutSlots).toBe(1);
    run.end('quit');
    expect(run.openLoadoutSlots).toBe(0);
    expect(run.tuckIn({ type: 'quick_shed', rarity: 1 })).toBe(false);
    expect(run.loadout).toHaveLength(1);
  });

  it('the Ability plays with the new numbers at once, as if the Run had started with them', () => {
    for (const [c, a, b] of [
      ['lint', 'long_strand', 'quick_shed'],
      ['tumble', 'dense_core', 'collapse'],
      ['zap', 'long_reach', 'arc'],
    ] as const) {
      const { run, sys } = setup([], c);
      run.tuckIn({ type: a, rarity: 3 });
      expect(sys.params).toEqual(abilityParamsFor([{ type: a, rarity: 3 }]));
      run.tuckIn({ type: b, rarity: 5 });
      expect(sys.params).toEqual(setup([{ type: a, rarity: 3 }, { type: b, rarity: 5 }], c).sys.params);
    }
  });

  it('a Decoy already on the floor lasts as long as Long Strand now says', () => {
    const { run, input, sys } = setup([], 'lint');
    input.ability = true;
    run.update(1 / 60);
    const decoy = sys.controller as DecoyAbility;
    expect(decoy.decoy).toBeTruthy();
    run.tuckIn({ type: 'long_strand', rarity: 5 });
    step(run, DECOY.duration + 0.1);
    expect(decoy.decoy).toBeTruthy();
  });

  it('Static Cling and Grounding already on while charged take a tucked-in copy at once', () => {
    /** Magnet radius and suction with the meter full (Static Cling ≥ 50%, Grounding full). */
    const charged = (run: Run, sys: ReturnType<typeof setup>['sys']) => {
      const z = sys.controller as unknown as { charge: number; full: boolean; syncStats(): void };
      z.charge = 1;
      z.full = true;
      z.syncStats();
      return { magnet: run.bunny.stats.get('magnetRadius'), suction: run.bunny.stats.get('suctionMultiplier') };
    };
    for (const type of ['static_cling', 'grounding'] as const) {
      const { run, sys } = setup([{ type, rarity: 3 }]);
      charged(run, sys);
      run.tuckIn({ type, rarity: 5 });
      const two = setup([{ type, rarity: 3 }, { type, rarity: 5 }]);
      const want = charged(two.run, two.sys);
      const got = charged(run, sys);
      expect(got.magnet).toBeCloseTo(want.magnet);
      expect(got.suction).toBeCloseTo(want.suction);
    }
  });

  it('code effects install too: Unmoved replaces its modifiers instead of stacking, Reclaim hooks the Decoy', () => {
    const tumble = setup([], 'tumble');
    tumble.run.tuckIn({ type: 'unmoved', rarity: 5 });
    tumble.run.tuckIn({ type: 'unmoved', rarity: 5 });
    const started = setup([{ type: 'unmoved', rarity: 5 }, { type: 'unmoved', rarity: 5 }]).run.bunny.stats;
    expect(tumble.run.bunny.stats.get('knockbackResistance')).toBeCloseTo(started.get('knockbackResistance'));
    expect(tumble.run.bunny.stats.get('suctionMultiplier')).toBeCloseTo(started.get('suctionMultiplier'));
    expect(getKeepsakeEffects(tumble.run)!.totals).toEqual(getKeepsakeEffects(setup([{ type: 'unmoved', rarity: 5 }, { type: 'unmoved', rarity: 5 }]).run)!.totals);

    const lint = setup([], 'lint');
    expect(lint.sys.hooks.decoyEnded).toBeUndefined();
    lint.run.tuckIn({ type: 'reclaim', rarity: 2 });
    expect(lint.sys.hooks.decoyEnded).toBeTypeOf('function');
    expect(getKeepsakeEffects(lint.run)!.totals.reclaimVolume).toBeCloseTo(val('reclaim', 'volume', 2));
  });
});
