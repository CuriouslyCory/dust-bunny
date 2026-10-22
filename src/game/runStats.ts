/** Results of a Run, passed with runEnded and shown on the results screen. */
import type { KeepsakeRef } from '../data/keepsakes';
import type { DifficultyId } from '../shared/difficulty';
import type { AreaId } from '../world/types';
export type RunEndReason = 'died' | 'victory' | 'quit';

/** One Area of a Run: from entering it to leaving it (or the Run ending there). */
export interface AreaStats {
  area: AreaId;
  /** Run second the Area was entered. */
  startSec: number;
  /** Simulated seconds spent in the Area. */
  timeSec: number;
  /** Radius on entering the Area, in the Area's unit (`AREAS[area].unit` cm; 1 up to the City). */
  radiusIn: number;
  /** Largest radius reached by the time the Run left the Area, in the Area's unit. */
  maxRadius: number;
  /** Debris absorbed in the Area. */
  debrisAbsorbed: number;
  /** The Area's boss was absorbed (in the last Area: the Run was won). */
  cleared: boolean;
}

export interface RunStats {
  seed: string;
  characterId: string;
  /** Difficulty the Run was played on (missing: casual). */
  difficulty?: DifficultyId;
  /** Simulated seconds (pauses excluded). */
  timeSec: number;
  /** Largest real radius (cm) of the Run. */
  maxRadius: number;
  /** Real radius (cm) at the end. */
  finalRadius: number;
  debrisAbsorbed: number;
  hazardsAbsorbed: number;
  tierReached: number;
  /** Seconds at which each Tier was first reached (index = Tier number). */
  tierTimes: Record<number, number>;
  perks: string[];
  /** Area the Run ended in. */
  area: AreaId;
  /** True once the Robo-Vac 9000 was absorbed (the front door opened). */
  houseCleared: boolean;
  /** True once the Street Sweeper was absorbed (the road to the city opened). */
  neighborhoodCleared?: boolean;
  /** True once the Garbage Truck was absorbed (the highway on-ramp to the region opened). */
  cityCleared?: boolean;
  /** True once the Incinerator was absorbed. */
  regionCleared?: boolean;
  /** Every Area played, in order; the last is the one the Run ended in. Missing on older payloads. */
  areas?: AreaStats[];
  /** Keepsakes tucked in for the Run (0–2). Missing on older payloads. */
  loadout?: KeepsakeRef[];
}
