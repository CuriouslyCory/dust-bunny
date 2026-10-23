/**
 * Headless balance bot. Plays Runs like a competent player: it plans paths on a coarse
 * occupancy grid (walls, furniture it cannot roll under, Obstacle Debris), heads for the best
 * absorbable Debris it can see, sidesteps Hazard telegraphs, drafts a random Perk at each
 * Tier-up, grabs Pickups it passes and fights the boss by dodging charges and ramming it
 * while stunned (against Sagittarius A* it leaves star clusters for the boss to choke on, and
 * against a Pulsar it backs out of reach of the lit beams; it steps off a Gamma-ray burst's locked
 * lane). Against the Expansion (no body: nothing to dodge or ram) it keeps eating the best Debris
 * in view, chasing absorbable Hazards and Pickups only close by, and the log shows its bar every
 * 15 s, Big Rips and, per Character, the fight's length (spawn → collapse). Prints when each Tier
 * is reached, plus how the Run ended, and boss stuns by cause.
 *
 * When an area boss falls (Robo-Vac 9000, Street Sweeper, Garbage Truck, Incinerator, Ice Sheet, Orbital Sweeper, the Sun, Sagittarius A*) the bot does not walk to
 * the exit: the Run moves straight to the next area (logged), so outdoor, city, region, continent, globe, solar system, galaxy and universe pacing
 * are measured too. The summary prints each Area's median time from entry to its clear (the Act).
 * With --no-hazards a Run stops at each Area's boss Tier (no boss to clear), but keeps rolling in
 * the last Area until --minutes so growth towards the boss size is measured.
 *
 * Abilities: Lint drops a Decoy when a boss telegraph or a Broom sweep targets it, or a vacuum
 * cone or spray lane is about to hit it (--decoy=boss: only the first two, the issue's policy).
 * Tumble Amasses while a boss charge lane crosses it (for the crash stun), when a Hazard it can
 * swallow is close, or when enough absorbable Debris lies around it (--amass=boss: boss lanes
 * only); it lets go early when a vacuum cone is about to catch it (suction pulls harder while
 * channelling). Lint's default beats the issue's policy over 60 seeds (20 → 27 wins). Zap discharges at the nearest Hazard
 * in range once the Static meter is full. --no-ability plays without Abilities (for comparison).
 * The summary also counts boss fights and boss kills per Character. --boss plays only the house
 * boss fight: the Run starts just past the Robo-Vac's arrival size (fresh Bunny, four random
 * Perks) and stops when the Robo-Vac 9000 is beaten, so `wins` there is the boss win rate.
 *
 * Keepsakes: --loadout=<type>:<rarity>,<type>:<rarity> tucks those Keepsakes in for the Character
 * they belong to (the other Characters play without); --loadout=max gives every Character its
 * MAX_LOADOUTS pair at mythic (the strongest legal pair: any boss can drop mythic, see MAX_LOADOUTS).
 * Rarities can be given as 1–5 or by id (--loadout=arc:epic).
 *
 * Leaderboards: --validate builds the Run board and Area board submissions every Run would post
 * (submissionFromRun / areaSubmission) and checks them with validateSubmission /
 * validateAreaSubmission, printing each rejection and, per Character, the closest a Run came to
 * the growth limits (radius reached ÷ radius allowed for the time; 100% = rejected). Runs that
 * start at Tier 5 (--boss) or in a later area (--area) are unranked and not checked.
 *
 * Usage: pnpm sim [seed ...] [--seeds=N] [--minutes=15] [--chars=lint,tumble,zap] [--no-hazards] [--no-ability]
 *                 [--eat=near] [--sight=S]   head for the nearest absorbable Debris instead of the best, seen within S × the view radius (a casual player)
 *                 [--amass=feed|boss] [--decoy=defend|boss] [--boss] [--no-boss [--shares=0.8,0.85]] [--quiet] [--stalls] [--god] [--perks=id,id] [--upgrades=id:level,...]
 *                 [--area=neighborhood|city|region|continent|globe|solar_system|galaxy|universe]   start in a later area (as after its previous boss)
 *                 [--radius=R]   start the Bunny at radius R in the start Area's units (unranked)
 *                 [--difficulty=casual|arcade|hardcore]
 *                 [--loadout=type:rarity,type:rarity | --loadout=max] [--validate]
 *   --seeds=N plays seeds s1 … sN when no seed is given (default: alpha … echo).
 */
import { getAbilitySystem, type AmassAbility, type DecoyAbility, type DischargeAbility } from '../src/abilities';
import { EventBus } from '../src/core/events';
import type { InputSource, InputState } from '../src/core/input';
import { Rng } from '../src/core/rng';
import { AREAS } from '../src/data/areas';
import { TIERS } from '../src/data/tiers';
import { formatLength } from '../src/data/units';
import { AREA_ORDER, nextArea, type AreaId } from '../src/world/types';
import { TUNING } from '../src/data/tuning';
import type { Debris } from '../src/entities/debris';
import { createRun } from '../src/game/assembly';
import type { Run } from '../src/game/run';
import type { Hazard } from '../src/hazards';
import { RoboVac9000 } from '../src/hazards/robovac';
import { GammaRayBurst, inBurst } from '../src/hazards/gammaRayBurst';
import { TheExpansion } from '../src/hazards/theExpansion';
import { SprayBottle as SprayBottleClass, type SprayBottle } from '../src/hazards/sprayBottle';
import { inCone, UprightVacuum as UprightVacuumClass, type UprightVacuum } from '../src/hazards/uprightVacuum';
import { Broom as BroomClass, type Broom } from '../src/hazards/broom';
import { inBeam, Pulsar } from '../src/hazards/pulsar';
import { SagittariusA } from '../src/hazards/sagittariusA';
import { getDifficulty } from '../src/data/difficulty';
import { AREA_BOSSES, bossAbsorbRadius, bossArrivalRadius, BROOM, tierValue } from '../src/data/hazards';
import { getHazardDirector } from '../src/game/assembly';
import { getKeepsakeType, isLoadoutFor, MAX_RARITY, rarityFromId, type KeepsakeRef, type KeepsakeTypeId, type Loadout } from '../src/data/keepsakes';
import { areaSubmission, submissionFromRun } from '../src/net/leaderboard';
import { areaRadiusAllowed, runRadiusAllowed, validateAreaSubmission, validateSubmission } from '../src/shared/leaderboard';
import { progressRadius } from '../src/shared/score';
import { fluffForRun } from '../src/meta/fluff';
import { upgradeModifiers } from '../src/meta/upgrades';
import { canAbsorb, debrisLocked } from '../src/systems/absorb';
import { viewRadiusFor } from '../src/systems/camera';
import { passesUnder } from '../src/systems/collision';
import { reachableBy } from '../src/systems/spawner';
import { wrapWidth } from '../src/world/wrap';

const args = process.argv.slice(2);
const opt = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const minutes = Number(opt('minutes') ?? 15);
const chars = (opt('chars') ?? 'lint,tumble,zap').split(',');
const withHazards = !args.includes('--no-hazards');
const withAbility = !args.includes('--no-ability');
/** Tumble's Amass policy: 'feed' (default: boss lanes, swallowable Hazards and Debris-rich spots) or 'boss' (boss lanes only). */
const amassPolicy = opt('amass') === 'boss' ? 'boss' : 'feed';
/** 'feed' Amasses when at least this many absorbable Debris lie within AMASS_FEED_RANGE r. */
const AMASS_FEED_COUNT = 14;
const AMASS_FEED_RANGE = 8;
/** 'feed' Amasses when a swallowable Hazard's edge is within this many r. */
const AMASS_SWALLOW_RANGE = 3;
/** Lint's Decoy policy: 'defend' (default: boss telegraphs, Broom aggro, and vacuum cones or spray lanes about to hit) or 'boss' (the first two only, the issue's policy). */
const decoyPolicy = opt('decoy') === 'boss' ? 'boss' : 'defend';
const ALL_HITS: ReadonlySet<'vacuum' | 'spray' | 'broom'> = new Set(['vacuum', 'spray', 'broom']);
const VACUUM_HITS: ReadonlySet<'vacuum' | 'spray' | 'broom'> = new Set(['vacuum']);
/** Boss fight only: start the house at Tier 5 (the Robo-Vac 9000 arrives 3 s later) and stop when it falls. */
const bossOnly = args.includes('--boss');
/**
 * --no-boss: bosses never arrive (Hazards and Pickups still do); an Area is cleared once the Bunny
 * could absorb its boss, and the summary shows how long growing to that radius took from each
 * share of it (for tuning `AreaBoss.lead`).
 */
const noBoss = args.includes('--no-boss');
/** Shares of the absorb radius timed by --no-boss (--shares=0.8,0.85,… to override; 1 is always added). */
const GROWTH_SHARES: readonly number[] = [...(opt('shares')?.split(',').map(Number) ?? [0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9]), 1];
const quiet = args.includes('--quiet');
const stalls = args.includes('--stalls');
/** --eat=near: head for the nearest absorbable Debris, whatever its size (a casual player), instead of the best. */
const eatNear = opt('eat') === 'near';
/** --sight=S: the bot only looks for Debris within S × the view radius (default 1; a casual player watches round the Bunny). */
const sight = Number(opt('sight') ?? 1);
/** Hazards hit as usual (knockback, shedding) but can't kill: measures pacing, not survival. */
const god = args.includes('--god');
const traceAt = opt('trace') === undefined ? undefined : Number(opt('trace'));
const fixedPerks = opt('perks')?.split(',');
const upgrades = Object.fromEntries((opt('upgrades') ?? '').split(',').filter(Boolean).map((s) => [s.split(':')[0]!, Number(s.split(':')[1] ?? 1)]));
const startArea = AREA_ORDER.includes(opt('area') as AreaId) && opt('area') !== 'house' ? (opt('area') as AreaId) : undefined;
const difficulty = getDifficulty(opt('difficulty')).id;
/** --radius=R: the Bunny starts at radius R (the start Area's units), e.g. --area=globe --radius=3.05 starts at Tier 15 for the boss fight. */
const startRadius = opt('radius') === undefined ? undefined : Number(opt('radius'));
const seeds = args.filter((a) => !a.startsWith('--'));
const seedCount = Number(opt('seeds') ?? 0);
if (seeds.length === 0 && seedCount > 0) for (let i = 1; i <= seedCount; i++) seeds.push(`s${i}`);
if (seeds.length === 0) seeds.push('alpha', 'bravo', 'charlie', 'delta', 'echo');
const validate = args.includes('--validate') && !bossOnly && !startArea;

/**
 * --loadout=max: the strongest legal pair per Character, at mythic. Chosen by playing every pair
 * of that Character's types (duplicates included, 15 per Character) at grade 4 of the old 1–10 scale (rare) over seeds s1–s30
 * (--minutes=25, default bot policies) and taking the most wins, then the fastest median win:
 * Lint Quick Shed + Reclaim (18/30 wins, base 12/30), Tumble (see below), Zap
 * Static Cling + Grounding (26/30 in 14:02, base 21/30 in 14:57). Re-run that search when
 * Keepsake values or the bot change (docs/design.md "Keepsake effects").
 */
const MAX_LOADOUTS: Record<string, readonly [KeepsakeTypeId, KeepsakeTypeId]> = {
  lint: ['quick_shed', 'reclaim'],
  tumble: ['feast', 'dense_core'],
  zap: ['static_cling', 'grounding'],
};

/** The Loadout --loadout gives a Character ([] without the flag or when no listed type is its own). */
function loadoutFor(characterId: string): Loadout {
  const spec = opt('loadout');
  if (!spec) return [];
  if (spec === 'max') return (MAX_LOADOUTS[characterId] ?? []).map((type) => ({ type, rarity: MAX_RARITY }));
  const refs: KeepsakeRef[] = spec.split(',').filter(Boolean).map((s) => {
    const [type, g] = s.split(':');
    if (!type || !getKeepsakeType(type)) throw new Error(`--loadout: unknown Keepsake type "${type}"`);
    return { type: type as KeepsakeTypeId, rarity: g === undefined ? MAX_RARITY : (rarityFromId(g) ?? Number(g)) };
  });
  const own = refs.filter((k) => getKeepsakeType(k.type)!.characterId === characterId);
  if (!isLoadoutFor(characterId, own)) throw new Error(`--loadout: not a legal Loadout for ${characterId}: ${spec}`);
  return own;
}

/**
 * Occupancy grid for a Bunny of a given radius, with BFS path distances from the Bunny. On a map
 * that wraps east–west (the Globe) the grid is one lap centred on the Bunny when it was built
 * (`originX`), columns wrap, and only the poles are a rim.
 */
class Planner {
  cell = 4;
  private originX = 0;
  private lapW = 0;
  private builtLayout: unknown = null;
  cols = 0;
  rows = 0;
  private blocked = new Uint8Array(0);
  private dist = new Int32Array(0);
  private parent = new Int32Array(0);
  private builtFor = -1;
  private builtAt = -1;

  constructor(private readonly run: Run) {}

  /** Rebuilds occupancy when the Bunny has grown noticeably (or every few seconds for Debris). */
  ensure(): void {
    const r = this.run.bunny.radius;
    const house = this.run.house;
    if (this.builtLayout === house && this.builtFor > 0 && r < this.builtFor * 1.08 && r > this.builtFor * 0.92 && this.run.time - this.builtAt < 4) return;
    this.builtFor = r;
    this.builtAt = this.run.time;
    this.builtLayout = house;
    const bd = house.bounds;
    // World units: cm up to the City; Areas seen from altitude (the Region's 10 m, the Continent's
    // 10 km) re-base the Bunny to house size again, so they share the Region's grid.
    const altitude = AREAS[house.area].unit > 1;
    const cap = altitude ? 4 : { house: 8, neighborhood: 60, city: 200 }[house.area as 'house' | 'neighborhood' | 'city'];
    this.cell = Math.min(cap, Math.max(altitude ? 0.5 : 2, r * 0.6));
    this.lapW = wrapWidth(house);
    this.originX = this.lapW ? this.run.bunny.x - this.lapW / 2 : 0;
    if (this.lapW) this.cell = this.lapW / Math.ceil(this.lapW / this.cell);
    this.cols = Math.round((bd.maxX - bd.minX) / this.cell);
    this.rows = Math.ceil((bd.maxZ - bd.minZ) / this.cell);
    const n = this.cols * this.rows;
    this.blocked = new Uint8Array(n);
    this.dist = new Int32Array(n);
    this.parent = new Int32Array(n);
    let pad = r * 0.95;
    const mark = (minX: number, minZ: number, maxX: number, maxZ: number) => {
      const r0 = Math.max(0, Math.floor((minZ - pad) / this.cell));
      const r1 = Math.min(this.rows - 1, Math.floor((maxZ + pad) / this.cell));
      if (this.lapW) {
        const c0 = Math.floor((this.localX(minX) - pad) / this.cell);
        const n = Math.min(this.cols, Math.floor((maxX - minX + 2 * pad) / this.cell) + 1);
        for (let row = r0; row <= r1; row++) for (let k = 0; k < n; k++) this.blocked[row * this.cols + (((c0 + k) % this.cols) + this.cols) % this.cols] = 1;
        return;
      }
      const c0 = Math.max(0, Math.floor((minX - pad) / this.cell));
      const c1 = Math.min(this.cols - 1, Math.floor((maxX + pad) / this.cell));
      for (let row = r0; row <= r1; row++) for (let c = c0; c <= c1; c++) this.blocked[row * this.cols + c] = 1;
    };
    for (const o of house.obstacles) {
      if (passesUnder(r, o)) continue;
      // A big Bunny squeezes through doorways (see wallRadiusAt).
      pad = o.kind === 'wall' ? Math.min(r * 0.95, 36) : r * 0.95;
      mark(o.rect.minX, o.rect.minZ, o.rect.maxX, o.rect.maxZ);
    }
    pad = r * 0.95;
    const ratio = this.run.bunny.stats.get('absorbRatio');
    this.run.debris.forEach((d) => {
      // Locked Debris (Jupiter before Dust Star) is an Obstacle whatever its size.
      if (!debrisLocked(this.run.bunny, d) && (canAbsorb(r, ratio, d.size) || d.size <= r * TUNING.push.ratio)) return;
      const s = d.size * 0.6;
      mark(d.x - s, d.z - s, d.x + s, d.z + s);
    });
    // Keep the outer rim blocked (bounds clamp).
    const rim = Math.ceil(r / this.cell);
    const side = this.lapW ? -1 : rim;
    for (let row = 0; row < this.rows; row++) for (let c = 0; c < this.cols; c++) if (row < rim || c < side || row >= this.rows - rim || c >= this.cols - side) this.blocked[row * this.cols + c] = 1;
  }

  /** x in the grid's frame: [0, lap) on a wrapping map (any lap), plain x otherwise. */
  private localX(x: number): number {
    if (!this.lapW) return x;
    return (((x - this.originX) % this.lapW) + this.lapW) % this.lapW;
  }

  /** World x of a grid column's centre, on the copy nearest the Bunny. */
  private worldX(c: number): number {
    const x = this.originX + (c + 0.5) * this.cell;
    return this.lapW ? x + Math.round((this.run.bunny.x - x) / this.lapW) * this.lapW : x;
  }

  debugStart(): string {
    const i = this.index(this.run.bunny.x, this.run.bunny.z);
    let n = 0;
    for (let k = 0; k < this.dist.length; k++) if (this.dist[k]! >= 0) n++;
    return `${!this.blocked[i]} flooded=${n}/${this.dist.length}`;
  }

  index(x: number, z: number): number {
    const c = Math.min(this.cols - 1, Math.max(0, Math.floor(this.localX(x) / this.cell)));
    const row = Math.min(this.rows - 1, Math.max(0, Math.floor(z / this.cell)));
    return row * this.cols + c;
  }

  /** BFS from the Bunny (8-neighbour, unit steps); unreachable cells get -1. */
  flood(maxCells = 1e9): void {
    const { bunny } = this.run;
    this.dist.fill(-1);
    let start = this.index(bunny.x, bunny.z);
    // The Bunny's own cell may be marked (padding); search outwards for a free one.
    if (this.blocked[start]) {
      const sc = start % this.cols;
      const sr = Math.floor(start / this.cols);
      let found = -1;
      for (let k = 1; k < 6 && found < 0; k++) {
        for (let dr = -k; dr <= k && found < 0; dr++) {
          for (let dc = -k; dc <= k && found < 0; dc++) {
            const rr = sr + dr;
            const cc = sc + dc;
            if (rr >= 0 && cc >= 0 && rr < this.rows && cc < this.cols && !this.blocked[rr * this.cols + cc]) found = rr * this.cols + cc;
          }
        }
      }
      if (found >= 0) start = found;
    }
    const q = new Int32Array(this.cols * this.rows);
    let head = 0;
    let tail = 0;
    q[tail++] = start;
    this.dist[start] = 0;
    this.parent[start] = -1;
    while (head < tail && head < maxCells) {
      const i = q[head++]!;
      const c = i % this.cols;
      const row = (i - c) / this.cols;
      const d = this.dist[i]! + 1;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const rr = row + dr;
          const cc = this.lapW ? (c + dc + this.cols) % this.cols : c + dc;
          if (rr < 0 || cc < 0 || rr >= this.rows || cc >= this.cols) continue;
          const j = rr * this.cols + cc;
          if (this.blocked[j] || this.dist[j]! >= 0) continue;
          // No corner cutting.
          if (dr && dc && (this.blocked[row * this.cols + cc] || this.blocked[rr * this.cols + c])) continue;
          this.dist[j] = d;
          this.parent[j] = i;
          q[tail++] = j;
        }
      }
    }
  }

  /** Path length (cm) to (x, z), or -1 if unreachable. Checks a few cells around the point. */
  pathTo(x: number, z: number, slack: number): number {
    const i = this.nearestReached(x, z, slack);
    return i < 0 ? -1 : this.dist[i]! * this.cell;
  }

  private nearestReached(x: number, z: number, slack: number): number {
    const k = Math.ceil(slack / this.cell);
    const ci = this.index(x, z);
    const sc = ci % this.cols;
    const sr = Math.floor(ci / this.cols);
    let best = -1;
    for (let dr = -k; dr <= k; dr++) {
      for (let dc = -k; dc <= k; dc++) {
        const rr = sr + dr;
        const cc = this.lapW ? (sc + dc + this.cols) % this.cols : sc + dc;
        if (rr < 0 || cc < 0 || rr >= this.rows || cc >= this.cols) continue;
        const j = rr * this.cols + cc;
        if (this.dist[j]! >= 0 && (best < 0 || this.dist[j]! < this.dist[best]!)) best = j;
      }
    }
    return best;
  }

  /** Point a few cells along the path towards (x, z). */
  steerTo(x: number, z: number, slack: number): { x: number; z: number } | null {
    let i = this.nearestReached(x, z, slack);
    if (i < 0) return null;
    const path: number[] = [];
    while (i >= 0 && path.length < 100000) {
      path.push(i);
      i = this.parent[i]!;
      if (this.dist[i] === 0) break;
    }
    const pick = path[Math.max(0, path.length - 3)] ?? path[0]!;
    const c = pick % this.cols;
    const row = (pick - c) / this.cols;
    if (path.length <= 2) return { x, z };
    return { x: this.worldX(c), z: (row + 0.5) * this.cell };
  }
}

class Bot implements InputSource {
  private target: Debris | null = null;
  private replan = 0;
  private dashTimer = 0;
  private lastPos = { x: 0, z: 0 };
  private stuckTimer = 0;
  private wander = 0;
  private wanderDir = { x: 1, z: 0 };
  private blacklist = new Map<number, number>();
  private readonly planner: Planner;
  private readonly rng: Rng;
  private steer: { x: number; z: number } | null = null;
  /** Seconds with nothing reachable to absorb in view. */
  starved = 0;
  private chaseTime = 0;
  private readonly nearDanger: Array<{ x: number; z: number }> = [];
  private readonly chaseGiveUp = new Map<number, number>();

  constructor(private readonly run: Run) {
    this.rng = new Rng(`${run.config.seed}:bot`);
    this.planner = new Planner(run);
  }

  /** Repulsion from Hazards the Bunny cannot absorb; a chase target for ones it can. */
  private hazardSteer(): { x: number; z: number; urgent: boolean; chase: Hazard | null; near: Array<{ x: number; z: number }> } {
    const { bunny, hazards } = this.run;
    const r = bunny.radius;
    const ratio = bunny.stats.get('absorbRatio');
    let x = 0;
    let z = 0;
    let urgent = false;
    let chase: Hazard | null = null;
    let chaseD = Infinity;
    this.nearDanger.length = 0;
    // Against the Expansion every second counts: only chase absorbable Hazards close by, else eat Debris.
    const chaseRange = viewRadiusFor(r, this.run.tier) * (hazards.hazards.some((h) => h instanceof TheExpansion && !h.dead) ? 0.3 : 1);
    for (const h of hazards.hazards) {
      // The Expansion is no body: nothing to dodge or ram (the bot just keeps absorbing).
      if (h.dead || h.intangible) continue;
      const dx = bunny.x - h.x;
      const dz = bunny.z - h.z;
      const d = Math.hypot(dx, dz) || 1;
      const boss = h instanceof RoboVac9000 ? h : null;
      const reach = (h.shape.kind === 'circle' ? h.shape.radius : Math.max(h.shape.halfW, h.shape.halfD)) + r;
      // A stunned boss takes one hit per stun: once it has landed, back off before it recovers.
      if (canAbsorb(r, ratio, h.size) || boss?.hittable) {
        if (d < chaseD && d < chaseRange) {
          chase = h;
          chaseD = d;
        }
        continue;
      }
      const spray = h.def.id === 'spray_bottle' || h.def.id === 'pressure_washer' || h.def.id === 'crop_duster' || h.def.id === 'volcano' || h.def.id === 'sunspot' ? (h as SprayBottle) : null;
      const sprayReach = spray && spray.def.id !== 'spray_bottle' ? tierValue(spray.cfg.range, this.run.tier) + r : 300;
      if (spray && d < sprayReach && (spray.state === 'telegraph' || spray.state === 'firing' || spray.droplets.length > 0)) {
        // Sidestep the aim lane (a player sees the red lane).
        const fx = Math.sin(spray.yaw);
        const fz = Math.cos(spray.yaw);
        const side = fx * dz - fz * dx >= 0 ? 1 : -1;
        x += -fz * side * 2;
        z += fx * side * 2;
      }
      if (h instanceof Pulsar && (h.state === 'telegraph' || h.state === 'firing')) {
        // Leave the lit beams' reach (a player sees the red lanes and the amber wedges they will sweep).
        const range = tierValue(h.cfg.range, this.run.tier);
        if (d < range + r * 2) {
          x += (dx / d) * 4;
          z += (dz / d) * 4;
          if (inBeam(dx, dz, r * 2, h.beamYaw, range, h.cfg.beamWidth) || h.state === 'firing') urgent = true;
        }
      }
      if (h instanceof GammaRayBurst && (h.state === 'telegraph' || h.state === 'firing')) {
        // Step off the locked lane (a player sees the violet lane blinking).
        const range = h.cfg.muzzle + tierValue(h.cfg.range, this.run.tier);
        if (inBurst(dx, dz, r * 1.6, h.aimYaw, h.cfg.muzzle, range, h.cfg.beamWidth)) {
          const fx = Math.sin(h.aimYaw);
          const fz = Math.cos(h.aimYaw);
          const side = fx * dz - fz * dx >= 0 ? 1 : -1;
          x += -fz * side * 4;
          z += fx * side * 4;
          urgent = true;
        }
      }
      const vac = h.def.id === 'upright_vacuum' || h.def.id === 'litter_vacuum' ? (h as UprightVacuum) : null;
      if (vac && vac.state !== 'off') {
        // Step out of the (telegraphed) suction cone sideways and back.
        const c = vac.cfg;
        const it = { x: vac.x + Math.sin(vac.yaw) * vac.size * c.nozzleOffset, z: vac.z + Math.cos(vac.yaw) * vac.size * c.nozzleOffset };
        if (inCone(it.x, it.z, vac.yaw, c.coneHalfAngle + 0.25, c.coneRange * 1.3, bunny.x, bunny.z, r)) {
          const fx = Math.sin(vac.yaw);
          const fz = Math.cos(vac.yaw);
          const side = fx * dz - fz * dx >= 0 ? 1 : -1;
          x += (-fz * side * 2.5 + (dx / d) * 1.5) * 4;
          z += (fx * side * 2.5 + (dz / d) * 1.5) * 4;
          urgent = vac.state === 'on';
        }
      }
      const broom = h.def.id === 'broom' ? (h as Broom) : null;
      if (broom && broom.state !== 'idle') {
        const bx = bunny.x - broom.pivotX;
        const bz = bunny.z - broom.pivotZ;
        const bd = Math.hypot(bx, bz) || 1;
        const reachB = BROOM.sweepRadius + BROOM.headRadius + r + 10;
        if (bd < reachB) {
          x += (bx / bd) * 3;
          z += (bz / bd) * 3;
          urgent = true;
        }
      }
      if (boss && (boss.ashState !== 'idle' || boss.ash.length > 0) && this.inAshLane(boss, 2)) {
        // Sidestep the Incinerator's ash lane (a player sees the amber lane).
        const fx = Math.sin(boss.ashYaw);
        const fz = Math.cos(boss.ashYaw);
        const side = fx * dz - fz * dx >= 0 ? 1 : -1;
        x += -fz * side * 2;
        z += fx * side * 2;
      }
      if (h instanceof SagittariusA && d > 30 && h.state !== 'intro') {
        // Stay in the fight (a player keeps it on screen): drift back towards it, outside its pull.
        x -= (dx / d) * 1.2;
        z -= (dz / d) * 1.2;
      }
      if (boss && (boss.state === 'telegraph' || boss.state === 'charge')) {
        const fx = Math.sin(boss.yaw);
        const fz = Math.cos(boss.yaw);
        const side = fx * dz - fz * dx >= 0 ? 1 : -1;
        x += -fz * side * 3;
        z += fx * side * 3;
        urgent = boss.state === 'charge' || d < 200 / this.run.unit;
        continue;
      }
      // Real cm floors (30 cm) are divided by the Area's unit (10 m per unit in the Region).
      const danger = reach + Math.max(30 / this.run.unit, r * 3);
      if (d < danger) this.nearDanger.push({ x: -dx / d, z: -dz / d });
      if (d < danger) {
        const w = (danger - d) / (danger - reach * 0.9);
        x += (dx / d) * w * 4;
        z += (dz / d) * w * 4;
        if (d < reach + r) urgent = true;
      }
    }
    return { x, z, urgent, chase, near: this.nearDanger };
  }

  private pickTarget(): void {
    const { bunny, debris, house } = this.run;
    const r = bunny.radius;
    const ratio = bunny.stats.get('absorbRatio');
    this.planner.ensure();
    this.planner.flood();
    const near = debris.query(bunny.x, bunny.z, viewRadiusFor(r, this.run.tier) * sight);
    // Against Sagittarius A*, leave star clusters for it to choke on (two quickly stun it).
    const sgr = this.run.hazards.hazards.find((h): h is SagittariusA => h instanceof SagittariusA && !h.dead && !canAbsorb(r, ratio, h.size));
    let best: Debris | null = null;
    let bestScore = 0;
    for (const d of near) {
      if (!canAbsorb(r, ratio, d.size) || debrisLocked(bunny, d) || (sgr && sgr.sgr.clusters.meals[d.type.id] !== undefined) || (this.blacklist.get(d.id) ?? 0) > this.run.time || !reachableBy(house, d.x, d.z, d.size, r)) continue;
      const crow = Math.hypot(d.x - bunny.x, d.z - bunny.z);
      const worth = eatNear ? 1 : (d.size / r) ** 3 * d.type.mass;
      const quick = worth / (crow + r);
      if (quick <= bestScore) continue; // path length >= straight line, so it can't win
      const path = this.planner.pathTo(d.x, d.z, r + d.size);
      if (path < 0) continue;
      const score = worth / (path + r);
      if (score > bestScore) {
        bestScore = score;
        best = d;
      }
    }
    // Pickups are worth a detour (a short one while the Expansion drains the bar).
    const detour = this.run.hazards.hazards.some((h) => h instanceof TheExpansion && !h.dead) ? 0.2 : 0.6;
    for (const p of this.run.pickups.floor) {
      const path = this.planner.pathTo(p.x, p.z, r + p.radius);
      if (path >= 0 && path < viewRadiusFor(r, this.run.tier) * detour) {
        this.steer = this.planner.steerTo(p.x, p.z, r + p.radius);
        this.target = null;
        return;
      }
    }
    if (traceAt !== undefined && this.run.time > traceAt && this.run.time < traceAt + 1) {
      const ab = near.filter((d) => canAbsorb(r, ratio, d.size) && !debrisLocked(bunny, d));
      const reach = ab.filter((d) => reachableBy(house, d.x, d.z, d.size, r));
      const path = reach.filter((d) => this.planner.pathTo(d.x, d.z, r + d.size) >= 0);
      console.log(`  pick t=${this.run.time.toFixed(1)} r=${r.toFixed(1)} pos=(${bunny.x.toFixed(0)},${bunny.z.toFixed(0)}) near=${near.length} absorbable=${ab.length} reachable=${reach.length} pathable=${path.length} best=${best?.type.id} cell=${this.planner.cell.toFixed(1)} startFree=${this.planner.debugStart()}`);
      for (const d of reach.slice(0, 5)) console.log(`    ${d.type.id} s=${d.size.toFixed(1)} (${d.x.toFixed(0)},${d.z.toFixed(0)})`);
    }
    this.target = best;
    this.steer = best ? this.planner.steerTo(best.x, best.z, r + best.size) : null;
    if (!best) {
      // Nothing in view: head for the farthest reachable floor in a random direction.
      const a = this.rng.range(0, Math.PI * 2);
      const tx = bunny.x + Math.cos(a) * viewRadiusFor(r, this.run.tier) * 1.2;
      const tz = bunny.z + Math.sin(a) * viewRadiusFor(r, this.run.tier) * 1.2;
      this.steer = this.planner.steerTo(tx, tz, viewRadiusFor(r, this.run.tier));
    }
  }

  /** True if the boss's telegraphed (or running) charge lane covers the Bunny. */
  private laneCrosses(boss: RoboVac9000, pad = 1): boolean {
    const b = this.run.bunny;
    const fx = Math.sin(boss.yaw);
    const fz = Math.cos(boss.yaw);
    const dx = b.x - boss.x;
    const dz = b.z - boss.z;
    const along = dx * fx + dz * fz;
    const side = Math.abs(dx * fz - dz * fx);
    return along > -b.radius && along < boss.cfg.chargeDistance + b.radius && side < (boss.cfg.contactRadius * boss.scale + b.radius) * pad;
  }

  /** True if the boss's locked ash lane (from its centre, `pad` × the pellet + Bunny width) covers the Bunny. */
  private inAshLane(boss: RoboVac9000, pad = 1): boolean {
    const a = boss.cfg.ash;
    if (!a) return false;
    const b = this.run.bunny;
    const dx = b.x - boss.x;
    const dz = b.z - boss.z;
    const along = dx * Math.sin(boss.ashYaw) + dz * Math.cos(boss.ashYaw);
    const side = Math.abs(dx * Math.cos(boss.ashYaw) - dz * Math.sin(boss.ashYaw));
    return along > -b.radius && along < a.range + b.radius && side < (a.radius + b.radius) * pad + along * a.spread;
  }

  /** A non-boss Hazard that an Amass would swallow on contact has its edge within AMASS_SWALLOW_RANGE r. */
  private swallowNear(): boolean {
    const { bunny, hazards } = this.run;
    const r = bunny.radius;
    const ratio = bunny.stats.get('absorbRatio');
    const swallow = r * (getAbilitySystem(this.run)?.params.amass.absorbRatio ?? 0);
    return hazards.hazards.some((h) => {
      if (h.dead || h.intangible || h.def.boss || h.size > swallow || canAbsorb(r, ratio, h.size)) return false;
      const hr = h.shape.kind === 'circle' ? h.shape.radius : Math.max(h.shape.halfW, h.shape.halfD);
      return Math.hypot(h.x - bunny.x, h.z - bunny.z) - r - hr < AMASS_SWALLOW_RANGE * r;
    });
  }

  /** At least AMASS_FEED_COUNT absorbable Debris lie within AMASS_FEED_RANGE r: worth a gravity well. */
  private debrisRich(): boolean {
    const { bunny, debris } = this.run;
    const r = bunny.radius;
    const ratio = bunny.stats.get('absorbRatio');
    let n = 0;
    for (const d of debris.query(bunny.x, bunny.z, AMASS_FEED_RANGE * r)) {
      if (canAbsorb(r, ratio, d.size) && !debrisLocked(bunny, d) && ++n >= AMASS_FEED_COUNT) return true;
    }
    return false;
  }

  /** A Broom sweep, vacuum / blower cone or spray lane (of the given kinds) is about to hit the Bunny. */
  private imminentHit(kinds: ReadonlySet<'vacuum' | 'spray' | 'broom'> = ALL_HITS): boolean {
    const { bunny, hazards } = this.run;
    const r = bunny.radius;
    for (const h of hazards.hazards) {
      if (h.dead || h.intangible || canAbsorb(r, bunny.stats.get('absorbRatio'), h.size) || h.stunnedFor) continue;
      if (h instanceof UprightVacuumClass && h.state !== 'off' && kinds.has('vacuum')) {
        const c = h.cfg;
        const it = { x: h.x + Math.sin(h.yaw) * h.size * c.nozzleOffset, z: h.z + Math.cos(h.yaw) * h.size * c.nozzleOffset };
        if (inCone(it.x, it.z, h.yaw, c.coneHalfAngle, c.coneRange * 1.1, bunny.x, bunny.z, r)) return true;
      } else if (h instanceof SprayBottleClass && (h.state === 'telegraph' || h.state === 'firing') && kinds.has('spray')) {
        const range = tierValue(h.cfg.range, this.run.tier);
        const dx = bunny.x - h.x;
        const dz = bunny.z - h.z;
        const along = dx * Math.sin(h.yaw) + dz * Math.cos(h.yaw);
        const side = Math.abs(dx * Math.cos(h.yaw) - dz * Math.sin(h.yaw));
        if (along > 0 && along < range + r && side < r + h.cfg.dropletRadius * 3) return true;
      } else if (h instanceof RoboVac9000 && kinds.has('spray') && h.ashState !== 'idle' && this.inAshLane(h)) {
        return true;
      } else if (h instanceof BroomClass && h.state !== 'idle' && kinds.has('broom')) {
        if (Math.hypot(bunny.x - h.pivotX, bunny.z - h.pivotZ) < BROOM.sweepRadius + BROOM.headRadius + r) return true;
      }
    }
    return false;
  }

  /** Ability policy (see file header): the `ability` edge and `abilityHeld` for this tick. */
  private abilityInput(): { ability: boolean; abilityHeld: boolean } {
    const sys = getAbilitySystem(this.run);
    if (!sys) return { ability: false, abilityHeld: false };
    const { bunny, hazards } = this.run;
    const bosses = hazards.hazards.filter((h): h is RoboVac9000 => !h.dead && h instanceof RoboVac9000);
    if (sys.data.id === 'decoy') {
      const ctl = sys.controller as DecoyAbility;
      if (!ctl.ready) return { ability: false, abilityHeld: false };
      const bossAim = bosses.some((b) => b.state === 'telegraph' && this.laneCrosses(b));
      const broomAim = hazards.hazards.some((h) => {
        if (h.dead || h.def.id !== 'broom') return false;
        const br = h as Broom;
        return br.state === 'telegraph' && Math.hypot(bunny.x - br.pivotX, bunny.z - br.pivotZ) < BROOM.aggroRange + bunny.radius;
      });
      return { ability: bossAim || broomAim || (decoyPolicy === 'defend' && this.imminentHit()), abilityHeld: false };
    }
    if (sys.data.id === 'amass') {
      const ctl = sys.controller as AmassAbility;
      const lane = bosses.some((b) => (b.state === 'telegraph' || b.state === 'charge') && this.laneCrosses(b));
      const feed = amassPolicy === 'feed' && (this.swallowNear() || this.debrisRich());
      // Suction pulls harder while channelling: let go (or don't start) when a vacuum cone is about to catch us.
      const vacuum = this.imminentHit(VACUUM_HITS);
      if (ctl.active) {
        // Hold through a boss charge; when feeding, hold to the end unless a vacuum threatens.
        const keep = lane || (amassPolicy === 'feed' && !vacuum);
        return { ability: false, abilityHeld: keep };
      }
      const go = (lane || (feed && !vacuum)) && ctl.canStart;
      return { ability: go, abilityHeld: go };
    }
    const ctl = sys.controller as DischargeAbility;
    return { ability: ctl.ready && ctl.target !== null, abilityHeld: false };
  }

  sample(): InputState {
    const s = this.move();
    return withHazards ? { ...s, ...this.abilityInput() } : s;
  }

  private move(): InputState {
    const dt = 1 / 60;
    const { bunny } = this.run;
    this.replan -= dt;
    this.dashTimer -= dt;
    this.stuckTimer += dt;
    const avoid: ReturnType<Bot['hazardSteer']> = withHazards ? this.hazardSteer() : { x: 0, z: 0, urgent: false, chase: null, near: [] };
    let chaseSteer: { x: number; z: number } | null = null;
    if (avoid.chase && (this.chaseGiveUp.get(avoid.chase.id) ?? 0) <= this.run.time) {
      this.planner.ensure();
      if (this.replan <= 0) {
        this.replan = 0.3;
        this.planner.flood();
      }
      chaseSteer = this.planner.steerTo(avoid.chase.x, avoid.chase.z, bunny.radius + avoid.chase.size);
      this.chaseTime += dt;
      if (!chaseSteer || this.chaseTime > 12) {
        this.chaseGiveUp.set(avoid.chase.id, this.run.time + 8);
        this.chaseTime = 0;
        chaseSteer = null;
      }
    } else this.chaseTime = 0;
    if (avoid.chase && chaseSteer) {
      const dx = chaseSteer.x - bunny.x;
      const dz = chaseSteer.z - bunny.z;
      const d = Math.hypot(dx, dz) || 1;
      // Don't chase through a Hazard that hurts.
      if (!(avoid.near ?? []).some((n) => (dx / d) * n.x + (dz / d) * n.z > 0.3)) {
        const dash = this.dashTimer <= 0 && d > bunny.radius * 3;
        if (dash) this.dashTimer = 1;
        return { moveX: dx / d, moveZ: dz / d, dash };
      }
    }
    if (this.stuckTimer > 0.8) {
      const moved = Math.hypot(bunny.x - this.lastPos.x, bunny.z - this.lastPos.z);
      if (moved < bunny.radius * 0.5) {
        const a = this.rng.range(0, Math.PI * 2);
        this.wanderDir = { x: Math.cos(a), z: Math.sin(a) };
        this.wander = 0.4;
        if (this.target) this.blacklist.set(this.target.id, this.run.time + 10);
        this.target = null;
        this.replan = 0;
      }
      this.lastPos = { x: bunny.x, z: bunny.z };
      this.stuckTimer = 0;
    }
    let mx = 0;
    let mz = 0;
    if (this.wander > 0) {
      this.wander -= dt;
      mx = this.wanderDir.x;
      mz = this.wanderDir.z;
    } else {
      if (this.replan <= 0 || (this.target && !this.target.alive)) {
        this.replan = 0.3;
        this.pickTarget();
      }
      if (!this.target) this.starved += dt;
      if (this.steer) {
        const dx = this.steer.x - bunny.x;
        const dz = this.steer.z - bunny.z;
        const d = Math.hypot(dx, dz) || 1;
        mx = dx / d;
        mz = dz / d;
      }
    }
    // Never steer towards a Hazard we're close to.
    for (const n of avoid.near ?? []) {
      const dot = mx * n.x + mz * n.z;
      if (dot > 0) {
        mx -= dot * n.x;
        mz -= dot * n.z;
      }
    }
    mx += avoid.x;
    mz += avoid.z;
    const m = Math.hypot(mx, mz) || 1;
    const dash = avoid.urgent && this.dashTimer <= 0;
    if (dash) this.dashTimer = 1;
    return { moveX: mx / m, moveZ: mz / m, dash };
  }
}

const fmt = (s: number | undefined) => (s === undefined ? '  -  ' : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`);
interface Validation {
  /** Submissions checked / rejected. */
  checked: number;
  rejected: string[];
  /** Highest radius reached ÷ radius allowed for the time: Run board, and per Area board. */
  runHeadroom: number;
  areaHeadroom: Record<string, number>;
}
const summary: Record<
  string,
  { tiers: number[][]; ends: number[]; fluff: number[]; wins: number; deaths: number; n: number; fights: Record<string, number>; kills: Record<string, number>; abilityUses: number; stuns: Record<string, number>; loadout: Loadout; v: Validation; acts: Record<string, number[]>; expansion: number[]; rips: number; expansionDeaths: number; growth: Record<string, number[][]> }
> = {};
const BOSS_IDS = AREA_ORDER.map((a) => AREA_BOSSES[a].id);
const modifiers = upgradeModifiers(upgrades);

/** Validates the submissions a finished Run would post (--validate). */
function validateRun(run: Run, v: Validation, label: string): void {
  const stats = run.getStats();
  const reason = run.endReason ?? 'quit';
  const sub = submissionFromRun(stats, reason, 'Sim Bot', 'sim-bot-run');
  const res = validateSubmission(sub);
  v.checked++;
  if (!res.ok) v.rejected.push(`${label} run board: ${res.field}: ${res.message} (r=${sub.maxRadius} t=${(sub.durationMs / 1000).toFixed(0)}s)`);
  v.runHeadroom = Math.max(v.runHeadroom, progressRadius(sub.maxRadius) / runRadiusAllowed(sub.durationMs / 1000));
  for (const a of stats.areas ?? []) {
    if (!a.cleared) continue;
    const as = areaSubmission(a, stats.characterId, stats.difficulty, 'Sim Bot', 'sim-bot-run', stats.loadout);
    const ar = validateAreaSubmission(as);
    v.checked++;
    if (!ar.ok) v.rejected.push(`${label} ${a.area} board: ${ar.field}: ${ar.message} (in=${as.radiusIn} max=${as.maxRadius} t=${(as.durationMs / 1000).toFixed(0)}s)`);
    v.areaHeadroom[a.area] = Math.max(v.areaHeadroom[a.area] ?? 0, as.maxRadius / areaRadiusAllowed(a.area, as.radiusIn, as.durationMs / 1000));
  }
}

for (const characterId of chars) {
  const loadout = loadoutFor(characterId);
  const sum = (summary[characterId] = {
    tiers: TIERS.map((): number[] => []),
    ends: [] as number[],
    fluff: [] as number[],
    wins: 0,
    deaths: 0,
    n: 0,
    fights: {} as Record<string, number>,
    kills: {} as Record<string, number>,
    abilityUses: 0,
    /** Boss stuns by cause (wall crashes, Sagittarius A*'s indigestion, Abilities). */
    stuns: {} as Record<string, number>,
    loadout,
    v: { checked: 0, rejected: [], runHeadroom: 0, areaHeadroom: {} },
    acts: {} as Record<string, number[]>,
    /** The Expansion: fight lengths (spawn → collapse), Big Rips, deaths while it was alive. */
    expansion: [] as number[],
    rips: 0,
    expansionDeaths: 0,
    /** --no-boss: per Area, per GROWTH_SHARES entry, seconds from that share of the boss's absorb radius to all of it. */
    growth: {} as Record<string, number[][]>,
  });
  for (const seed of seeds) {
    const events = new EventBus();
    // --no-hazards: pure growth, so neither Hazards nor Pickups spawn.
    const run = createRun(events, { seed, characterId, difficulty, modifiers, perks: fixedPerks, area: startArea, loadout }, { hazards: withHazards, pickups: withHazards, abilities: withAbility });
    if (startRadius !== undefined) run.bunny.setRadius(startRadius);
    events.on('hazardSpawned', (e) => {
      if (BOSS_IDS.includes(e.defId)) sum.fights[e.defId] = (sum.fights[e.defId] ?? 0) + 1;
    });
    events.on('bossDefeated', (e) => (sum.kills[e.defId] = (sum.kills[e.defId] ?? 0) + 1));
    events.on('abilityUsed', () => sum.abilityUses++);
    events.on('bossStunned', (e) => (sum.stuns[e.cause ?? 'other'] = (sum.stuns[e.cause ?? 'other'] ?? 0) + 1));
    /** Area whose exit just opened (the bot skips the walk to it), or null. */
    let leaveArea: string | null = null;
    events.on('exitOpened', (e) => {
      log.push(`${fmt(run.time)} ${e.area} cleared r=${run.bunny.radius.toFixed(1)} → next area`);
      leaveArea = e.area;
    });
    events.on('areaEntered', (e) => log.push(`${fmt(run.time)} entered ${e.area} r=${run.bunny.radius.toFixed(1)}`));
    events.on('bossDefeated', (e) => log.push(`${fmt(run.time)} ${e.defId} ${e.defId === 'the_expansion' ? 'collapsed' : 'absorbed'} r=${run.bunny.radius.toFixed(1)}`));
    let expansionAt = -1;
    events.on('bossSpawned', (e) => {
      if (run.hazards.hazards.some((h) => h.id === e.hazardId && h instanceof TheExpansion)) expansionAt = run.time;
    });
    events.on('bossDefeated', (e) => {
      if (e.defId === 'the_expansion' && expansionAt >= 0) sum.expansion.push(run.time - expansionAt);
      expansionAt = -1;
    });
    let tugLogged = -1;
    events.on('bossTug', (e) => {
      if (run.time - tugLogged < 15) return;
      tugLogged = run.time;
      const boss = run.hazards.hazards.find((h): h is TheExpansion => h instanceof TheExpansion);
      log.push(`${fmt(run.time)} tug gravity=${e.gravity.toFixed(2)} drain=${e.drain.toFixed(3)} H=${e.hubble.toFixed(3)} r=${run.bunny.radius.toFixed(1)} strands=${boss?.strandsSent ?? 0} starved=${bot.starved.toFixed(0)}s at (${run.bunny.x.toFixed(0)},${run.bunny.z.toFixed(0)})`);
    });
    events.on('bossRip', (e) => {
      sum.rips++;
      log.push(`${fmt(run.time)} Big Rip (${e.damaged ? 'hit' : 'blocked'}) r=${run.bunny.radius.toFixed(1)}`);
    });
    events.on('bunnyDied', () => {
      if (expansionAt >= 0) sum.expansionDeaths++;
    });
    const bot = new Bot(run);
    run.input = bot;
    let bossWon = false;
    if (bossOnly) {
      events.on('bossDefeated', () => (bossWon = true));
      run.bunny.setRadius(bossArrivalRadius('house', run.bunny.stats.get('absorbRatio')) * 1.02);
    }
    const log: string[] = [];
    const perkRng = new Rng(`${seed}:perks`);
    let hits = 0;
    if (withHazards) {
      if (god) {
        run.bunny.damageFilters.push((amount) => {
          if (run.bunny.health - amount <= 0) run.bunny.heal(run.bunny.maxHealth);
          return Math.min(amount, run.bunny.health - 1);
        });
      }
      // Picks immediately (the Run is never paused): the draft queued for this Tier, at random.
      events.on('tierUp', () => {
        const { perks } = run.perkDraft.offer;
        const pick = perks[Math.floor(perkRng.next() * perks.length)];
        if (pick && run.perkDraft.choose(pick.id)) log.push(`${fmt(run.time)} T${run.tier} perk ${pick.id}`);
      });
      events.on('bunnyDamaged', (e) => {
        hits++;
        const boss = run.hazards.hazards.find((h): h is RoboVac9000 => h instanceof RoboVac9000 && h.def.id === e.source);
        log.push(`${fmt(run.time)} T${run.tier} r=${run.bunny.radius.toFixed(1)} hit by ${e.source}${boss ? ` (${boss.state}${boss.ashState !== 'idle' ? `, ${boss.ashState}` : ''})` : ''} hp=${e.health}/${e.maxHealth}`);
      });
      events.on('bossSpawned', (e) => log.push(`${fmt(run.time)} boss spawned, ${Number.isFinite(e.absorbRadius) ? `absorb at r=${e.absorbRadius.toFixed(1)}` : 'not absorbable by size'} (r=${run.bunny.radius.toFixed(1)})`));
      events.on('bossHit', (e) => log.push(`${fmt(run.time)} boss hit ${e.hits}/${e.maxHits} (r=${run.bunny.radius.toFixed(1)})`));
      events.on('bossStunned', (e) => log.push(`${fmt(run.time)} boss stunned (${e.cause ?? 'spiky'})`));
      events.on('bossSwallowed', (e) => log.push(`${fmt(run.time)} boss swallowed ${e.typeId} (${e.fullness}/${e.threshold})`));
      events.on('pickupCollected', (e) => log.push(`${fmt(run.time)} pickup ${e.defId}`));
    }
    const supply: string[] = [];
    let nextSample = 60;
    let lastR = 0;
    const dt = 1 / 60;
    const steps = minutes * 60 * 60;
    const t0 = performance.now();
    /** --no-boss: when the Bunny first reached each share of the current Area's boss absorb radius. */
    let crossed: (number | undefined)[] = [];
    let crossedArea: AreaId | null = null;
    const arrivalOf = (r: Run) => bossArrivalRadius(r.area, r.bunny.stats.get('absorbRatio'));
    for (let i = 0; i < steps && !run.ended && !bossWon && (withHazards || nextArea(run.area) === null || run.bunny.radius < arrivalOf(run)); i++) {
      run.update(dt);
      if (noBoss && !run.ended) {
        const director = getHazardDirector(run);
        if (director) director.bossSpawned = true;
        if (crossedArea !== run.area) {
          crossedArea = run.area;
          crossed = [];
        }
        const need = bossAbsorbRadius(run.area, run.bunny.stats.get('absorbRatio'));
        GROWTH_SHARES.forEach((f, k) => {
          if (crossed[k] === undefined && run.bunny.radius >= f * need) crossed[k] = run.time;
        });
        if (Number.isFinite(need) && run.bunny.radius >= need && !run.isAreaCleared(run.area)) {
          const done = run.time;
          const rows = (sum.growth[run.area] ??= GROWTH_SHARES.map((): number[] => []));
          GROWTH_SHARES.forEach((_, k) => {
            if (crossed[k] !== undefined) rows[k]!.push(done - crossed[k]!);
          });
          log.push(`${fmt(run.time)} ${run.area}: could absorb its boss at r=${run.bunny.radius.toFixed(2)}`);
          run.clearArea();
        }
      }
      // Skip the walk, unless the Bunny already rolled through the exit this tick.
      if (leaveArea) {
        if (run.area === leaveArea) run.enterNextArea();
        leaveArea = null;
      }
      if (traceAt !== undefined && run.time > traceAt && run.time < traceAt + 6 && i % 15 === 0) {
        const b = run.bunny;
        const hz = run.hazards.hazards.map((h) => `${h.def.id}${'state' in h ? `:${(h as { state: string }).state}` : ''}@(${h.x.toFixed(0)},${h.z.toFixed(0)}) d=${Math.hypot(h.x - b.x, h.z - b.z).toFixed(0)}`);
        console.log(`  t=${run.time.toFixed(2)} b=(${b.x.toFixed(0)},${b.z.toFixed(0)}) r=${b.radius.toFixed(1)} hp=${b.health} inv=${b.invulnerable.toFixed(2)} v=(${b.vx.toFixed(0)},${b.vz.toFixed(0)}) ${hz.join(' ')}`);
      }
      if (run.time >= nextSample) {
        nextSample += 60;
        const b = run.bunny;
        const r = b.radius;
        const ratio = b.stats.get('absorbRatio');
        const near = run.debris.query(b.x, b.z, viewRadiusFor(r, run.tier)).filter((d) => canAbsorb(r, ratio, d.size) && !debrisLocked(b, d) && d.size >= r * 0.12 && reachableBy(run.house, d.x, d.z, d.size, r));
        supply.push(`${Math.round(run.time / 60)}m:r${r.toFixed(0)}/${near.length}`);
        if (stalls && r < lastR * 1.02) log.push(`${fmt(run.time)} STALL r=${r.toFixed(1)} at (${b.x.toFixed(0)},${b.z.toFixed(0)}) absorbable in view=${near.length}`);
        lastR = r;
      }
    }
    const ms = performance.now() - t0;
    for (const t of TIERS) if (run.tierTimes[t.index] !== undefined) sum.tiers[t.index - 1]!.push(run.tierTimes[t.index]!);
    sum.n++;
    const fluff = fluffForRun(run.endReason ?? 'quit', run.getStats());
    sum.fluff.push(fluff);
    if (run.endReason === 'victory' || bossWon) {
      sum.wins++;
      sum.ends.push(run.time);
    }
    if (run.endReason === 'died') sum.deaths++;
    for (const a of run.getStats().areas ?? []) if (a.cleared) (sum.acts[a.area] ??= []).push(a.timeSec);
    if (validate) validateRun(run, sum.v, `${characterId} seed=${seed}`);
    if (quiet) continue;
    const tiers = TIERS.map((t) => `${t.name} ${fmt(run.tierTimes[t.index])}`).join(' | ');
    console.log(
      `${characterId} seed=${seed} end=${run.endReason ?? 'timeout'}@${fmt(run.time)} r=${formatLength(run.bunny.realRadius)} hits=${hits} absorbed=${run.debrisAbsorbed}+${run.hazardsAbsorbed}h debris=${run.debris.count} starved=${bot.starved.toFixed(0)}s fluff=${fluff} sim=${(ms / 1000).toFixed(1)}s\n  ${tiers}\n  supply (r / reachable absorbables in view): ${supply.join(' ')}`,
    );
    if (log.length) console.log(`  ${log.join('\n  ')}`);
  }
}

const med = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : undefined);
console.log(`\nMedian Tier times (runs reaching it), ${difficulty}${withAbility ? '' : ', no Abilities'}${opt('loadout') ? `, loadout ${opt('loadout')}` : ''}:`);
for (const [id, s] of Object.entries(summary)) {
  console.log(
    `  ${id.padEnd(7)} ${TIERS.map((t) => `T${t.index} ${fmt(med(s.tiers[t.index - 1]!))}(${s.tiers[t.index - 1]!.length})`).join('  ')}  win ${fmt(med(s.ends))}  fluff ${Math.min(...s.fluff)}–${med(s.fluff)}–${Math.max(...s.fluff)}  wins ${s.wins}/${s.n} deaths ${s.deaths}`,
  );
  const bosses = BOSS_IDS.filter((b) => s.fights[b]);
  const acts = AREA_ORDER.filter((a) => s.acts[a]?.length).map((a) => `${a} ${fmt(med(s.acts[a]!))}(${s.acts[a]!.length})`);
  if (acts.length) console.log(`          Act time, entry → boss absorbed (median, clears): ${acts.join('  ')}`);
  const stuns = Object.entries(s.stuns).map(([c, n]) => `${c} ${n}`).join(', ');
  console.log(`          bosses beaten (kills/fights): ${bosses.map((b) => `${b} ${s.kills[b] ?? 0}/${s.fights[b]}`).join('  ') || 'none fought'}  ability uses ${s.abilityUses}${stuns ? `  boss stuns: ${stuns}` : ''}`);
  if (s.fights.the_expansion) {
    const xs = [...s.expansion].sort((a, b) => a - b);
    console.log(`          the Expansion (spawn → collapse): median ${fmt(med(xs))}, range ${fmt(xs[0])}–${fmt(xs[xs.length - 1])} (${xs.length} collapses / ${s.fights.the_expansion} fights), Big Rips ${s.rips}, deaths during the fight ${s.expansionDeaths}`);
  }
  const grown = AREA_ORDER.filter((a) => s.growth[a]);
  if (grown.length) {
    console.log(`          growth to the boss's absorb radius (median s from ${GROWTH_SHARES.map((f) => `${Math.round(f * 100)}%`).join(' / ')}):`);
    for (const a of grown) console.log(`            ${a.padEnd(13)} ${s.growth[a]!.map((xs) => String(Math.round(med(xs) ?? NaN)).padStart(4)).join(' ')}  (${s.growth[a]![0]!.length} runs)`);
  }
  if (s.loadout.length) console.log(`          loadout ${s.loadout.map((k) => `${k.type}:${k.rarity}`).join(', ')}`);
  if (validate) {
    const pct = (x: number) => `${Math.round(x * 100)}%`;
    const areas = Object.entries(s.v.areaHeadroom).map(([a, x]) => `${a} ${pct(x)}`).join(', ');
    console.log(`          leaderboard: ${s.v.checked - s.v.rejected.length}/${s.v.checked} submissions valid, closest to the growth limit: run board ${pct(s.v.runHeadroom)}${areas ? `, ${areas}` : ''}`);
    for (const r of s.v.rejected) console.log(`            REJECTED ${r}`);
  }
}
if (validate && Object.values(summary).some((s) => s.v.rejected.length)) process.exitCode = 1;
