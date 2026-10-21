/**
 * Headless balance bot. Plays Runs like a competent player: it plans paths on a coarse
 * occupancy grid (walls, furniture it cannot roll under, Obstacle Debris), heads for the best
 * absorbable Debris it can see, sidesteps Hazard telegraphs, drafts a random Perk at each
 * Tier-up, grabs Pickups it passes and fights the boss by dodging charges and ramming it
 * while stunned. Prints when each Tier is reached, plus how the Run ended.
 *
 * Usage: pnpm sim [seed ...] [--minutes=15] [--chars=lint,tumble,zap] [--no-hazards]
 *                 [--quiet] [--stalls] [--perks=id,id] [--upgrades=id:level,...]
 */
import { EventBus } from '../src/core/events';
import type { InputSource, InputState } from '../src/core/input';
import { Rng } from '../src/core/rng';
import { TIERS } from '../src/data/tiers';
import { TUNING } from '../src/data/tuning';
import type { Debris } from '../src/entities/debris';
import { Run } from '../src/game/run';
import type { Hazard } from '../src/hazards';
import { installRunHazards } from '../src/hazards/install';
import type { RoboVac9000 } from '../src/hazards/robovac';
import type { SprayBottle } from '../src/hazards/sprayBottle';
import { upgradeModifiers } from '../src/meta/upgrades';
import { installCombatHooks } from '../src/perks/combat';
import { draftForRun } from '../src/perks/draft';
import { registerPerks } from '../src/perks/perks';
import { createPickupDirector } from '../src/pickups/director';
import { registerPickups } from '../src/pickups/pickups';
import { canAbsorb } from '../src/systems/absorb';
import { viewRadiusFor } from '../src/systems/camera';
import { passesUnder } from '../src/systems/collision';
import { reachableBy } from '../src/systems/spawner';

const args = process.argv.slice(2);
const opt = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const minutes = Number(opt('minutes') ?? 15);
const chars = (opt('chars') ?? 'lint,tumble,zap').split(',');
const withHazards = !args.includes('--no-hazards');
const quiet = args.includes('--quiet');
const stalls = args.includes('--stalls');
const traceAt = opt('trace') === undefined ? undefined : Number(opt('trace'));
const fixedPerks = opt('perks')?.split(',');
const upgrades = Object.fromEntries((opt('upgrades') ?? '').split(',').filter(Boolean).map((s) => [s.split(':')[0]!, Number(s.split(':')[1] ?? 1)]));
const seeds = args.filter((a) => !a.startsWith('--'));
if (seeds.length === 0) seeds.push('alpha', 'bravo', 'charlie', 'delta', 'echo');

registerPickups();
registerPerks();

/** Occupancy grid for a Bunny of a given radius, with BFS path distances from the Bunny. */
class Planner {
  cell = 4;
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
    if (this.builtFor > 0 && r < this.builtFor * 1.08 && r > this.builtFor * 0.92 && this.run.time - this.builtAt < 4) return;
    this.builtFor = r;
    this.builtAt = this.run.time;
    const house = this.run.house;
    const bd = house.bounds;
    this.cell = Math.min(8, Math.max(2, r * 0.6));
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

  constructor(private readonly run: Run) {
    this.rng = new Rng(`${run.config.seed}:bot`);
    this.planner = new Planner(run);
  }

  /** Repulsion from Hazards the Bunny cannot absorb; a chase target for ones it can. */
  private hazardSteer(): { x: number; z: number; urgent: boolean; chase: Hazard | null } {
    const { bunny, hazards } = this.run;
    const r = bunny.radius;
    const ratio = bunny.stats.get('absorbRatio');
    let x = 0;
    let z = 0;
    let urgent = false;
    let chase: Hazard | null = null;
    let chaseD = Infinity;
    for (const h of hazards.hazards) {
      if (h.dead) continue;
      const dx = bunny.x - h.x;
      const dz = bunny.z - h.z;
      const d = Math.hypot(dx, dz) || 1;
      const boss = h.def.id === 'robovac_9000' ? (h as RoboVac9000) : null;
      const reach = (h.shape.kind === 'circle' ? h.shape.radius : Math.max(h.shape.halfW, h.shape.halfD)) + r;
      if (canAbsorb(r, ratio, h.size) || boss?.state === 'stunned') {
        if (d < chaseD && d < viewRadiusFor(r, this.run.tier)) {
          chase = h;
          chaseD = d;
        }
        continue;
      }
      const spray = h.def.id === 'spray_bottle' ? (h as SprayBottle) : null;
      if (spray && d < 300 && (spray.state === 'telegraph' || spray.state === 'firing' || spray.droplets.length > 0)) {
        // Sidestep the aim lane (a player sees the red lane).
        const fx = Math.sin(spray.yaw);
        const fz = Math.cos(spray.yaw);
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
        urgent = boss.state === 'charge' || d < 200;
        continue;
      }
      const danger = reach + Math.max(30, r * 3);
      if (d < danger) {
        const w = (danger - d) / danger;
        x += (dx / d) * w * 2;
        z += (dz / d) * w * 2;
        if (d < reach + r) urgent = true;
      }
    }
    return { x, z, urgent, chase };
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

  sample(): InputState {
    const dt = 1 / 60;
    const { bunny } = this.run;
    this.replan -= dt;
    this.dashTimer -= dt;
    this.stuckTimer += dt;
    const avoid = withHazards ? this.hazardSteer() : { x: 0, z: 0, urgent: false, chase: null };
    if (avoid.chase) {
      const dx = avoid.chase.x - bunny.x;
      const dz = avoid.chase.z - bunny.z;
      const d = Math.hypot(dx, dz) || 1;
      const dash = this.dashTimer <= 0 && d > bunny.radius * 3;
      if (dash) this.dashTimer = 1;
      return { moveX: dx / d, moveZ: dz / d, dash };
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
    mx += avoid.x;
    mz += avoid.z;
    const m = Math.hypot(mx, mz) || 1;
    const dash = avoid.urgent && this.dashTimer <= 0;
    if (dash) this.dashTimer = 1;
    return { moveX: mx / m, moveZ: mz / m, dash };
  }
}

const fmt = (s: number | undefined) => (s === undefined ? '  -  ' : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`);
const summary: Record<string, { tiers: number[][]; ends: number[]; wins: number; deaths: number; n: number }> = {};
const modifiers = upgradeModifiers(upgrades);

for (const characterId of chars) {
  const sum = (summary[characterId] = { tiers: TIERS.map((): number[] => []), ends: [] as number[], wins: 0, deaths: 0, n: 0 });
  for (const seed of seeds) {
    const events = new EventBus();
    const run = new Run(events, { seed, characterId, modifiers, perks: fixedPerks });
    const bot = new Bot(run);
    run.input = bot;
    const log: string[] = [];
    const perkRng = new Rng(`${seed}:perks`);
    let hits = 0;
    if (withHazards) {
      installRunHazards(run);
      // Same as installRunHooks (src/meta/install.ts), which also pulls in UI/CSS.
      installCombatHooks(run);
      run.pickups.director ??= createPickupDirector();
      events.on('tierUp', () => {
        const offer = draftForRun(run);
        const pick = offer[Math.floor(perkRng.next() * offer.length)];
        if (pick) {
          run.applyPerk(pick.id);
          log.push(`${fmt(run.time)} T${run.tier} perk ${pick.id}`);
        }
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
    for (let i = 0; i < steps && !run.ended && (withHazards || run.tier < 5); i++) {
      run.update(dt);
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
    if (run.endReason === 'victory') {
      sum.wins++;
      sum.ends.push(run.time);
    }
    if (run.endReason === 'died') sum.deaths++;
    if (quiet) continue;
    const tiers = TIERS.map((t) => `${t.name} ${fmt(run.tierTimes[t.index])}`).join(' | ');
    console.log(
      `${characterId} seed=${seed} end=${run.endReason ?? 'timeout'}@${fmt(run.time)} r=${run.bunny.radius.toFixed(1)}cm hits=${hits} absorbed=${run.debrisAbsorbed}+${run.hazardsAbsorbed}h debris=${run.debris.count} starved=${bot.starved.toFixed(0)}s sim=${(ms / 1000).toFixed(1)}s\n  ${tiers}\n  supply (r / reachable absorbables in view): ${supply.join(' ')}`,
    );
    if (log.length) console.log(`  ${log.join('\n  ')}`);
  }
}

const med = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : undefined);
console.log('\nMedian Tier times (runs reaching it):');
for (const [id, s] of Object.entries(summary)) {
  console.log(
    `  ${id.padEnd(7)} ${TIERS.map((t) => `T${t.index} ${fmt(med(s.tiers[t.index - 1]!))}(${s.tiers[t.index - 1]!.length})`).join('  ')}  win ${fmt(med(s.ends))}  wins ${s.wins}/${s.n} deaths ${s.deaths}`,
  );
}
