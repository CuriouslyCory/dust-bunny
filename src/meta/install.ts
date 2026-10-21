/**
 * Wires the roguelike layer into a Game (call once at boot, after URL params are applied):
 * registers Pickups, Perks and the characterSelect / perkDraft / shop screens; feeds owned
 * Upgrades and the last Character and Difficulty into game.nextRunConfig; installs per-Run hooks
 * (combat filter + system, Pickup director) on runStarted; queues a Perk draft per tierUp; awards
 * Fluff on runEnded; adds HUD widgets.
 */
import { CHARACTERS } from '../data/characters';
import type { Game } from '../game/game';
import type { Run } from '../game/run';
import { installCombatHooks } from '../perks/combat';
import { registerPerks } from '../perks/perks';
import { createPickupDirector } from '../pickups/director';
import { registerPickups } from '../pickups/pickups';
import { installRoguelikeHud } from '../ui/roguelikeHud';
import { registerCharacterSelectScreen } from '../ui/screens/characterSelect';
import { queuePerkDraft, registerPerkDraftScreen, resetPerkDrafts } from '../ui/screens/perkDraft';
import { registerShopScreen } from '../ui/screens/shop';
import { getMeta } from './meta';

/** Per-Run hooks; also usable headless (tests, sim). */
export function installRunHooks(run: Run): void {
  installCombatHooks(run);
  run.pickups.director ??= createPickupDirector();
}

export function installRoguelike(game: Game): void {
  registerPickups();
  registerPerks();
  registerCharacterSelectScreen();
  registerPerkDraftScreen();
  registerShopScreen();

  const meta = getMeta();
  const last = meta.data.lastCharacterId;
  if (!game.nextRunConfig.characterId && last && CHARACTERS.some((c) => c.id === last)) {
    game.nextRunConfig.characterId = last;
  }
  game.nextRunConfig.difficulty ??= meta.data.lastDifficulty;
  const syncUpgrades = () => {
    game.nextRunConfig.modifiers = meta.runModifiers();
  };
  syncUpgrades();
  meta.store.onChange(syncUpgrades);

  game.events.on('runStarted', () => {
    resetPerkDrafts();
    if (game.run) installRunHooks(game.run);
  });
  game.events.on('tierUp', () => queuePerkDraft(game));
  game.events.on('runEnded', (e) => {
    const award = meta.awardRun(e);
    game.events.emit('fluffAwarded', { amount: award.fluff, total: award.total, reason: e.reason });
  });

  installRoguelikeHud(game);
}
