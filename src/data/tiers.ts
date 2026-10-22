/**
 * Tiers (growth stages). Thresholds are the Bunny's **real** radius in cm (world radius × the
 * Area's unit, `bunny.realRadius`), so Tiers stay comparable across Areas; see docs/design.md.
 */
export interface TierDef {
  /** 1-based Tier number. */
  index: number;
  id: string;
  name: string;
  /** Real radius (cm) at which this Tier starts. */
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
  // Neighborhood (after the Robo-Vac 9000).
  { index: 6, id: 'dust_storm', name: 'Dust Storm', minRadius: 75, cameraScale: 20, growth: 1 },
  { index: 7, id: 'dust_cyclone', name: 'Dust Cyclone', minRadius: 160, cameraScale: 21, growth: 1 },
  // City (after the Street Sweeper).
  { index: 8, id: 'dust_hurricane', name: 'Dust Hurricane', minRadius: 320, cameraScale: 22, growth: 1 },
  { index: 9, id: 'dust_colossus', name: 'Dust Colossus', minRadius: 600, cameraScale: 23, growth: 1 },
  // Region (after the Garbage Truck; 1 world unit = 10 m, so these are 1 and 3 units).
  { index: 10, id: 'dust_sprawl', name: 'Dust Sprawl', minRadius: 1000, cameraScale: 24, growth: 1 },
  { index: 11, id: 'dust_front', name: 'Dust Front', minRadius: 3000, cameraScale: 25, growth: 1 },
  // Continent (after the Incinerator; 1 world unit = 10 km, so these are 1 and 3 units).
  { index: 12, id: 'dustmass', name: 'Dustmass', minRadius: 1e6, cameraScale: 26, growth: 1 },
  { index: 13, id: 'dust_pangaea', name: 'Dust Pangaea', minRadius: 3e6, cameraScale: 27, growth: 1 },
  // Globe (after the Ice Sheet; 1 world unit = 1,000 km, so these are 1 and 3 units).
  { index: 14, id: 'dust_moon', name: 'Dust Moon', minRadius: 1e8, cameraScale: 28, growth: 1 },
  { index: 15, id: 'dust_planet', name: 'Dust Planet', minRadius: 3e8, cameraScale: 29, growth: 1 },
  // Solar System (after the Orbital Sweeper; 1 world unit = 0.01 AU, so these are 1 and 3 units).
  { index: 16, id: 'dust_giant', name: 'Dust Giant', minRadius: 1.496e11, cameraScale: 30, growth: 1 },
  { index: 17, id: 'dust_star', name: 'Dust Star', minRadius: 4.488e11, cameraScale: 31, growth: 1 },
  // Galaxy (after the Sun; 1 world unit = 100 ly, so these are 1 and 3 units: 100 ly and 300 ly).
  { index: 18, id: 'dust_nebula', name: 'Dust Nebula', minRadius: 9.461e19, cameraScale: 32, growth: 1 },
  { index: 19, id: 'dust_cluster', name: 'Dust Cluster', minRadius: 2.8383e20, cameraScale: 33, growth: 1 },
];

export const MAX_TIER = TIERS.length;

export function getTier(index: number): TierDef {
  return TIERS[Math.min(Math.max(index, 1), MAX_TIER) - 1]!;
}

/** Tier for a real radius (cm). Radii below the first threshold count as Tier 1. */
export function tierForRadius(radius: number): TierDef {
  let t = TIERS[0]!;
  for (const tier of TIERS) if (radius >= tier.minRadius) t = tier;
  return t;
}

/** 0..1 progress (real radius, cm) from the current Tier's threshold to the next (1 at the last Tier). */
export function tierProgress(radius: number): number {
  const t = tierForRadius(radius);
  if (t.index >= MAX_TIER) return 1;
  const next = TIERS[t.index]!;
  const p = (radius - t.minRadius) / (next.minRadius - t.minRadius);
  return Math.min(1, Math.max(0, p));
}
