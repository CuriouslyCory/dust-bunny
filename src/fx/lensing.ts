/**
 * Gravitational lensing: Sagittarius A*'s suction bends the camera (src/hazards/sagittariusA.ts
 * keeps a `GravityLens` up to date every tick; render-only, nothing here touches the simulation).
 *
 * - **Lean and roll.** `bendCamera` hands the rig (src/systems/camera.ts, `CameraRig.bend`) a lean
 *   towards the hole (`lean` × the gap) and a roll (`roll` radians, towards the side it is on),
 *   both scaled by how hard it pulls the Bunny (`pull`). Reduced motion: no roll, a third of the lean.
 * - **The warp.** After the scene is drawn, `LensingPass.render` copies a square of the frame round
 *   the hole (512 px on low quality, 1024 on high, never more than the canvas) into a texture and
 *   draws it back through a lens: each pixel outside the hole samples from closer in (source =
 *   r − strength × rₑ² / r, the point-mass lens equation, faded out by `extent`), so the disc and
 *   the floor are pushed outward round a dark shadow rimmed by a bright photon ring; inside the
 *   hole (its face) nothing bends. Cost: one sub-rectangle copy and one quad, and only while a lens
 *   is on screen. The lens fades out while the Bunny is over the disc (src/hazards/sagittariusA.ts),
 *   so the warp never smears the Bunny itself; parts in front of it (the north jet, on
 *   `LENS_FRONT_LAYER`) are drawn after the warp.
 */
import { FramebufferTexture, LinearFilter, Mesh, OrthographicCamera, PlaneGeometry, Scene, ShaderMaterial, Vector2, Vector3, Vector4, type PerspectiveCamera, type WebGLRenderer } from 'three';
import type { Run } from '../game/run';
import type { CameraRig } from '../systems/camera';
import type { Quality } from './quality';

/** A lens on the floor plane: what the renderer needs from a Hazard that bends light. */
export interface GravityLens {
  /** Centre of the hole (world units). */
  x: number;
  y: number;
  z: number;
  /** Radius of the hole (nothing inside bends), of the Einstein ring, and of the region the warp fades out by. */
  horizon: number;
  einstein: number;
  extent: number;
  /** Warp strength (0: none, 1: full). */
  strength: number;
  /** How hard it pulls the Bunny right now (0..1): drives the lean and roll. */
  pull: number;
  /** At full pull: lean towards it (fraction of the gap) and roll (radians). */
  lean: number;
  roll: number;
}

/** The first live Hazard in the Run with a `lens` (Sagittarius A*), or null. */
export function findLens(run: Run | null): GravityLens | null {
  if (!run) return null;
  for (const h of run.hazards.hazards) {
    const lens = (h as { lens?: GravityLens }).lens;
    if (lens && !h.dead) return lens;
  }
  return null;
}

/** Hands the camera rig this frame's bend (none without a lens). Reduced motion: no roll, a third of the lean. */
export function bendCamera(rig: CameraRig, lens: GravityLens | null, reducedMotion: boolean): void {
  if (!lens || lens.pull <= 0) {
    rig.bend(0, 0, 0, 0);
    return;
  }
  rig.bend(lens.x, lens.z, lens.pull * lens.lean * (reducedMotion ? 0.35 : 1), reducedMotion ? 0 : lens.pull * lens.roll);
}

const VERTEX = /* glsl */ `
uniform vec4 uRect;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(uRect.xy + uv * uRect.zw, 0.0, 1.0);
}`;

const FRAGMENT = /* glsl */ `
uniform sampler2D tMap;
uniform vec2 uCentre;
uniform float uHorizon;
uniform float uEinstein;
uniform float uOuter;
uniform float uStrength;
varying vec2 vUv;
void main() {
  vec2 d = vUv - uCentre;
  float r = length(d);
  vec2 dir = r > 1e-5 ? d / r : vec2(0.0);
  float fade = 1.0 - smoothstep(uOuter * 0.55, uOuter, r);
  // The lens equation: this pixel shows what lies at radius src (closer in).
  float src = r - uStrength * fade * uEinstein * uEinstein / max(r, 1e-4);
  float bend = smoothstep(uHorizon * 0.97, uHorizon * 1.05, r);
  vec2 uv = uCentre + dir * mix(r, max(src, uHorizon), bend);
  vec3 col = texture2D(tMap, clamp(uv, vec2(0.001), vec2(0.999))).rgb;
  // Light from inside the hole never arrives: a shadow round it, rimmed by the photon ring.
  float shadow = (1.0 - smoothstep(uHorizon * 0.7, uHorizon, src)) * bend;
  col *= 1.0 - 0.88 * shadow;
  float ring = exp(-pow((src - uHorizon) / (uHorizon * 0.1), 2.0)) * bend * uStrength;
  col += vec3(0.85, 0.75, 1.0) * ring * 0.55;
  gl_FragColor = vec4(col, 1.0);
}`;

/**
 * Layer for parts of a lensing Hazard that sit in front of the lens (Sagittarius A*'s north jet):
 * the main pass skips them (the camera only sees layer 0) and `LensingPass.render` draws them on
 * top of the warp, so they never bend.
 */
export const LENS_FRONT_LAYER = 3;

const _buf = new Vector2();
const _pos = new Vector2();
const _c = new Vector3();
const _p = new Vector3();
const _right = new Vector3();

export class LensingPass {
  private tex: FramebufferTexture | null = null;
  private size = 0;
  private readonly scene = new Scene();
  private readonly cam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly material: ShaderMaterial;
  private readonly quad: Mesh;

  constructor() {
    this.material = new ShaderMaterial({
      uniforms: {
        tMap: { value: null },
        uRect: { value: new Vector4(0, 0, 1, 1) },
        uCentre: { value: new Vector2(0.5, 0.5) },
        uHorizon: { value: 0.1 },
        uEinstein: { value: 0.2 },
        uOuter: { value: 0.5 },
        uStrength: { value: 0 },
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.quad = new Mesh(new PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  /**
   * Warps the frame just drawn round `lens` (call right after rendering `scene` with `camera`),
   * then draws the lens's front parts (`LENS_FRONT_LAYER`) on top.
   */
  render(renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera, lens: GravityLens | null, quality: Quality): void {
    if (!lens) return;
    // Draw on top of the frame, adding to its stats rather than resetting them (the debug readout).
    const autoClear = renderer.autoClear;
    const autoReset = renderer.info.autoReset;
    renderer.autoClear = false;
    renderer.info.autoReset = false;
    if (lens.strength >= 0.02) this.warp(renderer, camera, lens, quality);
    const mask = camera.layers.mask;
    const shadows = renderer.shadowMap.autoUpdate;
    // A colour background would clear the frame (three clears for it even without autoClear).
    const background = scene.background;
    scene.background = null;
    camera.layers.set(LENS_FRONT_LAYER);
    renderer.shadowMap.autoUpdate = false;
    renderer.render(scene, camera);
    camera.layers.mask = mask;
    renderer.shadowMap.autoUpdate = shadows;
    scene.background = background;
    renderer.autoClear = autoClear;
    renderer.info.autoReset = autoReset;
  }

  private warp(renderer: WebGLRenderer, camera: PerspectiveCamera, lens: GravityLens, quality: Quality): void {
    renderer.getDrawingBufferSize(_buf);
    const w = _buf.x;
    const h = _buf.y;
    const s = Math.floor(Math.min(quality === 'low' ? 512 : 1024, w, h));
    if (s < 64) return;
    _c.set(lens.x, lens.y, lens.z).project(camera);
    if (_c.z < -1 || _c.z > 1) return;
    const cx = (_c.x * 0.5 + 0.5) * w;
    const cy = (_c.y * 0.5 + 0.5) * h;
    // Pixels per world unit at the hole: project a point `extent` along the camera's right.
    _right.setFromMatrixColumn(camera.matrixWorld, 0);
    _p.set(lens.x, lens.y, lens.z).addScaledVector(_right, lens.extent).project(camera);
    const extentPx = Math.hypot((_p.x - _c.x) * 0.5 * w, (_p.y - _c.y) * 0.5 * h);
    const outer = Math.min(s * 0.5, extentPx);
    if (outer < 8 || cx + outer < 0 || cx - outer > w || cy + outer < 0 || cy - outer > h) return;
    const horizon = (lens.horizon / lens.extent) * extentPx;
    const einstein = Math.min((lens.einstein / lens.extent) * extentPx, outer * 0.6);
    if (!this.tex || this.size !== s) {
      this.tex?.dispose();
      this.tex = new FramebufferTexture(s, s);
      this.tex.minFilter = LinearFilter;
      this.tex.magFilter = LinearFilter;
      this.size = s;
    }
    const ox = Math.min(Math.max(Math.round(cx - s / 2), 0), w - s);
    const oy = Math.min(Math.max(Math.round(cy - s / 2), 0), h - s);
    renderer.copyFramebufferToTexture(this.tex, _pos.set(ox, oy));
    const u = this.material.uniforms;
    u.tMap!.value = this.tex;
    (u.uRect!.value as Vector4).set((ox / w) * 2 - 1, (oy / h) * 2 - 1, (s / w) * 2, (s / h) * 2);
    (u.uCentre!.value as Vector2).set((cx - ox) / s, (cy - oy) / s);
    u.uHorizon!.value = horizon / s;
    u.uEinstein!.value = einstein / s;
    u.uOuter!.value = outer / s;
    u.uStrength!.value = Math.min(1, lens.strength);
    renderer.render(this.scene, this.cam);
  }

  dispose(): void {
    this.tex?.dispose();
    this.quad.geometry.dispose();
    this.material.dispose();
  }
}
