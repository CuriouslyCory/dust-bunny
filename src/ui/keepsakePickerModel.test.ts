import { describe, expect, it } from 'vitest';
import type { KeepsakeRef, KeepsakeTypeId } from '../data/keepsakes';
import { pickerModel, pickerRow, rarityList, type PickerInput } from './keepsakePickerModel';

const e = (type: KeepsakeTypeId, rarity: number, count: number) => ({ type, rarity, count });

/** Zap's Hoard from the design: 14 kinds, 24 Keepsakes. */
const HOARD = [
  e('live_wire', 3, 1),
  e('live_wire', 5, 1),
  e('long_reach', 4, 1),
  e('long_reach', 5, 3),
  e('arc', 2, 1),
  e('arc', 3, 1),
  e('arc', 4, 1),
  e('arc', 5, 4),
  e('static_cling', 2, 1),
  e('static_cling', 3, 3),
  e('static_cling', 5, 2),
  e('grounding', 1, 1),
  e('grounding', 3, 2),
  e('grounding', 4, 2),
];
const SLOTS: KeepsakeRef[] = [
  { type: 'arc', rarity: 5 },
  { type: 'live_wire', rarity: 5 },
];

const input = (over: Partial<PickerInput> = {}): PickerInput => ({
  characterId: 'zap',
  entries: HOARD,
  slots: SLOTS,
  slot: 0,
  filter: { type: null, rarities: [] },
  sort: 'best',
  feltCeiling: 5,
  ...over,
});

describe('pickerModel', () => {
  it('best first: one group per owned rarity, Mythic down, rows in type order', () => {
    const m = pickerModel(input());
    expect(m.groups.map((g) => [g.rarity, g.countLabel])).toEqual([
      [5, '4 kinds'],
      [4, '3 kinds'],
      [3, '4 kinds'],
      [2, '2 kinds'],
      [1, '1 kind'],
    ]);
    expect(m.groups[0]!.rows.map((r) => r.type)).toEqual(['live_wire', 'long_reach', 'arc', 'static_cling']);
    expect([m.kinds, m.owned, m.shownKinds, m.shownOwned, m.filtered]).toEqual([14, 24, 14, 24, false]);
  });

  it('by type: one group per type in type order, rarities rising, with kinds and owned', () => {
    const m = pickerModel(input({ sort: 'type' }));
    expect(m.groups.map((g) => [g.type, g.countLabel])).toEqual([
      ['live_wire', '2 kinds · 2 owned'],
      ['long_reach', '2 kinds · 4 owned'],
      ['arc', '4 kinds · 7 owned'],
      ['static_cling', '3 kinds · 6 owned'],
      ['grounding', '3 kinds · 5 owned'],
    ]);
    expect(m.groups[2]!.rows.map((r) => r.rarity)).toEqual([2, 3, 4, 5]);
  });

  it('type options: All plus each type with its count and best rarity', () => {
    const m = pickerModel(input());
    expect(m.types).toEqual([
      { type: null, count: 24, best: 5 },
      { type: 'live_wire', count: 2, best: 5 },
      { type: 'long_reach', count: 4, best: 5 },
      { type: 'arc', count: 7, best: 5 },
      { type: 'static_cling', count: 6, best: 5 },
      { type: 'grounding', count: 5, best: 4 },
    ]);
  });

  it('filtered to Arc at Legendary and Mythic: counts, the hidden note and the Felting tip', () => {
    const m = pickerModel(input({ filter: { type: 'arc', rarities: [5, 4] } }));
    expect(m.groups.map((g) => g.rows.map((r) => `${r.type}:${r.rarity}`))).toEqual([['arc:5'], ['arc:4']]);
    expect([m.shownKinds, m.shownOwned, m.filtered]).toEqual([2, 5, true]);
    expect(m.hiddenNote).toBe('Arc at Rare and Epic is hidden by the rarity filter.');
    expect(m.feltTip).toBe('Three Arc · Legendary would felt into another Mythic Under the Couch.');
  });

  it('no hidden note without a rarity filter; a rarity filter alone names the hidden rarities', () => {
    expect(pickerModel(input({ filter: { type: 'arc', rarities: [] } })).hiddenNote).toBeNull();
    expect(pickerModel(input({ filter: { type: null, rarities: [5] } })).hiddenNote).toBe('Common, Rare, Epic and Legendary Keepsakes are hidden by the rarity filter.');
  });

  it('the Felting tip respects the ceiling and says "a"/"an" for a rarity not yet owned', () => {
    expect(pickerModel(input({ filter: { type: 'arc', rarities: [] }, feltCeiling: 3 })).feltTip).toBe('Three Arc · Rare would felt into another Epic Under the Couch.');
    expect(pickerModel(input({ filter: { type: 'grounding', rarities: [1] }, feltCeiling: 2 })).feltTip).toBe('Three Grounding · Common would felt into a Rare Under the Couch.');
    expect(pickerModel(input({ filter: { type: 'arc', rarities: [] }, feltCeiling: 0 })).feltTip).toBeNull();
    expect(pickerModel(input({ filter: { type: 'arc', rarities: [5] } })).feltTip).toBeNull();
  });

  it('an empty Hoard has no groups', () => {
    const m = pickerModel(input({ entries: [], slots: [null, null] }));
    expect([m.groups, m.kinds, m.owned]).toEqual([[], 0, 0]);
    expect(m.types[0]).toEqual({ type: null, count: 0, best: 0 });
  });
});

describe('pickerRow', () => {
  it('tags the slot being filled and copies held by the other slot', () => {
    expect(pickerRow(e('arc', 5, 4), SLOTS, 0)).toMatchObject({ selected: true, disabled: false, left: 4, tag: 'In this slot' });
    // The only Live Wire · Mythic is in slot 2.
    expect(pickerRow(e('live_wire', 5, 1), SLOTS, 0)).toMatchObject({ selected: false, disabled: true, left: 0, tag: 'In slot 2' });
    // Two copies, one in slot 2: one left.
    expect(pickerRow(e('live_wire', 5, 2), SLOTS, 0)).toMatchObject({ disabled: false, left: 1, tag: '1 in slot 2' });
    expect(pickerRow(e('grounding', 1, 1), SLOTS, 0)).toMatchObject({ selected: false, disabled: false, left: 1, tag: '' });
    // Filling slot 2: Arc · Mythic is in slot 1.
    expect(pickerRow(e('arc', 5, 4), SLOTS, 1)).toMatchObject({ selected: false, left: 3, tag: '1 in slot 1' });
  });
});

describe('rarityList', () => {
  it('joins rarity names in order', () => {
    expect(rarityList([])).toBe('');
    expect(rarityList([5])).toBe('Mythic');
    expect(rarityList([5, 4])).toBe('Legendary and Mythic');
    expect(rarityList([5, 2, 3])).toBe('Rare, Epic and Mythic');
  });
});
