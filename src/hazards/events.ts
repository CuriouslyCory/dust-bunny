/** Hazard-related events, added to GameEvents by augmentation (see src/core/events.ts). */
export {};

declare module '../core/events' {
  interface GameEvents {
    /** A Hazard small enough was absorbed (emitted before hazardRemoved). */
    hazardAbsorbed: { hazardId: number; defId: string; size: number; radius: number; boss: boolean };
    /** A Hazard started telegraphing an attack (floor decal shown). */
    hazardTelegraph: { hazardId: number; defId: string; attack: string; duration: number };
    /** The Bunny lost volume to a Hazard; `pieces` Debris were scattered on the floor. */
    bunnyShed: { volume: number; pieces: number; source: string; radius: number };
    /** An area boss arrived. `absorbRadius` = Bunny radius needed to absorb it. */
    bossSpawned: { hazardId: number; absorbRadius: number; name: string };
    /** The boss crashed into a wall and can be rammed. */
    bossStunned: { hazardId: number };
    /** The Bunny rammed the stunned boss and chipped it smaller. */
    bossHit: { hazardId: number; size: number; absorbRadius: number };
    /** An area boss was absorbed (`defId` says which; the house boss opens the front door). */
    bossDefeated: { hazardId: number; defId: string; timeSec: number };
    /** The Run is won (emitted right before runEnded with reason 'victory'). */
    victory: { timeSec: number; radius: number };
  }
}
