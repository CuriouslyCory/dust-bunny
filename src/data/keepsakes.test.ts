import { describe, expect, it } from 'vitest';
import { computeStats, BASE_BUNNY_STATS, type StatKey, type StatModifier } from '../entities/stats';
import { upgradeModifiers } from '../meta/upgrades';
import { CHARACTERS, getCharacter } from './characters';
import {
  effectValue,
  feltCeiling,
  gradeFraction,
  gradeValue,
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

/** Every pair of grade-10 Keepsakes of a Character, duplicates included. */
function pairs(characterId: string): KeepsakeRef[][] {
  const types = keepsakeTypesFor(characterId);
  const out: KeepsakeRef[][] = [];
  for (let i = 0; i < types.length; i++) for (let j = i; j < types.length; j++) out.push([{ type: types[i]!.id, grade: 10 }, { type: types[j]!.id, grade: 10 }]);
  return out;
}

const CAPPED: StatKey[] = ['speed', 'maxHealth', 'dashCooldown', 'magnetRadius', 'knockbackResistance', 'suctionMultiplier'];
const EPS = 1e-9;

describe('grade curve', () => {
  it('puts grades 1–4 at 0 / 22 / 35 / 46 % of the range and grade 10 at 100 %', () => {
    const expected = [0, 22, 35, 46, 100];
    [1, 2, 3, 4, 10].forEach((g, i) => expect(Math.abs(gradeFraction(g) * 100 - expected[i]!)).toBeLessThan(0.6));
    expect(gradeValue(1, 1, 5)).toBe(1);
    expect(gradeValue(10, 1, 5)).toBe(5);
  });

  it('gives Arc whole extra targets by step', () => {
    const arc = KEEPSAKE_TYPES.find((t) => t.id === 'arc')!;
    expect([1, 4, 5, 8, 9, 10].map((g) => effectValue(arc, 'jumps', g))).toEqual([1, 1, 2, 2, 3, 3]);
  });

  it('adds two copies together', () => {
    expect(loadoutValue([{ type: 'snowball', grade: 10 }, { type: 'snowball', grade: 10 }], 'snowball', 'magnet')).toBeCloseTo(5);
  });
});

describe('Keepsake catalogue', () => {
  it('has five types per Character', () => {
    for (const c of CHARACTERS) expect(keepsakeTypesFor(c.id)).toHaveLength(5);
  });

  it('round-trips Hoard keys and rejects bad ones', () => {
    expect(parseHoardKey(hoardKey({ type: 'arc', grade: 3 }))).toEqual({ type: 'arc', grade: 3 });
    expect(parseHoardKey('arc:11')).toBeNull();
    expect(parseHoardKey('nope:1')).toBeNull();
  });

  it('only allows a Character its own types', () => {
    expect(isLoadoutFor('lint', [{ type: 'reclaim', grade: 1 }, { type: 'reclaim', grade: 2 }])).toBe(true);
    expect(isLoadoutFor('lint', [{ type: 'arc', grade: 1 }])).toBe(false);
    expect(isLoadoutFor('lint', [{ type: 'reclaim', grade: 1 }, { type: 'reclaim', grade: 1 }, { type: 'reclaim', grade: 1 }])).toBe(false);
  });

  it('caps Felting one grade above the best boss beaten', () => {
    expect(feltCeiling([])).toBe(0);
    expect(feltCeiling(['robovac_9000'])).toBe(2);
    expect(feltCeiling(['robovac_9000', 'street_sweeper', 'garbage_truck'])).toBe(4);
  });
});

describe('stat caps and envelope', () => {
  it('keeps every grade-10 pair (duplicates included) within the caps', () => {
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

  it('lands two grade-10 copies of a stat type exactly on the cap', () => {
    const two = (type: KeepsakeRef['type']) => [{ type, grade: 10 }, { type, grade: 10 }];
    expect(envelope('tumble', two('thick_undercoat')).knockbackResistance).toBeCloseTo(0.9);
    expect(envelope('tumble', two('thick_undercoat')).suctionMultiplier).toBeCloseTo(0.6);
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
