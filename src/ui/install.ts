/**
 * Applies Settings to the running Game (graphics quality, reduced motion) and other
 * page-level UI behaviour. Called once from main.ts after the Game exists.
 */
import { setQuality } from '../fx/quality';
import type { Game } from '../game/game';
import { settings, type GraphicsQuality } from './settings';

/**
 * low: 1× pixel ratio, no shadows, lighter fur and particles. high: up to 2× pixel ratio with
 * soft shadows. Game applies renderer changes via fx/quality (fur/particles on the next Run).
 */
export function applyGraphicsQuality(_game: Game, quality: GraphicsQuality): void {
  setQuality(quality);
}

export function installUi(game: Game): void {
  const root = document.documentElement;
  settings.subscribe((s, prev) => {
    if (!prev || prev.quality !== s.quality) applyGraphicsQuality(game, s.quality);
    root.classList.toggle('reduce-motion', s.reducedMotion);
    root.dataset.quality = s.quality;
  });
  // Screen id on the root lets CSS react to game state (e.g. hide touch controls off-play).
  game.events.on('screenChanged', (e) => {
    root.dataset.screen = e.to;
    root.classList.toggle('in-run', !!game.run);
  });
  root.dataset.screen = game.screens.current?.id ?? '';
}
