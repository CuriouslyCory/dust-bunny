/** Ability events, added to GameEvents by augmentation (see src/core/events.ts). */
import type { AbilityId } from '../data/abilities';

export {};

/** Why an Ability ended: the Decoy expired, was touched (clog) or shot, or the Area changed; a Hunker was released or hit its max hold. */
export type AbilityEndReason = 'expired' | 'clogged' | 'shot' | 'area' | 'released' | 'maxHold';

declare module '../core/events' {
  interface GameEvents {
    /** An Ability fired: Decoy shed, Hunker planted, Discharge zapped. (x, z) is the Bunny. */
    abilityUsed: { ability: AbilityId; x: number; z: number };
    /**
     * A Decoy or Hunker ended. (x, z) is where (the Decoy's last position, or the Bunny);
     * `heldFor` is the Hunker hold time; `cooldown` the cooldown that just started.
     */
    abilityEnded: { ability: AbilityId; reason: AbilityEndReason; x: number; z: number; heldFor: number; cooldown: number };
    /** A Hazard touched the Decoy and clogged (stunned for `seconds`; 0 when a boss was within the 6 s limit). */
    hazardClogged: { hazardId: number; defId: string; boss: boolean; seconds: number };
    /** A Hazard ran into a planted Tumble. `stunned`: a boss crashed and was stunned. */
    hazardHitPlanted: { hazardId: number; defId: string; boss: boolean; stunned: boolean };
    /** Discharge shorted out a Hazard: destroyed (non-boss) or stunned and Grounded (boss). */
    hazardShorted: { hazardId: number; defId: string; boss: boolean; x: number; z: number; fromX: number; fromZ: number };
    /** Zap's Static meter just filled up. */
    staticFull: { x: number; z: number };
  }
}
