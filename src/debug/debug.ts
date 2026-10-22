/**
 * Debug hooks, enabled with the `?debug` URL param:
 *   - window.__game (the Game) and window.__game.debugTools (helpers below)
 *   - FPS / Debris / draw-call readout in the HUD
 *   - G: grow ×1.25 radius · Shift+G: shrink · T: jump to next Tier · ]/[: sim speed ×2 / ÷2
 *   - N: clear the current area (open its exit) and roll on to the next one
 */
import type { BunnyForm } from '../entities/bunny';
import { getTier, MAX_TIER } from '../data/tiers';
import type { Game } from '../game/game';
import { areaStartRadius } from '../game/run';
import { nextArea, type AreaId } from '../world/types';
import { h } from '../ui/screens';

export interface DebugTools {
  grow(factor?: number): void;
  setRadius(r: number): void;
  nextTier(): void;
  setTimeScale(s: number): void;
  /** Simulates `seconds` immediately (no rendering). */
  advance(seconds: number): void;
  /** Opens the current area's exit (as if its boss was absorbed). */
  openExit(): void;
  /** Clears the house and moves the Run to the neighborhood, growing the Bunny to boss-beaten size. */
  enterNeighborhood(): void;
  /** Moves the Run to the city (via the neighborhood), growing the Bunny to boss-beaten size. */
  enterCity(): void;
  /** Moves the Run to the region, growing the Bunny to Garbage-Truck-beaten size. */
  enterRegion(): void;
  /** Moves the Run to the continent, growing the Bunny to Incinerator-beaten size (then the arrival leap). */
  enterContinent(): void;
  /** Moves the Run to the globe, growing the Bunny to Ice-Sheet-beaten size (then the arrival leap). */
  enterGlobe(): void;
  /** Moves the Run to the solar system, growing the Bunny to Orbital-Sweeper-beaten size (then the arrival leap). */
  enterSolarSystem(): void;
  /** Moves the Run to the galaxy, growing the Bunny to Sun-beaten size (then the arrival leap). */
  enterGalaxy(): void;
  /** Switches the Bunny's look (`black_hole`: as after Sagittarius A*), without ending the Run. */
  setBunnyForm(form: BunnyForm): void;
  /** Clears the current area and rolls on to the next one. */
  nextArea(): void;
}

declare global {
  interface Window {
    __game?: Game & { debugTools: DebugTools };
  }
}

export function installDebug(game: Game): DebugTools {
  const goTo = (area: AreaId) => {
    const run = game.run;
    if (!run) return;
    // areaStartRadius is real cm; setRadius takes the current Area's world units.
    if (run.bunny.realRadius < areaStartRadius(area)) run.bunny.setRadius(areaStartRadius(area) / run.bunny.unit);
    run.openExit();
    run.enterArea(area);
  };
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
      run.bunny.setRadius((getTier(run.tier + 1).minRadius * 1.02) / run.bunny.unit);
    },
    setTimeScale(s) {
      game.loop.timeScale = Math.max(0.05, Math.min(16, s));
    },
    openExit() {
      game.run?.openExit();
    },
    enterNeighborhood() {
      goTo('neighborhood');
    },
    enterCity() {
      goTo('city');
    },
    enterRegion() {
      goTo('region');
    },
    enterContinent() {
      goTo('continent');
    },
    enterGlobe() {
      goTo('globe');
    },
    enterSolarSystem() {
      goTo('solar_system');
    },
    enterGalaxy() {
      goTo('galaxy');
    },
    setBunnyForm(form) {
      if (game.run) game.run.bunny.form = form;
    },
    nextArea() {
      const next = game.run && nextArea(game.run.area);
      if (next) goTo(next);
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
    else if (e.code === 'KeyN') tools.nextArea();
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
        'G grow · T tier · N next area · [ ] speed',
      ]
        .filter(Boolean)
        .join(' · ');
    },
  });
  return tools;
}
