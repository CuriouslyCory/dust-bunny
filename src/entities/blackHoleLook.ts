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
 *
 * In the Universe the Bunny is a cluster of black holes with fur between them (`BlackHoleCluster`,
 * BunnyView): `CLUSTER.holes` small black cores, each with a photon ring and a little accretion
 * disc of its own (glowing band and lint tufts), orbit inside the fur on tilted paths; the big disc
 * fades back and its lint puffs up into a cloud round them (`setCluster`). Three InstancedMeshes
 * and one instanced band, so a handful of draw calls.
 */
import {
  AdditiveBlending,
  MeshBasicMaterial,
  SphereGeometry,
  TorusGeometry,
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

  /** 0..1: the Universe's cluster look (the big disc fades back, its lint puffs up between the holes). */
  private cluster = 0;

  setCluster(c: number): void {
    this.cluster = c;
  }

  /** `r`: the Bunny's radius; `grow` 0..1 (eased by the caller); `time` seconds. */
  update(dt: number, r: number, grow: number, time: number): void {
    this.root.visible = grow > 0;
    if (!this.root.visible) return;
    this.root.scale.setScalar(r);
    this.discU.uTime!.value = time;
    this.discU.uGrow!.value = grow * (1 - 0.7 * this.cluster);
    this.lensU.uTime!.value = time;
    this.lensU.uGrow!.value = grow;
    this.spinAngle += dt * HOLE.spin * (0.3 + 0.7 * grow);
    // Keplerian-ish: inner tufts turn faster; the disc widens from the ball as it grows in.
    const widen = 0.55 + 0.45 * grow;
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i]!;
      const a = it.a + this.spinAngle * (HOLE.inner / it.r) ** 1.5;
      const rr = 1 + (it.r - 1) * widen;
      // In the cluster look the lint puffs up into a cloud between the holes, pulled in towards the fur.
      const puff = this.cluster;
      const cr = rr * (1 - 0.32 * puff);
      _p.set(Math.cos(a) * cr, it.y * (1 + 9 * puff) + Math.sin(a * 3 + it.r * 7) * 0.35 * puff, Math.sin(a) * cr);
      _q.setFromEuler(_e.set(it.spin.x * time, it.spin.y * time + a, it.spin.z * time));
      _s.setScalar(it.s * grow * (1 - 0.25 * puff));
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

/**
 * The Universe's cluster: holes orbiting inside the fur (ball radii). Each has a core (`size`), a
 * photon ring and a disc reaching `disc` × its size, `tufts` lint tufts per disc.
 */
export const CLUSTER = { holes: 4, size: [0.2, 0.3] as const, disc: 2.4, tufts: 44, orbit: [1.04, 1.2] as const, growSeconds: 1.6 };

const BAND_VERT = /* glsl */ `
varying vec2 vP;
void main() {
  vP = position.xy;
  vec4 p = vec4(position, 1.0);
  #ifdef USE_INSTANCING
  p = instanceMatrix * p;
  #endif
  gl_Position = projectionMatrix * modelViewMatrix * p;
}`;

const BAND_FRAG = /* glsl */ `
uniform float uTime;
uniform float uGrow;
varying vec2 vP;
void main() {
  float r = length(vP);
  float t = clamp((r - 0.42) / 0.58, 0.0, 1.0);
  float a = atan(vP.y, vP.x);
  float swirl = a * 2.0 + log(max(r, 0.05)) * 7.0 + uTime * 3.0 / max(r * r, 0.3);
  float streak = 0.6 + 0.4 * sin(swirl);
  vec3 col = mix(vec3(1.0, 0.85, 0.6), vec3(1.0, 0.42, 0.16), smoothstep(0.0, 0.35, t));
  col = mix(col, vec3(0.6, 0.42, 0.95), smoothstep(0.45, 1.0, t));
  float edge = smoothstep(0.0, 0.08, t) * (1.0 - smoothstep(0.6, 1.0, t));
  gl_FragColor = vec4(col * edge * (0.45 + 1.0 * exp(-t * 3.5)) * streak * uGrow, 1.0); // additive
}`;

interface ClusterHole {
  size: number;
  orbit: number;
  /** Height on the ball (elevation, radians: the upper half, which the camera sees), angular speed round the vertical (rad/s), phase. */
  elevation: number;
  bob: number;
  speed: number;
  phase: number;
  /** The disc's own tilt from flat. */
  discTilt: [number, number];
}

export class BlackHoleCluster {
  /** Add under the Bunny's root (ball centre; no squash, no yaw); scaled by the radius. */
  readonly root = new Group();
  private readonly cores: InstancedMesh;
  private readonly rings: InstancedMesh;
  private readonly bands: InstancedMesh;
  private readonly tufts: InstancedMesh;
  private readonly bandU: Record<string, { value: number }>;
  private readonly holes: ClusterHole[] = [];
  private readonly lint: Array<{ hole: number; r: number; a: number; y: number; s: number }> = [];

  constructor() {
    this.root.name = 'blackHoleCluster';
    const rng = new Rng('bunny-cluster');
    const n = CLUSTER.holes;
    for (let i = 0; i < n; i++) {
      this.holes.push({
        size: rng.range(CLUSTER.size[0], CLUSTER.size[1]),
        orbit: rng.range(CLUSTER.orbit[0], CLUSTER.orbit[1]),
        elevation: 0.3 + (0.8 * (i + rng.next())) / n,
        bob: rng.range(0.6, 1.1),
        speed: rng.range(0.35, 0.6) * (i % 3 === 2 ? -1 : 1),
        phase: (i / n) * Math.PI * 2 + rng.range(-0.4, 0.4),
        discTilt: [rng.range(-0.5, 0.5), rng.range(-0.5, 0.5)],
      });
    }
    // Cores: black balls (they swallow the light behind them).
    this.cores = new InstancedMesh(new SphereGeometry(1, 20, 12), new MeshBasicMaterial({ color: '#000000' }), n);
    // Photon rings: thin bright tori round each core, facing up.
    this.rings = new InstancedMesh(
      new TorusGeometry(1.12, 0.07, 6, 40),
      new MeshBasicMaterial({ color: '#ffd8a8', transparent: true, opacity: 0.9, blending: AdditiveBlending, depthWrite: false }),
      n,
    );
    this.rings.renderOrder = 4;
    // Discs: an instanced glowing band per hole.
    this.bandU = { uTime: { value: 0 }, uGrow: { value: 0 } };
    this.bands = new InstancedMesh(
      new RingGeometry(0.4, 1, 48, 2),
      new ShaderMaterial({ uniforms: this.bandU, vertexShader: BAND_VERT, fragmentShader: BAND_FRAG, transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide }),
      n,
    );
    this.bands.renderOrder = 4;
    // Lint tufts in each disc (glowing in their own colour, like the big disc's).
    const geo = new IcosahedronGeometry(1, 0);
    const mat = new MeshStandardMaterial({ color: '#ffffff', roughness: 1 });
    mat.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vColor.rgb * 0.6;');
    };
    mat.customProgramCacheKey = () => 'bunny-cluster-lint';
    this.tufts = new InstancedMesh(geo, mat, n * CLUSTER.tufts);
    const lintA = new Color('#b9b0c8');
    const hot = new Color('#ffb066');
    const c = new Color();
    for (let h = 0; h < n; h++) {
      for (let k = 0; k < CLUSTER.tufts; k++) {
        const t = rng.next();
        this.lint.push({ hole: h, r: 1.15 + t * (CLUSTER.disc - 1.15), a: rng.range(0, Math.PI * 2), y: rng.range(-0.08, 0.08), s: rng.range(0.1, 0.2) * (1.1 - t * 0.5) });
        c.copy(lintA).lerp(hot, Math.max(0, 1 - t * 2.2) * 0.9);
        this.tufts.setColorAt(h * CLUSTER.tufts + k, c);
      }
    }
    for (const m of [this.cores, this.rings, this.bands, this.tufts]) {
      m.frustumCulled = false;
      this.root.add(m);
    }
  }

  /** `r`: the Bunny's radius; `grow` 0..1 (eased by the caller); `time` seconds. */
  update(r: number, grow: number, time: number): void {
    this.root.visible = grow > 0;
    if (!this.root.visible) return;
    this.root.scale.setScalar(r);
    this.bandU.uTime!.value = time;
    this.bandU.uGrow!.value = grow;
    for (let i = 0; i < this.holes.length; i++) {
      const h = this.holes[i]!;
      // Round the upper half of the ball (bobbing up and down a little), drifting out into the fur as it grows in.
      const a = h.phase + time * h.speed;
      const el = h.elevation + 0.18 * Math.sin(time * h.bob + h.phase);
      const o = h.orbit * (0.6 + 0.4 * grow);
      _p.set(Math.cos(el) * Math.cos(a) * o, Math.sin(el) * o, Math.cos(el) * Math.sin(a) * o);
      const s = h.size * grow;
      (_centre[i] ??= new Vector3()).copy(_p);
      this.cores.setMatrixAt(i, _m.compose(_p, _q.identity(), _s.setScalar(Math.max(1e-4, s))));
      _q.setFromEuler(_e.set(Math.PI / 2 + h.discTilt[0], 0, h.discTilt[1]));
      this.rings.setMatrixAt(i, _m.compose(_p, _q, _s.setScalar(Math.max(1e-4, s))));
      _q.setFromEuler(_e.set(-Math.PI / 2 + h.discTilt[0], 0, h.discTilt[1]));
      this.bands.setMatrixAt(i, _m.compose(_p, _q, _s.setScalar(Math.max(1e-4, s * CLUSTER.disc))));
    }
    for (let k = 0; k < this.lint.length; k++) {
      const it = this.lint[k]!;
      const h = this.holes[it.hole]!;
      const s = h.size * grow;
      const a = it.a + time * 2.2 * (1.15 / it.r) ** 1.5;
      _p.set(Math.cos(a) * it.r * s, it.y * s, Math.sin(a) * it.r * s);
      _p.applyEuler(_e.set(h.discTilt[0], 0, h.discTilt[1])).add(_centre[it.hole]!);
      _q.setFromEuler(_e.set(time * 1.3 + it.a, a, 0));
      this.tufts.setMatrixAt(k, _m.compose(_p, _q, _s.setScalar(Math.max(1e-4, it.s * s))));
    }
    for (const m of [this.cores, this.rings, this.bands, this.tufts]) m.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    for (const m of [this.cores, this.rings, this.bands, this.tufts]) {
      m.geometry.dispose();
      (m.material as MeshBasicMaterial).dispose();
      m.dispose();
    }
    this.root.removeFromParent();
  }
}

const _centre: Vector3[] = [];
