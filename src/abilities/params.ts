/**
 * Resolved per-Run Ability tunables. Every number an Ability reads comes from one AbilityParams
 * object built at install time (`resolveAbilityParams(run)`): the base values from
 * src/data/abilities.ts, then every registered modifier in order. Keepsake effects plug in as a
 * modifier (`addAbilityParamsModifier`) that reads `run.loadout` and edits these fields, so
 * changing a duration, cooldown, stun, range or rate needs no change to the Ability code.
 *
 * Ranges and sizes are in Bunny radii (r) unless noted.
 */
import { ABILITY_RULES, DECOY, DISCHARGE, HUNKER } from '../data/abilities';
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

export interface HunkerParams {
  /** Longest hold (s). */
  maxHold: number;
  /** Cooldown after release: cooldownBase + cooldownPerSecondHeld × seconds held. */
  cooldownBase: number;
  cooldownPerSecondHeld: number;
  /** Extra seconds a boss stays stunned after crashing into a planted Tumble (Dead Weight). */
  bossStunBonus: number;
  /** Magnet radius added while planted, after the cap stage (Snowball; 0 = off). */
  plantedMagnetBonus: number;
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
  /** A boss can be stunned by an Ability at most once per this many seconds. */
  bossStunInterval: number;
  decoy: DecoyParams;
  hunker: HunkerParams;
  discharge: DischargeParams;
}

/** A fresh, mutable copy of the base values (no modifiers). */
export function baseAbilityParams(): AbilityParams {
  return {
    bossStunInterval: ABILITY_RULES.bossStunInterval,
    decoy: {
      radius: DECOY.radius,
      duration: DECOY.duration,
      cooldown: DECOY.cooldown,
      clogStun: DECOY.clogStun,
      bossClogStun: DECOY.clogStun,
      lureRangeMul: 1,
      wandererLureRange: 0,
    },
    hunker: {
      maxHold: HUNKER.maxHold,
      cooldownBase: HUNKER.cooldownBase,
      cooldownPerSecondHeld: HUNKER.cooldownPerSecondHeld,
      bossStunBonus: 0,
      plantedMagnetBonus: 0,
    },
    discharge: {
      fillDistance: DISCHARGE.fillDistance,
      fillRate: 1,
      minSpeedFraction: DISCHARGE.minSpeedFraction,
      dashMultiplier: DISCHARGE.dashMultiplier,
      drainSpeedFraction: DISCHARGE.drainSpeedFraction,
      drainPerSec: DISCHARGE.drainPerSec,
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
