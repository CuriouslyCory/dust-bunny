/**
 * Headless balance bot. Plays Runs like a competent player: it plans paths on a coarse
 * occupancy grid (walls, furniture it cannot roll under, Obstacle Debris), heads for the best
 * absorbable Debris it can see, sidesteps Hazard telegraphs, drafts a random Perk at each
 * Tier-up, grabs Pickups it passes and fights the boss by dodging charges and ramming it
 * while stunned. Prints when each Tier is reached, plus how the Run ended.
 *
 * When an area boss falls (Robo-Vac 9000, Street Sweeper, Garbage Truck) the bot does not walk to
 * the exit: the Run moves straight to the next area (logged), so outdoor, city and region pacing
 * are measured too. The summary prints each Area's median time from entry to its clear (the Act).
 * With --no-hazards a Run stops at each Area's boss Tier (no boss to clear), but keeps rolling in
 * the last Area until --minutes so growth towards the boss size is measured.
 *
 * Abilities: Lint drops a Decoy when a boss telegraph or a Broom sweep targets it, or a vacuum
 * cone or spray lane is about to hit it (--decoy=boss: only the first two, the issue's policy).
 * Tumble hunkers while a telegraphed boss lane crosses it, and for up to 2 s when a Broom sweep or
 * spray lane is about to hit it (--hunker=lane: boss lanes only). Both defaults beat the issue's
 * policies over 60 seeds (Lint 20 → 27 wins, Tumble 5 → 7). Zap discharges at the nearest Hazard
 * in range once the Static meter is full. --no-ability plays without Abilities (for comparison).
 * The summary also counts boss fights and boss kills per Character. --boss plays only the house
 * boss fight: the Run starts at Tier 5 (fresh Bunny, four random Perks) and stops when the
 * Robo-Vac 9000 is absorbed, so `wins` there is the boss win rate.
 *
 * Keepsakes: --loadout=<type>:<grade>,<type>:<grade> tucks those Keepsakes in for the Character
 * they belong to (the other Characters play without); --loadout=max gives every Character its
 * MAX_LOADOUTS pair at grade 4 (the strongest legal pair today, see MAX_LOADOUTS).
 *
 * Leaderboards: --validate builds the Run board and Area board submissions every Run would post
 * (submissionFromRun / areaSubmission) and checks them with validateSubmission /
 * validateAreaSubmission, printing each rejection and, per Character, the closest a Run came to
 * the growth limits (radius reached ÷ radius allowed for the time; 100% = rejected). Runs that
 * start at Tier 5 (--boss) or in a later area (--area) are unranked and not checked.
 *
 * Usage: pnpm sim [seed ...] [--seeds=N] [--minutes=15] [--chars=lint,tumble,zap] [--no-hazards] [--no-ability]
 *                 [--hunker=defend|lane] [--decoy=defend|boss] [--boss] [--quiet] [--stalls] [--god] [--perks=id,id] [--upgrades=id:level,...]
 *                 [--area=neighborhood|city|region]   start in a later area (as after its previous boss)
 *                 [--difficulty=casual|arcade|hardcore]
 *                 [--loadout=type:grade,type:grade | --loadout=max] [--validate]
 *   --seeds=N plays seeds s1 … sN when no seed is given (default: alpha … echo).
 */
import { getAbilitySystem, type DecoyAbility, type DischargeAbility, type HunkerAbility } from '../src/abilities';
import { EventBus } from '../src/core/events';
import type { InputSource, InputState } from '../src/core/input';
import { Rng } from '../src/core/rng';
import { getTier, TIERS } from '../src/data/tiers';
import { formatLength } from '../src/data/units';
import { AREA_ORDER, nextArea, type AreaId } from '../src/world/types';
import { TUNING } from '../src/data/tuning';
import type { Debris } from '../src/entities/debris';
import { createRun } from '../src/game/assembly';
import type { Run } from '../src/game/run';
import type { Hazard } from '../src/hazards';
import type { RoboVac9000 } from '../src/hazards/robovac';
import { SprayBottle as SprayBottleClass, type SprayBottle } from '../src/hazards/sprayBottle';
import { inCone, UprightVacuum as UprightVacuumClass, type UprightVacuum } from '../src/hazards/uprightVacuum';
import { Broom as BroomClass, type Broom } from '../src/hazards/broom';
import { getDifficulty } from '../src/data/difficulty';
import { AREA_BOSSES, BROOM, tierValue } from '../src/data/hazards';
import { getKeepsakeType, isLoadoutFor, type KeepsakeRef, type KeepsakeTypeId, type Loadout } from '../src/data/keepsakes';
import { areaSubmission, submissionFromRun } from '../src/net/leaderboard';
import { areaRadiusAllowed, runRadiusAllowed, validateAreaSubmission, validateSubmission } from '../src/shared/leaderboard';
import { progressRadius } from '../src/shared/score';
import { fluffForRun } from '../src/meta/fluff';
import { upgradeModifiers } from '../src/meta/upgrades';
import { canAbsorb } from '../src/systems/absorb';
import { viewRadiusFor } from '../src/systems/camera';
import { passesUnder } from '../src/systems/collision';
import { reachableBy } from '../src/systems/spawner';

const args = process.argv.slice(2);
const opt = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const minutes = Number(opt('minutes') ?? 15);
const chars = (opt('chars') ?? 'lint,tumble,zap').split(',');
const withHazards = !args.includes('--no-hazards');
const withAbility = !args.includes('--no-ability');
/** Tumble's Hunker policy: 'defend' (default: boss lanes, plus plants of at most 2 s against Broom sweeps and spray lanes) or 'lane' (boss lanes only, the issue's policy). */
const hunkerPolicy = opt('hunker') === 'lane' ? 'lane' : 'defend';
/** Lint's Decoy policy: 'defend' (default: boss telegraphs, Broom aggro, and vacuum cones or spray lanes about to hit) or 'boss' (the first two only, the issue's policy). */
const decoyPolicy = opt('decoy') === 'boss' ? 'boss' : 'defend';
const ALL_HITS: ReadonlySet<'vacuum' | 'spray' | 'broom'> = new Set(['vacuum', 'spray', 'broom']);
const SHORT_HITS: ReadonlySet<'vacuum' | 'spray' | 'broom'> = new Set(['spray', 'broom']);
/** Boss fight only: start the house at Tier 5 (the Robo-Vac 9000 arrives 3 s later) and stop when it falls. */
const bossOnly = args.includes('--boss');
const quiet = args.includes('--quiet');
const stalls = args.includes('--stalls');
/** Hazards hit as usual (knockback, shedding) but can't kill: measures pacing, not survival. */
const god = args.includes('--god');
const traceAt = opt('trace') === undefined ? undefined : Number(opt('trace'));
const fixedPerks = opt('perks')?.split(',');
const upgrades = Object.fromEntries((opt('upgrades') ?? '').split(',').filter(Boolean).map((s) => [s.split(':')[0]!, Number(s.split(':')[1] ?? 1)]));
const startArea = AREA_ORDER.includes(opt('area') as AreaId) && opt('area') !== 'house' ? (opt('area') as AreaId) : undefined;
const difficulty = getDifficulty(opt('difficulty')).id;
const seeds = args.filter((a) => !a.startsWith('--'));
const seedCount = Number(opt('seeds') ?? 0);
if (seeds.length === 0 && seedCount > 0) for (let i = 1; i <= seedCount; i++) seeds.push(`s${i}`);
if (seeds.length === 0) seeds.push('alpha', 'bravo', 'charlie', 'delta', 'echo');
const validate = args.includes('--validate') && !bossOnly && !startArea;

/**
 * --loadout=max: the strongest legal pair at grade 4 per Character. Chosen by playing every pair
 * of that Character's types (duplicates included, 15 per Character) at grade 4 over seeds s1–s30
 * (--minutes=25, default bot policies) and taking the most wins, then the fastest median win:
 * Lint Quick Shed + Reclaim (18/30 wins, base 12/30), Tumble Snowball ×2 (7/30, base 2/30), Zap
 * Static Cling + Grounding (26/30 in 14:02, base 21/30 in 14:57). Re-run that search when
 * Keepsake values or the bot change (docs/design.md "Keepsake effects").
 */
const MAX_LOADOUTS: Record<string, readonly [KeepsakeTypeId, KeepsakeTypeId]> = {
  lint: ['quick_shed', 'reclaim'],
  tumble: ['snowball', 'snowball'],
  zap: ['static_cling', 'grounding'],
};
const MAX_GRADE_TODAY = 4;

/** The Loadout --loadout gives a Character ([] without the flag or when no listed type is its own). */
function loadoutFor(characterId: string): Loadout {
  const spec = opt('loadout');
  if (!spec) return [];
  if (spec === 'max') return (MAX_LOADOUTS[characterId] ?? []).map((type) => ({ type, grade: MAX_GRADE_TODAY }));
  const refs: KeepsakeRef[] = spec.split(',').filter(Boolean).map((s) => {
    const [type, g] = s.split(':');
    if (!type || !getKeepsakeType(type)) throw new Error(`--loadout: unknown Keepsake type "${type}"`);
    return { type: type as KeepsakeTypeId, grade: Number(g ?? MAX_GRADE_TODAY) };
  });
  const own = refs.filter((k) => getKeepsakeType(k.type)!.characterId === characterId);
  if (!isLoadoutFor(characterId, own)) throw new Error(`--loadout: not a legal Loadout for ${characterId}: ${spec}`);
  return own;
}

/** Occupancy grid for a Bunny of a given radius, with BFS path distances from the Bunny. */
class Planner {
  cell = 4;
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
    // World units: cm up to the City, 10 m in the Region (where the Bunny is house-sized again).
    const cap = { house: 8, neighborhood: 60, city: 200, region: 4 }[house.area];
    this.cell = Math.min(cap, Math.max(house.area === 'region' ? 0.5 : 2, r * 0.6));
    this.cols = Math.ceil((bd.maxX - bd.minX) / this.cell);
    this.rows = Math.ceil((bd.maxZ - bd.minZ) / this.cell);
    const n = this.cols * this.rows;
    this.blocked = new Uint8Array(n);
    this.dist = new Int32Array(n);
    this.parent = new Int32Array(n);
    let pad = r * 0.95;
    const mark = (minX: number, minZ: number, maxX: number, maxZ: number) => {
      const c0 = Math.max(0, Math.floor((minX - pad) / this.cell));
      const c1 = Math.min(this.cols - 1, Math.floor((maxX + pad) / this.cell));
      const r0 = Math.max(0, Math.floor((minZ - pad) / this.cell));
      const r1 = Math.min(this.rows - 1, Math.floor((maxZ + pad) / this.cell));
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
      if (canAbsorb(r, ratio, d.size) || d.size <= r * TUNING.push.ratio) return;
      const s = d.size * 0.6;
      mark(d.x - s, d.z - s, d.x + s, d.z + s);
    });
    // Keep the outer rim blocked (bounds clamp).
    const rim = Math.ceil(r / this.cell);
    for (let row = 0; row < this.rows; row++) for (let c = 0; c < this.cols; c++) if (row < rim || c < rim || row >= this.rows - rim || c >= this.cols - rim) this.blocked[row * this.cols + c] = 1;
  }

  debugStart(): string {
    const i = this.index(this.run.bunny.x, this.run.bunny.z);
    let n = 0;
    for (let k = 0; k < this.dist.length; k++) if (this.dist[k]! >= 0) n++;
    return `${!this.blocked[i]} flooded=${n}/${this.dist.length}`;
  }

  index(x: number, z: number): number {
    const c = Math.min(this.cols - 1, Math.max(0, Math.floor(x / this.cell)));
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
          const cc = c + dc;
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
        const cc = sc + dc;
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
    return { x: (c + 0.5) * this.cell, z: (row + 0.5) * this.cell };
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
    for (const h of hazards.hazards) {
      if (h.dead) continue;
      const dx = bunny.x - h.x;
      const dz = bunny.z - h.z;
      const d = Math.hypot(dx, dz) || 1;
      const boss = h.def.boss ? (h as RoboVac9000) : null;
      const reach = (h.shape.kind === 'circle' ? h.shape.radius : Math.max(h.shape.halfW, h.shape.halfD)) + r;
      if (canAbsorb(r, ratio, h.size) || boss?.state === 'stunned') {
        if (d < chaseD && d < viewRadiusFor(r, this.run.tier)) {
          chase = h;
          chaseD = d;
        }
        continue;
      }
      const spray = h.def.id === 'spray_bottle' || h.def.id === 'pressure_washer' || h.def.id === 'crop_duster' ? (h as SprayBottle) : null;
      const sprayReach = spray && spray.def.id !== 'spray_bottle' ? tierValue(spray.cfg.range, this.run.tier) + r : 300;
      if (spray && d < sprayReach && (spray.state === 'telegraph' || spray.state === 'firing' || spray.droplets.length > 0)) {
        // Sidestep the aim lane (a player sees the red lane).
        const fx = Math.sin(spray.yaw);
        const fz = Math.cos(spray.yaw);
        const side = fx * dz - fz * dx >= 0 ? 1 : -1;
        x += -fz * side * 2;
        z += fx * side * 2;
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
    const near = debris.query(bunny.x, bunny.z, viewRadiusFor(r, this.run.tier));
    let best: Debris | null = null;
    let bestScore = 0;
    for (const d of near) {
      if (!canAbsorb(r, ratio, d.size) || (this.blacklist.get(d.id) ?? 0) > this.run.time || !reachableBy(house, d.x, d.z, d.size, r)) continue;
      const crow = Math.hypot(d.x - bunny.x, d.z - bunny.z);
      const quick = ((d.size / r) ** 3 * d.type.mass) / (crow + r);
      if (quick <= bestScore) continue; // path length >= straight line, so it can't win
      const path = this.planner.pathTo(d.x, d.z, r + d.size);
      if (path < 0) continue;
      const score = ((d.size / r) ** 3 * d.type.mass) / (path + r);
      if (score > bestScore) {
        bestScore = score;
        best = d;
      }
    }
    // Pickups are worth a detour.
    for (const p of this.run.pickups.floor) {
      const path = this.planner.pathTo(p.x, p.z, r + p.radius);
      if (path >= 0 && path < viewRadiusFor(r, this.run.tier) * 0.6) {
        this.steer = this.planner.steerTo(p.x, p.z, r + p.radius);
        this.target = null;
        return;
      }
    }
    if (traceAt !== undefined && this.run.time > traceAt && this.run.time < traceAt + 1) {
      const ab = near.filter((d) => canAbsorb(r, ratio, d.size));
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

  /** A Broom sweep, vacuum / blower cone or spray lane (of the given kinds) is about to hit the Bunny. */
  private imminentHit(kinds: ReadonlySet<'vacuum' | 'spray' | 'broom'> = ALL_HITS): boolean {
    const { bunny, hazards } = this.run;
    const r = bunny.radius;
    for (const h of hazards.hazards) {
      if (h.dead || canAbsorb(r, bunny.stats.get('absorbRatio'), h.size) || h.stunnedFor) continue;
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
      } else if (h.def.boss && kinds.has('spray') && (h as RoboVac9000).ashState !== 'idle' && this.inAshLane(h as RoboVac9000)) {
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
    const bosses = hazards.hazards.filter((h) => !h.dead && h.def.boss) as RoboVac9000[];
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
    if (sys.data.id === 'hunker') {
      const ctl = sys.controller as HunkerAbility;
      const lane = bosses.some((b) => (b.state === 'telegraph' || b.state === 'charge') && this.laneCrosses(b));
      // defend: also short plants against sprays and Broom sweeps (not vacuums: their suction lasts, so walking out is better).
      const hit = hunkerPolicy === 'defend' && this.imminentHit(SHORT_HITS);
      if (ctl.active) {
        // Hold until the charge is over (the boss crashed into us, or stopped); against a spray or sweep, at most 2 s.
        const keep = lane || (hit && ctl.held < 2) || bosses.some((b) => b.state === 'stunned' && Math.hypot(b.x - bunny.x, b.z - bunny.z) < b.cfg.contactRadius * b.scale + bunny.radius * 1.5);
        return { ability: false, abilityHeld: keep };
      }
      const go = (lane || hit) && ctl.canPlant;
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
  { tiers: number[][]; ends: number[]; fluff: number[]; wins: number; deaths: number; n: number; fights: Record<string, number>; kills: Record<string, number>; abilityUses: number; loadout: Loadout; v: Validation; acts: Record<string, number[]> }
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
    loadout,
    v: { checked: 0, rejected: [], runHeadroom: 0, areaHeadroom: {} },
    acts: {} as Record<string, number[]>,
  });
  for (const seed of seeds) {
    const events = new EventBus();
    // --no-hazards: pure growth, so neither Hazards nor Pickups spawn.
    const run = createRun(events, { seed, characterId, difficulty, modifiers, perks: fixedPerks, area: startArea, loadout }, { hazards: withHazards, pickups: withHazards, abilities: withAbility });
    events.on('hazardSpawned', (e) => {
      if (BOSS_IDS.includes(e.defId)) sum.fights[e.defId] = (sum.fights[e.defId] ?? 0) + 1;
    });
    events.on('bossDefeated', (e) => (sum.kills[e.defId] = (sum.kills[e.defId] ?? 0) + 1));
    events.on('abilityUsed', () => sum.abilityUses++);
    /** Area whose exit just opened (the bot skips the walk to it), or null. */
    let leaveArea: string | null = null;
    events.on('exitOpened', (e) => {
      log.push(`${fmt(run.time)} ${e.area} cleared r=${run.bunny.radius.toFixed(1)} → next area`);
      leaveArea = e.area;
    });
    events.on('areaEntered', (e) => log.push(`${fmt(run.time)} entered ${e.area} r=${run.bunny.radius.toFixed(1)}`));
    events.on('bossDefeated', (e) => log.push(`${fmt(run.time)} ${e.defId} absorbed r=${run.bunny.radius.toFixed(1)}`));
    const bot = new Bot(run);
    run.input = bot;
    let bossWon = false;
    if (bossOnly) {
      events.on('bossDefeated', () => (bossWon = true));
      run.bunny.setRadius(getTier(5).minRadius * 1.02);
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
        log.push(`${fmt(run.time)} T${run.tier} r=${run.bunny.radius.toFixed(1)} hit by ${e.source} hp=${e.health}/${e.maxHealth}`);
      });
      events.on('bossSpawned', (e) => log.push(`${fmt(run.time)} boss spawned, absorb at r=${e.absorbRadius.toFixed(1)} (r=${run.bunny.radius.toFixed(1)})`));
      events.on('bossHit', (e) => log.push(`${fmt(run.time)} boss chipped → absorb at r=${e.absorbRadius.toFixed(1)} (r=${run.bunny.radius.toFixed(1)})`));
      events.on('pickupCollected', (e) => log.push(`${fmt(run.time)} pickup ${e.defId}`));
    }
    const supply: string[] = [];
    let nextSample = 60;
    let lastR = 0;
    const dt = 1 / 60;
    const steps = minutes * 60 * 60;
    const t0 = performance.now();
    for (let i = 0; i < steps && !run.ended && !bossWon && (withHazards || nextArea(run.area) === null || run.tier < AREA_BOSSES[run.area].tier); i++) {
      run.update(dt);
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
        const near = run.debris.query(b.x, b.z, viewRadiusFor(r, run.tier)).filter((d) => canAbsorb(r, ratio, d.size) && d.size >= r * 0.12 && reachableBy(run.house, d.x, d.z, d.size, r));
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
  console.log(`          bosses beaten (kills/fights): ${bosses.map((b) => `${b} ${s.kills[b] ?? 0}/${s.fights[b]}`).join('  ') || 'none fought'}  ability uses ${s.abilityUses}`);
  if (s.loadout.length) console.log(`          loadout ${s.loadout.map((k) => `${k.type}:${k.grade}`).join(', ')}`);
  if (validate) {
    const pct = (x: number) => `${Math.round(x * 100)}%`;
    const areas = Object.entries(s.v.areaHeadroom).map(([a, x]) => `${a} ${pct(x)}`).join(', ');
    console.log(`          leaderboard: ${s.v.checked - s.v.rejected.length}/${s.v.checked} submissions valid, closest to the growth limit: run board ${pct(s.v.runHeadroom)}${areas ? `, ${areas}` : ''}`);
    for (const r of s.v.rejected) console.log(`            REJECTED ${r}`);
  }
}
if (validate && Object.values(summary).some((s) => s.v.rejected.length)) process.exitCode = 1;
