import type { Run } from './run';

/** A simulation step that runs every fixed tick while the Run is simulating. */
export interface System {
  id: string;
  /** Lower runs first. See SYSTEM_ORDER. */
  order: number;
  update(dt: number, run: Run): void;
  dispose?(): void;
}

/** Built-in ordering; leave gaps so other modules can slot systems in between. */
export const SYSTEM_ORDER = {
  timers: 0,
  /** The Character's Ability (src/abilities), before movement so an Amass slows the Bunny this tick. */
  ability: 90,
  movement: 100,
  hazards: 300,
  /** After movement and hazards so the pull can outpace everything that moved the Bunny this tick. */
  magnet: 350,
  absorb: 400,
  collision: 500,
  pickups: 550,
  growth: 600,
  /** Wrap-around maps: keeps Debris, Pickups and Hazards within half a lap of the Bunny (src/systems/wrap.ts). */
  wrap: 680,
  spawner: 700,
} as const;
