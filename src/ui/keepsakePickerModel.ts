/**
 * What the Keepsake picker shows for one Loadout slot, as plain data: the Hoard's kinds filtered by
 * type and rarity, grouped best rarity first or by type, with each row's copies left after the
 * other slots and its tag ("In this slot", "1 in slot 2"). The DOM lives in keepsakePicker.ts.
 */
import {
  FELT_INPUT,
  getKeepsakeType,
  getRarity,
  keepsakeLabel,
  keepsakeTypesFor,
  MAX_RARITY,
  type KeepsakeRef,
  type KeepsakeTypeId,
} from '../data/keepsakes';

export type PickerSort = 'best' | 'type';

export interface PickerFilter {
  /** Only this type (null: every type). */
  type: KeepsakeTypeId | null;
  /** Only these rarities (empty: any rarity). */
  rarities: readonly number[];
}

export interface PickerInput {
  characterId: string;
  /** The Character's Hoard cells (`hoardEntries`). */
  entries: ReadonlyArray<KeepsakeRef & { count: number }>;
  /** Every Loadout slot (null for an empty one). */
  slots: ReadonlyArray<KeepsakeRef | null>;
  /** The slot being filled. */
  slot: number;
  filter: PickerFilter;
  sort: PickerSort;
  /** Highest rarity the Character can felt (`feltCeiling`), for the Felting tip. */
  feltCeiling: number;
}

export interface PickerRow extends KeepsakeRef {
  /** Copies in the Hoard. */
  count: number;
  /** Copies not in another slot. */
  left: number;
  /** This slot holds it. */
  selected: boolean;
  /** Every copy is in another slot. */
  disabled: boolean;
  /** "In this slot", "In slot 2", "1 in slot 2" or "". */
  tag: string;
}

export interface PickerGroup {
  /** "rarity:5" or "type:arc". */
  key: string;
  /** Set when sorted best first. */
  rarity?: number;
  /** Set when sorted by type. */
  type?: KeepsakeTypeId;
  rows: PickerRow[];
  /** "2 kinds" (best first) or "4 kinds · 7 owned" (by type). */
  countLabel: string;
}

export interface PickerTypeOption {
  /** null for "All Keepsakes". */
  type: KeepsakeTypeId | null;
  /** Keepsakes owned of this type. */
  count: number;
  /** Best rarity owned (0 when none). */
  best: number;
}

export interface PickerModel {
  groups: PickerGroup[];
  types: PickerTypeOption[];
  /** Kinds (type and rarity cells) in the Hoard, and Keepsakes in them. */
  kinds: number;
  owned: number;
  /** The same after the filters. */
  shownKinds: number;
  shownOwned: number;
  filtered: boolean;
  /** "Arc at Rare and Epic is hidden by the rarity filter." */
  hiddenNote: string | null;
  /** "Three Arc · Legendary would felt into another Mythic Under the Couch." */
  feltTip: string | null;
}

const kinds = (n: number): string => `${n} ${n === 1 ? 'kind' : 'kinds'}`;
const NUMBER_WORDS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five'];
const article = (word: string): string => (/^[AEIOU]/.test(word) ? 'an' : 'a');

/** "Mythic", "Legendary and Mythic", "Rare, Epic and Mythic" (rarities in order). */
export function rarityList(rarities: readonly number[]): string {
  const names = [...rarities].sort((a, b) => a - b).map((r) => getRarity(r).name);
  return names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

const sameRef = (a: KeepsakeRef | null | undefined, b: KeepsakeRef): boolean => !!a && a.type === b.type && a.rarity === b.rarity;

export function pickerRow(e: KeepsakeRef & { count: number }, slots: ReadonlyArray<KeepsakeRef | null>, slot: number): PickerRow {
  const others = slots.map((k, i) => (i !== slot && sameRef(k, e) ? i : -1)).filter((i) => i >= 0);
  const left = e.count - others.length;
  const selected = sameRef(slots[slot], e);
  const tag = selected ? 'In this slot' : others.length ? (left < 1 ? `In slot ${others[0]! + 1}` : `${others.length} in slot ${others[0]! + 1}`) : '';
  return { type: e.type, rarity: e.rarity, count: e.count, left, selected, disabled: !selected && left < 1, tag };
}

export function pickerModel(input: PickerInput): PickerModel {
  const { entries, filter } = input;
  const order = keepsakeTypesFor(input.characterId).map((t) => t.id);
  const typeIndex = (t: KeepsakeTypeId) => order.indexOf(t);
  const ofType = entries.filter((e) => filter.type === null || e.type === filter.type);
  const shown = ofType.filter((e) => filter.rarities.length === 0 || filter.rarities.includes(e.rarity));
  const rows = shown.map((e) => pickerRow(e, input.slots, input.slot));
  const sum = (list: ReadonlyArray<{ count: number }>) => list.reduce((a, e) => a + e.count, 0);

  let groups: PickerGroup[];
  if (input.sort === 'best') {
    groups = [];
    for (let r = MAX_RARITY; r >= 1; r--) {
      const g = rows.filter((x) => x.rarity === r).sort((a, b) => typeIndex(a.type) - typeIndex(b.type));
      if (g.length) groups.push({ key: `rarity:${r}`, rarity: r, rows: g, countLabel: kinds(g.length) });
    }
  } else {
    groups = order
      .map((t) => {
        const g = rows.filter((x) => x.type === t).sort((a, b) => a.rarity - b.rarity);
        return { key: `type:${t}`, type: t, rows: g, countLabel: `${kinds(g.length)} · ${sum(g)} owned` };
      })
      .filter((g) => g.rows.length);
  }

  const best = (list: ReadonlyArray<KeepsakeRef>) => list.reduce((b, e) => Math.max(b, e.rarity), 0);
  const types: PickerTypeOption[] = [
    { type: null, count: sum(entries), best: best(entries) },
    ...order.map((t) => {
      const own = entries.filter((e) => e.type === t);
      return { type: t, count: sum(own), best: best(own) };
    }),
  ];

  // Kinds of the chosen type (or any type) that only the rarity filter hides.
  const hiddenRarities = [...new Set(ofType.filter((e) => !shown.includes(e)).map((e) => e.rarity))];
  let hiddenNote: string | null = null;
  if (hiddenRarities.length) {
    const list = rarityList(hiddenRarities);
    hiddenNote = filter.type
      ? `${getKeepsakeType(filter.type)?.name ?? filter.type} at ${list} is hidden by the rarity filter.`
      : `${list} Keepsakes are hidden by the rarity filter.`;
  }

  // With one type chosen: what Felting its best shown kind (below the ceiling) would make.
  let feltTip: string | null = null;
  if (filter.type) {
    const from = shown.filter((e) => e.rarity < MAX_RARITY && e.rarity + 1 <= input.feltCeiling).sort((a, b) => b.rarity - a.rarity)[0];
    if (from) {
      const next = getRarity(from.rarity + 1).name;
      const owned = entries.some((e) => e.type === from.type && e.rarity === from.rarity + 1);
      feltTip = `${NUMBER_WORDS[FELT_INPUT] ?? FELT_INPUT} ${keepsakeLabel(from)} would felt into ${owned ? 'another' : article(next)} ${next} Under the Couch.`;
    }
  }

  return {
    groups,
    types,
    kinds: entries.length,
    owned: sum(entries),
    shownKinds: shown.length,
    shownOwned: sum(shown),
    filtered: filter.type !== null || filter.rarities.length > 0,
    hiddenNote,
    feltTip,
  };
}
