/**
 * Entry point. URL params:
 *   ?debug          debug hooks (window.__game, FPS, G/T keys) — see src/debug/debug.ts
 *   ?seed=abc       fixed Run seed (same seed => same house layout)
 *   ?character=zap  starting Character (lint | tumble | zap)
 *   ?autostart      skip the title screen
 */
import './styles.css';
import { installDebug } from './debug/debug';
import { Game } from './game/game';
import { installRoguelike } from './meta/install';
import { registerBuiltinScreens } from './ui/screens/builtin';
import { loadModelOverrides } from './world/models';

async function boot(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
  const ui = document.getElementById('ui') as HTMLElement;

  registerBuiltinScreens();
  await loadModelOverrides();

  const game = new Game(canvas, ui, { debug: params.has('debug') });
  if (params.has('seed')) game.nextRunConfig.seed = params.get('seed')!;
  if (params.has('character')) game.nextRunConfig.characterId = params.get('character')!;
  installRoguelike(game);
  if (game.debug) installDebug(game);

  game.start('title');
  if (params.has('autostart')) game.startRun();
}

boot().catch((err) => {
  console.error(err);
  document.body.insertAdjacentHTML('beforeend', `<pre class="fatal">Failed to start: ${String(err)}</pre>`);
});
