/**
 * Camera rig: fixed yaw/pitch chase camera whose distance and fog scale with the Bunny
 * radius and Tier. The pure helpers are shared with the spawner (view radius).
 *
 * Aspect framing is render-only: on narrow (portrait) viewports the rig widens the fov,
 * steepens the pitch and pulls back so the floor visible around the Bunny stays comparable
 * to a 16:9 desktop. The sim (spawner, Hazard director) keeps using `viewRadiusFor`, so
 * gameplay is identical on every device.
 */
import { Fog, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { clamp, damp } from '../core/math';
import { getTier } from '../data/tiers';
import { TUNING } from '../data/tuning';
import type { Run } from '../game/run';

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

/** What the render camera currently frames; RunView refreshes it every frame (null headless). */
export interface ViewInfo {
  /** Camera distance from its target (cm). */
  distance: number;
  /** Viewport width / height. */
  aspect: number;
  /** Vertical field of view (degrees). */
  fovDeg: number;
  /** Camera pitch (degrees); defaults to TUNING.camera.pitchDeg. Portrait framing tilts it. */
  pitchDeg?: number;
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
  const p = ((view.pitchDeg ?? c.pitchDeg) * Math.PI) / 180;
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

/** Framing to keep spawns out of: the live camera (if rendering), never tighter than the Tier's target framing. */
export function spawnView(run: Run): ViewInfo {
  const target = cameraDistanceFor(run.bunny.radius, run.tier);
  const v = run.viewInfo;
  // The live distance lags a Tier-up zoom; never use less than the Tier's (aspect-framed) target.
  return v ? { ...v, distance: Math.max(v.distance, target * framingForAspect(v.aspect).distanceScale) } : { distance: target, aspect: DEFAULT_VIEW_ASPECT, fovDeg: TUNING.camera.fov };
}

/** True if a floor point is on screen right now (Hazards use it so they never attack from off screen). */
export function onScreen(run: Run, x: number, z: number, margin = 0): boolean {
  return floorPointVisible(x - run.bunny.x, z - run.bunny.z, spawnView(run), margin);
}

/**
 * A scripted camera pose (the diegetic intro, src/story/intro.ts) blended with the chase pose:
 * `weight` 0 shows the script alone, 1 the chase camera alone. In between, the look point moves in
 * a straight line and the camera swings round it (direction slerped, distance lerped), so handing
 * the camera back is one continuous move.
 */
export interface CameraScript {
  position: Vector3;
  look: Vector3;
  weight: number;
  /** Vertical fov (degrees, at the 16:9 framing; narrow viewports widen it like the chase camera's). Default: the chase fov. */
  fov?: number;
}

/** A script's fov, widened for the viewport like the chase fov, blended towards the chase fov by `weight`. */
function scriptFov(fov: number, framingFov: number, weight: number): number {
  const half = (deg: number) => Math.tan((deg * Math.PI) / 360);
  const wide = half(fov) * (half(framingFov) / half(TUNING.camera.fov));
  const t = wide + (half(framingFov) - wide) * clamp(weight, 0, 1);
  return (Math.atan(t) * 360) / Math.PI;
}

const _a = new Vector3();
const _b = new Vector3();
const _q = new Quaternion();
const _qId = new Quaternion();

export class CameraRig {
  /** Scripted pose blended over the chase pose (null: chase camera only). */
  script: CameraScript | null = null;
  /** What the camera actually looks at and its distance from it (script blend included). */
  readonly viewTarget = new Vector3();
  viewDistance = 0;
  /** Eased hand-back of a script to the chase camera: seconds left, total, starting weight. */
  private release = { left: 0, total: 0, from: 0 };
  /** Smoothed Tier distance (before aspect framing). */
  private zoom: number;
  private framing: Framing = framingForAspect(16 / 9);
  readonly target = new Vector3();
  private readonly offsetDir = new Vector3();
  /** Bend towards a gravity lens (`bend`, render-only): wanted and eased lean offset and roll. */
  private readonly bendWant = { x: 0, z: 0, lean: 0, roll: 0 };
  private readonly lean = new Vector3();
  private roll = 0;
  private readonly look = new Vector3();

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

  /**
   * Hands a scripted pose back to the chase camera, easing its weight to 1 over `seconds` (0: at
   * once), then drops the script.
   */
  releaseScript(seconds: number): void {
    if (!this.script) return;
    if (seconds <= 0 || this.script.weight >= 1) {
      this.script = null;
      this.release.left = 0;
      this.apply();
      return;
    }
    this.release = { left: seconds, total: seconds, from: this.script.weight };
  }

  /** Jump straight to the target framing (Run start). Drops any scripted pose. */
  snap(x: number, z: number, radius: number, tier: number): void {
    this.script = null;
    this.release.left = 0;
    this.zoom = cameraDistanceFor(radius, tier);
    this.target.set(x, radius * 0.5, z);
    this.lean.set(0, 0, 0);
    this.roll = 0;
    this.apply();
  }

  /**
   * Bends the camera towards a gravity lens at (x, z) (Sagittarius A*, src/fx/lensing.ts): the view
   * leans `lean` × the gap towards it (at most a third of the camera distance) and rolls `roll`
   * radians towards the side it is on. Eased in `update`; (0, 0, 0, 0) lets go.
   */
  bend(x: number, z: number, lean: number, roll: number): void {
    const w = this.bendWant;
    w.x = x;
    w.z = z;
    w.lean = lean;
    w.roll = roll;
  }

  update(frameDt: number, x: number, z: number, radius: number, tier: number): void {
    const c = TUNING.camera;
    this.updateOffsetDir();
    this.zoom = damp(this.zoom, cameraDistanceFor(radius, tier), c.zoomRate, frameDt);
    const k = 1 - Math.exp(-c.followRate * frameDt);
    this.target.x += (x - this.target.x) * k;
    this.target.z += (z - this.target.z) * k;
    this.target.y = radius * 0.5;
    this.updateBend(frameDt);
    this.updateRelease(frameDt);
    this.apply();
  }

  private updateRelease(frameDt: number): void {
    const r = this.release;
    if (r.left <= 0 || !this.script) return;
    r.left = Math.max(0, r.left - frameDt);
    const t = 1 - r.left / r.total;
    this.script.weight = r.from + (1 - r.from) * t * t * (3 - 2 * t);
    if (r.left <= 0) this.script = null;
  }

  private updateBend(frameDt: number): void {
    const w = this.bendWant;
    let lx = 0;
    let lz = 0;
    let roll = 0;
    if (w.lean > 0 || w.roll !== 0) {
      const dx = w.x - this.target.x;
      const dz = w.z - this.target.z;
      const gap = Math.hypot(dx, dz) || 1;
      const len = Math.min(gap * w.lean, this.distance / 3);
      lx = (dx / gap) * len;
      lz = (dz / gap) * len;
      // Roll towards the side of the screen the lens is on (screen right: the camera's +X on the floor).
      const yaw = TUNING.camera.yaw;
      const side = dx * Math.cos(yaw) - dz * Math.sin(yaw);
      roll = -Math.sign(side) * w.roll * Math.min(1, Math.abs(side) / (gap * 0.5));
    }
    const k = 1 - Math.exp(-3 * frameDt);
    this.lean.x += (lx - this.lean.x) * k;
    this.lean.z += (lz - this.lean.z) * k;
    this.roll += (roll - this.roll) * k;
  }

  private apply(): void {
    const c = TUNING.camera;
    const d = this.distance;
    this.look.copy(this.target).add(this.lean);
    let view = d;
    const s = this.script;
    if (s && s.weight < 1) {
      // Swing from the scripted pose to the chase pose round the moving look point.
      const w = clamp(s.weight, 0, 1);
      _a.subVectors(s.position, s.look);
      const la = _a.length() || 1;
      _a.divideScalar(la);
      _b.copy(this.offsetDir);
      _q.setFromUnitVectors(_a, _b);
      _q.copy(_qId.identity().slerp(_q, w));
      view = la + (d - la) * w;
      this.look.lerpVectors(s.look, this.look, w);
      this.camera.position.copy(this.look).addScaledVector(_a.applyQuaternion(_q), view);
    } else {
      this.camera.position.copy(this.look).addScaledVector(this.offsetDir, d);
    }
    this.camera.lookAt(this.look);
    if (this.roll !== 0) this.camera.rotateZ(this.roll);
    const fov = s?.fov && s.weight < 1 ? scriptFov(s.fov, this.framing.fov, s.weight) : this.framing.fov;
    if (Math.abs(this.camera.fov - fov) > 1e-3) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    this.viewTarget.copy(this.look);
    this.viewDistance = view;
    const near = Math.max(0.05, view * 0.02);
    const far = view * (c.fogFar + 1.5);
    if (Math.abs(this.camera.near - near) > near * 0.01 || Math.abs(this.camera.far - far) > far * 0.01) {
      this.camera.near = near;
      this.camera.far = far;
      this.camera.updateProjectionMatrix();
    }
    this.fog.near = view * c.fogNear;
    this.fog.far = view * c.fogFar;
  }
}
