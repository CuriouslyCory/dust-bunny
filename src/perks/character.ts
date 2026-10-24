/**
 * Character Perks: each Character has five Perks only its own drafts offer (`PerkDef.character`,
 * filtered by availablePerks). Their per-Run effects are installed here, after the combat hooks
 * and the Abilities (installGameplay), for the Run's Character only. They read
 * run.perkStacks(id) as they go, so a Perk taken later (or restored silently on Resume) works
 * without its own install step.
 */
import type { Run } from '../game/run';
import { installLintPerks } from './lint';
import { installTumblePerks } from './tumble';
import { installZapPerks } from './zap';

const installers: Record<string, (run: Run) => void> = {
  lint: installLintPerks,
  tumble: installTumblePerks,
  zap: installZapPerks,
};

/** Installs the Run's Character Perk effects (each installer is idempotent). */
export function installCharacterPerks(run: Run): void {
  installers[run.config.characterId]?.(run);
}
