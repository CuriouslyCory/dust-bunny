/**
 * Hazard spawn director. Per Tier (src/data/hazards.ts DIRECTOR.tiers): an alive budget and
 * spawn interval that ramp with Tier progress, weighted Hazard types with per-type caps.
 * Spawns in a ring just outside the camera view, despawns Hazards that stay far away or
 * have become too small to matter, and brings in the area's boss (AREA_BOSSES) once the Bunny
 * reaches its arrival size (`bossArrivalRadius`: `lead` × the radius that absorbs it, the
 * Expansion at Tier 21). Close to the next Area's boss size the Area goes quiet (`areaQuiet`): no
 * more Hazards spawn. Entering a new area resets the director (grace period, boss). The Run's Difficulty
 * scales the budget, spawn interval and grace period. Its absolute margins (DIRECTOR.spawnMargin,
 * ringMin, despawnMin and the debug / boss fallbacks) are real cm, divided by the Area's unit (`run.unit`). A def with `spawnZones` is only
 * placed in those zones when the layout has one (the River Barge on the river).
 */
import { lerp } from '../core/math';
import type { Rng } from '../core/rng';
import { AREA_BOSSES, AREA_DIRECTORS, areaQuietFor, bossArrivalRadius, DIRECTOR, DIRECTOR_EXCLUDE, type TierSpawnTable } from '../data/hazards';
import { DIFFICULTIES, type DifficultyDef } from '../data/difficulty';
import { tierProgress } from '../data/tiers';
import type { AreaId, RoomType } from '../world/types';
import { roomAt } from '../world/house';
import type { Run } from '../game/run';
import { onScreen, viewRadiusFor } from '../systems/camera';
import { absorbRadiusFor, hazardFloorFree } from './common';
import { HazardManager, hazardRegistry, type Hazard } from './index';
import { nearestImageX } from '../world/wrap';

/**
 * True once the Bunny has been close to the next Area's boss arrival size (`areaQuietFor`): neither
 * the director nor the Debris spawner adds anything more in this Area.
 */
export function areaQuiet(run: Run): boolean {
  return areaQuietFor(run.area, run.bunny);
}

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

/**
 * Ring [inner, outer] (world units from the Bunny) just outside the view for a Hazard of `radius`;
 * `unit` is the Area's cm per world unit (the margins are real cm).
 */
export function spawnRing(viewRadius: number, hazardRadius: number, unit = 1): [number, number] {
  const inner = viewRadius + hazardRadius + DIRECTOR.spawnMargin / unit;
  return [inner, inner + Math.max(viewRadius, DIRECTOR.ringMin / unit)];
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
    if (!this.bossSpawned && b.radius >= bossArrivalRadius(run.area, b.stats.get('absorbRatio')) && hazardRegistry.has(boss.id)) {
      if (this.bossTimer < 0) this.bossTimer = boss.arrivalDelay;
      this.bossTimer -= dt;
      if (this.bossTimer <= 0) this.spawnBoss(run, mgr);
    }

    this.spawnTimer -= dt;
    if (this.spawnTimer > 0) return;
    // Close to the next Area's boss size: this Area goes quiet (src/data/hazards.ts, QUIET_SHARE).
    if (areaQuiet(run)) return;
    const progress = tierProgress(b.realRadius);
    const d = this.difficulty;
    this.spawnTimer = spawnInterval(run.tier, progress, run.area) * d.spawnInterval;
    const alive: Record<string, number> = {};
    for (const h of mgr.hazards) if (!h.dead) alive[h.def.id] = (alive[h.def.id] ?? 0) + 1;
    const id = pickHazardType(run.tier, progress, alive, this.rng, DIRECTOR_EXCLUDE, run.area, d.hazardBudget);
    if (!id) return;
    const def = hazardRegistry.require(id);
    const fp = def.footprint;
    const [inner, outer] = spawnRing(viewR, fp.radius, run.unit);
    const spot = this.findSpot(run, fp.radius, fp.height, inner, outer, def.spawnZones);
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
    const [inner, outer] = spawnRing(viewR * 0.6, fp.radius, run.unit);
    const spot = this.findSpot(run, fp.radius, fp.height, inner, outer) ?? this.findSpot(run, fp.radius, fp.height, fp.radius + run.bunny.radius + 80 / run.unit, 1e5 / run.unit);
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
    const cm = 1 / run.unit;
    const inner = b.radius + fp.radius + 20 * cm;
    let spot: { x: number; z: number } | null = null;
    for (let i = 0; i < 48 && !spot; i++) {
      const a = (i / 48) * Math.PI * 2 * 7;
      const d = inner + (i % 4) * Math.max(40 * cm, fp.radius);
      const x = b.x + Math.cos(a) * d;
      const z = b.z + Math.sin(a) * d;
      if (hazardFloorFree(run.house, x, z, fp.radius, fp.height)) spot = { x, z };
    }
    spot ??= this.findSpot(run, fp.radius, fp.height, inner, inner + 100 * cm);
    return spot ? mgr.spawn(defId, spot.x, spot.z) : null;
  }

  /**
   * Random valid spot in the ring around the Bunny; falls back to the farthest valid spot in the
   * house. With `zones` (a def's `spawnZones`) the spot must be in one of them, if the layout has any.
   */
  findSpot(run: Run, radius: number, height: number, inner: number, outer: number, zones?: readonly RoomType[]): { x: number; z: number } | null {
    const b = run.bunny;
    const house = run.house;
    const only = zones && house.rooms.some((r) => zones.includes(r.type)) ? zones : null;
    const fits = (x: number, z: number) => hazardFloorFree(house, x, z, radius, height) && (!only || only.includes(roomAt(house, x, z)!.type));
    for (let tries = 0; tries < 24; tries++) {
      const a = this.rng.range(0, Math.PI * 2);
      const d = this.rng.range(inner, outer);
      const x = b.x + Math.cos(a) * d;
      const z = b.z + Math.sin(a) * d;
      // Off screen too: on portrait the view reaches past the ring at the top of the screen.
      if (fits(x, z) && !onScreen(run, x, z, radius)) return { x, z };
    }
    // The view may cover the whole house (Tier 5): take the farthest valid random spot.
    let best: { x: number; z: number } | null = null;
    let bestD = inner * 0.5;
    const bd = house.bounds;
    for (let tries = 0; tries < 40; tries++) {
      // On a map that wraps east–west, the copy of the spot nearest the Bunny.
      const x = nearestImageX(house, this.rng.range(bd.minX, bd.maxX), b.x);
      const z = this.rng.range(bd.minZ, bd.maxZ);
      const d = Math.hypot(x - b.x, z - b.z);
      // Prefer hidden spots (behind the camera); otherwise the farthest one.
      const score = onScreen(run, x, z, radius) ? d : d + 1e4;
      if (score > bestD && d <= outer && fits(x, z)) {
        best = { x, z };
        bestD = score;
      }
    }
    return best;
  }

  private despawn(dt: number, run: Run, mgr: HazardManager, viewR: number): void {
    const b = run.bunny;
    const far = Math.max(viewR * DIRECTOR.despawnViewMul, DIRECTOR.despawnMin / run.unit);
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
