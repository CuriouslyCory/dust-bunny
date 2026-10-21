/**
 * Hazard spawn director. Per Tier (src/data/hazards.ts DIRECTOR.tiers): an alive budget and
 * spawn interval that ramp with Tier progress, weighted Hazard types with per-type caps.
 * Spawns in a ring just outside the camera view, despawns Hazards that stay far away or
 * have become too small to matter, and brings in the area's boss (AREA_BOSSES): the Robo-Vac
 * 9000 at Tier 5 in the house, the Street Sweeper at Tier 7 in the neighborhood, the Garbage Truck
 * at Tier 9 in the city. Entering a new area resets the director (grace period, boss). The Run's
 * Difficulty scales the budget, spawn interval and grace period.
 */
import { lerp } from '../core/math';
import type { Rng } from '../core/rng';
import { AREA_BOSSES, AREA_DIRECTORS, DIRECTOR, DIRECTOR_EXCLUDE, type TierSpawnTable } from '../data/hazards';
import { DIFFICULTIES, type DifficultyDef } from '../data/difficulty';
import { tierProgress } from '../data/tiers';
import type { AreaId } from '../world/types';
import type { Run } from '../game/run';
import { onScreen, viewRadiusFor } from '../systems/camera';
import { absorbRadiusFor, hazardFloorFree } from './common';
import { HazardManager, hazardRegistry, type Hazard } from './index';

export function spawnTable(tier: number, area: AreaId = 'house'): TierSpawnTable {
  const { tiers: t, firstTier: first } = AREA_DIRECTORS[area];
  return t[Math.min(Math.max(tier - first + 1, 1), t.length) - 1]!;
}

/** Alive Hazard budget for a Tier at `progress` (0..1) through it, × the Difficulty's `scale`. */
export function hazardBudget(tier: number, progress: number, area: AreaId = 'house', scale = 1): number {
  const [a, b] = spawnTable(tier, area).budget;
  return Math.round(lerp(a, b, Math.min(1, Math.max(0, progress))) * scale);
}

/** Seconds between spawns for a Tier at `progress` through it. */
export function spawnInterval(tier: number, progress: number, area: AreaId = 'house'): number {
  const [a, b] = spawnTable(tier, area).interval;
  return lerp(a, b, Math.min(1, Math.max(0, progress)));
}

/** Spawn weights per Hazard type given the alive counts; capped types get 0. */
export function spawnWeights(tier: number, alive: Readonly<Record<string, number>>, area: AreaId = 'house'): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, { weight, max }] of Object.entries(spawnTable(tier, area).types)) out[id] = (alive[id] ?? 0) < max ? weight : 0;
  return out;
}

/** Picks the next Hazard type to spawn, or null if the budget is full or every type is capped. */
export function pickHazardType(
  tier: number,
  progress: number,
  alive: Readonly<Record<string, number>>,
  rng: Rng,
  exclude: readonly string[] = DIRECTOR_EXCLUDE,
  area: AreaId = 'house',
  budgetScale = 1,
): string | null {
  const total = Object.entries(alive).reduce((n, [id, c]) => (exclude.includes(id) ? n : n + c), 0);
  if (total >= hazardBudget(tier, progress, area, budgetScale)) return null;
  const weights = spawnWeights(tier, alive, area);
  const ids = Object.keys(weights).filter((id) => weights[id]! > 0);
  return rng.weighted(ids, (id) => weights[id]!) ?? null;
}

/** Ring [inner, outer] (cm from the Bunny) just outside the view for a Hazard of `radius`. */
export function spawnRing(viewRadius: number, hazardRadius: number): [number, number] {
  const inner = viewRadius + hazardRadius + DIRECTOR.spawnMargin;
  return [inner, inner + Math.max(viewRadius, DIRECTOR.ringMin)];
}

export class HazardDirector {
  private spawnTimer: number;
  private farTime = new Map<number, number>();
  bossSpawned = false;
  private bossTimer = -1;
  bossId: number | null = null;
  private area: AreaId = 'house';

  constructor(
    private readonly rng: Rng,
    private readonly difficulty: DifficultyDef = DIFFICULTIES.casual,
  ) {
    this.spawnTimer = DIRECTOR.graceSeconds * difficulty.graceSeconds;
  }

  update(dt: number, run: Run, mgr: HazardManager): void {
    if (run.area !== this.area) this.enterArea(run.area);
    const b = run.bunny;
    const viewR = viewRadiusFor(b.radius, run.tier);
    this.despawn(dt, run, mgr, viewR);

    const boss = AREA_BOSSES[run.area];
    if (run.tier >= boss.tier && !this.bossSpawned && hazardRegistry.has(boss.id)) {
      if (this.bossTimer < 0) this.bossTimer = boss.arrivalDelay;
      this.bossTimer -= dt;
      if (this.bossTimer <= 0) this.spawnBoss(run, mgr);
    }

    this.spawnTimer -= dt;
    if (this.spawnTimer > 0) return;
    const progress = tierProgress(b.radius);
    const d = this.difficulty;
    this.spawnTimer = spawnInterval(run.tier, progress, run.area) * d.spawnInterval;
    const alive: Record<string, number> = {};
    for (const h of mgr.hazards) if (!h.dead) alive[h.def.id] = (alive[h.def.id] ?? 0) + 1;
    const id = pickHazardType(run.tier, progress, alive, this.rng, DIRECTOR_EXCLUDE, run.area, d.hazardBudget);
    if (!id) return;
    const fp = HazardManager.footprint(id);
    const spot = this.findSpot(run, fp.radius, fp.height, ...spawnRing(viewR, fp.radius));
    if (spot) mgr.spawn(id, spot.x, spot.z);
  }

  /** New area: fresh grace period and the new area's boss still to come. */
  private enterArea(area: AreaId): void {
    this.area = area;
    this.spawnTimer = AREA_DIRECTORS[area].graceSeconds * this.difficulty.graceSeconds;
    this.farTime.clear();
    this.bossSpawned = false;
    this.bossTimer = -1;
    this.bossId = null;
  }

  /** Spawns the current area's boss now (also used by debug tools). */
  spawnBoss(run: Run, mgr: HazardManager): Hazard | null {
    if (run.area !== this.area) this.enterArea(run.area);
    const bossId = AREA_BOSSES[run.area].id;
    if (this.bossSpawned || !hazardRegistry.has(bossId)) return null;
    const fp = HazardManager.footprint(bossId);
    const viewR = viewRadiusFor(run.bunny.radius, run.tier);
    const [inner, outer] = spawnRing(viewR * 0.6, fp.radius);
    const spot = this.findSpot(run, fp.radius, fp.height, inner, outer) ?? this.findSpot(run, fp.radius, fp.height, fp.radius + run.bunny.radius + 80, 1e5);
    if (!spot) return null;
    this.bossSpawned = true;
    const h = mgr.spawn(bossId, spot.x, spot.z);
    this.bossId = h.id;
    run.events.emit('bossSpawned', { hazardId: h.id, absorbRadius: absorbRadiusFor(h.size, run.bunny.stats.get('absorbRatio')), name: h.def.name });
    return h;
  }

  /**
   * Spawns `defId` close to the Bunny and in view (debug tools; director spawns stay off screen).
   * A boss goes through spawnBoss (the current area's boss, once). Null if no spot fits.
   */
  spawnNear(run: Run, mgr: HazardManager, defId: string): Hazard | null {
    const def = hazardRegistry.get(defId);
    if (!def) return null;
    if (def.boss) return this.spawnBoss(run, mgr);
    const fp = def.footprint;
    const b = run.bunny;
    const inner = b.radius + fp.radius + 20;
    let spot: { x: number; z: number } | null = null;
    for (let i = 0; i < 48 && !spot; i++) {
      const a = (i / 48) * Math.PI * 2 * 7;
      const d = inner + (i % 4) * Math.max(40, fp.radius);
      const x = b.x + Math.cos(a) * d;
      const z = b.z + Math.sin(a) * d;
      if (hazardFloorFree(run.house, x, z, fp.radius, fp.height)) spot = { x, z };
    }
    spot ??= this.findSpot(run, fp.radius, fp.height, inner, inner + 100);
    return spot ? mgr.spawn(defId, spot.x, spot.z) : null;
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
