import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/events';
import type { InputState } from '../core/input';
import { AREAS } from '../data/areas';
import { getCharacter } from '../data/characters';
import { CHARACTER_PERK_EFFECTS as FX } from '../data/perks';
import { TUNING } from '../data/tuning';
import { createRun } from '../game/assembly';
import type { Run } from '../game/run';
import { parseRunSnapshot } from '../game/snapshot';
import { hazardFloorFree } from '../hazards/common';
import type { RoboVac9000 } from '../hazards/robovac';
import { growthFactorAt } from '../systems/absorb';
import { maxSpeedFor } from '../systems/movement';
import { COMBAT_SYSTEM_ID, type CombatSystem } from './combat';
import { getTumblePerks, installTumblePerks } from './tumble';

const DT = 1 / 60;

/** A Tumble Run with no spawning, a scriptable input and these starting Perks. */
function setup(perks: string[], seed = 'tumble-perks') {
  const events = new EventBus();
  const run = createRun(events, { seed, characterId: 'tumble', perks }, { hazards: false, pickups: false });
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
  return { run, events, input };
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
  for (let t = 0; t < seconds - 1e-9 && !run.ended; t += DT) run.update(DT);
};

function collect(events: EventBus, name: string): unknown[] {
  const out: unknown[] = [];
  (events as unknown as { on(n: string, f: (e: unknown) => void): void }).on(name, (e) => out.push(e));
  return out;
}

const stack = (id: string, n: number) => Array<string>(n).fill(id);

describe('Snowballing', () => {
  it('adds 0.1 acceleration per stack (0.7 → 1.0) and leaves top speed alone', () => {
    const base = setup([]).run.bunny;
    const { run } = setup(stack('snowballing', 3));
    const b = run.bunny;
    expect(base.stats.get('acceleration')).toBeCloseTo(getCharacter('tumble').stats.acceleration!);
    expect(b.stats.get('acceleration')).toBeCloseTo(base.stats.get('acceleration') + 3 * FX.snowballingAccel);
    expect(b.stats.get('acceleration')).toBeCloseTo(1);
    expect(b.stats.get('speed')).toBeCloseTo(base.stats.get('speed'));
    expect(maxSpeedFor(b)).toBeCloseTo(maxSpeedFor(base));
  });
});

describe('Matted Coat', () => {
  it('starts charged, blocks one hit with i-frames, and is asked before Bubble Wrap', () => {
    const { run, events } = setup(['matted_coat']);
    const b = run.bunny;
    const blocked = collect(events, 'furCoatBlocked');
    b.shield = 1;
    const hp = b.health;
    expect(getTumblePerks(run)!.coat).toEqual({ charged: true, rechargeLeft: 0 });
    expect(b.damage(1, 'test')).toBe(false);
    expect(b.health).toBe(hp);
    expect(b.shield).toBe(1);
    expect(b.invulnerable).toBe(TUNING.invulnerability);
    expect(blocked).toEqual([{ source: 'test' }]);
    b.invulnerable = 0;
    // Spent: Bubble Wrap takes the next one.
    expect(b.damage(1, 'test')).toBe(false);
    expect(b.shield).toBe(0);
    expect(getTumblePerks(run)!.coat!.charged).toBe(false);
  });

  it('recharges after 20 s without damage; a hit that lands restarts the count; 10 s at 3 stacks', () => {
    const { run } = setup(['matted_coat']);
    const b = run.bunny;
    const coat = () => getTumblePerks(run)!.coat!;
    b.damage(1, 'test');
    step(run, 15);
    expect(coat().charged).toBe(false);
    expect(coat().rechargeLeft).toBeCloseTo(5, 1);
    b.invulnerable = 0;
    expect(b.damage(1, 'test')).toBe(true);
    step(run, 15);
    expect(coat().charged).toBe(false);
    step(run, 5.1);
    expect(coat().charged).toBe(true);

    const fast = setup(stack('matted_coat', 3)).run;
    fast.bunny.damage(1, 'test');
    step(fast, FX.mattedCoatRecharge[2] + 0.1);
    expect(getTumblePerks(fast)!.coat!.charged).toBe(true);
  });

  it('a blocked Hazard hit knocks nothing back', () => {
    const { run } = setup(['matted_coat']);
    const b = run.bunny;
    const hp = b.health;
    const h = run.hazards.spawn('roomba', b.x, b.z);
    h.x = b.x + b.radius * 0.5;
    run.hazards.update(DT, run);
    expect(b.health).toBe(hp);
    expect(Math.hypot(b.impulseX, b.impulseZ)).toBe(0);
    expect(getTumblePerks(run)!.coat!.charged).toBe(false);
  });

  it('shows nothing without the Perk', () => {
    expect(getTumblePerks(setup([]).run)!.coat).toBeNull();
  });
});

describe('Shedding', () => {
  /** Volume the Debris on the map gives back when absorbed (r³ units). */
  const worth = (run: Run) => {
    let v = 0;
    const gf = growthFactorAt(run.bunny.realRadius) * AREAS[run.area].growth;
    run.debris.forEach((d) => (v += gf * d.type.mass * d.size ** 3));
    return v;
  };

  it('drops 2 absorbable hair clumps per heart lost, each worth about 0.5% of the volume, for free', () => {
    const { run, events } = setup(['shedding']);
    const b = run.bunny;
    const shed = collect(events, 'hairShed');
    const r = b.radius;
    expect(b.damage(1, 'test')).toBe(true);
    expect(b.radius).toBe(r);
    expect(run.debris.count).toBe(FX.sheddingPieces[0]);
    expect(shed).toHaveLength(1);
    run.debris.forEach((d) => {
      expect(d.type.id).toBe('hair_strand');
      expect(d.size).toBeLessThanOrEqual(r * b.stats.get('absorbRatio'));
      expect(Math.hypot(d.x - b.x, d.z - b.z)).toBeGreaterThan(r);
    });
    expect(worth(run) / r ** 3).toBeGreaterThan(FX.sheddingPieces[0] * FX.sheddingVolume * 0.6);
    expect(worth(run) / r ** 3).toBeLessThan(FX.sheddingPieces[0] * FX.sheddingVolume * 1.4);
  });

  it('scales with stacks and whole hearts lost; half hearts count when they empty one', () => {
    const { run } = setup(stack('shedding', 3));
    const b = run.bunny;
    b.damage(2, 'test');
    expect(run.debris.count).toBe(FX.sheddingPieces[2] * 2);
    run.debris.clear();
    b.invulnerable = 0;
    b.health = 2.5;
    b.damage(0.4, 'test');
    expect(run.debris.count).toBe(0);
    b.invulnerable = 0;
    b.damage(0.2, 'test');
    expect(run.debris.count).toBe(FX.sheddingPieces[2]);
  });

  it('drops nothing on the killing blow or without the Perk', () => {
    const { run } = setup(['shedding']);
    run.bunny.health = 1;
    run.bunny.damage(1, 'test');
    expect(run.ended).toBe(true);
    expect(run.debris.count).toBe(0);
    const plain = setup([]).run;
    plain.bunny.damage(1, 'test');
    expect(plain.debris.count).toBe(0);
  });
});

describe('Heavy Pull', () => {
  const amass = (run: Run, input: InputState) => {
    input.ability = true;
    input.abilityHeld = true;
    run.update(DT);
  };

  it("raises the magnet only while Amassing, within Tumble's 0.75 cap", () => {
    const { run, input } = setup(['heavy_pull']);
    const b = run.bunny;
    const cap = getCharacter('tumble').caps!.magnetRadius!.max!;
    expect(b.stats.get('magnetRadius')).toBe(0);
    amass(run, input);
    expect(b.amassing).toBe(true);
    expect(b.stats.get('magnetRadius')).toBeCloseTo(Math.min(cap, FX.heavyPullMagnet[0]));
    input.abilityHeld = false;
    run.update(DT);
    run.update(DT);
    expect(b.amassing).toBe(false);
    expect(b.stats.get('magnetRadius')).toBe(0);
  });

  it('does nothing without the Perk', () => {
    const { run, input } = setup([]);
    amass(run, input);
    expect(run.bunny.amassing).toBe(true);
    expect(run.bunny.stats.get('magnetRadius')).toBe(0);
  });
});

describe('Heavy Landing', () => {
  it('a Dash ending stuns non-boss Hazards within 1.5 r of the surface, not farther ones or bosses', () => {
    const { run, events } = setup(['heavy_landing']);
    const b = run.bunny;
    const landed = collect(events, 'heavyLanding');
    const near = run.hazards.spawn('roomba', b.x, b.z);
    const far = run.hazards.spawn('roomba', b.x, b.z);
    const boss = run.hazards.spawn('robovac_9000', b.x, b.z) as RoboVac9000;
    const reach = FX.heavyLandingRadius[0] * b.radius;
    const gap = (h: typeof near) => b.radius + (h.shape.kind === 'circle' ? h.shape.radius : Math.max(h.shape.halfW, h.shape.halfD));
    near.x = b.x + gap(near) + reach * 0.8;
    near.z = b.z;
    far.x = b.x - gap(far) - reach * 1.3;
    far.z = b.z;
    boss.x = b.x;
    boss.z = b.z + gap(boss) + reach * 0.5;
    b.dashTime = DT * 1.5;
    run.update(DT);
    run.update(DT);
    expect(b.dashing).toBe(false);
    expect(landed).toHaveLength(1);
    expect(landed[0]).toMatchObject({ hit: 1 });
    expect(near.stunnedFor).toBeGreaterThan(FX.heavyLandingStun[0] - 0.05);
    expect(far.stunnedFor ?? 0).toBe(0);
    expect(boss.stunned).toBe(false);
  });

  it('reaches 2.5 r and stuns 1 s at 3 stacks; nothing without the Perk or on an Area change', () => {
    const { run, events } = setup(stack('heavy_landing', 3));
    const b = run.bunny;
    const landed = collect(events, 'heavyLanding');
    b.dashTime = DT * 1.5;
    run.update(DT);
    run.update(DT);
    expect(landed[0]).toMatchObject({ radius: b.radius * (1 + FX.heavyLandingRadius[2]) });
    b.dashTime = 1;
    run.update(DT);
    run.enterArea('neighborhood');
    run.update(DT);
    expect(landed).toHaveLength(1);

    const plain = setup([]);
    const none = collect(plain.events, 'heavyLanding');
    plain.run.bunny.dashTime = DT * 1.5;
    plain.run.update(DT);
    plain.run.update(DT);
    expect(none).toHaveLength(0);
  });
});

describe('Tumble Perks on Resume', () => {
  it('install once and survive Save & quit', () => {
    const perks = ['snowballing', 'matted_coat', 'shedding', 'heavy_pull', 'heavy_landing'];
    const { run } = setup([...perks, 'snowballing']);
    const sys = getTumblePerks(run)!;
    const combat = run.getSystem<CombatSystem>(COMBAT_SYSTEM_ID)!;
    const guards = combat.guards.length;
    expect(installTumblePerks(run)).toBe(sys);
    expect(combat.guards.length).toBe(guards);

    const snap = parseRunSnapshot(JSON.parse(JSON.stringify(run.toSnapshot())))!;
    const events = new EventBus();
    const back = createRun(events, { seed: snap.seed, characterId: 'tumble', difficulty: snap.difficulty, resume: snap }, { hazards: false, pickups: false });
    for (const id of perks) expect(back.perkStacks(id)).toBe(run.perkStacks(id));
    expect(back.bunny.stats.get('acceleration')).toBeCloseTo(run.bunny.stats.get('acceleration'));
    expect(getTumblePerks(back)!.coat!.charged).toBe(true);
    const shed = collect(events, 'hairShed');
    expect(back.bunny.damage(1, 'test')).toBe(false);
    back.bunny.invulnerable = 0;
    expect(back.bunny.damage(1, 'test')).toBe(true);
    expect(shed).toHaveLength(1);
    // Other Characters get no Tumble System.
    expect(getTumblePerks(createRun(new EventBus(), { seed: 'x', characterId: 'lint' }, { hazards: false, pickups: false }))).toBeUndefined();
  });
});
