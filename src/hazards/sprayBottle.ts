/**
 * Spray Bottle: a stationary turret. When the Bunny is in range it turns to aim, telegraphs
 * with a red aim lane on the floor, then fires a burst of mist droplets that travel and
 * deal 1 damage each. Droplets stop at walls and tall furniture.
 */
import { Mesh, MeshStandardMaterial, SphereGeometry } from 'three';
import type { Rng } from '../core/rng';
import { SPRAY_BOTTLE, tierValue } from '../data/hazards';
import type { Run } from '../game/run';
import { BaseHazard } from './base';
import { bunnySheltered, canTarget, hazardFloorFree, hitBunny, pushBunnyOut, turnTowards, wrapAngle, yawOf } from './common';
import { DECAL_COLORS, laneDecal } from './decals';
import { hazardRegistry, type HazardDef } from './index';

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

  constructor(
    id: number,
    def: HazardDef,
    x: number,
    z: number,
    private readonly rng: Rng,
  ) {
    super(id, def, x, z, SPRAY_BOTTLE.size, 'spray_bottle');
    this.yaw = rng.range(-Math.PI, Math.PI);
    this.aimDecal = this.addDecal(laneDecal(1, SPRAY_BOTTLE.dropletRadius * 4, DECAL_COLORS.danger, 0.5));
    this.aimDecal.visible = false;
  }

  protected tick(dt: number, run: Run): void {
    const c = SPRAY_BOTTLE;
    const b = run.bunny;
    const dx = b.x - this.x;
    const dz = b.z - this.z;
    const dist = Math.hypot(dx, dz);
    const range = tierValue(c.range, run.tier);
    const inRange = canTarget(run) && dist < range + b.radius && !bunnySheltered(run, c.nozzleHeight);
    this.timer -= dt;

    if (this.state === 'telegraph' && !canTarget(run)) {
      // Lost sight of the Bunny (Dust Cloud): cancel the shot.
      this.state = 'idle';
      this.aimDecal.visible = false;
    }
    if (canTarget(run) && (this.state === 'idle' || this.state === 'telegraph')) this.yaw = turnTowards(this.yaw, yawOf(dx, dz), c.turnRate * dt);
    if (this.state === 'idle' && inRange && Math.abs(wrapAngle(yawOf(dx, dz) - this.yaw)) < 0.25) {
      this.state = 'telegraph';
      this.timer = tierValue(c.telegraph, run.tier);
      this.emitTelegraph(run, 'spray', this.timer);
    }
    if (this.state === 'telegraph') {
      const total = tierValue(c.telegraph, run.tier);
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
          this.timer = tierValue(c.cooldown, run.tier);
          this.aimDecal.visible = false;
        }
      }
    } else if (this.state === 'cooldown' && this.timer <= 0) {
      this.state = 'idle';
    }
    this.updateDroplets(dt, run);
  }

  private fire(run: Run, range: number): void {
    const c = SPRAY_BOTTLE;
    const a = this.yaw + this.rng.range(-c.spread, c.spread);
    const speed = tierValue(c.dropletSpeed, run.tier);
    const mesh = new Mesh(dropletGeometry, dropletMaterial);
    mesh.scale.setScalar(c.dropletRadius);
    this.object3d.add(mesh);
    const nx = Math.sin(a);
    const nz = Math.cos(a);
    this.droplets.push({ x: this.x + nx * this.size, z: this.z + nz * this.size, vx: nx * speed, vz: nz * speed, traveled: 0, max: range, mesh });
  }

  private updateDroplets(dt: number, run: Run): void {
    const c = SPRAY_BOTTLE;
    const b = run.bunny;
    for (let i = this.droplets.length - 1; i >= 0; i--) {
      const d = this.droplets[i]!;
      d.x += d.vx * dt;
      d.z += d.vz * dt;
      d.traveled += Math.hypot(d.vx, d.vz) * dt;
      let gone = d.traveled >= d.max || !hazardFloorFree(run.house, d.x, d.z, c.dropletRadius, c.nozzleHeight);
      if (!gone && Math.hypot(b.x - d.x, b.z - d.z) < b.radius + c.dropletRadius && !bunnySheltered(run, c.nozzleHeight)) {
        hitBunny(run, d.x, d.z, { damage: c.damage, source: this.def.id, knockbackCm: c.knockbackCm, knockbackRadii: c.knockbackRadii, dirX: d.vx, dirZ: d.vz });
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
  minTier: 2,
  spawnWeight: 1,
  mass: SPRAY_BOTTLE.mass,
  modelId: 'spray_bottle',
  create(_run, x, z, id, rng) {
    return new SprayBottle(id, this, x, z, rng);
  },
});
