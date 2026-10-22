/**
 * Floor Pickup spawn policy (run.pickups.director). Spawns a random Pickup every
 * PICKUP_SPAWN.interval / pickupLuck seconds in a ring inside the camera view, keeps at most
 * maxOnFloor, despawns old or far-behind ones, and scales/animates floor Pickups with the
 * Bunny's radius so they stay collectable as it grows.
 */
import { rectContains } from '../core/math';
import { PICKUP_SPAWN as S } from '../data/pickups';
import type { Run } from '../game/run';
import { isFloorFree } from '../systems/spawner';
import { viewRadiusFor } from '../systems/camera';
import { pickupRegistry, type PickupManager } from './index';
import { animatePickupObject } from './view';

export type PickupDirector = (dt: number, run: Run, manager: PickupManager) => void;

/** Seconds between spawns for a given pickupLuck stat. */
export function pickupInterval(luck: number): number {
  return S.interval / Math.max(0.1, luck);
}

export function createPickupDirector(): PickupDirector {
  let timer = S.firstDelay;
  return (dt, run, mgr) => {
    const b = run.bunny;
    const viewR = viewRadiusFor(b.radius, run.tier);
    // At least 0.5 cm (in world units: 0.5 / unit), else a share of the Bunny radius.
    const r = Math.max(0.5 / b.unit, b.radius * S.radiusRatio);

    for (let i = mgr.floor.length - 1; i >= 0; i--) {
      const p = mgr.floor[i]!;
      const far = Math.hypot(p.x - b.x, p.z - b.z) > viewR * S.despawnView;
      if (far || run.time - p.spawnedAt > S.lifetime) {
        mgr.despawn(p);
        continue;
      }
      p.radius = r;
      animatePickupObject(p.object3d, r, run.time, p.id * 1.7);
    }

    timer -= dt;
    if (timer > 0) return;
    timer = pickupInterval(b.stats.get('pickupLuck'));
    if (mgr.floor.length >= S.maxOnFloor) return;
    const defs = pickupRegistry.all();
    for (let tries = 0; tries < 12; tries++) {
      const a = mgr.rng.range(0, Math.PI * 2);
      const d = mgr.rng.range(S.inner, S.outer) * viewR;
      const x = b.x + Math.cos(a) * d;
      const z = b.z + Math.sin(a) * d;
      if (!rectContains(run.house.bounds, x, z) || !isFloorFree(run.house, x, z, r * 1.6)) continue;
      const def = mgr.rng.weighted(defs, (p) => p.spawnWeight);
      if (!def) return;
      const p = mgr.spawn(def.id, x, z, r);
      animatePickupObject(p.object3d, r, run.time, p.id * 1.7);
      return;
    }
  };
}
