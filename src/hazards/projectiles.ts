/**
 * Straight-line projectiles shared by the turrets (Spray Bottle family droplets) and the
 * Incinerator's chimney ash. Each projectile flies along the floor plane up to its range, stops at
 * walls and furniture no higher than `blockHeight`, pops Lint's Decoy (`lure.shot(owner)`) and
 * calls `onHit` when it reaches the Bunny (unless the Bunny is sheltered from the owner). Visually
 * it arcs down from its launch height towards the Bunny's height. Headless-safe.
 */
import { Mesh, MeshStandardMaterial, SphereGeometry, type Object3D } from 'three';
import type { Run } from '../game/run';
import { activeLure, bunnySheltered, hazardFloorFree } from './common';
import type { Hazard } from './index';

const geometry = new SphereGeometry(1, 10, 8);
const materials = new Map<string, MeshStandardMaterial>();

/** Shared projectile material for a colour (water blue by default). */
export function projectileMaterial(color = '#9fe3ff', emissive = '#3aa8ff', opacity = 0.85): MeshStandardMaterial {
  const key = `${color}|${emissive}|${opacity}`;
  let m = materials.get(key);
  if (!m) {
    m = new MeshStandardMaterial({ color, emissive, emissiveIntensity: 0.6, roughness: 0.1, transparent: opacity < 1, opacity });
    materials.set(key, m);
  }
  return m;
}

export interface Projectile {
  x: number;
  z: number;
  vx: number;
  vz: number;
  traveled: number;
  max: number;
  mesh: Mesh;
}

export interface VolleySpec {
  /** Projectile radius (world units). */
  radius: number;
  /** Launch height for the visual arc. */
  height: number;
  /** Walls and furniture with clearance up to this stop a projectile. */
  blockHeight: number;
}

export class Volley {
  readonly items: Projectile[] = [];

  constructor(
    private readonly parent: Object3D,
    private readonly material: MeshStandardMaterial,
  ) {}

  /** Launches one projectile from (x, z) along `angle` (yaw, 0 = +Z). */
  fire(x: number, z: number, angle: number, speed: number, range: number, radius: number): Projectile {
    const mesh = new Mesh(geometry, this.material);
    mesh.scale.setScalar(radius);
    this.parent.add(mesh);
    const nx = Math.sin(angle);
    const nz = Math.cos(angle);
    const p = { x, z, vx: nx * speed, vz: nz * speed, traveled: 0, max: range, mesh };
    this.items.push(p);
    return p;
  }

  /** Moves every projectile; `onHit` runs once for each one that reaches the Bunny. */
  update(dt: number, run: Run, owner: Hazard, spec: VolleySpec, onHit: (p: Projectile) => void): void {
    const b = run.bunny;
    const lure = activeLure(run);
    for (let i = this.items.length - 1; i >= 0; i--) {
      const p = this.items[i]!;
      p.x += p.vx * dt;
      p.z += p.vz * dt;
      p.traveled += Math.hypot(p.vx, p.vz) * dt;
      let gone = p.traveled >= p.max || !hazardFloorFree(run.house, p.x, p.z, spec.radius, spec.blockHeight);
      if (!gone && lure && Math.hypot(lure.x - p.x, lure.z - p.z) < lure.radius + spec.radius) {
        // The shot reaches the Decoy and pops it.
        lure.shot(owner);
        gone = true;
      }
      if (!gone && Math.hypot(b.x - p.x, b.z - p.z) < b.radius + spec.radius && !bunnySheltered(run, spec.blockHeight)) {
        onHit(p);
        gone = true;
      }
      if (gone) {
        p.mesh.removeFromParent();
        this.items.splice(i, 1);
        continue;
      }
      const k = Math.min(1, p.traveled / p.max);
      const y = spec.height * (1 - k) + Math.min(b.radius, spec.height) * k;
      p.mesh.position.set(p.x, Math.max(spec.radius, y), p.z);
    }
  }

  clear(): void {
    for (const p of this.items) p.mesh.removeFromParent();
    this.items.length = 0;
  }
}
