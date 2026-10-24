/**
 * Applies Settings to the running Game (graphics quality, reduced motion) and other
 * page-level UI behaviour. Called once from main.ts after the Game exists.
 */
import { installPerfWatchdog } from '../fx/perfWatchdog';
import { getQuality, onQualityChange, setQuality } from '../fx/quality';
import type { Game } from '../game/game';
import { getMeta } from '../meta/meta';
import { installSaveNotice } from './saveNotice';
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
  // `?quality=low|high` overrides the saved setting for this page load (not persisted).
  const urlQuality = new URLSearchParams(location.search).get('quality');
  const urlOverride = urlQuality === 'low' || urlQuality === 'high';
  settings.subscribe((s, prev) => {
    if (prev ? prev.quality !== s.quality : !urlOverride) applyGraphicsQuality(game, s.quality);
    root.classList.toggle('reduce-motion', s.reducedMotion);
  });
  // Effective render quality (the URL override or watchdog may differ from the saved setting).
  root.dataset.quality = getQuality();
  onQualityChange((q) => (root.dataset.quality = q));
  // Screen id on the root lets CSS react to game state (e.g. hide touch controls off-play).
  game.events.on('screenChanged', (e) => {
    root.dataset.screen = e.to;
    root.classList.toggle('in-run', !!game.run);
  });
  root.dataset.screen = game.screens.current?.id ?? '';

  // The device save is a newer build's: say that nothing here is saved until a reload.
  installSaveNotice(getMeta(), document.getElementById('ui') ?? document.body);

  // Sustained low frame rate on High during play: drop to Low once (saved; Settings can undo).
  installPerfWatchdog({
    active: () => game.simulating && getQuality() === 'high' && !document.hidden,
    onSlow: () => {
      settings.update({ quality: 'low' });
      setQuality('low');
      game.hud.toast('Graphics set to Low for smoother play', { key: 'auto-quality', tone: 'info' });
    },
  });
}
