/**
 * Hazard tuning (data only). Logic lives in src/hazards/. Sizes are radii in cm, speeds in
 * cm/s, times in seconds. `PerTier` arrays are indexed by Tier − 1 (Tier 1 first) and `tierValue`
 * clamps to the last entry: house tables have 5 entries (Tiers 6–9 reuse the Tier 5 value),
 * outdoor ones use `outdoorTiers(t5, t6, t7)` (7 entries) and city ones `cityTiers(t7, t8, t9)` (9).
 *
 * A Hazard is absorbable once size ≤ Bunny radius × absorbRatio (0.7 by default), so with
 * the default ratio: Lint Roller at r ≈ 10, Spray Bottle ≈ 11.4, Mop ≈ 21.4, Roomba ≈ 24.3,
 * Broom ≈ 37, Upright Vacuum ≈ 43, Robo-Vac 9000 ≈ 51 (lower after stun hits). Outdoors:
 * Sprinkler and Leaf Blower ≈ 64, Robotic Mower ≈ 79, Lawn Mower ≈ 93, Street Sweeper ≈ 214
 * (≈ 182 after one chip, ≈ 155 after two). City: Mini Scrubber ≈ 200, Pressure Washer ≈ 243,
 * Floor Scrubber ≈ 271, Litter Vacuum ≈ 314, Street Flusher ≈ 429, Garbage Truck ≈ 800 (≈ 680
 * after one chip, ≈ 578 after two).
 *
 * `mass` is the growth multiplier when absorbed (Debris are ~1), so Hazards are a big gain.
 *
 * Knockback is a displacement: max(knockbackCm, knockbackRadii × Bunny radius) in cm.
 * Suction strength is a fraction of the Bunny's max speed at the strongest point, so it
 * stays escapable at every Tier; it is multiplied by the Bunny's suctionMultiplier stat.
 */
import type { HazardModelId } from '../hazards/models';

/** Seconds a Roomba / Mop / Upright Vacuum holds still after landing a hit (no pinning against walls). */
export const HAZARD_RECOIL = 1.4;

export type PerTier = readonly [number, number, number, number, number, ...number[]];

/**
 * Per-Tier values for outdoor Hazards (Tiers 5, 6, 7). Tiers 1–4 repeat the Tier 5 value:
 * outdoor Hazards only appear in the neighborhood, which starts at Tier 5.
 */
export function outdoorTiers(t5: number, t6: number, t7: number): PerTier {
  return [t5, t5, t5, t5, t5, t6, t7];
}

/**
 * Per-Tier values for city Hazards (Tiers 7, 8, 9). Tiers 1–6 repeat the Tier 7 value: city
 * Hazards only appear in the city, which starts at Tier 7.
 */
export function cityTiers(t7: number, t8: number, t9: number): PerTier {
  return [t7, t7, t7, t7, t7, t7, t7, t8, t9];
}

/** Roomba behaviour: wander, bounce, suction ring. Also used by the Robotic Mower, Floor Scrubber and boss summons. */
export interface RoombaTuning {
  size: number;
  height: number;
  mass: number;
  damage: number;
  knockbackCm: number;
  knockbackRadii: number;
  speed: PerTier;
  /** Seconds between random turns [min, max]. */
  turnInterval: readonly [number, number];
  /** Max random turn (radians). */
  turnAngle: number;
  /** Suction reaches this far (cm) beyond the Hazard's edge (× suctionMultiplier). */
  suctionReach: number;
  suctionStrength: number;
  modelId: HazardModelId;
  /** Hazard size the unscaled model represents (the model is scaled by size / modelSize). */
  modelSize: number;
  /** Model node spun about Y while driving, at spinRate rad/s. */
  spinNode: string;
  spinRate: number;
}

export const ROOMBA: RoombaTuning = {
  size: 17,
  height: 10,
  mass: 4,
  damage: 1,
  knockbackCm: 18,
  knockbackRadii: 2.5,
  speed: [7, 14, 26, 40, 55],
  turnInterval: [2, 5],
  turnAngle: 2.0,
  suctionReach: 16,
  suctionStrength: 0.4,
  modelId: 'roomba',
  modelSize: 17,
  spinNode: 'side_brush',
  spinRate: 14,
};

/** Mini Roombas summoned by the boss: Roomba behaviour, smaller and faster. */
export const MINI_ROOMBA: RoombaTuning = {
  ...ROOMBA,
  size: 11,
  height: 7,
  mass: 4,
  speed: [20, 30, 45, 70, 95],
  suctionReach: 10,
  suctionStrength: 0.3,
};

/** Lane patrol (Lint Roller, Lawn Mower). */
export interface LaneTuning {
  size: number;
  height: number;
  mass: number;
  damage: number;
  speed: PerTier;
  laneMin: number;
  laneMax: number;
  /** Pause at each end of the lane. */
  endPause: number;
  /** Seconds the Bunny stays stuck to the drum (0: no sticking, a hit and a shove instead). */
  stickSeconds: number;
  /** Extra invulnerability after being released (so it can roll clear). */
  releaseInvulnerability: number;
  /** Fraction of the Bunny's volume (r³) shed per hit. */
  shedFraction: number;
  /** Fling on release (or knockback without sticking): max(releaseCm, releaseRadii × radius). */
  releaseCm: number;
  releaseRadii: number;
  /** Seconds the Hazard stops after a non-sticking hit. */
  hitPause: number;
  modelId: HazardModelId;
  /** Model node rolled about X while moving (null: none). */
  spinNode: string | null;
}

export const LINT_ROLLER: LaneTuning = {
  size: 7,
  height: 10,
  mass: 3,
  damage: 1,
  speed: [6, 12, 22, 34, 45],
  laneMin: 50,
  laneMax: 180,
  endPause: 0.6,
  stickSeconds: 1.0,
  releaseInvulnerability: 0.8,
  shedFraction: 0.08,
  releaseCm: 10,
  releaseRadii: 2.5,
  hitPause: 0,
  modelId: 'lint_roller',
  spinNode: 'drum',
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

/** Turret (Spray Bottle, Sprinkler, Pressure Washer): aim lane telegraph, then a burst of droplets. */
export interface TurretTuning {
  size: number;
  height: number;
  mass: number;
  damage: number;
  knockbackCm: number;
  knockbackRadii: number;
  range: PerTier;
  /** Aim turn rate (rad/s). */
  turnRate: number;
  telegraph: PerTier;
  burst: number;
  burstGap: number;
  cooldown: PerTier;
  dropletSpeed: PerTier;
  dropletRadius: number;
  /** Random spread per droplet (radians). */
  spread: number;
  /** Nozzle height (cm) for the droplet visuals. */
  nozzleHeight: number;
  modelId: HazardModelId;
  /** Hazard size the unscaled model represents (the model is scaled by size / modelSize). */
  modelSize: number;
  /** If set, only this model node turns to aim (the body stays put). */
  aimNode: string | null;
  /** Idle sweep (rad/s) while the Bunny is out of range (0: keep tracking the Bunny). */
  idleSpin: number;
  /** A droplet hit soaks the Bunny: speed × wetMultiplier for wetSeconds (0: no slow). */
  wetSeconds: number;
  wetMultiplier: number;
}

export const SPRAY_BOTTLE: TurretTuning = {
  size: 8,
  height: 25,
  mass: 3,
  damage: 1,
  knockbackCm: 4,
  knockbackRadii: 0.8,
  range: [90, 110, 160, 220, 260],
  turnRate: 2.5,
  telegraph: [0.9, 0.8, 0.7, 0.6, 0.55],
  burst: 3,
  burstGap: 0.14,
  cooldown: [2.8, 2.4, 2.0, 1.7, 1.5],
  dropletSpeed: [40, 55, 85, 120, 150],
  dropletRadius: 1.3,
  spread: 0.07,
  nozzleHeight: 21.8,
  modelId: 'spray_bottle',
  modelSize: 8,
  aimNode: null,
  idleSpin: 0,
  wetSeconds: 0,
  wetMultiplier: 1,
};

/** Patrol loop leaving a fading wet trail that slows (Mop, Street Flusher). */
export interface MopTuning {
  size: number;
  height: number;
  mass: number;
  damage: number;
  knockbackCm: number;
  knockbackRadii: number;
  speed: PerTier;
  /** Waypoints in the patrol loop. */
  waypoints: number;
  /** Waypoints stay in the spawn zone and within this distance (cm) of the spawn point. */
  patrolRange: number;
  /** Distance travelled between wet-trail puddles. */
  trailSpacing: number;
  /** Puddle lifetime (s); puddles shrink over the last `trailFade` fraction. */
  trailLife: number;
  trailFade: number;
  /** Puddle radius as a fraction of the Hazard size. */
  trailRadius: number;
  /** Speed multiplier while on the wet trail. */
  slowMultiplier: number;
  modelId: HazardModelId;
  /** Hazard size the unscaled model represents (the model is scaled by size / modelSize). */
  modelSize: number;
}

export const MOP: MopTuning = {
  size: 15,
  height: 20,
  mass: 3.5,
  damage: 1,
  knockbackCm: 20,
  knockbackRadii: 2.5,
  speed: [14, 18, 24, 38, 50],
  waypoints: 5,
  patrolRange: Infinity,
  trailSpacing: 7,
  trailLife: 7,
  trailFade: 0.4,
  trailRadius: 0.9,
  slowMultiplier: 0.5,
  modelId: 'mop',
  modelSize: 15,
};

/** Air cone (the Upright Vacuum and Litter Vacuum suck, the Leaf Blower blows). */
export interface AirConeTuning {
  size: number;
  height: number;
  mass: number;
  damage: number;
  knockbackCm: number;
  knockbackRadii: number;
  /** Fraction of the Bunny's volume shed on a contact hit (0: none). */
  shedFraction: number;
  speed: PerTier;
  turnRate: number;
  /** Cone half-angle (radians) and reach (cm from the intake / nozzle). */
  coneHalfAngle: number;
  coneRange: number;
  /** Air speed at the intake / nozzle as a fraction of the Bunny's max speed (× suctionMultiplier). */
  suctionStrength: number;
  /** Cycle: warm-up (telegraph) → air on → off. */
  warmup: number;
  on: number;
  off: number;
  /** 'suction' pulls the Bunny in; 'blow' pushes it away and blows small Debris along. */
  mode: 'suction' | 'blow';
  /** Blow mode: Debris up to this size (cm) is blown along at up to `debrisSpeed` cm/s. */
  blowDebrisSize: number;
  debrisSpeed: number;
  /** Intake / nozzle distance in front of the centre, as a fraction of size. */
  nozzleOffset: number;
  modelId: HazardModelId;
  /** Hazard size the unscaled model represents (the model is scaled by size / modelSize). */
  modelSize: number;
}

export const UPRIGHT_VACUUM: AirConeTuning = {
  size: 30,
  height: 110,
  mass: 3.5,
  /** 1 (design said 2): with Zap's 2 hearts a 2-damage hit was a one-shot. Shedding makes it hurt. */
  damage: 1,
  knockbackCm: 40,
  knockbackRadii: 3,
  shedFraction: 0.06,
  speed: [10, 12, 15, 18, 26],
  turnRate: 0.9,
  coneHalfAngle: 0.5,
  coneRange: 170,
  suctionStrength: 0.45,
  warmup: 0.8,
  on: 3.5,
  off: 2.5,
  mode: 'suction',
  blowDebrisSize: 0,
  debrisSpeed: 0,
  nozzleOffset: 0.7,
  modelId: 'upright_vacuum',
  modelSize: 30,
};

/** Area boss (Robo-Vac 9000, Street Sweeper, Garbage Truck): hunt, telegraphed charges, stun + chip, summons. */
export interface BossTuning {
  /** Absorb size at spawn. */
  size: number;
  /** Contact radius at full size. */
  contactRadius: number;
  height: number;
  mass: number;
  damage: number;
  knockbackCm: number;
  knockbackRadii: number;
  /** Mass shed by the Bunny when hit by the boss. */
  shedFraction: number;
  introTime: number;
  huntSpeed: number;
  turnRate: number;
  huntTime: readonly [number, number];
  /** Charge only when the Bunny is within this distance. */
  chargeTrigger: number;
  telegraph: number;
  chargeSpeed: number;
  chargeDistance: number;
  /** Stunned after a charge crashes into something; ram it while stunned to chip it. */
  stunTime: number;
  recover: number;
  /** Each chip multiplies size by this (and sheds absorbable parts). */
  chipFactor: number;
  chipPieces: number;
  suctionReach: number;
  suctionStrength: number;
  summonInterval: number;
  summonCount: number;
  maxMinis: number;
  /** Summoned Hazard def id (placed by its def's footprint). */
  miniId: string;
  /** Spin (rad/s) of the `brush_l` / `brush_r` model nodes. */
  brushSpin: number;
  /** Absorbing it opens the area's exit (front door, road to the city), or wins the Run. */
  onDefeat: 'openExit' | 'victory';
  modelId: HazardModelId;
  /** Boss size the unscaled model represents at full size (the model is scaled by size / modelSize). */
  modelSize: number;
}

export const ROBOVAC_9000: BossTuning & { arrivalDelay: number } = {
  /** Absorb size at spawn. Needs Bunny radius ≈ 51 at absorbRatio 0.7. */
  size: 36,
  /** Contact radius at full size (model footprint ~35). */
  contactRadius: 34,
  height: 21,
  mass: 6,
  /** 1 per hit (2 one-shot Zap); charges still knock hard and shed mass. */
  damage: 1,
  knockbackCm: 70,
  knockbackRadii: 3,
  shedFraction: 0.04,
  introTime: 2.5,
  huntSpeed: 120,
  turnRate: 2.4,
  huntTime: [2.5, 4],
  chargeTrigger: 650,
  telegraph: 1.1,
  chargeSpeed: 460,
  chargeDistance: 700,
  stunTime: 2.6,
  recover: 0.9,
  chipFactor: 0.88,
  chipPieces: 6,
  suctionReach: 50,
  suctionStrength: 0.25,
  summonInterval: 13,
  summonCount: 2,
  maxMinis: 4,
  miniId: 'mini_roomba',
  brushSpin: 16,
  onDefeat: 'openExit',
  modelId: 'robovac_9000',
  modelSize: 36,
  /** Seconds after reaching Tier 5 before the boss arrives. */
  arrivalDelay: 3,
};

// ── Neighborhood Hazards (Tiers 5–7, Bunny radius ≈ 50–250 cm) ──
// Speeds keep roughly the house Tier 4–5 ratios to the Bunny's max speed (6 × radius cm/s).

/** Robotic Mower: Roomba behaviour on a bigger scale, with a weak blade pull instead of suction. */
export const ROBO_MOWER: RoombaTuning = {
  size: 55,
  height: 31,
  mass: 4,
  damage: 1,
  knockbackCm: 90,
  knockbackRadii: 2.5,
  speed: outdoorTiers(110, 160, 220),
  turnInterval: [2.5, 5],
  turnAngle: 1.8,
  suctionReach: 30,
  suctionStrength: 0.15,
  modelId: 'robo_mower',
  modelSize: 55,
  spinNode: 'blade',
  spinRate: 24,
};

/** Mini mowers summoned by the Street Sweeper: smaller, faster Robotic Mowers. */
export const MINI_MOWER: RoombaTuning = {
  ...ROBO_MOWER,
  size: 38,
  height: 22,
  speed: outdoorTiers(220, 300, 380),
  suctionReach: 20,
  suctionStrength: 0.1,
};

/** Lawn Mower (unmanned push mower): patrols a lane; contact mows fluff off (sheds mass), no sticking. */
export const LAWN_MOWER: LaneTuning = {
  size: 65,
  height: 40,
  mass: 4,
  damage: 1,
  speed: outdoorTiers(120, 170, 230),
  laneMin: 300,
  laneMax: 1400,
  endPause: 0.8,
  stickSeconds: 0,
  releaseInvulnerability: 0,
  shedFraction: 0.07,
  releaseCm: 120,
  releaseRadii: 3,
  hitPause: 1,
  modelId: 'lawn_mower',
  spinNode: null,
};

/** Leaf Blower: amber cone warm-up, then a blast that pushes the Bunny away and blows small Debris. */
export const LEAF_BLOWER: AirConeTuning = {
  size: 45,
  height: 40,
  mass: 3.5,
  damage: 1,
  knockbackCm: 80,
  knockbackRadii: 2,
  shedFraction: 0,
  speed: outdoorTiers(45, 60, 80),
  turnRate: 1,
  coneHalfAngle: 0.45,
  coneRange: 520,
  /** Push speed at the nozzle: faster than the Bunny can roll into it. */
  suctionStrength: 1.1,
  warmup: 0.9,
  on: 1.8,
  off: 2.4,
  mode: 'blow',
  blowDebrisSize: 20,
  debrisSpeed: 320,
  nozzleOffset: 1,
  modelId: 'leaf_blower',
  modelSize: 45,
};

/** Sprinkler: turret whose head sweeps, aims a lane, then fires a burst of water that soaks (slows). */
export const SPRINKLER: TurretTuning = {
  size: 45,
  height: 70,
  mass: 3,
  damage: 1,
  knockbackCm: 25,
  knockbackRadii: 0.5,
  range: outdoorTiers(520, 680, 850),
  turnRate: 1.8,
  telegraph: outdoorTiers(0.85, 0.75, 0.65),
  burst: 4,
  burstGap: 0.12,
  cooldown: outdoorTiers(2.4, 2, 1.7),
  dropletSpeed: outdoorTiers(360, 480, 620),
  dropletRadius: 6,
  spread: 0.06,
  nozzleHeight: 63,
  modelId: 'sprinkler',
  modelSize: 45,
  aimNode: 'head',
  idleSpin: 0.9,
  wetSeconds: 1.5,
  wetMultiplier: 0.6,
};

/**
 * Street Sweeper (neighborhood boss, Tier 7). Needs Bunny radius ≈ 214 at absorbRatio 0.7,
 * ≈ 182 after one chip and ≈ 155 after two (Tier 7 starts at 160). Absorbing it opens the road
 * to the city.
 */
export const STREET_SWEEPER: BossTuning = {
  size: 150,
  /** Model footprint is ~223 × 310 cm. */
  contactRadius: 160,
  height: 230,
  mass: 6,
  damage: 1,
  knockbackCm: 220,
  knockbackRadii: 3,
  shedFraction: 0.04,
  introTime: 3,
  huntSpeed: 380,
  turnRate: 1.8,
  huntTime: [2.5, 4],
  chargeTrigger: 2200,
  telegraph: 1.2,
  chargeSpeed: 1500,
  chargeDistance: 2600,
  stunTime: 2.8,
  recover: 1,
  chipFactor: 0.85,
  chipPieces: 8,
  suctionReach: 180,
  suctionStrength: 0.25,
  summonInterval: 14,
  summonCount: 2,
  maxMinis: 4,
  miniId: 'mini_mower',
  brushSpin: 12,
  onDefeat: 'openExit',
  modelId: 'street_sweeper',
  modelSize: 150,
};

// ── City Hazards (Tiers 7–9, Bunny radius ≈ 230–900 cm) ──
// Speeds keep roughly the neighborhood ratios to the Bunny's max speed (6 × radius cm/s). The
// Blender models are real-size (a ride-on scrubber is ~1.6 m long), so most are scaled up to
// match the Hazard's size (model scale = size / modelSize).

/** Floor Scrubber (ride-on): Roomba behaviour at street scale, with a weak scrub-brush pull. */
export const FLOOR_SCRUBBER: RoombaTuning = {
  size: 190,
  /** Model 140 cm tall × 190 / 88. */
  height: 300,
  mass: 4,
  damage: 1,
  knockbackCm: 350,
  knockbackRadii: 2.5,
  speed: cityTiers(420, 600, 850),
  turnInterval: [2.5, 5],
  turnAngle: 1.8,
  suctionReach: 110,
  suctionStrength: 0.15,
  modelId: 'floor_scrubber',
  /** About the model's half length (95 × 154 cm footprint). */
  modelSize: 88,
  spinNode: 'brush',
  spinRate: 16,
};

/** Mini scrubbers summoned by the Garbage Truck: smaller, faster Floor Scrubbers. */
export const MINI_SCRUBBER: RoombaTuning = {
  ...FLOOR_SCRUBBER,
  size: 140,
  height: 220,
  speed: cityTiers(800, 1000, 1300),
  suctionReach: 80,
  suctionStrength: 0.1,
};

/** Pressure Washer: turret whose `head` turns, aims a lane, then fires a burst of water jets that soak (slow). */
export const PRESSURE_WASHER: TurretTuning = {
  size: 170,
  /** Model 107 cm tall × 170 / 55. */
  height: 330,
  mass: 3,
  damage: 1,
  knockbackCm: 120,
  knockbackRadii: 0.5,
  range: cityTiers(1500, 1900, 2400),
  turnRate: 1.6,
  telegraph: cityTiers(0.8, 0.7, 0.6),
  burst: 5,
  burstGap: 0.08,
  cooldown: cityTiers(2.4, 2, 1.7),
  dropletSpeed: cityTiers(1700, 2200, 2800),
  dropletRadius: 22,
  spread: 0.04,
  /** Nozzle tip ~93 cm up in the model. */
  nozzleHeight: 285,
  modelId: 'pressure_washer',
  /** The model's footprint radius (70 × 89 cm). */
  modelSize: 55,
  aimNode: 'head',
  idleSpin: 0.6,
  wetSeconds: 1.5,
  wetMultiplier: 0.6,
};

/** Litter Vacuum (street litter picker): amber cone warm-up, then a suction cone; contact sheds mass. */
export const LITTER_VACUUM: AirConeTuning = {
  size: 220,
  /** Model 160 cm tall × 220 / 93. */
  height: 380,
  mass: 3.5,
  damage: 1,
  knockbackCm: 300,
  knockbackRadii: 2.5,
  shedFraction: 0.05,
  speed: cityTiers(160, 220, 300),
  turnRate: 0.8,
  coneHalfAngle: 0.5,
  coneRange: 1100,
  suctionStrength: 0.45,
  warmup: 0.9,
  on: 3.2,
  off: 2.6,
  mode: 'suction',
  blowDebrisSize: 0,
  debrisSpeed: 0,
  nozzleOffset: 0.85,
  modelId: 'litter_vacuum',
  /** The model's footprint radius (88 × 175 cm; intake nozzle at the front). */
  modelSize: 93,
};

/** Street Flusher (water truck): Mop behaviour along a street, leaving a wide wet trail that slows. */
export const STREET_FLUSHER: MopTuning = {
  size: 300,
  height: 300,
  mass: 4,
  damage: 1,
  knockbackCm: 450,
  knockbackRadii: 3,
  speed: cityTiers(500, 600, 800),
  waypoints: 5,
  patrolRange: 3500,
  trailSpacing: 140,
  trailLife: 8,
  trailFade: 0.4,
  trailRadius: 1.1,
  slowMultiplier: 0.5,
  modelId: 'street_flusher',
  /** Real size (263 × 692 cm): the circle covers the body, the cab and tank ends poke out a little. */
  modelSize: 300,
};

/**
 * Garbage Truck (city boss, Tier 9). Needs Bunny radius ≈ 800 at absorbRatio 0.7, ≈ 680 after
 * one chip and ≈ 578 after two (Tier 9 starts at 600). Its compactor sucks the Bunny in while it
 * hunts; buildings and the concrete barrier stun its charges. Absorbing it wins the Run.
 */
export const GARBAGE_TRUCK: BossTuning = {
  size: 560,
  /** The model (273 × 924 cm) scaled × 1.3 is ~355 × 1200 cm. */
  contactRadius: 590,
  height: 500,
  mass: 6,
  damage: 1,
  knockbackCm: 800,
  knockbackRadii: 3,
  shedFraction: 0.04,
  introTime: 3,
  huntSpeed: 1300,
  turnRate: 1.5,
  huntTime: [2.5, 4],
  chargeTrigger: 7000,
  telegraph: 1.3,
  chargeSpeed: 5000,
  chargeDistance: 9000,
  stunTime: 3,
  recover: 1,
  chipFactor: 0.85,
  chipPieces: 8,
  suctionReach: 700,
  suctionStrength: 0.3,
  summonInterval: 14,
  summonCount: 2,
  maxMinis: 4,
  miniId: 'mini_scrubber',
  brushSpin: 12,
  onDefeat: 'victory',
  modelId: 'garbage_truck',
  modelSize: 430,
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
      types: { roomba: { weight: 1.2, max: 2 }, broom: { weight: 1, max: 1 }, spray_bottle: { weight: 0.6, max: 1 }, mop: { weight: 1, max: 2 }, upright_vacuum: { weight: 0.8, max: 1 } },
    },
    {
      budget: [4, 5],
      interval: [6, 5],
      types: { roomba: { weight: 1.5, max: 3 }, broom: { weight: 0.6, max: 1 }, mop: { weight: 0.8, max: 1 }, upright_vacuum: { weight: 1, max: 2 } },
    },
  ] as readonly TierSpawnTable[],
};

/**
 * Neighborhood director (after the house): spawn tables for Bunny Tiers 5–7, indexed from
 * `firstTier`. Outdoor Hazards are sized for a 50–250 cm Bunny.
 */
export const NEIGHBORHOOD_DIRECTOR = {
  firstTier: 5,
  /** No Hazards for this long after arriving. */
  graceSeconds: 10,
  tiers: [
    // Tier 5 (arrival, r ≈ 55–75): sprinklers, blowers and mowers that are still a threat.
    {
      budget: [2, 3],
      interval: [8, 6],
      types: { robo_mower: { weight: 1, max: 2 }, sprinkler: { weight: 1, max: 2 }, leaf_blower: { weight: 0.8, max: 1 } },
    },
    // Tier 6 (r 75–160): Lawn Mowers join; the smaller Hazards turn into food along the way.
    {
      budget: [3, 5],
      interval: [7, 5],
      types: { robo_mower: { weight: 1, max: 2 }, lawn_mower: { weight: 1, max: 2 }, leaf_blower: { weight: 0.9, max: 2 }, sprinkler: { weight: 0.7, max: 2 } },
    },
    // Tier 7 (r ≥ 160): the Street Sweeper arrives; everything else is absorbable by now.
    {
      budget: [4, 5],
      interval: [6, 5],
      types: { robo_mower: { weight: 1.2, max: 3 }, lawn_mower: { weight: 1, max: 2 }, leaf_blower: { weight: 0.8, max: 2 }, sprinkler: { weight: 0.5, max: 1 } },
    },
  ] as readonly TierSpawnTable[],
};

/**
 * City director (after the neighborhood): spawn tables for Bunny Tiers 7–9, indexed from
 * `firstTier`. City Hazards are sized for a 230–900 cm Bunny.
 */
export const CITY_DIRECTOR = {
  firstTier: 7,
  /** No Hazards for this long after arriving. */
  graceSeconds: 10,
  tiers: [
    // Tier 7 (arrival, r ≈ 230–320): scrubbers, washers and litter vacuums that are still a threat.
    {
      budget: [2, 3],
      interval: [8, 6],
      types: { floor_scrubber: { weight: 1, max: 2 }, pressure_washer: { weight: 1, max: 2 }, litter_vacuum: { weight: 0.8, max: 1 } },
    },
    // Tier 8 (r 320–600): Street Flushers join; the Tier 7 Hazards turn into food along the way.
    {
      budget: [3, 5],
      interval: [7, 5],
      types: { floor_scrubber: { weight: 1, max: 2 }, street_flusher: { weight: 1, max: 2 }, litter_vacuum: { weight: 0.9, max: 2 }, pressure_washer: { weight: 0.7, max: 2 } },
    },
    // Tier 9 (r ≥ 600): the Garbage Truck arrives; everything else is absorbable by now.
    {
      budget: [4, 5],
      interval: [6, 5],
      types: { floor_scrubber: { weight: 1.2, max: 3 }, street_flusher: { weight: 1, max: 2 }, litter_vacuum: { weight: 0.8, max: 2 }, pressure_washer: { weight: 0.5, max: 1 } },
    },
  ] as readonly TierSpawnTable[],
};

/** Spawn director table per area: first Tier the table covers, grace period, per-Tier tables. */
export interface AreaDirector {
  firstTier: number;
  graceSeconds: number;
  tiers: readonly TierSpawnTable[];
}

export const AREA_DIRECTORS: Record<'house' | 'neighborhood' | 'city', AreaDirector> = {
  house: { firstTier: 1, graceSeconds: DIRECTOR.graceSeconds, tiers: DIRECTOR.tiers },
  neighborhood: NEIGHBORHOOD_DIRECTOR,
  city: CITY_DIRECTOR,
};

/** Each area's boss: def id, the Bunny Tier it arrives at, and the delay after reaching it. */
export const AREA_BOSSES = {
  house: { id: 'robovac_9000', tier: 5, arrivalDelay: 3 },
  neighborhood: { id: 'street_sweeper', tier: 7, arrivalDelay: 4 },
  city: { id: 'garbage_truck', tier: 9, arrivalDelay: 4 },
} as const;

/** Hazards the director never picks at random (bosses and their summons). */
export const DIRECTOR_EXCLUDE: readonly string[] = ['robovac_9000', 'mini_roomba', 'street_sweeper', 'mini_mower', 'garbage_truck', 'mini_scrubber'];

export function tierValue(values: PerTier, tier: number): number {
  return values[Math.min(Math.max(Math.round(tier), 1), values.length) - 1]!;
}
