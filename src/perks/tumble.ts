/**
 * Tumble's Character Perks (drafted only by Tumble). Numbers: CHARACTER_PERK_EFFECTS in
 * src/data/perks.ts. TODO: effects.
 */
import { CHARACTER_PERKS } from '../data/perks';
import type { Run } from '../game/run';
import type { PerkDef } from './index';

export const TUMBLE_PERK_DEFS: PerkDef[] = [
  { ...CHARACTER_PERKS.snowballing, apply: () => {} },
  { ...CHARACTER_PERKS.matted_coat, apply: () => {} },
  { ...CHARACTER_PERKS.shedding, apply: () => {} },
  { ...CHARACTER_PERKS.heavy_pull, apply: () => {} },
  { ...CHARACTER_PERKS.heavy_landing, apply: () => {} },
];

/** Installs Tumble's Perk effects on a Tumble Run (once). */
export function installTumblePerks(_run: Run): void {}
