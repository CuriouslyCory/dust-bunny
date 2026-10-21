/**
 * Entry point. URL params:
 *   ?debug          debug hooks (window.__game, FPS, G/T keys) — see src/debug/debug.ts
 *   ?seed=abc       fixed Run seed (same seed => same house layout)
 *   ?character=zap  starting Character (lint | tumble | zap)
 *   ?difficulty=arcade  Difficulty (casual | arcade | hardcore; otherwise the last one picked)
 *   ?autostart      skip the title screen
 *   ?area=neighborhood|city  start Runs in a later area (skips the earlier ones; debug / testing)
 */
import './styles.css';
import { installAudio } from './audio';
import { isDifficultyId } from './data/difficulty';
import { installDebug } from './debug/debug';
import { showLoading } from './fx/loading';
import { Game } from './game/game';
import { installHazards } from './hazards/install';
import { installTouchControls } from './input/touch';
import { installCloudSave } from './meta/cloudSave';
import { installRoguelike } from './meta/install';
import { getMeta } from './meta/meta';
import { account } from './net/account';
import { registerAccountScreen } from './ui/account/screen';
import { installAreaHud } from './ui/areaHud';
import { installUi } from './ui/install';
import { installLeaderboardPosting } from './ui/leaderboard/posting';
import { registerLeaderboardScreen } from './ui/leaderboard/screen';
import { registerBuiltinScreens } from './ui/screens/builtin';
import { loadModelOverrides } from './world/models';

async function boot(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
  const ui = document.getElementById('ui') as HTMLElement;

  registerBuiltinScreens();
  registerLeaderboardScreen();
  registerAccountScreen();
  // Accounts load in the background; without a server everyone simply plays anonymously.
  account.consumeRedirectError();
  void account.refresh();
  const loading = showLoading(canvas.parentElement ?? document.body);
  await loadModelOverrides(8000, loading.progress);
  loading.done();

  const game = new Game(canvas, ui, { debug: params.has('debug') });
  if (params.has('seed')) game.nextRunConfig.seed = params.get('seed')!;
  if (params.has('character')) game.nextRunConfig.characterId = params.get('character')!;
  const difficulty = params.get('difficulty');
  if (isDifficultyId(difficulty)) game.nextRunConfig.difficulty = difficulty;
  const area = params.get('area');
  if (area === 'neighborhood' || area === 'city') game.nextRunConfig.area = area;
  installRoguelike(game);
  installCloudSave(getMeta(), account);
  installLeaderboardPosting(game);
  installUi(game);
  installTouchControls(game);
  installAudio(game);
  if (game.debug) installDebug(game);
  installHazards(game);
  installAreaHud(game);

  game.start('title');
  if (params.has('autostart')) game.startRun();
}

boot().catch((err) => {
  console.error(err);
  document.body.insertAdjacentHTML('beforeend', `<pre class="fatal">Failed to start: ${String(err)}</pre>`);
});
