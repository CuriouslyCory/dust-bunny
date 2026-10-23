import { describe, expect, it } from 'vitest';
import { computeStats, BASE_BUNNY_STATS, type StatKey, type StatModifier } from '../entities/stats';
import { upgradeModifiers } from '../meta/upgrades';
import { CHARACTERS, getCharacter } from './characters';
import { AREA_BOSSES } from './hazards';
import {
  BOSS_DROP_TABLES,
  dropTableFor,
  effectValue,
  feltCeiling,
  getRarity,
  MAX_RARITY,
  peakRarityForBoss,
  rarityFromLegacyGrade,
  rollRarity,
  rarityFraction,
  rarityValue,
  KEEPSAKE_STAT_EFFECTS,
  KEEPSAKE_TYPES,
  keepsakeTypesFor,
  loadoutValue,
  parseHoardKey,
  hoardKey,
  isLoadoutFor,
  type KeepsakeRef,
} from './keepsakes';
import { UPGRADES } from './upgrades';

const MAX_SHOP = upgradeModifiers(Object.fromEntries(UPGRADES.map((u) => [u.id, u.maxLevel])));

/** Base + maxed Shop + a Loadout's stat-touching Keepsakes (every Ability-state effect counted). */
function envelope(characterId: string, loadout: KeepsakeRef[]): Record<StatKey, number> {
  const c = getCharacter(characterId);
  const mods: StatModifier[] = [...MAX_SHOP];
  for (const e of KEEPSAKE_STAT_EFFECTS) {
    const v = loadoutValue(loadout, e.type, e.key);
    if (!v) continue;
    mods.push(e.op === 'add' ? { stat: e.stat, op: 'add', value: v, source: 'keepsake' } : { stat: e.stat, op: 'mul', value: 1 - v, source: 'keepsake' });
  }
  return computeStats({ ...BASE_BUNNY_STATS, ...c.stats }, mods);
}

/** Every pair of mythic Keepsakes of a Character, duplicates included. */
function pairs(characterId: string): KeepsakeRef[][] {
  const types = keepsakeTypesFor(characterId);
  const out: KeepsakeRef[][] = [];
  for (let i = 0; i < types.length; i++) for (let j = i; j < types.length; j++) out.push([{ type: types[i]!.id, rarity: 5 }, { type: types[j]!.id, rarity: 5 }]);
  return out;
}

const CAPPED: StatKey[] = ['speed', 'maxHealth', 'dashCooldown', 'magnetRadius', 'knockbackResistance', 'suctionMultiplier'];
const EPS = 1e-9;

describe('rarity curve', () => {
  it('puts common / rare / epic / legendary / mythic at 0 / 38 / 62 / 82 / 100 % of the range', () => {
    const expected = [0, 38, 62, 82, 100];
    [1, 2, 3, 4, 5].forEach((r, i) => expect(Math.abs(rarityFraction(r) * 100 - expected[i]!)).toBeLessThan(0.6));
    expect(rarityValue(1, 1, 5)).toBe(1);
    expect(rarityValue(5, 1, 5)).toBe(5);
  });

  it('gives Arc whole extra targets by step', () => {
    const arc = KEEPSAKE_TYPES.find((t) => t.id === 'arc')!;
    expect([1, 2, 3, 4, 5].map((r) => effectValue(arc, 'jumps', r))).toEqual([1, 1, 2, 2, 3]);
  });

  it('adds two copies together', () => {
    expect(loadoutValue([{ type: 'feast', rarity: 5 }, { type: 'feast', rarity: 5 }], 'feast', 'growth')).toBeCloseTo(1.2);
  });

  it('names five rarities in order', () => {
    expect(MAX_RARITY).toBe(5);
    expect([1, 2, 3, 4, 5].map((r) => getRarity(r).name)).toEqual(['Common', 'Rare', 'Epic', 'Legendary', 'Mythic']);
  });

  it('maps grades from before rarities two to a rarity', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(rarityFromLegacyGrade)).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
    expect(rarityFromLegacyGrade(0)).toBeNull();
    expect(rarityFromLegacyGrade(11)).toBeNull();
    expect(rarityFromLegacyGrade(2.5)).toBeNull();
  });
});

describe('boss drop tables', () => {
  /** P(rarity ≥ r) for r = 1..5. */
  const atLeast = (chances: readonly number[]) => chances.map((_, i) => chances.slice(i).reduce((a, b) => a + b, 0));

  it('has one row per Act, every row summing to 100 %', () => {
    expect(BOSS_DROP_TABLES.map((t) => t.act)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    for (const t of BOSS_DROP_TABLES) {
      expect(t.chances.reduce((a, b) => a + b, 0), t.bossId).toBeCloseTo(100, 6);
      expect(t.chances.every((c) => c > 0)).toBe(true);
    }
  });

  it('covers every built boss, in Area order', () => {
    const bosses = Object.values(AREA_BOSSES).map((b) => b.id);
    expect(BOSS_DROP_TABLES.slice(0, bosses.length).map((t) => t.bossId)).toEqual(bosses);
  });

  it('starts at 84 % common, ends mirrored at 84 % mythic, and peaks at epic for Acts 4–6', () => {
    expect(BOSS_DROP_TABLES[0]!.chances).toEqual([84, 10, 5, 0.9, 0.1]);
    expect([...BOSS_DROP_TABLES[8]!.chances].reverse()).toEqual([...BOSS_DROP_TABLES[0]!.chances]);
    expect(BOSS_DROP_TABLES.map((t) => peakRarityForBoss(t.bossId))).toEqual([1, 2, 2, 3, 3, 3, 4, 4, 5]);
    // Symmetric about the Ice Sheet.
    for (let i = 0; i < 9; i++) expect([...BOSS_DROP_TABLES[8 - i]!.chances].reverse()).toEqual([...BOSS_DROP_TABLES[i]!.chances]);
  });

  it('never lowers the chance of a rarity or better from one boss to the next', () => {
    for (let i = 1; i < BOSS_DROP_TABLES.length; i++) {
      const prev = atLeast(BOSS_DROP_TABLES[i - 1]!.chances);
      const cur = atLeast(BOSS_DROP_TABLES[i]!.chances);
      cur.forEach((p, r) => expect(p, `${BOSS_DROP_TABLES[i]!.bossId} rarity ${r + 1}`).toBeGreaterThanOrEqual(prev[r]! - 1e-9));
    }
  });

  it('rolls rarities in proportion to the table', () => {
    const table = dropTableFor('incinerator')!;
    expect(rollRarity(table, 0)).toBe(1);
    expect(rollRarity(table, 0.055)).toBe(1);
    expect(rollRarity(table, 0.057)).toBe(2);
    expect(rollRarity(table, 0.999999)).toBe(5);
    const counts = [0, 0, 0, 0, 0];
    const n = 100_000;
    for (let i = 0; i < n; i++) counts[rollRarity(table, (i + 0.5) / n) - 1]!++;
    counts.forEach((c, i) => expect(Math.abs((c / n) * 100 - table.chances[i]!)).toBeLessThan(0.01));
    expect(dropTableFor('roomba')).toBeNull();
  });
});

describe('Keepsake catalogue', () => {
  it('has five types per Character', () => {
    for (const c of CHARACTERS) expect(keepsakeTypesFor(c.id)).toHaveLength(5);
  });

  it('round-trips Hoard keys and rejects bad ones', () => {
    expect(hoardKey({ type: 'arc', rarity: 3 })).toBe('arc:epic');
    expect(parseHoardKey(hoardKey({ type: 'arc', rarity: 3 }))).toEqual({ type: 'arc', rarity: 3 });
    expect(parseHoardKey('arc:6')).toBeNull();
    expect(parseHoardKey('arc:6', true)).toEqual({ type: 'arc', rarity: 3 });
    expect(parseHoardKey('arc:11', true)).toBeNull();
    expect(parseHoardKey('arc:epic:1')).toBeNull();
    expect(parseHoardKey('nope:common')).toBeNull();
  });

  it('only allows a Character its own types', () => {
    expect(isLoadoutFor('lint', [{ type: 'reclaim', rarity: 1 }, { type: 'reclaim', rarity: 2 }])).toBe(true);
    expect(isLoadoutFor('lint', [{ type: 'reclaim', rarity: 6 }])).toBe(false);
    expect(isLoadoutFor('lint', [{ type: 'arc', rarity: 1 }])).toBe(false);
    expect(isLoadoutFor('lint', [{ type: 'reclaim', rarity: 1 }, { type: 'reclaim', rarity: 1 }, { type: 'reclaim', rarity: 1 }])).toBe(false);
  });

  it("caps Felting one rarity above the best beaten boss's peak", () => {
    expect(feltCeiling([])).toBe(0);
    expect(feltCeiling(['robovac_9000'])).toBe(2);
    expect(feltCeiling(['robovac_9000', 'street_sweeper', 'garbage_truck'])).toBe(3);
    expect(feltCeiling(['ice_sheet'])).toBe(4);
    expect(feltCeiling(['the_sun'])).toBe(5);
    expect(feltCeiling(['the_expansion'])).toBe(5);
  });
});

describe('stat caps and envelope', () => {
  it('keeps every mythic pair (duplicates included) within the caps', () => {
    for (const c of CHARACTERS) {
      for (const loadout of [[], ...pairs(c.id)]) {
        const v = envelope(c.id, loadout);
        for (const stat of CAPPED) {
          const cap = c.caps[stat]!;
          if (cap.max !== undefined) expect(v[stat], `${c.id} ${stat} ${JSON.stringify(loadout)}`).toBeLessThanOrEqual(cap.max + EPS);
          if (cap.min !== undefined) expect(v[stat], `${c.id} ${stat} ${JSON.stringify(loadout)}`).toBeGreaterThanOrEqual(cap.min - EPS);
        }
      }
    }
  });

  it('lands two mythic copies of a stat type exactly on the cap', () => {
    const two = (type: KeepsakeRef['type']) => [{ type, rarity: 5 }, { type, rarity: 5 }];
    expect(envelope('tumble', two('unmoved')).knockbackResistance).toBeCloseTo(0.9);
    expect(envelope('tumble', two('unmoved')).suctionMultiplier).toBeCloseTo(0.6);
    expect(envelope('zap', two('grounding')).suctionMultiplier).toBeCloseTo(1.2);
    expect(envelope('zap', two('static_cling')).magnetRadius).toBeCloseTo(2.05);
  });

  it('keeps every cap at or beyond base + maxed Shop, so no bought Upgrade loses value', () => {
    for (const c of CHARACTERS) {
      const v = envelope(c.id, []);
      for (const stat of CAPPED) {
        const cap = c.caps[stat]!;
        if (cap.max !== undefined) expect(cap.max, `${c.id} ${stat}`).toBeGreaterThanOrEqual(v[stat] - EPS);
        if (cap.min !== undefined) expect(cap.min, `${c.id} ${stat}`).toBeLessThanOrEqual(v[stat] + EPS);
      }
    }
  });

  it('keeps the archetypes apart', () => {
    const lint = getCharacter('lint');
    const tumble = getCharacter('tumble');
    const zap = getCharacter('zap');
    expect(tumble.caps.speed!.max!).toBeLessThan(zap.stats.speed!);
    expect(tumble.caps.dashCooldown!.min!).toBeGreaterThan(zap.stats.dashCooldown!);
    expect(tumble.caps.magnetRadius!.max!).toBeLessThan(envelope('zap', []).magnetRadius);
    expect(zap.caps.maxHealth!.max!).toBeLessThan(tumble.stats.maxHealth!);
    expect(zap.caps.suctionMultiplier!.min!).toBeGreaterThan(lint.stats.suctionMultiplier ?? BASE_BUNNY_STATS.suctionMultiplier);
  });
});
