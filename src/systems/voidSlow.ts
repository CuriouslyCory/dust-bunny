/**
 * The Universe's voids slow the Bunny: while its centre is in a `voids` zone it moves at
 * `VOID_SLOW` × speed (a `zone:void` speed modifier at TIMED_PRIORITY, so it applies past the
 * Character's caps like a wet trail). Headless and deterministic: the zone comes from the layout
 * (`roomAt`), the modifier is added on entering a void and removed on leaving it (or the Area).
 * Runs before movement so the speed applies on the tick the Bunny crosses in.
 */
import type { Run } from '../game/run';
import { SYSTEM_ORDER, type System } from '../game/system';
import { TIMED_PRIORITY } from '../entities/stats';
import { roomAt } from '../world/house';

/** Speed multiplier in a void. */
export const VOID_SLOW = 0.7;
export const VOID_SOURCE = 'zone:void';

export class VoidSlowSystem implements System {
  readonly id = 'voidSlow';
  readonly order = SYSTEM_ORDER.movement - 5;
  private handle: number | null = null;

  update(_dt: number, run: Run): void {
    const b = run.bunny;
    const inVoid = run.area === 'universe' && roomAt(run.house, b.x, b.z)?.type === 'voids';
    if (inVoid === (this.handle !== null)) return;
    if (inVoid) this.handle = b.stats.add({ stat: 'speed', op: 'mul', value: VOID_SLOW, source: VOID_SOURCE, priority: TIMED_PRIORITY });
    else {
      b.stats.removeSource(VOID_SOURCE);
      this.handle = null;
    }
  }
}
