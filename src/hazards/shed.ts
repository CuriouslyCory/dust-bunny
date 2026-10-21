/**
 * Mass shedding: a Hazard knocks volume off the Bunny, and that volume lands back on the
 * floor as absorbable Debris that can be re-absorbed (roughly all of it, if you collect
 * every piece). Also used to scatter boss parts when the Robo-Vac 9000 is chipped.
 */
import type { Rng } from '../core/rng';
import type { DebrisType } from '../data/debris';
import { TUNING } from '../data/tuning';
import type { Run } from '../game/run';
import { isFloorFree } from '../systems/spawner';

export const SHED_PIECES = 10;

export interface ShedPlan {
  /** Volume removed from the Bunny (r³ units). */
  volume: number;
  /** Radius after shedding. */
  newRadius: number;
  pieces: number;
  /** Debris size per piece (cm). */
  pieceSize: number;
}

/**
 * Pure: how much to shed and how to split it so that re-absorbing every piece
 * (growthFactor × mass × size³ each) gives back about the shed volume.
 */
export function planShed(radius: number, fraction: number, absorbRatio: number, growthFactor = TUNING.growthFactor, pieceMass = 1, pieces = SHED_PIECES): ShedPlan {
  const volume = Math.max(0, fraction) * radius ** 3;
  const newRadius = Math.max(TUNING.minRadius, Math.cbrt(radius ** 3 - volume));
  if (volume <= 0 || pieces <= 0) return { volume: 0, newRadius: radius, pieces: 0, pieceSize: 0 };
  let size = Math.cbrt(volume / (growthFactor * pieceMass * pieces));
  // Every piece must be absorbable again at the reduced radius.
  const maxSize = newRadius * absorbRatio * 0.9;
  let n = pieces;
  if (size > maxSize) {
    size = maxSize;
    n = Math.min(40, Math.ceil(volume / (growthFactor * pieceMass * size ** 3)));
  }
  return { volume, newRadius, pieces: n, pieceSize: size };
}

/** Debris type whose catalogue size is closest to `size`, preferring types valid at this Tier. */
export function pickShedType(types: readonly DebrisType[], size: number, tier: number): DebrisType | undefined {
  let best: DebrisType | undefined;
  let bestScore = Infinity;
  for (const t of types) {
    const tierPenalty = tier >= t.tiers[0] - 1 && tier <= t.tiers[1] + 1 ? 0 : 2;
    const score = Math.abs(Math.log(t.size / size)) + tierPenalty;
    if (score < bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return best;
}

/** Scatters `count` Debris of about `size` in a ring [inner, outer] around (x, z). Returns how many landed. */
export function scatterDebris(run: Run, rng: Rng, x: number, z: number, count: number, size: number, inner: number, outer: number, type = pickShedType(run.debris.types, size, run.tier)): number {
  if (!type || count <= 0 || size <= 0) return 0;
  const index = run.debris.types.indexOf(type);
  let placed = 0;
  for (let tries = 0; placed < count && tries < count * 8; tries++) {
    const a = rng.range(0, Math.PI * 2);
    const d = rng.range(inner, outer);
    const px = x + Math.cos(a) * d;
    const pz = z + Math.sin(a) * d;
    const s = size * rng.range(0.85, 1.1);
    if (!isFloorFree(run.house, px, pz, s)) continue;
    if (run.debris.spawn(index, px, pz, rng, { size: s })) placed++;
  }
  return placed;
}

/** Sheds `fraction` of the Bunny's volume onto the floor around it and emits bunnyShed. */
export function shedMass(run: Run, rng: Rng, fraction: number, source: string): ShedPlan {
  const b = run.bunny;
  const ratio = b.stats.get('absorbRatio');
  const approx = planShed(b.radius, fraction, ratio);
  if (approx.volume <= 0) return approx;
  const type = pickShedType(run.debris.types, approx.pieceSize, run.tier);
  const plan = planShed(b.radius, fraction, ratio, TUNING.growthFactor, type?.mass ?? 1);
  const x = b.x;
  const z = b.z;
  b.addVolume(-plan.volume);
  const pieces = scatterDebris(run, rng, x, z, plan.pieces, plan.pieceSize, b.radius * 2.5, b.radius * 6, type);
  run.events.emit('bunnyShed', { volume: plan.volume, pieces, source, radius: b.radius });
  return plan;
}
