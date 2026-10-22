/**
 * Spray Bottle: a stationary turret. When the Bunny is in range it turns to aim, telegraphs
 * with a red aim lane on the floor, then fires a burst of mist droplets that travel and
 * deal 1 damage each. Droplets stop at walls and tall furniture.
 *
 * The Sprinkler (outdoors) reuses it with SPRINKLER tuning: only its `head` node turns, it
 * sweeps idly while the Bunny is out of range, and a water hit also soaks the Bunny (a brief
 * `hazard:wet` slow, like the Mop's trail). The Pressure Washer (city, PRESSURE_WASHER) works the
 * same way with fast, wide water jets.
 */
import { Mesh, MeshStandardMaterial, SphereGeometry, type Object3D } from 'three';
import type { Rng } from '../core/rng';
import { PRESSURE_WASHER, SPRAY_BOTTLE, SPRINKLER, tierValue, type TurretTuning } from '../data/hazards';
import { TIMED_PRIORITY } from '../entities/stats';
import type { Run } from '../game/run';
import { onScreen } from '../systems/camera';
import { BaseHazard } from './base';
import { bunnySheltered, canTarget, hazardFloorFree, hitBunny, pushBunnyOut, turnTowards, wrapAngle, yawOf } from './common';
import { DECAL_COLORS, laneDecal } from './decals';
import { hazardRegistry, tuningFootprint, type HazardDef } from './index';
import { WET_SOURCE } from './mop';

const dropletGeometry = new SphereGeometry(1, 10, 8);
const dropletMaterial = new MeshStandardMaterial({ color: '#9fe3ff', emissive: '#3aa8ff', emissiveIntensity: 0.6, roughness: 0.1, transparent: true, opacity: 0.85 });

interface Droplet {
  x: number;
  z: number;
  vx: number;
  vz: number;
  traveled: number;
  max: number;
  mesh: Mesh;
}

type SprayState = 'idle' | 'telegraph' | 'firing' | 'cooldown';

export class SprayBottle extends BaseHazard {
  state: SprayState = 'idle';
  private timer = 0;
  private shotsLeft = 0;
  readonly droplets: Droplet[] = [];
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
    this.aimDecal = this.addDecal(laneDecal(1, cfg.dropletRadius * 4, DECAL_COLORS.danger, 0.5));
    this.aimDecal.visible = false;
  }

  protected tick(dt: number, run: Run): void {
    const c = this.cfg;
    const b = run.bunny;
    const dx = b.x - this.x;
    const dz = b.z - this.z;
    const dist = Math.hypot(dx, dz);
    const range = tierValue(c.range, run.tier);
    // Only shoot from on screen, so the player can always see the turret and its aim lane.
    const inRange = canTarget(run) && dist < range + b.radius && !bunnySheltered(run, c.nozzleHeight) && onScreen(run, this.x, this.z);
    this.timer -= dt;

    if (this.state === 'telegraph' && !canTarget(run)) {
      // Lost sight of the Bunny (Dust Cloud): cancel the shot.
      this.state = 'idle';
      this.aimDecal.visible = false;
    }
    const sweeping = c.idleSpin > 0 && !inRange;
    if (this.state === 'idle' && sweeping) this.yaw = wrapAngle(this.yaw + c.idleSpin * dt);
    else if (canTarget(run) && (this.state === 'idle' || this.state === 'telegraph')) this.yaw = turnTowards(this.yaw, yawOf(dx, dz), c.turnRate * dt);
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
    const mesh = new Mesh(dropletGeometry, dropletMaterial);
    mesh.scale.setScalar(c.dropletRadius);
    this.object3d.add(mesh);
    const nx = Math.sin(a);
    const nz = Math.cos(a);
    this.droplets.push({ x: this.x + nx * this.size, z: this.z + nz * this.size, vx: nx * speed, vz: nz * speed, traveled: 0, max: range, mesh });
  }

  private updateDroplets(dt: number, run: Run): void {
    const c = this.cfg;
    const b = run.bunny;
    for (let i = this.droplets.length - 1; i >= 0; i--) {
      const d = this.droplets[i]!;
      d.x += d.vx * dt;
      d.z += d.vz * dt;
      d.traveled += Math.hypot(d.vx, d.vz) * dt;
      let gone = d.traveled >= d.max || !hazardFloorFree(run.house, d.x, d.z, c.dropletRadius, c.nozzleHeight);
      if (!gone && Math.hypot(b.x - d.x, b.z - d.z) < b.radius + c.dropletRadius && !bunnySheltered(run, c.nozzleHeight)) {
        const hit = hitBunny(run, d.x, d.z, { damage: c.damage, source: this.def.id, knockbackCm: c.knockbackCm, knockbackRadii: c.knockbackRadii, dirX: d.vx, dirZ: d.vz });
        if (hit && c.wetSeconds > 0 && b.alive) {
          b.stats.removeSource(WET_SOURCE);
          b.stats.add({ stat: 'speed', op: 'mul', value: c.wetMultiplier, source: WET_SOURCE, priority: TIMED_PRIORITY, duration: c.wetSeconds });
        }
        gone = true;
      }
      if (gone) {
        d.mesh.removeFromParent();
        this.droplets.splice(i, 1);
        continue;
      }
      // Droplets arc down from the nozzle towards the Bunny's height.
      const k = Math.min(1, d.traveled / d.max);
      const y = c.nozzleHeight * (1 - k) + Math.min(b.radius, c.nozzleHeight) * k;
      d.mesh.position.set(d.x, Math.max(c.dropletRadius, y), d.z);
    }
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
    for (const d of this.droplets) d.mesh.removeFromParent();
    this.droplets.length = 0;
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
