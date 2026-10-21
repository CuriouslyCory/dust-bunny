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
  movement: 100,
  magnet: 200,
  hazards: 300,
  absorb: 400,
  collision: 500,
  pickups: 550,
  growth: 600,
  spawner: 700,
} as const;
