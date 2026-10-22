/**
 * Mop: patrols a loop of waypoints in its room and leaves a wet trail of puddles that fade
 * out. Standing in the trail slows the Bunny. Contact: 1 damage + knockback.
 *
 * The Street Flusher (city water truck) reuses it with STREET_FLUSHER tuning: a bigger, faster
 * patrol kept near its spawn point (`patrolRange`) and a wide trail. The River Barge (region,
 * RIVER_BARGE) is placed in `river` zones when the map has one (its def's `spawnZones`), so it
 * patrols the river and leaves a slowing wake. The River Surge (continent, RIVER_SURGE) is a fast
 * flood surge across the plains with a wide muddy trail. The Re-entry Burn (globe, REENTRY_BURN)
 * roams across zones (`roam`) and its fire trail burns instead of slowing (`burn`: the Bunny sheds
 * mass every `interval` s on it). The Sungrazer (solar system, SUNGRAZER) roams the same way and its
 * icy tail trail slows. The Supernova Remnant (galaxy, SUPERNOVA_REMNANT) roams slowly, its `shell`
 * breathing (`pulseNode`), and leaves a trail of glowing filament rings (`trailRing`) that slows.
 * The Cosmic Void (universe, COSMIC_VOID) roams the same way and leaves a near-black trail that
 * swallows the floor's glow (`trailOpacity`) and slows.
 *
 * On a map that wraps east–west the spawn zone's rect is moved to the Mop's lap (rooms are stored
 * once, in the canonical strip), so the waypoints stay around it.
 */
import { CircleGeometry, InstancedMesh, MeshBasicMaterial, Object3D, RingGeometry } from 'three';
import type { Rng } from '../core/rng';
import { COSMIC_VOID, HAZARD_RECOIL, SUNGRAZER, SUPERNOVA_REMNANT, MOP, REENTRY_BURN, RIVER_BARGE, RIVER_SURGE, STREET_FLUSHER, type MopTuning } from '../data/hazards';
import { TIMED_PRIORITY } from '../entities/stats';
import type { Run } from '../game/run';
import { roomAt } from '../world/house';
import { canonicalX } from '../world/wrap';
import { BaseHazard } from './base';
import { bunnySheltered, hazardFloorFree, hitBunny, moveCircle, separateFromBunny, turnTowards, yawOf } from './common';
import { DECAL_COLORS } from './decals';
import { hazardRegistry, tuningFootprint, type HazardDef } from './index';
import { shedMass } from './shed';

export const WET_SOURCE = 'hazard:wet';

interface Puddle {
  x: number;
  z: number;
  age: number;
}

/** Puddle radius multiplier for its age: 1 until the fade window, then shrinking to 0. */
export function puddleScale(age: number, life: number, fade: number): number {
  if (age >= life) return 0;
  const fadeStart = life * (1 - fade);
  return age <= fadeStart ? 1 : 1 - (age - fadeStart) / (life - fadeStart);
}

const _dummy = new Object3D();

export class Mop extends BaseHazard {
  private readonly waypoints: Array<{ x: number; z: number }> = [];
  private wp = 0;
  private sinceDrop = 0;
  private stuckTime = 0;
  readonly puddles: Puddle[] = [];
  private readonly trail: InstancedMesh;
  /** A faint ring round each drop (`trailRim`: the Cosmic Void's dark trail on dark space). */
  private readonly rim: InstancedMesh | null = null;
  private readonly maxPuddles: number;
  /** Burning trail (`cfg.burn`): seconds until it can burn the Bunny again, and burns so far. */
  private burnTimer = 0;
  burns = 0;

  constructor(
    id: number,
    def: HazardDef,
    run: Run,
    x: number,
    z: number,
    private readonly rng: Rng,
    readonly cfg: MopTuning = MOP,
  ) {
    super(id, def, x, z, cfg.size, cfg.modelId);
    this.recoilHeight = cfg.height;
    this.model.scale.setScalar(cfg.size / cfg.modelSize);
    // Absolute margins are real cm (4 cm inset, 60 cm fallback leg, 60 cm/s puddle budget).
    const cm = 1 / run.unit;
    const room = roomAt(run.house, x, z);
    if (room) {
      // Rooms are stored once on a map that wraps east–west: move the rect to the Mop's lap.
      const lap = x - canonicalX(run.house, x);
      const r = cfg.roam ? run.house.bounds : room.rect;
      const inset = cfg.size + 4 * cm;
      const reach = cfg.patrolRange;
      const wraps = cfg.roam && run.house.wrapX;
      const minX = wraps ? x - reach : Math.max(r.minX + lap + inset, x - reach);
      const maxX = wraps ? x + reach : Math.min(r.maxX + lap - inset, x + reach);
      const minZ = Math.max(r.minZ + inset, z - reach);
      const maxZ = Math.min(r.maxZ - inset, z + reach);
      for (let tries = 0; this.waypoints.length < cfg.waypoints && tries < 60; tries++) {
        const px = rng.range(minX, maxX);
        const pz = rng.range(minZ, maxZ);
        if (hazardFloorFree(run.house, px, pz, cfg.size, cfg.height)) this.waypoints.push({ x: px, z: pz });
      }
    }
    if (this.waypoints.length < 2) {
      const d = Math.max(60 * cm, cfg.size * 3);
      this.waypoints.push({ x: x + d, z }, { x: x - d, z });
    }

    // Enough puddles to cover the trail at the fastest patrol speed (the house Mop keeps 60 cm/s).
    const fastest = Math.max(60 * cm, Math.max(...cfg.speed) * 1.2) * run.difficulty.hazardSpeed;
    this.maxPuddles = Math.ceil((cfg.trailLife * fastest) / cfg.trailSpacing) + 4;
    // Discs (wet puddles), or rings for a filament trail (`trailRing`, the Supernova Remnant).
    const geom = cfg.trailRing ? new RingGeometry(0.62, 1, 20) : new CircleGeometry(1, 20);
    geom.rotateX(-Math.PI / 2);
    const material = new MeshBasicMaterial({ color: cfg.trailColor ?? DECAL_COLORS.wet, transparent: true, opacity: cfg.trailOpacity ?? (cfg.burn || cfg.trailRing ? 0.5 : 0.35), depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    this.trail = new InstancedMesh(geom, material, this.maxPuddles);
    this.trail.count = 0;
    this.trail.frustumCulled = false;
    this.trail.renderOrder = 1;
    this.object3d.add(this.trail);
    if (cfg.trailRim) {
      const rimGeom = new RingGeometry(0.9, 1, 24);
      rimGeom.rotateX(-Math.PI / 2);
      const rimMat = new MeshBasicMaterial({ color: cfg.trailRim, transparent: true, opacity: 0.45, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      this.rim = new InstancedMesh(rimGeom, rimMat, this.maxPuddles);
      this.rim.count = 0;
      this.rim.frustumCulled = false;
      this.rim.renderOrder = 1;
      this.object3d.add(this.rim);
    }
  }

  protected tick(dt: number, run: Run): void {
    const c = this.cfg;
    const target = this.waypoints[this.wp]!;
    const dx = target.x - this.x;
    const dz = target.z - this.z;
    const dist = Math.hypot(dx, dz);
    const speed = this.tierSpeed(run, c.speed);
    this.yaw = turnTowards(this.yaw, yawOf(dx, dz), 3 * dt);
    const step = Math.min(dist, speed * dt);
    const m = moveCircle(run.house, this.x, this.z, this.size, c.height, Math.sin(this.yaw) * step, Math.cos(this.yaw) * step);
    const moved = Math.hypot(m.x - this.x, m.z - this.z);
    this.x = m.x;
    this.z = m.z;
    this.stuckTime = moved < step * 0.3 ? this.stuckTime + dt : 0;
    if (dist < this.size * 0.5 || this.stuckTime > 1.5) {
      this.wp = (this.wp + 1) % this.waypoints.length;
      this.stuckTime = 0;
    }

    // Wet trail.
    this.sinceDrop += moved;
    if (this.sinceDrop >= c.trailSpacing) {
      this.sinceDrop = 0;
      if (this.puddles.length >= this.maxPuddles) this.puddles.shift();
      this.puddles.push({ x: this.x, z: this.z, age: 0 });
    }
    const b = run.bunny;
    let wet = false;
    for (let i = this.puddles.length - 1; i >= 0; i--) {
      const p = this.puddles[i]!;
      p.age += dt;
      const s = puddleScale(p.age, c.trailLife, c.trailFade);
      if (s <= 0) {
        this.puddles.splice(i, 1);
        continue;
      }
      if (!wet && Math.hypot(b.x - p.x, b.z - p.z) < c.size * c.trailRadius * s + b.radius * 0.3) wet = true;
    }
    if (wet && c.slowMultiplier < 1) {
      b.stats.removeSource(WET_SOURCE);
      b.stats.add({ stat: 'speed', op: 'mul', value: c.slowMultiplier, source: WET_SOURCE, priority: TIMED_PRIORITY, duration: 0.25 });
    }
    if (c.burn) this.burn(dt, run, c.burn, wet);
    if (c.pulseNode) this.model.getObjectByName(c.pulseNode)?.scale.setScalar(1 + (c.pulseAmount ?? 0.1) * Math.sin(this.time * 2.6));
    this.syncTrail();
  }

  /**
   * A burning trail: every `interval` s on it the Bunny sheds `shedFraction` of its volume (the
   * first time it steps on, then while it stays). Not during i-frames, a hunker or a Dust Cloud.
   */
  private burn(dt: number, run: Run, burn: { shedFraction: number; interval: number }, onTrail: boolean): void {
    this.burnTimer = Math.max(0, this.burnTimer - dt);
    const b = run.bunny;
    if (!onTrail || this.burnTimer > 0 || !b.alive || b.invulnerable > 0 || b.hiddenFromHazards) return;
    this.burnTimer = burn.interval;
    if (shedMass(run, this.rng, burn.shedFraction, this.def.id).volume > 0) this.burns++;
  }

  private syncTrail(): void {
    const c = this.cfg;
    const n = this.puddles.length;
    for (let i = 0; i < n; i++) {
      const p = this.puddles[i]!;
      const s = c.size * c.trailRadius * puddleScale(p.age, c.trailLife, c.trailFade);
      _dummy.position.set(p.x, 0.2, p.z);
      _dummy.scale.set(s, 1, s);
      _dummy.updateMatrix();
      this.trail.setMatrixAt(i, _dummy.matrix);
      this.rim?.setMatrixAt(i, _dummy.matrix);
    }
    this.trail.count = n;
    this.trail.instanceMatrix.needsUpdate = true;
    if (this.rim) {
      this.rim.count = n;
      this.rim.instanceMatrix.needsUpdate = true;
    }
  }

  onContact(run: Run): void {
    const c = this.cfg;
    if (bunnySheltered(run, c.height)) return;
    if (!this.stunned && this.recoilFor <= 0 && hitBunny(run, this.x, this.z, { damage: c.damage, source: this.def.id, knockbackCm: c.knockbackCm, knockbackRadii: c.knockbackRadii })) this.recoilFor = HAZARD_RECOIL;
    separateFromBunny(run, this, this.size, c.height);
  }

  override dispose(): void {
    this.trail.geometry.dispose();
    (this.trail.material as MeshBasicMaterial).dispose();
    this.trail.dispose();
    if (this.rim) {
      this.rim.geometry.dispose();
      (this.rim.material as MeshBasicMaterial).dispose();
      this.rim.dispose();
    }
    super.dispose();
  }
}

export const mopDef = hazardRegistry.register({
  id: 'mop',
  name: 'Mop',
  footprint: tuningFootprint(MOP),
  mass: MOP.mass,
  modelId: 'mop',
  create(run, x, z, id, rng) {
    return new Mop(id, this, run, x, z, rng, MOP);
  },
});

export const streetFlusherDef = hazardRegistry.register({
  id: 'street_flusher',
  name: 'Street Flusher',
  footprint: tuningFootprint(STREET_FLUSHER),
  mass: STREET_FLUSHER.mass,
  modelId: STREET_FLUSHER.modelId,
  create(run, x, z, id, rng) {
    return new Mop(id, this, run, x, z, rng, STREET_FLUSHER);
  },
});

export const riverBargeDef = hazardRegistry.register({
  id: 'river_barge',
  name: 'River Barge',
  footprint: tuningFootprint(RIVER_BARGE),
  spawnZones: ['river'],
  mass: RIVER_BARGE.mass,
  modelId: RIVER_BARGE.modelId,
  create(run, x, z, id, rng) {
    return new Mop(id, this, run, x, z, rng, RIVER_BARGE);
  },
});

/** Continent trail-layer: a flood surge leaving a muddy trail (RIVER_SURGE). */
export const riverSurgeDef = hazardRegistry.register({
  id: 'river_surge',
  name: 'River Surge',
  footprint: tuningFootprint(RIVER_SURGE),
  spawnZones: ['rivers'],
  mass: RIVER_SURGE.mass,
  modelId: RIVER_SURGE.modelId,
  create(run, x, z, id, rng) {
    return new Mop(id, this, run, x, z, rng, RIVER_SURGE);
  },
});

/** Globe trail-layer: a capsule streaking across the map, leaving a fire trail that burns (REENTRY_BURN). */
export const reentryBurnDef = hazardRegistry.register({
  id: 'reentry_burn',
  name: 'Re-entry Burn',
  footprint: tuningFootprint(REENTRY_BURN),
  mass: REENTRY_BURN.mass,
  modelId: REENTRY_BURN.modelId,
  create(run, x, z, id, rng) {
    return new Mop(id, this, run, x, z, rng, REENTRY_BURN);
  },
});

/** Solar System trail-layer: a sungrazing comet leaving an ice tail that slows (SUNGRAZER). */
export const sungrazerDef = hazardRegistry.register({
  id: 'sungrazer',
  name: 'Sungrazer',
  footprint: tuningFootprint(SUNGRAZER),
  mass: SUNGRAZER.mass,
  modelId: SUNGRAZER.modelId,
  create(run, x, z, id, rng) {
    return new Mop(id, this, run, x, z, rng, SUNGRAZER);
  },
});

/** Galaxy trail-layer: a supernova remnant whose gas trail slows (SUPERNOVA_REMNANT). */
export const supernovaRemnantDef = hazardRegistry.register({
  id: 'supernova_remnant',
  name: 'Supernova Remnant',
  footprint: tuningFootprint(SUPERNOVA_REMNANT),
  mass: SUPERNOVA_REMNANT.mass,
  modelId: SUPERNOVA_REMNANT.modelId,
  create(run, x, z, id, rng) {
    return new Mop(id, this, run, x, z, rng, SUPERNOVA_REMNANT);
  },
});

/** Universe trail-layer: a cosmic void drifting across zones; its trail slows (COSMIC_VOID). */
export const cosmicVoidDef = hazardRegistry.register({
  id: 'cosmic_void',
  name: 'Cosmic Void',
  footprint: tuningFootprint(COSMIC_VOID),
  mass: COSMIC_VOID.mass,
  modelId: COSMIC_VOID.modelId,
  create(run, x, z, id, rng) {
    return new Mop(id, this, run, x, z, rng, COSMIC_VOID);
  },
});
