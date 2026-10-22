/**
 * Character Abilities (unlocked from the first Run): Lint's Decoy, Tumble's Hunker, Zap's
 * Discharge. Tunable numbers only; the behaviour lives in src/abilities/. Ranges and sizes
 * are in Bunny radii (r), so each Ability plays the same at every Tier.
 */

export type AbilityId = 'decoy' | 'hunker' | 'discharge';

export interface AbilityData {
  id: AbilityId;
  name: string;
  icon: string;
  /** One-line description for Character select and How to Play. */
  description: string;
  /** How the input works: tap fires once, hold keeps it active. */
  trigger: 'tap' | 'hold';
}

export const ABILITIES: Record<AbilityId, AbilityData> = {
  decoy: {
    id: 'decoy',
    name: 'Decoy',
    icon: '🧶',
    description: 'Shed a lint ball. Hazards aim at it, and anything that touches it clogs.',
    trigger: 'tap',
  },
  hunker: {
    id: 'hunker',
    name: 'Hunker',
    icon: '🪨',
    description: 'Hold to plant. Nothing moves or hurts you, and bosses crash into you.',
    trigger: 'hold',
  },
  discharge: {
    id: 'discharge',
    name: 'Discharge',
    icon: '⚡',
    description: 'Roll fast to build static, then short out the nearest Hazard.',
    trigger: 'tap',
  },
};

export function getAbility(id: AbilityId): AbilityData {
  return ABILITIES[id];
}

/** Rules shared by every Ability. */
export const ABILITY_RULES = {
  /** A boss can be stunned by an Ability at most once per this many seconds. */
  bossStunInterval: 6,
} as const;

export const DECOY = {
  /** Lint ball radius, in Bunny radii. */
  radius: 0.8,
  /** Seconds the Decoy stays on the floor. */
  duration: 4,
  /** Seconds of cooldown, starting when the Decoy ends (pops or expires). */
  cooldown: 16,
  /** Seconds a non-ranged Hazard (or boss) is stunned when it touches the Decoy. */
  clogStun: 1.5,
} as const;

export const HUNKER = {
  /** Longest hold, in seconds. */
  maxHold: 10,
  /** Cooldown after release: base + perSecondHeld × seconds held. */
  cooldownBase: 4,
  cooldownPerSecondHeld: 1,
} as const;

export const DISCHARGE = {
  /** Bunny radii rolled (above minSpeedFraction of max speed) to fill the Static meter. */
  fillDistance: 40,
  /** Only rolling faster than this fraction of max speed builds static. */
  minSpeedFraction: 0.5,
  /** Distance rolled while dashing counts this many times. */
  dashMultiplier: 2,
  /** Below drainSpeedFraction of max speed, the meter drains drainPerSec of its capacity per second. */
  drainSpeedFraction: 0.2,
  drainPerSec: 0.1,
  /** Target range from the Bunny's surface, in Bunny radii. */
  range: 4,
  /** Boss stun from a Discharge (no chip), then Grounded: immune to Discharge for groundedFor seconds. */
  bossStun: 1.5,
  groundedFor: 10,
  /** A shorted-out non-boss Hazard bursts into this many absorbable scrap pieces of scrapSize × r. */
  scrapPieces: 4,
  scrapSize: 0.4,
  /** Zap's glow follows the meter: glowBase + glowPerCharge × charge (0..1). */
  glowBase: 0.15,
  glowPerCharge: 0.35,
} as const;
