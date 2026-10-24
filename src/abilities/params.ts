/**
 * Resolved per-Run Ability tunables. Every number an Ability reads comes from one AbilityParams
 * object built at install time (`resolveAbilityParams(run)`): the base values from
 * src/data/abilities.ts, then every registered modifier in order. Keepsake effects plug in as a
 * modifier (`addAbilityParamsModifier`) that reads `run.loadout` and edits these fields, so
 * changing a duration, cooldown, stun, range or rate needs no change to the Ability code.
 *
 * Ranges and sizes are in Bunny radii (r) unless noted.
 */
import { AMASS, DECOY, DISCHARGE } from '../data/abilities';
import type { Run } from '../game/run';

export interface DecoyParams {
  /** Lint ball radius (r, at the moment it is shed). */
  radius: number;
  /** Seconds on the floor. */
  duration: number;
  /** Seconds of cooldown, starting when the Decoy ends. */
  cooldown: number;
  /** Clog stun for non-boss Hazards (s). */
  clogStun: number;
  /** Clog stun for bosses (s). Thick Clog gives bosses half its bonus. */
  bossClogStun: number;
  /** Multiplies every aiming Hazard's lure range (Dinner Bell: +0% → +60%). */
  lureRangeMul: number;
  /** Wanderers (Roomba family) within this many r of the Decoy home in on it (Dinner Bell; 0 = off). */
  wandererLureRange: number;
}

export interface AmassParams {
  /** Longest channel (s) (Lingering Mass). */
  maxHold: number;
  /** Cooldown after release: cooldownBase + cooldownPerSecondHeld × seconds channelled. */
  cooldownBase: number;
  cooldownPerSecondHeld: number;
  /** Max speed multiplier while channelling. */
  moveSpeedMul: number;
  /** Fraction of Hazard damage taken off while channelling (Unmoved: +0.15 per copy). */
  damageReduction: number;
  /** Suction multiplier while channelling. */
  suctionMul: number;
  /** Debris and non-boss Hazards up to pullRatio × r are pulled. */
  pullRatio: number;
  /** Non-boss Hazards up to absorbRatio × r that touch Tumble while channelling are swallowed. */
  absorbRatio: number;
  /** Pull speed at full strength (r/s) × forceMul (Dense Core). */
  pullSpeed: number;
  forceMul: number;
  /** Full-strength core radius (r from the Bunny's centre) (Dense Core adds to it). */
  coreRadius: number;
  /** Pull strength at the map's edge. */
  edgeFalloff: number;
  /** Swirl off straight inward (degrees). */
  swirlDeg: number;
  /** Seconds to full pull strength. */
  rampTime: number;
  /** Scrap a swallowed Hazard bursts into: count and size (r). */
  scrapPieces: number;
  scrapSize: number;
  /** Swallow shockwave: reach from the Bunny's surface (r) and stun (s). */
  shockwaveRadius: number;
  shockwaveStun: number;
  /** Extra parts a boss sheds (with the hit) when it crashes into the channel. */
  bossHitParts: number;
  /** Collapse detonation on release: radius from the Bunny's surface (r) and stun (s); 0 = off. */
  collapseRadius: number;
  collapseStun: number;
  /** Collapse knockback on non-boss Hazards (r) and the bosses' share of the stun. */
  collapseKnockback: number;
  collapseBossStun: number;
  /** Feast: growth multiplier bonus during the channel and feastLinger s after it (0 = off). */
  feastBonus: number;
  feastLinger: number;
}

export interface DischargeParams {
  /** Bunny radii rolled (above minSpeedFraction of max speed) to fill the Static meter. */
  fillDistance: number;
  /** Multiplies the fill rate (Live Wire: +10% → +50%). */
  fillRate: number;
  minSpeedFraction: number;
  /** Distance rolled while dashing counts this many times. */
  dashMultiplier: number;
  drainSpeedFraction: number;
  /** Fraction of the meter drained per second while slow. */
  drainPerSec: number;
  /** Seconds below drainSpeedFraction before the drain starts (Capacitor; 0 = at once). */
  drainDelay: number;
  /** Target range from the Bunny's surface (r) (Long Reach: +1 → +4). */
  range: number;
  /** Boss stun (s), then Grounded (immune to Discharge) for groundedFor seconds. */
  bossStun: number;
  groundedFor: number;
  /** Scrap a shorted-out non-boss Hazard bursts into: count and size (r). */
  scrapPieces: number;
  scrapSize: number;
  /** More non-boss Hazards the Discharge jumps to (Arc: +1..+3; 0 = off). */
  extraTargets: number;
  /** Jump range from the first target (r). */
  arcRange: number;
  /** Magnet radius added while the meter is at least half full (Static Cling; 0 = off). Capped. */
  chargedMagnetBonus: number;
  /** Suction multiplier on Zap while the meter is full (Grounding: 0.975 → 0.9; 1 = off). Capped. */
  fullSuctionMul: number;
  /** Zap's glow: glowBase + glowPerCharge × charge. */
  glowBase: number;
  glowPerCharge: number;
}

export interface AbilityParams {
  decoy: DecoyParams;
  amass: AmassParams;
  discharge: DischargeParams;
}

/** A fresh, mutable copy of the base values (no modifiers). */
export function baseAbilityParams(): AbilityParams {
  return {
    decoy: {
      radius: DECOY.radius,
      duration: DECOY.duration,
      cooldown: DECOY.cooldown,
      clogStun: DECOY.clogStun,
      bossClogStun: DECOY.clogStun,
      lureRangeMul: 1,
      wandererLureRange: 0,
    },
    amass: {
      maxHold: AMASS.maxHold,
      cooldownBase: AMASS.cooldownBase,
      cooldownPerSecondHeld: AMASS.cooldownPerSecondHeld,
      moveSpeedMul: AMASS.moveSpeedMul,
      damageReduction: AMASS.damageReduction,
      suctionMul: AMASS.suctionMul,
      pullRatio: AMASS.pullRatio,
      absorbRatio: AMASS.absorbRatio,
      pullSpeed: AMASS.pullSpeed,
      forceMul: 1,
      coreRadius: AMASS.coreRadius,
      edgeFalloff: AMASS.edgeFalloff,
      swirlDeg: AMASS.swirlDeg,
      rampTime: AMASS.rampTime,
      scrapPieces: AMASS.scrapPieces,
      scrapSize: AMASS.scrapSize,
      shockwaveRadius: AMASS.shockwaveRadius,
      shockwaveStun: AMASS.shockwaveStun,
      bossHitParts: AMASS.bossHitParts,
      collapseRadius: 0,
      collapseStun: 0,
      collapseKnockback: AMASS.collapseKnockback,
      collapseBossStun: AMASS.collapseBossStun,
      feastBonus: 0,
      feastLinger: AMASS.feastLinger,
    },
    discharge: {
      fillDistance: DISCHARGE.fillDistance,
      fillRate: 1,
      minSpeedFraction: DISCHARGE.minSpeedFraction,
      dashMultiplier: DISCHARGE.dashMultiplier,
      drainSpeedFraction: DISCHARGE.drainSpeedFraction,
      drainPerSec: DISCHARGE.drainPerSec,
      drainDelay: 0,
      range: DISCHARGE.range,
      bossStun: DISCHARGE.bossStun,
      groundedFor: DISCHARGE.groundedFor,
      scrapPieces: DISCHARGE.scrapPieces,
      scrapSize: DISCHARGE.scrapSize,
      extraTargets: 0,
      arcRange: 4,
      chargedMagnetBonus: 0,
      fullSuctionMul: 1,
      glowBase: DISCHARGE.glowBase,
      glowPerCharge: DISCHARGE.glowPerCharge,
    },
  };
}

/** Edits a Run's params in place (e.g. applies its Loadout's Keepsakes). */
export type AbilityParamsModifier = (params: AbilityParams, run: Run) => void;

const modifiers: AbilityParamsModifier[] = [];

/** Registers a params modifier for every later Run (idempotent per function). Returns an unregister callback. */
export function addAbilityParamsModifier(fn: AbilityParamsModifier): () => void {
  if (!modifiers.includes(fn)) modifiers.push(fn);
  return () => {
    const i = modifiers.indexOf(fn);
    if (i >= 0) modifiers.splice(i, 1);
  };
}

/** The Run's params: base values, then every registered modifier in registration order. */
export function resolveAbilityParams(run: Run): AbilityParams {
  const p = baseAbilityParams();
  for (const m of modifiers) m(p, run);
  return p;
}
