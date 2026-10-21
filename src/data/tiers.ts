/** Tiers (growth stages). Thresholds are Bunny radius in cm; see docs/design.md. */
export interface TierDef {
  /** 1-based Tier number. */
  index: number;
  id: string;
  name: string;
  /** Radius (cm) at which this Tier starts. */
  minRadius: number;
  /** Camera distance = radius × cameraScale (smoothed). Rising per Tier = extra pull-back on Tier-up. */
  cameraScale: number;
  /** Multiplies TUNING.growthFactor while in this Tier (pacing knob per Tier; 1 = neutral). */
  growth: number;
}

export const TIERS: readonly TierDef[] = [
  { index: 1, id: 'speck', name: 'Speck', minRadius: 1, cameraScale: 13, growth: 0.75 },
  { index: 2, id: 'fluff', name: 'Fluff', minRadius: 3, cameraScale: 14.5, growth: 0.85 },
  { index: 3, id: 'tumbleweed', name: 'Tumbleweed', minRadius: 8, cameraScale: 16, growth: 0.85 },
  { index: 4, id: 'dust_devil', name: 'Dust Devil', minRadius: 20, cameraScale: 17.5, growth: 1 },
  { index: 5, id: 'dust_titan', name: 'Dust Titan', minRadius: 45, cameraScale: 19, growth: 1 },
];

export const MAX_TIER = TIERS.length;

export function getTier(index: number): TierDef {
  return TIERS[Math.min(Math.max(index, 1), MAX_TIER) - 1]!;
}

/** Tier for a radius. Radii below the first threshold count as Tier 1. */
export function tierForRadius(radius: number): TierDef {
  let t = TIERS[0]!;
  for (const tier of TIERS) if (radius >= tier.minRadius) t = tier;
  return t;
}

/** 0..1 progress from the current Tier's threshold to the next (1 at the last Tier). */
export function tierProgress(radius: number): number {
  const t = tierForRadius(radius);
  if (t.index >= MAX_TIER) return 1;
  const next = TIERS[t.index]!;
  const p = (radius - t.minRadius) / (next.minRadius - t.minRadius);
  return Math.min(1, Math.max(0, p));
}
