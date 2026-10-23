/**
 * Keepsakes: Ability modifiers that bosses leave tangled in the fur of the Character that beat
 * them. Five types per Character, each with a rarity (common → mythic) rolled from the boss's drop
 * table or made by Felting three of the rarity below. Tunable data and pure helpers only; drops
 * and the Hoard live in src/meta/keepsakes.ts, the in-Run effects in src/abilities/.
 */

/** Highest rarity (mythic). Rarities are 1 (common) … 5 (mythic). */
export const MAX_RARITY = 5;
/** Keepsake slots in a Loadout. */
export const LOADOUT_SLOTS = 2;
/** Most Keepsakes of one type and rarity a Hoard holds. */
export const HOARD_STACK_MAX = 99;

export type RarityId = 'common' | 'rare' | 'epic' | 'legendary' | 'mythic';

export interface RarityData {
  rarity: number;
  /** Id used in Hoard keys ("thick_clog:epic"). */
  id: RarityId;
  /** Display name, e.g. "Epic". */
  name: string;
  /** Particle / pip colour. */
  color: string;
}

export const RARITIES: readonly RarityData[] = [
  { rarity: 1, id: 'common', name: 'Common', color: '#a8a39a' },
  { rarity: 2, id: 'rare', name: 'Rare', color: '#3f8fe0' },
  { rarity: 3, id: 'epic', name: 'Epic', color: '#a35ce8' },
  { rarity: 4, id: 'legendary', name: 'Legendary', color: '#f08a24' },
  { rarity: 5, id: 'mythic', name: 'Mythic', color: '#e8425a' },
];

export function getRarity(rarity: number): RarityData {
  return RARITIES[Math.min(MAX_RARITY, Math.max(1, Math.round(rarity))) - 1]!;
}

/** The rarity for an id ("epic" → 3), or null. */
export function rarityFromId(id: string): number | null {
  return RARITIES.find((r) => r.id === id)?.rarity ?? null;
}

/**
 * The rarity for a grade 1–10 from saves, Hoard keys and leaderboard entries made before rarities
 * (1–2 common, 3–4 rare, 5–6 epic, 7–8 legendary, 9–10 mythic), or null for anything else.
 */
export function rarityFromLegacyGrade(grade: unknown): number | null {
  if (typeof grade !== 'number' || !Number.isInteger(grade) || grade < 1 || grade > 10) return null;
  return Math.ceil(grade / 2);
}

/** A boss's drop table: % chance of each rarity, common → mythic (each row sums to 100). */
export interface BossDropTable {
  bossId: string;
  bossName: string;
  act: number;
  chances: readonly [number, number, number, number, number];
}

/**
 * Drop tables, one per boss. Built from one falloff by distance from the boss's peak rarity
 * (84 / 10 / 5 / 0.9 / 0.1 % at 0–4 rarities away, normalised per row). The peak moves from
 * common (Act 1) to mythic (Act 9) along peak = 3 + 2·sign(x)·|x|^1.5 with x = (act − 5) / 4, so
 * Acts 4–6 all peak at epic; a peak between two rarities blends those two rows. Blending (not
 * sliding the falloff) keeps P(this rarity or better) rising boss by boss at every rarity, which
 * keepsakes.test.ts checks. Rounded to 0.1 %.
 */
export const BOSS_DROP_TABLES: readonly BossDropTable[] = [
  { act: 1, bossId: 'robovac_9000', bossName: 'Robo-Vac 9000', chances: [84, 10, 5, 0.9, 0.1] },
  { act: 2, bossId: 'street_sweeper', bossName: 'Street Sweeper', chances: [31.4, 56.6, 7.9, 3.5, 0.6] },
  { act: 3, bossId: 'garbage_truck', bossName: 'Garbage Truck', chances: [7.7, 56.6, 28, 5.8, 1.9] },
  { act: 4, bossId: 'incinerator', bossName: 'Incinerator', chances: [5.6, 25.7, 57.5, 7.7, 3.5] },
  { act: 5, bossId: 'ice_sheet', bossName: 'Ice Sheet', chances: [4.4, 8.8, 73.6, 8.8, 4.4] },
  { act: 6, bossId: 'orbital_sweeper', bossName: 'Orbital Sweeper', chances: [3.5, 7.7, 57.5, 25.7, 5.6] },
  { act: 7, bossId: 'the_sun', bossName: 'The Sun', chances: [1.9, 5.8, 28, 56.6, 7.7] },
  { act: 8, bossId: 'sagittarius_a', bossName: 'Sagittarius A*', chances: [0.6, 3.5, 7.9, 56.6, 31.4] },
  // Act 9 (#29): rename the id here if the Expansion's Hazard id differs.
  { act: 9, bossId: 'the_expansion', bossName: 'The Expansion', chances: [0.1, 0.9, 5, 10, 84] },
];

/** A boss's drop table, or null if it drops no Keepsake. */
export function dropTableFor(bossId: string): BossDropTable | null {
  return BOSS_DROP_TABLES.find((t) => t.bossId === bossId) ?? null;
}

/** A boss's display name from its drop table (the id for a boss without one). */
export function bossNameFor(bossId: string): string {
  return dropTableFor(bossId)?.bossName ?? bossId;
}

/** The highest rarity among some Keepsakes (common when there are none). */
export function bestRarity(refs: readonly KeepsakeRef[]): number {
  return refs.reduce((best, r) => Math.max(best, r.rarity), 1);
}

/** The rarity a roll in [0, 1) lands on in a drop table. */
export function rollRarity(table: BossDropTable, roll: number): number {
  const total = table.chances.reduce((a, b) => a + b, 0);
  let acc = 0;
  for (let i = 0; i < table.chances.length; i++) {
    acc += table.chances[i]! / total;
    if (roll < acc) return i + 1;
  }
  return MAX_RARITY;
}

/** A boss's most likely rarity (its peak), or null if it drops no Keepsake. */
export function peakRarityForBoss(bossId: string): number | null {
  const t = dropTableFor(bossId);
  if (!t) return null;
  let best = 0;
  t.chances.forEach((c, i) => {
    if (c > t.chances[best]!) best = i;
  });
  return best + 1;
}

/** Fraction of the common → mythic range reached at a rarity: ((r − 1) / 4)^0.7 (0, 0.38, 0.62, 0.82, 1). */
export function rarityFraction(rarity: number): number {
  const r = Math.min(MAX_RARITY, Math.max(1, rarity));
  return Math.pow((r - 1) / (MAX_RARITY - 1), 0.7);
}

/** A value given at common and mythic, at `rarity` on the curve. */
export function rarityValue(rarity: number, common: number, mythic: number): number {
  return common + (mythic - common) * rarityFraction(rarity);
}

export type KeepsakeTypeId =
  // Lint · Decoy
  | 'long_strand'
  | 'quick_shed'
  | 'thick_clog'
  | 'dinner_bell'
  | 'reclaim'
  // Tumble · Hunker
  | 'loose_roots'
  | 'bristle_back'
  | 'snowball'
  | 'dead_weight'
  | 'thick_undercoat'
  // Zap · Discharge
  | 'live_wire'
  | 'long_reach'
  | 'arc'
  | 'static_cling'
  | 'grounding';

/** A named effect value: `common` at common, `mythic` at mythic (or a step table for Arc). */
export interface EffectValue {
  common: number;
  mythic: number;
  /** Optional per-rarity override (index 0 = common); used by Arc's whole extra targets. */
  steps?: readonly number[];
}

export interface KeepsakeType {
  id: KeepsakeTypeId;
  characterId: 'lint' | 'tumble' | 'zap';
  name: string;
  icon: string;
  /** Effect values by key. Two copies in a Loadout add together (`loadoutValue`). */
  effects: Readonly<Record<string, EffectValue>>;
  /** One-line description with the values of a Loadout total filled in. */
  describe(v: (key: string) => number): string;
}

const pct = (x: number): string => `${Math.round(x * 100)}%`;
const n1 = (x: number): string => (Math.round(x * 10) / 10).toString();

export const KEEPSAKE_TYPES: readonly KeepsakeType[] = [
  // --- Lint · Decoy: none touch stats; Lint's identity is the Decoy. ---
  {
    id: 'long_strand',
    characterId: 'lint',
    name: 'Long Strand',
    icon: '🧵',
    effects: { duration: { common: 1, mythic: 5 } },
    describe: (v) => `Decoy lasts +${n1(v('duration'))} s`,
  },
  {
    id: 'quick_shed',
    characterId: 'lint',
    name: 'Quick Shed',
    icon: '⏱️',
    effects: { cooldown: { common: 0.1, mythic: 0.45 } },
    describe: (v) => `Decoy cooldown −${pct(v('cooldown'))}`,
  },
  {
    id: 'thick_clog',
    characterId: 'lint',
    name: 'Thick Clog',
    icon: '🧱',
    effects: { clogStun: { common: 0.4, mythic: 2 } },
    describe: (v) => `Clog stun +${n1(v('clogStun'))} s (bosses +${n1(v('clogStun') / 2)} s)`,
  },
  {
    id: 'dinner_bell',
    characterId: 'lint',
    name: 'Dinner Bell',
    icon: '🔔',
    effects: { wanderRange: { common: 4, mythic: 12 }, lureRange: { common: 0, mythic: 0.6 } },
    describe: (v) => `Wanderers within ${n1(v('wanderRange'))} r home in on the Decoy; lure range +${pct(v('lureRange'))}`,
  },
  {
    id: 'reclaim',
    characterId: 'lint',
    name: 'Reclaim',
    icon: '♻️',
    effects: { volume: { common: 0.01, mythic: 0.04 } },
    describe: (v) => `A spent Decoy leaves fibre worth ${pct(v('volume'))} of your volume`,
  },
  // --- Tumble · Hunker ---
  {
    id: 'loose_roots',
    characterId: 'tumble',
    name: 'Loose Roots',
    icon: '🌿',
    // Seconds of Hunker cooldown per second held saved (base 1.0 s; one mythic copy brings it to 0.4 s).
    effects: { perSecondSaved: { common: 0.1, mythic: 0.6 } },
    describe: (v) => `Hunker cooldown per second held −${n1(v('perSecondSaved'))} s`,
  },
  {
    id: 'bristle_back',
    characterId: 'tumble',
    name: 'Bristle Back',
    icon: '🦔',
    effects: { knockback: { common: 2, mythic: 5 }, stun: { common: 0.5, mythic: 2 } },
    describe: (v) => `Hazards touching you while planted: knocked back ${n1(v('knockback'))} r, stunned ${n1(v('stun'))} s`,
  },
  {
    id: 'snowball',
    characterId: 'tumble',
    name: 'Snowball',
    icon: '⛄',
    effects: { magnet: { common: 0.5, mythic: 2.5 } },
    describe: (v) => `Magnet +${n1(v('magnet'))} while planted`,
  },
  {
    id: 'dead_weight',
    characterId: 'tumble',
    name: 'Dead Weight',
    icon: '⚓',
    effects: { bossStun: { common: 0.3, mythic: 1.5 }, extraParts: { common: 2, mythic: 6 } },
    describe: (v) => `Hunker boss stuns +${n1(v('bossStun'))} s; hits knock loose +${Math.round(v('extraParts'))} parts`,
  },
  {
    id: 'thick_undercoat',
    characterId: 'tumble',
    name: 'Thick Undercoat',
    icon: '🧥',
    effects: { knockbackResistance: { common: 0.02, mythic: 0.2 }, suction: { common: 0.03, mythic: 0.2 } },
    describe: (v) => `Always: knockback resistance +${pct(v('knockbackResistance'))}, suction −${pct(v('suction'))}`,
  },
  // --- Zap · Discharge ---
  {
    id: 'live_wire',
    characterId: 'zap',
    name: 'Live Wire',
    icon: '🔌',
    effects: { fillRate: { common: 0.1, mythic: 0.5 } },
    describe: (v) => `Static meter fills ${pct(v('fillRate'))} faster`,
  },
  {
    id: 'long_reach',
    characterId: 'zap',
    name: 'Long Reach',
    icon: '📡',
    effects: { range: { common: 1, mythic: 4 } },
    describe: (v) => `Discharge range +${n1(v('range'))} r`,
  },
  {
    id: 'arc',
    characterId: 'zap',
    name: 'Arc',
    icon: '🌩️',
    effects: { jumps: { common: 1, mythic: 3, steps: [1, 1, 2, 2, 3] } },
    describe: (v) => `Discharge jumps to ${Math.round(v('jumps'))} more Hazard${Math.round(v('jumps')) === 1 ? '' : 's'} within 4 r`,
  },
  {
    id: 'static_cling',
    characterId: 'zap',
    name: 'Static Cling',
    icon: '🧲',
    effects: { magnet: { common: 0.1, mythic: 0.6 } },
    describe: (v) => `Magnet +${n1(v('magnet'))} while the meter is at least half full`,
  },
  {
    id: 'grounding',
    characterId: 'zap',
    name: 'Grounding',
    icon: '⏚',
    effects: { suction: { common: 0.025, mythic: 0.1 } },
    describe: (v) => `Suction −${pct(v('suction'))} while the meter is full`,
  },
];

export const KEEPSAKE_TYPE_IDS: readonly KeepsakeTypeId[] = KEEPSAKE_TYPES.map((t) => t.id);

export function getKeepsakeType(id: string): KeepsakeType | undefined {
  return KEEPSAKE_TYPES.find((t) => t.id === id);
}

export function keepsakeTypesFor(characterId: string): readonly KeepsakeType[] {
  return KEEPSAKE_TYPES.filter((t) => t.characterId === characterId);
}

/** One Keepsake (in a Loadout slot, a drop, or a Hoard cell). */
export interface KeepsakeRef {
  type: KeepsakeTypeId;
  rarity: number;
}

/** The Keepsakes tucked in for a Run (0–2; both slots may hold the same type). */
export type Loadout = readonly KeepsakeRef[];

/** Value of one effect for a single Keepsake. */
export function effectValue(type: KeepsakeType, key: string, rarity: number): number {
  const e = type.effects[key];
  if (!e) return 0;
  if (e.steps) return e.steps[Math.min(MAX_RARITY, Math.max(1, Math.round(rarity))) - 1] ?? 0;
  return rarityValue(rarity, e.common, e.mythic);
}

/** Sum of an effect over every slot holding `typeId` (0 when none). Copies add together. */
export function loadoutValue(loadout: Loadout | undefined, typeId: KeepsakeTypeId, key: string): number {
  if (!loadout) return 0;
  const type = getKeepsakeType(typeId);
  if (!type) return 0;
  let sum = 0;
  for (const k of loadout) if (k.type === typeId) sum += effectValue(type, key, k.rarity);
  return sum;
}

/** Description of a single Keepsake at its rarity. */
export function describeKeepsake(ref: KeepsakeRef): string {
  const type = getKeepsakeType(ref.type);
  if (!type) return '';
  return type.describe((key) => effectValue(type, key, ref.rarity));
}

/** "Thick Clog · Epic" */
export function keepsakeLabel(ref: KeepsakeRef): string {
  return `${getKeepsakeType(ref.type)?.name ?? ref.type} · ${getRarity(ref.rarity).name}`;
}

/** Hoard key for a type and rarity, e.g. "thick_clog:epic". */
export function hoardKey(ref: KeepsakeRef): string {
  return `${ref.type}:${getRarity(ref.rarity).id}`;
}

/**
 * Parses a Hoard key ("thick_clog:epic"). With `legacy`, also a key from before rarities
 * ("thick_clog:6", grade 1–10, see `rarityFromLegacyGrade`); several old keys can map to one
 * rarity, so callers add their counts together.
 */
export function parseHoardKey(key: string, legacy = false): KeepsakeRef | null {
  const [type, r, extra] = key.split(':');
  if (!type || r === undefined || extra !== undefined || !getKeepsakeType(type)) return null;
  const rarity = rarityFromId(r) ?? (legacy && /^\d+$/.test(r) ? rarityFromLegacyGrade(Number(r)) : null);
  return rarity === null ? null : { type: type as KeepsakeTypeId, rarity };
}

/**
 * Reads a stored `{ type, rarity }`, or a `{ type, grade }` saved before rarities, as a
 * KeepsakeRef (unchecked type; null when neither field holds a valid value).
 */
export function refFromStored(raw: { type?: unknown; rarity?: unknown; grade?: unknown }): KeepsakeRef | null {
  const r = raw.rarity;
  const rarity = r !== undefined ? (typeof r === 'number' && Number.isInteger(r) && r >= 1 && r <= MAX_RARITY ? r : null) : rarityFromLegacyGrade(raw.grade);
  return rarity === null || typeof raw.type !== 'string' ? null : { type: raw.type as KeepsakeTypeId, rarity };
}

/** True if a Loadout is legal for a Character (≤ 2 slots, its own types, rarities 1–5). */
export function isLoadoutFor(characterId: string, loadout: Loadout): boolean {
  return (
    loadout.length <= LOADOUT_SLOTS &&
    loadout.every((k) => getKeepsakeType(k.type)?.characterId === characterId && Number.isInteger(k.rarity) && k.rarity >= 1 && k.rarity <= MAX_RARITY)
  );
}

// --- Floors (two stacked copies at any rarity must leave the Ability playable) ---

/**
 * Limits applied after a Loadout's Keepsakes are added up (src/abilities/keepsakeParams.ts), so
 * two copies at any rarity keep the Ability's numbers sane. Only these two bind; every other
 * effect stays reasonable at two mythic copies, and the stat effects are bounded by the caps.
 */
export const KEEPSAKE_FLOORS = {
  /**
   * Decoy cooldown is never shorter than the Decoy's duration, so it is on the floor at most half
   * the time. Binds for two legendary Quick Sheds (−77%: 16 s → 3.7 s, raised to 4 s) or better,
   * and for a Quick Shed beside a Long Strand only when both are mythic (8.8 s → 9 s).
   */
  decoyCooldownPerDuration: 1,
  /**
   * Hunker cooldown per second held never drops below 0.2 s. Binds for two epic Loose Roots or
   * better (two mythic copies save 1.2 s of the base 1.0 s), so a long hold always costs something.
   */
  hunkerPerSecondHeld: 0.2,
} as const;

// --- Felting ---

/** Keepsakes of one type and rarity felted into one of the next rarity. */
export const FELT_INPUT = 3;
/** Fluff to felt into `resultRarity`: 160 × r² (rare 640, epic 1,440, legendary 2,560, mythic 4,000). */
export const feltCost = (resultRarity: number): number => 160 * resultRarity * resultRarity;
/** Fluff for shedding (discarding) one Keepsake of `rarity`: 40 × r² (common 40 … mythic 1,000). */
export const shedValue = (rarity: number): number => 40 * rarity * rarity;

/**
 * Highest rarity Felting may produce for a Character: one above the best peak rarity
 * (`peakRarityForBoss`) among the bosses it has beaten, at most mythic (0 when it has beaten none).
 */
export function feltCeiling(bossesBeaten: readonly string[]): number {
  let best = 0;
  for (const id of bossesBeaten) best = Math.max(best, peakRarityForBoss(id) ?? 0);
  return best === 0 ? 0 : Math.min(MAX_RARITY, best + 1);
}

// --- Drops ---

export const DROP_RULES = {
  /** Keepsakes per boss kill (random type and rarity from the boss's drop table, seeded). */
  perKill: 1,
  /** Extra Keepsakes per boss kill on Hardcore (each rolls its own rarity). */
  hardcoreBonus: 1,
  /** Types offered on a Character's first kill of a boss (choose one instead of a random type; one rarity for all). */
  firstKillChoices: 3,
} as const;

// --- Stat-touching types (for caps / envelope) ---

/**
 * How a Keepsake effect changes a Bunny stat. `add` adds the Loadout total; `reduce` multiplies
 * by (1 − Loadout total). `when` marks effects that only apply in an Ability state; the envelope
 * still counts them (except Snowball, which the caps exempt while planted).
 */
export interface KeepsakeStatEffect {
  type: KeepsakeTypeId;
  key: string;
  stat: 'knockbackResistance' | 'suctionMultiplier' | 'magnetRadius';
  op: 'add' | 'reduce';
  when: 'always' | 'meterHalf' | 'meterFull';
}

export const KEEPSAKE_STAT_EFFECTS: readonly KeepsakeStatEffect[] = [
  { type: 'thick_undercoat', key: 'knockbackResistance', stat: 'knockbackResistance', op: 'add', when: 'always' },
  { type: 'thick_undercoat', key: 'suction', stat: 'suctionMultiplier', op: 'reduce', when: 'always' },
  { type: 'static_cling', key: 'magnet', stat: 'magnetRadius', op: 'add', when: 'meterHalf' },
  { type: 'grounding', key: 'suction', stat: 'suctionMultiplier', op: 'reduce', when: 'meterFull' },
];
