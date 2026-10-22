/** Absorb rule, growth formula, magnet pull and the absorb system. */
import { tierForRadius } from '../data/tiers';
import { TUNING } from '../data/tuning';
import type { Bunny } from '../entities/bunny';
import type { Debris } from '../entities/debris';
import { SYSTEM_ORDER, type System } from '../game/system';

/** Debris of radius `size` can be absorbed by a Bunny of `radius` iff size <= radius × absorbRatio. */
export function canAbsorb(radius: number, absorbRatio: number, size: number): boolean {
  return size <= radius * absorbRatio;
}

/** True while `d` is an Obstacle for this Bunny: its type is `lockedUntilTier` a Tier the Bunny hasn't reached. */
export function debrisLocked(bunny: Bunny, d: Debris): boolean {
  const lock = d.type.lockedUntilTier;
  return lock !== undefined && tierForRadius(bunny.realRadius).index < lock;
}

/** The Bunny can absorb `d` now: small enough (`canAbsorb`) and not locked (`debrisLocked`). */
export function canAbsorbDebris(bunny: Bunny, d: Debris): boolean {
  return canAbsorb(bunny.radius, bunny.stats.get('absorbRatio'), d.size) && !debrisLocked(bunny, d);
}

/** Effective growth factor at a real radius (cm): TUNING.growthFactor × the Tier's `growth` pacing multiplier. */
export function growthFactorAt(radius: number): number {
  return TUNING.growthFactor * tierForRadius(radius).growth;
}

/** r' = cbrt(r³ + growthFactor × growthMultiplier × massMult × size³) */
export function growRadius(radius: number, size: number, massMult = 1, growthMultiplier = 1, growthFactor = TUNING.growthFactor): number {
  return Math.cbrt(radius ** 3 + growthFactor * growthMultiplier * massMult * size ** 3);
}

const scratch: Debris[] = [];

export const magnetSystem: System = {
  id: 'magnet',
  order: SYSTEM_ORDER.magnet,
  update(dt, run) {
    const { bunny, debris } = run;
    const m = bunny.stats.get('magnetRadius');
    if (m <= 0) return;
    const r = bunny.radius;
    const reach = r * (1 + m);
    const ratio = bunny.stats.get('absorbRatio');
    // How far the Bunny moved this tick (movement runs first): Dash, Candy Rush, knockback included.
    const moved = Math.hypot(bunny.x - bunny.prevX, bunny.z - bunny.prevZ);
    scratch.length = 0;
    debris.query(bunny.x, bunny.z, reach + r * ratio + moved, scratch);
    // Outpace the Bunny's own movement so Debris in the field always closes in and can't be outrun.
    const step = TUNING.magnetPullSpeed * r * dt + TUNING.magnetChase * moved;
    for (const d of scratch) {
      if (!canAbsorb(r, ratio, d.size) || debrisLocked(bunny, d)) continue;
      const dx = bunny.x - d.x;
      const dz = bunny.z - d.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 1e-6) continue;
      // In the field now, or at the start of the tick (a sudden Dash can carry the Bunny past it).
      if (dist > reach + d.size && Math.hypot(bunny.prevX - d.x, bunny.prevZ - d.z) > reach + d.size) continue;
      const s = Math.min(step, dist);
      debris.move(d, d.x + (dx / dist) * s, d.z + (dz / dist) * s);
    }
  },
};

export const absorbSystem: System = {
  id: 'absorb',
  order: SYSTEM_ORDER.absorb,
  update(_dt, run) {
    const { bunny, debris } = run;
    scratch.length = 0;
    debris.queryOverlapping(bunny.x, bunny.z, bunny.radius, scratch);
    for (const d of scratch) {
      // Radius changes as we absorb, so re-check against the current size.
      if (d.alive && canAbsorbDebris(bunny, d)) run.absorbDebris(d);
    }
  },
};
