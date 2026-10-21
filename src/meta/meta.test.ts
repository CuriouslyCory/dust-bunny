import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/events';
import { getCharacter } from '../data/characters';
import { getUpgrade, UPGRADES } from '../data/upgrades';
import { BASE_BUNNY_STATS, computeStats } from '../entities/stats';
import { Run } from '../game/run';
import type { RunStats } from '../game/runStats';
import { registerPerks } from '../perks/perks';
import { fluffForRun } from './fluff';
import { MetaProgress } from './meta';
import { defaultSave, type KeyValueStorage, parseSave, SAVE_KEY, SAVE_VERSION, SaveStore } from './save';
import { upgradeCost, upgradeModifiers } from './upgrades';

registerPerks();

const memStorage = (init: Record<string, string> = {}): KeyValueStorage & { map: Map<string, string> } => {
  const map = new Map(Object.entries(init));
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
};

const stats = (over: Partial<RunStats> = {}): RunStats => ({
  seed: 's',
  characterId: 'lint',
  timeSec: 60,
  maxRadius: 10,
  finalRadius: 10,
  debrisAbsorbed: 400,
  hazardsAbsorbed: 0,
  tierReached: 3,
  tierTimes: {},
  perks: [],
  area: 'house',
  houseCleared: false,
  ...over,
});

describe('stat stacking: Character + Upgrades + Perks', () => {
  it('Zap with Fast Feet 2 and two Aerodynamic stacks multiplies speed', () => {
    const run = new Run(new EventBus(), { seed: 'stack', characterId: 'zap', modifiers: upgradeModifiers({ fast_feet: 2 }) });
    expect(run.bunny.stats.get('speed')).toBeCloseTo(1.3 * 1.1);
    run.applyPerk('aerodynamic');
    run.applyPerk('aerodynamic');
    expect(run.bunny.stats.get('speed')).toBeCloseTo(1.3 * 1.1 * 1.1 * 1.1);
  });

  it('adds happen before multiplies regardless of source order', () => {
    const base = { ...BASE_BUNNY_STATS, ...getCharacter('tumble').stats };
    const s = computeStats(base, [
      { stat: 'startRadius', op: 'mul', value: 1.3, source: 'upgrade:head_start' },
      { stat: 'startRadius', op: 'add', value: 0.1, source: 'test' },
    ]);
    expect(s.startRadius).toBeCloseTo((1.2 + 0.1) * 1.3);
  });

  it('Extra Heart + Thick Fur raise max health and current health', () => {
    const run = new Run(new EventBus(), { seed: 'hp', characterId: 'tumble', modifiers: upgradeModifiers({ extra_heart: 2 }) });
    expect(run.bunny.maxHealth).toBe(7);
    expect(run.bunny.health).toBe(7);
    run.bunny.damage(1, 'test');
    run.applyPerk('thick_fur');
    expect(run.bunny.maxHealth).toBe(8);
    expect(run.bunny.health).toBe(7);
  });

  it('Wide Choice and Reroll map to draft stats; Slippery clamps at 75%', () => {
    const run = new Run(new EventBus(), { seed: 'w', characterId: 'lint', modifiers: upgradeModifiers({ wide_choice: 1, reroll: 1 }) });
    expect(run.bunny.stats.get('perkChoices')).toBe(4);
    expect(run.bunny.stats.get('perkRerolls')).toBe(1);
    run.bunny.stats.add({ stat: 'dodgeChance', op: 'add', value: 2, source: 'test' });
    expect(run.bunny.stats.get('dodgeChance')).toBe(0.75);
  });

  it('ignores unknown Upgrade ids and clamps levels to the max', () => {
    const mods = upgradeModifiers({ fast_feet: 99, nope: 3 });
    expect(mods).toHaveLength(1);
    expect(mods[0]!.value).toBeCloseTo(1 + 0.05 * getUpgrade('fast_feet')!.maxLevel);
  });
});

describe('fluffForRun', () => {
  it('follows the design formula', () => {
    // 10×2 + 400/20 + 3×10 = 70
    expect(fluffForRun('died', stats())).toBe(70);
    expect(fluffForRun('quit', stats({ maxRadius: 1.26, debrisAbsorbed: 19, tierReached: 1 }))).toBe(Math.floor(2.52 + 0.95 + 10));
  });

  it('multiplies by 1.5 on victory before flooring', () => {
    expect(fluffForRun('victory', stats({ maxRadius: 50.3, debrisAbsorbed: 3001, tierReached: 5 }))).toBe(Math.floor((100.6 + 150.05 + 50) * 1.5));
    expect(fluffForRun('died', stats({ maxRadius: 80, debrisAbsorbed: 2000, tierReached: 6, houseCleared: true }))).toBe(Math.floor((160 + 100 + 60) * 1.25));
  });
});

describe('upgrade cost curve', () => {
  it('escalates per level, rounds to 5 and stops at max level', () => {
    for (const u of UPGRADES) {
      let prev = 0;
      for (let lvl = 0; lvl < u.maxLevel; lvl++) {
        const c = upgradeCost(u, lvl)!;
        expect(c % 5).toBe(0);
        expect(c).toBeGreaterThan(prev);
        prev = c;
      }
      expect(upgradeCost(u, u.maxLevel)).toBeNull();
    }
    const ff = getUpgrade('fast_feet')!;
    expect([0, 1, 2].map((l) => upgradeCost(ff, l))).toEqual([40, 70, 130]);
  });
});

describe('save data', () => {
  it('returns defaults for empty storage', () => {
    expect(parseSave(null)).toEqual({ data: defaultSave(), status: 'empty' });
  });

  it('round-trips through SaveStore', () => {
    const storage = memStorage();
    const a = new SaveStore(storage);
    a.update((d) => {
      d.fluff = 42;
      d.upgrades.fast_feet = 2;
      d.settings.masterVolume = 0.5;
    });
    const b = new SaveStore(storage);
    expect(b.status).toBe('ok');
    expect(b.data.fluff).toBe(42);
    expect(b.data.upgrades).toEqual({ fast_feet: 2 });
    expect(b.data.settings.masterVolume).toBe(0.5);
    expect(JSON.parse(storage.map.get(SAVE_KEY)!).version).toBe(SAVE_VERSION);
  });

  it('migrates an unversioned legacy save', () => {
    const { data, status } = parseSave(JSON.stringify({ fluff: 12, upgrades: { reroll: 1 }, character: 'zap', bestRadius: 33 }));
    expect(status).toBe('migrated');
    expect(data.version).toBe(1);
    expect(data.fluff).toBe(12);
    expect(data.upgrades).toEqual({ reroll: 1 });
    expect(data.lastCharacterId).toBe('zap');
    expect(data.stats.bestRadius).toBe(33);
  });

  it('falls back field by field on bad values', () => {
    const { data } = parseSave(
      JSON.stringify({ version: 1, fluff: -5, upgrades: { a: 'x', b: 2.7, c: -1 }, lastCharacterId: 7, settings: { q: { nested: 1 }, sfxVolume: 0.3 }, stats: { runs: 'many', wins: 2 } }),
    );
    expect(data.fluff).toBe(0);
    expect(data.upgrades).toEqual({ b: 2 });
    expect(data.lastCharacterId).toBeNull();
    expect(data.settings).toEqual({ sfxVolume: 0.3 });
    expect(data.stats.runs).toBe(0);
    expect(data.stats.wins).toBe(2);
  });

  it('remembers the Difficulty, reading missing or unknown values as casual', () => {
    expect(defaultSave().lastDifficulty).toBe('casual');
    expect(parseSave(JSON.stringify({ version: 1, lastDifficulty: 'hardcore' })).data.lastDifficulty).toBe('hardcore');
    expect(parseSave(JSON.stringify({ version: 1, lastDifficulty: 'nightmare' })).data.lastDifficulty).toBe('casual');
    expect(parseSave(JSON.stringify({ version: 1, fluff: 3 })).data.lastDifficulty).toBe('casual');
  });

  it('treats corrupt JSON as defaults and backs it up', () => {
    const storage = memStorage({ [SAVE_KEY]: '{"fluff": 10,' });
    const store = new SaveStore(storage);
    expect(store.status).toBe('corrupt');
    expect(store.data).toEqual(defaultSave());
    expect(storage.map.get(`${SAVE_KEY}:corrupt`)).toBe('{"fluff": 10,');
    for (const raw of ['[]', '"str"', '42', 'null']) expect(parseSave(raw).data).toEqual(defaultSave());
  });

  it('survives storage that throws', () => {
    const broken: KeyValueStorage = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    const store = new SaveStore(broken);
    expect(store.data).toEqual(defaultSave());
    expect(store.save()).toBe(false);
  });
});

describe('MetaProgress', () => {
  it('awards Fluff once per runEnded payload and records stats', () => {
    const meta = new MetaProgress(memStorage());
    const e = { reason: 'victory' as const, stats: stats({ maxRadius: 50 }) };
    const a = meta.awardRun(e);
    expect(a.fluff).toBe(Math.floor((100 + 20 + 30) * 1.5));
    expect(meta.awardRun(e)).toBe(a);
    expect(meta.fluff).toBe(a.fluff);
    expect(meta.data.stats).toMatchObject({ runs: 1, wins: 1, bestRadius: 50, bestTier: 3 });
  });

  it('buys Upgrades, persists them and refuses when poor or maxed', () => {
    const storage = memStorage();
    const meta = new MetaProgress(storage);
    expect(meta.buy('wide_choice')).toEqual({ ok: false, reason: 'poor' });
    meta.store.update((d) => (d.fluff = 1000));
    expect(meta.buy('wide_choice')).toEqual({ ok: true, level: 1, cost: 220 });
    expect(meta.buy('wide_choice')).toEqual({ ok: false, reason: 'maxed' });
    expect(meta.buy('bogus')).toEqual({ ok: false, reason: 'unknown' });
    const reloaded = new MetaProgress(storage);
    expect(reloaded.level('wide_choice')).toBe(1);
    expect(reloaded.fluff).toBe(780);
    expect(reloaded.runModifiers()).toEqual([{ stat: 'perkChoices', op: 'add', value: 1, source: 'upgrade:wide_choice' }]);
  });
});
