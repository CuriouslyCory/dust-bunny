/**
 * Hazard spawn director. Per Tier (src/data/hazards.ts DIRECTOR.tiers): an alive budget and
 * spawn interval that ramp with Tier progress, weighted Hazard types with per-type caps.
 * Spawns in a ring just outside the camera view, despawns Hazards that stay far away or
 * have become too small to matter, and brings in the Robo-Vac 9000 at Tier 5.
 */
import { lerp } from '../core/math';
import type { Rng } from '../core/rng';
import { BROOM, DIRECTOR, LINT_ROLLER, MOP, ROBOVAC_9000, ROOMBA, SPRAY_BOTTLE, UPRIGHT_VACUUM, type TierSpawnTable } from '../data/hazards';
import { MAX_TIER, tierProgress } from '../data/tiers';
import type { Run } from '../game/run';
import { onScreen, viewRadiusFor } from '../systems/camera';
import { absorbRadiusFor, hazardFloorFree } from './common';
import type { Hazard, HazardManager } from './index';

/** Footprint used to validate spawn spots. */
export const SPAWN_FOOTPRINT: Readonly<Record<string, { radius: number; height: number }>> = {
  roomba: { radius: ROOMBA.size, height: ROOMBA.height },
  lint_roller: { radius: LINT_ROLLER.size, height: LINT_ROLLER.height },
  broom: { radius: BROOM.sweepRadius * 0.5, height: 10 },
  spray_bottle: { radius: SPRAY_BOTTLE.size, height: SPRAY_BOTTLE.height },
  mop: { radius: MOP.size, height: MOP.height },
  upright_vacuum: { radius: UPRIGHT_VACUUM.size, height: UPRIGHT_VACUUM.height },
  robovac_9000: { radius: ROBOVAC_9000.contactRadius, height: ROBOVAC_9000.height },
};

export function spawnTable(tier: number): TierSpawnTable {
  const t = DIRECTOR.tiers;
  return t[Math.min(Math.max(tier, 1), t.length) - 1]!;
}

/** Alive Hazard budget for a Tier at `progress` (0..1) through it. */
export function hazardBudget(tier: number, progress: number): number {
  const [a, b] = spawnTable(tier).budget;
  return Math.round(lerp(a, b, Math.min(1, Math.max(0, progress))));
}

/** Seconds between spawns for a Tier at `progress` through it. */
export function spawnInterval(tier: number, progress: number): number {
  const [a, b] = spawnTable(tier).interval;
  return lerp(a, b, Math.min(1, Math.max(0, progress)));
}

/** Spawn weights per Hazard type given the alive counts; capped types get 0. */
export function spawnWeights(tier: number, alive: Readonly<Record<string, number>>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, { weight, max }] of Object.entries(spawnTable(tier).types)) out[id] = (alive[id] ?? 0) < max ? weight : 0;
  return out;
}

/** Picks the next Hazard type to spawn, or null if the budget is full or every type is capped. */
export function pickHazardType(tier: number, progress: number, alive: Readonly<Record<string, number>>, rng: Rng, exclude: readonly string[] = ['robovac_9000', 'mini_roomba']): string | null {
  const total = Object.entries(alive).reduce((n, [id, c]) => (exclude.includes(id) ? n : n + c), 0);
  if (total >= hazardBudget(tier, progress)) return null;
  const weights = spawnWeights(tier, alive);
  const ids = Object.keys(weights).filter((id) => weights[id]! > 0);
  return rng.weighted(ids, (id) => weights[id]!) ?? null;
}

/** Ring [inner, outer] (cm from the Bunny) just outside the view for a Hazard of `radius`. */
export function spawnRing(viewRadius: number, hazardRadius: number): [number, number] {
  const inner = viewRadius + hazardRadius + DIRECTOR.spawnMargin;
  return [inner, inner + Math.max(viewRadius, DIRECTOR.ringMin)];
}

export class HazardDirector {
  private spawnTimer = DIRECTOR.graceSeconds;
  private farTime = new Map<number, number>();
  bossSpawned = false;
  private bossTimer = -1;
  bossId: number | null = null;

  constructor(private readonly rng: Rng) {}

  update(dt: number, run: Run, mgr: HazardManager): void {
    const b = run.bunny;
    const viewR = viewRadiusFor(b.radius, run.tier);
    this.despawn(dt, run, mgr, viewR);

    if (run.tier >= MAX_TIER && !this.bossSpawned) {
      if (this.bossTimer < 0) this.bossTimer = ROBOVAC_9000.arrivalDelay;
      this.bossTimer -= dt;
      if (this.bossTimer <= 0) this.spawnBoss(run, mgr);
    }

    this.spawnTimer -= dt;
    if (this.spawnTimer > 0) return;
    const progress = tierProgress(b.radius);
    this.spawnTimer = spawnInterval(run.tier, progress);
    const alive: Record<string, number> = {};
    for (const h of mgr.hazards) if (!h.dead) alive[h.def.id] = (alive[h.def.id] ?? 0) + 1;
    const id = pickHazardType(run.tier, progress, alive, this.rng);
    if (!id) return;
    const fp = SPAWN_FOOTPRINT[id] ?? { radius: 15, height: 20 };
    const spot = this.findSpot(run, fp.radius, fp.height, ...spawnRing(viewR, fp.radius));
    if (spot) mgr.spawn(id, spot.x, spot.z);
  }

  /** Spawns the boss now (also used by debug tools). */
  spawnBoss(run: Run, mgr: HazardManager): Hazard | null {
    if (this.bossSpawned) return null;
    const fp = SPAWN_FOOTPRINT.robovac_9000!;
    const viewR = viewRadiusFor(run.bunny.radius, run.tier);
    const [inner, outer] = spawnRing(viewR * 0.6, fp.radius);
    const spot = this.findSpot(run, fp.radius, fp.height, inner, outer) ?? this.findSpot(run, fp.radius, fp.height, fp.radius + run.bunny.radius + 80, 1e5);
    if (!spot) return null;
    this.bossSpawned = true;
    const h = mgr.spawn('robovac_9000', spot.x, spot.z);
    this.bossId = h.id;
    run.events.emit('bossSpawned', { hazardId: h.id, absorbRadius: absorbRadiusFor(h.size, run.bunny.stats.get('absorbRatio')) });
    return h;
  }

  /** Random valid spot in the ring around the Bunny; falls back to the farthest valid spot in the house. */
  findSpot(run: Run, radius: number, height: number, inner: number, outer: number): { x: number; z: number } | null {
    const b = run.bunny;
    const house = run.house;
    for (let tries = 0; tries < 24; tries++) {
      const a = this.rng.range(0, Math.PI * 2);
      const d = this.rng.range(inner, outer);
      const x = b.x + Math.cos(a) * d;
      const z = b.z + Math.sin(a) * d;
      // Off screen too: on portrait the view reaches past the ring at the top of the screen.
      if (hazardFloorFree(house, x, z, radius, height) && !onScreen(run, x, z, radius)) return { x, z };
    }
    // The view may cover the whole house (Tier 5): take the farthest valid random spot.
    let best: { x: number; z: number } | null = null;
    let bestD = inner * 0.5;
    const bd = house.bounds;
    for (let tries = 0; tries < 40; tries++) {
      const x = this.rng.range(bd.minX, bd.maxX);
      const z = this.rng.range(bd.minZ, bd.maxZ);
      const d = Math.hypot(x - b.x, z - b.z);
      // Prefer hidden spots (behind the camera); otherwise the farthest one.
      const score = onScreen(run, x, z, radius) ? d : d + 1e4;
      if (score > bestD && d <= outer && hazardFloorFree(house, x, z, radius, height)) {
        best = { x, z };
        bestD = score;
      }
    }
    return best;
  }

  private despawn(dt: number, run: Run, mgr: HazardManager, viewR: number): void {
    const b = run.bunny;
    const far = Math.max(viewR * DIRECTOR.despawnViewMul, DIRECTOR.despawnMin);
    for (const h of mgr.hazards) {
      if (h.dead || h.id === this.bossId) continue;
      const d = Math.hypot(h.x - b.x, h.z - b.z);
      const outOfView = d > viewR + h.size;
      if (outOfView && h.size < b.radius * DIRECTOR.irrelevantRatio) {
        h.dead = true;
        continue;
      }
      if (d > far) {
        const t = (this.farTime.get(h.id) ?? 0) + dt;
        this.farTime.set(h.id, t);
        if (t > DIRECTOR.despawnDelay) h.dead = true;
      } else {
        this.farTime.delete(h.id);
      }
      if (h.dead) this.farTime.delete(h.id);
    }
  }
}
