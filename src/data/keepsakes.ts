/**
 * Keepsakes: Ability modifiers that bosses leave tangled in the fur of the Character that beat
 * them. Five types per Character, each with a grade (1–10) set by the boss it came from or by
 * Felting three of the grade below. Tunable data and pure helpers only; drops and the Hoard live
 * in src/meta/keepsakes.ts, the in-Run effects in src/abilities/.
 */

/** Highest grade (First Dust, from Felting only). */
export const MAX_GRADE = 10;
/** Keepsake slots in a Loadout. */
export const LOADOUT_SLOTS = 2;
/** Most Keepsakes of one type and grade a Hoard holds. */
export const HOARD_STACK_MAX = 99;

export interface GradeData {
  grade: number;
  /** Material name, e.g. "Brush Tangle". */
  material: string;
  /** Boss whose absorption drops this grade (null: Felting only, or a boss not in the game yet). */
  bossId: string | null;
  bossName: string;
  /** Particle / pip colour. */
  color: string;
}

export const GRADES: readonly GradeData[] = [
  { grade: 1, material: 'Brush Tangle', bossId: 'robovac_9000', bossName: 'Robo-Vac 9000', color: '#c9a27a' },
  { grade: 2, material: 'Gutter Grit', bossId: 'street_sweeper', bossName: 'Street Sweeper', color: '#8f8a6e' },
  { grade: 3, material: 'Hopper Gunk', bossId: 'garbage_truck', bossName: 'Garbage Truck', color: '#7a9a4a' },
  { grade: 4, material: 'Cinder Ash', bossId: 'incinerator', bossName: 'Incinerator', color: '#9a9aa0' },
  { grade: 5, material: 'Glacier Silt', bossId: 'ice_sheet', bossName: 'Ice Sheet', color: '#9fd3e8' },
  { grade: 6, material: 'Orbital Flecks', bossId: 'orbital_sweeper', bossName: 'Orbital Sweeper', color: '#b7b2e8' },
  { grade: 7, material: 'Stardust', bossId: 'the_sun', bossName: 'The Sun', color: '#ffd166' },
  { grade: 8, material: 'Horizon Lint', bossId: 'sagittarius_a', bossName: 'Sagittarius A*', color: '#f08a5d' },
  { grade: 9, material: 'Cosmic Dust', bossId: 'the_expansion', bossName: 'The Expansion', color: '#c77dff' },
  { grade: 10, material: 'First Dust', bossId: null, bossName: 'Felting only', color: '#fff6e0' },
];

export function getGrade(grade: number): GradeData {
  return GRADES[Math.min(MAX_GRADE, Math.max(1, Math.round(grade))) - 1]!;
}

/** Grade a boss drops, or null if it drops no Keepsake. */
export function gradeForBoss(bossId: string): number | null {
  return GRADES.find((g) => g.bossId === bossId)?.grade ?? null;
}

/** Fraction of the g1 → g10 range reached at a grade: ((g − 1) / 9)^0.7 (0, 0.22, 0.35, 0.46 …). */
export function gradeFraction(grade: number): number {
  const g = Math.min(MAX_GRADE, Math.max(1, grade));
  return Math.pow((g - 1) / (MAX_GRADE - 1), 0.7);
}

/** A value given at grade 1 and grade 10, at `grade` on the curve. */
export function gradeValue(grade: number, v1: number, v10: number): number {
  return v1 + (v10 - v1) * gradeFraction(grade);
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

/** A named effect value: v1 at grade 1, v10 at grade 10 (or a step table for Arc). */
export interface EffectValue {
  v1: number;
  v10: number;
  /** Optional per-grade override (index 0 = grade 1); used by Arc's whole extra targets. */
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
    effects: { duration: { v1: 1, v10: 5 } },
    describe: (v) => `Decoy lasts +${n1(v('duration'))} s`,
  },
  {
    id: 'quick_shed',
    characterId: 'lint',
    name: 'Quick Shed',
    icon: '⏱️',
    effects: { cooldown: { v1: 0.1, v10: 0.45 } },
    describe: (v) => `Decoy cooldown −${pct(v('cooldown'))}`,
  },
  {
    id: 'thick_clog',
    characterId: 'lint',
    name: 'Thick Clog',
    icon: '🧱',
    effects: { clogStun: { v1: 0.4, v10: 2 } },
    describe: (v) => `Clog stun +${n1(v('clogStun'))} s (bosses +${n1(v('clogStun') / 2)} s)`,
  },
  {
    id: 'dinner_bell',
    characterId: 'lint',
    name: 'Dinner Bell',
    icon: '🔔',
    effects: { wanderRange: { v1: 4, v10: 12 }, lureRange: { v1: 0, v10: 0.6 } },
    describe: (v) => `Wanderers within ${n1(v('wanderRange'))} r home in on the Decoy; lure range +${pct(v('lureRange'))}`,
  },
  {
    id: 'reclaim',
    characterId: 'lint',
    name: 'Reclaim',
    icon: '♻️',
    effects: { volume: { v1: 0.01, v10: 0.04 } },
    describe: (v) => `A spent Decoy leaves fibre worth ${pct(v('volume'))} of your volume`,
  },
  // --- Tumble · Hunker ---
  {
    id: 'loose_roots',
    characterId: 'tumble',
    name: 'Loose Roots',
    icon: '🌿',
    // Seconds of Hunker cooldown per second held saved (base 1.0 s; g10 brings one copy to 0.4 s).
    effects: { perSecondSaved: { v1: 0.1, v10: 0.6 } },
    describe: (v) => `Hunker cooldown per second held −${n1(v('perSecondSaved'))} s`,
  },
  {
    id: 'bristle_back',
    characterId: 'tumble',
    name: 'Bristle Back',
    icon: '🦔',
    effects: { knockback: { v1: 2, v10: 5 }, stun: { v1: 0.5, v10: 2 } },
    describe: (v) => `Hazards touching you while planted: knocked back ${n1(v('knockback'))} r, stunned ${n1(v('stun'))} s`,
  },
  {
    id: 'snowball',
    characterId: 'tumble',
    name: 'Snowball',
    icon: '⛄',
    effects: { magnet: { v1: 0.5, v10: 2.5 } },
    describe: (v) => `Magnet +${n1(v('magnet'))} while planted`,
  },
  {
    id: 'dead_weight',
    characterId: 'tumble',
    name: 'Dead Weight',
    icon: '⚓',
    effects: { bossStun: { v1: 0.3, v10: 1.5 }, extraParts: { v1: 2, v10: 6 } },
    describe: (v) => `Hunker boss stuns +${n1(v('bossStun'))} s; chips knock loose +${Math.round(v('extraParts'))} parts`,
  },
  {
    id: 'thick_undercoat',
    characterId: 'tumble',
    name: 'Thick Undercoat',
    icon: '🧥',
    effects: { knockbackResistance: { v1: 0.02, v10: 0.2 }, suction: { v1: 0.03, v10: 0.2 } },
    describe: (v) => `Always: knockback resistance +${pct(v('knockbackResistance'))}, suction −${pct(v('suction'))}`,
  },
  // --- Zap · Discharge ---
  {
    id: 'live_wire',
    characterId: 'zap',
    name: 'Live Wire',
    icon: '🔌',
    effects: { fillRate: { v1: 0.1, v10: 0.5 } },
    describe: (v) => `Static meter fills ${pct(v('fillRate'))} faster`,
  },
  {
    id: 'long_reach',
    characterId: 'zap',
    name: 'Long Reach',
    icon: '📡',
    effects: { range: { v1: 1, v10: 4 } },
    describe: (v) => `Discharge range +${n1(v('range'))} r`,
  },
  {
    id: 'arc',
    characterId: 'zap',
    name: 'Arc',
    icon: '🌩️',
    effects: { jumps: { v1: 1, v10: 3, steps: [1, 1, 1, 1, 2, 2, 2, 2, 3, 3] } },
    describe: (v) => `Discharge jumps to ${Math.round(v('jumps'))} more Hazard${Math.round(v('jumps')) === 1 ? '' : 's'} within 4 r`,
  },
  {
    id: 'static_cling',
    characterId: 'zap',
    name: 'Static Cling',
    icon: '🧲',
    effects: { magnet: { v1: 0.1, v10: 0.6 } },
    describe: (v) => `Magnet +${n1(v('magnet'))} while the meter is at least half full`,
  },
  {
    id: 'grounding',
    characterId: 'zap',
    name: 'Grounding',
    icon: '⏚',
    effects: { suction: { v1: 0.025, v10: 0.1 } },
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
  grade: number;
}

/** The Keepsakes tucked in for a Run (0–2; both slots may hold the same type). */
export type Loadout = readonly KeepsakeRef[];

/** Value of one effect for a single Keepsake. */
export function effectValue(type: KeepsakeType, key: string, grade: number): number {
  const e = type.effects[key];
  if (!e) return 0;
  if (e.steps) return e.steps[Math.min(MAX_GRADE, Math.max(1, Math.round(grade))) - 1] ?? 0;
  return gradeValue(grade, e.v1, e.v10);
}

/** Sum of an effect over every slot holding `typeId` (0 when none). Copies add together. */
export function loadoutValue(loadout: Loadout | undefined, typeId: KeepsakeTypeId, key: string): number {
  if (!loadout) return 0;
  const type = getKeepsakeType(typeId);
  if (!type) return 0;
  let sum = 0;
  for (const k of loadout) if (k.type === typeId) sum += effectValue(type, key, k.grade);
  return sum;
}

/** Description of a single Keepsake at its grade. */
export function describeKeepsake(ref: KeepsakeRef): string {
  const type = getKeepsakeType(ref.type);
  if (!type) return '';
  return type.describe((key) => effectValue(type, key, ref.grade));
}

/** "Thick Clog · Gutter Grit" */
export function keepsakeLabel(ref: KeepsakeRef): string {
  return `${getKeepsakeType(ref.type)?.name ?? ref.type} · ${getGrade(ref.grade).material}`;
}

/** Hoard key for a type and grade, e.g. "thick_clog:2". */
export function hoardKey(ref: KeepsakeRef): string {
  return `${ref.type}:${ref.grade}`;
}

export function parseHoardKey(key: string): KeepsakeRef | null {
  const [type, g] = key.split(':');
  const grade = Number(g);
  if (!type || !getKeepsakeType(type) || !Number.isInteger(grade) || grade < 1 || grade > MAX_GRADE) return null;
  return { type: type as KeepsakeTypeId, grade };
}

/** True if a Loadout is legal for a Character (≤ 2 slots, its own types, grades 1–10). */
export function isLoadoutFor(characterId: string, loadout: Loadout): boolean {
  return (
    loadout.length <= LOADOUT_SLOTS &&
    loadout.every((k) => getKeepsakeType(k.type)?.characterId === characterId && Number.isInteger(k.grade) && k.grade >= 1 && k.grade <= MAX_GRADE)
  );
}

// --- Floors (two stacked copies at any grade must leave the Ability playable) ---

/**
 * Limits applied after a Loadout's Keepsakes are added up (src/abilities/keepsakeParams.ts), so
 * two copies at any grade keep the Ability's numbers sane. Only these two bind; every other
 * effect stays reasonable at two grade-10 copies, and the stat effects are bounded by the caps.
 */
export const KEEPSAKE_FLOORS = {
  /**
   * Decoy cooldown is never shorter than the Decoy's duration, so it is on the floor at most half
   * the time. Binds for two Quick Sheds from grade 8 (−79%: 16 s → 3.4 s, raised to 4 s), and
   * for a Quick Shed beside a Long Strand only when both are grade 10 (8.8 s → 9 s).
   */
  decoyCooldownPerDuration: 1,
  /**
   * Hunker cooldown per second held never drops below 0.2 s. Binds for two Loose Roots from
   * grade 6 (two grade-10 copies save 1.2 s of the base 1.0 s), so a long hold always costs something.
   */
  hunkerPerSecondHeld: 0.2,
} as const;

// --- Felting ---

/** Keepsakes of one type and grade felted into one of the next grade. */
export const FELT_INPUT = 3;
/** Fluff to felt into `resultGrade`: 40 × g². */
export const feltCost = (resultGrade: number): number => 40 * resultGrade * resultGrade;
/** Fluff for shedding (discarding) one Keepsake of `grade`: 10 × g². */
export const shedValue = (grade: number): number => 10 * grade * grade;

/**
 * Highest grade Felting may produce for a Character: one above the best grade among the bosses
 * it has beaten, at most 10 (0 when it has beaten none).
 */
export function feltCeiling(bossesBeaten: readonly string[]): number {
  let best = 0;
  for (const id of bossesBeaten) best = Math.max(best, gradeForBoss(id) ?? 0);
  return best === 0 ? 0 : Math.min(MAX_GRADE, best + 1);
}

// --- Drops ---

export const DROP_RULES = {
  /** Keepsakes per boss kill (random type, seeded). */
  perKill: 1,
  /** Extra Keepsakes per boss kill on Hardcore. */
  hardcoreBonus: 1,
  /** Types offered on a Character's first kill of a boss (choose one instead of a random type). */
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
