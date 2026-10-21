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

/** What the render camera currently frames; RunView refreshes it every frame (null headless). */
export interface ViewInfo {
  /** Camera distance from its target (cm). */
  distance: number;
  /** Viewport width / height. */
  aspect: number;
  /** Vertical field of view (degrees). */
  fovDeg: number;
}

/** Assumed framing when no renderer reports one (tests, pnpm sim): a wide desktop window. */
export const DEFAULT_VIEW_ASPECT = 16 / 9;

/**
 * True if the floor point at (dx, dz) from the camera target is on screen (fixed yaw/pitch
 * chase camera). The visible floor is a trapezoid: short towards the camera (bottom of the
 * screen, about 0.43 × distance) and wide away from it. `margin` (cm) grows the test so a
 * Debris disc of that radius poking in at an edge counts as visible.
 */
export function floorPointVisible(dx: number, dz: number, view: ViewInfo, margin = 0): boolean {
  if (margin > 0) {
    return (
      floorPointVisible(dx, dz, view) ||
      floorPointVisible(dx + margin, dz, view) ||
      floorPointVisible(dx - margin, dz, view) ||
      floorPointVisible(dx, dz + margin, view) ||
      floorPointVisible(dx, dz - margin, view)
    );
  }
  const c = TUNING.camera;
  const p = (c.pitchDeg * Math.PI) / 180;
  const sy = Math.sin(c.yaw);
  const cy = Math.cos(c.yaw);
  const ahead = -(dx * sy + dz * cy);
  const side = dx * cy - dz * sy;
  const d = view.distance;
  const h = ahead + d * Math.cos(p);
  const height = d * Math.sin(p);
  const depth = height * Math.sin(p) + h * Math.cos(p);
  if (depth <= 0) return false;
  const up = h * Math.sin(p) - height * Math.cos(p);
  const t = Math.tan(((view.fovDeg * Math.PI) / 180) / 2);
  return Math.abs(up) <= depth * t && Math.abs(side) <= depth * t * view.aspect;
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
