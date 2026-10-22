/**
 * The Expansion (universe boss, Tier 21; THE_EXPANSION in src/data/hazards.ts). Placeholder (Act 9
 * groundwork): the bosses' state machine (RoboVac9000, src/hazards/robovac.ts) with no suction, no
 * volley and no minis: it hunts, charges, is stunned by a crash into the map edge and chipped while
 * stunned (chips are Universe Debris from the shed ladder), and is absorbed at r ≈ 4. Absorbing it
 * clears the Universe (`run.clearArea()`: the last Area, so `victory` and the Run ends).
 *
 * The real fight replaces this: not a chaser, it pushes every Debris outward, and a tug-of-war bar
 * (gravity vs expansion) replaces its health; the bar reaching the gravity end collapses it
 * (docs/story.md, Act 9; issue #29).
 */
import type { Rng } from '../core/rng';
import { THE_EXPANSION } from '../data/hazards';
import { hazardRegistry } from './index';
import { RoboVac9000 } from './robovac';

export const theExpansionDef = hazardRegistry.register({
  id: 'the_expansion',
  name: 'The Expansion',
  boss: true,
  // Full-size contact radius: room for the boss before it is chipped.
  footprint: { radius: THE_EXPANSION.contactRadius, height: THE_EXPANSION.height },
  mass: THE_EXPANSION.mass,
  modelId: THE_EXPANSION.modelId,
  create(_run, x, z, id, rng: Rng) {
    return new RoboVac9000(id, this, x, z, rng, THE_EXPANSION);
  },
});
