/**
 * Headless Run assembly: the one place a Run gets its gameplay rules. Used by Game.startRun (the
 * browser), the balance bot (scripts/sim.ts) and the gameplay integration tests. No DOM, CSS or
 * WebGL: screens, HUD and input stay in browser-owned modules (src/meta/install.ts,
 * src/hazards/install.ts, src/ui/).
 *
 *   createRun(events, config, rules?)  registers content, builds the Run and installs its rules.
 *   installGameplay(run, rules?)       installs the rules on an existing Run. Idempotent.
 *
 * Installation order (each step at most once per Run):
 *   1. Combat hooks: damage filter first in bunny.damageFilters, `combat` System (order 290).
 *   2. Hazard spawning: the seeded director (run.hazards.director) plus the absorb effect System.
 *   3. Pickup spawning: the floor Pickup director (run.pickups.director).
 *   4. The Character's Ability: the `ability` System (order 90, src/abilities).
 */
import { installAbilities } from '../abilities';
import type { EventBus } from '../core/events';
import { Rng } from '../core/rng';
import { HazardDirector } from '../hazards/director';
import { HazardFx } from '../hazards/fx';
import '../hazards/content';
import { installCharacterPerks } from '../perks/character';
import { installCombatHooks } from '../perks/combat';
import { registerPerks } from '../perks/perks';
import { createPickupDirector } from '../pickups/director';
import { registerPickups } from '../pickups/pickups';
import { Run, type RunConfig } from './run';

/** Optional gameplay rules (all on by default). Turning one off leaves that part of the Run inert. */
export interface GameplayRules {
  /** Hazard spawn director and absorb effect (false: no Hazards spawn on their own). */
  hazards?: boolean;
  /** Floor Pickup spawning (false: no Pickups spawn on their own). */
  pickups?: boolean;
  /** The Character's Ability (false: no Ability, e.g. `pnpm sim --no-ability`). */
  abilities?: boolean;
}

let contentRegistered = false;

/** Registers Pickups and Perks (Hazards register on import). Idempotent. */
export function registerGameplayContent(): void {
  if (contentRegistered) return;
  contentRegistered = true;
  registerPickups();
  registerPerks();
}

const hazardDirectors = new WeakMap<Run, HazardDirector>();

/** Creates a Run with its content registered (before starting Perks apply) and its rules installed (then restores `config.resume`). */
export function createRun(events: EventBus, config: RunConfig, rules: GameplayRules = {}): Run {
  registerGameplayContent();
  const run = new Run(events, config);
  installGameplay(run, rules);
  if (config.resume) run.restore(config.resume);
  return run;
}

/** Installs the enabled gameplay rules on a Run. Repeated calls add nothing already installed. */
export function installGameplay(run: Run, rules: GameplayRules = {}): void {
  registerGameplayContent();
  installCombatHooks(run);
  if (rules.hazards !== false && !hazardDirectors.has(run)) {
    const director = new HazardDirector(new Rng(`${run.config.seed}:hazard-director`), run.difficulty);
    run.hazards.director = (dt, r, mgr) => director.update(dt, r, mgr);
    run.addSystem(new HazardFx());
    hazardDirectors.set(run, director);
  }
  if (rules.pickups !== false) run.pickups.director ??= createPickupDirector();
  if (rules.abilities !== false) installAbilities(run);
  installCharacterPerks(run);
}

/** The Run's Hazard director, if Hazard spawning is installed. */
export function getHazardDirector(run: Run): HazardDirector | undefined {
  return hazardDirectors.get(run);
}
