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

/**
 * Per-Tier values for globe Hazards (Tiers 14, 15), in Globe units (1 = 1,000 km). Tiers 1–13
 * repeat the Tier 14 value: the Bunny arrives on the Globe at Tier 13 (0.85 units, the arrival
 * leap) and globe Hazards live only there.
 */
export function globeTiers(t14: number, t15: number): PerTier {
  return [t14, t14, t14, t14, t14, t14, t14, t14, t14, t14, t14, t14, t14, t14, t15];
}

/**
 * Per-Tier values for solar system Hazards (Tiers 16, 17), in Solar System units (1 = 0.01 AU).
 * Tiers 1–15 repeat the Tier 16 value: the Bunny arrives in the Solar System at Tier 15 (0.85
 * units, the arrival leap) and solar system Hazards live only there.
 */
export function solarTiers(t16: number, t17: number): PerTier {
  return [t16, t16, t16, t16, t16, t16, t16, t16, t16, t16, t16, t16, t16, t16, t16, t16, t17];
}

/**
 * Per-Tier values for galaxy Hazards (Tiers 18, 19), in Galaxy units (1 = 100 ly). Tiers 1–17
 * repeat the Tier 18 value: the Bunny arrives in the Galaxy at Tier 17 (0.85 units, the arrival
 * leap) and galaxy Hazards live only there.
 */
export function galaxyTiers(t18: number, t19: number): PerTier {
  return [t18, t18, t18, t18, t18, t18, t18, t18, t18, t18, t18, t18, t18, t18, t18, t18, t18, t18, t19];
}

/**
 * Per-Tier values for universe Hazards (Tiers 20, 21), in Universe units (1 = 10 Mly). Tiers 1–19
 * repeat the Tier 20 value: the Bunny arrives in the Universe at Tier 19 (0.85 units, the arrival
 * leap) and universe Hazards live only there.
 */
export function universeTiers(t20: number, t21: number): PerTier {
  return [t20, t20, t20, t20, t20, t20, t20, t20, t20, t20, t20, t20, t20, t20, t20, t20, t20, t20, t20, t20, t21];
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
  /** A pull on loose Debris too (the Black Hole); its floor shows rings flowing inward. */
  debrisPull?: DebrisPullTuning;
  /** Suction ring colour (default: the suction blue). */
  ringColor?: string;
  /**
   * Model node that pulses while it drives (the Quasar's `jets`): scale ± `pulseAmount` at
   * `pulseRate` rad/s, along Y only (`pulseAxis` 'y') or all axes.
   */
  pulseNode?: string;
  pulseAxis?: 'y' | 'all';
  pulseAmount?: number;
  pulseRate?: number;
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
  /**
   * Orbit lanes (the Space Station): if the layout has a `routes` entry of kind 'orbit' within this
   * distance of the spawn point, the lane runs along it (east–west, the route's copy nearest the
   * spawn on a map that wraps). Otherwise the lane is planned through the spawn point as usual.
   */
  orbitReach?: number;
  /**
   * Orbit rings (the Comet): if the layout has a `routes` entry of kind 'orbit' within this
   * distance of the spawn point, the Hazard rides that closed polyline one way round with no ends
   * (`ringPath`), a short lane telegraph sliding ahead of it. Otherwise the lane is planned as usual.
   */
  ringReach?: number;
  /** Model node that flutters (scale) while moving: the Comet's `tail`. */
  flutterNode?: string;
  /** Model node turned about Y at `swirlRate` rad/s all the time: the Globular Cluster's `swarm`. */
  swirlNode?: string;
  swirlRate?: number;
  /** More model nodes turned about Y all the time, each at its own rate (rad/s): the Colliding Galaxy's `galaxy_a` and `galaxy_b`. */
  swirlNodes?: ReadonlyArray<readonly [node: string, rate: number]>;
  /**
   * Filament lanes (the Colliding Galaxy): if the layout has a `routes` entry of kind 'filament'
   * passing within this distance of the spawn point, the lane runs along that filament (any
   * direction), centred on the point of it nearest the spawn, up to laneMax long and kept `size`
   * from its ends. Otherwise the lane is planned through the spawn point as usual.
   */
  filamentReach?: number;
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
  /** Waypoints anywhere within `patrolRange` of the spawn point, not only in its spawn zone (the Re-entry Burn streaks across zones). */
  roam?: boolean;
  /** Trail colour (default: the wet blue). */
  trailColor?: string;
  /**
   * A burning trail (the Re-entry Burn): every `interval` s the Bunny spends on it (outside its
   * i-frames) it sheds `shedFraction` of its volume. No damage; `slowMultiplier` still applies.
   */
  burn?: { shedFraction: number; interval: number };
  /** Trail drops are rings rather than discs (the Supernova Remnant's filaments). */
  trailRing?: boolean;
  /** Trail opacity (default 0.35 for discs, 0.5 for rings and burning trails); the Cosmic Void's dark trail is near opaque. */
  trailOpacity?: number;
  /** A faint ring of this colour round each trail drop, so a dark trail reads on a dark floor (the Cosmic Void). */
  trailRim?: string;
  /** Model node that breathes (scale, ± `pulseAmount`) while it moves: the Supernova Remnant's `shell`. */
  pulseNode?: string;
  pulseAmount?: number;
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
  /** Model node that swells by up to `pulseAmount` (scale) through the warm-up and pulses while the air is on (the Solar Flare's `loop`). */
  pulseNode?: string;
  pulseAmount?: number;
  /** Cone colours through the warm-up and while the air is on (default: amber, then the air white or suction blue), and its opacity (default 0.35). */
  warmColor?: string;
  airColor?: string;
  coneOpacity?: number;
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
  /** Pellet colour and glow (default: ash grey with an ember glow; the Orbital Sweeper fires red laser bolts). */
  color?: string;
  glow?: string;
  /** Telegraph lane colour (default: amber). */
  laneColor?: string;
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

// ── Globe Hazards (Tiers 14–15, 1 world unit = 1,000 km, Bunny radius ≈ 0.85–4.5 units) ──
// Earth from orbit: what is left to clean up is in orbit, or falling out of it. Globe units
// throughout. The Globe repeats the Continent's shape (Tiers at 1 and 3 units, arrival at 0.85,
// boss absorbable at ≈ 4), so each Hazard keeps the size and speed ratios of the Continent Hazard
// whose behaviour it reskins, with its own twist. The Blender models are authored at 1 unit =
// 10 km and loaded at scale 0.01 (public/models/manifest.json), so they arrive in Globe units:
// `modelSize` is the catalog footprint radius / 100 and heights follow the model (model top ×
// size / modelSize). Tier 14 Hazards are a threat on arrival (r 0.85) and food by early Tier 15;
// the Tier 15 Hurricane is food before the Orbital Sweeper is.

/** Debris-Field Satellite: Roomba behaviour, a dead satellite tumbling through its debris field; the field pulls; spins its `panels`. */
export const DEBRIS_SATELLITE: RoombaTuning = {
  size: 1.1,
  /** Model top (y 0.806) × 1.1 / 1.398. */
  height: 0.63,
  mass: 4,
  damage: 1,
  knockbackCm: 1.8,
  knockbackRadii: 2.5,
  speed: globeTiers(2.4, 4.2),
  /** Tumbling: frequent, wide turns (the Tornado's are 1.2–3 s, 2.2 rad). */
  turnInterval: [1, 2.6],
  turnAngle: 2.4,
  /** A little shorter and weaker than the Tornado's vortex (1.4, 0.3): a debris field, not a storm. */
  suctionReach: 1.2,
  suctionStrength: 0.26,
  modelId: 'debris_satellite',
  /** The model's footprint radius (139.8 × 10 km). */
  modelSize: 1.398,
  spinNode: 'panels',
  spinRate: 2.5,
};

/** Space Station: a lane patrol along an orbit lane; a hit knocks the Bunny off the lane and sheds mass (no sticking). */
export const SPACE_STATION: LaneTuning = {
  size: 1.9,
  /** Top of the hovering model (y 0.462) × 1.9 / 1.294. */
  height: 0.68,
  mass: 4,
  damage: 1,
  /** Faster than the Glacier Tongue (1.4, 2.4): it is in orbit. */
  speed: globeTiers(2.4, 3.8),
  laneMin: 10,
  laneMax: 40,
  endPause: 1.2,
  stickSeconds: 0,
  releaseInvulnerability: 0,
  shedFraction: 0.08,
  releaseCm: 3,
  releaseRadii: 4,
  hitPause: 1.5,
  modelId: 'space_station',
  /** The model's footprint radius (129.4 × 10 km; 2.56 × 1.38 units, truss across its course). */
  modelSize: 1.294,
  spinNode: null,
  /** Joins an orbit lane (`layout.routes`, kind 'orbit') within this distance of its spawn point. */
  orbitReach: 20,
};

/** Anti-Satellite Laser: a static turret; its `head` aims along a red lane, then fires fast, accurate laser bolts. */
export const ASAT_LASER: TurretTuning = {
  size: 1.3,
  /** Model 0.68 tall × 1.3 / 1.527. */
  height: 0.58,
  mass: 3,
  damage: 1,
  knockbackCm: 0.8,
  knockbackRadii: 0.6,
  range: globeTiers(10, 14),
  turnRate: 1.6,
  /** A longer lock than the Volcano's (1.1, 0.9): the bolts are fast, so the lane is the warning. */
  telegraph: globeTiers(1.25, 1.05),
  burst: 3,
  burstGap: 0.09,
  cooldown: globeTiers(3.4, 2.8),
  /** About twice the Volcano's bombs (7, 10), straight and narrow. */
  dropletSpeed: globeTiers(15, 20),
  dropletRadius: 0.18,
  spread: 0.03,
  /** The muzzle tip: model (0, 0.50, 1.47) × 1.3 / 1.527. */
  nozzleHeight: 0.43,
  modelId: 'asat_laser',
  /** The model's footprint radius (152.7 × 10 km). */
  modelSize: 1.527,
  aimNode: 'head',
  /** Scans the sky while the Bunny is out of range. */
  idleSpin: 0.4,
  wetSeconds: 0,
  wetMultiplier: 1,
  dropletColor: '#ff3b30',
};

/** Re-entry Burn: Mop behaviour, a capsule streaking across the map and leaving a fire trail that burns mass off the Bunny. */
export const REENTRY_BURN: MopTuning = {
  size: 1.5,
  /** Model top (y 0.475) × 1.5 / 1.373. */
  height: 0.52,
  mass: 4,
  damage: 1,
  knockbackCm: 2.2,
  knockbackRadii: 3,
  /** A little faster than the River Surge (2.2, 3.4). */
  speed: globeTiers(2.6, 3.8),
  waypoints: 4,
  patrolRange: 24,
  trailSpacing: 0.7,
  /** The fire burns out sooner than mud dries (River Surge 9 s). */
  trailLife: 6,
  trailFade: 0.5,
  trailRadius: 0.9,
  /** No slow: the trail burns instead. */
  slowMultiplier: 1,
  modelId: 'reentry_burn',
  /** The model's footprint radius (137.3 × 10 km; 0.92 × 2.43 units, capsule at +Z, plasma to −Z). */
  modelSize: 1.373,
  roam: true,
  trailColor: '#ff7a1a',
  /** 2.5 % of the Bunny's volume every 0.7 s on the trail (a Space Station hit sheds 8 %). */
  burn: { shedFraction: 0.025, interval: 0.7 },
};

/** Hurricane (seen from orbit): Leaf Blower behaviour over the oceans; spins its `spiral`, then a wind cone that blasts the Bunny away and soaks it. */
export const GLOBE_HURRICANE: AirConeTuning = {
  size: 2.4,
  /** Model top (y 0.43) × 2.4 / 3.24. */
  height: 0.32,
  mass: 3.5,
  damage: 1,
  knockbackCm: 3,
  knockbackRadii: 2,
  shedFraction: 0,
  speed: globeTiers(2, 2.8),
  turnRate: 0.6,
  coneHalfAngle: 0.5,
  coneRange: 14,
  /** Push speed at the eyewall: faster than the Bunny can roll into it. */
  suctionStrength: 1.15,
  warmup: 1.1,
  on: 2,
  off: 2.6,
  mode: 'blow',
  blowDebrisSize: 0.45,
  debrisSpeed: 11,
  /** The wind leaves the eyewall (the eye is 0.4 of the 3.24 footprint radius). */
  nozzleOffset: 0.15,
  modelId: 'globe_hurricane',
  /** The model's footprint radius (324 × 10 km). */
  modelSize: 3.24,
  wetSeconds: 1.5,
  wetMultiplier: 0.6,
  spinNode: 'spiral',
  spinRate: 1.5,
};

/** Mini sweepers (the Orbital Sweeper's Kessler swarm): Roomba behaviour, small, fast, a weak intake pull. */
export const MINI_SWEEPER: RoombaTuning = {
  ...DEBRIS_SATELLITE,
  size: 0.6,
  /** Model top (y 0.293) × 0.6 / 0.519. */
  height: 0.34,
  mass: 3,
  knockbackCm: 1.2,
  /** Faster than the mini compactors (5, 6.5 Region units/s): a swarm. */
  speed: globeTiers(5.5, 7),
  turnInterval: [0.8, 2],
  suctionReach: 0.4,
  suctionStrength: 0.1,
  modelId: 'mini_sweeper',
  /** The model's footprint radius (51.9 × 10 km). */
  modelSize: 0.519,
  /** Static model (no animated nodes). */
  spinNode: '',
  spinRate: 0,
};

/**
 * The Orbital Sweeper's capture net: while it hunts, a Bunny within `reach` of the net tip
 * (`front` ahead of its centre) and within `halfAngle` of its facing is pulled towards the tip at
 * `strength` × its max speed (fading with distance). `front` and `reach` are model units at full
 * size (Globe units at model scale 1), scaled with the model and its chips.
 */
export interface NetTuning {
  front: number;
  reach: number;
  halfAngle: number;
  strength: number;
}

/**
 * The Moon near the fight (Debris type `typeId`, src/data/globeDebris.ts). A charge that runs into
 * a Moon the Bunny can't absorb yet stuns the Orbital Sweeper (the only stun source on the Globe:
 * the map has no obstacles), and such a Moon blocks it like an obstacle. When it arrives, and
 * every `interval` s while it hunts, if no such Moon is within `range` of the Bunny, one swings
 * round: it lands `gap` beyond the Bunny's edge (between the Bunny and the Sweeper the first time,
 * then at a random bearing), at least the type's own size and `margin` × the largest size the
 * Bunny can absorb, so it stays out of reach for a while.
 */
export interface MoonTuning {
  typeId: string;
  interval: number;
  range: number;
  margin: number;
  gap: number;
}

export interface OrbitalSweeperTuning extends BossTuning {
  net: NetTuning;
  moon: MoonTuning;
}

/**
 * The Orbital Sweeper (globe boss, Tier 15): a net-and-laser cleanup satellite. Same state machine
 * as the other bosses (src/hazards/orbitalSweeper.ts): it hunts with its capture net (a pull at
 * the front only), telegraphs charges with a red lane, fires twin laser volleys (`ash`: red bolts
 * that shed mass), and summons a Kessler swarm of mini sweepers. Only a charge into the Moon stuns
 * it. Needs Bunny radius ≈ 4 units at absorbRatio 0.7, ≈ 3.4 after one chip and ≈ 2.89 after two
 * (Tier 15 starts at 3). Absorbing it clears the Globe (the last built Area, so the Run is won).
 */
export const ORBITAL_SWEEPER: OrbitalSweeperTuning = {
  size: 2.8,
  /** The bus and the net: the 2.55 footprint radius is mostly wings (5.04 wide), so ≈ 1.9 × 2.8 / 2.55. */
  contactRadius: 2.1,
  /** Model top (y 1.389) × 2.8 / 2.55. */
  height: 1.52,
  mass: 6,
  damage: 1,
  knockbackCm: 4,
  knockbackRadii: 3,
  shedFraction: 0.04,
  introTime: 3.5,
  /** Below the Incinerator's (6): a Tier 15 Bunny (18 units/s) outruns it. */
  huntSpeed: 5,
  turnRate: 1.3,
  huntTime: [3, 4.5],
  chargeTrigger: 32,
  telegraph: 1.5,
  /** Faster than the Bunny's 18 units/s at Tier 15 entry: sidestep, don't outrun. */
  chargeSpeed: 22,
  chargeDistance: 40,
  stunTime: 3.5,
  recover: 1.2,
  chipFactor: 0.85,
  chipPieces: 8,
  /** No radial suction: the net pulls at the front only (`net`). */
  suctionReach: 0,
  suctionStrength: 0,
  summonInterval: 13,
  summonCount: 3,
  maxMinis: 6,
  miniId: 'mini_sweeper',
  brushSpin: 0,
  onDefeat: 'openExit',
  modelId: 'orbital_sweeper',
  /** The model's footprint radius (255 × 10 km): ≈ 5.5 × 4.3 units at full size. */
  modelSize: 2.55,
  /** Twin laser volleys from the lenses (model z 0.84 × 2.8 / 2.55 ≈ 0.33 × size ahead of the centre). */
  ash: {
    interval: 6,
    telegraph: 1,
    count: 4,
    gap: 0.1,
    speed: 26,
    radius: 0.25,
    range: 30,
    spread: 0.04,
    damage: 1,
    knockbackCm: 1,
    knockbackRadii: 0.6,
    shedFraction: 0.03,
    originOffset: 0.33,
    color: '#ff8a80',
    glow: '#ff2a1a',
    laneColor: '#ff3b30',
  },
  /** The net tip is at model z ≈ 2.3. */
  net: { front: 2.3, reach: 3.5, halfAngle: 0.8, strength: 0.35 },
  moon: { typeId: 'moon', interval: 8, range: 26, margin: 1.25, gap: 3 },
};

// ── Solar System Hazards (Tiers 16–17, 1 world unit = 0.01 AU, Bunny radius ≈ 0.85–4.5 units) ──
// What is left to clean up in the solar system: rocks, ice and the Sun's own weather. The Solar
// System repeats the Globe's shape (Tiers at 1 and 3 units, arrival at 0.85, boss absorbable at ≈ 4),
// so each Hazard keeps the size and speed of the Globe Hazard whose behaviour it reskins, with its
// own twist. The Blender models are authored at 1 model unit = 0.0001 AU and loaded at scale 0.01,
// so they arrive in Solar System units: `modelSize` is the catalog footprint radius / 100 (the
// Comet's is about its coma, so its tail streams far behind it) and heights follow the model
// (public/models/catalog.json).
// Tier 16 Hazards are a threat on arrival (r 0.85) and food by early Tier 17; the Tier 17 Solar
// Flare is food before the Sun is.

/** Rogue Asteroid: Roomba behaviour, a tumbling rock whose gravity pulls; spins its `rock`. */
export const ROGUE_ASTEROID: RoombaTuning = {
  size: 1.1,
  /** Model top (80.4) × 1.1 / 1.096. */
  height: 0.81,
  mass: 4,
  damage: 1,
  knockbackCm: 1.8,
  knockbackRadii: 2.5,
  speed: solarTiers(2.4, 4.2),
  /** Tumbling: frequent, wide turns (the Debris-Field Satellite's). */
  turnInterval: [1, 2.6],
  turnAngle: 2.4,
  /** Its gravity reaches a little further and pulls a little harder than the satellite's debris field (1.2, 0.26). */
  suctionReach: 1.5,
  suctionStrength: 0.3,
  modelId: 'rogue_asteroid',
  /** The model's footprint radius (109.6 model units). */
  modelSize: 1.096,
  spinNode: 'rock',
  spinRate: 1.8,
};

/**
 * Comet: a lane patrol that rides the orbit ring nearest its spawn (`ringReach`) one way round,
 * with no ends, its tail streaming behind it (`flutterNode`). A hit knocks the Bunny off the ring
 * and sheds mass (no sticking). Faster than the Space Station.
 */
export const COMET: LaneTuning = {
  size: 1.6,
  /** Model top (119.8) × 2: the nucleus (centre y 60) at model scale 2. */
  height: 2.4,
  mass: 4,
  damage: 1,
  speed: solarTiers(3.2, 4.6),
  /** Straight lane when no ring is in reach (the placeholder map always has one). */
  laneMin: 10,
  laneMax: 40,
  endPause: 1.2,
  stickSeconds: 0,
  releaseInvulnerability: 0,
  shedFraction: 0.08,
  releaseCm: 3,
  releaseRadii: 4,
  hitPause: 1.2,
  modelId: 'comet',
  /**
   * About the coma's radius (the nucleus is 60 model units), not the 383.8 footprint (the tail):
   * model scale 2, so the nucleus is 1.2 across the 1.6 contact disc and the tails stream 7.5 behind.
   */
  modelSize: 0.8,
  spinNode: null,
  ringReach: 20,
  flutterNode: 'tail',
};

/** Sunspot: a turret whose flux-tube `head` sweeps like a pulsar beam, locks a lane, then fires a pulsed burst of flare bolts. */
export const SUNSPOT: TurretTuning = {
  size: 1.3,
  /** Model 77.4 tall × 1.3 / 1.359. */
  height: 0.74,
  mass: 3,
  damage: 1,
  knockbackCm: 0.8,
  knockbackRadii: 0.6,
  range: solarTiers(10, 14),
  turnRate: 1.6,
  telegraph: solarTiers(1.2, 1),
  /** Pulses: three bolts, further apart than the laser's (0.09). */
  burst: 3,
  burstGap: 0.16,
  /** A little slower to reload and fire than the laser (3.4 / 2.8 s, 15 / 20 units/s): it sweeps the inner orbits, where the Bunny spends Tier 16. */
  cooldown: solarTiers(3.8, 3),
  dropletSpeed: solarTiers(13, 18),
  dropletRadius: 0.22,
  spread: 0.03,
  /** The emitter's muzzle: model (0, 39, 77.3) × 1.3 / 1.359. */
  nozzleHeight: 0.37,
  modelId: 'sunspot',
  /** The model's footprint radius (135.9 model units). */
  modelSize: 1.359,
  aimNode: 'head',
  /** The pulsar sweep while the Bunny is out of range (the laser's scan is 0.4). */
  idleSpin: 0.9,
  wetSeconds: 0,
  wetMultiplier: 1,
  dropletColor: '#ffb347',
};

/** Sungrazer: Mop behaviour, a comet diving past the Sun across zones; its icy tail trail slows. */
export const SUNGRAZER: MopTuning = {
  size: 1.5,
  /** Model 51 tall × 1.5 / 1.521. */
  height: 0.5,
  mass: 4,
  damage: 1,
  knockbackCm: 2.2,
  knockbackRadii: 3,
  speed: solarTiers(2.8, 4),
  waypoints: 4,
  patrolRange: 24,
  trailSpacing: 0.7,
  trailLife: 7,
  trailFade: 0.5,
  /** A wide tail: wider than the Re-entry Burn's fire. */
  trailRadius: 1,
  slowMultiplier: 0.55,
  modelId: 'sungrazer',
  /** The model's footprint radius (152.1 model units; head at +Z, tail to −Z). */
  modelSize: 1.521,
  roam: true,
  trailColor: '#bfe8ff',
};

/** Solar Flare: Leaf Blower behaviour, a plasma arch that flares up (`loop` spins and pulses) and blasts the Bunny away. */
export const SOLAR_FLARE: AirConeTuning = {
  size: 2.4,
  /** Model 120.7 tall × 2.4 / 2.303. */
  height: 1.26,
  mass: 3.5,
  damage: 1,
  knockbackCm: 3,
  knockbackRadii: 2,
  shedFraction: 0,
  speed: solarTiers(1.8, 2.6),
  turnRate: 0.6,
  coneHalfAngle: 0.45,
  coneRange: 15,
  /** Push speed at the arch: faster than the Bunny can roll into it (the Hurricane's 1.15). */
  suctionStrength: 1.25,
  warmup: 1.1,
  on: 1.8,
  off: 2.6,
  mode: 'blow',
  blowDebrisSize: 0.45,
  debrisSpeed: 12,
  /** The blast leaves the arch's front foot. */
  nozzleOffset: 0.3,
  modelId: 'solar_flare',
  /** The model's footprint radius (230.3 model units). */
  modelSize: 2.303,
  spinNode: 'loop',
  spinRate: 0.5,
  pulseNode: 'loop',
  pulseAmount: 0.25,
};

/**
 * The solar wind: while the Sun hunts (or recovers), a Bunny whose near edge is within `reach` of
 * its surface is pushed straight away from it at up to `strength` × its max speed (fading to 0 at
 * `reach`; `applyPush`, so an Amassing or hidden Bunny is not pushed), unless the Bunny can absorb
 * it. Loose Debris up to `debrisSize` in that ring is blown outward at up to `debrisSpeed`. World
 * units at full size, scaled with its chips.
 */
export interface SolarWindTuning {
  reach: number;
  strength: number;
  debrisSize: number;
  debrisSpeed: number;
}

/**
 * The giant planets that stop the Sun (Debris types `typeIds`). A charge that runs into one the
 * Bunny can't absorb yet (`canAbsorbDebris`, so a Jupiter still locked until Tier 17 counts) stops
 * against it and stuns the Sun (an eclipse); such a planet also blocks it while it hunts. When it
 * arrives, and every `interval` s while it hunts, if none is within `range` of the Bunny, a
 * `fallbackId` giant (the Hot Jupiter) swings round: it lands `gap` beyond the Bunny's edge (between
 * the Bunny and the Sun the first time, then at a random bearing), at least the type's own size and
 * `margin` × the largest size the Bunny can absorb.
 */
export interface GiantTuning {
  typeIds: readonly string[];
  fallbackId: string;
  interval: number;
  range: number;
  margin: number;
  gap: number;
}

export interface SunTuning extends BossTuning {
  wind: SolarWindTuning;
  giants: GiantTuning;
  /** Glow (emissive intensity) multiplier during a stun: the eclipse. */
  eclipseGlow: number;
  /** Seconds before a chipped prominence (`prominence_l` / `prominence_r`) shows again. */
  prominenceRegrow: number;
  /** Debris type its chips knock loose (default: the Sun's `prominence`, src/data/sunDebris.ts). */
  chipTypeId?: string;
}

/**
 * The Sun (solar system boss, Tier 17): the bosses' state machine (src/hazards/theSun.ts). It
 * hunts inside its solar wind (a push away from it, not when the Bunny can absorb it), telegraphs
 * coronal mass ejections as charges with a red lane, and throws flare volleys (`ash`, orange). Only
 * a charge into a giant planet the Bunny can't absorb yet stuns it (an eclipse: the glow dims and
 * the wind stops); chips are prominences (`prominence` Debris, src/data/sunDebris.ts). Needs Bunny
 * radius ≈ 4 units at absorbRatio 0.7, ≈ 3.4 after one chip and ≈ 2.89 after two (Tier 17 starts
 * at 3). Absorbing it clears the Solar System: the heliopause opens onto the Galaxy.
 */
export const THE_SUN: SunTuning = {
  size: 2.8,
  /** The photosphere (radius 270 model units) × 2.8 / 2.944; the corona fringe reaches the 294.4 footprint. */
  contactRadius: 2.6,
  /** Model 379.1 tall (the sphere squashed to 0.7 in Y) × 2.8 / 2.944. */
  height: 3.6,
  mass: 6,
  damage: 1,
  knockbackCm: 4,
  knockbackRadii: 3,
  shedFraction: 0.05,
  introTime: 3.5,
  /** The Orbital Sweeper's: a Tier 17 Bunny (18 units/s) outruns it. */
  huntSpeed: 5,
  turnRate: 1.2,
  huntTime: [3, 4.5],
  chargeTrigger: 32,
  /** A coronal mass ejection: a slightly longer wind-up than the Sweeper's 1.5. */
  telegraph: 1.6,
  chargeSpeed: 22,
  chargeDistance: 42,
  stunTime: 3.8,
  recover: 1.2,
  chipFactor: 0.85,
  chipPieces: 8,
  /** No suction: the solar wind pushes instead (`wind`). */
  suctionReach: 0,
  suctionStrength: 0,
  /** No minis. */
  summonInterval: 999,
  summonCount: 0,
  maxMinis: 0,
  brushSpin: 0,
  onDefeat: 'openExit',
  modelId: 'the_sun',
  /** The model's footprint radius (294.4 model units). */
  modelSize: 2.944,
  /** Flare volleys from the limb facing the target: fewer, slower bolts than the Sweeper's lasers. */
  ash: {
    interval: 7,
    telegraph: 1.1,
    count: 3,
    gap: 0.18,
    speed: 20,
    radius: 0.35,
    range: 28,
    spread: 0.05,
    damage: 1,
    knockbackCm: 1,
    knockbackRadii: 0.6,
    shedFraction: 0.03,
    originOffset: 0.9,
    color: '#ffd27a',
    glow: '#ff8a1a',
    laneColor: '#ff9a1a',
  },
  wind: { reach: 9, strength: 0.4, debrisSize: 0.6, debrisSpeed: 8 },
  giants: { typeIds: ['jupiter', 'saturn', 'uranus', 'neptune', 'hot_jupiter'], fallbackId: 'hot_jupiter', interval: 8, range: 26, margin: 1.25, gap: 3 },
  eclipseGlow: 0.15,
  prominenceRegrow: 8,
};

// ── Galaxy Hazards (Tiers 18–19, 1 world unit = 100 ly, Bunny radius ≈ 0.85–4.5 units) ──
// The Galaxy repeats the Solar System's shape (Tiers at 1 and 3 units, arrival at 0.85, boss
// absorbable at ≈ 4). The GLBs are authored at 1 ly per unit and loaded at scale 0.01, so they
// arrive in Galaxy units: `modelSize` is the catalog radius ÷ 100 of the part that is the Hazard's
// body (public/models/catalog.json), and heights follow the model at that scale.
// Tier 18 Hazards are a threat on arrival (r 0.85) and food by early Tier 19; the Tier 19
// Supernova is food before Sagittarius A* is.

/**
 * A wanderer's pull on loose Debris (the Black Hole): Debris up to `maxSize` within `reach` of its
 * edge drifts in at up to `speed` units/s (fading to 0 at `reach`) and spirals (`swirl` × that
 * speed sideways). With `eat`, Debris that reaches its middle is swallowed (removed).
 */
export interface DebrisPullTuning {
  reach: number;
  speed: number;
  swirl: number;
  maxSize: number;
  eat: boolean;
}

/** Black Hole: Roomba behaviour, the real vacuum: a slow drifter with a strong, long pull that also swallows loose Debris; spins its accretion `disk`. */
export const BLACK_HOLE: RoombaTuning = {
  size: 1.1,
  /** Model top (84) × 1.1 / 1.18. */
  height: 0.78,
  mass: 4,
  damage: 1,
  knockbackCm: 1.8,
  knockbackRadii: 2.5,
  /** Slower than the Rogue Asteroid (2.4 / 4.2): it drifts. */
  speed: galaxyTiers(2, 3.4),
  turnInterval: [2, 4],
  turnAngle: 1.4,
  /** Twice the Rogue Asteroid's reach (1.5) and a much harder pull (0.3), still below the Bunny's speed. */
  suctionReach: 3.2,
  suctionStrength: 0.55,
  modelId: 'black_hole',
  /** The model's footprint radius (118 model units: the accretion disc's rim). */
  modelSize: 1.18,
  spinNode: 'disk',
  spinRate: 2.4,
  debrisPull: { reach: 4, speed: 3, swirl: 0.6, maxSize: 1.2, eat: true },
};

/**
 * Globular Cluster: a lane patrol orbiting the galactic core on the orbit ring nearest its spawn
 * (the Comet's ring riding, `ringReach`), its star `swarm` turning (`swirlNode`). A hit knocks the
 * Bunny off the ring and sheds mass (no sticking).
 */
export const GLOBULAR_CLUSTER: LaneTuning = {
  ...COMET,
  size: 1.5,
  /** Model top (132.5) × 1.5 / 0.94. */
  height: 2.1,
  speed: galaxyTiers(2.8, 4.2),
  modelId: 'globular_cluster',
  /** The model's footprint radius (93.8 model units: the star swarm's outer edge). */
  modelSize: 0.94,
  spinNode: null,
  flutterNode: undefined,
  swirlNode: 'swarm',
  swirlRate: 0.8,
};

/**
 * Pulsar: a turret whose `head` turns all the time, twin lighthouse beams leaving both ways
 * (src/hazards/pulsar.ts). When the Bunny is in range and on screen, and a beam is about to sweep
 * over it, both beams light up as red lanes with an amber wedge ahead of each showing the arc they
 * will sweep (`telegraph`), then burn for `fire` s while still turning at `sweepRate`: a Bunny in
 * either beam takes a hit, knocked onward and out. Then `cooldown`. Never moves.
 */
export interface PulsarTuning {
  size: number;
  height: number;
  mass: number;
  damage: number;
  knockbackCm: number;
  knockbackRadii: number;
  /** Beam length from the centre. */
  range: PerTier;
  /** Beam width (full). */
  beamWidth: number;
  /** Turn rate of the head (rad/s) while idle, telegraphing and firing (one way round). */
  sweepRate: PerTier;
  telegraph: PerTier;
  /** Seconds the beams burn. */
  fire: number;
  cooldown: PerTier;
  /** Beam height above the floor (the star's centre) for the beam visuals and shelter checks. */
  beamHeight: number;
  modelId: HazardModelId;
  /** Hazard size the unscaled model represents (the model is scaled by size / modelSize). */
  modelSize: number;
  /** The model node that turns (the beams). */
  aimNode: string;
  beamColor: string;
}

export const PULSAR: PulsarTuning = {
  size: 1.3,
  /** Model top (95.6) × 1.3 / 0.84. */
  height: 1.48,
  mass: 3,
  damage: 1,
  knockbackCm: 1.2,
  knockbackRadii: 1,
  range: galaxyTiers(9, 12),
  beamWidth: 0.7,
  /** Beam tip speed 0.6 × 9 = 5.4 units/s at Tier 18: well below the Bunny's. */
  sweepRate: galaxyTiers(0.6, 0.7),
  telegraph: galaxyTiers(1.1, 0.95),
  fire: 1.3,
  cooldown: galaxyTiers(2.8, 2.3),
  /** The star's centre: model y 60 × 1.3 / 0.84. */
  beamHeight: 0.93,
  modelId: 'pulsar',
  /** The pulsar-wind disc's radius (84 model units); the model's beams reach 150 (2.3 units here). */
  modelSize: 0.84,
  aimNode: 'head',
  beamColor: '#9fd8ff',
};

/** Supernova Remnant: Mop behaviour, a slow filament shell drifting across zones; its glowing trail slows, its `shell` breathes. */
export const SUPERNOVA_REMNANT: MopTuning = {
  ...SUNGRAZER,
  size: 1.4,
  /** Model top (114.9) × 1.4 / 1.06. */
  height: 1.52,
  /** Slow: well below the Sungrazer's 2.8 / 4. */
  speed: galaxyTiers(1.6, 2.2),
  waypoints: 4,
  patrolRange: 22,
  trailSpacing: 0.55,
  /** The filaments linger longer than the Sungrazer's tail (7 s). */
  trailLife: 10,
  trailFade: 0.5,
  trailRadius: 1.05,
  slowMultiplier: 0.5,
  modelId: 'supernova_remnant',
  /** The model's footprint radius (106.5 model units). */
  modelSize: 1.06,
  roam: true,
  trailColor: '#d68cff',
  trailRing: true,
  pulseNode: 'shell',
  pulseAmount: 0.08,
};

/** Supernova: Leaf Blower behaviour, an overheated star whose `core` swells through the warm-up, then a shock blast pushes the Bunny and loose Debris away. */
export const SUPERNOVA: AirConeTuning = {
  ...SOLAR_FLARE,
  /** About the shock ring (r 78.3 model units) at model scale 2.3 / 0.783. */
  size: 2.3,
  /** Model top (112.6) × 2.3 / 0.783. */
  height: 3.3,
  knockbackCm: 3,
  knockbackRadii: 2,
  speed: galaxyTiers(1.6, 2.2),
  turnRate: 0.55,
  /** The model's shock tongues fan out ±30°. */
  coneHalfAngle: 0.52,
  coneRange: 14,
  /** A short, hard blast: harder than the Solar Flare's 1.25, for less time. */
  suctionStrength: 1.5,
  /** The swelling is the telegraph. */
  warmup: 1.4,
  on: 1.1,
  off: 2.8,
  mode: 'blow',
  blowDebrisSize: 1.1,
  debrisSpeed: 14,
  /** The nozzle on the star's front: model z 54 / 78.3. */
  nozzleOffset: 0.69,
  modelId: 'supernova',
  /** The shock ring's radius (78.3 model units); the shock tongues reach 240 (7.1 units here). */
  modelSize: 0.783,
  spinNode: undefined,
  spinRate: undefined,
  pulseNode: 'core',
  pulseAmount: 0.25,
};

/**
 * Sagittarius A*'s pull on loose Debris: Debris up to `maxSize` within `reach` of its edge drifts
 * in at up to `speed` units/s (fading to 0 at `reach`), spiralling (`swirl`), while it hunts,
 * telegraphs, charges or recovers. Debris that reaches its horizon (`eatRadius` × its contact
 * radius, plus a third of the Debris's size) is swallowed.
 */
export interface FeedTuning {
  reach: number;
  speed: number;
  swirl: number;
  maxSize: number;
  eatRadius: number;
}

/**
 * Indigestion: each star cluster it swallows (Debris types in `meals`, weighted) adds to its
 * fullness, which counts the meals of the last `window` s; at `threshold` it is stunned (a cluster
 * at least `bigSize` across is a whole `threshold` on its own). When it starts hunting, and every
 * `interval` s of hunting, if less than `count` meals' worth of clusters is within `range` of it,
 * `count` star clusters (`fallbackId`) land side by side between it and the Bunny (`gap` short of
 * the Bunny's edge, within half its Debris pull), at least the type's size and `margin` × the
 * largest size the Bunny can absorb (so the Bunny bumps into them rather than eating them).
 */
export interface IndigestionTuning {
  meals: Readonly<Record<string, number>>;
  threshold: number;
  window: number;
  bigSize: number;
  fallbackId: string;
  interval: number;
  count: number;
  range: number;
  margin: number;
  gap: number;
}

export interface SagittariusTuning extends BossTuning {
  feed: FeedTuning;
  clusters: IndigestionTuning;
  /** Debris type its chips knock loose (`relativistic_jet`, src/data/galaxyDebris.ts). */
  chipTypeId: string;
  /** Seconds before a chipped `jet_n` shows again. */
  jetRegrow: number;
  /**
   * The camera bend (src/fx/lensing.ts): lensing strength while it isn't pulling the Bunny
   * (`idle`) and at full pull, and how far (fraction of the gap) and how much (radians of roll)
   * the camera leans towards it at full pull.
   */
  lens: { idle: number; full: number; lean: number; roll: number };
}

/**
 * Sagittarius A* (galaxy boss, Tier 19; src/hazards/sagittariusA.ts): the bosses' state machine
 * reskinned as the biggest vacuum there is. It hunts inside a pull strong enough to bend the
 * camera, its suction drags loose Debris in and swallows it (`feed`), and two star clusters
 * swallowed within a few seconds give it indigestion: it is stunned and can be rammed
 * (`clusters`). Its charges are lunges (the map edge ends one without a stun); its volley is a
 * relativistic jet (`ash`); chips are `relativistic_jet` Debris. Needs Bunny radius 4 units at
 * absorbRatio 0.7, 3.4 after one chip and 2.89 after two (Tier 19 starts at 3). Absorbing it
 * clears the Galaxy: the intergalactic gate opens onto the Universe.
 */
export const SAGITTARIUS_A: SagittariusTuning = {
  size: 2.8,
  /** The hole (r 100 model units, 1.4 here) and the disc's bright inner ring round it. */
  contactRadius: 2.5,
  /** Model top (540.4: the north jet) × 2.8 / 2. */
  height: 7.6,
  mass: 6,
  damage: 1,
  knockbackCm: 4,
  knockbackRadii: 3,
  shedFraction: 0.05,
  introTime: 3.5,
  /** Slower than the Sun (5): its pull does the hunting. */
  huntSpeed: 4.2,
  turnRate: 1,
  huntTime: [3.5, 5],
  chargeTrigger: 24,
  telegraph: 1.6,
  chargeSpeed: 20,
  chargeDistance: 28,
  stunTime: 4.2,
  recover: 1.2,
  chipFactor: 0.85,
  chipPieces: 8,
  /** The strongest pull of any boss: half the Bunny's speed at the disc's edge, out to 12 units. */
  suctionReach: 12,
  suctionStrength: 0.5,
  /** No minis. */
  summonInterval: 999,
  summonCount: 0,
  maxMinis: 0,
  brushSpin: 0,
  onDefeat: 'openExit',
  modelId: 'sagittarius_a',
  /**
   * Drawn larger than its absorb size, as the last boss: model scale 2.8 / 2 = 1.4, so the hole is
   * 1.4 in radius and the accretion disc (r 320 model units) reaches 4.5, past the contact radius.
   */
  modelSize: 2,
  /** The jet: a tight, fast bolt train along a locked violet lane. */
  ash: {
    interval: 6.5,
    telegraph: 1.1,
    count: 4,
    gap: 0.1,
    speed: 26,
    radius: 0.4,
    range: 30,
    spread: 0.02,
    damage: 1,
    knockbackCm: 1,
    knockbackRadii: 0.6,
    shedFraction: 0.03,
    originOffset: 0.5,
    color: '#e6f4ff',
    glow: '#6fd3ff',
    laneColor: '#b48cff',
  },
  feed: { reach: 14, speed: 7, swirl: 0.5, maxSize: 8, eatRadius: 0.55 },
  clusters: {
    meals: { star_cluster: 1, open_cluster: 0.5 },
    threshold: 2,
    window: 6,
    bigSize: 4.5,
    fallbackId: 'star_cluster',
    interval: 9,
    count: 2,
    range: 22,
    margin: 1.2,
    gap: 2.5,
  },
  chipTypeId: 'relativistic_jet',
  jetRegrow: 6,
  lens: { idle: 0.4, full: 1, lean: 0.22, roll: 0.1 },
};

// ── Universe Hazards (Tiers 20–21, 1 world unit = 10 Mly, Bunny radius ≈ 0.85–4.5 units) ──
// The Universe repeats the Galaxy's shape (Tiers at 1 and 3 units, arrival at 0.85), so each
// Hazard keeps about the size of the Galaxy Hazard whose behaviour it reskins. The Blender models
// are authored at 1 unit = 100 kly and loaded at scale 0.01 (docs/models.md, Universe scale), so
// `modelSize` is a catalog radius ÷ 100. The map has no obstacles; `layout.routes` carries the
// filaments (kind 'filament'), which the Colliding Galaxy rides.

/**
 * Quasar: Roomba behaviour, a black hole feeding loudly: a drifter with the strongest Hazard pull
 * yet (reach 4, 0.6 × the Bunny's speed) that also drags loose Debris round it without eating it;
 * its `disk` spins, its `jets` pulse, and its pull ring is cyan.
 */
export const QUASAR: RoombaTuning = {
  ...BLACK_HOLE,
  size: 1.2,
  /** Model top (347: the north jet) × 1.2 / 1.22. */
  height: 3.4,
  speed: universeTiers(2.2, 3.6),
  turnInterval: [2, 4],
  turnAngle: 1.4,
  /** The Black Hole's reach (3.2) and pull (0.55), a notch harder. */
  suctionReach: 4,
  suctionStrength: 0.6,
  modelId: 'quasar',
  /** The accretion disc's rim (122 model units). */
  modelSize: 1.22,
  spinNode: 'disk',
  spinRate: 2.8,
  debrisPull: { reach: 5, speed: 3.5, swirl: 0.7, maxSize: 1.4, eat: false },
  ringColor: '#7fe8ff',
  pulseNode: 'jets',
  pulseAxis: 'y',
  pulseAmount: 0.18,
  pulseRate: 9,
};

/**
 * Colliding Galaxy: a lane patrol, two galaxies mid-merger on a collision course along the
 * filament nearest its spawn (`filamentReach`; a planned lane where no filament is in reach),
 * `galaxy_a` and `galaxy_b` turning opposite ways. Faster than the Globular Cluster; a hit knocks
 * the Bunny off the lane and sheds 8 % (no sticking).
 */
export const COLLIDING_GALAXY: LaneTuning = {
  ...GLOBULAR_CLUSTER,
  size: 1.5,
  /** Flat: model top (21) × 1.5 / 1.2. */
  height: 0.3,
  speed: universeTiers(3.4, 4.8),
  laneMin: 16,
  laneMax: 60,
  endPause: 0.8,
  ringReach: undefined,
  filamentReach: 30,
  modelId: 'colliding_galaxy',
  /** The merging pair's radius (about 120 model units; the tidal tails trail 190 behind). */
  modelSize: 1.2,
  spinNode: null,
  swirlNode: undefined,
  swirlRate: undefined,
  swirlNodes: [
    ['galaxy_a', 0.9],
    ['galaxy_b', -1.1],
  ],
};

/**
 * Gamma-ray burst: a still turret (src/hazards/gammaRayBurst.ts). Its `head` (the collapsing star
 * and its nozzle) tracks the target, sweeping slowly while nothing is in range. When the target is
 * in range and lined up and the burst is on screen, the aim locks: a thin violet lane runs from
 * the muzzle to the end of its range and blinks faster for `telegraph` s while the star swells.
 * Then the burst: a narrow white beam shoots along the locked lane at `beamSpeed` (it crosses the
 * whole range in about a quarter second) and stays lit for `fire` s: one hit per burst (damage,
 * knockback sideways off the lane, sheds `shedFraction`). Then `cooldown`. Dodge by stepping off
 * the lane during the telegraph.
 */
export interface BurstTuning {
  size: number;
  height: number;
  mass: number;
  damage: number;
  knockbackCm: number;
  knockbackRadii: number;
  shedFraction: number;
  /** Beam length from the muzzle. */
  range: PerTier;
  /** Beam width (full). */
  beamWidth: number;
  /** Aim turn rate (rad/s) while tracking; `idleSpin` (rad/s) sweeps while nothing is in range. */
  turnRate: number;
  idleSpin: number;
  telegraph: PerTier;
  /** Speed of the beam's front (units/s). */
  beamSpeed: number;
  /** Seconds the beam stays lit once it has reached full length. */
  fire: number;
  cooldown: PerTier;
  /** Muzzle distance from the centre and beam height above the floor (the model's beam tip, scaled). */
  muzzle: number;
  beamHeight: number;
  modelId: HazardModelId;
  /** Hazard size the unscaled model represents (the model is scaled by size / modelSize). */
  modelSize: number;
  /** The model node that aims (the star and its nozzle). */
  aimNode: string;
  beamColor: string;
  laneColor: string;
}

export const GAMMA_RAY_BURST: BurstTuning = {
  size: 1.3,
  /** Model top (81.7) × 1.3 / 0.86. */
  height: 1.24,
  mass: 3,
  damage: 1,
  knockbackCm: 1.5,
  knockbackRadii: 1.4,
  shedFraction: 0.03,
  /** Long: past the Pulsar's 9 / 12 and the Sunspot's bolts. */
  range: universeTiers(28, 36),
  beamWidth: 0.9,
  turnRate: 1.1,
  idleSpin: 0.45,
  telegraph: universeTiers(1.3, 1.1),
  beamSpeed: 140,
  fire: 0.35,
  cooldown: universeTiers(4.2, 3.4),
  /** The beam tip (model z 160) × 1.3 / 0.86. */
  muzzle: 2.4,
  /** Model y 58 × 1.3 / 0.86. */
  beamHeight: 0.88,
  modelId: 'gamma_ray_burst',
  /** The ejecta disc's radius (86 model units). */
  modelSize: 0.86,
  aimNode: 'head',
  beamColor: '#f2f8ff',
  laneColor: '#e0b8ff',
};

/** Cosmic Void: Mop behaviour, an empty bubble drifting across zones; its near-black trail swallows the floor's glow and slows (0.5 ×); its `shell` breathes. */
export const COSMIC_VOID: MopTuning = {
  ...SUPERNOVA_REMNANT,
  size: 1.4,
  /** Model top (164) × 1.4 / 1.0. */
  height: 2.3,
  speed: universeTiers(1.8, 2.4),
  waypoints: 4,
  patrolRange: 24,
  trailSpacing: 0.6,
  trailLife: 9,
  trailFade: 0.45,
  trailRadius: 1.2,
  slowMultiplier: 0.5,
  modelId: 'cosmic_void',
  /** The orange glow ring round its foot (r 100 model units). */
  modelSize: 1,
  roam: true,
  trailColor: '#020106',
  trailRing: false,
  trailOpacity: 0.85,
  trailRim: '#6a4ab8',
  pulseNode: 'shell',
  pulseAmount: 0.1,
};

/** Dark-energy gust: Leaf Blower behaviour, a knot of dark energy whose `core` swells through a violet warm-up, then a cone of pure expansion blasts the Bunny and loose Debris away. */
export const DARK_ENERGY_GUST: AirConeTuning = {
  ...SUPERNOVA,
  /** The floor swirl (r 92 model units) at model scale 2.4 / 0.92. */
  size: 2.4,
  /** Model top (85.5) × 2.4 / 0.92. */
  height: 2.2,
  knockbackCm: 3,
  knockbackRadii: 2,
  speed: universeTiers(1.8, 2.4),
  turnRate: 0.5,
  /** The model's wisps fan out ±22°. */
  coneHalfAngle: 0.42,
  coneRange: 16,
  suctionStrength: 1.4,
  warmup: 1.5,
  on: 1.4,
  off: 2.8,
  mode: 'blow',
  blowDebrisSize: 1.4,
  debrisSpeed: 16,
  /** The nozzle mouth: model z 64 / 92. */
  nozzleOffset: 0.7,
  modelId: 'dark_energy_gust',
  /** The floor swirl's radius (92 model units); the wisps reach 230 (6 units here). */
  modelSize: 0.92,
  pulseNode: 'core',
  pulseAmount: 0.3,
  warmColor: '#c49cff',
  airColor: '#efe4ff',
  coneOpacity: 0.6,
};

/**
 * The Expansion (universe boss, Tier 21; src/hazards/theExpansion.ts). Not a body: a metric
 * lattice round the Bunny (the `the_expansion` model's hollow drawn at `hollow` × the Bunny's
 * radius), never touched, never absorbed by size, ignored by Abilities and Spiky Dash. Its health
 * is a tug-of-war bar, `gravity` in [0, 1]: absorbing anything pulls it up by
 * `gain` × (size / r₀)³ (r₀: the Bunny's radius when it arrived), the expansion drains it at a rate ramping from `drain[0]` to
 * `drain[1]` over `ramp` s. At 1 it collapses (`collapse`: every Debris in view rushes into the
 * Bunny, then `bossDefeated` and `run.clearArea()`, the Universe's `victory`); at 0 the Big Rip
 * (`rip`) deals 1 damage, sheds 6 %, and the bar restarts at `ripReset` after `ripGrace` s
 * without drain.
 *
 * While it is alive the Hubble flow (`hubble`) pushes every loose Debris within `reach` × the view
 * radius straight away from the Bunny at H × distance, H ramping from `rate[0]` to `rate[1]` over
 * `ramp` s, capped at `cap` × the Bunny's max speed so anything near is still catchable; updated
 * in `slices` interleaved slices. Filament strands (`strands`) drift in from just beyond the view
 * when meaningful food near the Bunny runs low, so rolling on always wins.
 */
export interface ExpansionTuning {
  /** Placement footprint (the boss arrives on a clear spot, then centres on the Bunny). */
  footprint: number;
  height: number;
  mass: number;
  modelId: HazardModelId;
  /** The model's hollow radius at scale 1 (130 model units). */
  modelHollow: number;
  /** The hollow is drawn at this × the Bunny's radius. */
  hollow: number;
  /** Seconds the lattice unfolds before the flow and the drain start. */
  introTime: number;
  /** Seconds over which H and the drain ramp from their start to their end values. */
  ramp: number;
  /**
   * The bar: `start`; absorbing adds `gain` × (size / r₀)³ to a pending pool (at most
   * `maxPending`) that flows into the bar at up to `maxRise` per s; the drain ramps from
   * `drain[0]` to `drain[1]` per s; after a Big Rip it restarts at `ripReset` with `ripGrace` s of
   * no drain.
   */
  gravity: { start: number; gain: number; maxRise: number; maxPending: number; drain: readonly [number, number]; ripReset: number; ripGrace: number };
  hubble: { rate: readonly [number, number]; reach: number; cap: number; slices: number };
  rip: { damage: number; shedFraction: number };
  collapse: { duration: number; reach: number };
  strands: {
    /** Seconds between checks (the first at the end of the intro). */
    interval: number;
    /** A check counts absorbable Debris of at least `meaningful` × the Bunny's radius within `range` × the view radius. */
    meaningful: number;
    range: number;
    /** Fewer than `want` of them (or the bar below `low`): a strand of `count` pieces lands `distance` × the view radius away. */
    want: number;
    low: number;
    count: number;
    /** Piece size range (× the largest size the Bunny can absorb). */
    size: readonly [number, number];
    distance: number;
    /** The strand drifts in at `speed` × the Bunny's max speed until it is within `stop` × the view radius. */
    speed: number;
    stop: number;
    /** Debris types used (the first one this Run has); otherwise the shed ladder's closest size. */
    types: readonly string[];
  };
}

export const THE_EXPANSION: ExpansionTuning = {
  footprint: 1.5,
  /** Model top (67.9) at the hollow's scale for a Tier 21 Bunny (≈ 3 × 3 / 1.3). */
  height: 1.6,
  mass: 6,
  modelId: 'the_expansion',
  modelHollow: 1.3,
  hollow: 3,
  introTime: 3,
  ramp: 90,
  gravity: { start: 0.3, gain: 0.09, maxRise: 0.02, maxPending: 0.35, drain: [0.005, 0.012], ripReset: 0.25, ripGrace: 3 },
  hubble: { rate: [0.05, 0.15], reach: 1, cap: 0.5, slices: 3 },
  rip: { damage: 1, shedFraction: 0.06 },
  collapse: { duration: 2.4, reach: 1.3 },
  strands: {
    interval: 2.5,
    meaningful: 0.3,
    range: 0.6,
    want: 10,
    low: 0.5,
    count: 5,
    size: [0.45, 0.8],
    distance: 1.05,
    speed: 0.45,
    stop: 0.3,
    types: ['filament_knot', 'lint_web', 'galaxy_group', 'galaxy_pair'],
  },
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

/**
 * Globe director (after the continent): spawn tables for Bunny Tiers 14–15, indexed from
 * `firstTier` (the Bunny arrives late in Tier 13 at 0.85 units, the arrival leap, and uses the
 * Tier 14 table). Globe Hazards are sized for a 0.85–4.5 unit Bunny.
 */
export const GLOBE_DIRECTOR = {
  firstTier: 14,
  /** No Hazards for this long after arriving. */
  graceSeconds: 10,
  tiers: [
    // Tier 14 (arrival, r ≈ 0.85–3): dead satellites, laser turrets, space stations and re-entry burns.
    {
      budget: [2, 4],
      interval: [8, 6],
      types: { debris_satellite: { weight: 1, max: 2 }, asat_laser: { weight: 1, max: 2 }, space_station: { weight: 0.8, max: 1 }, reentry_burn: { weight: 0.7, max: 1 } },
    },
    // Tier 15 (r ≥ 3): hurricanes join, and the Orbital Sweeper arrives.
    {
      budget: [4, 5],
      interval: [6, 5],
      types: {
        debris_satellite: { weight: 1.2, max: 3 },
        globe_hurricane: { weight: 0.9, max: 2 },
        space_station: { weight: 0.8, max: 2 },
        reentry_burn: { weight: 0.5, max: 1 },
        asat_laser: { weight: 0.4, max: 1 },
      },
    },
  ] as readonly TierSpawnTable[],
};

/**
 * Solar System director (after the globe): spawn tables for Bunny Tiers 16–17, indexed from
 * `firstTier` (the Bunny arrives late in Tier 15 at 0.85 units, the arrival leap, and uses the
 * Tier 16 table). Solar System Hazards are sized for a 0.85–4.5 unit Bunny.
 */
export const SOLAR_DIRECTOR = {
  firstTier: 16,
  /** No Hazards for this long after arriving. */
  graceSeconds: 10,
  tiers: [
    // Tier 16 (arrival, r ≈ 0.85–3): rogue asteroids, sunspots, comets and sungrazers.
    {
      budget: [2, 4],
      interval: [8, 6],
      types: { rogue_asteroid: { weight: 1, max: 2 }, sunspot: { weight: 0.8, max: 2 }, comet: { weight: 0.9, max: 1 }, sungrazer: { weight: 0.7, max: 1 } },
    },
    // Tier 17 (r ≥ 3): solar flares join, and the Sun arrives.
    {
      budget: [4, 5],
      interval: [6, 5],
      types: {
        rogue_asteroid: { weight: 1.2, max: 3 },
        solar_flare: { weight: 0.9, max: 2 },
        comet: { weight: 0.8, max: 2 },
        sungrazer: { weight: 0.5, max: 1 },
        sunspot: { weight: 0.4, max: 1 },
      },
    },
  ] as readonly TierSpawnTable[],
};

/**
 * Galaxy director (after the solar system): spawn tables for Bunny Tiers 18–19, indexed from
 * `firstTier` (the Bunny arrives late in Tier 17 at 0.85 units, the arrival leap, and uses the
 * Tier 18 table). Placeholder budgets copied from the Solar System's.
 */
export const GALAXY_DIRECTOR = {
  firstTier: 18,
  /** No Hazards for this long after arriving. */
  graceSeconds: 10,
  tiers: [
    // Tier 18 (arrival, r ≈ 0.85–3): black holes, pulsars, globular clusters and supernova remnants.
    {
      budget: [2, 4],
      interval: [8, 6],
      types: { black_hole: { weight: 1, max: 2 }, pulsar: { weight: 0.8, max: 2 }, globular_cluster: { weight: 0.9, max: 1 }, supernova_remnant: { weight: 0.7, max: 1 } },
    },
    // Tier 19 (r ≥ 3): supernovae join, and Sagittarius A* arrives.
    {
      budget: [4, 5],
      interval: [6, 5],
      types: {
        black_hole: { weight: 1.2, max: 3 },
        supernova: { weight: 0.9, max: 2 },
        globular_cluster: { weight: 0.8, max: 2 },
        supernova_remnant: { weight: 0.5, max: 1 },
        pulsar: { weight: 0.4, max: 1 },
      },
    },
  ] as readonly TierSpawnTable[],
};

/**
 * Universe director (after the galaxy): spawn tables for Bunny Tiers 20–21, indexed from
 * `firstTier` (the Bunny arrives late in Tier 19 at 0.85 units, the arrival leap, and uses the
 * Tier 20 table). Tier 21 keeps the budget near the Galaxy's: the Expansion's fight is the main
 * pressure there.
 */
export const UNIVERSE_DIRECTOR = {
  firstTier: 20,
  /** No Hazards for this long after arriving. */
  graceSeconds: 10,
  tiers: [
    // Tier 20 (arrival, r ≈ 0.85–3): quasars, gamma-ray bursts, colliding galaxies and voids.
    {
      budget: [2, 4],
      interval: [8, 6],
      types: { quasar: { weight: 1, max: 2 }, gamma_ray_burst: { weight: 0.8, max: 1 }, colliding_galaxy: { weight: 0.9, max: 2 }, cosmic_void: { weight: 0.7, max: 1 } },
    },
    // Tier 21 (r ≥ 3): dark-energy gusts join, and the Expansion arrives.
    {
      budget: [3, 4],
      interval: [7, 6],
      types: {
        quasar: { weight: 1, max: 2 },
        dark_energy_gust: { weight: 0.9, max: 1 },
        colliding_galaxy: { weight: 0.8, max: 2 },
        cosmic_void: { weight: 0.6, max: 1 },
        gamma_ray_burst: { weight: 0.6, max: 1 },
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
  globe: GLOBE_DIRECTOR,
  solar_system: SOLAR_DIRECTOR,
  galaxy: GALAXY_DIRECTOR,
  universe: UNIVERSE_DIRECTOR,
};

/** Each area's boss: def id, the Bunny Tier it arrives at, and the delay after reaching it. */
export const AREA_BOSSES: Readonly<Record<AreaId, { readonly id: string; readonly tier: number; readonly arrivalDelay: number }>> = {
  house: { id: 'robovac_9000', tier: 5, arrivalDelay: 3 },
  neighborhood: { id: 'street_sweeper', tier: 7, arrivalDelay: 4 },
  city: { id: 'garbage_truck', tier: 9, arrivalDelay: 4 },
  region: { id: 'incinerator', tier: 11, arrivalDelay: 4 },
  continent: { id: 'ice_sheet', tier: 13, arrivalDelay: 4 },
  globe: { id: 'orbital_sweeper', tier: 15, arrivalDelay: 4 },
  solar_system: { id: 'the_sun', tier: 17, arrivalDelay: 4 },
  galaxy: { id: 'sagittarius_a', tier: 19, arrivalDelay: 4 },
  universe: { id: 'the_expansion', tier: 21, arrivalDelay: 4 },
};

/** Hazards the director never picks at random (bosses and their summons). */
export const DIRECTOR_EXCLUDE: readonly string[] = ['robovac_9000', 'mini_roomba', 'street_sweeper', 'mini_mower', 'garbage_truck', 'mini_scrubber', 'incinerator', 'mini_compactor', 'ice_sheet', 'orbital_sweeper', 'mini_sweeper', 'the_sun', 'sagittarius_a', 'the_expansion'];

export function tierValue(values: PerTier, tier: number): number {
  return values[Math.min(Math.max(Math.round(tier), 1), values.length) - 1]!;
}
