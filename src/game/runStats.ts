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
  /** Radius on entering the Area, in the Area's unit (`AREAS[area].unit` cm; 1 up to the City), after any arrival leap. */
  radiusIn: number;
  /** Largest radius reached by the time the Run left the Area, in the Area's unit. */
  maxRadius: number;
  /** Debris absorbed in the Area. */
  debrisAbsorbed: number;
  /** The Area's boss was absorbed (in the last Area: the Run was won). */
  cleared: boolean;
  /** Keepsakes tucked in when the Run left the Area (it can grow mid-Run; missing in Runs saved before). */
  loadout?: KeepsakeRef[];
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
  /** True once the Incinerator was absorbed (the motorway west to the continent opened). */
  regionCleared?: boolean;
  /** True once the Ice Sheet was absorbed (the launch corridor up to orbit opened). */
  continentCleared?: boolean;
  /** True once the Orbital Sweeper was absorbed (the escape trajectory over the North Pole opened). */
  globeCleared?: boolean;
  /** True once the Sun was absorbed (the heliopause gate to the galaxy opened). */
  solarSystemCleared?: boolean;
  /** True once Sagittarius A* was absorbed (the intergalactic gate out of the halo opened). */
  galaxyCleared?: boolean;
  /** True once the Expansion collapsed (the Run was won). */
  universeCleared?: boolean;
  /** Every Area played, in order; the last is the one the Run ended in. Missing on older payloads. */
  areas?: AreaStats[];
  /** Keepsakes tucked in for the Run (0–2). Missing on older payloads. */
  loadout?: KeepsakeRef[];
}
