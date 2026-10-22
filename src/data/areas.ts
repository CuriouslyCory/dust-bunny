/**
 * Per-area tuning: which Tiers of Debris each area spawns, how densely it starts and the
 * Area's **unit** (docs/story.md, "Scale without breaking floats"). World coordinates, radii and
 * every size or distance in an Area's content are in its unit; the Run re-bases the Bunny on
 * entry so it arrives at ~1 unit and the House's Speck→Fluff curve repeats at each scale.
 */
import type { AreaId } from '../world/types';
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
}

export const AREAS: Record<AreaId, AreaTuning> = {
  house: { name: 'The House', tiers: [1, 5], initialScatter: 1400, startCluster: 260, startClusterRadius: 45, growth: 1, unit: 1, readout: 'cm', fluffPerUnit: 1 / 30 },
  neighborhood: { name: 'The Neighborhood', tiers: [5, 7], initialScatter: 1500, startCluster: 120, startClusterRadius: 700, growth: 0.24, unit: 1, readout: 'cm', fluffPerUnit: 1 / 60 },
  city: { name: 'The City', tiers: [7, 9], initialScatter: 1800, startCluster: 110, startClusterRadius: 2600, growth: 0.11, unit: 1, readout: 'cm', fluffPerUnit: 1 / 120 },
  // 1 world unit = 10 m: the Bunny arrives at ~0.85 units, Tier 10 starts at 1 and Tier 11 at 3.
  region: { name: 'The Region', tiers: [10, 11], initialScatter: 2200, startCluster: 160, startClusterRadius: 10, growth: 0.5, unit: 1000, readout: 'm', fluffPerUnit: 1.5 },
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
