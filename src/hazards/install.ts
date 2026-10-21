/**
 * Browser-side Hazard wiring: the boss HUD and (with ?debug) debugTools.spawnHazard(id) /
 * spawnBoss() / clearHazards(). Hazard content and per-Run spawning are installed headless by
 * the Run assembly (src/game/assembly.ts) before runStarted.
 */
import { getHazardDirector } from '../game/assembly';
import type { Game } from '../game/game';
import { installHazardHud } from './hud';
import type { Hazard } from './index';

export interface HazardDebugTools {
  spawnHazard(defId: string): Hazard | null;
  spawnBoss(): Hazard | null;
  clearHazards(): void;
}

export function installHazards(game: Game): void {
  installHazardHud(game);

  if (!game.debug) return;
  const tools: HazardDebugTools = {
    spawnHazard(defId) {
      const run = game.run;
      const director = run && getHazardDirector(run);
      return run && director ? director.spawnNear(run, run.hazards, defId) : null;
    },
    spawnBoss() {
      const run = game.run;
      const director = run && getHazardDirector(run);
      return run && director ? director.spawnBoss(run, run.hazards) : null;
    },
    clearHazards() {
      for (const h of game.run?.hazards.hazards ?? []) h.dead = true;
    },
  };
  const g = game as Game & { debugTools?: object };
  g.debugTools = Object.assign(g.debugTools ?? {}, tools);
}
