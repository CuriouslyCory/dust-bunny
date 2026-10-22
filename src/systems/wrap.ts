/**
 * Keeps a wrap-around map (`layout.wrapX`, the Globe) within half a lap of the Bunny. World x is
 * unbounded there (src/world/wrap.ts): the Bunny keeps its own coordinate as it circles the planet
 * and the view draws the map at the laps around the camera. Debris and floor Pickups more than half
 * a lap away are moved a lap towards the Bunny (the map is wide enough that this is off screen);
 * Hazards that far are dropped, bosses excepted (the director spawns new ones near the Bunny).
 */
import type { Debris } from '../entities/debris';
import type { Run } from '../game/run';
import { SYSTEM_ORDER, type System } from '../game/system';
import { wrapWidth } from '../world/wrap';

/** Seconds between passes: a Bunny crosses well under 1% of a lap in this time. */
const INTERVAL = 0.5;

export class WrapSystem implements System {
  readonly id = 'wrap';
  readonly order = SYSTEM_ORDER.wrap;
  private timer = 0;
  private readonly moved: Array<{ d: Debris; x: number }> = [];

  update(dt: number, run: Run): void {
    const w = wrapWidth(run.house);
    if (w <= 0) return;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = INTERVAL;
    rewrap(run, w, this.moved);
  }
}

/** Moves everything more than half a lap (`w`) from the Bunny by whole laps towards it. */
export function rewrap(run: Run, w: number, scratch: Array<{ d: Debris; x: number }> = []): void {
  const bx = run.bunny.x;
  const half = w / 2;
  const toward = (x: number) => x + Math.round((bx - x) / w) * w;
  scratch.length = 0;
  run.debris.forEach((d) => {
    if (Math.abs(d.x - bx) > half) scratch.push({ d, x: toward(d.x) });
  });
  for (const m of scratch) run.debris.move(m.d, m.x, m.d.z);
  scratch.length = 0;
  for (const p of run.pickups.floor) {
    if (Math.abs(p.x - bx) <= half) continue;
    p.x = toward(p.x);
    p.object3d.position.x = p.x;
  }
  for (const h of run.hazards.hazards) {
    if (!h.dead && !h.def.boss && Math.abs(h.x - bx) > half) h.dead = true;
  }
}
