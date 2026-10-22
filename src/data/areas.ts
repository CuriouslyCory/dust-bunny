/**
 * Per-area tuning: which Tiers of Debris each area spawns, how densely it starts and the
 * Area's **unit** (docs/story.md, "Scale without breaking floats"). World coordinates, radii and
 * every size or distance in an Area's content are in its unit; the Run re-bases the Bunny on
 * entry so it arrives at ~1 unit and the House's Speck→Fluff curve repeats at each scale.
 */
import { nextArea, type AreaId } from '../world/types';
import type { LengthUnitId } from './units';

export interface AreaTuning {
  name: string;
  /** Debris Tier band the spawner uses here; the Bunny's Tier is clamped into it. */
  tiers: readonly [number, number];
  /** Debris scattered at area start (beyond the start cluster) and in the start cluster. */
  initialScatter: number;
  startCluster: number;
  /** Start cluster radius (cm). */
  startClusterRadius: number;
  /** Multiplies growth from everything absorbed here (pacing knob per area; 1 = neutral). */
  growth: number;
  /** Centimetres per world unit while the Run is in this Area (1 up to the City). */
  unit: number;
  /** Smallest rung of the HUD radius readout here (the ladder steps up from it, see units.ts). */
  readout: LengthUnitId;
  /**
   * Fluff per unit of growth in this Area, in its own units (meta/fluff.ts): each Act scales its
   * own share of the radius term instead of a cap on the Run's radius.
   */
  fluffPerUnit: number;
  /**
   * Smallest radius (in this Area's unit) the Bunny arrives at. Entering the Area re-bases the
   * Bunny (same real size) and then, if it is smaller, scales it up to this radius: the off-screen
   * growth the chapter card covers (docs/design.md, "The size leap"). It is not growth earned in
   * either Area: Area stats, Fluff and scores count from the radius after the leap. Missing: no leap.
   */
  arrivalRadius?: number;
}

export const AREAS: Record<AreaId, AreaTuning> = {
  house: { name: 'The House', tiers: [1, 5], initialScatter: 1400, startCluster: 260, startClusterRadius: 45, growth: 1, unit: 1, readout: 'cm', fluffPerUnit: 1 / 30 },
  neighborhood: { name: 'The Neighborhood', tiers: [5, 7], initialScatter: 1500, startCluster: 120, startClusterRadius: 700, growth: 0.24, unit: 1, readout: 'cm', fluffPerUnit: 1 / 60 },
  city: { name: 'The City', tiers: [7, 9], initialScatter: 1800, startCluster: 110, startClusterRadius: 2600, growth: 0.11, unit: 1, readout: 'cm', fluffPerUnit: 1 / 120 },
  // 1 world unit = 10 m: the Bunny arrives at ~0.85 units, Tier 10 starts at 1 and Tier 11 at 3.
  region: { name: 'The Region', tiers: [10, 11], initialScatter: 2000, startCluster: 120, startClusterRadius: 11, growth: 0.12, unit: 1000, readout: 'm', fluffPerUnit: 1.5 },
  // 1 world unit = 10 km. The Region ends at ≈40 m, a real-size re-base would arrive at ≈0.004
  // units, so the Bunny leaps to 0.85 units (8.5 km): Tier 12 starts at 1 and Tier 13 at 3.
  continent: {
    name: 'The Continent',
    tiers: [12, 13],
    initialScatter: 2000,
    startCluster: 120,
    startClusterRadius: 11,
    growth: 0.19,
    unit: 1e6,
    readout: 'km',
    fluffPerUnit: 1.5,
    arrivalRadius: 0.85,
  },
  // 1 world unit = 1,000 km. The Continent ends at ≈45 km (0.045 units), so the Bunny leaps again,
  // to 0.85 units (850 km, 0.13 Earths): Tier 14 starts at 1 and Tier 15 at 3. The readout is in
  // Earth radii (6,371 km). The map wraps east–west (`layout.wrapX`).
  globe: {
    name: 'The Globe',
    tiers: [14, 15],
    initialScatter: 2400,
    startCluster: 120,
    startClusterRadius: 11,
    growth: 0.2,
    unit: 1e8,
    readout: 'Earths',
    fluffPerUnit: 1.5,
    arrivalRadius: 0.85,
  },
  // 1 world unit = 0.01 AU (1.496 million km). The Globe ends at ≈4,000–6,000 km (≈0.004 units),
  // so the Bunny leaps a third time, to 0.85 units (0.0085 AU, already wider than the Sun's real
  // radius of 0.47 units: the planets and the Sun are drawn at play size, not to scale): Tier 16
  // starts at 1 and Tier 17 at 3. The readout is in AU. The ecliptic is a flat disc round the Sun.
  solar_system: {
    name: 'The Solar System',
    tiers: [16, 17],
    initialScatter: 2400,
    startCluster: 120,
    startClusterRadius: 11,
    growth: 0.2,
    unit: 1.496e11,
    readout: 'AU',
    fluffPerUnit: 1.5,
    arrivalRadius: 0.85,
  },
  // 1 world unit = 100 light-years (9.461e19 cm, 100 × the `ly` rung in units.ts). The Solar System
  // ends at ≈0.03–0.05 AU (≈5e-7 ly, ≈5e-9 units), so the Bunny leaps a fourth time, to 0.85 units
  // (85 ly; stars, clusters and nebulae are drawn at play size, not to scale): Tier 18 starts at 1
  // and Tier 19 at 3. The readout is in light-years. The galactic disc is flat, round Sagittarius A*.
  // Growth tuned so the Act takes 4–6 minutes (docs/design.md, Galaxy pacing check).
  galaxy: {
    name: 'The Galaxy',
    tiers: [18, 19],
    initialScatter: 2400,
    startCluster: 120,
    startClusterRadius: 11,
    growth: 0.21,
    unit: 9.461e19,
    readout: 'ly',
    fluffPerUnit: 1.5,
    arrivalRadius: 0.85,
  },
};

/** Centimetres per world unit in `area`. */
export function areaUnit(area: AreaId): number {
  return AREAS[area].unit;
}

/** The Tier the spawner uses for a Bunny Tier in an area. */
export function areaDebrisTier(area: AreaId, tier: number): number {
  const [lo, hi] = AREAS[area].tiers;
  return Math.min(hi, Math.max(lo, tier));
}

/**
 * True if a real radius (cm) lies beyond the next Area's arrival leap: the Bunny only gets there
 * after leaping on arrival, so it is no goal in `area` (the Region's HUD shows no Tier 12 goal).
 */
export function pastNextArrival(area: AreaId, cm: number): boolean {
  const next = nextArea(area);
  const arrival = next ? AREAS[next].arrivalRadius : undefined;
  return arrival !== undefined && cm > arrival * AREAS[next!].unit;
}
