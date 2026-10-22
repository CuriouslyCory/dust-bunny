/**
 * Character Abilities (Lint · Decoy, Tumble · Hunker, Zap · Discharge). Headless: installed per
 * Run by the Run assembly (installGameplay → installAbilities), so they run in the browser,
 * `pnpm sim` and Vitest alike. Tunables: src/data/abilities.ts, resolved per Run in ./params.ts.
 *
 *   installAbilities(run)     adds the Ability System for the Run's Character. Idempotent.
 *   getAbilitySystem(run)     the System (params, hooks, controller, boss limit).
 *   abilityHud(run)           ring / label / ready state for the HUD widget and touch button.
 *   addAbilityParamsModifier  edit a Run's params (Keepsake effects).
 */
import type { Run } from '../game/run';
import './decoy';
import './discharge';
import './hunker';
import { AbilitySystem, getAbilitySystem } from './system';

export { abilityHud, AbilitySystem, getAbilitySystem, isBoss, type AbilityController, type AbilityHooks, type AbilityHudState } from './system';
export { addAbilityParamsModifier, baseAbilityParams, resolveAbilityParams, type AbilityParams, type AbilityParamsModifier } from './params';
export { Decoy, DecoyAbility } from './decoy';
export { HunkerAbility } from './hunker';
export { DischargeAbility } from './discharge';
export type { AbilityEndReason } from './events';

/** Installs the Run's Ability System (once). */
export function installAbilities(run: Run): AbilitySystem {
  const existing = getAbilitySystem(run);
  if (existing) return existing;
  const sys = new AbilitySystem(run);
  run.addSystem(sys);
  return sys;
}
