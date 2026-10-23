/** Input → Bunny velocity, Dash, rolling, and Bunny timers. */
import { TUNING } from '../data/tuning';
import type { Bunny } from '../entities/bunny';
import type { InputState } from '../core/input';
import { SYSTEM_ORDER, type System } from '../game/system';

export function maxSpeedFor(bunny: Bunny): number {
  return bunny.stats.get('speed') * TUNING.speedPerRadius * bunny.radius;
}

/** Pure-ish movement step, exported for tests and bots. */
export function stepBunnyMovement(bunny: Bunny, input: InputState, dt: number, onDash?: (cooldown: number) => void): void {
  const stats = bunny.stats.values;
  bunny.invulnerable = Math.max(0, bunny.invulnerable - dt);
  bunny.dashCooldownLeft = Math.max(0, bunny.dashCooldownLeft - dt);
  bunny.rooted = Math.max(0, bunny.rooted - dt);

  const maxSpeed = maxSpeedFor(bunny);
  let mx = input.moveX;
  let mz = input.moveZ;
  const mag = Math.hypot(mx, mz);
  if (mag > 1) {
    mx /= mag;
    mz /= mag;
  }

  if (input.dash && bunny.dashCooldownLeft <= 0 && bunny.rooted <= 0 && !bunny.amassing) {
    const m = Math.hypot(mx, mz);
    if (m > 0.1) {
      bunny.dashDirX = mx / m;
      bunny.dashDirZ = mz / m;
    } else {
      bunny.dashDirX = Math.sin(bunny.heading);
      bunny.dashDirZ = Math.cos(bunny.heading);
    }
    bunny.dashTime = TUNING.dashDuration;
    bunny.dashCooldownLeft = stats.dashCooldown;
    onDash?.(stats.dashCooldown);
  }

  if (bunny.amassing) {
    // Amass: no Dash or knockback impulses; the slow is a timed speed modifier.
    bunny.impulseX = bunny.impulseZ = 0;
    bunny.dashTime = 0;
  }
  if (bunny.rooted > 0) {
    bunny.vx = 0;
    bunny.vz = 0;
  } else if (bunny.dashTime > 0) {
    bunny.dashTime = Math.max(0, bunny.dashTime - dt);
    const s = maxSpeed * stats.dashSpeed;
    bunny.vx = bunny.dashDirX * s;
    bunny.vz = bunny.dashDirZ * s;
  } else {
    const hasInput = mx !== 0 || mz !== 0;
    const rate = hasInput ? stats.acceleration * TUNING.accelRate : TUNING.friction;
    const k = Math.min(1, rate * dt);
    bunny.vx += (mx * maxSpeed - bunny.vx) * k;
    bunny.vz += (mz * maxSpeed - bunny.vz) * k;
  }

  // External impulses (knockback/suction) decay quickly.
  const decay = Math.exp(-8 * dt);
  bunny.impulseX *= decay;
  bunny.impulseZ *= decay;

  const dx = (bunny.vx + bunny.impulseX) * dt;
  const dz = (bunny.vz + bunny.impulseZ) * dt;
  bunny.x += dx;
  bunny.z += dz;
  bunny.roll(dx, dz);
  if (Math.hypot(bunny.vx, bunny.vz) > maxSpeed * 0.05) bunny.heading = Math.atan2(bunny.vx, bunny.vz);
}

export const movementSystem: System = {
  id: 'movement',
  order: SYSTEM_ORDER.movement,
  update(dt, run) {
    stepBunnyMovement(run.bunny, run.inputState, dt, (cooldown) => run.events.emit('dashStarted', { cooldown }));
    run.bunny.stats.tick(dt);
  },
};
