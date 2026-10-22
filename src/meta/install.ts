/**
 * Wires the browser side of the roguelike layer into a Game (call once at boot, after URL params
 * are applied): registers the characterSelect / perkDraft / shop / underTheCouch screens and the
 * results "Kept" section; feeds owned Upgrades, the last Character and Difficulty and that
 * Character's last Loadout into game.nextRunConfig; opens the Perk draft modal on tierUp; awards
 * Fluff on runEnded and Keepsakes on bossDefeated; adds HUD widgets and the Keepsake reward moment.
 * Pickup / Perk content and the per-Run combat hooks and Pickup director are the Run assembly's
 * job (src/game/assembly.ts).
 */
import { CHARACTERS, DEFAULT_CHARACTER_ID } from '../data/characters';
import { registerGameplayContent } from '../game/assembly';
import type { Game } from '../game/game';
import { installKeepsakeHud } from '../ui/keepsakeHud';
import { isRankedRun } from '../ui/leaderboard/posting';
import { installRoguelikeHud } from '../ui/roguelikeHud';
import { registerCharacterSelectScreen } from '../ui/screens/characterSelect';
import { openPerkDraft, registerPerkDraftScreen } from '../ui/screens/perkDraft';
import { registerKeptSection } from '../ui/screens/kept';
import { registerShopScreen } from '../ui/screens/shop';
import { registerUnderTheCouchScreen } from '../ui/screens/underTheCouch';
import { KeepsakeTracker, setKeepsakeTracker } from './keepsakes';
import { getMeta } from './meta';

export function installRoguelike(game: Game): void {
  registerGameplayContent();
  registerCharacterSelectScreen();
  registerPerkDraftScreen();
  registerShopScreen();
  registerUnderTheCouchScreen();
  registerKeptSection();

  const meta = getMeta();
  const last = meta.data.lastCharacterId;
  if (!game.nextRunConfig.characterId && last && CHARACTERS.some((c) => c.id === last)) {
    game.nextRunConfig.characterId = last;
  }
  game.nextRunConfig.difficulty ??= meta.data.lastDifficulty;
  // Upgrades and the Character's Loadout (repaired against its Hoard after Felting or shedding).
  const syncUpgrades = () => {
    game.nextRunConfig.modifiers = meta.runModifiers();
    game.nextRunConfig.loadout = meta.lastLoadout(game.nextRunConfig.characterId ?? DEFAULT_CHARACTER_ID);
  };
  syncUpgrades();
  meta.store.onChange(syncUpgrades);

  // Keepsakes: credited to the played Character on bossDefeated (never in unranked Runs).
  const tracker = new KeepsakeTracker(meta, (e) => game.events.emit('keepsakesDropped', e));
  setKeepsakeTracker(tracker);
  game.events.on('runStarted', (e) => {
    const run = game.run;
    tracker.start({ seed: e.seed, characterId: e.characterId, difficulty: run?.difficulty.id, ranked: isRankedRun(game.debug, run?.config) });
  });
  game.events.on('bossDefeated', (e) => tracker.bossDefeated(e.defId));
  game.events.on('runEnded', (e) => tracker.finish(e));
  installKeepsakeHud(game);

  // The Run queues the draft itself (run.perkDraft); this only opens the modal.
  game.events.on('tierUp', () => openPerkDraft(game));
  game.events.on('runEnded', (e) => {
    const award = meta.awardRun(e);
    game.events.emit('fluffAwarded', { amount: award.fluff, total: award.total, reason: e.reason });
  });

  installRoguelikeHud(game);
}
