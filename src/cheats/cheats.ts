/**
 * Cheats (no DOM): the code that opens the cheats panel from the pause menu, and what each cheat
 * does to a Run. The panel is ./screen.ts; the page-wide gags (Disco, Australia, Comic Sans) live
 * there too.
 *
 * Entering the code emits `cheatsUnlocked` once per Run: from then on the Run is unranked (no
 * leaderboard entries, no Keepsake drops; what it already posted or dropped stays).
 *
 *   if (isCheatCode(typed)) unlockCheats(game.events, run);
 *   warpTo(run, 'galaxy');                    // any Act, earlier ones too
 *   setMass(run, massAt(massRange(run.area), 0.5));
 *   cheatsFor(run).setInvincible(true);
 */
import type { EventBus } from '../core/events';
import { PICKUP_SPAWN } from '../data/pickups';
import { AREAS } from '../data/areas';
import { AREA_DIRECTORS } from '../data/hazards';
import { getTier, tierForRadius } from '../data/tiers';
import { TIMED_PRIORITY } from '../entities/stats';
import { getHazardDirector } from '../game/assembly';
import { areaStartRadius, type Run } from '../game/run';
import { availablePerks, perkRegistry } from '../perks';
import { pickupRegistry } from '../pickups';
import { isFloorFree } from '../systems/spawner';
import type { AreaId } from '../world/types';
import { insideBounds } from '../world/wrap';

export const CHEAT_CODE = '6767123';

/** True if `typed` is the cheat code (spaces ignored). */
export function isCheatCode(typed: string): boolean {
  return typed.replace(/\s+/g, '') === CHEAT_CODE;
}

/** Bunny radius range (world units of the Area) the mass slider covers in an Area. */
export interface MassRange {
  min: number;
  max: number;
}

/**
 * The Area's boundaries for the mass slider: from a little under its first Tier (the Bunny's
 * arrival size) to half again past the start of its last Tier (past the size that absorbs its
 * boss), in the Area's unit.
 */
export function massRange(area: AreaId): MassRange {
  const [lo, hi] = AREAS[area].tiers;
  const unit = AREAS[area].unit;
  return { min: (getTier(lo).minRadius * 0.85) / unit, max: (getTier(hi).minRadius * 1.5) / unit };
}

/** Radius at slider position `t` (0..1, logarithmic: each step is the same factor). */
export function massAt(range: MassRange, t: number): number {
  const k = Math.min(1, Math.max(0, t));
  return range.min * (range.max / range.min) ** k;
}

/** Slider position (0..1) of radius `r` (clamped to the range). */
export function massT(range: MassRange, r: number): number {
  return Math.min(1, Math.max(0, Math.log(r / range.min) / Math.log(range.max / range.min)));
}

/**
 * Puts the Run's Tier where the Bunny's size says, up or down, without Tier-up rewards (no
 * tierUp, no Perk draft: the cheats panel hands out Perks itself).
 */
export function syncTier(run: Run): void {
  const tier = tierForRadius(run.bunny.realRadius).index;
  for (let t = 2; t <= tier; t++) run.tierTimes[t] ??= run.time;
  run.tier = tier;
}

/** Sets the Bunny's radius (world units), clamped to the current Area's mass range. */
export function setMass(run: Run, radius: number): void {
  const range = massRange(run.area);
  run.bunny.setRadius(Math.min(range.max, Math.max(range.min, radius)));
  syncTier(run);
}

/** The size (world units of `area`) a cheat warp back into `area` starts the Bunny at. */
export function warpRadius(run: Run, area: AreaId): number {
  if (area === 'house') return run.bunny.stats.get('startRadius');
  return Math.max(AREAS[area].arrivalRadius ?? 0, areaStartRadius(area) / AREAS[area].unit);
}

/** Moves the Run to any Act (see `Run.jumpToArea`), then lines the Tier up with the new size. */
export function warpTo(run: Run, area: AreaId): void {
  run.jumpToArea(area, warpRadius(run, area));
  syncTier(run);
}

/** Adds one stack of a Perk if the Run can still take it (unique / max stacks). */
export function addPerk(run: Run, id: string): boolean {
  if (!availablePerks(run).some((p) => p.id === id)) return false;
  run.applyPerk(id);
  return true;
}

/** Every Perk to its max stacks (unique ones once). Returns how many stacks were added. */
export function maxAllPerks(run: Run): number {
  let added = 0;
  for (const def of perkRegistry.all()) {
    while (addPerk(run, def.id)) added++;
  }
  return added;
}

/** Shrinks the Bunny by `share` (a sneeze), never below the Area's mass range. */
export function sneeze(run: Run, share = 0.15): void {
  setMass(run, run.bunny.radius * (1 - share));
}

/** Drops `count` random Pickups in a ring round the Bunny (where the floor is free). Returns how many landed. */
export function pickupPinata(run: Run, count = 8): number {
  const b = run.bunny;
  const defs = pickupRegistry.all();
  const r = Math.max(0.5 / b.unit, b.radius * PICKUP_SPAWN.radiusRatio);
  let placed = 0;
  for (let i = 0; i < count; i++) {
    for (let ring = 0; ring < 4; ring++) {
      const a = (i / count) * Math.PI * 2 + ring * 0.4;
      const d = b.radius * (2.4 + ring * 1.2);
      const x = b.x + Math.cos(a) * d;
      const z = b.z + Math.sin(a) * d;
      if (!insideBounds(run.house, x, z) || !isFloorFree(run.house, x, z, r * 1.6)) continue;
      const def = defs[Math.floor(Math.random() * defs.length)];
      if (!def) return placed;
      run.pickups.spawn(def.id, x, z, r);
      placed++;
      break;
    }
  }
  return placed;
}

/** Hazard ids the current Area's director can spawn (no bosses). */
export function crewFor(area: AreaId): string[] {
  return [...new Set(AREA_DIRECTORS[area].tiers.flatMap((t) => Object.keys(t.types)))];
}

/** Spawns one random Hazard of the current Area next to the Bunny. Returns its name, or null. */
export function summonCrew(run: Run): string | null {
  const director = getHazardDirector(run);
  const ids = crewFor(run.area);
  const id = ids[Math.floor(Math.random() * ids.length)];
  if (!director || !id) return null;
  return director.spawnNear(run, run.hazards, id)?.def.name ?? null;
}

/** Zoomies: the Bunny's speed and acceleration multiplier (above Character caps). */
export const ZOOMIES = 2.5;

/** One Run's cheat switches that change the simulation. */
export class RunCheats {
  invincible = false;
  zoomies = false;

  constructor(readonly run: Run) {
    run.bunny.damageFilters.push((amount) => (this.invincible ? 0 : amount));
  }

  setInvincible(on: boolean): void {
    this.invincible = on;
  }

  setZoomies(on: boolean): void {
    this.zoomies = on;
    const stats = this.run.bunny.stats;
    stats.removeSource('cheat:zoomies');
    if (!on) return;
    for (const stat of ['speed', 'acceleration'] as const) stats.add({ stat, op: 'mul', value: ZOOMIES, priority: TIMED_PRIORITY, source: 'cheat:zoomies' });
  }
}

const runCheats = new WeakMap<Run, RunCheats>();

/** True once the code was entered this Run. */
export function cheatsUnlocked(run: Run): boolean {
  return runCheats.has(run);
}

/** The Run's cheat switches (created on first use). */
export function cheatsFor(run: Run): RunCheats {
  let c = runCheats.get(run);
  if (!c) {
    c = new RunCheats(run);
    runCheats.set(run, c);
  }
  return c;
}

/** The code was entered: the Run stops counting (emits `cheatsUnlocked` the first time). */
export function unlockCheats(events: EventBus, run: Run): RunCheats {
  const first = !cheatsUnlocked(run);
  const c = cheatsFor(run);
  if (first) events.emit('cheatsUnlocked', { timeSec: run.time });
  return c;
}
