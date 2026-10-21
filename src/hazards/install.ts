/**
 * Browser-side Hazard wiring: the boss HUD and (with ?debug) debugTools.spawnHazard(id) /
 * spawnBoss() / clearHazards(). Hazard content and per-Run spawning are installed headless by
 * the Run assembly (src/game/assembly.ts) before runStarted.
 */
import { getHazardDirector } from '../game/assembly';
import type { Game } from '../game/game';
import { hazardFloorFree } from './common';
import { SPAWN_FOOTPRINT } from './director';
import { installHazardHud } from './hud';
import { hazardRegistry, type Hazard } from './index';

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
      if (!run || !director || !hazardRegistry.has(defId)) return null;
      if (hazardRegistry.get(defId)?.boss) return director.spawnBoss(run, run.hazards);
      const fp = SPAWN_FOOTPRINT[defId] ?? { radius: 15, height: 20 };
      const b = run.bunny;
      // Near the Bunny and in view (director spawns must be off screen; debug ones should be seen).
      const inner = b.radius + fp.radius + 20;
      let spot: { x: number; z: number } | null = null;
      for (let i = 0; i < 48 && !spot; i++) {
        const a = (i / 48) * Math.PI * 2 * 7;
        const d = inner + (i % 4) * Math.max(40, fp.radius);
        const x = b.x + Math.cos(a) * d;
        const z = b.z + Math.sin(a) * d;
        if (hazardFloorFree(run.house, x, z, fp.radius, fp.height)) spot = { x, z };
      }
      spot ??= director.findSpot(run, fp.radius, fp.height, inner, inner + 100);
      return spot ? run.hazards.spawn(defId, spot.x, spot.z) : null;
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
