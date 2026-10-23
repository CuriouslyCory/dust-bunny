/**
 * Sagittarius A* (galaxy boss, Tier 19; SAGITTARIUS_A in src/data/hazards.ts): the bosses' state
 * machine (RoboVac9000: intro, hunt, telegraphed charge, stun, chip, absorb) reskinned as the
 * biggest vacuum there is.
 *
 * - **The pull bends the camera.** While it hunts, its suction (the bosses' radial suction, the
 *   strongest of any boss) pulls the Bunny in; `lens` tells the renderer how hard (src/fx/lensing.ts:
 *   a gravitational-lensing warp round it, and the camera leaning and rolling towards it).
 * - **It eats.** While it hunts, telegraphs, charges or recovers, loose Debris within `feed.reach`
 *   of its edge spirals in and is swallowed at its horizon (not its own chips).
 * - **Indigestion.** Each star cluster it swallows (`clusters.meals`: a `star_cluster` counts 1, an
 *   `open_cluster` ½, any cluster `bigSize` or more a whole `threshold`) adds to its fullness, the
 *   meals of the last `clusters.window` s, shown as a ring filling round it (`bossSwallowed`). At
 *   `threshold` (two star clusters within a few seconds) it is stunned (`bossStunned`, cause
 *   'indigestion'): an amber ring circles the disc, the glow sputters, its jets cough, and ramming it
 *   chips it. No crash stuns it: the map edge just ends a charge. Abilities and Spiky Dash still
 *   stun it as usual.
 * - **Clusters drift in.** When it starts hunting, and every `clusters.interval` s of hunting, if
 *   less than `clusters.count` meals' worth of clusters is within `clusters.range` of it, that many
 *   star clusters land side by side between it and the Bunny (within its Debris pull), too big for
 *   the Bunny to eat (`keepClusters`): the fight can't run out of clusters.
 * - **Jets.** Its volley (`ash`) is a relativistic jet: a violet lane, then a train of bolts; the
 *   north jet (`jet_n`) swells while it aims. Chips are `relativistic_jet` Debris, and each chip
 *   hides `jet_n` for `jetRegrow` s.
 *
 * Absorbing it clears the Galaxy (`run.clearArea()`): the intergalactic gate opens onto the Universe.
 */
import type { Object3D } from 'three';
import type { Rng } from '../core/rng';
import { SAGITTARIUS_A, type SagittariusTuning } from '../data/hazards';
import type { Debris } from '../entities/debris';
import { LENS_FRONT_LAYER, type GravityLens } from '../fx/lensing';
import type { Run } from '../game/run';
import { isFloorFree } from '../systems/spawner';
import { bunnyCanAbsorb, bunnySheltered, suctionFalloff, suctionReachFor } from './common';
import { DECAL_COLORS, ringDecal } from './decals';
import { hazardRegistry, type HazardDef } from './index';
import { RoboVac9000 } from './robovac';
import { scatterDebris } from './shed';
import { ownGlowMaterials, type GlowMaterial } from './theSun';

const _debris: Debris[] = [];
/** Segments of the fullness ring (drawn up to the fullness fraction). */
const MEAL_SEGMENTS = 48;
/** Model proportions (model units ÷ 100 at the GLB's 0.01 scale): the hole's radius and centre height, the disc's rim. */
const HOLE_RADIUS = 1;
const HOLE_Y = 1.5;
const DISC_RADIUS = 3.2;
/** The Einstein ring's radius (× the hole's) and how far the warp reaches (× the disc's rim). */
const EINSTEIN = 2;
const LENS_REACH = 1.8;

export class SagittariusA extends RoboVac9000 {
  readonly sgr: SagittariusTuning;
  /** Star-cluster meals of the last `clusters.window` s (time swallowed, weight). */
  private readonly meals: Array<{ t: number; w: number }> = [];
  /** Sum of the meal weights in the window; at `clusters.threshold` it is stunned. */
  fullness = 0;
  /** Debris swallowed, star clusters among them, indigestion stuns, and clusters it drifted in. */
  swallowed = 0;
  clusterMeals = 0;
  indigestions = 0;
  fallbacks = 0;
  private clusterTimer = 0;
  private clusterPlaced = false;
  /** Seconds until the chipped north jet shows again. */
  jetRegrow = 0;
  /** Glow level (1: full; sputtering while stunned) and a flash after each cluster. */
  glow = 1;
  private flash = 0;
  private readonly glowMats: GlowMaterial[];
  private readonly mealRing;
  /** Amber ring round the disc while it is stunned (the bosses' stun ring is under the disc). */
  private readonly stunHalo;
  private readonly jetN: Object3D | null;
  /** Suction on the Bunny this tick (0..1 falloff; 0 when not pulling). */
  pull = 0;
  /** The camera bend, read by the renderer every frame (src/fx/lensing.ts). */
  readonly lens: GravityLens = { x: 0, y: 0, z: 0, horizon: 1, einstein: 2, extent: 5, strength: 0, pull: 0, lean: 0, roll: 0 };

  constructor(id: number, def: HazardDef, x: number, z: number, rng: Rng, cfg: SagittariusTuning = SAGITTARIUS_A) {
    super(id, def, x, z, rng, cfg);
    this.sgr = cfg;
    this.glowMats = ownGlowMaterials(this.model);
    this.jetN = this.model.getObjectByName('jet_n') ?? null;
    // The north jet stands in front of the lens: drawn after the warp (src/fx/lensing.ts).
    this.jetN?.traverse((o) => o.layers.set(LENS_FRONT_LAYER));
    this.mealRing = this.addDecal(ringDecal(1, 1.12, '#b48cff', 0.85, MEAL_SEGMENTS));
    this.mealRing.visible = false;
    this.stunHalo = this.addDecal(ringDecal(1, 1.1, DECAL_COLORS.warn, 0.8, 64));
    this.stunHalo.visible = false;
    this.lens.strength = cfg.lens.idle;
    this.syncLens();
  }

  /** True while it pulls Debris in: hunting, telegraphing, charging or recovering. */
  get feeding(): boolean {
    return this.state === 'hunt' || this.state === 'telegraph' || this.state === 'charge' || this.state === 'recover';
  }

  protected override tick(dt: number, run: Run): void {
    super.tick(dt, run);
    const radius = this.cfg.contactRadius * this.scale;
    if (this.state === 'stunned') this.meals.length = 0;
    else if (this.feeding) this.feed(dt, run, radius);
    this.digest();
    if (this.state === 'hunt') {
      this.clusterTimer -= dt;
      if (!this.clusterPlaced || this.clusterTimer <= 0) {
        this.keepClusters(run);
        this.clusterPlaced = true;
        this.clusterTimer = this.sgr.clusters.interval;
      }
    }
    this.updatePull(run, radius);
    this.updateLooks(dt);
    this.updateLens(dt, run);
  }

  /** Drops meals older than the window and sums the rest. */
  private digest(): void {
    const w = this.sgr.clusters.window;
    while (this.meals.length > 0 && this.time - this.meals[0]!.t > w) this.meals.shift();
    let sum = 0;
    for (const m of this.meals) sum += m.w;
    this.fullness = sum;
  }

  /** The pull on loose Debris: it spirals in and is swallowed at the horizon. */
  private feed(dt: number, run: Run, radius: number): void {
    const f = this.sgr.feed;
    _debris.length = 0;
    run.debris.query(this.x, this.z, radius + f.reach + f.maxSize, _debris);
    for (const d of _debris) {
      if (!d.alive || d.size > f.maxSize || d.type.id === this.sgr.chipTypeId) continue;
      const dx = this.x - d.x;
      const dz = this.z - d.z;
      const dist = Math.hypot(dx, dz) || 1e-6;
      if (dist < radius * f.eatRadius + d.size / 3) {
        this.swallow(run, d);
        if (this.state === 'stunned') return;
        continue;
      }
      const falloff = suctionFalloff(dist - d.size - radius, 0, f.reach);
      if (falloff <= 0) continue;
      const step = Math.min(dist, f.speed * (0.35 + 0.65 * falloff) * falloff * dt);
      const nx = d.x + ((dx - dz * f.swirl) / dist) * step;
      const nz = d.z + ((dz + dx * f.swirl) / dist) * step;
      if (isFloorFree(run.house, nx, nz, d.size)) run.debris.move(d, nx, nz);
    }
  }

  /** Swallows `d`; a star cluster counts towards indigestion, and a full meal stuns it. */
  private swallow(run: Run, d: Debris): void {
    const c = this.sgr.clusters;
    run.debris.remove(d);
    this.swallowed++;
    const w = c.meals[d.type.id] === undefined ? 0 : d.size >= c.bigSize ? c.threshold : c.meals[d.type.id]!;
    if (w <= 0) return;
    this.clusterMeals++;
    this.meals.push({ t: this.time, w });
    this.digest();
    this.flash = 1;
    run.events.emit('bossSwallowed', { hazardId: this.id, typeId: d.type.id, fullness: this.fullness, threshold: c.threshold });
    if (this.fullness >= c.threshold - 1e-6) {
      this.indigestions++;
      this.meals.length = 0;
      this.fullness = 0;
      this.crashStun(run, 'indigestion');
    }
  }

  /** Suction falloff on the Bunny this tick (the bosses' hunt suction): drives the camera bend. */
  private updatePull(run: Run, radius: number): void {
    const b = run.bunny;
    this.pull = 0;
    if (this.state !== 'hunt' || b.hiddenFromHazards || bunnySheltered(run, this.cfg.height) || bunnyCanAbsorb(run, this.size)) return;
    const reach = radius + suctionReachFor(this.cfg.suctionReach, b.stats.get('suctionMultiplier'));
    this.pull = suctionFalloff(Math.hypot(b.x - this.x, b.z - this.z) - b.radius, radius, reach);
  }

  /** Disc spin, the north jet, the glow and the fullness ring. */
  private updateLooks(dt: number): void {
    const stunned = this.state === 'stunned';
    this.spin('disk', dt * (stunned ? 0.12 : 0.5));
    if (this.jetRegrow > 0) this.jetRegrow -= dt;
    if (this.jetN) {
      this.jetN.visible = this.jetRegrow <= 0;
      let s = 1;
      if (stunned) s = 0.35 + 0.35 * Math.abs(Math.sin(this.time * 23));
      else if (this.ashState === 'telegraph') s = 1 + 0.3 * (0.5 + 0.5 * Math.sin(this.time * 18));
      else if (this.ashState === 'firing') s = 1.45;
      this.jetN.scale.set(1, s, 1);
    }
    const target = stunned ? 0.3 + 0.3 * Math.abs(Math.sin(this.time * 9)) : 1;
    this.glow += (target - this.glow) * Math.min(1, dt * 8);
    this.flash = Math.max(0, this.flash - dt * 2.5);
    const k = this.glow + this.flash * 1.5;
    for (const g of this.glowMats) g.m.emissiveIntensity = g.base * k;

    // Both rings sit just outside the accretion disc's rim, where the disc can't hide them.
    const rim = (DISC_RADIUS * this.size) / this.cfg.modelSize;
    this.stunHalo.visible = stunned;
    if (stunned) {
      const r = rim * (1.1 + 0.04 * Math.sin(this.time * 6));
      this.stunHalo.place(this.x, this.z);
      this.stunHalo.root.scale.set(r, 1, r);
      this.stunHalo.pulse(this.time, 0.5);
    }
    const c = this.sgr.clusters;
    const frac = Math.min(1, this.fullness / c.threshold);
    this.mealRing.visible = !stunned && frac > 0;
    if (this.mealRing.visible) {
      const r = rim * 1.04;
      this.mealRing.place(this.x, this.z, Math.PI);
      this.mealRing.root.scale.set(r, 1, r);
      this.mealRing.mesh.geometry.setDrawRange(0, Math.max(1, Math.round(frac * MEAL_SEGMENTS)) * 6);
      this.mealRing.setColor(frac >= 0.5 ? '#ffb347' : '#b48cff');
      this.mealRing.setOpacity(0.6 + 0.3 * Math.sin(this.time * 10) + this.flash * 0.3);
    }
  }

  /** Eases the lensing strength and the camera pull towards this tick's suction. */
  private updateLens(dt: number, run: Run): void {
    const l = this.sgr.lens;
    const stunned = this.state === 'stunned';
    // The warp is screen-space: it fades out as the Bunny rolls over the disc, so it never smears the Bunny.
    const b = run.bunny;
    const edge = this.lens.einstein * 1.5 + b.radius;
    const clear = Math.min(1, Math.max(0, (Math.hypot(b.x - this.x, b.z - this.z) - edge) / Math.max(1, b.radius)));
    const strength = (stunned ? l.idle * 0.6 : l.idle + (l.full - l.idle) * this.pull) * clear;
    const k = Math.min(1, dt * 3);
    this.lens.strength += (strength - this.lens.strength) * k;
    this.lens.pull += ((stunned ? 0 : this.pull) - this.lens.pull) * k;
    this.syncLens();
  }

  private syncLens(): void {
    const k = this.size / this.cfg.modelSize;
    const l = this.lens;
    l.x = this.x;
    l.z = this.z;
    l.y = HOLE_Y * k;
    l.horizon = HOLE_RADIUS * k;
    l.einstein = HOLE_RADIUS * EINSTEIN * k;
    l.extent = DISC_RADIUS * LENS_REACH * k;
    l.lean = this.sgr.lens.lean;
    l.roll = this.sgr.lens.roll;
  }

  /** No crash stuns it: the map edge only ends a charge. */
  protected override crashStuns(_run: Run, _radius: number): boolean {
    return false;
  }

  /** Chip pieces are relativistic jets (`chipTypeId`); each chip hides the north jet for a while. */
  protected override scatterChips(run: Run, count: number, size: number, inner: number, outer: number): void {
    this.jetRegrow = this.sgr.jetRegrow;
    if (this.jetN) this.jetN.visible = false;
    const type = run.debris.types.find((t) => t.id === this.sgr.chipTypeId);
    if (!type) {
      super.scatterChips(run, count, size, inner, outer);
      return;
    }
    scatterDebris(run, this.rng, this.x, this.z, count, size, inner, outer, type);
  }

  /**
   * Makes sure `clusters.count` star clusters' worth of meals (an open cluster is half a meal) is
   * within `clusters.range` of it: if less is, `count` `fallbackId` clusters land side by side on
   * the line from it towards the Bunny, `gap` short of the Bunny's edge but never further from it
   * than half its Debris pull (else at the nearest clear bearing round it), each at least the type's
   * size and `margin` × the largest size the Bunny can absorb, clear of it and of the Bunny. False
   * if there was no need, no fallback type or no room.
   */
  keepClusters(run: Run): boolean {
    const c = this.sgr.clusters;
    const index = run.debris.types.findIndex((t) => t.id === c.fallbackId);
    if (index < 0) return false;
    _debris.length = 0;
    run.debris.query(this.x, this.z, c.range, _debris);
    let near = 0;
    for (const d of _debris) if (d.alive) near += c.meals[d.type.id] ?? 0;
    if (near >= c.count - 1e-6) return false;
    const b = run.bunny;
    const type = run.debris.types[index]!;
    const size = Math.max(type.size, b.radius * b.stats.get('absorbRatio') * c.margin);
    const radius = this.cfg.contactRadius * this.scale;
    const clear = radius + size + 1;
    const gap = Math.hypot(b.x - this.x, b.z - this.z);
    const along = Math.max(clear, Math.min(gap - b.radius - c.gap - size, radius + size + this.sgr.feed.reach * 0.5));
    const base = Math.atan2(b.z - this.z, b.x - this.x);
    const spots: Array<{ x: number; z: number }> = [];
    for (let i = 0; i < 12; i++) {
      // Alternate either side of the bearing towards the Bunny, widening.
      const a = base + (i % 2 === 0 ? 1 : -1) * Math.ceil(i / 2) * (Math.PI / 6);
      const px = -Math.sin(a);
      const pz = Math.cos(a);
      spots.length = 0;
      for (let k = 0; k < c.count; k++) {
        const off = (k - (c.count - 1) / 2) * size * 2.3;
        const x = this.x + Math.cos(a) * along + px * off;
        const z = this.z + Math.sin(a) * along + pz * off;
        if (Math.hypot(x - this.x, z - this.z) < clear || Math.hypot(x - b.x, z - b.z) < b.radius + size + 0.5 || !isFloorFree(run.house, x, z, size)) break;
        spots.push({ x, z });
      }
      if (spots.length < c.count) continue;
      for (const s of spots) if (run.debris.spawn(index, s.x, s.z, this.rng, { size })) this.fallbacks++;
      return true;
    }
    return false;
  }
}

export const sagittariusADef = hazardRegistry.register({
  id: 'sagittarius_a',
  name: 'Sagittarius A*',
  boss: true,
  // Full-size contact radius: room for the boss before it is chipped.
  footprint: { radius: SAGITTARIUS_A.contactRadius, height: SAGITTARIUS_A.height },
  mass: SAGITTARIUS_A.mass,
  modelId: SAGITTARIUS_A.modelId,
  create(_run, x, z, id, rng: Rng) {
    return new SagittariusA(id, this, x, z, rng, SAGITTARIUS_A);
  },
});
