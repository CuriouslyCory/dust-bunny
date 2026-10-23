/**
 * Character Abilities (unlocked from the first Run): Lint's Decoy, Tumble's Amass, Zap's
 * Discharge. Tunable numbers only; the behaviour lives in src/abilities/. Ranges and sizes
 * are in Bunny radii (r), so each Ability plays the same at every Tier.
 */

export type AbilityId = 'decoy' | 'amass' | 'discharge';

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
  amass: {
    id: 'amass',
    name: 'Amass',
    icon: '🪐',
    description: 'Hold to compact your core. Gravity drags Debris and small Hazards in, and small Hazards that touch you are swallowed.',
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

export const AMASS = {
  /** Longest channel, in seconds (Lingering Mass adds to it, up to KEEPSAKE_FLOORS.amassMaxHold). */
  maxHold: 2,
  /** Cooldown after release: base + perSecondHeld × seconds channelled (tap 5 s, full 2 s hold 12 s). */
  cooldownBase: 5,
  cooldownPerSecondHeld: 3.5,
  /** Max speed multiplier while channelling (applied after the caps). */
  moveSpeedMul: 0.25,
  /** Fraction of Hazard damage taken off while channelling (Unmoved adds to it). */
  damageReduction: 0.3,
  /** Suction multiplier while channelling (denser core, harder pull; applied after the caps). */
  suctionMul: 1.2,
  /** Debris and non-boss Hazards up to this × r are pulled; bigger ones only shake. */
  pullRatio: 1.25,
  /** Non-boss Hazards up to this × r that touch Tumble while channelling are swallowed. */
  absorbRatio: 1.15,
  /** Pull speed at full strength, in Bunny radii per second (Dense Core multiplies it). */
  pullSpeed: 2,
  /** Full-strength core, in Bunny radii from the Bunny's centre (Dense Core adds to it). */
  coreRadius: 3,
  /** Pull strength at the map's edge (1 inside the core, falling off linearly to this). */
  edgeFalloff: 0.35,
  /** Angular swirl: the pull leans this many degrees off straight inward (an accretion disc). */
  swirlDeg: 15,
  /** Seconds the pull takes to reach full strength after the channel starts. */
  rampTime: 0.25,
  /** A swallowed Hazard bursts into this many scrap pieces of scrapSize × r. */
  scrapPieces: 3,
  scrapSize: 0.35,
  /** The swallow's micro-shockwave: non-boss Hazards within this many r of the Bunny's surface are stunned. */
  shockwaveRadius: 2,
  shockwaveStun: 0.4,
  /** Chip parts a boss sheds on top of its usual chip when it crashes into an Amassing Tumble. */
  bossChipParts: 2,
  /** Knockback of Collapse's detonation on non-boss Hazards, in Bunny radii. */
  collapseKnockback: 2.5,
  /** Fraction of Collapse's stun a boss receives. */
  collapseBossStun: 0.5,
  /** Feast's growth bonus also covers absorbs this many seconds after the channel ends. */
  feastLinger: 1,
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
