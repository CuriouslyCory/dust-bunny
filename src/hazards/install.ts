/**
 * Hazard wiring. Importing this module registers every Hazard (and its procedural model).
 *   - installRunHazards(run): spawn director + absorb effect for one Run (headless-safe).
 *   - installHazards(game): does that for every Run, adds the boss HUD, and (with ?debug)
 *     adds debugTools.spawnHazard(id) / spawnBoss() / clearHazards().
 */
import { Rng } from '../core/rng';
import type { Game } from '../game/game';
import type { Run } from '../game/run';
import './broom';
import { hazardFloorFree } from './common';
import { HazardDirector, SPAWN_FOOTPRINT } from './director';
import { HazardFx } from './fx';
import { installHazardHud } from './hud';
import { hazardRegistry, type Hazard } from './index';
import './lintRoller';
import './mop';
import './robovac';
import './roomba';
import './sprayBottle';
import './uprightVacuum';

const directors = new WeakMap<Run, HazardDirector>();

export function installRunHazards(run: Run): HazardDirector {
  const director = new HazardDirector(new Rng(`${run.config.seed}:hazard-director`));
  run.hazards.director = (dt, r, mgr) => director.update(dt, r, mgr);
  run.addSystem(new HazardFx());
  directors.set(run, director);
  return director;
}

export function getHazardDirector(run: Run): HazardDirector | undefined {
  return directors.get(run);
}

export interface HazardDebugTools {
  spawnHazard(defId: string): Hazard | null;
  spawnBoss(): Hazard | null;
  clearHazards(): void;
}

export function installHazards(game: Game): void {
  game.events.on('runStarted', () => {
    if (game.run) installRunHazards(game.run);
  });
  installHazardHud(game);

  if (!game.debug) return;
  const tools: HazardDebugTools = {
    spawnHazard(defId) {
      const run = game.run;
      const director = run && directors.get(run);
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
      const director = run && directors.get(run);
      return run && director ? director.spawnBoss(run, run.hazards) : null;
    },
    clearHazards() {
      for (const h of game.run?.hazards.hazards ?? []) h.dead = true;
    },
  };
  const g = game as Game & { debugTools?: object };
  g.debugTools = Object.assign(g.debugTools ?? {}, tools);
}
