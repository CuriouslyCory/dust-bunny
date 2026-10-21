/**
 * Bunny stats = base values + an ordered list of modifiers.
 *
 * Evaluation per stat: start at the base value, then apply modifiers sorted by
 * (priority, insertion order). `add` adds, `mul` multiplies. Default priorities
 * (add = 100, mul = 200) give the familiar (base + Σadd) × Πmul.
 *
 * Characters set base values; Upgrades, Perks and Pickups add modifiers tagged with a
 * `source` so they can be removed as a group. Timed modifiers expire via tick(dt).
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
};

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

export function computeStats(base: Readonly<BunnyStatValues>, modifiers: readonly StatModifier[]): BunnyStatValues {
  const out: BunnyStatValues = { ...base };
  const sorted = modifiers
    .map((m, seq) => ({ m, seq }))
    .sort((a, b) => priorityOf(a.m) - priorityOf(b.m) || a.seq - b.seq);
  for (const { m } of sorted) {
    out[m.stat] = m.op === 'add' ? out[m.stat] + m.value : out[m.stat] * m.value;
  }
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
  /** Called whenever the computed values change. */
  onChange: ((values: Readonly<BunnyStatValues>) => void) | null = null;

  constructor(private base: BunnyStatValues) {}

  /** Computed values (cached until modifiers change). */
  get values(): Readonly<BunnyStatValues> {
    if (!this.cache) this.cache = computeStats(this.base, this.mods);
    return this.cache;
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
