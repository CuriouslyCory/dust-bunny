/**
 * Wires the browser side of the roguelike layer into a Game (call once at boot, after URL params
 * are applied): registers the characterSelect / perkDraft / keepsakeReveal / shop / underTheCouch screens and the
 * results "Kept" section; feeds owned Upgrades, the last Character and Difficulty and that
 * Character's last Loadout into game.nextRunConfig; opens the Perk draft modal on tierUp; awards
 * Fluff on runEnded and Keepsakes on bossDefeated; remembers a Keepsake tucked in mid-Run in the
 * Loadout; keeps the Account's saved Run in step with Run starts and ends (src/meta/accountRun.ts);
 * adds HUD widgets and the Keepsake reward moment.
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
import { registerKeepsakeRevealScreen } from '../ui/screens/keepsakeReveal';
import { registerKeptSection } from '../ui/screens/kept';
import { registerShopScreen } from '../ui/screens/shop';
import { registerUnderTheCouchScreen } from '../ui/screens/underTheCouch';
import { KeepsakeTracker, setKeepsakeTracker } from './keepsakes';
import { getMeta } from './meta';
import { abandonSavedRun } from './accountRun';
import { getSuspendedRuns } from './suspendedRun';

export function installRoguelike(game: Game): void {
  registerGameplayContent();
  registerCharacterSelectScreen();
  registerPerkDraftScreen();
  registerKeepsakeRevealScreen();
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
    const resumed = e.resumed ? run?.config.resume?.keepsakes : undefined;
    tracker.start({ seed: e.seed, characterId: e.characterId, difficulty: run?.difficulty.id, ranked: isRankedRun(game.debug, run?.config) }, resumed);
    draftOnPlay = !!e.resumed;
    // A new Run replaces a saved one (the title asks first): it counts as quit, and the Account's
    // copy goes too (src/meta/accountRun.ts). The new Run isn't on the server until it is stored.
    if (!e.resumed) {
      game.accountRuns.newRun();
      abandonSavedRun(getSuspendedRuns(), meta, game.accountRuns);
    }
  });
  // A Run saved with a Perk draft waiting opens it again once play is on screen.
  let draftOnPlay = false;
  game.events.on('screenChanged', (e) => {
    if (e.to !== 'playing' || !draftOnPlay) return;
    draftOnPlay = false;
    openPerkDraft(game);
  });
  game.events.on('runSuspended', (e) => {
    const kept = tracker.suspend();
    if (kept) e.snapshot.keepsakes = kept;
  });
  game.events.on('cheatsUnlocked', () => tracker.unrank());
  game.events.on('bossDefeated', (e) => tracker.bossDefeated(e.defId));
  // A Keepsake tucked in mid-Run (the Keepsake reveal) stays in the remembered Loadout for the next Run.
  game.events.on('keepsakeTuckedIn', (e) => meta.setLastLoadout(e.characterId, e.loadout));
  game.events.on('runEnded', (e) => tracker.finish(e));
  // An ended Run leaves the Account's saved Run slot (only if this page still holds it there).
  game.events.on('runEnded', () => {
    if (game.run) game.accountRuns.ended(game.run.runKey);
  });
  installKeepsakeHud(game);

  // The Run queues the draft itself (run.perkDraft); this only opens the modal.
  game.events.on('tierUp', () => openPerkDraft(game));
  game.events.on('runEnded', (e) => {
    const award = meta.awardRun(e);
    game.events.emit('fluffAwarded', { amount: award.fluff, total: award.total, reason: e.reason });
  });

  installRoguelikeHud(game);
}
