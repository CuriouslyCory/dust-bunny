/**
 * Sagittarius A* (galaxy boss, Tier 19; SAGITTARIUS_A in src/data/hazards.ts). Placeholder (Act 8
 * groundwork): the Sun's state machine (TheSun, src/hazards/theSun.ts) with the solar wind off and
 * strong radial suction from the bosses' base class instead. A charge into a star cluster the Bunny
 * can't absorb yet stuns it (the Sun's giant-planet stun, `giants.typeIds`: `star_cluster`,
 * `open_cluster`; a `star_cluster` swings round near the Bunny when none is); chips are relativistic
 * jets (`relativistic_jet` Debris, `chipTypeId`). Absorbing it clears the Galaxy (`run.clearArea()`:
 * the last built Area, so the Run is won).
 *
 * The real fight replaces this: suction strong enough to bend the camera, a stun when it eats a
 * star cluster too fast, jets as chips (docs/story.md, Act 8).
 */
import type { Rng } from '../core/rng';
import { SAGITTARIUS_A } from '../data/hazards';
import { hazardRegistry } from './index';
import { TheSun } from './theSun';

export const sagittariusADef = hazardRegistry.register({
  id: 'sagittarius_a',
  name: 'Sagittarius A*',
  boss: true,
  // Full-size contact radius: room for the boss before it is chipped.
  footprint: { radius: SAGITTARIUS_A.contactRadius, height: SAGITTARIUS_A.height },
  mass: SAGITTARIUS_A.mass,
  modelId: SAGITTARIUS_A.modelId,
  create(_run, x, z, id, rng: Rng) {
    return new TheSun(id, this, x, z, rng, SAGITTARIUS_A);
  },
});
