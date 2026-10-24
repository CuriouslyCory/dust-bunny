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
import { TUNING } from '../data/tuning';
import { isLoadoutFor, LOADOUT_SLOTS, type KeepsakeRef, type Loadout } from '../data/keepsakes';
import { tierForRadius } from '../data/tiers';
import { Bunny } from '../entities/bunny';
import { DebrisField, type Debris } from '../entities/debris';
import { BASE_BUNNY_STATS, StatBlock, type StatModifier } from '../entities/stats';
import { HazardManager } from '../hazards';
import { perkRegistry } from '../perks';
import { PerkDraft } from '../perks/draft';
import { pickupRegistry, PickupManager } from '../pickups';
import { absorbSystem, growRadius, growthFactorAt, magnetSystem } from '../systems/absorb';
import { collisionSystem } from '../systems/collision';
import { growthSystem } from '../systems/growth';
import { movementSystem } from '../systems/movement';
import { DebrisSpawner } from '../systems/spawner';
import type { ViewInfo } from '../systems/camera';
import { circleVsRect, clamp } from '../core/math';
import { generateHouse, openExit } from '../world/house';
import { CITY, generateCity } from '../world/city';
import { generateNeighborhood, NEIGHBORHOOD } from '../world/neighborhood';
import { CONTINENT, generateContinent } from '../world/continent';
import { GLOBE, generateGlobe } from '../world/globe';
import { generateSolarSystem, SOLAR } from '../world/solarSystem';
import { GALAXY, generateGalaxy } from '../world/galaxy';
import { generateUniverse, UNIVERSE } from '../world/universe';
import { VoidSlowSystem } from '../systems/voidSlow';
import { WrapSystem } from '../systems/wrap';
import { generateRegion, REGION } from '../world/region';
import { AREA_ORDER, nextArea, type AreaId, type HouseLayout } from '../world/types';
import { canonicalX } from '../world/wrap';
import type { AreaStats, RunEndReason, RunStats } from './runStats';
import { SYSTEM_ORDER, type System } from './system';
import { AreaProgress, type AreaProgressView } from './areaProgress';
import { legacyRunKey, newRunKey, SNAPSHOT_VERSION, type RunSnapshot } from './snapshot';

export interface RunConfig {
  seed: string;
  characterId: string;
  /** Difficulty (missing: casual). */
  difficulty?: DifficultyId;
  /** Start in this area (debug / testing; 'neighborhood' skips the house, later Areas the ones before them). */
  area?: AreaId;
  /** Extra stat modifiers applied at start (permanent Upgrades from the Shop). */
  modifiers?: StatModifier[];
  /** Perks granted at start (debug / testing). Another Character's Perks are skipped. */
  perks?: string[];
  /** Keepsakes tucked in for this Run (0–2, the Character's own types). Fixed for the Run. */
  loadout?: Loadout;
  /**
   * Resume a saved Run (Save & quit): `createRun` restores it once the gameplay rules are
   * installed (`Run.restore`). `perks` is ignored, and so is `area` (still read for ranking: the
   * snapshot's `startArea`).
   */
  resume?: RunSnapshot;
}

/**
 * Layout generator, Debris hash cell (world units) and debug start radius (real cm) per area.
 * Each generator works in its Area's unit (`AREAS[area].unit`).
 */
const AREA_WORLDS: Record<AreaId, { generate: (seed: string) => HouseLayout; cellSize?: number; startRadius: number }> = {
  house: { generate: generateHouse, cellSize: TUNING.debris.cellSize, startRadius: 0 },
  neighborhood: { generate: generateNeighborhood, cellSize: NEIGHBORHOOD.debrisCellSize, startRadius: NEIGHBORHOOD.debugStartRadius },
  city: { generate: generateCity, cellSize: CITY.debrisCellSize, startRadius: CITY.debugStartRadius },
  region: { generate: generateRegion, cellSize: REGION.debrisCellSize, startRadius: REGION.debugStartRadius * areaUnit('region') },
  // Starts at the Incinerator-beaten size; entering the Continent then leaps to its arrival radius.
  continent: { generate: generateContinent, cellSize: CONTINENT.debrisCellSize, startRadius: CONTINENT.debugStartRadiusCm },
  // Starts at the Ice-Sheet-beaten size; entering the Globe then leaps to its arrival radius.
  globe: { generate: generateGlobe, cellSize: GLOBE.debrisCellSize, startRadius: GLOBE.debugStartRadiusCm },
  // Starts at the Orbital-Sweeper-beaten size; entering the Solar System then leaps to its arrival radius.
  solar_system: { generate: generateSolarSystem, cellSize: SOLAR.debrisCellSize, startRadius: SOLAR.debugStartRadiusCm },
  // Starts at the Sun-beaten size; entering the Galaxy then leaps to its arrival radius.
  galaxy: { generate: generateGalaxy, cellSize: GALAXY.debrisCellSize, startRadius: GALAXY.debugStartRadiusCm },
  // Starts at the Sagittarius-A*-beaten size; entering the Universe then leaps to its arrival radius.
  universe: { generate: generateUniverse, cellSize: UNIVERSE.debrisCellSize, startRadius: UNIVERSE.debugStartRadiusCm },
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
  /** The Run's identity (see ./snapshot.ts): new for a fresh Run, the saved one's when resumed. */
  readonly runKey: string;
  /** Difficulty tuning for this Run (Hazards, director, start stats, area heal, Fluff). */
  readonly difficulty: DifficultyDef;
  /** Keepsakes tucked in for this Run (an illegal config Loadout is dropped; `tuckIn` fills an open slot). */
  get loadout(): Loadout {
    return this.tucked;
  }
  /** Current area's layout: the house floor, the neighborhood, the city, the region, the continent, the globe, the solar system, the galaxy, the universe (swapped by enterArea). */
  house: HouseLayout;
  area: AreaId = 'house';
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
  /** Which Areas are cleared and when each was entered (`areaProgress`; changed only through `changeAreas`). */
  private readonly areaState = new AreaProgress();
  private readonly tucked: KeepsakeRef[];
  private perks = new Map<string, number>();
  /** Areas already left, and where the current one started (null only during a debug-area start). */
  private areasDone: AreaStats[] = [];
  private areaStart: { area: AreaId; startSec: number; radiusIn: number; maxRadiusIn: number; debris: number } | null = null;

  constructor(
    readonly events: EventBus,
    readonly config: RunConfig,
  ) {
    this.rng = new Rng(config.seed);
    this.runKey = config.resume ? config.resume.runKey || legacyRunKey(config.resume) : newRunKey();
    this.difficulty = getDifficulty(config.difficulty);
    this.tucked = config.loadout && isLoadoutFor(config.characterId, config.loadout) ? config.loadout.map((k) => ({ ...k })) : [];
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

    for (const s of [new VoidSlowSystem(), movementSystem, magnetSystem, this.hazards, absorbSystem, collisionSystem, this.pickups, growthSystem, exitSystem, new WrapSystem(), this.spawner]) {
      this.addSystem(s);
    }

    this.spawner.populate(this);
    this.disposables.add(events.on('bunnyDied', () => this.end('died')));
    if (config.resume) {
      this.beginArea();
      return;
    }
    for (const id of config.perks ?? []) {
      // Another Character's Perks are skipped (`pnpm sim --perks=` covers every Character).
      const owner = perkRegistry.get(id)?.character;
      if (!owner || owner === config.characterId) this.applyPerk(id);
    }
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
   * Area (the Universe), the Run is won (`victory`, then `runEnded`).
   */
  clearArea(): void {
    if (this.ended) return;
    if (nextArea(this.area) !== null) {
      this.openExit();
      return;
    }
    this.changeAreas((p) => p.clear(this.area));
    this.events.emit('victory', { timeSec: this.time, radius: this.bunny.realRadius });
    this.end('victory');
  }

  /**
   * Applies a change to the Area progress. The black-hole Form follows it: the Bunny turns into a
   * black hole when Sagittarius A* counts as absorbed, and back to dust when the cheats undo that.
   */
  private changeAreas(change: (p: AreaProgress) => void): void {
    const was = this.areaState.blackHole;
    change(this.areaState);
    if (this.areaState.blackHole !== was) this.bunny.form = this.areaState.blackHole ? 'black_hole' : 'dust';
  }

  /** Opens the current area's exit once its boss is absorbed (emits exitOpened). */
  openExit(): void {
    this.changeAreas((p) => p.clear(this.area));
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

  /**
   * Moves the Run to a later area: swaps in its layout, clears Debris, Hazards and floor
   * Pickups, re-bases the Bunny into the new Area's unit (same real size, see `Bunny.rebase`) and,
   * for an Area with an `arrivalRadius` (the Continent, the Globe, the Solar System, the Galaxy, the Universe), leaps it up to that radius (`Bunny.leapTo`,
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
    this.changeAreas((p) => p.enter(area, this.time));
    this.area = area;
    this.arrive(area);
  }

  /**
   * Cheats (src/cheats): moves the Run to any Area, earlier ones included. A later Area is entered
   * as with `enterArea` (the Bunny grown to at least that Area's start size first). An earlier one
   * is entered at its start size (`radius` world units of that Area), and it and every Area after it
   * count as not cleared again, so their bosses come back. The Run's Tier is left as it is.
   */
  jumpToArea(area: AreaId, radius: number): void {
    if (this.ended || area === this.area) return;
    const to = AREA_ORDER.indexOf(area);
    if (to > AREA_ORDER.indexOf(this.area)) {
      if (this.bunny.realRadius < areaStartRadius(area)) this.bunny.setRadius(areaStartRadius(area) / this.bunny.unit);
      this.enterArea(area);
      return;
    }
    this.changeAreas((p) => p.rewindTo(area, this.time));
    this.areasDone = this.areasDone.filter((s) => AREA_ORDER.indexOf(s.area) < to);
    this.area = area;
    this.arrive(area, radius);
  }

  /** Swaps in `area`'s world and puts the Bunny at its spawn (at `radius` world units, if given). */
  private arrive(area: AreaId, radius?: number): void {
    const world = AREA_WORLDS[area];
    this.house = world.generate(this.config.seed);
    this.debris.reset(world.cellSize ?? this.debris.hash.cellSize);
    this.hazards.clear();
    this.pickups.clearFloor();
    this.bunny.rebase(AREAS[area].unit);
    const arrival = AREAS[area].arrivalRadius;
    if (radius !== undefined) {
      this.bunny.setRadius(radius);
      this.bunny.maxRadius = this.bunny.radius;
    } else if (arrival !== undefined) this.bunny.leapTo(arrival);
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
      loadout: this.tucked.map((k) => ({ ...k })),
    };
  }

  /** `area`'s boss has been absorbed (for the last Area: the Run was won). */
  isAreaCleared(area: AreaId): boolean {
    return this.areaState.isCleared(area);
  }

  /** Which Areas are cleared, when each was entered, the furthest cleared. */
  get areaProgress(): AreaProgressView {
    return this.areaState;
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
    this.spawner.noteAbsorbed(d);
    this.debris.remove(d);
    this.debrisAbsorbed++;
    this.absorbMass(d.size, d.type.mass, d.type.id, { x: d.x, y: d.size * 0.5, z: d.z }, 'debris');
  }

  /** Perk stacks taken so far (resumed ones included); changes whenever a Perk is applied. */
  get perkVersion(): number {
    let n = 0;
    for (const v of this.perks.values()) n += v;
    return n;
  }

  perkStacks(id: string): number {
    return this.perks.get(id) ?? 0;
  }

  /** Applies one stack of a Perk (emits perkApplied unless `silent`: a resumed Run's Perks). */
  applyPerk(id: string, silent = false): void {
    const def = perkRegistry.require(id);
    const stacks = this.perkStacks(id) + 1;
    this.perks.set(id, stacks);
    def.apply(this, stacks);
    if (!silent) this.events.emit('perkApplied', { perkId: id, stacks });
  }

  /** What Save & quit keeps of the Run (see ./snapshot.ts). The Run itself is left untouched. */
  toSnapshot(): RunSnapshot {
    const b = this.bunny;
    return {
      version: SNAPSHOT_VERSION,
      savedAt: Date.now(),
      runKey: this.runKey,
      seed: this.config.seed,
      characterId: this.config.characterId,
      difficulty: this.difficulty.id,
      modifiers: (this.config.modifiers ?? []).map((m) => ({ ...m })),
      loadout: this.loadout.map((k) => ({ ...k })),
      ...(this.config.area ? { startArea: this.config.area } : {}),
      area: this.area,
      areaCleared: this.areaCleared,
      time: this.time,
      tier: this.tier,
      tierTimes: { ...this.tierTimes },
      debrisAbsorbed: this.debrisAbsorbed,
      hazardsAbsorbed: this.hazardsAbsorbed,
      areaTimes: this.areaState.entryTimes(),
      areasDone: this.areasDone.map((a) => ({ ...a })),
      areaStart: this.areaStart ? { ...this.areaStart } : null,
      bunny: {
        x: canonicalX(this.house, b.x),
        z: b.z,
        realRadius: b.realRadius,
        maxRealRadius: b.maxRadius * b.unit,
        health: b.health,
        shield: b.shield,
        revives: b.revives,
        form: b.form,
        heading: b.heading,
      },
      perks: Object.fromEntries(this.perks),
      perkDraft: { pending: this.perkDraft.pending, rerollsUsed: this.perkDraft.rerollsUsed },
      pickups: this.pickups.active.map((e) => ({ id: e.def.id, remaining: e.remaining })),
      placementsGone: this.spawner.placementsGone(),
      stats: this.getStats(),
    };
  }

  /**
   * Puts a saved Run back (Save & quit → Resume), right after construction (`createRun` calls it
   * once the gameplay rules are installed): rebuilds the saved Area from the seed (earlier Areas
   * count as cleared, an absorbed boss leaves the exit open), restores the Bunny's size, position,
   * health and charges, the Perks (without perkApplied), the timed Pickups, the clock, the counters
   * and pending Perk drafts, then repopulates the Area (skipping fixed placements already absorbed and
   * keeping the Bunny's own spot clear). Emits no area or growth events.
   */
  restore(s: RunSnapshot): void {
    this.time = s.time;
    this.debrisAbsorbed = s.debrisAbsorbed;
    this.hazardsAbsorbed = s.hazardsAbsorbed;
    this.changeAreas((p) => p.resume(s.area, s.areaTimes));
    this.area = s.area;
    const world = AREA_WORLDS[s.area];
    this.house = world.generate(this.config.seed);
    this.debris.reset(world.cellSize ?? this.debris.hash.cellSize);
    this.hazards.clear();
    this.pickups.clearFloor();

    for (const [id, n] of Object.entries(s.perks)) {
      if (!perkRegistry.has(id)) continue;
      for (let i = 0; i < n; i++) this.applyPerk(id, true);
    }
    for (const p of s.pickups) {
      const def = pickupRegistry.get(p.id);
      if (!def) continue;
      this.pickups.activate(def);
      const e = this.pickups.active.find((a) => a.def.id === p.id);
      if (e) e.remaining = clamp(p.remaining, 0, e.duration);
    }

    const b = this.bunny;
    b.rebase(AREAS[s.area].unit);
    b.radius = b.prevRadius = s.bunny.realRadius / b.unit;
    b.maxRadius = Math.max(b.radius, s.bunny.maxRealRadius / b.unit);
    b.form = s.bunny.form;
    b.heading = s.bunny.heading;
    // Hits can leave fractions (Amass's guard); a living Bunny never resumes at 0.
    b.health = s.bunny.health > 0 ? Math.min(s.bunny.health, b.maxHealth) : b.maxHealth;
    b.shield = Math.max(0, s.bunny.shield);
    b.revives = Math.max(0, s.bunny.revives);
    const bd = this.house.bounds;
    b.teleport(clamp(s.bunny.x, bd.minX, bd.maxX), clamp(s.bunny.z, bd.minZ, bd.maxZ));
    this.tier = Math.max(s.tier, 1);
    for (const k of Object.keys(this.tierTimes)) delete this.tierTimes[Number(k)];
    Object.assign(this.tierTimes, s.tierTimes);

    this.spawner.populate(this, new Set(s.placementsGone));
    // The Bunny's own spot stays clear: nothing respawns inside it.
    for (const d of this.debris.query(b.x, b.z, b.radius + this.debris.maxSize, [])) {
      if ((d.x - b.x) ** 2 + (d.z - b.z) ** 2 < (b.radius + d.size) ** 2) this.debris.remove(d);
    }

    this.areasDone = s.areasDone.map((a) => ({ ...a }));
    if (s.areaStart?.area === s.area) this.areaStart = { ...s.areaStart };
    else this.beginArea();
    if (s.areaCleared && nextArea(this.area) !== null) {
      this.changeAreas((p) => p.clear(this.area));
      openExit(this.house);
    }
    this.perkDraft.rerollsUsed = Math.max(0, s.perkDraft.rerollsUsed);
    this.perkDraft.queue(Math.max(0, Math.round(s.perkDraft.pending)));
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
      ...this.areaState.clearedFlags(),
      areas: this.areaStart ? [...this.areasDone, this.currentAreaStats(this.areaCleared)] : [...this.areasDone],
      loadout: this.loadout.map((k) => ({ ...k })),
    };
  }

  /** Loadout slots still empty (0 once the Run has ended). */
  get openLoadoutSlots(): number {
    return this.ended ? 0 : LOADOUT_SLOTS - this.tucked.length;
  }

  /**
   * Tucks a Keepsake into an open Loadout slot for the rest of the Run (a boss drop, from the
   * Keepsake reveal) and emits keepsakeTuckedIn, so the Ability params and Keepsake effects pick it
   * up. False when no slot is open, the Run has ended, or the Keepsake isn't this Character's.
   */
  tuckIn(ref: KeepsakeRef): boolean {
    if (this.openLoadoutSlots <= 0) return false;
    const next = [...this.tucked, { type: ref.type, rarity: ref.rarity }];
    if (!isLoadoutFor(this.config.characterId, next)) return false;
    this.tucked.push(next[next.length - 1]!);
    this.events.emit('keepsakeTuckedIn', { characterId: this.config.characterId, ref: { ...ref }, loadout: this.tucked.map((k) => ({ ...k })) });
    return true;
  }

  /** Ends the Run once and emits runEnded. */
  end(reason: RunEndReason): void {
    if (this.ended) return;
    this.ended = true;
    this.endReason = reason;
    this.events.emit('runEnded', { runKey: this.runKey, reason, stats: this.getStats() });
  }

  dispose(): void {
    for (const s of this.systems) s.dispose?.();
    this.systems = [];
    this.disposables.dispose();
    this.debris.clear();
    this.input = { sample: () => NO_INPUT };
  }
}
