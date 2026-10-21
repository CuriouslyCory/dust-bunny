/**
 * Headless balance bot: plays Runs with a greedy "eat the best nearby Debris" policy and
 * prints when each Tier is reached. Usage: pnpm sim [seed ...] [--minutes=15]
 */
import { EventBus } from '../src/core/events';
import type { InputSource, InputState } from '../src/core/input';
import { TIERS } from '../src/data/tiers';
import type { Debris } from '../src/entities/debris';
import { Run } from '../src/game/run';
import { canAbsorb } from '../src/systems/absorb';
import { viewRadiusFor } from '../src/systems/camera';

const args = process.argv.slice(2);
const minutes = Number(args.find((a) => a.startsWith('--minutes='))?.split('=')[1] ?? 15);
const seeds = args.filter((a) => !a.startsWith('--'));
if (seeds.length === 0) seeds.push('alpha', 'bravo', 'charlie');

class GreedyBot implements InputSource {
  private target: Debris | null = null;
  private retarget = 0;
  private wander = 0;
  private wanderDir = { x: 1, z: 0 };
  private lastPos = { x: 0, z: 0 };
  private stuckTimer = 0;
  private dashTimer = 0;
  private blacklist = new Set<number>();

  constructor(private readonly run: Run) {}

  sample(): InputState {
    const dt = 1 / 60;
    const { bunny, debris } = this.run;
    this.retarget -= dt;
    this.dashTimer -= dt;
    this.stuckTimer += dt;
    if (this.stuckTimer > 0.6) {
      const moved = Math.hypot(bunny.x - this.lastPos.x, bunny.z - this.lastPos.z);
      if (moved < bunny.radius * 0.8) {
        const a = Math.random() * Math.PI * 2;
        this.wanderDir = { x: Math.cos(a), z: Math.sin(a) };
        this.wander = 0.5;
        if (this.target) this.blacklist.add(this.target.id);
        this.target = null;
      }
      this.lastPos = { x: bunny.x, z: bunny.z };
      this.stuckTimer = 0;
    }
    if (this.wander > 0) {
      this.wander -= dt;
      return { moveX: this.wanderDir.x, moveZ: this.wanderDir.z, dash: false };
    }
    if (!this.target?.alive || this.retarget <= 0) {
      this.retarget = 0.3;
      const r = bunny.radius;
      const ratio = bunny.stats.get('absorbRatio');
      const near = debris.query(bunny.x, bunny.z, viewRadiusFor(r, this.run.tier));
      let best: Debris | null = null;
      let bestScore = 0;
      for (const d of near) {
        if (!canAbsorb(r, ratio, d.size) || this.blacklist.has(d.id)) continue;
        const dist = Math.hypot(d.x - bunny.x, d.z - bunny.z) + r;
        const score = (d.size / r) ** 3 * d.type.mass / dist;
        if (score > bestScore) {
          bestScore = score;
          best = d;
        }
      }
      this.target = best;
    }
    if (!this.target) {
      const a = Math.random() * Math.PI * 2;
      this.wanderDir = { x: Math.cos(a), z: Math.sin(a) };
      this.wander = 1;
      return { moveX: this.wanderDir.x, moveZ: this.wanderDir.z, dash: false };
    }
    const dx = this.target.x - bunny.x;
    const dz = this.target.z - bunny.z;
    const d = Math.hypot(dx, dz) || 1;
    const dash = d > bunny.radius * 8 && this.dashTimer <= 0;
    if (dash) this.dashTimer = 1;
    return { moveX: dx / d, moveZ: dz / d, dash };
  }
}

for (const seed of seeds) {
  const events = new EventBus();
  const run = new Run(events, { seed, characterId: 'lint' });
  run.input = new GreedyBot(run);
  const dt = 1 / 60;
  const steps = minutes * 60 * 60;
  const t0 = performance.now();
  for (let i = 0; i < steps && run.tier < 5; i++) run.update(dt);
  const ms = performance.now() - t0;
  const fmt = (s: number | undefined) => (s === undefined ? '  -  ' : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`);
  const tiers = TIERS.map((t) => `${t.name} ${fmt(run.tierTimes[t.index])}`).join(' | ');
  console.log(
    `seed=${seed} r=${run.bunny.radius.toFixed(1)}cm absorbed=${run.debrisAbsorbed} debris=${run.debris.count} sim=${(ms / 1000).toFixed(1)}s\n  ${tiers}`,
  );
}
