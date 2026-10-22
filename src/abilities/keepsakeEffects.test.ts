import { describe, expect, it } from 'vitest';
import { NO_INPUT, type InputState } from '../core/input';
import { EventBus } from '../core/events';
import { DECOY, DISCHARGE, HUNKER } from '../data/abilities';
import { ROBOVAC_9000 } from '../data/hazards';
import { effectValue, getKeepsakeType, KEEPSAKE_FLOORS, keepsakeTypesFor, type KeepsakeTypeId, type Loadout } from '../data/keepsakes';
import { createRun } from '../game/assembly';
import type { Run } from '../game/run';
import { aimTarget, hazardFloorFree } from '../hazards/common';
import type { RoboVac9000 } from '../hazards/robovac';
import { growthFactorAt } from '../systems/absorb';
import { maxSpeedFor } from '../systems/movement';
import { hazardRadius } from './system';
import { abilityParamsFor, baseAbilityParams, getAbilitySystem, getKeepsakeEffects, type DecoyAbility, type DischargeAbility, type HunkerAbility } from './index';

const CHAR: Record<string, string> = Object.fromEntries(['lint', 'tumble', 'zap'].flatMap((c) => keepsakeTypesFor(c).map((t) => [t.id, c])));

/** One Keepsake's value at a grade. */
const val = (type: KeepsakeTypeId, key: string, grade: number) => effectValue(getKeepsakeType(type)!, key, grade);

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

/** Plants a Tumble (held) this tick. */
function plant(run: Run, input: InputState) {
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
          const loadout: Loadout = [{ type: a.id, grade: 4 }, { type: b.id, grade: 7 }];
          expect(setup(loadout, c).sys.params).toEqual(abilityParamsFor(loadout));
        }
      }
    }
  });

  it('two copies add together', () => {
    const one = abilityParamsFor([{ type: 'long_reach', grade: 4 }]);
    const two = abilityParamsFor([{ type: 'long_reach', grade: 4 }, { type: 'long_reach', grade: 4 }]);
    expect(two.discharge.range - DISCHARGE.range).toBeCloseTo(2 * (one.discharge.range - DISCHARGE.range));
  });
});

describe('Lint · Decoy Keepsakes', () => {
  it('Long Strand: the Decoy lasts longer', () => {
    const extra = val('long_strand', 'duration', 4);
    const { run, input, sys } = setup([{ type: 'long_strand', grade: 4 }]);
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
    expect(abilityParamsFor([{ type: 'quick_shed', grade: 4 }]).decoy.cooldown).toBeCloseTo(DECOY.cooldown * (1 - cut));
    const two10 = abilityParamsFor([{ type: 'quick_shed', grade: 10 }, { type: 'quick_shed', grade: 10 }]).decoy;
    expect(DECOY.cooldown * (1 - 0.9)).toBeLessThan(DECOY.duration);
    expect(two10.cooldown).toBe(two10.duration * KEEPSAKE_FLOORS.decoyCooldownPerDuration);
    const { run, input, sys, events } = setup([{ type: 'quick_shed', grade: 4 }]);
    const ended = collect(events, 'abilityEnded');
    input.ability = true;
    run.update(1 / 60);
    step(run, DECOY.duration + 0.05);
    expect(ended[0]!.cooldown).toBeCloseTo(sys.params.decoy.cooldown);
  });

  it('Thick Clog: longer clog stun, bosses get half the bonus', () => {
    const bonus = val('thick_clog', 'clogStun', 4);
    const { run, input, sys, events } = setup([{ type: 'thick_clog', grade: 4 }]);
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
    const g = 10;
    const { run, input, sys } = setup([{ type: 'dinner_bell', grade: g }]);
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
    const { run, input, sys } = setup([{ type: 'reclaim', grade: g }]);
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

describe('Tumble · Hunker Keepsakes', () => {
  it('Loose Roots: less cooldown per second held, never below 0.2 s', () => {
    const saved = val('loose_roots', 'perSecondSaved', 1);
    expect(saved).toBeGreaterThan(0);
    const { run, input, sys, events } = setup([{ type: 'loose_roots', grade: 1 }]);
    const ended = collect(events, 'abilityEnded');
    plant(run, input);
    step(run, 2);
    input.abilityHeld = false;
    run.update(1 / 60);
    const held = (sys.controller as HunkerAbility).held;
    expect(ended[0]!.cooldown).toBeCloseTo(HUNKER.cooldownBase + (HUNKER.cooldownPerSecondHeld - saved) * held);
    expect(abilityParamsFor([{ type: 'loose_roots', grade: 10 }, { type: 'loose_roots', grade: 10 }]).hunker.cooldownPerSecondHeld).toBe(KEEPSAKE_FLOORS.hunkerPerSecondHeld);
  });

  it('Bristle Back: a Hazard touching the planted Tumble is stunned and knocked back', () => {
    const g = 4;
    const { run, input } = setup([{ type: 'bristle_back', grade: g }]);
    const b = run.bunny;
    b.setRadius(5);
    plant(run, input);
    const h = run.hazards.spawn('roomba', b.x + b.radius + 9, b.z);
    const d0 = Math.hypot(h.x - b.x, h.z - b.z);
    run.update(1 / 60);
    expect(h.stunnedFor).toBeGreaterThan(val('bristle_back', 'stun', g) - 0.1);
    expect(getKeepsakeEffects(run)!.knocking).toBe(1);
    step(run, 0.3);
    expect(Math.hypot(h.x - b.x, h.z - b.z) - d0).toBeGreaterThan(val('bristle_back', 'knockback', g) * b.radius * 0.9);
    expect(b.health).toBe(b.maxHealth);
  });

  it('Snowball: magnet bonus while planted, on top of the cap', () => {
    const bonus = val('snowball', 'magnet', 4);
    const { run, input } = setup([{ type: 'snowball', grade: 4 }], 'tumble');
    const b = run.bunny;
    b.stats.add({ stat: 'magnetRadius', op: 'add', value: 5, source: 'test:perk' }); // far over the 0.75 cap
    const capped = b.stats.get('magnetRadius');
    expect(capped).toBeCloseTo(0.75);
    plant(run, input);
    expect(b.stats.get('magnetRadius')).toBeCloseTo(capped + bonus);
    input.abilityHeld = false;
    run.update(1 / 60);
    expect(b.stats.get('magnetRadius')).toBeCloseTo(capped);
  });

  it('Dead Weight: the Hunker chip keeps the boss stunned longer and knocks more parts loose', () => {
    const g = 4;
    const chipped = (loadout: Loadout) => {
      const { run, input, events } = setup(loadout, 'tumble');
      const b = run.bunny;
      b.setRadius(30);
      plant(run, input);
      const boss = run.hazards.spawn('robovac_9000', b.x + ROBOVAC_9000.contactRadius + b.radius - 3, b.z) as RoboVac9000;
      boss.state = 'charge';
      const hits = collect(events, 'bossHit');
      const debris0 = run.debris.count;
      run.update(1 / 60);
      expect(hits).toHaveLength(1);
      const parts = run.debris.count - debris0;
      let stunned = 0;
      while ((boss.state as string) === 'stunned' && stunned < 10) {
        run.update(1 / 60);
        stunned += 1 / 60;
      }
      return { parts, stunned };
    };
    const base = chipped([]);
    const dw = chipped([{ type: 'dead_weight', grade: g }]);
    expect(dw.stunned - base.stunned).toBeCloseTo(val('dead_weight', 'bossStun', g), 1);
    expect(dw.parts - base.parts).toBe(Math.round(val('dead_weight', 'extraParts', g)));
  });

  it('Thick Undercoat: always-on knockback resistance and suction, below the cap (two grade-10 copies land on it)', () => {
    const g = 4;
    const { run } = setup([{ type: 'thick_undercoat', grade: g }]);
    const s = run.bunny.stats;
    expect(s.get('knockbackResistance')).toBeCloseTo(0.5 + val('thick_undercoat', 'knockbackResistance', g));
    expect(s.get('suctionMultiplier')).toBeCloseTo(1 - val('thick_undercoat', 'suction', g));
    const two = setup([{ type: 'thick_undercoat', grade: 10 }, { type: 'thick_undercoat', grade: 10 }]).run.bunny.stats;
    expect(two.get('knockbackResistance')).toBeCloseTo(0.9);
    expect(two.get('suctionMultiplier')).toBeCloseTo(0.6);
    // A Perk on top can't go past the cap.
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
    const { run, sys } = setup([{ type: 'live_wire', grade: 4 }]);
    const ctl = sys.controller as DischargeAbility;
    const perSec = maxSpeedFor(run.bunny) / run.bunny.radius;
    roll(run, ctl, (DISCHARGE.fillDistance / perSec) * 0.5);
    expect(ctl.charge).toBeCloseTo(0.5 * (1 + rate), 1);
  });

  it('Long Reach: targets further away', () => {
    const extra = val('long_reach', 'range', 4);
    const { run, sys } = setup([{ type: 'long_reach', grade: 4 }]);
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
    const { run, input, sys, events } = setup([{ type: 'arc', grade: 4 }]);
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
    const { run, sys } = setup([{ type: 'static_cling', grade: 4 }]);
    const ctl = sys.controller as DischargeAbility;
    const s = run.bunny.stats;
    const m0 = s.get('magnetRadius');
    ctl.charge = 0.6;
    roll(run, ctl, 1 / 60);
    expect(s.get('magnetRadius')).toBeCloseTo(m0 + bonus);
    ctl.charge = 0.2;
    roll(run, ctl, 1 / 60);
    expect(s.get('magnetRadius')).toBeCloseTo(m0);
    // Two grade-10 copies stay under Zap's 2.2 cap, and a Perk on top stops at it.
    const two = setup([{ type: 'static_cling', grade: 10 }, { type: 'static_cling', grade: 10 }]);
    const ctl2 = two.sys.controller as DischargeAbility;
    two.run.bunny.stats.add({ stat: 'magnetRadius', op: 'add', value: 3, source: 'test:perk' });
    ctl2.charge = 0.6;
    roll(two.run, ctl2, 1 / 60);
    expect(two.run.bunny.stats.get('magnetRadius')).toBeCloseTo(2.2);
  });

  it('Grounding: less suction while the meter is full, never below the 1.2 floor', () => {
    const cut = val('grounding', 'suction', 4);
    const { run, sys } = setup([{ type: 'grounding', grade: 4 }]);
    const ctl = sys.controller as DischargeAbility;
    const s = run.bunny.stats;
    ctl.charge = 1;
    roll(run, ctl, 1 / 60);
    expect(s.get('suctionMultiplier')).toBeCloseTo(1.5 * (1 - cut));
    const two = setup([{ type: 'grounding', grade: 10 }, { type: 'grounding', grade: 10 }]);
    const ctl2 = two.sys.controller as DischargeAbility;
    two.run.bunny.stats.add({ stat: 'suctionMultiplier', op: 'mul', value: 0.5, source: 'test:perk' });
    ctl2.charge = 1;
    roll(two.run, ctl2, 1 / 60);
    expect(two.run.bunny.stats.get('suctionMultiplier')).toBeCloseTo(1.2);
  });
});
