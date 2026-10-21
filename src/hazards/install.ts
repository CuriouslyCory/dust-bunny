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
      if (defId === 'robovac_9000') return director.spawnBoss(run, run.hazards);
      const fp = SPAWN_FOOTPRINT[defId] ?? { radius: 15, height: 20 };
      const b = run.bunny;
      const spot = director.findSpot(run, fp.radius, fp.height, b.radius + fp.radius + 20, b.radius + fp.radius + 120);
      return spot ? run.hazards.spawn(defId, spot.x, spot.z) : null;
    },
    spawnBoss() {
      return tools.spawnHazard('robovac_9000');
    },
    clearHazards() {
      for (const h of game.run?.hazards.hazards ?? []) h.dead = true;
    },
  };
  const g = game as Game & { debugTools?: object };
  g.debugTools = Object.assign(g.debugTools ?? {}, tools);
}
