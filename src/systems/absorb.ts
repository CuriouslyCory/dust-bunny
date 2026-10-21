/** Absorb rule, growth formula, magnet pull and the absorb system. */
import { TUNING } from '../data/tuning';
import type { Debris } from '../entities/debris';
import { SYSTEM_ORDER, type System } from '../game/system';

/** Debris of radius `size` can be absorbed by a Bunny of `radius` iff size <= radius × absorbRatio. */
export function canAbsorb(radius: number, absorbRatio: number, size: number): boolean {
  return size <= radius * absorbRatio;
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
    scratch.length = 0;
    debris.query(bunny.x, bunny.z, reach + r * ratio, scratch);
    const step = TUNING.magnetPullSpeed * r * dt;
    for (const d of scratch) {
      if (!canAbsorb(r, ratio, d.size)) continue;
      const dx = bunny.x - d.x;
      const dz = bunny.z - d.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 1e-6 || dist > reach + d.size) continue;
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
      if (d.alive && canAbsorb(bunny.radius, bunny.stats.get('absorbRatio'), d.size)) run.absorbDebris(d);
    }
  },
};
