/**
 * Lint's Character Perks (drafted only by Lint). Numbers: CHARACTER_PERK_EFFECTS in
 * src/data/perks.ts. TODO: effects.
 */
import { CHARACTER_PERKS } from '../data/perks';
import type { Run } from '../game/run';
import type { PerkDef } from './index';

export const LINT_PERK_DEFS: PerkDef[] = [
  { ...CHARACTER_PERKS.well_rounded, apply: () => {} },
  { ...CHARACTER_PERKS.smother, apply: () => {} },
  { ...CHARACTER_PERKS.loose_threads, apply: () => {} },
  { ...CHARACTER_PERKS.lint_trail, apply: () => {} },
  { ...CHARACTER_PERKS.unnoticed, apply: () => {} },
];

/** Installs Lint's Perk effects on a Lint Run (once). */
export function installLintPerks(_run: Run): void {}
