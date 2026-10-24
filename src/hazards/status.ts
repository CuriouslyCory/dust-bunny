/**
 * Hazard status effects and the boss Hit ledger. One instance per Run, owned by the HazardManager
 * (`run.hazards.status`); it is the only module that writes a Hazard's status timers.
 *
 * Timers (seconds, read-only fields on Hazard; 0 when the effect is off):
 *   - `stunnedFor`        Stun: no movement or attacks (`stun`, any cause).
 *   - `cloggedFor`        Clog: the Decoy's or a Lint Trail streak's (`clog`; Lint's Perks read it).
 *   - `groundedFor`       Grounded: a boss a Discharge stunned can't be Discharged again (`ground`).
 *   - `ignoresBunnyFor`   Unnoticed: the Hazard ignores the Bunny (`ignoreBunny`; see ignoresBunny).
 * A new effect on a running one never shortens it. The manager calls `tick` once per frame, before
 * any Hazard updates, so every timer counts down in any Run built with createRun, whichever
 * gameplay Systems are installed. A clog that runs out on a live Hazard emits `hazardUnclogged`.
 *
 * Boss Hit ledger (Hazards whose def is a `boss`), the same rules for every stun cause:
 *   - every accepted stun arms one Hit; `landHit` uses it up (`hittable` until then);
 *   - a landed Hit cuts the stun to HIT_STUN seconds (plus the Hit's `hold`);
 *   - Ability stuns ('decoy', 'amass', 'discharge') land at most once per
 *     ABILITY_RULES.bossStunInterval seconds per boss (`canStun`); crashes, indigestion, Spiky Dash
 *     and Perk stuns don't count and aren't limited;
 *   - every accepted boss stun emits `bossStunned` with its cause and seconds.
 * A Hazard reacts to a stun through its `onStunned(cause, seconds)` hook (a boss hides its charge
 * lane and drops its charge); the stun itself is only `stunnedFor`.
 */
import type { EventBus, GameEvents } from '../core/events';
import { ABILITY_RULES } from '../data/abilities';
import type { Hazard } from './index';
import './events';

/**
 * What stunned a Hazard: a boss's wall crash, Sagittarius A*'s indigestion, Spiky Dash, an Ability
 * (Decoy clog, Amass, Discharge, Emergency Discharge), or a Character Perk (Heavy Landing,
 * Thunderstruck, a Lint Trail clog).
 */
export type StunCause = 'wall' | 'indigestion' | 'spiky' | 'decoy' | 'amass' | 'discharge' | 'perk';

/** Stuns an Ability deals: limited on bosses to one per ABILITY_RULES.bossStunInterval seconds. */
export type AbilityStunCause = 'decoy' | 'amass' | 'discharge';

/** Seconds a boss stays stunned after a Hit lands (plus the Hit's `hold`). */
export const HIT_STUN = 0.6;

export function isAbilityCause(cause: StunCause): cause is AbilityStunCause {
  return cause === 'decoy' || cause === 'amass' || cause === 'discharge';
}

/** The writable view of a Hazard's timers (only this module uses it). */
interface Timers {
  stunnedFor?: number;
  cloggedFor?: number;
  groundedFor?: number;
  ignoresBunnyFor?: number;
}

interface BossLedger {
  /** A Hit can land during the current stun. */
  armed: boolean;
  /** Cause of the current / last stun. */
  cause: StunCause | null;
  /** run.time of the last Ability stun. */
  abilityAt: number | null;
}

const ledgers = new WeakMap<Hazard, BossLedger>();

function timers(h: Hazard): Timers {
  return h as unknown as Timers;
}

function ledger(h: Hazard): BossLedger {
  let l = ledgers.get(h);
  if (!l) ledgers.set(h, (l = { armed: false, cause: null, abilityAt: null }));
  return l;
}

/** True while the Hazard is stunned. */
export function isStunned(h: Hazard): boolean {
  return (h.stunnedFor ?? 0) > 0;
}

/** True while the Hazard is clogged. */
export function isClogged(h: Hazard): boolean {
  return (h.cloggedFor ?? 0) > 0;
}

/** True while a boss is Grounded (immune to Discharge). */
export function isGrounded(h: Hazard): boolean {
  return (h.groundedFor ?? 0) > 0;
}

/** True while ramming the boss lands a Hit: stunned, and no Hit landed in this stun yet. */
export function hittable(h: Hazard): boolean {
  return isStunned(h) && (ledgers.get(h)?.armed ?? false);
}

/** Cause of a boss's current or last stun (null if it was never stunned). */
export function stunCause(h: Hazard): StunCause | null {
  return ledgers.get(h)?.cause ?? null;
}

/** What HazardStatus needs from the Run. */
export interface StatusClock {
  readonly time: number;
  readonly events: EventBus<GameEvents>;
}

export class HazardStatus {
  constructor(private readonly run: StatusClock) {}

  /** True if `stun(h, …, cause)` would land now (only Ability stuns on a boss can be refused). */
  canStun(h: Hazard, cause: StunCause): boolean {
    if (!h.def.boss || !isAbilityCause(cause)) return true;
    const at = ledgers.get(h)?.abilityAt ?? null;
    return at === null || this.run.time - at >= ABILITY_RULES.bossStunInterval;
  }

  /**
   * Stuns a Hazard for at least `seconds` (a running stun is never shortened). On a boss it arms
   * one Hit and emits `bossStunned`. False (and nothing happens) if the boss's Ability limit refused it.
   */
  stun(h: Hazard, seconds: number, cause: StunCause): boolean {
    if (!this.canStun(h, cause)) return false;
    const t = timers(h);
    t.stunnedFor = Math.max(t.stunnedFor ?? 0, seconds);
    if (h.def.boss) {
      const l = ledger(h);
      l.armed = true;
      l.cause = cause;
      if (isAbilityCause(cause)) l.abilityAt = this.run.time;
    }
    h.onStunned?.(cause, seconds);
    if (h.def.boss) this.run.events.emit('bossStunned', { hazardId: h.id, cause, seconds });
    return true;
  }

  /** Clogs a Hazard for at least `seconds` (the caller stuns it too). */
  clog(h: Hazard, seconds: number): void {
    const t = timers(h);
    t.cloggedFor = Math.max(t.cloggedFor ?? 0, seconds);
  }

  /** Grounds a boss for at least `seconds`. */
  ground(h: Hazard, seconds: number): void {
    const t = timers(h);
    t.groundedFor = Math.max(t.groundedFor ?? 0, seconds);
  }

  /** The Hazard ignores the Bunny for at least `seconds` (Unnoticed). */
  ignoreBunny(h: Hazard, seconds: number): void {
    const t = timers(h);
    t.ignoresBunnyFor = Math.max(t.ignoresBunnyFor ?? 0, seconds);
  }

  /**
   * The Bunny rammed a boss: true if a Hit lands (it was hittable). The Hit is used up and the stun
   * cut to HIT_STUN + `hold` seconds (never lengthened).
   */
  landHit(h: Hazard, hold = 0): boolean {
    if (!hittable(h)) return false;
    ledger(h).armed = false;
    const t = timers(h);
    t.stunnedFor = Math.min(t.stunnedFor ?? 0, HIT_STUN + hold);
    return true;
  }

  /** Ends every status effect on the Hazard now, with no end effects (tests, debug). */
  clear(h: Hazard): void {
    const t = timers(h);
    if (t.stunnedFor) t.stunnedFor = 0;
    if (t.cloggedFor) t.cloggedFor = 0;
    if (t.groundedFor) t.groundedFor = 0;
    if (t.ignoresBunnyFor) t.ignoresBunnyFor = 0;
  }

  /** Counts every timer down (the HazardManager, once per frame before Hazards update). */
  tick(hazards: readonly Hazard[], dt: number): void {
    for (const h of hazards) {
      if (h.dead) continue;
      const t = timers(h);
      if (t.stunnedFor) t.stunnedFor = Math.max(0, t.stunnedFor - dt);
      if (t.groundedFor) t.groundedFor = Math.max(0, t.groundedFor - dt);
      if (t.ignoresBunnyFor) t.ignoresBunnyFor = Math.max(0, t.ignoresBunnyFor - dt);
      if (t.cloggedFor) {
        t.cloggedFor = Math.max(0, t.cloggedFor - dt);
        if (t.cloggedFor === 0) this.run.events.emit('hazardUnclogged', { hazardId: h.id, defId: h.def.id });
      }
    }
  }
}
