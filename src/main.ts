/**
 * Entry point. URL params:
 *   ?debug          debug hooks (window.__game, FPS, G/T keys) — see src/debug/debug.ts
 *   ?seed=abc       fixed Run seed (same seed => same house layout)
 *   ?character=zap  starting Character (lint | tumble | zap)
 *   ?difficulty=arcade  Difficulty (casual | arcade | hardcore; otherwise the last one picked)
 *   ?autostart      skip the title screen (and the story: no intro, no narrator)
 *   ?area=neighborhood|city|region|continent|globe|solar_system|galaxy|universe  start Runs in a later area (skips the earlier ones; debug / testing)
 *   ?account=delete opens Delete account (sign in first if needed); /delete-account redirects here
 */
import './styles.css';
import { installAudio } from './audio';
import { isDifficultyId } from './data/difficulty';
import { registerCheatsScreen } from './cheats/screen';
import { installDebug } from './debug/debug';
import { showLoading } from './fx/loading';
import { Game } from './game/game';
import { installHazards } from './hazards/install';
import { installTouchControls } from './input/touch';
import { installSavedRuns } from './meta/savedRuns';
import { installCloudSave } from './meta/cloudSave';
import { installRoguelike } from './meta/install';
import { getMeta } from './meta/meta';
import { account } from './net/account';
import { installServiceWorker } from './pwa/register';
import { installStory } from './story/install';
import { DELETE_ACCOUNT_PARAM, registerAccountScreen, type AccountParams } from './ui/account/screen';
import { installAreaHud } from './ui/areaHud';
import { installUi } from './ui/install';
import { installLeaderboardPosting } from './ui/leaderboard/posting';
import { registerLeaderboardScreen } from './ui/leaderboard/screen';
import { registerBuiltinScreens } from './ui/screens/builtin';
import { loadModelOverrides } from './world/models';
import { AREA_ORDER, type AreaId } from './world/types';

async function boot(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
  const ui = document.getElementById('ui') as HTMLElement;

  registerBuiltinScreens();
  registerCheatsScreen();
  registerLeaderboardScreen();
  registerAccountScreen();
  // Accounts load in the background; without a server everyone simply plays anonymously.
  account.consumeRedirectError();
  void account.refresh();
  const loading = showLoading(canvas.parentElement ?? document.body);
  await loadModelOverrides(8000, loading.progress);
  loading.done();
  // After the models load, so the worker's precache doesn't compete with them on a first visit.
  installServiceWorker({ debug: params.has('debug') });

  const game = new Game(canvas, ui, { debug: params.has('debug') });
  if (params.has('seed')) game.nextRunConfig.seed = params.get('seed')!;
  if (params.has('character')) game.nextRunConfig.characterId = params.get('character')!;
  const difficulty = params.get('difficulty');
  if (isDifficultyId(difficulty)) game.nextRunConfig.difficulty = difficulty;
  const area = params.get('area');
  if (area !== 'house' && AREA_ORDER.includes(area as AreaId)) game.nextRunConfig.area = area as AreaId;
  installRoguelike(game);
  installCloudSave(getMeta(), account);
  installSavedRuns(game.savedRuns, account);
  installLeaderboardPosting(game);
  installUi(game);
  installTouchControls(game);
  installAudio(game);
  if (game.debug) installDebug(game);
  installHazards(game);
  installAreaHud(game);
  installStory(game, { available: !params.has('autostart') });

  game.start('title');
  if (params.has('autostart')) game.startRun();
  else if (params.get(DELETE_ACCOUNT_PARAM.name) === DELETE_ACCOUNT_PARAM.value) game.go('account', { back: 'title', deleteAccount: true } satisfies AccountParams);
}

boot().catch((err) => {
  console.error(err);
  document.body.insertAdjacentHTML('beforeend', `<pre class="fatal">Failed to start: ${String(err)}</pre>`);
});
