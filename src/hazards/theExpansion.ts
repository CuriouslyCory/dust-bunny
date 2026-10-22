/**
 * The Expansion (universe boss, Tier 21; THE_EXPANSION in src/data/hazards.ts). Not a chaser and
 * not a body: the expansion of space itself, drawn as a metric lattice round the Bunny (the
 * `the_expansion` model centred on it, its hollow `hollow` × the Bunny's radius; `grid` stretches
 * outward as the expansion gains, `ring` turns). It is `intangible`: it never touches the Bunny
 * or the Decoy, is never absorbed by size (`size` is Infinity), and Abilities and Spiky Dash
 * ignore it. Arrives like the other bosses (`bossSpawned` 4 s after Tier 21).
 *
 * - **Tug-of-war.** Its health is `gravity` in [0, 1], starting at `gravity.start`. Everything the
 *   Bunny absorbs (Debris and Hazards, `debrisAbsorbed`) adds `gain` × (size ÷ r₀)³ to `pending`,
 *   r₀ being the Bunny's radius when it arrived (growing mid-fight never makes the bar harder),
 *   which flows into the bar at up to `maxRise` per s (so even the fastest eater needs about a
 *   minute); the expansion drains it at a rate ramping from `drain[0]` to `drain[1]` over `ramp` s.
 *   `bossTug` reports it about 4 times a second (the boss HUD bar, the drone).
 * - **Hubble flow.** While it expands, every loose Debris within `hubble.reach` × the view radius
 *   moves straight away from the Bunny at H × its distance (H ramping like the drain), capped at
 *   `hubble.cap` × the Bunny's max speed, so near Debris is always catchable and far Debris
 *   recedes (Debris reaching the map's edge stops there). Updated in `hubble.slices` interleaved
 *   slices of the field (Debris id modulo slices), each moved by its slice's share of time.
 * - **Filament strands** (no soft-lock): every `strands.interval` s, if fewer than `strands.want`
 *   absorbable Debris of at least `meaningful` × the Bunny's radius are within `range` × the view
 *   radius, or the bar is below `strands.low`, a strand of `count` pieces lands in a line beyond
 *   the view (ahead of the Bunny when it is rolling) and drifts in against the flow until it is
 *   within `stop` × the view radius.
 * - **The Big Rip.** At 0 the bar bottoms out: 1 damage (`bunny.damage`), the Bunny sheds
 *   `rip.shedFraction`, the bar restarts at `ripReset` with `ripGrace` s of no drain (`bossRip`).
 *   Ignoring the fight eventually kills.
 * - **Collapse.** At 1 it collapses (`bossCollapse`): the other Hazards are pulled in, every
 *   Debris within `collapse.reach` × the view radius rushes into the Bunny over
 *   `collapse.duration` s (the ending's first shot: the last galaxy filament is absorbed), then
 *   `bossDefeated` and `run.clearArea()`: the last Area, so `victory` and the Run ends.
 */
import { AdditiveBlending, Mesh, type Material, type Object3D } from 'three';
import type { GameEvents } from '../core/events';
import type { Rng } from '../core/rng';
import { THE_EXPANSION, type ExpansionTuning } from '../data/hazards';
import type { Debris } from '../entities/debris';
import type { Run } from '../game/run';
import { viewRadiusFor } from '../systems/camera';
import { maxSpeedFor } from '../systems/movement';
import { isFloorFree } from '../systems/spawner';
import { BaseHazard } from './base';
import { ringDecal } from './decals';
import { playAbsorbFx } from './fx';
import { hazardRegistry, type HazardDef } from './index';
import { pickShedType, shedMass } from './shed';

export type ExpansionState = 'intro' | 'expanding' | 'collapse';

/**
 * Gravity gained from absorbing something of `size`: gain × (size / radius)³, `radius` being the
 * Bunny's when the Expansion arrived (so growing during the fight never makes the bar harder).
 */
export function tugGain(cfg: ExpansionTuning, size: number, radius: number): number {
  return cfg.gravity.gain * (size / Math.max(1e-6, radius)) ** 3;
}

/** H (1/s) and the drain (per s) `fightTime` s after the intro, ramping over `ramp` s. */
export function expansionRates(cfg: ExpansionTuning, fightTime: number): { hubble: number; drain: number } {
  const k = Math.min(1, Math.max(0, fightTime / cfg.ramp));
  const [h0, h1] = cfg.hubble.rate;
  const [d0, d1] = cfg.gravity.drain;
  return { hubble: h0 + (h1 - h0) * k, drain: d0 + (d1 - d0) * k };
}

/** Outward Hubble-flow speed of a Debris `dist` from the Bunny: H × dist, capped at `cap`. */
export function hubbleSpeed(hubble: number, dist: number, cap: number): number {
  return Math.min(hubble * dist, cap);
}

const TUG_INTERVAL = 0.25;
const _debris: Debris[] = [];

export class TheExpansion extends BaseHazard {
  readonly intangible = true;
  readonly ranged = true;
  state: ExpansionState = 'intro';
  /** The tug-of-war bar: 0 = the Big Rip, 1 = collapse. */
  gravity: number;
  /** Absorbed gravity still flowing into the bar (at most `gravity.maxRise` per s). */
  pending = 0;
  /** Seconds since the intro ended (drives the ramp). */
  fightTime = 0;
  /** The Bunny's radius when it arrived: absorbed volume is measured against it (`tugGain`). */
  readonly arrivalRadius: number;
  hubble = 0;
  drain = 0;
  /** Big Rips so far, filament strands drifted in, and Debris swallowed in the collapse. */
  rips = 0;
  strandsSent = 0;
  crunched = 0;
  private timer: number;
  private ripGrace = 0;
  private strandTimer = 0;
  private tugTimer = 0;
  private flowTick = 0;
  /** 0..1 flash after a Big Rip (the lattice snaps outward, a red ring runs out). */
  private ripFlash = 0;
  /** Strand pieces still drifting in (exempt from the flow). */
  private readonly strands = new Set<Debris>();
  /** Debris rushing into the Bunny during the collapse. */
  private crunch: Debris[] = [];
  private readonly grid: Object3D | null;
  private readonly ring: Object3D | null;
  private readonly ripRing;
  private readonly offAbsorbed: () => void;

  constructor(
    id: number,
    def: HazardDef,
    run: Run,
    x: number,
    z: number,
    private readonly rng: Rng,
    readonly cfg: ExpansionTuning = THE_EXPANSION,
  ) {
    super(id, def, x, z, Infinity, cfg.modelId);
    this.shape = { kind: 'circle', radius: cfg.footprint };
    this.gravity = cfg.gravity.start;
    this.arrivalRadius = run.bunny.radius;
    this.timer = cfg.introTime;
    this.grid = this.model.getObjectByName('grid') ?? null;
    this.ring = this.model.getObjectByName('ring') ?? null;
    fadeLattice(this.model);
    this.ripRing = this.addDecal(ringDecal(0.9, 1, '#ff5a3a', 0.6, 96));
    this.ripRing.visible = false;
    this.offAbsorbed = run.events.on('debrisAbsorbed', (e) => this.absorbed(e));
    this.x = run.bunny.x;
    this.z = run.bunny.z;
  }

  /** Pull towards gravity from anything absorbed while it expands. */
  private absorbed(e: GameEvents['debrisAbsorbed']): void {
    if (this.state !== 'expanding' || this.dead) return;
    this.pending = Math.min(this.cfg.gravity.maxPending, this.pending + tugGain(this.cfg, e.size, this.arrivalRadius));
  }

  protected tick(dt: number, run: Run): void {
    const b = run.bunny;
    this.x = b.x;
    this.z = b.z;
    this.ripFlash = Math.max(0, this.ripFlash - dt * 1.4);
    switch (this.state) {
      case 'intro':
        this.timer -= dt;
        if (this.timer <= 0) {
          this.state = 'expanding';
          this.strandTimer = 0;
        }
        this.spinRing(dt, 0.15);
        break;
      case 'expanding':
        this.expand(dt, run);
        break;
      case 'collapse':
        this.collapse(dt, run);
        break;
    }
  }

  private expand(dt: number, run: Run): void {
    const c = this.cfg;
    this.fightTime += dt;
    const rates = expansionRates(c, this.fightTime);
    this.hubble = rates.hubble;
    this.drain = rates.drain;
    const g = this.cfg.gravity;
    const rise = Math.min(this.pending, g.maxRise * dt);
    this.pending -= rise;
    this.gravity = Math.min(1, this.gravity + rise);
    if (this.gravity >= 1) {
      this.startCollapse(run);
      return;
    }
    if (this.ripGrace > 0) this.ripGrace -= dt;
    else this.gravity = Math.max(0, this.gravity - this.drain * dt);
    this.tugTimer -= dt;
    if (this.tugTimer <= 0) {
      this.tugTimer = TUG_INTERVAL;
      run.events.emit('bossTug', { hazardId: this.id, gravity: this.gravity, pending: this.pending, drain: this.drain, hubble: this.hubble });
    }
    if (this.gravity <= 0) this.rip(run);
    this.flow(dt, run);
    this.feedStrands(dt, run);
    this.spinRing(dt, 0.2 + this.hubble * 3);
  }

  /** The Hubble flow: one slice of the field moves outward by its share of time. */
  private flow(dt: number, run: Run): void {
    const h = this.cfg.hubble;
    const b = run.bunny;
    const reach = viewRadiusFor(b.radius, run.tier) * h.reach;
    const reach2 = reach * reach;
    const cap = h.cap * maxSpeedFor(b);
    const slice = this.flowTick++ % h.slices;
    const step = dt * h.slices;
    const H = this.hubble;
    const house = run.house;
    const field = run.debris;
    field.forEach((d) => {
      if (d.id % h.slices !== slice) return;
      const dx = d.x - b.x;
      const dz = d.z - b.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > reach2 || d2 < 1e-9 || this.strands.has(d)) return;
      const dist = Math.sqrt(d2);
      const k = (hubbleSpeed(H, dist, cap) * step) / dist;
      const nx = d.x + dx * k;
      const nz = d.z + dz * k;
      if (isFloorFree(house, nx, nz, d.size)) field.move(d, nx, nz);
    });
  }

  /** Strands drift in; a new one lands beyond the view when meaningful food near the Bunny runs low. */
  private feedStrands(dt: number, run: Run): void {
    const s = this.cfg.strands;
    const b = run.bunny;
    const viewR = viewRadiusFor(b.radius, run.tier);
    const stop = viewR * s.stop;
    const speed = s.speed * maxSpeedFor(b);
    for (const d of this.strands) {
      if (!d.alive) {
        this.strands.delete(d);
        continue;
      }
      const dx = b.x - d.x;
      const dz = b.z - d.z;
      const dist = Math.hypot(dx, dz);
      if (dist <= stop) {
        this.strands.delete(d);
        continue;
      }
      const step = Math.min(dist - stop, speed * dt);
      const nx = d.x + (dx / dist) * step;
      const nz = d.z + (dz / dist) * step;
      if (isFloorFree(run.house, nx, nz, d.size)) run.debris.move(d, nx, nz);
    }
    this.strandTimer -= dt;
    if (this.strandTimer > 0) return;
    this.strandTimer = s.interval;
    const ratio = b.stats.get('absorbRatio');
    const maxSize = b.radius * ratio;
    _debris.length = 0;
    run.debris.query(b.x, b.z, viewR * s.range, _debris);
    let food = 0;
    for (const d of _debris) if (d.size <= maxSize && d.size >= b.radius * s.meaningful) food++;
    // Losing (the bar low): a strand every check, whatever is about.
    if (food + this.strands.size < s.want || this.gravity < s.low) this.sendStrand(run, viewR);
  }

  /** A strand of `count` pieces in a line pointing at the Bunny, just beyond the view: ahead of it when it rolls. */
  private sendStrand(run: Run, viewR: number): void {
    const s = this.cfg.strands;
    const b = run.bunny;
    const maxSize = b.radius * b.stats.get('absorbRatio');
    const types = run.debris.types;
    const speed = Math.hypot(b.vx, b.vz);
    const heading = speed > 0.2 * maxSpeedFor(b) ? Math.atan2(b.vx, b.vz) : this.rng.range(-Math.PI, Math.PI);
    const named = s.types.map((id) => types.findIndex((t) => t.id === id)).find((j) => j >= 0);
    for (let attempt = 0; attempt < 8; attempt++) {
      const a = heading + (attempt === 0 ? this.rng.range(-0.5, 0.5) : this.rng.range(-Math.PI, Math.PI));
      const ux = Math.sin(a);
      const uz = Math.cos(a);
      let dist = viewR * s.distance;
      let placed = 0;
      for (let i = 0; i < s.count; i++) {
        const size = maxSize * this.rng.range(s.size[0], s.size[1]);
        const index = named ?? types.indexOf(pickShedType(types, size, run.tier, run.area)!);
        if (index < 0) return;
        dist += size;
        const x = b.x + ux * dist;
        const z = b.z + uz * dist;
        dist += size * 1.6;
        if (!isFloorFree(run.house, x, z, size)) continue;
        const d = run.debris.spawn(index, x, z, this.rng, { size });
        if (!d) continue;
        this.strands.add(d);
        placed++;
      }
      if (placed > 0) {
        this.strandsSent++;
        return;
      }
    }
  }

  /** The bar bottomed out: the Big Rip. */
  private rip(run: Run): void {
    const c = this.cfg;
    const damaged = run.bunny.damage(c.rip.damage, this.def.id);
    const plan = shedMass(run, this.rng, c.rip.shedFraction, this.def.id);
    this.gravity = c.gravity.ripReset;
    this.ripGrace = c.gravity.ripGrace;
    this.ripFlash = 1;
    this.rips++;
    run.events.emit('bossRip', { hazardId: this.id, damaged, volume: plan.volume });
  }

  private startCollapse(run: Run): void {
    const c = this.cfg.collapse;
    const b = run.bunny;
    this.state = 'collapse';
    this.gravity = 1;
    this.pending = 0;
    this.timer = c.duration;
    this.strands.clear();
    b.invulnerable = Math.max(b.invulnerable, c.duration + 1);
    // Everything else falls in with it.
    for (const h of run.hazards.hazards) {
      if (h === this || h.dead) continue;
      h.dead = true;
      if (h instanceof BaseHazard) playAbsorbFx(run, h.body);
    }
    this.crunch = run.debris.query(b.x, b.z, viewRadiusFor(b.radius, run.tier) * c.reach, []);
    run.events.emit('bossTug', { hazardId: this.id, gravity: 1, pending: 0, drain: 0, hubble: 0 });
    run.events.emit('bossCollapse', { hazardId: this.id, debris: this.crunch.length, duration: c.duration });
  }

  /** Every Debris in view rushes into the Bunny, faster and faster; then the Universe is cleared. */
  private collapse(dt: number, run: Run): void {
    const c = this.cfg.collapse;
    const b = run.bunny;
    this.timer -= dt;
    const k = Math.min(1, 1 - this.timer / c.duration);
    const pull = Math.min(1, dt * (0.4 + 7 * k * k));
    for (const d of this.crunch) {
      if (!d.alive) continue;
      const nx = d.x + (b.x - d.x) * pull;
      const nz = d.z + (b.z - d.z) * pull;
      // Swallowed as it reaches the fur: removed rather than absorbed, so the crunch adds no growth.
      if (Math.hypot(b.x - nx, b.z - nz) < b.radius + d.size) {
        run.debris.remove(d);
        this.crunched++;
        continue;
      }
      run.debris.move(d, nx, nz);
    }
    this.spinRing(dt, 1 + 8 * k);
    if (this.timer > 0) return;
    for (const d of this.crunch) {
      if (!d.alive) continue;
      run.debris.remove(d);
      this.crunched++;
    }
    this.crunch = [];
    this.dead = true;
    run.events.emit('bossDefeated', { hazardId: this.id, defId: this.def.id, timeSec: run.time });
    // The last Area: clearing it wins the Run (victory, then runEnded).
    run.clearArea();
  }

  private spinRing(dt: number, rate: number): void {
    if (this.ring) this.ring.rotation.y += rate * dt;
  }

  /** Model scale: its hollow at `hollow` × the Bunny's radius, unfolding through the intro and folding up in the collapse. */
  private appear(): number {
    if (this.state === 'intro') {
      const k = 1 - Math.max(0, this.timer) / this.cfg.introTime;
      return 0.2 + 0.8 * k * k * (3 - 2 * k);
    }
    if (this.state === 'collapse') return Math.max(0.02, this.timer / this.cfg.collapse.duration);
    return 1;
  }

  protected override sync(run: Run): void {
    // Not BaseHazard.sync: no absorbable marker, no stun wobble (it is never absorbed or stunned).
    const b = run.bunny;
    const c = this.cfg;
    this.body.position.set(this.x, 0, this.z);
    this.body.rotation.set(0, 0, 0);
    const scale = ((c.hollow * b.radius) / c.modelHollow) * this.appear();
    // Flattened onto the floor so the lattice reads as stretched space round the play, not a dish over it.
    this.model.scale.set(scale, scale * LATTICE_FLATTEN, scale);
    if (this.grid) {
      // Space stretching: wider the more the expansion is winning, snapping out on a Big Rip.
      const stretch = 1 + 0.22 * (1 - this.gravity) + 0.04 * Math.sin(this.time * 2.2) + 0.45 * this.ripFlash;
      this.grid.scale.set(stretch, 1, stretch);
    }
    this.ripRing.visible = this.ripFlash > 0;
    if (this.ripFlash > 0) {
      const r = scale * c.modelHollow * (1 + 3 * (1 - this.ripFlash));
      this.ripRing.place(this.x, this.z);
      this.ripRing.root.scale.set(r, 1, r);
      this.ripRing.setOpacity(0.7 * this.ripFlash);
    }
  }

  override dispose(): void {
    this.offAbsorbed();
    this.strands.clear();
    this.crunch = [];
    super.dispose();
  }
}

/** Height kept from the model: a low lattice on the floor rather than a bowl over the Bunny. */
const LATTICE_FLATTEN = 0.25;

/** The lattice drawn faint and additive (own material copies), so Debris and Hazards inside it stay readable. */
function fadeLattice(model: Object3D): void {
  model.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    const fade = (m: Material): Material => {
      const c = m.clone();
      c.transparent = true;
      c.opacity = 0.4;
      c.depthWrite = false;
      c.blending = AdditiveBlending;
      return c;
    };
    o.material = Array.isArray(o.material) ? o.material.map(fade) : fade(o.material);
  });
}

export const theExpansionDef = hazardRegistry.register({
  id: 'the_expansion',
  name: 'The Expansion',
  boss: true,
  // It centres on the Bunny at once; the footprint only places its arrival.
  footprint: { radius: THE_EXPANSION.footprint, height: THE_EXPANSION.height },
  mass: THE_EXPANSION.mass,
  modelId: THE_EXPANSION.modelId,
  create(run, x, z, id, rng: Rng) {
    return new TheExpansion(id, this, run, x, z, rng, THE_EXPANSION);
  },
});
