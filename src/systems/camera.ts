/**
 * Camera rig: fixed yaw/pitch chase camera whose distance and fog scale with the Bunny
 * radius and Tier. The pure helpers are shared with the spawner (view radius).
 */
import { Fog, PerspectiveCamera, Vector3 } from 'three';
import { clamp, damp } from '../core/math';
import { getTier } from '../data/tiers';
import { TUNING } from '../data/tuning';

export function cameraDistanceFor(radius: number, tier: number): number {
  const c = TUNING.camera;
  return clamp(radius * getTier(tier).cameraScale, c.minDistance, c.maxDistance);
}

/** Approximate radius of floor visible around the Bunny (cm). */
export function viewRadiusFor(radius: number, tier: number): number {
  return cameraDistanceFor(radius, tier) * TUNING.camera.viewRadiusFactor;
}

export class CameraRig {
  distance: number;
  readonly target = new Vector3();
  private readonly offsetDir = new Vector3();

  constructor(
    readonly camera: PerspectiveCamera,
    readonly fog: Fog,
    radius: number,
    tier: number,
  ) {
    this.distance = cameraDistanceFor(radius, tier);
    this.updateOffsetDir();
  }

  private updateOffsetDir(): void {
    const c = TUNING.camera;
    const pitch = (c.pitchDeg * Math.PI) / 180;
    this.offsetDir.set(Math.sin(c.yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(c.yaw) * Math.cos(pitch));
  }

  /** Jump straight to the target framing (Run start). */
  snap(x: number, z: number, radius: number, tier: number): void {
    this.distance = cameraDistanceFor(radius, tier);
    this.target.set(x, radius * 0.5, z);
    this.apply();
  }

  update(frameDt: number, x: number, z: number, radius: number, tier: number): void {
    const c = TUNING.camera;
    this.updateOffsetDir();
    this.distance = damp(this.distance, cameraDistanceFor(radius, tier), c.zoomRate, frameDt);
    const k = 1 - Math.exp(-c.followRate * frameDt);
    this.target.x += (x - this.target.x) * k;
    this.target.z += (z - this.target.z) * k;
    this.target.y = radius * 0.5;
    this.apply();
  }

  private apply(): void {
    const c = TUNING.camera;
    const d = this.distance;
    this.camera.position.copy(this.target).addScaledVector(this.offsetDir, d);
    this.camera.lookAt(this.target);
    const near = Math.max(0.05, d * 0.02);
    const far = d * (c.fogFar + 1.5);
    if (Math.abs(this.camera.near - near) > near * 0.01 || Math.abs(this.camera.far - far) > far * 0.01) {
      this.camera.near = near;
      this.camera.far = far;
      this.camera.updateProjectionMatrix();
    }
    this.fog.near = d * c.fogNear;
    this.fog.far = d * c.fogFar;
  }
}
