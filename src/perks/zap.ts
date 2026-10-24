/**
 * Zap's Character Perks (drafted only by Zap). Numbers: CHARACTER_PERK_EFFECTS in
 * src/data/perks.ts. TODO: effects.
 */
import { CHARACTER_PERKS } from '../data/perks';
import type { Run } from '../game/run';
import type { PerkDef } from './index';

export const ZAP_PERK_DEFS: PerkDef[] = [
  { ...CHARACTER_PERKS.emergency_discharge, apply: () => {} },
  { ...CHARACTER_PERKS.hyper_charge, apply: () => {} },
  { ...CHARACTER_PERKS.thunderstruck, apply: () => {} },
  { ...CHARACTER_PERKS.recharge_snack, apply: () => {} },
  { ...CHARACTER_PERKS.capacitor, apply: () => {} },
];

/** Installs Zap's Perk effects on a Zap Run (once). */
export function installZapPerks(_run: Run): void {}
