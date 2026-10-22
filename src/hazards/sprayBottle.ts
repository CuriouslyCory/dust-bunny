/**
 * Spray Bottle: a stationary turret. When the Bunny is in range it turns to aim, telegraphs
 * with a red aim lane on the floor, then fires a burst of mist droplets that travel and
 * deal 1 damage each. Droplets stop at walls and tall furniture.
 *
 * The Sprinkler (outdoors) reuses it with SPRINKLER tuning: only its `head` node turns, it
 * sweeps idly while the Bunny is out of range, and a water hit also soaks the Bunny (a brief
 * `hazard:wet` slow, like the Mop's trail). The Pressure Washer (city, PRESSURE_WASHER) works the
 * same way with fast, wide water jets, and the Crop Duster (region, CROP_DUSTER) turns its whole
 * body, spins its `propeller` and dusts a burst of pesticide that soaks the same way. The Volcano
 * (continent, VOLCANO) never moves: only its `crater` node turns to aim, the lane is the floor
 * telegraph, and it lobs a burst of lava bombs (`dropletArc`) whose ash slows like the soak. The
 * Anti-Satellite Laser (globe, ASAT_LASER) turns only its `head`, scans while the Bunny is out of
 * range, and fires fast, narrow red bolts that do not soak; it is placed on landmasses. The Sunspot
 * (solar system, SUNSPOT) sweeps its flux-tube `head` like a pulsar beam, then fires a pulsed burst
 * of orange flare bolts; it is placed sunward of the Kuiper belt (SUNSPOT_ZONES). The Galaxy's
 * turret, the Pulsar, sweeps real beams instead of firing droplets (pulsar.ts).
 *
 * Turrets are ranged Hazards: they aim at Lint's Decoy while it is in range (and are never
 * clogged by it), and a droplet that reaches the Decoy pops it.
 */
import type { Object3D } from 'three';
import type { Rng } from '../core/rng';
import { ASAT_LASER, SUNSPOT, CROP_DUSTER, PRESSURE_WASHER, SPRAY_BOTTLE, SPRINKLER, tierValue, VOLCANO, type TurretTuning } from '../data/hazards';
import { TIMED_PRIORITY } from '../entities/stats';
import type { Run } from '../game/run';
import { onScreen } from '../systems/camera';
import type { RoomType } from '../world/types';
import { BaseHazard } from './base';
import { aimTarget, bunnySheltered, hitBunny, pushBunnyOut, turnTowards, wrapAngle, yawOf } from './common';
import { DECAL_COLORS, laneDecal } from './decals';
import { hazardRegistry, tuningFootprint, type HazardDef } from './index';
import { WET_SOURCE } from './mop';
import { projectileMaterial, Volley, type Projectile } from './projectiles';

type SprayState = 'idle' | 'telegraph' | 'firing' | 'cooldown';

export class SprayBottle extends BaseHazard {
  readonly ranged = true;
  state: SprayState = 'idle';
  private timer = 0;
  private shotsLeft = 0;
  private readonly volley: Volley;
  private readonly aimDecal;
  /** Body facing when only `cfg.aimNode` turns. */
  private readonly baseYaw: number;
  private readonly aimNode: Object3D | null;

  constructor(
    id: number,
    def: HazardDef,
    x: number,
    z: number,
    private readonly rng: Rng,
    readonly cfg: TurretTuning = SPRAY_BOTTLE,
  ) {
    super(id, def, x, z, cfg.size, cfg.modelId);
    this.model.scale.setScalar(cfg.size / cfg.modelSize);
    this.yaw = rng.range(-Math.PI, Math.PI);
    this.baseYaw = this.yaw;
    this.aimNode = cfg.aimNode ? (this.model.getObjectByName(cfg.aimNode) ?? null) : null;
    this.volley = new Volley(this.object3d, cfg.dropletColor ? projectileMaterial(cfg.dropletColor, cfg.dropletColor, 0.8) : projectileMaterial());
    this.aimDecal = this.addDecal(laneDecal(1, cfg.dropletRadius * 4, DECAL_COLORS.danger, 0.5));
    this.aimDecal.visible = false;
  }

  /** Droplets in flight. */
  get droplets(): readonly Projectile[] {
    return this.volley.items;
  }

  protected tick(dt: number, run: Run): void {
    const c = this.cfg;
    if (c.spinNode) this.spin(c.spinNode, dt * (c.spinRate ?? 0), 'z');
    const range = tierValue(c.range, run.tier);
    // The Bunny, or the Decoy while it is in range.
    const t = aimTarget(run, this.x, this.z, range);
    const dx = (t?.x ?? this.x) - this.x;
    const dz = (t?.z ?? this.z) - this.z;
    const dist = Math.hypot(dx, dz);
    // Only shoot from on screen, so the player can always see the turret and its aim lane.
    const inRange = !!t && dist < range + t.radius && (t.lure || !bunnySheltered(run, c.nozzleHeight)) && onScreen(run, this.x, this.z);
    this.timer -= dt;

    if (this.state === 'telegraph' && !t) {
      // Lost sight of the Bunny (Dust Cloud): cancel the shot.
      this.state = 'idle';
      this.aimDecal.visible = false;
    }
    const sweeping = c.idleSpin > 0 && !inRange;
    if (this.state === 'idle' && sweeping) this.yaw = wrapAngle(this.yaw + c.idleSpin * dt);
    else if (t && (this.state === 'idle' || this.state === 'telegraph')) this.yaw = turnTowards(this.yaw, yawOf(dx, dz), c.turnRate * dt);
    if (this.state === 'idle' && inRange && Math.abs(wrapAngle(yawOf(dx, dz) - this.yaw)) < 0.25) {
      this.state = 'telegraph';
      this.timer = this.attackTime(run, tierValue(c.telegraph, run.tier));
      this.emitTelegraph(run, 'spray', this.timer);
    }
    if (this.state === 'telegraph') {
      const total = this.attackTime(run, tierValue(c.telegraph, run.tier));
      this.aimDecal.visible = true;
      this.aimDecal.place(this.x, this.z, this.yaw);
      this.aimDecal.root.scale.set(1, 1, range);
      this.aimDecal.pulse(this.time, 1 - this.timer / total);
      if (this.timer <= 0) {
        this.state = 'firing';
        this.shotsLeft = c.burst;
        this.timer = 0;
      }
    } else if (this.state === 'firing') {
      if (this.timer <= 0) {
        this.fire(run, range);
        this.shotsLeft--;
        this.timer = c.burstGap;
        if (this.shotsLeft <= 0) {
          this.state = 'cooldown';
          this.timer = this.attackTime(run, tierValue(c.cooldown, run.tier));
          this.aimDecal.visible = false;
        }
      }
    } else if (this.state === 'cooldown' && this.timer <= 0) {
      this.state = 'idle';
    }
    this.updateDroplets(dt, run);
  }

  private fire(run: Run, range: number): void {
    const c = this.cfg;
    const a = this.yaw + this.rng.range(-c.spread, c.spread);
    const speed = this.speed(run, tierValue(c.dropletSpeed, run.tier));
    this.volley.fire(this.x + Math.sin(a) * this.size, this.z + Math.cos(a) * this.size, a, speed, range, c.dropletRadius);
  }

  private updateDroplets(dt: number, run: Run): void {
    const c = this.cfg;
    const b = run.bunny;
    this.volley.update(dt, run, this, { radius: c.dropletRadius, height: c.nozzleHeight, blockHeight: c.nozzleHeight, arc: c.dropletArc }, (d) => {
      const hit = hitBunny(run, d.x, d.z, { damage: c.damage, source: this.def.id, knockbackCm: c.knockbackCm, knockbackRadii: c.knockbackRadii, dirX: d.vx, dirZ: d.vz });
      if (hit && c.wetSeconds > 0 && b.alive) {
        b.stats.removeSource(WET_SOURCE);
        b.stats.add({ stat: 'speed', op: 'mul', value: c.wetMultiplier, source: WET_SOURCE, priority: TIMED_PRIORITY, duration: c.wetSeconds });
      }
    });
  }

  protected override sync(run: Run): void {
    super.sync(run);
    if (!this.cfg.aimNode) return;
    // The base stays put; only the head turns to aim.
    this.body.rotation.y = this.baseYaw;
    if (this.aimNode) this.aimNode.rotation.y = wrapAngle(this.yaw - this.baseYaw);
  }

  onContact(run: Run): void {
    pushBunnyOut(run, this.x, this.z, this.size);
  }

  override dispose(): void {
    this.volley.clear();
    super.dispose();
  }
}

export const sprayBottleDef = hazardRegistry.register({
  id: 'spray_bottle',
  name: 'Spray Bottle',
  footprint: tuningFootprint(SPRAY_BOTTLE),
  mass: SPRAY_BOTTLE.mass,
  modelId: 'spray_bottle',
  create(_run, x, z, id, rng) {
    return new SprayBottle(id, this, x, z, rng, SPRAY_BOTTLE);
  },
});

export const sprinklerDef = hazardRegistry.register({
  id: 'sprinkler',
  name: 'Sprinkler',
  footprint: tuningFootprint(SPRINKLER),
  mass: SPRINKLER.mass,
  modelId: SPRINKLER.modelId,
  create(_run, x, z, id, rng) {
    return new SprayBottle(id, this, x, z, rng, SPRINKLER);
  },
});

export const pressureWasherDef = hazardRegistry.register({
  id: 'pressure_washer',
  name: 'Pressure Washer',
  footprint: tuningFootprint(PRESSURE_WASHER),
  mass: PRESSURE_WASHER.mass,
  modelId: PRESSURE_WASHER.modelId,
  create(_run, x, z, id, rng) {
    return new SprayBottle(id, this, x, z, rng, PRESSURE_WASHER);
  },
});

export const cropDusterDef = hazardRegistry.register({
  id: 'crop_duster',
  name: 'Crop Duster',
  footprint: tuningFootprint(CROP_DUSTER),
  mass: CROP_DUSTER.mass,
  modelId: CROP_DUSTER.modelId,
  create(_run, x, z, id, rng) {
    return new SprayBottle(id, this, x, z, rng, CROP_DUSTER);
  },
});

/** Continent turret: lava bombs from the crater vent (VOLCANO). */
export const volcanoDef = hazardRegistry.register({
  id: 'volcano',
  name: 'Volcano',
  footprint: tuningFootprint(VOLCANO),
  mass: VOLCANO.mass,
  modelId: VOLCANO.modelId,
  create(_run, x, z, id, rng) {
    return new SprayBottle(id, this, x, z, rng, VOLCANO);
  },
});

/** Globe turret: laser bolts from the turret `head`, emplaced on landmasses when the map has them (ASAT_LASER). */
export const asatLaserDef = hazardRegistry.register({
  id: 'asat_laser',
  name: 'Anti-Satellite Laser',
  footprint: tuningFootprint(ASAT_LASER),
  spawnZones: ['landmasses'],
  mass: ASAT_LASER.mass,
  modelId: ASAT_LASER.modelId,
  create(_run, x, z, id, rng) {
    return new SprayBottle(id, this, x, z, rng, ASAT_LASER);
  },
});

/** Zones a Sunspot is placed in when the layout has any: sunward of the Kuiper belt. */
export const SUNSPOT_ZONES: readonly RoomType[] = ['corona', 'inner_orbits', 'asteroid_belt', 'outer_orbits'];

/** Solar System turret: a sunspot firing pulsar-like flares (SUNSPOT). */
export const sunspotDef = hazardRegistry.register({
  id: 'sunspot',
  name: 'Sunspot',
  footprint: tuningFootprint(SUNSPOT),
  spawnZones: SUNSPOT_ZONES,
  mass: SUNSPOT.mass,
  modelId: SUNSPOT.modelId,
  create(_run, x, z, id, rng) {
    return new SprayBottle(id, this, x, z, rng, SUNSPOT);
  },
});
