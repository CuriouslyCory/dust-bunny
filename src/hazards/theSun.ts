/**
 * The Sun (solar system boss; THE_SUN in src/data/hazards.ts): the bosses' state machine
 * (RoboVac9000: intro, hunt, telegraphed charge, stun, hit, absorb) reskinned as a very large leaf
 * blower.
 *
 * - **Solar wind.** No suction: while it hunts, telegraphs or recovers, a Bunny within `wind.reach`
 *   of its surface is pushed straight away from it (`applyPush`, fading with distance; nothing
 *   while the Bunny is Amassing or hidden, or once it can absorb the Sun), and small loose Debris
 *   there is blown outward.
 * - **Coronal mass ejections** are its charges: a red lane, then a dash. **Flare volleys** are the
 *   boss `ash` volley in orange.
 * - **Only a giant planet stops it.** The Solar System has no obstacles; the map edge just ends a
 *   charge. A charge that runs into a giant planet (Debris types `giants.typeIds`: Jupiter, Saturn,
 *   Uranus, Neptune, the Hot Jupiter) that the Bunny can't absorb yet (`canAbsorbDebris`, so a
 *   Jupiter still locked until Tier 17 counts) stops against it and stuns it (`chargeBlocked`,
 *   `crashStuns`): an eclipse, its glow dims (`eclipseGlow`) and the wind stops. Such a planet also
 *   blocks it while it hunts. Abilities and Spiky Dash still stun it as usual.
 * - **The Hot Jupiter swings round.** When it starts hunting, and every `giants.interval` s of
 *   hunting, if no blocking giant is within `giants.range` of the Bunny, a `hot_jupiter` lands near
 *   the Bunny (between the Bunny and the Sun the first time), at least the type's size and
 *   `giants.margin` × the largest size the Bunny can absorb: once the Bunny has eaten Jupiter (it
 *   unlocks at Tier 17) its charges still have something to hit.
 * - **Hits knock prominences loose** (`prominence` Debris, src/data/sunDebris.ts); each hit hides one of
 *   its `prominence_l` / `prominence_r` arcs for `prominenceRegrow` s. Its `corona` turns.
 *
 * Absorbing it clears the Solar System (`run.clearArea()`): the heliopause gate opens onto the Galaxy.
 */
import type { Material, Mesh, MeshStandardMaterial, Object3D } from 'three';
import type { Rng } from '../core/rng';
import { THE_SUN, type SunTuning } from '../data/hazards';
import { PROMINENCE_ID } from '../data/sunDebris';
import type { Debris } from '../entities/debris';
import type { Run } from '../game/run';
import { canAbsorbDebris } from '../systems/absorb';
import { isFloorFree } from '../systems/spawner';
import { applyPush, bunnyCanAbsorb, bunnySheltered, suctionFalloff } from './common';
import { hazardRegistry, type HazardDef } from './index';
import { RoboVac9000 } from './robovac';
import { scatterDebris } from './shed';

const _debris: Debris[] = [];
/** Giant planet collision disc as a fraction of its size (the Bunny's Debris collision uses 0.85). */
const GIANT_DISC = 0.9;
const PROMINENCE_NODES = ['prominence_l', 'prominence_r'] as const;

/** True if `d` is a giant planet (one of `typeIds`) that the Bunny can't absorb yet: it blocks and stuns the Sun. */
export function isBlockingGiant(run: Run, d: Debris, typeIds: readonly string[] = THE_SUN.giants.typeIds): boolean {
  return d.alive && typeIds.includes(d.type.id) && !canAbsorbDebris(run.bunny, d);
}

/** The first blocking giant whose disc is within `slack` of a disc at (x, z) of `radius`, or null. */
export function blockingGiantAt(run: Run, x: number, z: number, radius: number, slack = 0, typeIds: readonly string[] = THE_SUN.giants.typeIds): Debris | null {
  _debris.length = 0;
  run.debris.queryOverlapping(x, z, radius + slack, _debris);
  for (const d of _debris) {
    if (isBlockingGiant(run, d, typeIds) && Math.hypot(d.x - x, d.z - z) < radius + d.size * GIANT_DISC + slack) return d;
  }
  return null;
}

/** A model's own copy of a glowing material and its authored emissive intensity. */
export interface GlowMaterial {
  m: MeshStandardMaterial;
  base: number;
}

/**
 * Gives `model` its own copies of its glowing (emissive) materials, which GLB and procedural
 * models share between instances, so a boss can dim or flash only itself. Returns them.
 */
export function ownGlowMaterials(model: Object3D): GlowMaterial[] {
  const out: GlowMaterial[] = [];
  model.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const own = (m: Material): Material => {
      const s = m as MeshStandardMaterial;
      if (!s.emissive || s.emissive.getHex() === 0 || !(s.emissiveIntensity > 0)) return m;
      const c = s.clone();
      out.push({ m: c, base: c.emissiveIntensity });
      return c;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(own) : own(mesh.material);
  });
  return out;
}

export class TheSun extends RoboVac9000 {
  private readonly sun: SunTuning;
  private giantTimer = 0;
  private giantPlaced = false;
  /** Hot Jupiters it has swung round so far, and charges a giant planet has stopped (eclipses). */
  giants = 0;
  eclipses = 0;
  /** Seconds until each prominence (`prominence_l`, `prominence_r`) shows again after a hit. */
  readonly regrow: [number, number] = [0, 0];
  private nextProminence = 0;
  /** Glow level (1: full, `eclipseGlow` in an eclipse) and the model's own emissive materials. */
  glow = 1;
  private readonly glowMats: GlowMaterial[];

  constructor(id: number, def: HazardDef, x: number, z: number, rng: Rng, cfg: SunTuning = THE_SUN) {
    super(id, def, x, z, rng, cfg);
    this.sun = cfg;
    this.glowMats = ownGlowMaterials(this.model);
  }

  /** True while the solar wind blows (hunting, a CME telegraph, recovering). */
  get windy(): boolean {
    return this.state === 'hunt' || this.state === 'telegraph' || this.state === 'recover';
  }

  protected override tick(dt: number, run: Run): void {
    super.tick(dt, run);
    const radius = this.cfg.contactRadius * this.scale;
    // A giant planet blocks it like an obstacle (the charge is stopped in chargeBlocked).
    if (this.state !== 'charge') this.pushOutOfGiant(run, radius);
    if (this.windy) this.blow(dt, run, radius);
    if (this.state === 'hunt') {
      this.giantTimer -= dt;
      if (!this.giantPlaced || this.giantTimer <= 0) {
        this.keepGiant(run, !this.giantPlaced);
        this.giantPlaced = true;
        this.giantTimer = this.sun.giants.interval;
      }
    }
    for (let i = 0; i < 2; i++) {
      if (this.regrow[i] <= 0) continue;
      this.regrow[i] -= dt;
      if (this.regrow[i] <= 0) this.setProminenceVisible(i, true);
    }
    this.spin('corona', dt * (this.state === 'stunned' ? 0.1 : 0.4));
    this.updateGlow(dt);
  }

  /** The eclipse: the glow eases down while stunned and back up after. */
  private updateGlow(dt: number): void {
    const target = this.state === 'stunned' ? this.sun.eclipseGlow : 1;
    this.glow += (target - this.glow) * Math.min(1, dt * 5);
    for (const g of this.glowMats) g.m.emissiveIntensity = g.base * this.glow;
  }

  /** The solar wind: pushes the Bunny away and blows small loose Debris outward. */
  private blow(dt: number, run: Run, radius: number): void {
    const w = this.sun.wind;
    const reach = w.reach * this.scale;
    const b = run.bunny;
    const gap = Math.hypot(b.x - this.x, b.z - this.z) - radius - b.radius;
    if (!bunnyCanAbsorb(run, this.size) && !bunnySheltered(run, this.cfg.height)) applyPush(run, this.x, this.z, w.strength, suctionFalloff(gap, 0, reach), dt);
    _debris.length = 0;
    run.debris.query(this.x, this.z, radius + reach, _debris);
    for (const d of _debris) {
      if (!d.alive || d.size > w.debrisSize) continue;
      const dx = d.x - this.x;
      const dz = d.z - this.z;
      const dist = Math.hypot(dx, dz) || 1;
      const step = w.debrisSpeed * suctionFalloff(dist - radius, 0, reach) * dt;
      const nx = d.x + (dx / dist) * step;
      const nz = d.z + (dz / dist) * step;
      if (step > 0 && isFloorFree(run.house, nx, nz, d.size)) run.debris.move(d, nx, nz);
    }
  }

  /** Moves it out of a blocking giant it overlaps, to just touching. True if there was one. */
  private pushOutOfGiant(run: Run, radius: number): boolean {
    const d = blockingGiantAt(run, this.x, this.z, radius, 0, this.sun.giants.typeIds);
    if (!d) return false;
    const dx = this.x - d.x;
    const dz = this.z - d.z;
    const dist = Math.hypot(dx, dz);
    const nx = dist > 1e-6 ? dx / dist : -Math.sin(this.yaw);
    const nz = dist > 1e-6 ? dz / dist : -Math.cos(this.yaw);
    const touch = radius + d.size * GIANT_DISC;
    this.x = d.x + nx * touch;
    this.z = d.z + nz * touch;
    return true;
  }

  /** A charge that runs into a giant planet the Bunny can't absorb stops against it. */
  protected override chargeBlocked(run: Run, radius: number): boolean {
    return this.pushOutOfGiant(run, radius);
  }

  /** Only a giant planet stuns it (an eclipse): the map edge just ends the charge. */
  protected override crashStuns(run: Run, radius: number): boolean {
    return blockingGiantAt(run, this.x, this.z, radius, Math.max(0.05, radius * 0.02), this.sun.giants.typeIds) !== null;
  }

  protected override onCrashStun(_run: Run): void {
    this.eclipses++;
  }

  /** Hit pieces are prominences (`partTypeId`); each hit hides one of its prominence arcs for a while. */
  protected override scatterParts(run: Run, count: number, size: number, inner: number, outer: number): void {
    const i = this.nextProminence;
    this.nextProminence = 1 - i;
    this.regrow[i] = this.sun.prominenceRegrow;
    this.setProminenceVisible(i, false);
    const partId = this.sun.partTypeId ?? PROMINENCE_ID;
    const type = run.debris.types.find((t) => t.id === partId);
    if (!type) {
      super.scatterParts(run, count, size, inner, outer);
      return;
    }
    scatterDebris(run, this.rng, this.x, this.z, count, size, inner, outer, type);
  }

  private setProminenceVisible(i: number, visible: boolean): void {
    const node = this.model.getObjectByName(PROMINENCE_NODES[i]!);
    if (node) node.visible = visible;
  }

  /**
   * Makes sure a giant planet the Bunny can't absorb is within `giants.range` of the Bunny: if none
   * is, a Hot Jupiter lands `gap` beyond the Bunny's edge (towards the Sun on `first`, else at a
   * random bearing), clear of the Sun. False if there was no need, no fallback type or no room.
   */
  keepGiant(run: Run, first = false): boolean {
    const g = this.sun.giants;
    const index = run.debris.types.findIndex((t) => t.id === g.fallbackId);
    if (index < 0) return false;
    const b = run.bunny;
    _debris.length = 0;
    run.debris.query(b.x, b.z, g.range, _debris);
    if (_debris.some((d) => isBlockingGiant(run, d, g.typeIds))) return false;
    const type = run.debris.types[index]!;
    const size = Math.max(type.size, b.radius * b.stats.get('absorbRatio') * g.margin);
    const dist = b.radius + g.gap + size;
    const clear = this.cfg.contactRadius * this.scale + size + 1;
    const base = first ? Math.atan2(this.z - b.z, this.x - b.x) : this.rng.range(0, Math.PI * 2);
    for (let i = 0; i < 12; i++) {
      // Alternate either side of the preferred bearing, widening.
      const a = base + (i % 2 === 0 ? 1 : -1) * Math.ceil(i / 2) * (Math.PI / 6);
      const x = b.x + Math.cos(a) * dist;
      const z = b.z + Math.sin(a) * dist;
      if (Math.hypot(x - this.x, z - this.z) < clear || !isFloorFree(run.house, x, z, size)) continue;
      if (!run.debris.spawn(index, x, z, this.rng, { size })) return false;
      this.giants++;
      return true;
    }
    return false;
  }
}

export const theSunDef = hazardRegistry.register({
  id: 'the_sun',
  name: 'The Sun',
  boss: true,
  // Full-size contact radius (hits never shrink it).
  footprint: { radius: THE_SUN.contactRadius, height: THE_SUN.height },
  mass: THE_SUN.mass,
  modelId: THE_SUN.modelId,
  create(_run, x, z, id, rng: Rng) {
    return new TheSun(id, this, x, z, rng, THE_SUN);
  },
});
