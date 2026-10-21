/**
 * Wires the browser side of the roguelike layer into a Game (call once at boot, after URL params
 * are applied): registers the characterSelect / perkDraft / shop screens; feeds owned Upgrades and
 * the last Character and Difficulty into game.nextRunConfig; opens the Perk draft modal on tierUp;
 * awards Fluff on runEnded; adds HUD widgets. Pickup / Perk content and the per-Run combat hooks
 * and Pickup director are the Run assembly's job (src/game/assembly.ts).
 */
import { CHARACTERS } from '../data/characters';
import { registerGameplayContent } from '../game/assembly';
import type { Game } from '../game/game';
import { installRoguelikeHud } from '../ui/roguelikeHud';
import { registerCharacterSelectScreen } from '../ui/screens/characterSelect';
import { openPerkDraft, registerPerkDraftScreen } from '../ui/screens/perkDraft';
import { registerShopScreen } from '../ui/screens/shop';
import { getMeta } from './meta';

export function installRoguelike(game: Game): void {
  registerGameplayContent();
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

  // The Run queues the draft itself (run.perkDraft); this only opens the modal.
  game.events.on('tierUp', () => openPerkDraft(game));
  game.events.on('runEnded', (e) => {
    const award = meta.awardRun(e);
    game.events.emit('fluffAwarded', { amount: award.fluff, total: award.total, reason: e.reason });
  });

  installRoguelikeHud(game);
}
