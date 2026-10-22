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
    /**
     * The boss is stunned and can be rammed: it crashed into a wall (`cause` 'wall'), Sagittarius A*
     * swallowed star clusters too fast ('indigestion'), or an Ability stunned it ('decoy' clog,
     * 'hunker' crash into a planted Tumble, 'discharge').
     */
    bossStunned: { hazardId: number; cause?: 'wall' | 'indigestion' | 'decoy' | 'hunker' | 'discharge' };
    /**
     * Sagittarius A* swallowed a star cluster (Debris `typeId`): its `fullness` (meals of the last
     * few seconds) out of the `threshold` that stuns it.
     */
    bossSwallowed: { hazardId: number; typeId: string; fullness: number; threshold: number };
    /** The Bunny rammed the stunned boss and chipped it smaller. */
    bossHit: { hazardId: number; size: number; absorbRadius: number };
    /** An area boss was absorbed (`defId` says which; the house boss opens the front door). */
    bossDefeated: { hazardId: number; defId: string; timeSec: number };
    /** The Run is won (emitted right before runEnded with reason 'victory'). */
    victory: { timeSec: number; radius: number };
  }
}
