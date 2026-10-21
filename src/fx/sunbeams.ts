/**
 * Afternoon sun shafts: for rooms on the sunny side of the house (west / south exterior walls) a
 * shaft of light falls through an imagined window above the cut-away wall, leaving a warm patch
 * with window mullions on the floor. Dust motes hang inside each shaft. Everything is additive,
 * merged into three draw calls (shafts, patches, motes) for the whole house.
 */
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, DoubleSide, Float32BufferAttribute, Group, Mesh, Points, ShaderMaterial, UniformsLib, UniformsUtils, Vector3 } from 'three';
import { Rng } from '../core/rng';
import type { HouseLayout } from '../world/types';

/** Direction the light travels (matches Lighting's sun: from −X/+Z, above). */
export const SUN_TRAVEL = new Vector3(0.55, -1.15, -0.42).normalize();

const COLOR = new Color('#ffd9a0');

const SHAFT_VERT = /* glsl */ `
attribute vec2 aUv;
varying vec2 vUv;
#include <fog_pars_vertex>
void main() {
  vUv = aUv;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const SHAFT_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uIntensity;
uniform float uTime;
varying vec2 vUv;
#include <fog_pars_fragment>
void main() {
  float across = pow(sin(3.14159 * clamp(vUv.x, 0.0, 1.0)), 1.5);
  float along = smoothstep(0.0, 0.25, vUv.y) * (1.0 - 0.45 * vUv.y);
  float shimmer = 0.9 + 0.1 * sin(uTime * 0.6 + vUv.x * 7.0 + vUv.y * 3.0);
  float a = across * along * uIntensity * shimmer;
  gl_FragColor = vec4(uColor * a, 1.0);
  #include <fog_fragment>
}
`;

const PATCH_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uIntensity;
varying vec2 vUv;
#include <fog_pars_fragment>
void main() {
  vec2 e = min(vUv, 1.0 - vUv);
  float edge = smoothstep(0.0, 0.08, e.x) * smoothstep(0.0, 0.1, e.y);
  // Window mullions: a cross splitting the patch into four panes.
  vec2 m = abs(vUv - 0.5);
  float mull = smoothstep(0.012, 0.03, m.x) * smoothstep(0.012, 0.03, m.y);
  float a = edge * mull * uIntensity;
  gl_FragColor = vec4(uColor * a, 1.0);
  #include <fog_fragment>
}
`;

const MOTE_VERT = /* glsl */ `
uniform float uTime;
uniform float uScale;
attribute vec4 aSeed;
varying float vAlpha;
void main() {
  vec3 p = position + vec3(sin(uTime * 0.21 + aSeed.x * 30.0), sin(uTime * 0.17 + aSeed.y * 30.0), cos(uTime * 0.19 + aSeed.z * 30.0)) * 3.0;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = max(1.5, (0.18 + aSeed.w * 0.25) * uScale / max(0.001, -mv.z));
  vAlpha = 0.45 + 0.55 * sin(uTime * (0.8 + aSeed.w * 1.5) + aSeed.x * 50.0);
}
`;

const MOTE_FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.0, d) * max(0.0, vAlpha) * 0.8;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor * a, 1.0);
}
`;

function additive(fragmentShader: string, intensity: number, fog = true): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: UniformsUtils.merge([UniformsLib.fog, { uColor: { value: COLOR }, uIntensity: { value: intensity }, uTime: { value: 0 }, uScale: { value: 600 } }]),
    vertexShader: SHAFT_VERT,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    fog,
  });
}

interface Window {
  /** Window centre on the wall plane, at floor level. */
  x: number;
  z: number;
  /** Unit vector along the window width (in the wall plane). */
  ux: number;
  uz: number;
  width: number;
  bottom: number;
  top: number;
}

export class Sunbeams {
  readonly root = new Group();
  private readonly shaftMat = additive(SHAFT_FRAG, 0.11);
  private readonly patchMat = additive(PATCH_FRAG, 0.32);
  private readonly moteMat: ShaderMaterial;
  private time = 0;

  constructor(layout: HouseLayout, moteCount = 40) {
    this.root.name = 'fx:sunbeams';
    const b = layout.bounds;
    const rng = new Rng(layout.seed + 77);
    const windows: Window[] = [];
    for (const room of layout.rooms) {
      const r = room.rect;
      const west = r.minX - b.minX < 15;
      const south = b.maxZ - r.maxZ < 15;
      if (!west && !south) continue;
      if (west && (!south || rng.chance(0.5))) {
        const width = Math.min(110, (r.maxZ - r.minZ) * 0.45);
        windows.push({ x: r.minX, z: rng.range(r.minZ + width, r.maxZ - width * 0.6), ux: 0, uz: 1, width, bottom: 95, top: 190 });
      } else {
        const width = Math.min(110, (r.maxX - r.minX) * 0.45);
        windows.push({ x: rng.range(r.minX + width * 0.6, r.maxX - width), z: r.maxZ, ux: 1, uz: 0, width, bottom: 95, top: 190 });
      }
    }

    const shaft = { pos: [] as number[], uv: [] as number[], idx: [] as number[] };
    const patch = { pos: [] as number[], uv: [] as number[], idx: [] as number[] };
    const motePos: number[] = [];
    const moteSeed: number[] = [];
    const t = SUN_TRAVEL;
    const toFloor = (x: number, y: number, z: number) => {
      const k = -y / t.y;
      return [x + t.x * k, 0.25, z + t.z * k] as const;
    };
    const quad = (buf: typeof shaft, pts: ReadonlyArray<readonly [number, number, number]>, uvs: ReadonlyArray<readonly [number, number]>) => {
      const base = buf.pos.length / 3;
      for (const p of pts) buf.pos.push(...p);
      for (const u of uvs) buf.uv.push(...u);
      buf.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };
    for (const w of windows) {
      const hw = w.width / 2;
      const ax = w.x - w.ux * hw;
      const az = w.z - w.uz * hw;
      const bx = w.x + w.ux * hw;
      const bz = w.z + w.uz * hw;
      // Window corners (A/B along the width, bottom/top) and their floor projections.
      const Ab = [ax, w.bottom, az] as const;
      const At = [ax, w.top, az] as const;
      const Bb = [bx, w.bottom, bz] as const;
      const Bt = [bx, w.top, bz] as const;
      const fAb = toFloor(...Ab);
      const fAt = toFloor(...At);
      const fBb = toFloor(...Bb);
      const fBt = toFloor(...Bt);
      // Floor patch: u across the width, v from the near (bottom) edge to the far (top) edge.
      quad(patch, [fAb, fAt, fBt, fBb], [[0, 0], [0, 1], [1, 1], [1, 0]]);
      // Shaft: top and bottom sheets plus the two sides (uv.x across, uv.y along the light).
      quad(shaft, [At, fAt, fBt, Bt], [[0, 0], [0, 1], [1, 1], [1, 0]]);
      quad(shaft, [Ab, fAb, fBb, Bb], [[0, 0], [0, 1], [1, 1], [1, 0]]);
      quad(shaft, [Ab, fAb, fAt, At], [[0.5, 0], [0.5, 1], [0.5, 1], [0.5, 0]]);
      quad(shaft, [Bb, fBb, fBt, Bt], [[0.5, 0], [0.5, 1], [0.5, 1], [0.5, 0]]);
      // Motes inside the shaft volume.
      for (let i = 0; i < moteCount; i++) {
        const s = rng.next();
        const h = rng.range(0.15, 1);
        const y = w.bottom + rng.next() * (w.top - w.bottom);
        const wx = ax + (bx - ax) * s;
        const wz = az + (bz - az) * s;
        const k = (-y / t.y) * h;
        motePos.push(wx + t.x * k, y + t.y * k, wz + t.z * k);
        moteSeed.push(rng.next(), rng.next(), rng.next(), rng.next());
      }
    }

    const mk = (buf: typeof shaft, mat: ShaderMaterial, name: string) => {
      const g = new BufferGeometry();
      g.setAttribute('position', new Float32BufferAttribute(buf.pos, 3));
      g.setAttribute('aUv', new Float32BufferAttribute(buf.uv, 2));
      g.setIndex(buf.idx);
      const m = new Mesh(g, mat);
      m.name = name;
      m.frustumCulled = false;
      m.renderOrder = 4;
      this.root.add(m);
    };
    if (windows.length > 0) {
      mk(patch, this.patchMat, 'sunPatches');
      mk(shaft, this.shaftMat, 'sunShafts');
    }

    this.moteMat = new ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uScale: { value: 600 }, uColor: { value: new Color('#fff0d0') } },
      vertexShader: MOTE_VERT,
      fragmentShader: MOTE_FRAG,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    if (motePos.length > 0) {
      const g = new BufferGeometry();
      g.setAttribute('position', new Float32BufferAttribute(motePos, 3));
      g.setAttribute('aSeed', new BufferAttribute(new Float32Array(moteSeed), 4));
      const pts = new Points(g, this.moteMat);
      pts.name = 'sunMotes';
      pts.frustumCulled = false;
      pts.renderOrder = 5;
      this.root.add(pts);
    }
  }

  update(dt: number, viewportHeight: number, fovDeg: number): void {
    this.time += dt;
    this.shaftMat.uniforms.uTime!.value = this.time;
    this.moteMat.uniforms.uTime!.value = this.time;
    this.moteMat.uniforms.uScale!.value = viewportHeight / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  dispose(): void {
    this.root.traverse((o) => (o as Mesh).geometry?.dispose());
    this.shaftMat.dispose();
    this.patchMat.dispose();
    this.moteMat.dispose();
    this.root.removeFromParent();
  }
}
