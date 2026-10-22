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
 * after one chip, ≈ 578 after two). Region (in its unit, 1 = 10 m): Mini Compactor ≈ 1.07, Landfill
 * Compactor ≈ 1.5, Crop Duster ≈ 1.79, River Barge ≈ 2.14, Snowplow ≈ 2.43, Water Bomber ≈ 3.29,
 * Freight Train ≈ 3.5, Incinerator ≈ 4 (≈ 3.4 after one chip, ≈ 2.89 after two). Continent (in its
 * unit, 1 = 10 km): Tornado ≈ 1.57, Volcano ≈ 1.86, River Surge ≈ 2.14, Glacier Tongue ≈ 2.71,
 * Hurricane ≈ 3.43, Ice Sheet ≈ 4 (≈ 3.4 after one chip, ≈ 2.89 after two).
 *
 * `mass` is the growth multiplier when absorbed (Debris are ~1), so Hazards are a big gain.
 *
 * Lengths and speeds are in the Area's world unit: cm up to the City, 10 m in the Region, 10 km
 * in the Continent (`AREAS[area].unit`), so `knockbackCm`, `suctionReach`, `coneRange`… of a Region
 * Hazard are in Region units and a Continent Hazard's in Continent units.
 *
 * Knockback is a displacement: max(knockbackCm, knockbackRadii × Bunny radius) in cm.
 * Suction strength is a fraction of the Bunny's max speed at the strongest point, so it
 * stays escapable at every Tier; it is multiplied by the Bunny's suctionMultiplier stat.
 */
import type { HazardModelId } from '../hazards/models';
import type { AreaId } from '../world/types';

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

/**
 * Per-Tier values for region Hazards (Tiers 10, 11), in Region units (1 = 10 m). Tiers 1–9 repeat
 * the Tier 10 value: the Bunny arrives in the region at Tier 9 and region Hazards live only there.
 */
export function regionTiers(t10: number, t11: number): PerTier {
  return [t10, t10, t10, t10, t10, t10, t10, t10, t10, t10, t11];
}

/**
 * Per-Tier values for continent Hazards (Tiers 12, 13), in Continent units (1 = 10 km). Tiers 1–11
 * repeat the Tier 12 value: the Bunny arrives in the continent at Tier 11 (0.85 units, the arrival
 * leap) and continent Hazards live only there.
 */
export function continentTiers(t12: number, t13: number): PerTier {
  return [t12, t12, t12, t12, t12, t12, t12, t12, t12, t12, t12, t12, t13];
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
  /** Hazard size the unscaled model represents (model scale = size / modelSize; default: size, i.e. unscaled). */
  modelSize?: number;
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
  /** Model node spun about its local Z at spinRate rad/s while active (the Crop Duster's `propeller`). */
  spinNode?: string;
  spinRate?: number;
  /** Droplet colour (default: water blue). */
  dropletColor?: string;
  /** Extra peak height of a droplet's flight arc (world units; default 0: a straight fall from the nozzle). The Volcano lobs its lava bombs. */
  dropletArc?: number;
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
  /** Blow mode: while the blast reaches the Bunny it is soaked, speed × wetMultiplier for wetSeconds (default: none). */
  wetSeconds?: number;
  wetMultiplier?: number;
  /** Model node spun about Y at spinRate rad/s (the Hurricane's `bands`). */
  spinNode?: string;
  spinRate?: number;
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

/** Area boss (Robo-Vac 9000, Street Sweeper, Garbage Truck, Incinerator, Ice Sheet): hunt, telegraphed charges, stun + chip, summons. */
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
  /** Summoned Hazard def id (placed by its def's footprint); none: the boss summons nothing (the Ice Sheet calves icebergs instead). */
  miniId?: string;
  /** Spin (rad/s) of the `brush_l` / `brush_r` model nodes. */
  brushSpin: number;
  /**
   * 'openExit': absorbing it clears the Area (`run.clearArea()`): the exit to the next Area opens,
   * or in the last built Area the Run is won. 'victory' wins the Run outright.
   */
  onDefeat: 'openExit' | 'victory';
  modelId: HazardModelId;
  /** Boss size the unscaled model represents at full size (the model is scaled by size / modelSize). */
  modelSize: number;
  /** Optional ranged volley while hunting (the Incinerator's chimney ash). */
  ash?: AshTuning;
}

/**
 * A boss's ranged volley (the Incinerator's chimney): every `interval` s while it hunts (or
 * recovers) on screen it locks an amber lane at its target for `telegraph` s, then fires `count`
 * pellets along it. A pellet hit deals `damage` with knockback and sheds `shedFraction` of the
 * Bunny's volume.
 */
export interface AshTuning {
  interval: number;
  telegraph: number;
  count: number;
  /** Seconds between pellets. */
  gap: number;
  speed: number;
  radius: number;
  range: number;
  /** Random spread per pellet (radians). */
  spread: number;
  damage: number;
  knockbackCm: number;
  knockbackRadii: number;
  shedFraction: number;
  /** Launch point along the boss's facing, as a fraction of its size (negative: behind the centre). */
  originOffset: number;
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
 * hunts; buildings and the concrete barrier stun its charges. Absorbing it opens the highway
 * on-ramp to the region.
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
  onDefeat: 'openExit',
  modelId: 'garbage_truck',
  modelSize: 430,
};

// ── Region Hazards (Tiers 10–11, 1 world unit = 10 m, Bunny radius ≈ 0.65–4.5 units) ──
// Region units throughout. Speeds keep roughly the City's ratios to the Bunny's max speed
// (6 × radius units/s). The Blender models are real-size (cm), so `modelSize` is the model's
// footprint radius in cm, scaling it to `size` units; heights follow the model (model height ×
// size / modelSize). Tier 10 Hazards are a threat on arrival (r ≈ 0.65–0.9) and food by late
// Tier 10 / early Tier 11; the Tier 11 newcomers (Freight Train, Water Bomber) are food before
// the Incinerator is.

/** Landfill Compactor: Roomba behaviour across the fields, with a pull from its packer wheels; spins its roof `beacon`. */
export const LANDFILL_COMPACTOR: RoombaTuning = {
  size: 1.05,
  /** Model 380 cm tall × 1.05 / 360. */
  height: 1.1,
  mass: 4,
  damage: 1,
  knockbackCm: 1.75,
  knockbackRadii: 2.5,
  speed: regionTiers(1.9, 4),
  turnInterval: [2.5, 5],
  turnAngle: 1.8,
  suctionReach: 0.6,
  suctionStrength: 0.2,
  modelId: 'landfill_compactor',
  /** The model's footprint radius (cm). */
  modelSize: 355,
  spinNode: 'beacon',
  spinRate: 4,
};

/** Mini compactors summoned by the Incinerator: smaller, faster Landfill Compactors (food for a Tier 11 Bunny). */
export const MINI_COMPACTOR: RoombaTuning = {
  ...LANDFILL_COMPACTOR,
  size: 0.75,
  height: 0.8,
  knockbackCm: 1.2,
  speed: regionTiers(5, 6.5),
  suctionReach: 0.4,
  suctionStrength: 0.1,
};

/** Snowplow: lane patrol along a road; a hit plows the Bunny off the lane and sheds mass (no sticking). */
export const SNOWPLOW: LaneTuning = {
  size: 1.7,
  /** Model 350 cm tall × 1.7 / 520. */
  height: 1.15,
  mass: 4,
  damage: 1,
  speed: regionTiers(2.6, 5),
  laneMin: 6,
  laneMax: 28,
  endPause: 0.8,
  stickSeconds: 0,
  releaseInvulnerability: 0,
  shedFraction: 0.07,
  releaseCm: 2.5,
  releaseRadii: 3.5,
  hitPause: 1,
  modelId: 'snowplow',
  modelSize: 530,
  spinNode: null,
};

/** Freight Train: a long, fast lane; the locomotive knocks the Bunny off the track and sheds mass. */
export const FREIGHT_TRAIN: LaneTuning = {
  size: 2.45,
  /** Model 450 cm tall × 2.45 / 1100. */
  height: 1,
  mass: 4,
  damage: 1,
  speed: regionTiers(6, 9),
  laneMin: 20,
  laneMax: 110,
  endPause: 1.2,
  stickSeconds: 0,
  releaseInvulnerability: 0,
  shedFraction: 0.08,
  releaseCm: 3,
  releaseRadii: 3.5,
  hitPause: 0.5,
  modelId: 'freight_train',
  modelSize: 1100,
  spinNode: null,
};

/** Crop Duster: turret circling on the spot, aims a lane, then dusts a burst of pesticide that soaks (slows). */
export const CROP_DUSTER: TurretTuning = {
  size: 1.25,
  /** Model 300 cm tall × 1.25 / 560. */
  height: 0.67,
  mass: 3,
  damage: 1,
  knockbackCm: 0.6,
  knockbackRadii: 0.5,
  range: regionTiers(8, 13),
  turnRate: 1.4,
  telegraph: regionTiers(0.8, 0.65),
  burst: 6,
  burstGap: 0.09,
  cooldown: regionTiers(2.4, 1.8),
  dropletSpeed: regionTiers(8.5, 13),
  dropletRadius: 0.14,
  spread: 0.09,
  nozzleHeight: 0.5,
  modelId: 'crop_duster',
  modelSize: 562,
  aimNode: null,
  idleSpin: 0.5,
  wetSeconds: 2,
  wetMultiplier: 0.55,
  spinNode: 'propeller',
  spinRate: 30,
  dropletColor: '#c6e86b',
};

/** River Barge: Mop behaviour on the river (its def prefers `river` zones), leaving a wide wake that slows. */
export const RIVER_BARGE: MopTuning = {
  size: 1.5,
  /** Model 300 cm tall × 1.5 / 700. */
  height: 0.64,
  mass: 4,
  damage: 1,
  knockbackCm: 2.2,
  knockbackRadii: 3,
  speed: regionTiers(1.6, 2.6),
  waypoints: 4,
  patrolRange: 18,
  trailSpacing: 0.7,
  trailLife: 10,
  trailFade: 0.4,
  trailRadius: 1.2,
  slowMultiplier: 0.5,
  modelId: 'river_barge',
  modelSize: 706,
};

/** Water Bomber: amber cone warm-up, then a water drop that blasts the Bunny away (Leaf Blower) and soaks it. */
export const WATER_BOMBER: AirConeTuning = {
  size: 2.3,
  /** Model 700 cm tall × 2.3 / 1400. */
  height: 1.15,
  mass: 3.5,
  damage: 1,
  knockbackCm: 3,
  knockbackRadii: 2,
  shedFraction: 0,
  speed: regionTiers(1.8, 2.6),
  turnRate: 0.7,
  coneHalfAngle: 0.42,
  coneRange: 13,
  /** Push speed at the nozzle: faster than the Bunny can roll into it. */
  suctionStrength: 1.15,
  warmup: 1,
  on: 1.8,
  off: 2.6,
  mode: 'blow',
  blowDebrisSize: 0.35,
  debrisSpeed: 10,
  nozzleOffset: 0.5,
  modelId: 'water_bomber',
  modelSize: 1380,
  wetSeconds: 1.5,
  wetMultiplier: 0.6,
};

/**
 * The Incinerator (region boss, Tier 11): rail-mounted waste plant. Needs Bunny radius ≈ 4 units
 * at absorbRatio 0.7, ≈ 3.4 after one chip and ≈ 2.89 after two (Tier 11 starts at 3). Its feed
 * conveyor sucks the Bunny in while it hunts, its chimney fires ash volleys that shed mass, towns
 * and the map edge stun its charges, and it summons mini compactors. Absorbing it clears the
 * Region: the motorway west to the Continent opens.
 */
export const INCINERATOR: BossTuning = {
  size: 2.8,
  /** The model's footprint radius (1800 cm × 2.8 / 1800) plus a margin, like the Garbage Truck's. */
  contactRadius: 2.95,
  /** Model 2600 cm tall × 2.8 / 1800. */
  height: 4,
  mass: 6,
  damage: 1,
  knockbackCm: 4,
  knockbackRadii: 3,
  shedFraction: 0.04,
  introTime: 3,
  huntSpeed: 6,
  turnRate: 1.4,
  huntTime: [2.5, 4],
  chargeTrigger: 35,
  telegraph: 1.4,
  chargeSpeed: 24,
  chargeDistance: 45,
  stunTime: 3,
  recover: 1,
  chipFactor: 0.85,
  chipPieces: 8,
  suctionReach: 4,
  suctionStrength: 0.35,
  summonInterval: 14,
  summonCount: 2,
  maxMinis: 4,
  miniId: 'mini_compactor',
  brushSpin: 10,
  onDefeat: 'openExit',
  modelId: 'incinerator',
  modelSize: 1781,
  ash: {
    interval: 5.5,
    telegraph: 0.9,
    count: 5,
    gap: 0.14,
    speed: 17,
    radius: 0.32,
    range: 34,
    spread: 0.14,
    damage: 1,
    knockbackCm: 1,
    knockbackRadii: 0.6,
    shedFraction: 0.03,
    /** The chimney stands ≈ 600 cm behind the centre of the 1800 cm footprint. */
    originOffset: -0.33,
  },
};

// ── Continent Hazards (Tiers 12–13, 1 world unit = 10 km, Bunny radius ≈ 0.85–4.5 units) ──
// Weather: the planet has run out of machines. Continent units throughout. The Continent repeats the
// Region's shape (Tiers at 1 and 3 units, arrival just under 1, boss absorbable at ≈ 4), so sizes
// keep the Region ladder's ratios to the Bunny and speeds its ratios to the Bunny's max speed
// (6 × radius units/s). The Blender models are authored at 1 unit = 100 m and loaded at scale 0.01
// (public/models/manifest.json), so they arrive in Continent units: `modelSize` is the model's
// footprint radius in Continent units (catalog footprint radius / 100) and heights follow the
// model (model height × size / modelSize). Tier 12 Hazards are a threat on arrival (r 0.85) and
// food by early Tier 13; the Tier 13 Hurricane is food before the Ice Sheet is.

/** Tornado: Roomba behaviour with a strong vortex pull; erratic turns; spins its `funnel`. */
export const TORNADO: RoombaTuning = {
  size: 1.1,
  /** Model 4.49 tall × 1.1 / 1.48. */
  height: 3.3,
  mass: 4,
  damage: 1,
  knockbackCm: 1.8,
  knockbackRadii: 2.5,
  speed: continentTiers(2.2, 4.4),
  turnInterval: [1.2, 3],
  turnAngle: 2.2,
  /** A wider, stronger pull than the Landfill Compactor's (0.6, 0.2): it is a vortex. */
  suctionReach: 1.4,
  suctionStrength: 0.3,
  modelId: 'tornado',
  /** The model's footprint radius (148 × 100 m). */
  modelSize: 1.48,
  spinNode: 'funnel',
  spinRate: 5,
};

/** Glacier Tongue: a slow, heavy lane patrol; a hit shoves the Bunny off the lane and scrapes mass off (no sticking). */
export const GLACIER_TONGUE: LaneTuning = {
  size: 1.9,
  /** Model 0.149 tall × 1.9 / 1.28. */
  height: 0.22,
  mass: 4,
  damage: 1,
  /** About half the Snowplow's speed (2.6, 5): ice creeps, but it does not stop. */
  speed: continentTiers(1.4, 2.4),
  laneMin: 8,
  laneMax: 30,
  endPause: 1.6,
  stickSeconds: 0,
  releaseInvulnerability: 0,
  shedFraction: 0.08,
  releaseCm: 3,
  releaseRadii: 4,
  hitPause: 1.5,
  modelId: 'glacier_tongue',
  /** The model's footprint radius (128 × 100 m; 1.0 × 2.46 units, moving along its length). */
  modelSize: 1.28,
  spinNode: null,
};

/** Volcano: a static turret; its `crater` aims, a lane telegraph, then lobbed lava bombs whose ash slows. */
export const VOLCANO: TurretTuning = {
  size: 1.3,
  /** Model 1.1 tall × 1.3 / 2. */
  height: 0.72,
  mass: 3,
  damage: 1,
  knockbackCm: 0.8,
  knockbackRadii: 0.6,
  range: continentTiers(9, 13),
  turnRate: 1.8,
  /** Lobbed bombs: a longer telegraph and slower shots than the Crop Duster's (0.8, 8.5). */
  telegraph: continentTiers(1.1, 0.9),
  burst: 3,
  burstGap: 0.18,
  cooldown: continentTiers(3.2, 2.6),
  dropletSpeed: continentTiers(7, 10),
  dropletRadius: 0.22,
  spread: 0.1,
  /** The vent: model (0, 0.96, 0) × 1.3 / 2. */
  nozzleHeight: 0.62,
  modelId: 'volcano',
  /** The model's footprint radius (200 × 100 m). */
  modelSize: 2,
  aimNode: 'crater',
  idleSpin: 0,
  wetSeconds: 1.2,
  wetMultiplier: 0.7,
  dropletColor: '#ff6a1a',
  dropletArc: 1.6,
};

/** River Surge: Mop behaviour, a fast flood surge leaving a wide muddy trail that slows. */
export const RIVER_SURGE: MopTuning = {
  size: 1.5,
  /** Model 0.199 tall × 1.5 / 1.288. */
  height: 0.23,
  mass: 4,
  damage: 1,
  knockbackCm: 2.2,
  knockbackRadii: 3,
  /** Faster than the River Barge (1.6, 2.6): a surge, not a boat. */
  speed: continentTiers(2.2, 3.4),
  waypoints: 4,
  patrolRange: 22,
  trailSpacing: 0.7,
  trailLife: 9,
  trailFade: 0.4,
  trailRadius: 1.25,
  slowMultiplier: 0.5,
  modelId: 'river_surge',
  /** The model's footprint radius (128.8 × 100 m). */
  modelSize: 1.288,
};

/** Hurricane: Leaf Blower behaviour; spins its `bands`, then a wind cone that blasts the Bunny away and soaks it. */
export const HURRICANE: AirConeTuning = {
  size: 2.4,
  /** Model 0.39 tall × 2.4 / 2.92. */
  height: 0.32,
  mass: 3.5,
  damage: 1,
  knockbackCm: 3,
  knockbackRadii: 2,
  shedFraction: 0,
  speed: continentTiers(2, 2.8),
  turnRate: 0.6,
  coneHalfAngle: 0.5,
  coneRange: 14,
  /** Push speed at the eyewall: faster than the Bunny can roll into it. */
  suctionStrength: 1.2,
  warmup: 1.1,
  on: 2,
  off: 2.6,
  mode: 'blow',
  blowDebrisSize: 0.45,
  debrisSpeed: 11,
  /** The wind leaves the eyewall at model (0, 0.2, 0.6): 0.6 / 2.92 of the footprint radius. */
  nozzleOffset: 0.2,
  modelId: 'hurricane',
  /** The model's footprint radius (292 × 100 m). */
  modelSize: 2.92,
  wetSeconds: 1.5,
  wetMultiplier: 0.6,
  spinNode: 'bands',
  spinRate: 1.5,
};

/**
 * The Ice Sheet's bulldozing front: while it moves (hunting or charging), a Bunny whose near edge
 * is within `reach` of the front cliff, and whose centre is within `halfWidth` (+ half its radius)
 * of the centre line, is pushed away at `strength` × its max speed (`applyPush`); loose Debris up
 * to `debrisSize` (world units) in that band is shoved ahead of the cliff. `front`, `halfWidth` and
 * `reach` are model units at full size (Continent units at model scale 1), scaled with the model
 * and its chips.
 */
export interface BulldozeTuning {
  /** Front cliff distance ahead of the centre (the model is 4.02 deep). */
  front: number;
  /** Half the slab's width (the model is 6 wide). */
  halfWidth: number;
  reach: number;
  strength: number;
  debrisSize: number;
}

/**
 * Icebergs calving off the Ice Sheet (Debris type `calved_iceberg`, src/data/iceSheetDebris.ts):
 * every `summonInterval` s while it hunts, `summonCount` break off a front corner (the `calving_l`
 * / `calving_r` node hides for `regrow` s); a mountain crash calves both corners; a chip scatters
 * `chipPieces` icebergs. A calved iceberg is `sizeRadii` × the Bunny's radius, within
 * [minSize, maxSize].
 */
export interface CalveTuning {
  /** `calving_r` in model units at full size (`calving_l` mirrors it on −X). */
  cornerX: number;
  cornerZ: number;
  sizeRadii: number;
  minSize: number;
  maxSize: number;
  regrow: number;
}

export interface IceSheetTuning extends BossTuning {
  bulldoze: BulldozeTuning;
  calve: CalveTuning;
}

/**
 * The Ice Sheet (continent boss, Tier 13): slow, enormous, and it pushes everything in front of it.
 * Same state machine as the other bosses (src/hazards/iceSheet.ts), but only a charge into a
 * mountain range stuns it (the coast and other obstacles just stop it), it calves absorbable
 * icebergs instead of summoning, and it has no suction: its front bulldozes. Needs Bunny radius ≈ 4
 * units at absorbRatio 0.7, ≈ 3.4 after one chip and ≈ 2.89 after two (Tier 13 starts at 3).
 * Absorbing it clears the Continent (the last built Area, so the Run is won).
 */
export const ICE_SHEET: IceSheetTuning = {
  size: 2.8,
  /** The model's footprint radius (3.1) × its scale (2.8 / 2.9). */
  contactRadius: 3,
  /** Model 0.627 tall × 2.8 / 2.9. */
  height: 0.61,
  mass: 6,
  damage: 1,
  knockbackCm: 4,
  knockbackRadii: 3,
  shedFraction: 0.05,
  introTime: 3.5,
  /** About half the Incinerator's (6): a Tier 13 Bunny (18 units/s) outruns it easily. */
  huntSpeed: 3.2,
  turnRate: 0.7,
  huntTime: [3, 5],
  chargeTrigger: 30,
  telegraph: 1.8,
  /** A surge, not a dash: the Incinerator's charge is 24. */
  chargeSpeed: 13,
  chargeDistance: 36,
  stunTime: 3.5,
  recover: 1.4,
  chipFactor: 0.85,
  chipPieces: 8,
  suctionReach: 0,
  suctionStrength: 0,
  /** Calving interval and icebergs per calving (no minis). */
  summonInterval: 9,
  summonCount: 1,
  maxMinis: 0,
  brushSpin: 0,
  onDefeat: 'openExit',
  modelId: 'ice_sheet',
  /** Scales the 6 × 4 unit model (footprint radius 3.1) to ≈ 5.8 × 3.9 at full size. */
  modelSize: 2.9,
  bulldoze: { front: 2.01, halfWidth: 3, reach: 2.5, strength: 0.6, debrisSize: 1.6 },
  calve: { cornerX: 2.32, cornerZ: 1.22, sizeRadii: 0.55, minSize: 0.6, maxSize: 2, regrow: 5 },
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
  /**
   * Spawn ring: inner = view radius + hazard size + margin; width = max(view radius, ringMin).
   * `spawnMargin`, `ringMin` and `despawnMin` are real cm (divided by the Area's unit).
   */
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

/**
 * Region director (after the city): spawn tables for Bunny Tiers 10–11, indexed from `firstTier`
 * (the Bunny arrives late in Tier 9, r ≈ 0.65–0.9 units, and uses the Tier 10 table). Region
 * Hazards are sized for a 0.65–4.5 unit Bunny.
 */
export const REGION_DIRECTOR = {
  firstTier: 10,
  /** No Hazards for this long after arriving. */
  graceSeconds: 10,
  tiers: [
    // Tier 10 (arrival, r ≈ 0.65–3): compactors, crop dusters, snowplows and barges, light at
    // first; all of them turn into food by early Tier 11.
    {
      budget: [2, 4],
      interval: [8, 6],
      types: { landfill_compactor: { weight: 1, max: 2 }, crop_duster: { weight: 1, max: 2 }, snowplow: { weight: 0.8, max: 1 }, river_barge: { weight: 0.7, max: 1 } },
    },
    // Tier 11 (r ≥ 3): Freight Trains and Water Bombers join, and the Incinerator arrives.
    {
      budget: [4, 5],
      interval: [6, 5],
      types: {
        landfill_compactor: { weight: 1.2, max: 3 },
        freight_train: { weight: 1, max: 2 },
        water_bomber: { weight: 0.9, max: 2 },
        snowplow: { weight: 0.6, max: 1 },
        river_barge: { weight: 0.5, max: 1 },
        crop_duster: { weight: 0.4, max: 1 },
      },
    },
  ] as readonly TierSpawnTable[],
};

/**
 * Continent director (after the region): spawn tables for Bunny Tiers 12–13, indexed from
 * `firstTier` (the Bunny arrives late in Tier 11 at 0.85 units, the arrival leap, and uses the
 * Tier 12 table). Continent Hazards are sized for a 0.85–4.5 unit Bunny.
 */
export const CONTINENT_DIRECTOR = {
  firstTier: 12,
  /** No Hazards for this long after arriving. */
  graceSeconds: 10,
  tiers: [
    // Tier 12 (arrival, r ≈ 0.85–3): tornadoes, volcanoes, glacier tongues and river surges.
    {
      budget: [2, 4],
      interval: [8, 6],
      types: { tornado: { weight: 1, max: 2 }, volcano: { weight: 1, max: 2 }, glacier_tongue: { weight: 0.8, max: 1 }, river_surge: { weight: 0.7, max: 1 } },
    },
    // Tier 13 (r ≥ 3): hurricanes join, and the Ice Sheet arrives.
    {
      budget: [4, 5],
      interval: [6, 5],
      types: {
        tornado: { weight: 1.2, max: 3 },
        hurricane: { weight: 0.9, max: 2 },
        glacier_tongue: { weight: 0.8, max: 2 },
        river_surge: { weight: 0.5, max: 1 },
        volcano: { weight: 0.4, max: 1 },
      },
    },
  ] as readonly TierSpawnTable[],
};

export const AREA_DIRECTORS: Record<AreaId, AreaDirector> = {
  house: { firstTier: 1, graceSeconds: DIRECTOR.graceSeconds, tiers: DIRECTOR.tiers },
  neighborhood: NEIGHBORHOOD_DIRECTOR,
  city: CITY_DIRECTOR,
  region: REGION_DIRECTOR,
  continent: CONTINENT_DIRECTOR,
};

/** Each area's boss: def id, the Bunny Tier it arrives at, and the delay after reaching it. */
export const AREA_BOSSES: Readonly<Record<AreaId, { readonly id: string; readonly tier: number; readonly arrivalDelay: number }>> = {
  house: { id: 'robovac_9000', tier: 5, arrivalDelay: 3 },
  neighborhood: { id: 'street_sweeper', tier: 7, arrivalDelay: 4 },
  city: { id: 'garbage_truck', tier: 9, arrivalDelay: 4 },
  region: { id: 'incinerator', tier: 11, arrivalDelay: 4 },
  continent: { id: 'ice_sheet', tier: 13, arrivalDelay: 4 },
};

/** Hazards the director never picks at random (bosses and their summons). */
export const DIRECTOR_EXCLUDE: readonly string[] = ['robovac_9000', 'mini_roomba', 'street_sweeper', 'mini_mower', 'garbage_truck', 'mini_scrubber', 'incinerator', 'mini_compactor', 'ice_sheet'];

export function tierValue(values: PerTier, tier: number): number {
  return values[Math.min(Math.max(Math.round(tier), 1), values.length) - 1]!;
}
