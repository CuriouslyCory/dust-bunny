/** Per-area tuning: which Tiers of Debris each area spawns and how densely it starts. */
import type { AreaId } from '../world/types';

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
}

export const AREAS: Record<AreaId, AreaTuning> = {
  house: { name: 'The House', tiers: [1, 5], initialScatter: 1400, startCluster: 260, startClusterRadius: 45, growth: 1 },
  neighborhood: { name: 'The Neighborhood', tiers: [5, 7], initialScatter: 1500, startCluster: 120, startClusterRadius: 700, growth: 0.24 },
};

/** The Tier the spawner uses for a Bunny Tier in an area. */
export function areaDebrisTier(area: AreaId, tier: number): number {
  const [lo, hi] = AREAS[area].tiers;
  return Math.min(hi, Math.max(lo, tier));
}
