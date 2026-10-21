/**
 * Run: one play session's simulation state. Headless (no DOM, no WebGL), so it can be
 * driven by tests and the balance bot (scripts/sim.ts). Rendering lives in RunView.
 */
import { Group } from 'three';
import { Disposables, type EventBus, type Vec3Like } from '../core/events';
import { NO_INPUT, type InputSource } from '../core/input';
import { Rng } from '../core/rng';
import { AREAS } from '../data/areas';
import { getCharacter } from '../data/characters';
import { difficultyModifiers, getDifficulty, type DifficultyDef, type DifficultyId } from '../data/difficulty';
import { DEBRIS_TYPES } from '../data/debris';
import { tierForRadius } from '../data/tiers';
import { Bunny } from '../entities/bunny';
import { DebrisField, type Debris } from '../entities/debris';
import { BASE_BUNNY_STATS, StatBlock, type StatModifier } from '../entities/stats';
import { HazardManager } from '../hazards';
import { perkRegistry } from '../perks';
import { PerkDraft } from '../perks/draft';
import { PickupManager } from '../pickups';
import { absorbSystem, growRadius, growthFactorAt, magnetSystem } from '../systems/absorb';
import { collisionSystem } from '../systems/collision';
import { growthSystem } from '../systems/growth';
import { movementSystem } from '../systems/movement';
import { DebrisSpawner } from '../systems/spawner';
import type { ViewInfo } from '../systems/camera';
import { circleVsRect } from '../core/math';
import { generateHouse, openExit } from '../world/house';
import { CITY, generateCity } from '../world/city';
import { generateNeighborhood, NEIGHBORHOOD } from '../world/neighborhood';
import { AREA_ORDER, nextArea, type AreaId, type HouseLayout } from '../world/types';
import type { RunEndReason, RunStats } from './runStats';
import { SYSTEM_ORDER, type System } from './system';

export interface RunConfig {
  seed: string;
  characterId: string;
  /** Difficulty (missing: casual). */
  difficulty?: DifficultyId;
  /** Start in this area (debug / testing; 'neighborhood' skips the house, 'city' skips both). */
  area?: AreaId;
  /** Extra stat modifiers applied at start (permanent Upgrades from the Shop). */
  modifiers?: StatModifier[];
  /** Perks granted at start (debug / testing). */
  perks?: string[];
}

/** Layout generator, Debris hash cell and debug start radius per area. */
const AREA_WORLDS: Record<AreaId, { generate: (seed: string) => HouseLayout; cellSize?: number; startRadius: number }> = {
  house: { generate: generateHouse, startRadius: 0 },
  neighborhood: { generate: generateNeighborhood, cellSize: NEIGHBORHOOD.debrisCellSize, startRadius: NEIGHBORHOOD.debugStartRadius },
  city: { generate: generateCity, cellSize: CITY.debrisCellSize, startRadius: CITY.debugStartRadius },
};

/** Bunny radius a Run starting in `area` begins with (about the size after the previous boss). */
export function areaStartRadius(area: AreaId): number {
  return AREA_WORLDS[area].startRadius;
}

/**
 * Leaves the area once its exit is open and the Bunny rolls up to it (the bounds stop the
 * Bunny's centre a radius short of the outer wall, so touching the opening is enough).
 */
const exitSystem: System = {
  id: 'exit',
  order: SYSTEM_ORDER.growth + 50,
  update(_dt, run) {
    const exit = run.house.exit;
    if (!exit?.open) return;
    const b = run.bunny;
    if (circleVsRect(b.x, b.z, b.radius + Math.max(6, b.radius * 0.05), exit.rect) !== null) run.enterNextArea();
  },
};

export class Run {
  readonly rng: Rng;
  /** Difficulty tuning for this Run (Hazards, director, start stats, area heal, Fluff). */
  readonly difficulty: DifficultyDef;
  /** Current area's layout: the house floor, then the neighborhood, then the city (swapped by enterArea). */
  house: HouseLayout;
  area: AreaId = 'house';
  /** The Robo-Vac 9000 has been absorbed and the front door is open. */
  houseCleared = false;
  /** The Street Sweeper has been absorbed and the road to the city is open. */
  neighborhoodCleared = false;
  /** Simulated second at which the Run entered the neighborhood (null while in the house). */
  neighborhoodAt: number | null = null;
  /** Simulated second at which the Run entered the city (null before). */
  cityAt: number | null = null;
  readonly bunny: Bunny;
  readonly debris: DebrisField;
  readonly hazards: HazardManager;
  readonly pickups: PickupManager;
  readonly spawner: DebrisSpawner;
  /** Pending Perk drafts, the current offer and rerolls (one draft per Tier crossed). */
  readonly perkDraft: PerkDraft;
  /** Visuals owned by simulation entities (Hazards, Pickups). RunView adds it to the scene. */
  readonly entityRoot = new Group();
  readonly disposables = new Disposables();

  input: InputSource = { sample: () => NO_INPUT };
  /** Live camera framing, refreshed by RunView each frame; null headless (spawners assume a default). */
  viewInfo: ViewInfo | null = null;
  /** Current Tier (1-based); only increases. */
  tier: number;
  /** Simulated seconds. */
  time = 0;
  debrisAbsorbed = 0;
  hazardsAbsorbed = 0;
  readonly tierTimes: Record<number, number> = { 1: 0 };
  ended = false;
  endReason: RunEndReason | null = null;

  private systems: System[] = [];
  private perks = new Map<string, number>();

  constructor(
    readonly events: EventBus,
    readonly config: RunConfig,
  ) {
    this.rng = new Rng(config.seed);
    this.difficulty = getDifficulty(config.difficulty);
    this.house = generateHouse(config.seed);

    const character = getCharacter(config.characterId);
    const stats = new StatBlock({ ...BASE_BUNNY_STATS, ...character.stats });
    for (const m of [...difficultyModifiers(this.difficulty), ...(config.modifiers ?? [])]) stats.add(m);
    this.bunny = new Bunny(events, stats, this.house.spawn.x, this.house.spawn.z);
    this.tier = tierForRadius(this.bunny.radius).index;
    for (let t = 2; t <= this.tier; t++) this.tierTimes[t] = 0;

    this.debris = new DebrisField([...DEBRIS_TYPES]);
    this.hazards = new HazardManager(this, this.rng.fork('hazards'));
    this.pickups = new PickupManager(this, this.rng.fork('pickups'));
    this.spawner = new DebrisSpawner(this.rng.fork('debris'));
    this.perkDraft = new PerkDraft(this);

    for (const s of [movementSystem, magnetSystem, this.hazards, absorbSystem, collisionSystem, this.pickups, growthSystem, exitSystem, this.spawner]) {
      this.addSystem(s);
    }

    this.spawner.populate(this);
    this.disposables.add(events.on('bunnyDied', () => this.end('died')));
    for (const id of config.perks ?? []) this.applyPerk(id);
    if (config.area && config.area !== 'house') {
      // Debug / testing start: a Bunny the size it would be after the previous area's boss.
      this.bunny.setRadius(Math.max(this.bunny.radius, areaStartRadius(config.area)));
      this.tier = tierForRadius(this.bunny.radius).index;
      for (let t = 2; t <= this.tier; t++) this.tierTimes[t] = 0;
      this.enterArea(config.area);
    }
  }

  /** Opens the current area's exit once its boss is absorbed (emits exitOpened). */
  openExit(): void {
    if (this.area === 'house') this.houseCleared = true;
    if (this.area === 'neighborhood') this.neighborhoodCleared = true;
    const exit = this.house.exit;
    if (!exit || !openExit(this.house)) return;
    this.events.emit('exitOpened', { area: this.area, x: (exit.rect.minX + exit.rect.maxX) / 2, z: (exit.rect.minZ + exit.rect.maxZ) / 2 });
  }

  /** Moves on through the open exit to the next area (no-op in the last area). */
  enterNextArea(): void {
    const next = nextArea(this.area);
    if (next) this.enterArea(next);
  }

  /** True once the area's exit is open and another area follows (the HUD's skip button shows). */
  get canLeaveArea(): boolean {
    return !this.ended && !!this.house.exit?.open && nextArea(this.area) !== null;
  }

  /**
   * Moves on to the next area once its exit is open, wherever the Bunny is: the HUD's skip
   * button, so a Bunny too big to reach the exit is never stuck. Returns false while the exit
   * is still shut.
   */
  leaveArea(): boolean {
    if (!this.canLeaveArea) return false;
    this.enterNextArea();
    return true;
  }

  /** Leaves the house for the neighborhood (debug / tests; same as enterArea('neighborhood')). */
  enterNeighborhood(): void {
    this.enterArea('neighborhood');
  }

  /** Leaves the neighborhood for the city (debug / tests). */
  enterCity(): void {
    this.enterArea('city');
  }

  /**
   * Moves the Run to a later area: swaps in its layout, clears Debris, Hazards and floor
   * Pickups, puts the Bunny at the area's spawn (healing `difficulty.areaHeal` hearts: 1, none on
   * Hardcore) and repopulates. The Bunny keeps its size, health, Perks and active Pickups. Every
   * earlier area counts as cleared. Emits areaEntered (RunView rebuilds the world view).
   */
  enterArea(area: AreaId): void {
    if (AREA_ORDER.indexOf(area) <= AREA_ORDER.indexOf(this.area)) return;
    this.houseCleared = true;
    if (area === 'city') this.neighborhoodCleared = true;
    this.area = area;
    if (area === 'neighborhood') this.neighborhoodAt = this.time;
    if (area === 'city') this.cityAt = this.time;
    const world = AREA_WORLDS[area];
    this.house = world.generate(this.config.seed);
    this.debris.reset(world.cellSize ?? this.debris.hash.cellSize);
    this.hazards.clear();
    this.pickups.clearFloor();
    this.bunny.teleport(this.house.spawn.x, this.house.spawn.z);
    // Fresh air: arriving in a new area restores a heart (not on Hardcore).
    this.bunny.heal(this.difficulty.areaHeal);
    this.spawner.populate(this);
    this.events.emit('areaEntered', { area: this.area, timeSec: this.time });
  }

  addSystem(system: System): void {
    this.systems.push(system);
    this.systems.sort((a, b) => a.order - b.order);
  }

  removeSystem(id: string): void {
    const i = this.systems.findIndex((s) => s.id === id);
    if (i >= 0) this.systems.splice(i, 1)[0]!.dispose?.();
  }

  getSystem<T extends System = System>(id: string): T | undefined {
    return this.systems.find((s) => s.id === id) as T | undefined;
  }

  update(dt: number): void {
    if (this.ended) return;
    this.bunny.snapshot();
    this.time += dt;
    for (const s of this.systems) {
      s.update(dt, this);
      if (this.ended) break;
    }
  }

  /** Grows the Bunny by an absorbed object and emits debrisAbsorbed. */
  absorbMass(size: number, mass: number, typeId: string, position: Vec3Like, kind: 'debris' | 'hazard'): void {
    const b = this.bunny;
    b.setRadius(growRadius(b.radius, size, mass, b.stats.get('growthMultiplier'), growthFactorAt(b.radius) * AREAS[this.area].growth));
    this.events.emit('debrisAbsorbed', { typeId, size, position, radius: b.radius, kind });
  }

  absorbDebris(d: Debris): void {
    this.debris.remove(d);
    this.debrisAbsorbed++;
    this.absorbMass(d.size, d.type.mass, d.type.id, { x: d.x, y: d.size * 0.5, z: d.z }, 'debris');
  }

  perkStacks(id: string): number {
    return this.perks.get(id) ?? 0;
  }

  applyPerk(id: string): void {
    const def = perkRegistry.require(id);
    const stacks = this.perkStacks(id) + 1;
    this.perks.set(id, stacks);
    def.apply(this, stacks);
    this.events.emit('perkApplied', { perkId: id, stacks });
  }

  getStats(): RunStats {
    return {
      seed: this.config.seed,
      characterId: this.config.characterId,
      difficulty: this.difficulty.id,
      timeSec: this.time,
      maxRadius: this.bunny.maxRadius,
      finalRadius: this.bunny.radius,
      debrisAbsorbed: this.debrisAbsorbed,
      hazardsAbsorbed: this.hazardsAbsorbed,
      tierReached: this.tier,
      tierTimes: { ...this.tierTimes },
      perks: [...this.perks.entries()].flatMap(([id, n]) => Array<string>(n).fill(id)),
      area: this.area,
      houseCleared: this.houseCleared,
      neighborhoodCleared: this.neighborhoodCleared,
    };
  }

  /** Ends the Run once and emits runEnded. */
  end(reason: RunEndReason): void {
    if (this.ended) return;
    this.ended = true;
    this.endReason = reason;
    this.events.emit('runEnded', { reason, stats: this.getStats() });
  }

  dispose(): void {
    for (const s of this.systems) s.dispose?.();
    this.systems = [];
    this.disposables.dispose();
    this.debris.clear();
    this.input = { sample: () => NO_INPUT };
  }
}
