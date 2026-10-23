/** Ability events, added to GameEvents by augmentation (see src/core/events.ts). */
import type { AbilityId } from '../data/abilities';

export {};

/** Why an Ability ended: the Decoy expired, was touched (clog) or shot, or the Area changed; an Amass was released or hit its max hold. */
export type AbilityEndReason = 'expired' | 'clogged' | 'shot' | 'area' | 'released' | 'maxHold';

declare module '../core/events' {
  interface GameEvents {
    /** An Ability fired: Decoy shed, Amass started, Discharge zapped. (x, z) is the Bunny. */
    abilityUsed: { ability: AbilityId; x: number; z: number };
    /**
     * A Decoy or Amass ended. (x, z) is where (the Decoy's last position, or the Bunny);
     * `heldFor` is the Amass channel time; `cooldown` the cooldown that just started.
     */
    abilityEnded: { ability: AbilityId; reason: AbilityEndReason; x: number; z: number; heldFor: number; cooldown: number };
    /** A Hazard touched the Decoy and clogged (stunned for `seconds`; 0 when a boss was within the 6 s limit). */
    hazardClogged: { hazardId: number; defId: string; boss: boolean; seconds: number };
    /** Amass swallowed a Hazard that touched Tumble (after hazardAbsorbed); `stunned` Hazards caught in its shockwave. */
    hazardSwallowed: { hazardId: number; defId: string; x: number; z: number; stunned: number };
    /** A charging boss crashed into an Amassing Tumble and was stunned (the chip lands at once). */
    bossCrashedIntoAmass: { hazardId: number };
    /** Collapse: the field imploded at (x, z), reaching `radius` world units; `hit` Hazards stunned. */
    amassCollapsed: { x: number; z: number; radius: number; hit: number };
    /** Discharge shorted out a Hazard: destroyed (non-boss) or stunned and Grounded (boss). */
    hazardShorted: { hazardId: number; defId: string; boss: boolean; x: number; z: number; fromX: number; fromZ: number };
    /** Zap's Static meter just filled up. */
    staticFull: { x: number; z: number };
  }
}
