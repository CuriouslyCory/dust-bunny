import { describe, expect, it } from 'vitest';
import type { GameEvents } from '../core/events';
import { dropTableFor, feltCost, keepsakeTypesFor, shedValue, type KeepsakeRef } from '../data/keepsakes';
import type { RunStats } from '../game/runStats';
import { validateProgress } from '../shared/progress';
import { progressOf } from './cloudSave';
import { repairLoadout } from './hoard';
import { KeepsakeTracker, rollBossDrops } from './keepsakes';
import { MetaProgress } from './meta';
import { parseSave, SAVE_KEY, type KeyValueStorage } from './save';

const memStorage = (init: Record<string, string> = {}): KeyValueStorage & { map: Map<string, string> } => {
  const map = new Map(Object.entries(init));
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
};

const ended = (reason: GameEvents['runEnded']['reason'], seed = 'seed-a', characterId = 'lint'): GameEvents['runEnded'] => ({
  runKey: `${seed}:${characterId}`,
  reason,
  stats: { seed, characterId, timeSec: 300, maxRadius: 50, finalRadius: 50, debrisAbsorbed: 900, hazardsAbsorbed: 1, tierReached: 5, tierTimes: {}, perks: [], area: 'neighborhood', houseCleared: true } as RunStats,
});

const ref = (type: KeepsakeRef['type'], rarity: number): KeepsakeRef => ({ type, rarity });

describe('rollBossDrops', () => {
  it('drops one Keepsake, seeded, of the Character’s own types', () => {
    const a = rollBossDrops({ seed: 's1', characterId: 'zap', bossId: 'street_sweeper', firstKill: false });
    expect(a).toHaveLength(1);
    expect(a[0]!.ref.rarity).toBeGreaterThanOrEqual(1);
    expect(a[0]!.ref.rarity).toBeLessThanOrEqual(5);
    expect(keepsakeTypesFor('zap').map((t) => t.id)).toContain(a[0]!.ref.type);
    expect(rollBossDrops({ seed: 's1', characterId: 'zap', bossId: 'street_sweeper', firstKill: false })).toEqual(a);
    // Over many seeds every type shows up (uniform over the five).
    const seen = new Set(Array.from({ length: 200 }, (_, i) => rollBossDrops({ seed: `s${i}`, characterId: 'lint', bossId: 'robovac_9000', firstKill: false })[0]!.ref.type));
    expect(seen.size).toBe(5);
  });

  it("rolls rarities from the boss's drop table", () => {
    const share = (bossId: string) => {
      const counts = [0, 0, 0, 0, 0];
      const n = 4000;
      for (let i = 0; i < n; i++) counts[rollBossDrops({ seed: `r${i}`, characterId: 'lint', bossId, firstKill: false })[0]!.ref.rarity - 1]!++;
      return counts.map((c) => (c / n) * 100);
    };
    for (const bossId of ['robovac_9000', 'ice_sheet', 'sagittarius_a']) {
      const got = share(bossId);
      dropTableFor(bossId)!.chances.forEach((p, i) => expect(Math.abs(got[i]! - p), `${bossId} rarity ${i + 1}`).toBeLessThan(2.5));
    }
  });

  it('salts the rarity roll per Run, but not the type', () => {
    const roll = (salt: string) => rollBossDrops({ seed: 'fixed', characterId: 'lint', bossId: 'ice_sheet', firstKill: false, salt })[0]!.ref;
    expect(roll('a')).toEqual(roll('a'));
    const runs = Array.from({ length: 200 }, (_, i) => roll(`s${i}`));
    expect(new Set(runs.map((r) => r.type)).size).toBe(1);
    expect(new Set(runs.map((r) => r.rarity)).size).toBeGreaterThan(1);
  });

  it('offers three distinct types on a first kill and adds one on Hardcore', () => {
    const first = rollBossDrops({ seed: 'x', characterId: 'tumble', bossId: 'garbage_truck', firstKill: true, difficulty: 'hardcore' });
    expect(first).toHaveLength(2);
    expect(first[0]!.offer).toHaveLength(3);
    expect(new Set(first[0]!.offer).size).toBe(3);
    expect(first[0]!.ref.type).toBe(first[0]!.offer![0]);
    expect(first[1]!.bonus).toBe(true);
    expect(first[1]!.offer).toBeUndefined();
  });

  it('drops nothing for a boss without a rarity or an unknown Character', () => {
    expect(rollBossDrops({ seed: 'x', characterId: 'lint', bossId: 'roomba', firstKill: true })).toEqual([]);
    expect(rollBossDrops({ seed: 'x', characterId: 'nobody', bossId: 'robovac_9000', firstKill: true })).toEqual([]);
  });
});

describe('KeepsakeTracker', () => {
  it('credits the played Character on bossDefeated, keeps them after a death, and counts keepsakesEarned', () => {
    const meta = new MetaProgress(memStorage());
    const events: Array<GameEvents['keepsakesDropped']> = [];
    const t = new KeepsakeTracker(meta, (e) => events.push(e));
    t.start({ seed: 'seed-a', characterId: 'lint', difficulty: 'casual', ranked: true });
    const drops = t.bossDefeated('robovac_9000');
    expect(drops).toHaveLength(1);
    expect(drops[0]!.offer).toHaveLength(3); // first kill
    expect(events[0]).toMatchObject({ characterId: 'lint', bossId: 'robovac_9000', rarity: drops[0]!.ref.rarity, firstKill: true });
    expect(meta.keepsakeCount('lint', drops[0]!.ref)).toBe(1);
    expect(meta.hasBeaten('lint', 'robovac_9000')).toBe(true);
    expect(meta.hasBeaten('zap', 'robovac_9000')).toBe(false);
    expect(meta.data.stats.keepsakesEarned).toBe(1);

    const e = ended('died');
    expect(t.forResult(e)?.drops).toEqual(drops);
    expect(meta.keepsakeCount('lint', drops[0]!.ref)).toBe(1);
    // Nothing drops after the Run ended.
    expect(t.bossDefeated('street_sweeper')).toEqual([]);

    // Second kill of the same boss: a random type, no offer.
    t.start({ seed: 'seed-b', characterId: 'lint', ranked: true });
    expect(t.bossDefeated('robovac_9000')[0]!.offer).toBeUndefined();
    expect(meta.data.stats.keepsakesEarned).toBe(2);
  });

  it('drops nothing in unranked Runs and does not count the boss', () => {
    const meta = new MetaProgress(memStorage());
    const t = new KeepsakeTracker(meta);
    t.start({ seed: 's', characterId: 'zap', ranked: false });
    expect(t.bossDefeated('robovac_9000')).toEqual([]);
    expect(meta.hasBeaten('zap', 'robovac_9000')).toBe(false);
    expect(meta.data.stats.keepsakesEarned).toBe(0);
  });

  it('swaps the first-kill pick on the results screen until it is settled', () => {
    const meta = new MetaProgress(memStorage());
    const t = new KeepsakeTracker(meta);
    t.start({ seed: 'seed-c', characterId: 'zap', ranked: true });
    const [drop] = t.bossDefeated('street_sweeper');
    const run = t.forResult(ended('quit', 'seed-c', 'zap'))!;
    const other = drop!.offer![2]!;
    const notOffered = keepsakeTypesFor('zap').find((x) => !drop!.offer!.includes(x.id))!.id;
    expect(t.choose(run, 0, notOffered)).toBe(false);
    const first = drop!.ref;
    expect(t.choose(run, 0, other)).toBe(true);
    expect(meta.keepsakeCount('zap', first)).toBe(0);
    expect(meta.keepsakeCount('zap', ref(other, first.rarity))).toBe(1);
    expect(meta.data.stats.keepsakesEarned).toBe(1);
    t.settle(run);
    expect(t.choose(run, 0, drop!.offer![1]!)).toBe(false);
  });

  it('locks the first-kill pick when the Keepsake reveal closes', () => {
    const meta = new MetaProgress(memStorage());
    const t = new KeepsakeTracker(meta);
    const run = t.start({ seed: 'seed-d', characterId: 'lint', ranked: true });
    const [drop] = t.bossDefeated('robovac_9000');
    const picked = drop!.offer![1]!;
    expect(t.choose(run, 0, picked)).toBe(true);
    t.lock(drop!);
    expect(t.choose(run, 0, drop!.offer![2]!)).toBe(false);
    expect(drop!.ref.type).toBe(picked);
    expect(meta.keepsakeCount('lint', drop!.ref)).toBe(1);
  });
});

describe('Felting and shedding', () => {
  const setup = (fluff = 1000, bosses = ['robovac_9000']) => {
    const meta = new MetaProgress(memStorage());
    meta.store.update((d) => {
      d.fluff = fluff;
      d.stats.totalFluffEarned = 500;
    });
    meta.creditKeepsakes('lint', [ref('thick_clog', 1), ref('thick_clog', 1), ref('thick_clog', 1), ref('thick_clog', 1)]);
    for (const b of bosses) meta.creditKeepsakes('lint', [], b);
    return meta;
  };

  it('felts three of a rarity into one of the next for the Fluff shedding them would return', () => {
    const meta = setup();
    expect(meta.feltCeiling('lint')).toBe(2);
    const r = meta.felt('lint', ref('thick_clog', 1));
    expect(r).toMatchObject({ ok: true, result: ref('thick_clog', 2), cost: feltCost(2), first: true });
    expect(meta.keepsakeCount('lint', ref('thick_clog', 1))).toBe(1);
    expect(meta.keepsakeCount('lint', ref('thick_clog', 2))).toBe(1);
    expect(feltCost(2)).toBe(120);
    expect(feltCost(2)).toBe(3 * shedValue(1));
    expect(feltCost(5)).toBe(1920);
    expect(meta.fluff).toBe(1000 - 120);
    expect(meta.data.stats.totalFluffEarned).toBe(500);
    expect(meta.data.stats.feltings).toBe(1);
    expect(meta.felt('lint', ref('thick_clog', 1))).toMatchObject({ ok: false, reason: 'count' });
  });

  it('respects the rarity ceiling, the Fluff cost and mythic', () => {
    const meta = setup(2000, ['robovac_9000']);
    meta.creditKeepsakes('lint', [ref('reclaim', 2), ref('reclaim', 2), ref('reclaim', 2)]);
    expect(meta.feltCheck('lint', ref('reclaim', 2))).toMatchObject({ ok: false, reason: 'ceiling', ceiling: 2 });
    meta.creditKeepsakes('lint', [], 'street_sweeper');
    expect(meta.feltCheck('lint', ref('reclaim', 2))).toMatchObject({ ok: true, cost: 480, ceiling: 3 });
    expect(setup(100).feltCheck('lint', ref('thick_clog', 1))).toMatchObject({ ok: false, reason: 'poor', cost: 120 });
    expect(setup(1000, []).feltCheck('lint', ref('thick_clog', 1))).toMatchObject({ ok: false, reason: 'ceiling', ceiling: 0 });
    expect(meta.feltCheck('lint', ref('reclaim', 5))).toMatchObject({ ok: false, reason: 'max' });
    expect(meta.feltCheck('lint', ref('arc', 1))).toMatchObject({ ok: false, reason: 'unknown' });
  });

  it('sheds one Keepsake for 40 × r² Fluff without counting it as earned', () => {
    const meta = setup(0);
    expect(meta.shed('lint', ref('thick_clog', 1))).toEqual({ ok: true, fluff: shedValue(1) });
    expect(meta.fluff).toBe(40);
    expect(meta.data.stats.totalFluffEarned).toBe(500);
    expect(meta.keepsakeCount('lint', ref('thick_clog', 1))).toBe(3);
    expect(meta.shed('lint', ref('reclaim', 1))).toEqual({ ok: false, reason: 'none' });
  });

  it('bounds Hoard cells at 99', () => {
    const meta = new MetaProgress(memStorage());
    expect(meta.creditKeepsakes('lint', Array.from({ length: 120 }, () => ref('reclaim', 1)))).toBe(99);
    expect(meta.keepsakeCount('lint', ref('reclaim', 1))).toBe(99);
    expect(meta.data.stats.keepsakesEarned).toBe(99);
    expect(meta.creditKeepsakes('lint', [ref('arc', 1)])).toBe(0);
  });

  it('refuses a first-kill swap into a full Hoard cell without losing the credited Keepsake', () => {
    const meta = new MetaProgress(memStorage());
    const t = new KeepsakeTracker(meta);
    const run = t.start({ seed: 'seed-e', characterId: 'lint', ranked: true });
    const [drop] = t.bossDefeated('robovac_9000');
    const first = drop!.ref;
    const full = drop!.offer![1]!;
    meta.creditKeepsakes('lint', Array.from({ length: 99 }, () => ref(full, first.rarity)));
    expect(t.choose(run, 0, full)).toBe(false);
    expect(drop!.ref).toEqual(first);
    expect(meta.keepsakeCount('lint', first)).toBe(1);
    expect(meta.keepsakeCount('lint', ref(full, first.rarity))).toBe(99);
  });
});

describe('Loadout memory', () => {
  it('remembers per Character and drops slots the Hoard no longer holds', () => {
    const meta = new MetaProgress(memStorage());
    meta.creditKeepsakes('lint', [ref('reclaim', 1), ref('reclaim', 1), ref('long_strand', 1)]);
    expect(meta.setLastLoadout('lint', [ref('reclaim', 1), ref('reclaim', 1)])).toEqual([ref('reclaim', 1), ref('reclaim', 1)]);
    expect(meta.setLastLoadout('lint', [ref('long_strand', 1), ref('long_strand', 1)])).toEqual([ref('long_strand', 1)]);
    meta.setLastLoadout('lint', [ref('reclaim', 1), ref('reclaim', 1)]);
    meta.shed('lint', ref('reclaim', 1));
    expect(meta.lastLoadout('lint')).toEqual([ref('reclaim', 1)]);
    expect(meta.data.lastLoadout.lint).toEqual([ref('reclaim', 1)]);
    expect(meta.lastLoadout('zap')).toEqual([]);
    expect(repairLoadout('lint', [ref('arc', 1), 'junk', ref('reclaim', 1), ref('reclaim', 1)], meta.hoardOf('lint'))).toEqual([ref('reclaim', 1)]);
  });
});

describe('save and cloud shape', () => {
  it('sanitises Hoards, bosses and Loadouts field by field', () => {
    const raw = JSON.stringify({
      version: 1,
      fluff: 5,
      characters: {
        lint: { hoard: { 'reclaim:common': 3, 'reclaim:rare': 250, 'reclaim:6': 1, 'arc:common': 4, 'bad': 1, 'thick_clog:common': -2, 'reclaim:ultra': 1 }, bossesBeaten: ['robovac_9000', 'robovac_9000', 7] },
        nobody: { hoard: { 'reclaim:common': 1 }, bossesBeaten: [] },
        zap: 'x',
      },
      lastLoadout: { lint: [ref('reclaim', 1), ref('reclaim', 2), ref('reclaim', 1)], zap: [ref('arc', 1)], tumble: [ref('feast', 6)] },
      stats: { keepsakesEarned: 4 },
    });
    const { data, status } = parseSave(raw);
    expect(status).toBe('ok');
    expect(data.characters).toEqual({ lint: { hoard: { 'reclaim:common': 3, 'reclaim:rare': 99, 'reclaim:epic': 1 }, bossesBeaten: ['robovac_9000'] } });
    expect(data.lastLoadout).toEqual({ lint: [ref('reclaim', 1), ref('reclaim', 2)] });
    expect(data.stats.keepsakesEarned).toBe(4);
    // A save from before Keepsakes reads with empty defaults.
    const old = parseSave(JSON.stringify({ version: 1, fluff: 3, stats: { runs: 1 } })).data;
    expect(old.characters).toEqual({});
    expect(old.lastLoadout).toEqual({});
  });

  it('reads Tumble’s Hunker-era Keepsakes as their Amass replacements, counts added up', () => {
    const raw = JSON.stringify({
      version: 1,
      fluff: 5,
      characters: { tumble: { hoard: { 'snowball:epic': 2, 'feast:epic': 1, 'thick_undercoat:4': 1, 'loose_roots:mythic': 3 }, bossesBeaten: ['robovac_9000'] } },
      lastLoadout: { tumble: [{ type: 'snowball', rarity: 3 }, { type: 'loose_roots', rarity: 5 }] },
    });
    const { data } = parseSave(raw);
    expect(data.characters.tumble!.hoard).toEqual({ 'feast:epic': 3, 'unmoved:rare': 1, 'lingering_mass:mythic': 3 });
    expect(data.lastLoadout.tumble).toEqual([ref('feast', 3), ref('lingering_mass', 5)]);
  });

  it('converts a save from before rarities: grades 1–10 become rarities two to one', () => {
    const raw = JSON.stringify({
      version: 1,
      fluff: 5,
      characters: {
        zap: {
          hoard: { 'arc:5': 1, 'live_wire:2': 1, 'live_wire:1': 2, 'static_cling:9': 1, 'static_cling:10': 98, 'grounding:11': 1 },
          bossesBeaten: ['robovac_9000', 'ice_sheet'],
        },
      },
      lastLoadout: { zap: [{ type: 'live_wire', grade: 1 }, { type: 'arc', grade: 5 }] },
    });
    const { data } = parseSave(raw);
    expect(data.characters.zap!.hoard).toEqual({ 'arc:epic': 1, 'live_wire:common': 3, 'static_cling:mythic': 99 });
    expect(data.lastLoadout.zap).toEqual([ref('live_wire', 1), ref('arc', 3)]);
    // The next write stores the new keys.
    const meta = new MetaProgress(memStorage({ [SAVE_KEY]: raw }));
    meta.store.update((d) => {
      d.fluff++;
    });
    expect(Object.keys(meta.data.characters.zap!.hoard)).toEqual(['arc:epic', 'live_wire:common', 'static_cling:mythic']);
  });

  it('syncs Hoards and bosses (not the Loadout or feltings) through the cloud save', () => {
    const storage = memStorage();
    const meta = new MetaProgress(storage);
    meta.creditKeepsakes('tumble', [ref('feast', 1)], 'robovac_9000');
    meta.setLastLoadout('tumble', [ref('feast', 1)]);
    const p = progressOf(meta.data);
    expect(p.characters).toEqual({ tumble: { hoard: { 'feast:common': 1 }, bossesBeaten: ['robovac_9000'] } });
    expect(p.stats.keepsakesEarned).toBe(1);
    expect('lastLoadout' in p).toBe(false);
    expect('feltings' in p.stats).toBe(false);
    expect(validateProgress(p)).toEqual({ ok: true, value: p });
    expect(JSON.parse(storage.map.get(SAVE_KEY)!).characters.tumble.hoard['feast:common']).toBe(1);
  });
});
