/**
 * Run: one play session's simulation state. Headless (no DOM, no WebGL), so it can be
 * driven by tests and the balance bot (scripts/sim.ts). Rendering lives in RunView.
 */
import { Group } from 'three';
import { Disposables, type EventBus, type Vec3Like } from '../core/events';
import { NO_INPUT, type InputSource, type InputState } from '../core/input';
import { Rng } from '../core/rng';
import { AREAS, areaUnit } from '../data/areas';
import { CAP_PRIORITY, getCharacter } from '../data/characters';
import { difficultyModifiers, getDifficulty, type DifficultyDef, type DifficultyId } from '../data/difficulty';
import { DEBRIS_TYPES } from '../data/debris';
import { isLoadoutFor, type Loadout } from '../data/keepsakes';
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
import { CONTINENT, generateContinent } from '../world/continent';
import { GLOBE, generateGlobe } from '../world/globe';
import { WrapSystem } from '../systems/wrap';
import { generateRegion, REGION } from '../world/region';
import { AREA_ORDER, nextArea, type AreaId, type HouseLayout } from '../world/types';
import { canonicalX } from '../world/wrap';
import type { AreaStats, RunEndReason, RunStats } from './runStats';
import { SYSTEM_ORDER, type System } from './system';

export interface RunConfig {
  seed: string;
  characterId: string;
  /** Difficulty (missing: casual). */
  difficulty?: DifficultyId;
  /** Start in this area (debug / testing; 'neighborhood' skips the house, later Areas the ones before them). */
  area?: AreaId;
  /** Extra stat modifiers applied at start (permanent Upgrades from the Shop). */
  modifiers?: StatModifier[];
  /** Perks granted at start (debug / testing). */
  perks?: string[];
  /** Keepsakes tucked in for this Run (0–2, the Character's own types). Fixed for the Run. */
  loadout?: Loadout;
}

/**
 * Layout generator, Debris hash cell (world units) and debug start radius (real cm) per area.
 * Each generator works in its Area's unit (`AREAS[area].unit`).
 */
const AREA_WORLDS: Record<AreaId, { generate: (seed: string) => HouseLayout; cellSize?: number; startRadius: number }> = {
  house: { generate: generateHouse, startRadius: 0 },
  neighborhood: { generate: generateNeighborhood, cellSize: NEIGHBORHOOD.debrisCellSize, startRadius: NEIGHBORHOOD.debugStartRadius },
  city: { generate: generateCity, cellSize: CITY.debrisCellSize, startRadius: CITY.debugStartRadius },
  region: { generate: generateRegion, cellSize: REGION.debrisCellSize, startRadius: REGION.debugStartRadius * areaUnit('region') },
  // Starts at the Incinerator-beaten size; entering the Continent then leaps to its arrival radius.
  continent: { generate: generateContinent, cellSize: CONTINENT.debrisCellSize, startRadius: CONTINENT.debugStartRadiusCm },
  // Starts at the Ice-Sheet-beaten size; entering the Globe then leaps to its arrival radius.
  globe: { generate: generateGlobe, cellSize: GLOBE.debrisCellSize, startRadius: GLOBE.debugStartRadiusCm },
};

/** Real Bunny radius (cm) a Run starting in `area` begins with (about the size after the previous boss). */
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
    // The exit is stored once on a wrap-around map: test the Bunny's canonical copy.
    if (circleVsRect(canonicalX(run.house, b.x), b.z, b.radius + Math.max(6 / b.unit, b.radius * 0.05), exit.rect) !== null) run.enterNextArea();
  },
};

export class Run {
  readonly rng: Rng;
  /** Difficulty tuning for this Run (Hazards, director, start stats, area heal, Fluff). */
  readonly difficulty: DifficultyDef;
  /** Keepsakes tucked in for this Run (an illegal config Loadout is dropped). */
  readonly loadout: Loadout;
  /** Current area's layout: the house floor, the neighborhood, the city, the region, the continent, the globe (swapped by enterArea). */
  house: HouseLayout;
  area: AreaId = 'house';
  /** The Robo-Vac 9000 has been absorbed and the front door is open. */
  houseCleared = false;
  /** The Street Sweeper has been absorbed and the road to the city is open. */
  neighborhoodCleared = false;
  /** The Garbage Truck has been absorbed and the highway on-ramp to the region is open. */
  cityCleared = false;
  /** The Incinerator has been absorbed and the motorway west to the continent is open. */
  regionCleared = false;
  /** The Ice Sheet has been absorbed and the launch corridor up to orbit is open. */
  continentCleared = false;
  /** The Orbital Sweeper has been absorbed (the last built Area: the Run is won). */
  globeCleared = false;
  /** Simulated second at which the Run entered the neighborhood (null while in the house). */
  neighborhoodAt: number | null = null;
  /** Simulated second at which the Run entered the city (null before). */
  cityAt: number | null = null;
  /** Simulated second at which the Run entered the region (null before). */
  regionAt: number | null = null;
  /** Simulated second at which the Run entered the continent (null before). */
  continentAt: number | null = null;
  /** Simulated second at which the Run entered the globe (null before). */
  globeAt: number | null = null;
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
  /** This tick's input, sampled once at the start of update() (movement, the Ability System). */
  inputState: InputState = NO_INPUT;
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
  /** Areas already left, and where the current one started (null only during a debug-area start). */
  private areasDone: AreaStats[] = [];
  private areaStart: { area: AreaId; startSec: number; radiusIn: number; maxRadiusIn: number; debris: number } | null = null;

  constructor(
    readonly events: EventBus,
    readonly config: RunConfig,
  ) {
    this.rng = new Rng(config.seed);
    this.difficulty = getDifficulty(config.difficulty);
    this.loadout = config.loadout && isLoadoutFor(config.characterId, config.loadout) ? config.loadout.map((k) => ({ ...k })) : [];
    this.house = generateHouse(config.seed);

    const character = getCharacter(config.characterId);
    const stats = new StatBlock({ ...BASE_BUNNY_STATS, ...character.stats }, { caps: character.caps, capPriority: CAP_PRIORITY });
    for (const m of [...difficultyModifiers(this.difficulty), ...(config.modifiers ?? [])]) stats.add(m);
    this.bunny = new Bunny(events, stats, this.house.spawn.x, this.house.spawn.z);
    this.tier = tierForRadius(this.bunny.realRadius).index;
    for (let t = 2; t <= this.tier; t++) this.tierTimes[t] = 0;

    this.debris = new DebrisField([...DEBRIS_TYPES]);
    this.hazards = new HazardManager(this, this.rng.fork('hazards'));
    this.pickups = new PickupManager(this, this.rng.fork('pickups'));
    this.spawner = new DebrisSpawner(this.rng.fork('debris'));
    this.perkDraft = new PerkDraft(this);

    for (const s of [movementSystem, magnetSystem, this.hazards, absorbSystem, collisionSystem, this.pickups, growthSystem, exitSystem, new WrapSystem(), this.spawner]) {
      this.addSystem(s);
    }

    this.spawner.populate(this);
    this.disposables.add(events.on('bunnyDied', () => this.end('died')));
    for (const id of config.perks ?? []) this.applyPerk(id);
    if (!config.area || config.area === 'house') this.beginArea();
    if (config.area && config.area !== 'house') {
      // Debug / testing start: a Bunny the size it would be after the previous area's boss.
      this.bunny.setRadius(Math.max(this.bunny.radius, areaStartRadius(config.area)));
      this.tier = tierForRadius(this.bunny.realRadius).index;
      for (let t = 2; t <= this.tier; t++) this.tierTimes[t] = 0;
      this.enterArea(config.area);
    }
  }

  /** Centimetres per world unit in the current Area. */
  get unit(): number {
    return areaUnit(this.area);
  }

  /**
   * The current Area's boss was absorbed: its exit opens onto the next Area, or, in the last
   * built Area, the Run is won (`victory`, then `runEnded`). Victory moves to the end of the last
   * Act once it exists (docs/story.md).
   */
  clearArea(): void {
    if (this.ended) return;
    if (nextArea(this.area) !== null) {
      this.openExit();
      return;
    }
    this.markCleared(this.area);
    this.events.emit('victory', { timeSec: this.time, radius: this.bunny.realRadius });
    this.end('victory');
  }

  private markCleared(area: AreaId): void {
    if (area === 'house') this.houseCleared = true;
    if (area === 'neighborhood') this.neighborhoodCleared = true;
    if (area === 'city') this.cityCleared = true;
    if (area === 'region') this.regionCleared = true;
    if (area === 'continent') this.continentCleared = true;
    if (area === 'globe') this.globeCleared = true;
  }

  /** Opens the current area's exit once its boss is absorbed (emits exitOpened). */
  openExit(): void {
    this.markCleared(this.area);
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

  /** Leaves the city for the region (debug / tests). */
  enterRegion(): void {
    this.enterArea('region');
  }

  /** Leaves the region for the continent (debug / tests). */
  enterContinent(): void {
    this.enterArea('continent');
  }

  /** Leaves the continent for the globe (debug / tests). */
  enterGlobe(): void {
    this.enterArea('globe');
  }

  /**
   * Moves the Run to a later area: swaps in its layout, clears Debris, Hazards and floor
   * Pickups, re-bases the Bunny into the new Area's unit (same real size, see `Bunny.rebase`) and,
   * for an Area with an `arrivalRadius` (the Continent, the Globe), leaps it up to that radius (`Bunny.leapTo`,
   * not growth: the Area's stats start after it), puts it at the area's spawn (healing
   * `difficulty.areaHeal` hearts: 1, none on Hardcore) and repopulates. The Bunny keeps its size, health, Perks and active Pickups. Every earlier area
   * counts as cleared. Emits areaEntered (RunView rebuilds the world view).
   */
  enterArea(area: AreaId): void {
    if (AREA_ORDER.indexOf(area) <= AREA_ORDER.indexOf(this.area)) return;
    if (this.areaStart) {
      const done = this.currentAreaStats(true);
      this.areasDone.push(done);
      this.events.emit('areaCompleted', { stats: done, characterId: this.config.characterId, difficulty: this.difficulty.id });
    }
    for (const a of AREA_ORDER.slice(0, AREA_ORDER.indexOf(area))) this.markCleared(a);
    this.area = area;
    if (area === 'neighborhood') this.neighborhoodAt = this.time;
    if (area === 'city') this.cityAt = this.time;
    if (area === 'region') this.regionAt = this.time;
    if (area === 'continent') this.continentAt = this.time;
    if (area === 'globe') this.globeAt = this.time;
    const world = AREA_WORLDS[area];
    this.house = world.generate(this.config.seed);
    this.debris.reset(world.cellSize ?? this.debris.hash.cellSize);
    this.hazards.clear();
    this.pickups.clearFloor();
    this.bunny.rebase(AREAS[area].unit);
    const arrival = AREAS[area].arrivalRadius;
    if (arrival !== undefined) this.bunny.leapTo(arrival);
    this.bunny.teleport(this.house.spawn.x, this.house.spawn.z);
    // Fresh air: arriving in a new area restores a heart (not on Hardcore).
    this.bunny.heal(this.difficulty.areaHeal);
    this.spawner.populate(this);
    this.beginArea();
    this.events.emit('areaEntered', { area: this.area, timeSec: this.time });
  }

  private beginArea(): void {
    const b = this.bunny;
    this.areaStart = { area: this.area, startSec: this.time, radiusIn: b.radius, maxRadiusIn: b.maxRadius, debris: this.debrisAbsorbed };
  }

  /** Stats of the Area the Run is in, as if it were left now (radii in that Area's unit). */
  private currentAreaStats(cleared: boolean): AreaStats {
    const a = this.areaStart!;
    return {
      area: a.area,
      startSec: a.startSec,
      timeSec: this.time - a.startSec,
      radiusIn: a.radiusIn,
      // bunny.maxRadius is Run-wide: if it rose here it is this Area's peak, otherwise take the larger of entry and now.
      maxRadius: this.bunny.maxRadius > a.maxRadiusIn ? this.bunny.maxRadius : Math.max(a.radiusIn, this.bunny.radius),
      debrisAbsorbed: this.debrisAbsorbed - a.debris,
      cleared,
    };
  }

  /** `area`'s boss has been absorbed (for the last built Area: the Run was won). */
  isAreaCleared(area: AreaId): boolean {
    if (area === 'house') return this.houseCleared;
    if (area === 'neighborhood') return this.neighborhoodCleared;
    if (area === 'city') return this.cityCleared;
    if (area === 'region') return this.regionCleared;
    if (area === 'continent') return this.continentCleared;
    return this.globeCleared;
  }

  /** The current Area's boss has been absorbed. */
  private get areaCleared(): boolean {
    return this.isAreaCleared(this.area);
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
    this.inputState = this.input.sample();
    for (const s of this.systems) {
      s.update(dt, this);
      if (this.ended) break;
    }
  }

  /** Grows the Bunny by an absorbed object and emits debrisAbsorbed. */
  absorbMass(size: number, mass: number, typeId: string, position: Vec3Like, kind: 'debris' | 'hazard'): void {
    const b = this.bunny;
    b.setRadius(growRadius(b.radius, size, mass, b.stats.get('growthMultiplier'), growthFactorAt(b.realRadius) * AREAS[this.area].growth));
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
      maxRadius: this.bunny.maxRadius * this.bunny.unit,
      finalRadius: this.bunny.realRadius,
      debrisAbsorbed: this.debrisAbsorbed,
      hazardsAbsorbed: this.hazardsAbsorbed,
      tierReached: this.tier,
      tierTimes: { ...this.tierTimes },
      perks: [...this.perks.entries()].flatMap(([id, n]) => Array<string>(n).fill(id)),
      area: this.area,
      houseCleared: this.houseCleared,
      neighborhoodCleared: this.neighborhoodCleared,
      cityCleared: this.cityCleared,
      regionCleared: this.regionCleared,
      continentCleared: this.continentCleared,
      globeCleared: this.globeCleared,
      areas: this.areaStart ? [...this.areasDone, this.currentAreaStats(this.areaCleared)] : [...this.areasDone],
      loadout: this.loadout.map((k) => ({ ...k })),
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
