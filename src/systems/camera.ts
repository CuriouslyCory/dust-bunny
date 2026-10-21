/**
 * Camera rig: fixed yaw/pitch chase camera whose distance and fog scale with the Bunny
 * radius and Tier. The pure helpers are shared with the spawner (view radius).
 *
 * Aspect framing is render-only: on narrow (portrait) viewports the rig widens the fov,
 * steepens the pitch and pulls back so the floor visible around the Bunny stays comparable
 * to a 16:9 desktop. The sim (spawner, Hazard director) keeps using `viewRadiusFor`, so
 * gameplay is identical on every device.
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

/** Aspect-ratio framing constants (render-only). */
export const FRAMING = {
  /** At or above this aspect (w/h) the base fov/pitch/distance are used unchanged. */
  refAspect: 1.6,
  /** How strongly narrow viewports are compensated (0 = none, 1 = same visible width as at refAspect). */
  exponent: 0.75,
  /** Vertical fov is widened up to this before the camera pulls back instead. */
  maxFov: 60,
  /** Portrait viewports tilt towards top-down so the far edge doesn't run off into the fog. */
  portraitPitchDeg: 66,
  /** Pitch blends from the base pitch at `pitchFromAspect` to `portraitPitchDeg` at `pitchToAspect`. */
  pitchFromAspect: 1.0,
  pitchToAspect: 0.5,
};

export interface Framing {
  fov: number;
  pitchDeg: number;
  /** Multiplier on the Tier camera distance. */
  distanceScale: number;
}

/** Camera fov/pitch/distance multiplier for a viewport aspect ratio (width / height). */
export function framingForAspect(aspect: number): Framing {
  const c = TUNING.camera;
  const f = FRAMING;
  const a = Math.max(0.2, aspect || 1);
  const t = clamp((f.pitchFromAspect - a) / (f.pitchFromAspect - f.pitchToAspect), 0, 1);
  const pitchDeg = c.pitchDeg + (f.portraitPitchDeg - c.pitchDeg) * t * t * (3 - 2 * t);
  if (a >= f.refAspect) return { fov: c.fov, pitchDeg, distanceScale: 1 };
  const halfTan = (deg: number) => Math.tan((deg * Math.PI) / 360);
  const want = halfTan(c.fov) * Math.pow(f.refAspect / a, f.exponent);
  const tanFov = Math.min(want, halfTan(Math.max(c.fov, f.maxFov)));
  return { fov: (Math.atan(tanFov) * 360) / Math.PI, pitchDeg, distanceScale: want / tanFov };
}

export class CameraRig {
  /** Smoothed Tier distance (before aspect framing). */
  private zoom: number;
  private framing: Framing = framingForAspect(16 / 9);
  readonly target = new Vector3();
  private readonly offsetDir = new Vector3();

  constructor(
    readonly camera: PerspectiveCamera,
    readonly fog: Fog,
    radius: number,
    tier: number,
  ) {
    this.zoom = cameraDistanceFor(radius, tier);
    this.updateOffsetDir();
  }

  /** Camera-to-target distance actually used (Tier distance × aspect framing). */
  get distance(): number {
    return this.zoom * this.framing.distanceScale;
  }

  /** Call on resize with the viewport aspect (width / height). */
  setAspect(aspect: number): void {
    this.framing = framingForAspect(aspect);
    if (this.camera.fov !== this.framing.fov) {
      this.camera.fov = this.framing.fov;
      this.camera.updateProjectionMatrix();
    }
    this.updateOffsetDir();
    this.apply();
  }

  private updateOffsetDir(): void {
    const c = TUNING.camera;
    const pitch = (this.framing.pitchDeg * Math.PI) / 180;
    this.offsetDir.set(Math.sin(c.yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(c.yaw) * Math.cos(pitch));
  }

  /** Jump straight to the target framing (Run start). */
  snap(x: number, z: number, radius: number, tier: number): void {
    this.zoom = cameraDistanceFor(radius, tier);
    this.target.set(x, radius * 0.5, z);
    this.apply();
  }

  update(frameDt: number, x: number, z: number, radius: number, tier: number): void {
    const c = TUNING.camera;
    this.updateOffsetDir();
    this.zoom = damp(this.zoom, cameraDistanceFor(radius, tier), c.zoomRate, frameDt);
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
