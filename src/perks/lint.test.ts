import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/events';
import type { InputState } from '../core/input';
import { CHARACTER_PERK_EFFECTS as FX } from '../data/perks';
import { createRun, installGameplay } from '../game/assembly';
import type { Run } from '../game/run';
import { parseRunSnapshot } from '../game/snapshot';
import { HazardManager, type Hazard } from '../hazards';
import { aimTarget, hazardFloorFree } from '../hazards/common';
import { draftablePerks } from './draft';
import { getLintPerks, installLintPerks } from './lint';

const DT = 1 / 60;
const step = (run: Run, seconds: number) => {
  for (let i = 0; i < Math.round(seconds / DT) && !run.ended; i++) run.update(DT);
};

/** A Lint Run with no spawning (only the Hazards a test places), a scriptable input and open floor. */
function setup(perks: string[] = [], seed = 'lint-perks') {
  const events = new EventBus();
  const run = createRun(events, { seed, characterId: 'lint', perks }, { hazards: false, pickups: false });
  run.removeSystem('spawner'); // only the Debris a test makes
  const input: InputState = { moveX: 0, moveZ: 0, dash: false, ability: false, abilityHeld: false };
  run.input = {
    sample: () => {
      const s = { ...input };
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

/** Clogs a Hazard as the Decoy does (stun + hazardClogged). */
function clog(run: Run, h: Hazard, seconds: number): void {
  h.stunnedFor = seconds;
  run.events.emit('hazardClogged', { hazardId: h.id, defId: h.def.id, boss: !!h.def.boss, seconds });
}

function debrisCount(run: Run): number {
  let n = 0;
  run.debris.forEach(() => n++);
  return n;
}

/** Spawns a Hazard exactly at (x, z). */
function place(run: Run, id: string, x: number, z: number): Hazard {
  const h = run.hazards.spawn(id, x, z);
  h.x = x;
  h.z = z;
  return h;
}

describe('Well-Rounded', () => {
  it('raises the caps per stack without granting the stats', () => {
    const { run } = setup();
    const s = run.bunny.stats;
    const before = { ...s.values };
    run.applyPerk('well_rounded');
    run.applyPerk('well_rounded');
    expect(s.cap('speed')!.max).toBeCloseTo(1.25 + 2 * FX.wellRoundedCaps.speed);
    expect(s.cap('maxHealth')!.max).toBe(7 + 2 * FX.wellRoundedCaps.maxHealth);
    expect(s.cap('magnetRadius')!.max).toBeCloseTo(1 + 2 * FX.wellRoundedCaps.magnetRadius);
    expect(s.cap('knockbackResistance')!.max).toBeCloseTo(0.35 + 2 * FX.wellRoundedCaps.knockbackResistance);
    // Floors are untouched and no stat moved.
    expect(s.cap('dashCooldown')).toEqual({ min: 1.5, reason: expect.any(String) });
    expect(s.values).toEqual(before);
  });

  it('lets capped stats through and re-opens capped stat Perks in the draft', () => {
    const { run } = setup();
    const s = run.bunny.stats;
    for (let i = 0; i < 3; i++) run.applyPerk('aerodynamic'); // 1.331 > 1.25
    expect(s.get('speed')).toBe(1.25);
    expect(s.atCap('speed')).toBe(true);
    expect(draftablePerks(run).map((p) => p.id)).not.toContain('aerodynamic');
    s.add({ stat: 'maxHealth', op: 'add', value: 10, source: 'test' });
    expect(run.bunny.maxHealth).toBe(7);
    run.applyPerk('well_rounded');
    expect(s.atCap('speed')).toBe(false);
    expect(s.get('speed')).toBeCloseTo(1.331);
    expect(draftablePerks(run).map((p) => p.id)).toContain('aerodynamic');
    expect(run.bunny.maxHealth).toBe(8);
  });
});

describe('Smother', () => {
  /** A Roomba 1.05× Lint's absorb limit, touching Lint. */
  function smotherSetup(perks: string[], ratio = 1.05) {
    const env = setup(perks);
    const b = env.run.bunny;
    const h = place(env.run, 'roomba', b.x + 1000, b.z);
    b.setRadius(h.size / (ratio * b.stats.get('absorbRatio')));
    return { ...env, h };
  }

  it('absorbs a clogged non-boss Hazard up to 1.1× the absorb limit on touch', () => {
    const { run, events, h } = smotherSetup(['smother']);
    const absorbed: unknown[] = [];
    events.on('hazardAbsorbed', (e) => absorbed.push(e));
    clog(run, h, 2);
    run.bunny.teleport(h.x, h.z);
    const r0 = run.bunny.radius;
    step(run, DT * 2);
    expect(absorbed).toHaveLength(1);
    expect(run.hazards.hazards).not.toContain(h);
    expect(run.bunny.radius).toBeGreaterThan(r0);
  });

  it('needs the clog, the Perk and the size', () => {
    for (const [perks, clogged, ratio] of [
      [['smother'], false, 1.05],
      [[], true, 1.05],
      [['smother'], true, 1.2],
    ] as const) {
      const { run, h } = smotherSetup([...perks], ratio);
      if (clogged) clog(run, h, 2);
      run.bunny.teleport(h.x, h.z);
      step(run, DT * 2);
      expect(h.dead ?? false).toBe(false);
    }
  });
});

describe('Loose Threads', () => {
  it('drops 1 / 2 / 3 fibre pieces when a clog ends, once per clog', () => {
    const { run } = setup(['loose_threads', 'loose_threads']);
    const b = run.bunny;
    const h = place(run, 'roomba', b.x + b.radius * 6, b.z);
    clog(run, h, 0.5);
    step(run, 0.4);
    expect(debrisCount(run)).toBe(0);
    expect(h.cloggedFor).toBeGreaterThan(0);
    step(run, 0.2);
    expect(debrisCount(run)).toBe(2);
    run.debris.forEach((d) => {
      expect(d.type.id).toBe('lint_ball');
      expect(d.size).toBeLessThanOrEqual(b.radius * b.stats.get('absorbRatio'));
    });
    step(run, 1);
    expect(debrisCount(run)).toBe(2);
    // Another clog, another drop; a clog landing mid-clog only extends it.
    clog(run, h, 0.3);
    step(run, 0.1);
    clog(run, h, 0.3);
    step(run, 0.5);
    expect(debrisCount(run)).toBe(4);
  });

  it('drops nothing if the Hazard is gone before the clog ends', () => {
    const { run } = setup(['loose_threads']);
    const b = run.bunny;
    const h = place(run, 'roomba', b.x + b.radius * 6, b.z);
    clog(run, h, 0.5);
    step(run, 0.2);
    run.hazards.clear();
    step(run, 0.5);
    expect(debrisCount(run)).toBe(0);
    expect(getLintPerks(run)!.clogged.size).toBe(0);
  });
});

describe('Lint Trail', () => {
  /** Dashes Lint along +x and returns the dash's start x. */
  function dash(run: Run, input: InputState): number {
    const x0 = run.bunny.x;
    input.moveX = 1;
    input.dash = true;
    step(run, 0.5);
    input.moveX = 0;
    step(run, DT);
    return x0;
  }

  it('the first Hazard across a Dash streak is clogged for the per-stack time, and the streak is used up', () => {
    const { run, events, input } = setup(['lint_trail', 'lint_trail']);
    const clogs: { seconds: number; boss: boolean }[] = [];
    events.on('hazardClogged', (e) => clogs.push(e));
    const x0 = dash(run, input);
    const b = run.bunny;
    expect(b.x).toBeGreaterThan(x0 + b.radius * 2);
    expect(getLintPerks(run)!.streaks).toHaveLength(1);
    const mid = (x0 + b.x) / 2;
    const a = place(run, 'roomba', mid, b.z);
    a.z = b.z + a.size * 2 + b.radius * 2;
    a.stunnedFor = 5; // parked off the streak
    step(run, DT * 2);
    expect(clogs).toHaveLength(0);
    a.z = b.z; // crosses
    const other = place(run, 'roomba', mid, b.z);
    step(run, DT * 2);
    expect(clogs).toHaveLength(1);
    expect(clogs[0]!.seconds).toBe(FX.lintTrailClog[1]);
    expect(getLintPerks(run)!.streaks).toHaveLength(0);
    expect(other.stunnedFor ?? 0).toBe(0);
  });

  it('lasts 2 s after the Dash ends, and its view is removed', () => {
    const { run, events, input } = setup(['lint_trail']);
    const clogs: unknown[] = [];
    events.on('hazardClogged', (e) => clogs.push(e));
    const children = run.entityRoot.children.length;
    const x0 = dash(run, input);
    expect(run.entityRoot.children.length).toBe(children + 1);
    step(run, FX.lintTrailDuration);
    expect(getLintPerks(run)!.streaks).toHaveLength(0);
    expect(run.entityRoot.children.length).toBe(children);
    place(run, 'roomba', (x0 + run.bunny.x) / 2, run.bunny.z);
    step(run, DT * 2);
    expect(clogs).toHaveLength(0);
  });

  it('leaves no streak without the Perk, and clears on an Area change', () => {
    const plain = setup();
    dash(plain.run, plain.input);
    expect(getLintPerks(plain.run)!.streaks).toHaveLength(0);
    const { run, input } = setup(['lint_trail']);
    dash(run, input);
    run.enterArea('neighborhood');
    step(run, DT);
    expect(getLintPerks(run)!.streaks).toHaveLength(0);
  });
});

describe('Unnoticed', () => {
  it('a Hazard whose clog ended ignores Lint for the per-stack time: no aim and no contact damage', () => {
    const { run } = setup(['unnoticed']);
    const b = run.bunny;
    const h = place(run, 'roomba', b.x + b.radius * 8, b.z);
    expect(aimTarget(run, h.x, h.z, 1e6, h)).not.toBeNull();
    clog(run, h, 0.2);
    step(run, 0.25);
    expect(h.ignoresBunnyFor).toBeGreaterThan(FX.unnoticedFor[0] - 0.1);
    expect(aimTarget(run, h.x, h.z, 1e6, h)).toBeNull();
    // Contact while ignored: no damage (or knockback), but the body still pushes Lint out.
    const health = b.health;
    b.invulnerable = 0;
    b.teleport(h.x + h.size * 0.5, h.z);
    run.hazards.update(DT, run);
    expect(b.health).toBe(health);
    expect(b.harmless).toBe(false);
    expect(HazardManager.touches(run, h)).toBe(false);
    step(run, FX.unnoticedFor[0]);
    expect(h.ignoresBunnyFor).toBe(0);
    expect(aimTarget(run, h.x, h.z, 1e6, h)).not.toBeNull();
    b.invulnerable = 0;
    h.stunnedFor = 0;
    b.teleport(h.x + h.size * 0.5, h.z);
    run.hazards.update(DT, run);
    expect(b.health).toBeLessThan(health);
  });

  it('skips bosses (Loose Threads still drops from them)', () => {
    const { run } = setup(['unnoticed', 'loose_threads']);
    const b = run.bunny;
    const boss = run.hazards.spawn('robovac_9000', b.x + 400, b.z);
    clog(run, boss, 0.2);
    step(run, 0.3);
    expect(boss.ignoresBunnyFor ?? 0).toBe(0);
    expect(debrisCount(run)).toBeGreaterThanOrEqual(1);
  });

  it('does nothing without the Perk', () => {
    const { run } = setup();
    const h = place(run, 'roomba', run.bunny.x + 400, run.bunny.z);
    clog(run, h, 0.2);
    step(run, 0.3);
    expect(h.ignoresBunnyFor ?? 0).toBe(0);
  });
});

describe('Lint Perks install and Resume', () => {
  it('installs once, chaining a single contact override', () => {
    const { run } = setup(['smother']);
    const sys = getLintPerks(run)!;
    const override = run.hazards.contactOverride;
    expect(installLintPerks(run)).toBe(sys);
    installGameplay(run, { hazards: false, pickups: false });
    expect(run.hazards.contactOverride).toBe(override);
    expect(run.getSystem('lintPerks')).toBe(sys);
    expect(getLintPerks(setup().run)).toBeDefined();
    expect(getLintPerks(createRun(new EventBus(), { seed: 'z', characterId: 'zap' }, { hazards: false, pickups: false }))).toBeUndefined();
  });

  it('survives Save & quit: caps, stacks and effects', () => {
    const { run } = setup(['well_rounded', 'smother', 'lint_trail']);
    run.applyPerk('well_rounded');
    run.applyPerk('unnoticed');
    const snap = parseRunSnapshot(JSON.parse(JSON.stringify(run.toSnapshot())))!;
    const back = createRun(new EventBus(), { seed: snap.seed, characterId: snap.characterId, difficulty: snap.difficulty, modifiers: snap.modifiers, loadout: snap.loadout, resume: snap });
    expect(back.perkStacks('well_rounded')).toBe(2);
    expect(back.bunny.stats.cap('speed')!.max).toBeCloseTo(1.25 + 2 * FX.wellRoundedCaps.speed);
    expect(back.bunny.stats.cap('maxHealth')!.max).toBe(9);
    const sys = getLintPerks(back)!;
    expect(sys).toBeDefined();
    // The clog tracker runs after Resume.
    back.hazards.director = null;
    const b = back.bunny;
    const h = back.hazards.spawn('roomba', b.x + b.radius * 8, b.z);
    clog(back, h, 0.2);
    for (let i = 0; i < 15; i++) back.update(DT);
    expect(h.ignoresBunnyFor).toBeGreaterThan(0);
  });
});
