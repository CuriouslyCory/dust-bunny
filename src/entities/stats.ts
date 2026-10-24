/**
 * Bunny stats = base values + an ordered list of modifiers.
 *
 * Evaluation per stat: start at the base value, then apply modifiers sorted by
 * (priority, insertion order). `add` adds, `mul` multiplies. Default priorities
 * (add = 100, mul = 200) give the familiar (base + Σadd) × Πmul.
 *
 * Characters set base values; Upgrades, Perks and Pickups add modifiers tagged with a
 * `source` so they can be removed as a group. Timed modifiers expire via tick(dt).
 *
 * Optional per-stat caps (a Character's `caps`) form a stage at `capPriority` (CAP_PRIORITY,
 * 250): modifiers below it (base + Shop + Keepsakes + Perks) are clamped to the cap, modifiers at
 * or above it (TIMED_PRIORITY: Pickups, Hazard slows, Ability-state effects) apply on top. The
 * global STAT_LIMITS clamp comes last. `setCapBonus` raises a `max` cap at runtime (Lint's
 * Well-Rounded) without granting the stat; `cap` and `atCap` read the raised cap.
 */

export interface BunnyStatValues {
  /** Max speed multiplier. */
  speed: number;
  /** Acceleration multiplier. */
  acceleration: number;
  /** Whole hearts. */
  maxHealth: number;
  /** Largest absorbable Debris size as a fraction of radius. */
  absorbRatio: number;
  /** Multiplies growth from absorbing. */
  growthMultiplier: number;
  /** Magnet range beyond the Bunny surface, in Bunny radii (0 = none). */
  magnetRadius: number;
  /** Seconds between dashes. */
  dashCooldown: number;
  /** Dash speed as a multiple of max speed. */
  dashSpeed: number;
  /** Multiplies suction forces from Hazards (Zap = 1.5). */
  suctionMultiplier: number;
  /** 0..1 fraction of knockback ignored. */
  knockbackResistance: number;
  /** Starting radius in cm (read once at Run start). */
  startRadius: number;
  /** Multiplies Pickup effect durations (Hoarder Perk). */
  pickupDuration: number;
  /** Multiplies the floor Pickup spawn rate (Lucky Find Perk, Pickup Luck Upgrade). */
  pickupLuck: number;
  /** 0..1 chance to dodge a hit entirely (Slippery Perk). */
  dodgeChance: number;
  /** Perk options offered per draft (Wide Choice Upgrade: 4). */
  perkChoices: number;
  /** Perk draft rerolls available per Run (Reroll Upgrade). */
  perkRerolls: number;
}

export type StatKey = keyof BunnyStatValues;

export const BASE_BUNNY_STATS: Readonly<BunnyStatValues> = Object.freeze({
  speed: 1,
  acceleration: 1,
  maxHealth: 3,
  absorbRatio: 0.7,
  growthMultiplier: 1,
  magnetRadius: 0,
  dashCooldown: 3,
  dashSpeed: 2.6,
  suctionMultiplier: 1,
  knockbackResistance: 0,
  startRadius: 1,
  pickupDuration: 1,
  pickupLuck: 1,
  dodgeChance: 0,
  perkChoices: 3,
  perkRerolls: 0,
});

/** Clamp ranges applied after modifiers. */
export const STAT_LIMITS: Partial<Record<StatKey, [number, number]>> = {
  speed: [0.1, 10],
  acceleration: [0.1, 10],
  maxHealth: [1, 99],
  absorbRatio: [0.05, 0.95],
  growthMultiplier: [0, 100],
  magnetRadius: [0, 20],
  dashCooldown: [0.2, 60],
  dashSpeed: [1, 10],
  suctionMultiplier: [0, 10],
  knockbackResistance: [0, 1],
  startRadius: [0.2, 100],
  pickupDuration: [0.1, 10],
  pickupLuck: [0, 20],
  dodgeChance: [0, 0.75],
  perkChoices: [1, 6],
  perkRerolls: [0, 9],
};

/** A per-stat cap: `max` for stats where more is better, `min` (a floor) for the others. */
export interface StatCapRange {
  max?: number;
  min?: number;
}

export type StatCaps = Partial<Record<StatKey, StatCapRange>>;

/** Default priority of the cap stage (matches CAP_PRIORITY in src/data/characters.ts). */
export const DEFAULT_CAP_PRIORITY = 250;
/** Priority for timed and Ability-state effects (Pickups, Hazard slows, Amass): after the cap stage. */
export const TIMED_PRIORITY = 300;

export interface StatModifier {
  stat: StatKey;
  op: 'add' | 'mul';
  value: number;
  /** Who added it, e.g. 'perk:aerodynamic', 'pickup:sugar_rush', 'upgrade:fast_feet'. */
  source: string;
  /** Lower runs first. Defaults: add = 100, mul = 200. */
  priority?: number;
  /** Seconds until it expires (requires tick()). Omit for permanent. */
  duration?: number;
}

interface ActiveModifier extends StatModifier {
  handle: number;
  seq: number;
  remaining: number;
}

export interface StatOptions {
  /** Per-stat caps applied at `capPriority` (see file header). */
  caps?: StatCaps;
  /** Modifiers below this priority are capped, the rest apply after the cap. Default 250. */
  capPriority?: number;
}

function clampCap(value: number, cap: StatCapRange | undefined): number {
  if (!cap) return value;
  if (cap.max !== undefined && value > cap.max) value = cap.max;
  if (cap.min !== undefined && value < cap.min) value = cap.min;
  return value;
}

function applyCaps(out: BunnyStatValues, caps: StatCaps): void {
  for (const key of Object.keys(caps) as StatKey[]) out[key] = clampCap(out[key], caps[key]);
}

function sortModifiers(modifiers: readonly StatModifier[]): StatModifier[] {
  return modifiers
    .map((m, seq) => ({ m, seq }))
    .sort((a, b) => priorityOf(a.m) - priorityOf(b.m) || a.seq - b.seq)
    .map((e) => e.m);
}

/** Values after base + every modifier below the cap stage, before the cap clamp. */
function preCapValues(base: Readonly<BunnyStatValues>, sorted: readonly StatModifier[], capPriority: number): BunnyStatValues {
  const out: BunnyStatValues = { ...base };
  for (const m of sorted) {
    if (priorityOf(m) >= capPriority) break;
    out[m.stat] = m.op === 'add' ? out[m.stat] + m.value : out[m.stat] * m.value;
  }
  return out;
}

export function computeStats(base: Readonly<BunnyStatValues>, modifiers: readonly StatModifier[], options: StatOptions = {}): BunnyStatValues {
  const out: BunnyStatValues = { ...base };
  const caps = options.caps;
  const capPriority = options.capPriority ?? DEFAULT_CAP_PRIORITY;
  let capped = !caps;
  for (const m of sortModifiers(modifiers)) {
    if (!capped && priorityOf(m) >= capPriority) {
      applyCaps(out, caps!);
      capped = true;
    }
    out[m.stat] = m.op === 'add' ? out[m.stat] + m.value : out[m.stat] * m.value;
  }
  if (!capped) applyCaps(out, caps!);
  for (const key of Object.keys(STAT_LIMITS) as StatKey[]) {
    const lim = STAT_LIMITS[key]!;
    out[key] = Math.min(lim[1], Math.max(lim[0], out[key]));
  }
  return out;
}

const priorityOf = (m: StatModifier): number => m.priority ?? (m.op === 'add' ? 100 : 200);

export class StatBlock {
  private mods: ActiveModifier[] = [];
  private nextHandle = 1;
  private cache: BunnyStatValues | null = null;
  /** Added to each stat's `max` cap (setCapBonus). */
  private readonly capBonus: Partial<Record<StatKey, number>> = {};
  /** options.caps with capBonus applied (rebuilt when a bonus changes). */
  private caps: StatCaps | undefined;
  /** Called whenever the computed values change. */
  onChange: ((values: Readonly<BunnyStatValues>) => void) | null = null;

  constructor(
    private base: BunnyStatValues,
    private readonly options: StatOptions = {},
  ) {
    this.caps = options.caps;
  }

  /** Computed values (cached until modifiers change). */
  get values(): Readonly<BunnyStatValues> {
    if (!this.cache) this.cache = computeStats(this.base, this.mods, { ...this.options, caps: this.caps });
    return this.cache;
  }

  /** The cap on a stat, if any (a `max` cap includes its setCapBonus). */
  cap(key: StatKey): Readonly<StatCapRange> | undefined {
    return this.caps?.[key];
  }

  /**
   * Raises the stat's `max` cap by `bonus` (replacing any earlier bonus; 0 removes it). It grants
   * nothing by itself: only modifiers already past the old cap get through. No effect on floors
   * or on stats without a `max` cap.
   */
  setCapBonus(key: StatKey, bonus: number): void {
    if ((this.capBonus[key] ?? 0) === bonus) return;
    this.capBonus[key] = bonus;
    const caps: StatCaps = { ...this.options.caps };
    for (const k of Object.keys(this.capBonus) as StatKey[]) {
      const c = caps[k];
      if (c?.max !== undefined) caps[k] = { ...c, max: c.max + (this.capBonus[k] ?? 0) };
    }
    this.caps = this.options.caps ? caps : undefined;
    this.invalidate();
  }

  /**
   * True if the stat has a cap and base + modifiers below the cap stage already reach it (a
   * `max` cap: at or above; a `min` floor: at or below). Timed effects don't count.
   */
  atCap(key: StatKey): boolean {
    const cap = this.caps?.[key];
    if (!cap) return false;
    const v = preCapValues(this.base, sortModifiers(this.mods), this.options.capPriority ?? DEFAULT_CAP_PRIORITY)[key];
    const eps = 1e-9;
    return (cap.max !== undefined && v >= cap.max - eps) || (cap.min !== undefined && v <= cap.min + eps);
  }

  get<K extends StatKey>(key: K): number {
    return this.values[key];
  }

  setBase(base: Partial<BunnyStatValues>): void {
    this.base = { ...this.base, ...base };
    this.invalidate();
  }

  /** Returns a handle for remove(). */
  add(mod: StatModifier): number {
    const handle = this.nextHandle++;
    this.mods.push({ ...mod, handle, seq: handle, remaining: mod.duration ?? Infinity });
    this.invalidate();
    return handle;
  }

  remove(handle: number): boolean {
    const i = this.mods.findIndex((m) => m.handle === handle);
    if (i < 0) return false;
    this.mods.splice(i, 1);
    this.invalidate();
    return true;
  }

  removeSource(source: string): number {
    const before = this.mods.length;
    this.mods = this.mods.filter((m) => m.source !== source);
    const n = before - this.mods.length;
    if (n) this.invalidate();
    return n;
  }

  modifiers(): readonly StatModifier[] {
    return this.mods;
  }

  /** Advances timed modifiers and drops expired ones. */
  tick(dt: number): void {
    let expired = false;
    for (const m of this.mods) {
      if (m.remaining !== Infinity) {
        m.remaining -= dt;
        if (m.remaining <= 0) expired = true;
      }
    }
    if (expired) {
      this.mods = this.mods.filter((m) => m.remaining > 0);
      this.invalidate();
    }
  }

  private invalidate(): void {
    this.cache = null;
    this.onChange?.(this.values);
  }
}
