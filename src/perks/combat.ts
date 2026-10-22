/**
 * Combat hooks shared by Pickups and Perks, installed once per Run (installCombatHooks):
 *
 * 1. One Bunny damage filter, evaluated in a fixed order:
 *      hiddenFromHazards (Dust Cloud) → hunkered (Hunker) → Spiky Dash while dashing → shield (Bubble Wrap)
 *      → dodgeChance (Slippery) → revives (Second Wind, lethal hits only).
 *    Blocked hits grant i-frames so continuous contact does not burn every charge at once.
 * 2. The `combat` System (order 290, before Hazards): Regrowth heals, Spiky Dash stuns
 *    (sets `hazard.stunnedFor`, calls `hazard.stun?.(s)`, emits hazardStunned) and counts
 *    stun timers down.
 *
 * Hazards must respect: damage only via bunny.damage(); skip targeting/suction while
 * bunny.hiddenFromHazards; skip movement/attacks while hazard.stunnedFor > 0.
 */
import type { Rng } from '../core/rng';
import { PERK_EFFECTS as FX } from '../data/perks';
import { TUNING } from '../data/tuning';
import type { Run } from '../game/run';
import type { System } from '../game/system';
import { HazardManager } from '../hazards';

declare module '../hazards' {
  interface Hazard {
    /** Seconds of remaining stun (Spiky Dash). Hazards should not move or attack while > 0. */
    stunnedFor?: number;
    /** Optional custom stun reaction (visual wobble etc.). */
    stun?(seconds: number): void;
  }
}

declare module '../core/events' {
  interface GameEvents {
    /** Bubble Wrap absorbed a hit. */
    shieldBlocked: { source: string };
    /** Slippery dodged a hit. */
    damageDodged: { source: string };
    /** Second Wind prevented death and restored health. */
    bunnyRevived: { source: string; health: number };
    /** Spiky Dash stunned a Hazard. */
    hazardStunned: { hazardId: number; defId: string; seconds: number };
  }
}

export const COMBAT_SYSTEM_ID = 'combat';
const REVIVE_IFRAMES = 2.5;
const SPIKY_IFRAMES = 0.5;

export class CombatSystem implements System {
  readonly id = COMBAT_SYSTEM_ID;
  readonly order = 290;
  /** Seconds accumulated towards the next Regrowth heal. */
  regrowthTimer = 0;
  private readonly dodgeRng: Rng;

  constructor(private readonly run: Run) {
    this.dodgeRng = run.rng.fork('dodge');
  }

  update(dt: number, run: Run): void {
    const b = run.bunny;
    const regrowth = run.perkStacks('regrowth');
    if (regrowth > 0) {
      this.regrowthTimer += dt;
      const interval = FX.regrowthInterval / regrowth;
      if (this.regrowthTimer >= interval) {
        this.regrowthTimer -= interval;
        b.heal(1);
      }
    }

    for (const h of run.hazards.hazards) {
      if (h.stunnedFor && h.stunnedFor > 0) h.stunnedFor = Math.max(0, h.stunnedFor - dt);
      if (!b.spikyDash || !b.dashing || h.dead || (h.stunnedFor ?? 0) > 0) continue;
      if (!HazardManager.touches(run, h)) continue;
      h.stunnedFor = FX.spikyStun;
      h.stun?.(FX.spikyStun);
      b.invulnerable = Math.max(b.invulnerable, SPIKY_IFRAMES);
      run.events.emit('hazardStunned', { hazardId: h.id, defId: h.def.id, seconds: FX.spikyStun });
    }
  }

  /** The combined damage filter (see file header). */
  filter = (amount: number, source: string): number => {
    const run = this.run;
    const b = run.bunny;
    if (b.hiddenFromHazards) return 0;
    // Hunker: a planted Tumble takes no damage (and, since damage fails, no knockback or shedding).
    if (b.hunkered) return 0;
    if (b.spikyDash && b.dashing) {
      b.invulnerable = Math.max(b.invulnerable, SPIKY_IFRAMES);
      return 0;
    }
    if (b.shield > 0) {
      b.shield--;
      b.invulnerable = TUNING.invulnerability;
      run.events.emit('shieldBlocked', { source });
      return 0;
    }
    const dodge = b.stats.get('dodgeChance');
    if (dodge > 0 && this.dodgeRng.chance(dodge)) {
      b.invulnerable = TUNING.invulnerability * 0.5;
      run.events.emit('damageDodged', { source });
      return 0;
    }
    if (amount >= b.health && b.revives > 0) {
      b.revives--;
      b.health = b.maxHealth;
      b.invulnerable = REVIVE_IFRAMES;
      run.events.emit('bunnyRevived', { source, health: b.health });
      return 0;
    }
    return amount;
  };
}

/** Installs the combat filter (first in line) and system on a Run. Idempotent. */
export function installCombatHooks(run: Run): CombatSystem {
  const existing = run.getSystem<CombatSystem>(COMBAT_SYSTEM_ID);
  if (existing) return existing;
  const sys = new CombatSystem(run);
  run.bunny.damageFilters.unshift(sys.filter);
  run.addSystem(sys);
  return sys;
}
