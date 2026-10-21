/**
 * Mop: patrols a loop of waypoints in its room and leaves a wet trail of puddles that fade
 * out. Standing in the trail slows the Bunny. Contact: 1 damage + knockback.
 */
import { CircleGeometry, InstancedMesh, MeshBasicMaterial, Object3D } from 'three';
import type { Rng } from '../core/rng';
import { HAZARD_RECOIL, MOP } from '../data/hazards';
import type { Run } from '../game/run';
import { roomAt } from '../world/house';
import { BaseHazard } from './base';
import { bunnySheltered, hazardFloorFree, hitBunny, moveCircle, pushBunnyOut, turnTowards, yawOf } from './common';
import { DECAL_COLORS } from './decals';
import { hazardRegistry, type HazardDef } from './index';

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
  private readonly maxPuddles: number;

  constructor(
    id: number,
    def: HazardDef,
    run: Run,
    x: number,
    z: number,
    rng: Rng,
  ) {
    super(id, def, x, z, MOP.size, 'mop');
    this.recoilHeight = MOP.height;
    const room = roomAt(run.house, x, z);
    if (room) {
      const r = room.rect;
      const inset = MOP.size + 4;
      for (let tries = 0; this.waypoints.length < MOP.waypoints && tries < 60; tries++) {
        const px = rng.range(r.minX + inset, r.maxX - inset);
        const pz = rng.range(r.minZ + inset, r.maxZ - inset);
        if (hazardFloorFree(run.house, px, pz, MOP.size, MOP.height)) this.waypoints.push({ x: px, z: pz });
      }
    }
    if (this.waypoints.length < 2) this.waypoints.push({ x: x + 60, z }, { x: x - 60, z });

    this.maxPuddles = Math.ceil((MOP.trailLife * 60) / MOP.trailSpacing) + 4;
    const geom = new CircleGeometry(1, 20);
    geom.rotateX(-Math.PI / 2);
    const material = new MeshBasicMaterial({ color: DECAL_COLORS.wet, transparent: true, opacity: 0.35, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    this.trail = new InstancedMesh(geom, material, this.maxPuddles);
    this.trail.count = 0;
    this.trail.frustumCulled = false;
    this.trail.renderOrder = 1;
    this.object3d.add(this.trail);
  }

  protected tick(dt: number, run: Run): void {
    const target = this.waypoints[this.wp]!;
    const dx = target.x - this.x;
    const dz = target.z - this.z;
    const dist = Math.hypot(dx, dz);
    const speed = this.tierSpeed(run, MOP.speed);
    this.yaw = turnTowards(this.yaw, yawOf(dx, dz), 3 * dt);
    const step = Math.min(dist, speed * dt);
    const m = moveCircle(run.house, this.x, this.z, this.size, MOP.height, Math.sin(this.yaw) * step, Math.cos(this.yaw) * step);
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
    if (this.sinceDrop >= MOP.trailSpacing) {
      this.sinceDrop = 0;
      if (this.puddles.length >= this.maxPuddles) this.puddles.shift();
      this.puddles.push({ x: this.x, z: this.z, age: 0 });
    }
    const b = run.bunny;
    let wet = false;
    for (let i = this.puddles.length - 1; i >= 0; i--) {
      const p = this.puddles[i]!;
      p.age += dt;
      const s = puddleScale(p.age, MOP.trailLife, MOP.trailFade);
      if (s <= 0) {
        this.puddles.splice(i, 1);
        continue;
      }
      if (!wet && Math.hypot(b.x - p.x, b.z - p.z) < MOP.size * MOP.trailRadius * s + b.radius * 0.3) wet = true;
    }
    if (wet) {
      b.stats.removeSource(WET_SOURCE);
      b.stats.add({ stat: 'speed', op: 'mul', value: MOP.slowMultiplier, source: WET_SOURCE, duration: 0.25 });
    }
    this.syncTrail();
  }

  private syncTrail(): void {
    const n = this.puddles.length;
    for (let i = 0; i < n; i++) {
      const p = this.puddles[i]!;
      const s = MOP.size * MOP.trailRadius * puddleScale(p.age, MOP.trailLife, MOP.trailFade);
      _dummy.position.set(p.x, 0.2, p.z);
      _dummy.scale.set(s, 1, s);
      _dummy.updateMatrix();
      this.trail.setMatrixAt(i, _dummy.matrix);
    }
    this.trail.count = n;
    this.trail.instanceMatrix.needsUpdate = true;
  }

  onContact(run: Run): void {
    if (bunnySheltered(run, MOP.height)) return;
    if (!this.stunned && this.recoilFor <= 0 && hitBunny(run, this.x, this.z, { damage: MOP.damage, source: this.def.id, knockbackCm: MOP.knockbackCm, knockbackRadii: MOP.knockbackRadii })) this.recoilFor = HAZARD_RECOIL;
    pushBunnyOut(run, this.x, this.z, this.size);
  }

  override dispose(): void {
    this.trail.geometry.dispose();
    (this.trail.material as MeshBasicMaterial).dispose();
    this.trail.dispose();
    super.dispose();
  }
}

export const mopDef = hazardRegistry.register({
  id: 'mop',
  name: 'Mop',
  minTier: 3,
  spawnWeight: 1,
  mass: MOP.mass,
  modelId: 'mop',
  create(run, x, z, id, rng) {
    return new Mop(id, this, run, x, z, rng);
  },
});
