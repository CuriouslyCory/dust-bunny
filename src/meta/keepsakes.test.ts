import { describe, expect, it } from 'vitest';
import type { GameEvents } from '../core/events';
import { feltCost, keepsakeTypesFor, shedValue, type KeepsakeRef } from '../data/keepsakes';
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
  reason,
  stats: { seed, characterId, timeSec: 300, maxRadius: 50, finalRadius: 50, debrisAbsorbed: 900, hazardsAbsorbed: 1, tierReached: 5, tierTimes: {}, perks: [], area: 'neighborhood', houseCleared: true } as RunStats,
});

const ref = (type: KeepsakeRef['type'], grade: number): KeepsakeRef => ({ type, grade });

describe('rollBossDrops', () => {
  it('drops one Keepsake of the boss grade, seeded, of the Character’s own types', () => {
    const a = rollBossDrops({ seed: 's1', characterId: 'zap', bossId: 'street_sweeper', firstKill: false });
    expect(a).toHaveLength(1);
    expect(a[0]!.ref.grade).toBe(2);
    expect(keepsakeTypesFor('zap').map((t) => t.id)).toContain(a[0]!.ref.type);
    expect(rollBossDrops({ seed: 's1', characterId: 'zap', bossId: 'street_sweeper', firstKill: false })).toEqual(a);
    // Over many seeds every type shows up (uniform over the five).
    const seen = new Set(Array.from({ length: 200 }, (_, i) => rollBossDrops({ seed: `s${i}`, characterId: 'lint', bossId: 'robovac_9000', firstKill: false })[0]!.ref.type));
    expect(seen.size).toBe(5);
  });

  it('offers three distinct types on a first kill and adds one on Hardcore', () => {
    const first = rollBossDrops({ seed: 'x', characterId: 'tumble', bossId: 'garbage_truck', firstKill: true, difficulty: 'hardcore' });
    expect(first).toHaveLength(2);
    expect(first[0]!.offer).toHaveLength(3);
    expect(new Set(first[0]!.offer).size).toBe(3);
    expect(first[0]!.ref).toEqual({ type: first[0]!.offer![0], grade: 3 });
    expect(first[1]!.bonus).toBe(true);
    expect(first[1]!.offer).toBeUndefined();
  });

  it('drops nothing for a boss without a grade or an unknown Character', () => {
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
    expect(events[0]).toMatchObject({ characterId: 'lint', bossId: 'robovac_9000', grade: 1, firstKill: true });
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
    expect(meta.keepsakeCount('zap', ref(other, 2))).toBe(1);
    expect(meta.data.stats.keepsakesEarned).toBe(1);
    t.settle(run);
    expect(t.choose(run, 0, drop!.offer![1]!)).toBe(false);
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

  it('felts three of a grade into one of the next for 40 × g² Fluff', () => {
    const meta = setup();
    expect(meta.feltCeiling('lint')).toBe(2);
    const r = meta.felt('lint', ref('thick_clog', 1));
    expect(r).toMatchObject({ ok: true, result: ref('thick_clog', 2), cost: feltCost(2), first: true });
    expect(meta.keepsakeCount('lint', ref('thick_clog', 1))).toBe(1);
    expect(meta.keepsakeCount('lint', ref('thick_clog', 2))).toBe(1);
    expect(meta.fluff).toBe(1000 - 160);
    expect(meta.data.stats.totalFluffEarned).toBe(500);
    expect(meta.data.stats.feltings).toBe(1);
    expect(meta.felt('lint', ref('thick_clog', 1))).toMatchObject({ ok: false, reason: 'count' });
  });

  it('respects the grade ceiling, the Fluff cost and grade 10', () => {
    const meta = setup(1000, ['robovac_9000']);
    meta.creditKeepsakes('lint', [ref('reclaim', 2), ref('reclaim', 2), ref('reclaim', 2)]);
    expect(meta.feltCheck('lint', ref('reclaim', 2))).toMatchObject({ ok: false, reason: 'ceiling', ceiling: 2 });
    meta.creditKeepsakes('lint', [], 'street_sweeper');
    expect(meta.feltCheck('lint', ref('reclaim', 2))).toMatchObject({ ok: true, cost: 360 });
    expect(setup(100).feltCheck('lint', ref('thick_clog', 1))).toMatchObject({ ok: false, reason: 'poor', cost: 160 });
    expect(setup(1000, []).feltCheck('lint', ref('thick_clog', 1))).toMatchObject({ ok: false, reason: 'ceiling', ceiling: 0 });
    expect(meta.feltCheck('lint', ref('reclaim', 10))).toMatchObject({ ok: false, reason: 'max' });
    expect(meta.feltCheck('lint', ref('arc', 1))).toMatchObject({ ok: false, reason: 'unknown' });
  });

  it('sheds one Keepsake for 10 × g² Fluff without counting it as earned', () => {
    const meta = setup(0);
    expect(meta.shed('lint', ref('thick_clog', 1))).toEqual({ ok: true, fluff: shedValue(1) });
    expect(meta.fluff).toBe(10);
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
        lint: { hoard: { 'reclaim:1': 3, 'reclaim:2': 250, 'arc:1': 4, 'bad': 1, 'thick_clog:1': -2 }, bossesBeaten: ['robovac_9000', 'robovac_9000', 7] },
        nobody: { hoard: { 'reclaim:1': 1 }, bossesBeaten: [] },
        zap: 'x',
      },
      lastLoadout: { lint: [ref('reclaim', 1), ref('reclaim', 2), ref('reclaim', 1)], zap: [ref('arc', 1)] },
      stats: { keepsakesEarned: 4 },
    });
    const { data, status } = parseSave(raw);
    expect(status).toBe('ok');
    expect(data.characters).toEqual({ lint: { hoard: { 'reclaim:1': 3, 'reclaim:2': 99 }, bossesBeaten: ['robovac_9000'] } });
    expect(data.lastLoadout).toEqual({ lint: [ref('reclaim', 1), ref('reclaim', 2)] });
    expect(data.stats.keepsakesEarned).toBe(4);
    // A save from before Keepsakes reads with empty defaults.
    const old = parseSave(JSON.stringify({ version: 1, fluff: 3, stats: { runs: 1 } })).data;
    expect(old.characters).toEqual({});
    expect(old.lastLoadout).toEqual({});
  });

  it('syncs Hoards and bosses (not the Loadout or feltings) through the cloud save', () => {
    const storage = memStorage();
    const meta = new MetaProgress(storage);
    meta.creditKeepsakes('tumble', [ref('snowball', 1)], 'robovac_9000');
    meta.setLastLoadout('tumble', [ref('snowball', 1)]);
    const p = progressOf(meta.data);
    expect(p.characters).toEqual({ tumble: { hoard: { 'snowball:1': 1 }, bossesBeaten: ['robovac_9000'] } });
    expect(p.stats.keepsakesEarned).toBe(1);
    expect('lastLoadout' in p).toBe(false);
    expect('feltings' in p.stats).toBe(false);
    expect(validateProgress(p)).toEqual({ ok: true, value: p });
    expect(JSON.parse(storage.map.get(SAVE_KEY)!).characters.tumble.hoard['snowball:1']).toBe(1);
  });
});
