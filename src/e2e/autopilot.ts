/**
 * The `tour` E2E scenario's player (src/e2e/index.ts), so a real device's frame report needs
 * nobody to play: steers at the Debris worth the most for the trip, wanders when there is none in
 * view or it is stuck, and takes the first Perk of each draft. Not the balance bot (scripts/sim.ts):
 * it only has to keep the renderer as busy as play does, so it plans no paths and dodges nothing
 * (`immortal` keeps the Run going instead).
 */
import type { InputSource, InputState } from '../core/input';
import type { Debris } from '../entities/debris';
import type { Game } from '../game/game';
import type { Run } from '../game/run';
import { canAbsorb, debrisLocked } from '../systems/absorb';
import { viewRadiusFor } from '../systems/camera';
import { reachableBy } from '../systems/spawner';

/** Run seconds between target picks. */
const PICK_S = 0.5;
/** Run seconds between stuck checks; moving under half a radius in that time counts as stuck. */
const STUCK_S = 1.5;
/** Run seconds spent wandering when stuck or when nothing absorbable is in view. */
const WANDER_S = 2;
/** Run seconds a target the Bunny got stuck on is ignored. */
const IGNORE_S = 20;
/** Wall-clock ms a paused screen is left up before the autopilot moves past it. */
const SCREEN_WAIT_MS = 1500;

const STILL: Readonly<InputState> = Object.freeze({ moveX: 0, moveZ: 0, dash: false });

export class Autopilot implements InputSource {
  private run: Run | null = null;
  private target: Debris | null = null;
  private pickAt = 0;
  private checkAt = 0;
  private wanderUntil = 0;
  private readonly dir = { x: 1, z: 0 };
  private readonly last = { x: 0, z: 0 };
  private readonly scratch: Debris[] = [];
  /** Debris id → Run time until which it isn't a target (the Bunny got stuck heading for it). */
  private readonly ignore = new Map<number, number>();

  constructor(private readonly game: Game) {}

  sample(): InputState {
    const run = this.game.run;
    if (!run || run.ended || !this.game.simulating) return STILL;
    if (run !== this.run) {
      this.run = run;
      this.target = null;
      this.ignore.clear();
      this.pickAt = this.checkAt = this.wanderUntil = 0;
    }
    const { bunny } = run;
    const t = run.time;
    if (t >= this.checkAt) {
      if (this.checkAt > 0 && Math.hypot(bunny.x - this.last.x, bunny.z - this.last.z) < bunny.radius * 0.5) {
        if (this.target) this.ignore.set(this.target.id, t + IGNORE_S);
        this.wander(t);
      }
      this.last.x = bunny.x;
      this.last.z = bunny.z;
      this.checkAt = t + STUCK_S;
    }
    if (t < this.wanderUntil) return { moveX: this.dir.x, moveZ: this.dir.z, dash: false };
    if (t >= this.pickAt) {
      this.target = this.pick(run);
      this.pickAt = t + PICK_S;
      if (!this.target) this.wander(t);
    }
    const d = this.target;
    if (!d) return STILL;
    const dx = d.x - bunny.x;
    const dz = d.z - bunny.z;
    const len = Math.hypot(dx, dz) || 1;
    return { moveX: dx / len, moveZ: dz / len, dash: false };
  }

  /** The Debris in view the Bunny can absorb now and reach that's worth the most per distance (as the sim bot scores it). */
  private pick(run: Run): Debris | null {
    const { bunny, house } = run;
    const ratio = bunny.stats.get('absorbRatio');
    let best: Debris | null = null;
    let bestScore = 0;
    for (const d of run.debris.query(bunny.x, bunny.z, viewRadiusFor(bunny.radius, run.tier), this.scratch)) {
      if (!canAbsorb(bunny.radius, ratio, d.size) || debrisLocked(bunny, d) || (this.ignore.get(d.id) ?? 0) > run.time || !reachableBy(house, d.x, d.z, d.size, bunny.radius)) continue;
      const score = ((d.size / bunny.radius) ** 3 * d.type.mass) / (Math.hypot(d.x - bunny.x, d.z - bunny.z) + bunny.radius);
      if (score > bestScore) {
        bestScore = score;
        best = d;
      }
    }
    return best;
  }

  private wander(t: number): void {
    const a = Math.random() * Math.PI * 2;
    this.dir.x = Math.cos(a);
    this.dir.z = Math.sin(a);
    this.wanderUntil = t + WANDER_S;
    this.target = null;
    this.pickAt = this.wanderUntil;
  }
}

/** Hits still knock back and shed, but never take the last heart (as `pnpm sim --god`). */
export function immortal(run: Run): void {
  const { bunny } = run;
  bunny.damageFilters.push((amount) => {
    if (bunny.health - amount <= 0) bunny.heal(bunny.maxHealth);
    return Math.min(amount, bunny.health - 1);
  });
}

/**
 * Moves past the screens that pause a Run once they have been up a moment: takes the first Perk
 * card, skips story cards, and resumes from the others (Keepsake reveal, pause). The boss intro
 * ends by itself.
 */
export function keepPlaying(game: Game): void {
  let shown = '';
  let since = 0;
  window.setInterval(() => {
    const run = game.run;
    const id = game.screens.current?.id ?? '';
    const now = performance.now();
    if (id !== shown) {
      shown = id;
      since = now;
    }
    if (!run || run.ended || document.hidden || id === 'playing' || id === 'bossIntro' || now - since < SCREEN_WAIT_MS) return;
    since = now;
    const el = game.screens.currentScreen?.el;
    const button = el?.querySelector<HTMLButtonElement>(id === 'perkDraft' ? '.perk-card' : '.story-skip');
    if (button) button.click();
    else if (id !== 'perkDraft') game.go(run.perkDraft.active ? 'perkDraft' : 'playing');
  }, 250);
}
