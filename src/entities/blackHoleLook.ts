/**
 * The Bunny's black-hole form (browser only), after it absorbs Sagittarius A* (`Bunny.form`
 * 'black_hole', set by the Run; BunnyView darkens the fur and core and adds this round the ball):
 *
 * - An accretion disc of lint: a flattened, slightly tilted ring of lint tufts (one InstancedMesh)
 *   circling the ball, grey-lavender outside and hot orange near the inner edge (the tufts glow in
 *   their own colour), over a glowing band (additive, `DISC_FRAG`) whose spiral streaks turn with
 *   the tufts, brightest at its warm inner edge and on the side swinging towards the camera.
 * - A lensing shimmer: a camera-facing quad (`LENS_FRAG`, additive) drawing a thin photon ring just
 *   outside the fur and faint ripples running outwards from it, as if the light round the ball bends.
 *
 * Sizes are in ball radii: the group is scaled by the Bunny's radius each frame, `grow` (0..1)
 * brings it in (the disc spins up and widens, the ring brightens).
 */
import {
  AdditiveBlending,
  Color,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  ShaderMaterial,
  Vector3,
  Euler,
} from 'three';
import { Rng } from '../core/rng';

/** Disc: inner / outer radius, tilt (radians: towards the camera, so it passes under the eyes, and to one side), tufts, turn rate (rad/s at the inner edge). */
export const HOLE = { inner: 1.28, outer: 2.35, tilt: 0.22, roll: 0.24, tufts: 320, spin: 1.1, growSeconds: 1.4, ring: 1.17 };

const DISC_VERT = /* glsl */ `
varying vec2 vP;
void main() {
  vP = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const DISC_FRAG = /* glsl */ `
uniform float uTime;
uniform float uGrow;
uniform float uInner;
uniform float uOuter;
varying vec2 vP;
void main() {
  float r = length(vP);
  float t = clamp((r - uInner) / (uOuter - uInner), 0.0, 1.0);
  float a = atan(vP.y, vP.x);
  // Spiral streaks dragged round faster near the inner edge.
  float swirl = a * 3.0 + log(r) * 9.0 + uTime * 2.2 / max(r * r * 0.5, 0.4);
  float streak = 0.55 + 0.45 * sin(swirl) * sin(swirl * 0.37 + 1.3);
  // Doppler beaming: the side swinging towards the camera (the right, +x) is brighter.
  float beam = 1.0 + 0.55 * cos(a);
  vec3 hot = vec3(1.0, 0.86, 0.62);
  vec3 warm = vec3(1.0, 0.45, 0.16);
  vec3 cool = vec3(0.55, 0.38, 0.85);
  vec3 col = mix(hot, warm, smoothstep(0.0, 0.25, t));
  col = mix(col, cool, smoothstep(0.35, 0.95, t));
  float edge = smoothstep(0.0, 0.05, t) * (1.0 - smoothstep(0.65, 1.0, t));
  float a0 = edge * (0.25 + 0.75 * exp(-t * 4.0)) * streak * beam * uGrow;
  gl_FragColor = vec4(col * a0, 1.0); // additive: src × alpha + dst
}`;

const LENS_VERT = /* glsl */ `
uniform float uSize;
varying vec2 vUv2;
void main() {
  vUv2 = position.xy;
  // Billboard: the quad faces the camera, sized in ball radii (the object's scale), pulled
  // towards the camera by one radius so it sits in front of the fur at the silhouette.
  float s = length(modelMatrix[0].xyz);
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vec3 toCam = normalize(-mv.xyz);
  mv.xyz += toCam * s;
  mv.xy += position.xy * uSize * s;
  gl_Position = projectionMatrix * mv;
}`;

const LENS_FRAG = /* glsl */ `
uniform float uTime;
uniform float uGrow;
uniform float uSize;
uniform float uRing;
varying vec2 vUv2;
void main() {
  float r = length(vUv2) * uSize;
  float a = atan(vUv2.y, vUv2.x);
  // A wobbling photon ring just outside the fur.
  float ringR = uRing + 0.015 * sin(a * 5.0 + uTime * 3.0) + 0.01 * sin(a * 11.0 - uTime * 4.7);
  float ring = exp(-pow((r - ringR) / 0.022, 2.0));
  float glow = exp(-pow((r - ringR) / 0.12, 2.0)) * 0.35;
  // Ripples running outwards (light bending round the hole), fading with distance.
  float d = r - ringR;
  float rip = 0.5 + 0.5 * sin(d * 26.0 - uTime * 5.0 + sin(a * 3.0 + uTime) * 1.2);
  float ripples = step(0.0, d) * exp(-d * 2.6) * pow(rip, 6.0) * 0.32;
  vec3 col = vec3(1.0, 0.78, 0.5) * ring * 1.3 + vec3(0.85, 0.72, 1.0) * (glow + ripples);
  gl_FragColor = vec4(col * uGrow, 1.0); // additive: src × alpha + dst
}`;

export class BlackHoleLook {
  /** Add under the Bunny's root (ball centre; no squash, no yaw); scaled by the radius. */
  readonly root = new Group();
  private readonly tilt = new Group();
  private readonly tufts: InstancedMesh;
  private readonly band: Mesh;
  private readonly lens: Mesh;
  private readonly discU: Record<string, { value: number }>;
  private readonly lensU: Record<string, { value: number }>;
  private readonly items: Array<{ r: number; a: number; y: number; s: number; spin: Vector3 }> = [];
  private spinAngle = 0;

  constructor() {
    this.root.name = 'blackHole';
    this.tilt.rotation.set(HOLE.tilt, 0, HOLE.roll);
    this.root.add(this.tilt);

    // The glowing band under the tufts.
    this.discU = { uTime: { value: 0 }, uGrow: { value: 0 }, uInner: { value: HOLE.inner - 0.08 }, uOuter: { value: HOLE.outer + 0.1 } };
    const band = new RingGeometry(HOLE.inner - 0.08, HOLE.outer + 0.1, 96, 4);
    this.band = new Mesh(
      band,
      new ShaderMaterial({ uniforms: this.discU, vertexShader: DISC_VERT, fragmentShader: DISC_FRAG, transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide }),
    );
    this.band.rotation.x = -Math.PI / 2; // the ring's own plane (x, y, read by the shader) laid flat
    this.band.renderOrder = 4;
    this.band.name = 'accretionBand';
    this.tilt.add(this.band);

    // Lint tufts: lumpy, flattened, lavender-grey outside, hot near the inner edge.
    const rng = new Rng('bunny-accretion');
    const geo = new IcosahedronGeometry(1, 1);
    const pos = geo.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const n = Math.sin(pos.getX(i) * 9.1 + pos.getY(i) * 7.3 + pos.getZ(i) * 5.7) * 0.22;
      pos.setXYZ(i, pos.getX(i) * (1 + n), pos.getY(i) * (0.55 + n * 0.5), pos.getZ(i) * (1 + n));
    }
    geo.computeVertexNormals();
    const mat = new MeshStandardMaterial({ color: '#ffffff', roughness: 1 });
    // The tufts glow in their own (instance) colour, so the disc reads in dark space.
    mat.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vColor.rgb * 0.55;');
    };
    mat.customProgramCacheKey = () => 'bunny-accretion-lint';
    this.tufts = new InstancedMesh(geo, mat, HOLE.tufts);
    this.tufts.frustumCulled = false;
    this.tufts.name = 'accretionLint';
    const lintA = new Color('#b9b0c8');
    const lintB = new Color('#8f86a6');
    const hot = new Color('#ffb066');
    const c = new Color();
    for (let i = 0; i < HOLE.tufts; i++) {
      const t = rng.next() ** 1.3;
      const r = HOLE.inner + (HOLE.outer - HOLE.inner) * t;
      this.items.push({
        r,
        a: rng.range(0, Math.PI * 2),
        y: rng.range(-0.05, 0.05) * (0.4 + t),
        s: rng.range(0.05, 0.12) * (1.2 - t * 0.5),
        spin: new Vector3(rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)),
      });
      c.copy(lintA).lerp(lintB, rng.next()).lerp(hot, Math.max(0, 1 - t * 2.6) * 0.85);
      this.tufts.setColorAt(i, c);
    }
    this.tilt.add(this.tufts);

    // The lensing shimmer: a camera-facing quad.
    const size = 1.9;
    this.lensU = { uTime: { value: 0 }, uGrow: { value: 0 }, uSize: { value: size }, uRing: { value: HOLE.ring } };
    this.lens = new Mesh(
      new PlaneGeometry(2, 2),
      new ShaderMaterial({ uniforms: this.lensU, vertexShader: LENS_VERT, fragmentShader: LENS_FRAG, transparent: true, depthWrite: false, blending: AdditiveBlending }),
    );
    this.lens.frustumCulled = false;
    this.lens.renderOrder = 5;
    this.lens.name = 'lensing';
    this.root.add(this.lens);
  }

  /** `r`: the Bunny's radius; `grow` 0..1 (eased by the caller); `time` seconds. */
  update(dt: number, r: number, grow: number, time: number): void {
    this.root.visible = grow > 0;
    if (!this.root.visible) return;
    this.root.scale.setScalar(r);
    this.discU.uTime!.value = time;
    this.discU.uGrow!.value = grow;
    this.lensU.uTime!.value = time;
    this.lensU.uGrow!.value = grow;
    this.spinAngle += dt * HOLE.spin * (0.3 + 0.7 * grow);
    // Keplerian-ish: inner tufts turn faster; the disc widens from the ball as it grows in.
    const widen = 0.55 + 0.45 * grow;
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i]!;
      const a = it.a + this.spinAngle * (HOLE.inner / it.r) ** 1.5;
      const rr = 1 + (it.r - 1) * widen;
      _p.set(Math.cos(a) * rr, it.y, Math.sin(a) * rr);
      _q.setFromEuler(_e.set(it.spin.x * time, it.spin.y * time + a, it.spin.z * time));
      _s.setScalar(it.s * grow);
      this.tufts.setMatrixAt(i, _m.compose(_p, _q, _s));
    }
    this.tufts.instanceMatrix.needsUpdate = true;
    this.band.scale.setScalar(widen);
  }

  dispose(): void {
    this.tufts.geometry.dispose();
    (this.tufts.material as MeshStandardMaterial).dispose();
    this.tufts.dispose();
    this.band.geometry.dispose();
    (this.band.material as ShaderMaterial).dispose();
    this.lens.geometry.dispose();
    (this.lens.material as ShaderMaterial).dispose();
    this.root.removeFromParent();
  }
}

const _m = new Matrix4();
const _q = new Quaternion();
const _e = new Euler();
const _p = new Vector3();
const _s = new Vector3();
