/**
 * Keepsake effects on the Ability numbers (pure). `applyLoadout(params, loadout)` adds a Loadout's
 * Keepsakes (two copies add together, `loadoutValue`) to an AbilityParams object, then applies the
 * floors in KEEPSAKE_FLOORS. The Run uses it through the params modifier registered in
 * ./keepsakeEffects.ts; Character select uses it for the Ability card numbers, so both agree.
 *
 * Effects that need code at runtime (Reclaim, Unmoved's stat modifiers) read their values with
 * `keepsakeTotals` and live in ./keepsakeEffects.ts. Amass reads Collapse and Feast from its params.
 */
import { KEEPSAKE_FLOORS, loadoutValue, type Loadout } from '../data/keepsakes';
import { baseAbilityParams, type AbilityParams } from './params';

/** Every Keepsake value a Loadout adds up to (0 for types it doesn't hold). */
export function keepsakeTotals(loadout: Loadout | undefined) {
  const v = loadoutValue.bind(null, loadout);
  return {
    // Lint · Decoy
    duration: v('long_strand', 'duration'),
    cooldownCut: v('quick_shed', 'cooldown'),
    clogStun: v('thick_clog', 'clogStun'),
    wanderRange: v('dinner_bell', 'wanderRange'),
    lureRange: v('dinner_bell', 'lureRange'),
    reclaimVolume: v('reclaim', 'volume'),
    // Tumble · Amass
    denseForce: v('dense_core', 'force'),
    denseCore: v('dense_core', 'core'),
    lingerHold: v('lingering_mass', 'hold'),
    collapseRadius: v('collapse', 'radius'),
    collapseStun: v('collapse', 'stun'),
    feastGrowth: v('feast', 'growth'),
    unmovedKnockback: v('unmoved', 'knockbackResistance'),
    unmovedSuction: v('unmoved', 'suction'),
    unmovedGuard: v('unmoved', 'guard'),
    // Zap · Discharge
    fillRate: v('live_wire', 'fillRate'),
    range: v('long_reach', 'range'),
    arcJumps: Math.round(v('arc', 'jumps')),
    chargedMagnet: v('static_cling', 'magnet'),
    groundingSuction: v('grounding', 'suction'),
  };
}

export type KeepsakeTotals = ReturnType<typeof keepsakeTotals>;

/** Adds a Loadout's Keepsakes to `p` (in place) and applies the floors. Returns `p`. */
export function applyLoadout(p: AbilityParams, loadout: Loadout | undefined): AbilityParams {
  if (!loadout || loadout.length === 0) return p;
  const k = keepsakeTotals(loadout);

  const d = p.decoy;
  d.duration += k.duration;
  d.cooldown = Math.max(d.duration * KEEPSAKE_FLOORS.decoyCooldownPerDuration, d.cooldown * (1 - k.cooldownCut));
  d.clogStun += k.clogStun;
  // Bosses get half of Thick Clog's bonus.
  d.bossClogStun += k.clogStun / 2;
  d.wandererLureRange += k.wanderRange;
  d.lureRangeMul *= 1 + k.lureRange;

  const a = p.amass;
  a.forceMul *= 1 + k.denseForce;
  a.coreRadius += k.denseCore;
  a.maxHold = Math.min(Math.max(a.maxHold, KEEPSAKE_FLOORS.amassMaxHold), a.maxHold + k.lingerHold);
  a.collapseRadius += k.collapseRadius;
  a.collapseStun += k.collapseStun;
  a.feastBonus += k.feastGrowth;
  a.damageReduction += k.unmovedGuard;

  const z = p.discharge;
  z.fillRate *= 1 + k.fillRate;
  z.range += k.range;
  z.extraTargets += k.arcJumps;
  z.chargedMagnetBonus += k.chargedMagnet;
  z.fullSuctionMul *= 1 - k.groundingSuction;
  return p;
}

/** The base Ability numbers with a Loadout applied (what a Run with that Loadout plays with). */
export function abilityParamsFor(loadout: Loadout | undefined): AbilityParams {
  return applyLoadout(baseAbilityParams(), loadout);
}
