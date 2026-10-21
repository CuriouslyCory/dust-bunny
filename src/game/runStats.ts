/** Results of a Run, passed with runEnded and shown on the results screen. */
import type { AreaId } from '../world/types';
export type RunEndReason = 'died' | 'victory' | 'quit';

export interface RunStats {
  seed: string;
  characterId: string;
  /** Simulated seconds (pauses excluded). */
  timeSec: number;
  maxRadius: number;
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
}
