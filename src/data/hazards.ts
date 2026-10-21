/**
 * Hazard tuning (data only). Logic lives in src/hazards/. Sizes are radii in cm, speeds in
 * cm/s, times in seconds. `PerTier` arrays are indexed by Tier − 1 (Tier 1 first).
 *
 * A Hazard is absorbable once size ≤ Bunny radius × absorbRatio (0.7 by default), so with
 * the default ratio: Lint Roller at r ≈ 10, Spray Bottle ≈ 11.4, Mop ≈ 21.4, Roomba ≈ 24.3,
 * Broom ≈ 37, Upright Vacuum ≈ 43, Robo-Vac 9000 ≈ 51 (lower after stun hits).
 *
 * `mass` is the growth multiplier when absorbed (Debris are ~1), so Hazards are a big gain.
 *
 * Knockback is a displacement: max(knockbackCm, knockbackRadii × Bunny radius) in cm.
 * Suction strength is a fraction of the Bunny's max speed at the strongest point, so it
 * stays escapable at every Tier; it is multiplied by the Bunny's suctionMultiplier stat.
 */
export type PerTier = readonly [number, number, number, number, number];

export const ROOMBA = {
  size: 17,
  height: 10,
  mass: 4,
  damage: 1,
  knockbackCm: 18,
  knockbackRadii: 2.5,
  speed: [7, 14, 26, 40, 55] as PerTier,
  /** Seconds between random turns [min, max]. */
  turnInterval: [2, 5] as const,
  /** Max random turn (radians). */
  turnAngle: 2.0,
  /** Suction reaches this far (cm) beyond the Roomba's edge (× suctionMultiplier). */
  suctionReach: 16,
  suctionStrength: 0.4,
};

/** Mini Roombas summoned by the boss: Roomba behaviour, smaller and faster. */
export const MINI_ROOMBA = {
  ...ROOMBA,
  size: 11,
  height: 7,
  mass: 4,
  speed: [20, 30, 45, 70, 95] as PerTier,
  suctionReach: 10,
  suctionStrength: 0.3,
};

export const LINT_ROLLER = {
  size: 7,
  height: 10,
  mass: 3,
  damage: 1,
  speed: [6, 12, 22, 34, 45] as PerTier,
  laneMin: 50,
  laneMax: 180,
  /** Pause at each end of the lane. */
  endPause: 0.6,
  /** Seconds the Bunny stays stuck to the drum. */
  stickSeconds: 1.0,
  /** Extra invulnerability after being released (so it can roll clear). */
  releaseInvulnerability: 0.8,
  /** Fraction of the Bunny's volume (r³) shed per hit. */
  shedFraction: 0.08,
  releaseCm: 10,
  releaseRadii: 2.5,
};

export const BROOM = {
  /** Absorb size (the broom is big; absorbable late in Tier 4). */
  size: 26,
  /** Distance from the pivot to the bristle head (cm). */
  sweepRadius: 40,
  /** Contact radius of the bristle head. */
  headRadius: 15,
  mass: 3,
  damage: 1,
  knockbackCm: 45,
  knockbackRadii: 5,
  /** Sweep arc (radians). */
  arc: 1.9,
  idle: [1.8, 3.2] as const,
  telegraph: [1.4, 1.3, 1.1, 0.95, 0.85] as PerTier,
  sweepTime: 0.45,
  /** Within this distance the broom aims its arc at the Bunny. */
  aggroRange: 170,
};

export const SPRAY_BOTTLE = {
  size: 8,
  height: 25,
  mass: 3,
  damage: 1,
  knockbackCm: 4,
  knockbackRadii: 0.8,
  range: [90, 110, 160, 220, 260] as PerTier,
  /** Aim turn rate (rad/s). */
  turnRate: 2.5,
  telegraph: [0.9, 0.8, 0.7, 0.6, 0.55] as PerTier,
  burst: 3,
  burstGap: 0.14,
  cooldown: [2.8, 2.4, 2.0, 1.7, 1.5] as PerTier,
  dropletSpeed: [40, 55, 85, 120, 150] as PerTier,
  dropletRadius: 1.3,
  /** Random spread per droplet (radians). */
  spread: 0.07,
  /** Nozzle height (cm) for the droplet visuals. */
  nozzleHeight: 21.8,
};

export const MOP = {
  size: 15,
  height: 20,
  mass: 3.5,
  damage: 1,
  knockbackCm: 20,
  knockbackRadii: 2.5,
  speed: [14, 18, 24, 38, 50] as PerTier,
  /** Waypoints in the patrol loop. */
  waypoints: 5,
  /** Distance travelled between wet-trail puddles. */
  trailSpacing: 7,
  /** Puddle lifetime (s); puddles shrink over the last `trailFade` fraction. */
  trailLife: 7,
  trailFade: 0.4,
  /** Puddle radius as a fraction of the mop size. */
  trailRadius: 0.9,
  /** Speed multiplier while on the wet trail. */
  slowMultiplier: 0.5,
};

export const UPRIGHT_VACUUM = {
  size: 30,
  height: 110,
  mass: 3.5,
  damage: 2,
  knockbackCm: 40,
  knockbackRadii: 3,
  shedFraction: 0.06,
  speed: [10, 12, 15, 18, 26] as PerTier,
  turnRate: 0.9,
  /** Suction cone half-angle (radians) and reach (cm from the intake). */
  coneHalfAngle: 0.5,
  coneRange: 170,
  suctionStrength: 0.6,
  /** Cycle: warm-up (telegraph) → suction on → off. */
  warmup: 0.8,
  on: 3.5,
  off: 2.5,
};

export const ROBOVAC_9000 = {
  /** Absorb size at spawn. Needs Bunny radius ≈ 51 at absorbRatio 0.7. */
  size: 36,
  /** Contact radius at full size (model footprint ~35). */
  contactRadius: 34,
  height: 21,
  mass: 6,
  damage: 2,
  knockbackCm: 70,
  knockbackRadii: 3,
  /** Mass shed by the Bunny when hit by the boss. */
  shedFraction: 0.04,
  introTime: 2.5,
  huntSpeed: 120,
  turnRate: 2.4,
  huntTime: [2.5, 4] as const,
  /** Charge only when the Bunny is within this distance. */
  chargeTrigger: 650,
  telegraph: 1.1,
  chargeSpeed: 460,
  chargeDistance: 700,
  /** Stunned after crashing into a wall; ram it while stunned to chip it. */
  stunTime: 2.6,
  recover: 0.9,
  /** Each chip multiplies size by this (and sheds absorbable parts). */
  chipFactor: 0.88,
  chipPieces: 6,
  suctionReach: 50,
  suctionStrength: 0.25,
  summonInterval: 13,
  summonCount: 2,
  maxMinis: 4,
  /** Seconds after reaching Tier 5 before the boss arrives. */
  arrivalDelay: 3,
};

export interface TierSpawnTable {
  /** Alive Hazard budget at the start / end of the Tier (ramps with Tier progress). */
  budget: readonly [number, number];
  /** Seconds between spawns at the start / end of the Tier. */
  interval: readonly [number, number];
  /** Relative weights and per-type caps. */
  types: Readonly<Record<string, { weight: number; max: number }>>;
}

export const DIRECTOR = {
  /** No Hazards for this long at Run start. */
  graceSeconds: 12,
  /** Speed multiplier ramp within a Tier (start → end). */
  speedRamp: [1, 1.15] as const,
  /** Spawn ring: inner = view radius + hazard size + margin; width = max(view radius, ringMin). */
  spawnMargin: 15,
  ringMin: 60,
  /** Despawn when farther than max(view radius × despawnViewMul, despawnMin) for despawnDelay seconds. */
  despawnViewMul: 4,
  despawnMin: 260,
  despawnDelay: 4,
  /** Out-of-view Hazards smaller than Bunny radius × this are removed (irrelevant). */
  irrelevantRatio: 0.12,
  tiers: [
    { budget: [1, 2], interval: [10, 8], types: { roomba: { weight: 1, max: 1 }, lint_roller: { weight: 1.2, max: 1 } } },
    {
      budget: [2, 3],
      interval: [8, 6],
      types: { roomba: { weight: 1, max: 1 }, lint_roller: { weight: 1, max: 2 }, broom: { weight: 0.9, max: 1 }, spray_bottle: { weight: 0.9, max: 2 } },
    },
    {
      budget: [3, 4],
      interval: [7, 5],
      types: { roomba: { weight: 1, max: 2 }, lint_roller: { weight: 0.6, max: 2 }, broom: { weight: 1, max: 1 }, spray_bottle: { weight: 1, max: 2 }, mop: { weight: 1, max: 2 } },
    },
    {
      budget: [4, 5],
      interval: [6, 5],
      types: { roomba: { weight: 1.2, max: 2 }, broom: { weight: 1, max: 1 }, spray_bottle: { weight: 0.6, max: 1 }, mop: { weight: 1, max: 2 }, upright_vacuum: { weight: 1, max: 2 } },
    },
    {
      budget: [4, 5],
      interval: [6, 5],
      types: { roomba: { weight: 1.5, max: 3 }, broom: { weight: 0.6, max: 1 }, mop: { weight: 0.8, max: 1 }, upright_vacuum: { weight: 1, max: 2 } },
    },
  ] as readonly TierSpawnTable[],
};

export function tierValue(values: PerTier, tier: number): number {
  return values[Math.min(Math.max(Math.round(tier), 1), values.length) - 1]!;
}
