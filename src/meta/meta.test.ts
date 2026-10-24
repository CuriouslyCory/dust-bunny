import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/events';
import { getCharacter } from '../data/characters';
import { getUpgrade, UPGRADES } from '../data/upgrades';
import { BASE_BUNNY_STATS, computeStats } from '../entities/stats';
import { Run } from '../game/run';
import type { RunStats } from '../game/runStats';
import { registerPerks } from '../perks/perks';
import { CREDITED_RUNS_MAX } from '../shared/runCredit';
import { CREDITED_RUNS_MIRROR_KEY, CREDITED_RUNS_MIRROR_VERSION, LOCAL_CREDITS_MAX } from './creditedRuns';
import { fluffForRun, VICTORY_FLUFF_MULTIPLIER } from './fluff';
import { AREA_ORDER } from '../world/types';
import { endsUniverse, MetaProgress } from './meta';
import { defaultSave, type KeyValueStorage, parseSave, SAVE_KEY, SAVE_VERSION, type SaveStorageEvent, SaveStore } from './save';
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
    // 3×4 + 10/30 + 400/1000 = 12.73
    expect(fluffForRun('died', stats())).toBe(12);
    expect(fluffForRun('quit', stats({ maxRadius: 1.26, debrisAbsorbed: 19, tierReached: 1 }))).toBe(Math.floor(4 + 1.26 / 30 + 19 / 1000));
  });

  it('multiplies by the victory multiplier before flooring', () => {
    expect(fluffForRun('victory', stats({ maxRadius: 50.3, debrisAbsorbed: 3001, tierReached: 5 }))).toBe(Math.floor((20 + 50.3 / 30 + 3001 / 1000) * VICTORY_FLUFF_MULTIPLIER));
    expect(fluffForRun('died', stats({ maxRadius: 80, debrisAbsorbed: 2000, tierReached: 6, houseCleared: true }))).toBe(Math.floor((24 + 80 / 30 + 2000 / 1000) * 1.25));
  });

  it('pays a Casual win about one base-level Upgrade', () => {
    // A typical full completion: top Tier, radius past the 300 cm cap, ~3500 Debris.
    const win = stats({ maxRadius: 650, debrisAbsorbed: 3500, tierReached: 9, houseCleared: true, neighborhoodCleared: true });
    const casual = fluffForRun('victory', win);
    expect(casual).toBeGreaterThanOrEqual(40);
    expect(casual).toBeLessThanOrEqual(90);
    expect(fluffForRun('victory', { ...win, difficulty: 'arcade' })).toBeLessThanOrEqual(180);
    const hardcore = fluffForRun('victory', { ...win, difficulty: 'hardcore' });
    expect(hardcore).toBeGreaterThanOrEqual(300);
    expect(hardcore).toBeLessThanOrEqual(450);
  });

  it('scales the radius term per Area, in each Area\'s own unit (no cap)', () => {
    const area = (a: 'house' | 'neighborhood' | 'city' | 'region', radiusIn: number, maxRadius: number) => ({ area: a, startSec: 0, timeSec: 60, radiusIn, maxRadius, debrisAbsorbed: 0, cleared: true });
    const areas = [area('house', 1, 52), area('neighborhood', 52, 214), area('city', 214, 820), area('region', 0.82, 4.2)];
    const term = 51 / 30 + 162 / 60 + 606 / 120 + 3.38 * 1.5;
    const win = stats({ maxRadius: 4200, debrisAbsorbed: 0, tierReached: 11, areas, houseCleared: true, neighborhoodCleared: true });
    expect(fluffForRun('victory', win)).toBe(Math.floor((44 + term) * VICTORY_FLUFF_MULTIPLIER));
    // Reaching the Region but dying there pays the City-cleared multiplier.
    expect(fluffForRun('died', { ...win, cityCleared: true })).toBe(Math.floor((44 + term) * 1.45));
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
    expect(parseSave(null)).toEqual({ data: defaultSave(), status: 'empty', lostCreditedRuns: false });
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

  it('reads universes as a non-negative integer (missing: 0)', () => {
    expect(defaultSave().universes).toBe(0);
    expect(parseSave(JSON.stringify({ version: 1, fluff: 3 })).data.universes).toBe(0);
    expect(parseSave(JSON.stringify({ version: 1, universes: 4 })).data.universes).toBe(4);
    expect(parseSave(JSON.stringify({ version: 1, universes: 2.9 })).data.universes).toBe(2);
    for (const bad of [-1, 'x', null, Infinity]) expect(parseSave(JSON.stringify({ version: 1, universes: bad })).data.universes).toBe(0);
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

/** Stands in for `window`: `fire` delivers a `storage` event as another tab's write would. */
const tabEvents = () => {
  const listeners = new Set<(e: SaveStorageEvent) => void>();
  return {
    addEventListener: (_type: 'storage', l: (e: SaveStorageEvent) => void) => void listeners.add(l),
    removeEventListener: (_type: 'storage', l: (e: SaveStorageEvent) => void) => void listeners.delete(l),
    fire: (e: SaveStorageEvent) => listeners.forEach((l) => l(e)),
    get count() {
      return listeners.size;
    },
  };
};

describe('save shared between tabs', () => {
  it("keeps both tabs' changes: each write starts from what is stored", () => {
    const storage = memStorage();
    const a = new SaveStore(storage);
    const b = new SaveStore(storage);
    a.update((d) => {
      d.fluff += 50;
      d.upgrades.fast_feet = 1;
    });
    b.update((d) => {
      d.settings.masterVolume = 0.3;
    });
    const stored = parseSave(storage.map.get(SAVE_KEY)).data;
    expect(stored.fluff).toBe(50);
    expect(stored.upgrades).toEqual({ fast_feet: 1 });
    expect(stored.settings.masterVolume).toBe(0.3);
    expect(b.data).toEqual(stored);
  });

  it("follows another tab's write from its storage event and notifies listeners", () => {
    const storage = memStorage();
    const events = tabEvents();
    const a = new SaveStore(storage, SAVE_KEY, events);
    const seen: number[] = [];
    a.onChange((d) => seen.push(d.fluff));
    new SaveStore(storage).update((d) => (d.fluff = 75));
    events.fire({ key: 'something-else', storageArea: storage });
    expect(seen).toEqual([]);
    events.fire({ key: SAVE_KEY, storageArea: storage });
    expect(a.data.fluff).toBe(75);
    expect(seen).toEqual([75]);
    // Nothing new stored (or another storage area): no change, no notification.
    events.fire({ key: SAVE_KEY, storageArea: storage });
    events.fire({ key: SAVE_KEY, storageArea: memStorage() });
    expect(seen).toEqual([75]);
    a.dispose();
    expect(events.count).toBe(0);
  });

  it("backs up another tab's unreadable value like one found at load", () => {
    const storage = memStorage();
    const events = tabEvents();
    const a = new SaveStore(storage, SAVE_KEY, events);
    a.update((d) => (d.fluff = 10));
    storage.map.set(SAVE_KEY, '{"fluff": 3,');
    events.fire({ key: null });
    expect(a.data).toEqual(defaultSave());
    expect(a.status).toBe('empty');
    expect(storage.map.get(`${SAVE_KEY}:corrupt`)).toBe('{"fluff": 3,');
  });

  it('keeps an unsaved change when storage refuses the write', () => {
    let full = false;
    const map = new Map<string, string>();
    const storage: KeyValueStorage = {
      getItem: (k) => map.get(k) ?? null,
      setItem: (k, v) => {
        if (full) throw new Error('quota');
        map.set(k, v);
      },
    };
    const store = new SaveStore(storage);
    store.update((d) => (d.fluff = 5));
    full = true;
    store.update((d) => (d.fluff += 1));
    store.update((d) => (d.fluff += 1));
    expect(store.data.fluff).toBe(7);
  });

  it("refuses a purchase the other tab's spending made unaffordable, and never buys a level twice", () => {
    const storage = memStorage({ [SAVE_KEY]: JSON.stringify({ ...defaultSave(), fluff: 260 }) });
    const tabA = new MetaProgress(storage);
    const tabB = new MetaProgress(storage);
    expect(tabA.buy('wide_choice')).toEqual({ ok: true, level: 1, cost: 220 });
    expect(tabB.fluff).toBe(260); // stale until it next reads
    expect(tabB.buy('wide_choice')).toEqual({ ok: false, reason: 'maxed' });
    expect(tabB.fluff).toBe(40);
    expect(tabB.buy('fast_feet')).toEqual({ ok: true, level: 1, cost: 40 });
    expect(tabA.buy('fast_feet')).toEqual({ ok: false, reason: 'poor' });
    const stored = parseSave(storage.map.get(SAVE_KEY)).data;
    expect(stored.fluff).toBe(0);
    expect(stored.upgrades).toEqual({ wide_choice: 1, fast_feet: 1 });
  });

  it("credits a Run in one tab on top of the other tab's purchase", () => {
    const storage = memStorage({ [SAVE_KEY]: JSON.stringify({ ...defaultSave(), fluff: 220 }) });
    const tabA = new MetaProgress(storage);
    const tabB = new MetaProgress(storage);
    tabA.buy('wide_choice');
    const award = tabB.awardRun({ runKey: 'r1', reason: 'died', stats: stats() })!;
    expect(award.total).toBe(award.fluff);
    expect(new MetaProgress(storage).data).toMatchObject({ fluff: award.fluff, upgrades: { wide_choice: 1 }, stats: { runs: 1 } });
  });
});

describe('MetaProgress', () => {
  it('awards Fluff once per Run key and records stats; the key is remembered with the Fluff', () => {
    const storage = memStorage();
    const meta = new MetaProgress(storage);
    const e = { runKey: 'run-a', reason: 'victory' as const, stats: stats({ maxRadius: 50 }) };
    const a = meta.awardRun(e)!;
    expect(a.fluff).toBe(Math.floor((12 + 50 / 30 + 400 / 1000) * VICTORY_FLUFF_MULTIPLIER));
    expect(meta.credited('run-a')).toBe(true);
    // The same key again, from any payload (another tab's copy, a ledger row), adds nothing.
    expect(meta.awardRun(e)).toBeNull();
    expect(meta.awardRun({ ...e, stats: stats({ maxRadius: 500 }) })).toBeNull();
    expect(new MetaProgress(storage).awardRun(e)).toBeNull();
    expect(meta.fluff).toBe(a.fluff);
    expect(meta.data.stats).toMatchObject({ runs: 1, wins: 1, bestRadius: 50, bestTier: 3 });
    expect(parseSave(storage.map.get(SAVE_KEY)).data.creditedRuns).toEqual(['run-a']);
  });

  it('remembers the newest CREDITED_RUNS_MAX keys, oldest dropped first', () => {
    const meta = new MetaProgress(memStorage());
    for (let i = 0; i < CREDITED_RUNS_MAX + 5; i++) expect(meta.awardRun({ runKey: `k${i}`, reason: 'died', stats: stats() })).not.toBeNull();
    expect(meta.data.creditedRuns).toHaveLength(CREDITED_RUNS_MAX);
    expect(meta.data.creditedRuns[0]).toBe('k5');
    expect(meta.data.creditedRuns.at(-1)).toBe(`k${CREDITED_RUNS_MAX + 4}`);
    expect(meta.credited('k4')).toBe(false); // aged out: a repeat would count again (the sweep fetches far fewer than this)
    expect(meta.data.stats.runs).toBe(CREDITED_RUNS_MAX + 5);
  });

  it('reads creditedRuns from a save (deduplicated; the cap applies at the next write) and defaults to none', () => {
    expect(parseSave(JSON.stringify({ ...defaultSave(), creditedRuns: undefined })).data.creditedRuns).toEqual([]);
    const many = Array.from({ length: CREDITED_RUNS_MAX + 2 }, (_, i) => `k${i}`);
    const d = parseSave(JSON.stringify({ ...defaultSave(), creditedRuns: ['a', 'a', 7, '', ...many] })).data;
    // Valid keys once each; not cut back on read (an older key may be pinned by a pending claim, which only MetaProgress learns later).
    expect(d.creditedRuns).toEqual(['a', ...many]);
    expect(parseSave(JSON.stringify({ ...defaultSave(), creditedRuns: 'nope' })).data.creditedRuns).toEqual([]);
    const storage = memStorage();
    storage.setItem(SAVE_KEY, JSON.stringify({ ...defaultSave(), creditedRuns: ['a', ...many] }));
    const meta = new MetaProgress(storage);
    expect(meta.data.creditedRuns).toHaveLength(CREDITED_RUNS_MAX + 3);
    expect(meta.awardRun({ runKey: 'new', reason: 'died', stats: stats() })).not.toBeNull();
    expect(meta.data.creditedRuns).toHaveLength(CREDITED_RUNS_MAX); // the write trims: the newest 100 stay
    expect(meta.data.creditedRuns[0]).toBe('k3');
    expect(meta.data.creditedRuns.at(-1)).toBe('new');
  });

  it('keeps a pinned key (a claim is still out for it) beyond the cap, and lets it age out once unpinned (docs/adr/0003)', () => {
    const storage = memStorage();
    const meta = new MetaProgress(storage);
    let pinned: string[] = ['k0', 'k3'];
    meta.pinCreditedRuns(() => pinned);
    for (let i = 0; i < CREDITED_RUNS_MAX + 5; i++) expect(meta.awardRun({ runKey: `k${i}`, reason: 'died', stats: stats() })).not.toBeNull();
    expect(meta.data.creditedRuns).toHaveLength(CREDITED_RUNS_MAX + 2);
    expect(meta.data.creditedRuns.slice(0, 3)).toEqual(['k0', 'k3', 'k5']); // the pinned keys, then the newest 100
    expect(meta.awardRun({ runKey: 'k0', reason: 'died', stats: stats() })).toBeNull(); // still held: no second credit
    expect(meta.credited('k1')).toBe(false);
    // The save and the mirror carry the whole set: a reload (before the queue registers its pins again) loses nothing.
    expect(new MetaProgress(storage).data.creditedRuns).toHaveLength(CREDITED_RUNS_MAX + 2);
    // The claims landed: the next write lets the keys go like any other.
    pinned = [];
    expect(meta.awardRun({ runKey: 'k-last', reason: 'died', stats: stats() })).not.toBeNull();
    expect(meta.data.creditedRuns).toHaveLength(CREDITED_RUNS_MAX);
    expect(meta.data.creditedRuns[0]).toBe('k6');
    // An adopt still replaces the set whole: a pinned key the adopted copy lacks is gone with its Fluff, so the claim's answer can restore it.
    pinned = ['k-last'];
    meta.store.update((d) => meta.adoptCreditedRuns(d, ['other'], false));
    expect(meta.credited('k-last')).toBe(false);
  });

  it('counts a Universe on each victory in the last Area, once per Run; universesAfter looks ahead', () => {
    const storage = memStorage();
    const meta = new MetaProgress(storage);
    const last = AREA_ORDER[AREA_ORDER.length - 1]!;
    const win = { runKey: 'w1', reason: 'victory' as const, stats: stats({ area: last }) };
    expect(endsUniverse(win)).toBe(true);
    expect(meta.universesAfter(win)).toBe(1); // not credited yet: counts it
    expect(meta.awardRun(win)!.universes).toBe(1);
    expect(meta.universesAfter(win)).toBe(1); // credited: as it is
    expect(meta.awardRun(win)).toBeNull();
    expect(meta.awardRun({ runKey: 'd1', reason: 'died', stats: stats({ area: last }) })!.universes).toBe(1);
    expect(meta.awardRun({ runKey: 'w2', reason: 'victory', stats: stats({ area: 'city' }) })!.universes).toBe(1);
    expect(meta.awardRun({ runKey: 'w3', reason: 'victory', stats: stats({ area: last }) })!.universes).toBe(2);
    expect(new MetaProgress(storage).universes).toBe(2);
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

describe('creditedRuns on a device shared with a build from before the ledger (docs/adr/0003)', () => {
  const died = (runKey: string) => ({ runKey, reason: 'died' as const, stats: stats() });

  it('a save rewritten without creditedRuns gets its keys back from the mirror, and nothing is credited twice', () => {
    const storage = memStorage();
    const meta = new MetaProgress(storage);
    for (const k of ['a', 'b', 'c']) expect(meta.awardRun(died(k))).not.toBeNull(); // three ledger rows applied
    const before = meta.data.fluff;
    expect(JSON.parse(storage.map.get(CREDITED_RUNS_MIRROR_KEY)!)).toMatchObject({ version: CREDITED_RUNS_MIRROR_VERSION, keys: ['a', 'b', 'c'] });
    // An old-build tab buys an Upgrade: its sanitiser drops the field it doesn't know, the Fluff stays.
    const raw = JSON.parse(storage.map.get(SAVE_KEY)!) as Record<string, unknown>;
    delete raw.creditedRuns;
    raw.fluff = (raw.fluff as number) - 10;
    storage.setItem(SAVE_KEY, JSON.stringify(raw));
    expect(parseSave(storage.map.get(SAVE_KEY)).data.creditedRuns).toEqual([]); // the file alone says "no credit held"
    // The next sweep replays the same rows: the repaired set refuses them all.
    for (const k of ['a', 'b', 'c']) expect(meta.awardRun(died(k))).toBeNull();
    expect(meta.data.fluff).toBe(before - 10);
    expect(meta.data.stats.runs).toBe(3);
    expect(meta.data.creditedRuns).toEqual(['a', 'b', 'c']);
    // A fresh page reads it repaired too, and a new credit writes the whole set back.
    const next = new MetaProgress(storage);
    expect(next.data.creditedRuns).toEqual(['a', 'b', 'c']);
    expect(next.awardRun(died('d'))).not.toBeNull();
    expect(parseSave(storage.map.get(SAVE_KEY)).data.creditedRuns).toEqual(['a', 'b', 'c', 'd']);
    expect(next.awardRun(died('a'))).toBeNull();
  });

  it('a credit with no Account is remembered on the device only: it dedups, and takes no slot from ledger keys', () => {
    const storage = memStorage();
    const meta = new MetaProgress(storage);
    expect(meta.awardRun(died('ledger-1'))).not.toBeNull();
    for (let i = 0; i < CREDITED_RUNS_MAX + 10; i++) expect(meta.awardRun(died(`offline-${i}`), { ledger: false })).not.toBeNull();
    expect(meta.data.creditedRuns).toEqual(['ledger-1']); // still remembered after 110 signed-out Runs
    expect(meta.awardRun(died('ledger-1'))).toBeNull(); // so the same ledger row never credits twice
    expect(meta.credited(`offline-${CREDITED_RUNS_MAX + 9}`)).toBe(true);
    expect(meta.awardRun(died(`offline-${CREDITED_RUNS_MAX + 9}`), { ledger: false })).toBeNull();
    expect(new MetaProgress(storage).awardRun(died(`offline-${CREDITED_RUNS_MAX + 9}`))).toBeNull(); // another tab, too
    expect(JSON.parse(storage.map.get(CREDITED_RUNS_MIRROR_KEY)!).local).toHaveLength(LOCAL_CREDITS_MAX);
  });

  it('a Universe victory counts only when the device that ended the Run credits it; a row the sweep brings adds Fluff alone', () => {
    const meta = new MetaProgress(memStorage());
    const win = { runKey: 'win', reason: 'victory' as const, stats: stats({ area: AREA_ORDER[AREA_ORDER.length - 1] }) };
    const swept = meta.awardRun(win, { countUniverse: false })!;
    expect(swept.fluff).toBeGreaterThan(0);
    expect(swept.universes).toBe(0);
    expect(meta.data.stats.wins).toBe(1);
    expect(meta.awardRun(win)).toBeNull();
  });

  it('a mirror from a newer build is read but never written', () => {
    const storage = memStorage({ [CREDITED_RUNS_MIRROR_KEY]: JSON.stringify({ version: CREDITED_RUNS_MIRROR_VERSION + 1, keys: ['future'], local: [], later: true }) });
    const meta = new MetaProgress(storage);
    expect(meta.data.creditedRuns).toEqual(['future']);
    expect(meta.awardRun(died('future'))).toBeNull();
    expect(meta.awardRun(died('now'))).not.toBeNull();
    expect(JSON.parse(storage.map.get(CREDITED_RUNS_MIRROR_KEY)!)).toMatchObject({ version: CREDITED_RUNS_MIRROR_VERSION + 1, keys: ['future'], later: true });
    expect(meta.awardRun(died('now'))).toBeNull(); // this page still remembers, in memory
  });
});

describe('creditedRuns lost to a build from before the ledger: the set is unknown until a cloud adopt restores it (docs/adr/0003)', () => {
  const died = (runKey: string) => ({ runKey, reason: 'died' as const, stats: stats() });

  it('a save without the field on a device that has used the ledger marks the set unknown; the mirror still repairs what it knows', () => {
    const storage = memStorage();
    const meta = new MetaProgress(storage);
    expect(meta.awardRun(died('mine'))).not.toBeNull();
    // An old-build tab adopts a cloud copy that holds another device's credit K2 (Fluff 66, key unknown to the mirror) and rewrites the save without the field.
    const raw = JSON.parse(storage.map.get(SAVE_KEY)!) as Record<string, unknown>;
    delete raw.creditedRuns;
    raw.fluff = 66;
    storage.setItem(SAVE_KEY, JSON.stringify(raw));
    const next = new MetaProgress(storage);
    expect(next.creditedRunsKnown()).toBe(false);
    expect(next.data.creditedRuns).toEqual(['mine']);
    expect(JSON.parse(storage.map.get(CREDITED_RUNS_MIRROR_KEY)!)).toMatchObject({ keys: ['mine'], unknown: true });
    expect(next.awardRun(died('mine'))).toBeNull();
    // Credits still land meanwhile (the set is "at least these"), and the flag outlives a reload and this build's own writes.
    expect(next.awardRun(died('new'))).not.toBeNull();
    expect(new MetaProgress(storage).creditedRunsKnown()).toBe(false);
    // A cloud adopt of a copy that carries `creditedRuns` restores a known set.
    next.store.update((d) => next.adoptCreditedRuns(d, ['mine', 'K2', 'new'], false));
    expect(next.creditedRunsKnown()).toBe(true);
    expect(next.awardRun(died('K2'))).toBeNull();
    // An adopt of a row from before the ledger (no set) leaves it as it is; another Account's save starts known and empty.
    next.store.update((d) => next.adoptCreditedRuns(d, undefined, false));
    expect(next.creditedRunsKnown()).toBe(true);
    const flagged = new MetaProgress(storage);
    storage.setItem(SAVE_KEY, JSON.stringify(raw));
    flagged.store.refresh();
    expect(flagged.creditedRunsKnown()).toBe(false);
    flagged.store.update((d) => flagged.adoptCreditedRuns(d, undefined, true));
    expect(flagged.creditedRunsKnown()).toBe(true);
    expect(flagged.data.creditedRuns).toEqual([]);
  });

  it('a save from before the ledger on a device without a mirror is simply an older save: the set is known (and empty)', () => {
    const storage = memStorage();
    const old = new MetaProgress(storage);
    old.store.update((d) => void (d.fluff = 40));
    const raw = JSON.parse(storage.map.get(SAVE_KEY)!) as Record<string, unknown>;
    delete raw.creditedRuns;
    storage.setItem(SAVE_KEY, JSON.stringify(raw));
    storage.map.delete(CREDITED_RUNS_MIRROR_KEY);
    const meta = new MetaProgress(storage);
    expect(meta.creditedRunsKnown()).toBe(true);
    expect(meta.data).toMatchObject({ fluff: 40, creditedRuns: [] });
  });
});
