/**
 * Debug hooks, enabled with the `?debug` URL param:
 *   - window.__game (the Game) and window.__game.debugTools (helpers below)
 *   - FPS / Debris / draw-call readout in the HUD
 *   - G: grow ×1.25 radius · Shift+G: shrink · T: jump to next Tier · ]/[: sim speed ×2 / ÷2
 *   - N: clear the house (open the front door) and roll outside
 */
import { getTier, MAX_TIER } from '../data/tiers';
import type { Game } from '../game/game';
import { NEIGHBORHOOD } from '../world/neighborhood';
import { h } from '../ui/screens';

export interface DebugTools {
  grow(factor?: number): void;
  setRadius(r: number): void;
  nextTier(): void;
  setTimeScale(s: number): void;
  /** Simulates `seconds` immediately (no rendering). */
  advance(seconds: number): void;
  /** Opens the front door (as if the Robo-Vac 9000 was absorbed). */
  openExit(): void;
  /** Clears the house and moves the Run to the neighborhood, growing the Bunny to boss-beaten size. */
  enterNeighborhood(): void;
}

declare global {
  interface Window {
    __game?: Game & { debugTools: DebugTools };
  }
}

export function installDebug(game: Game): DebugTools {
  const tools: DebugTools = {
    grow(factor = 1.25) {
      const b = game.run?.bunny;
      if (b) b.setRadius(b.radius * factor);
    },
    setRadius(r) {
      game.run?.bunny.setRadius(r);
    },
    nextTier() {
      const run = game.run;
      if (!run || run.tier >= MAX_TIER) return;
      run.bunny.setRadius(getTier(run.tier + 1).minRadius * 1.02);
    },
    setTimeScale(s) {
      game.loop.timeScale = Math.max(0.05, Math.min(16, s));
    },
    openExit() {
      game.run?.openExit();
    },
    enterNeighborhood() {
      const run = game.run;
      if (!run) return;
      if (run.bunny.radius < NEIGHBORHOOD.debugStartRadius) run.bunny.setRadius(NEIGHBORHOOD.debugStartRadius);
      run.openExit();
      run.enterNeighborhood();
    },
    advance(seconds) {
      const run = game.run;
      if (!run) return;
      const steps = Math.round(seconds / game.loop.step);
      for (let i = 0; i < steps && !run.ended; i++) run.update(game.loop.step);
    },
  };
  window.__game = Object.assign(game, { debugTools: tools });

  window.addEventListener('keydown', (e) => {
    if (!game.simulating || e.repeat) return;
    if (e.code === 'KeyG') tools.grow(e.shiftKey ? 0.8 : 1.25);
    else if (e.code === 'KeyT') tools.nextTier();
    else if (e.code === 'KeyN') tools.enterNeighborhood();
    else if (e.code === 'BracketRight') tools.setTimeScale(game.loop.timeScale * 2);
    else if (e.code === 'BracketLeft') tools.setTimeScale(game.loop.timeScale / 2);
  });

  const el = h('div', { className: 'debug-readout' });
  game.hud.addWidget({
    id: 'debug',
    slot: 'bottom-left',
    el,
    update(g) {
      const info = g.renderer.info.render;
      const run = g.run;
      el.textContent = [
        `${g.loop.fps.toFixed(0)} fps`,
        `${info.calls} calls`,
        run ? `${run.debris.count} debris` : '',
        run ? `r ${run.bunny.radius.toFixed(2)}` : '',
        g.loop.timeScale !== 1 ? `×${g.loop.timeScale}` : '',
        'G grow · T tier · N outside · [ ] speed',
      ]
        .filter(Boolean)
        .join(' · ');
    },
  });
  return tools;
}
