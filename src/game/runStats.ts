/** Results of a Run, passed with runEnded and shown on the results screen. */
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
}
