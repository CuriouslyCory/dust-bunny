/**
 * The Solar System's floor (browser only). `buildSolarSurface` paints the ecliptic as one plane
 * covering the map and `MARGIN` units round it (the zone floors are not drawn under it): deep
 * space with faint nebulae, the Milky Way as a dust-lane band across the whole backdrop (a milky
 * glow split by a dark, ragged lane of dust), the Sun's corona and the zodiacal light round the
 * centre, the asteroid belt as a gritty brown ring (with two Kirkwood gaps; `buildBeltGravel` strews
 * thousands of tiny rocks over it, scenery only, one instanced draw call), the icy haze of the Kuiper belt and the heliopause, a faint line along the map's edge
 * and the interstellar dark past it. A tiled starfield (`STAR_TILE` units) is added in the shader
 * so space stays crisp close up (denser where the painting is brighter: the Milky Way). The painting is mostly emissive (space is not lit by the Sun) but
 * still takes the Sun's light and shadows; `setDim` fades it (the light going out).
 *
 * `buildOrbitLanes` draws the orbit rings (`layout.routes` kind 'orbit') as faint lanes: a hairline
 * a pixel or two wide at any zoom (screen-space derivatives) inside a soft band the lane's width;
 * Earth's empty orbit is dashed, Jupiter's warmer. Also the tileable floor textures for the Solar
 * System's zone floor ids (`solarSpace` …), used for the ground past the painting.
 * Canvas +x is world +x (east) and canvas +y is world +z (south).
 */
import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  Color,
  Euler,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  Vector3,
  type Texture,
} from 'three';
import { Rng } from '../core/rng';
import { canvas, fbm, paint, repeatTexture, smooth, tileNoise } from './globeTextures';
import { SOLAR, sunCentre } from './solarSystem';
import type { HouseLayout } from './types';

// ── Tileable floor textures (zone floor ids; the ground past the painting) ──────────────

/** Dark space with `n` specks of dust or starlight over a faint nebula tint. */
function speckField(seed: string, base: readonly [number, number, number], tint: readonly [number, number, number], speck: string, n: number): HTMLCanvasElement {
  const S = 256;
  const [c, ctx] = canvas(S);
  const rng = new Rng(seed);
  const neb = fbm(rng, [[3, 1], [9, 0.5]]);
  paint(ctx, S, S, (x, y, o) => {
    const t = neb(x / S, y / S) ** 2;
    o[0] = base[0] + tint[0] * t;
    o[1] = base[1] + tint[1] * t;
    o[2] = base[2] + tint[2] * t;
  });
  ctx.fillStyle = speck;
  for (let i = 0; i < n; i++) {
    ctx.globalAlpha = rng.range(0.15, 0.85);
    const r = rng.range(0.4, 1.3);
    ctx.beginPath();
    ctx.arc(rng.range(0, S), rng.range(0, S), r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  return c;
}

export const solarSpaceTexture = () => speckField('solar-space', [4, 5, 11], [16, 10, 26], '#c9d4ff', 160);
export const solarCoronaTexture = () => speckField('solar-corona', [42, 16, 6], [70, 36, 8], '#ffd27a', 220);
export const solarBeltTexture = () => speckField('solar-belt', [14, 11, 9], [22, 16, 10], '#a8957e', 900);
export const solarKuiperTexture = () => speckField('solar-kuiper', [5, 8, 14], [8, 18, 30], '#bfe3ff', 420);

// ── The painted ecliptic ──────────────

/** Painting margin round the map (units), its texture size (px) and the tiled starfield's size (units). */
const MARGIN = 120;
const TEX = 1536;
const STAR_TILE = 24;

/** Tileable starfield: a few bright stars, many faint, a little colour. */
function starTile(): Texture {
  const S = 512;
  const [c, ctx] = canvas(S);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, S, S);
  const rng = new Rng('solar-stars');
  for (let i = 0; i < 420; i++) {
    const b = rng.next();
    const r = b > 0.97 ? 1.7 : b > 0.85 ? 1.1 : 0.7;
    const a = 0.25 + b * b * 0.75;
    const tint = rng.next();
    ctx.fillStyle = tint > 0.86 ? `rgba(255,214,170,${a})` : tint > 0.7 ? `rgba(180,206,255,${a})` : `rgba(255,255,255,${a})`;
    const x = rng.range(0, S);
    const y = rng.range(0, S);
    // Wrap the edges so the tile repeats seamlessly.
    for (const dx of [-S, 0, S]) {
      for (const dy of [-S, 0, S]) {
        ctx.beginPath();
        ctx.arc(x + dx, y + dy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  return repeatTexture(c);
}

export interface SolarSurfaceView {
  object: Group;
  /** 1 = lit, 0 = the light has gone out (the painting and the lanes fade to near black). */
  setDim(lit: number): void;
  dispose(): void;
}

export function buildSolarSurface(layout: HouseLayout): SolarSurfaceView {
  const b = layout.bounds;
  const sun = sunCentre(layout);
  const E = b.maxX - b.minX + 2 * MARGIN;
  const x0 = b.minX - MARGIN;
  const z0 = b.minZ - MARGIN;
  const px = E / TEX;
  const rng = new Rng(layout.seed).fork('solar:paint');
  const neb = fbm(rng.fork('neb'), [[3, 1], [7, 0.6], [17, 0.3]]);
  const neb2 = fbm(rng.fork('neb2'), [[4, 1], [11, 0.5]]);
  const lane = fbm(rng.fork('lane'), [[5, 1], [13, 0.6], [31, 0.35]]);
  const lane2 = fbm(rng.fork('lane2'), [[9, 1], [27, 0.5]]);
  const grit = tileNoise(rng.fork('grit'), 420);
  const clumps = fbm(rng.fork('clumps'), [[40, 1], [90, 0.6]]);
  const ice = fbm(rng.fork('ice'), [[24, 1], [60, 0.5]]);
  // The Milky Way: a band across the backdrop at a seeded angle, off the Sun.
  const ang = rng.range(0.35, 0.75) * (rng.next() < 0.5 ? -1 : 1);
  const nx = -Math.sin(ang);
  const nz = Math.cos(ang);
  const off = rng.range(-50, 50);
  const halfW = 62;
  const beltMid = (SOLAR.innerOrbits + SOLAR.belt) / 2;
  const beltHalf = (SOLAR.belt - SOLAR.innerOrbits) / 2;
  const kuiper = SOLAR.outerOrbits;
  const helio = Math.min(b.maxX - b.minX, b.maxZ - b.minZ) / 2;

  const [colorCanvas, ctx] = canvas(TEX);
  paint(ctx, TEX, TEX, (ix, iy, o) => {
    const x = x0 + (ix + 0.5) * px;
    const z = z0 + (iy + 0.5) * px;
    const u = (ix + 0.5) / TEX;
    const v = (iy + 0.5) / TEX;
    const d = Math.hypot(x - sun.x, z - sun.z);
    // Deep space and faint nebulae.
    const n1 = neb(u, v) ** 2;
    const n2 = neb2(u, v) ** 2;
    let r = 4 + 20 * n1 + 4 * n2;
    let g = 5 + 9 * n1 + 14 * n2;
    let bl = 11 + 32 * n1 + 20 * n2;
    // The Milky Way and its dust lane.
    const w = ((x - sun.x) * nx + (z - sun.z) * nz - off) / halfW;
    const glow = Math.exp(-w * w * 1.7) * (0.45 + 0.75 * neb2(u * 2, v * 2));
    const core = Math.exp(-w * w * 7);
    const lw = w - (lane(u, v) - 0.5) * 0.7;
    const dust = Math.exp(-lw * lw * 22) * smooth(0.3, 0.7, lane2(u, v)) + Math.exp(-((lw + 0.35) ** 2) * 60) * 0.5 * smooth(0.45, 0.8, lane(u * 1.7, v));
    const keep = 1 - 0.88 * Math.min(1, dust);
    r += (30 * glow + 16 * core) * keep + 7 * dust * glow;
    g += (28 * glow + 13 * core) * keep + 4 * dust * glow;
    bl += (40 * glow + 10 * core) * keep + 2 * dust * glow;
    // The corona and the zodiacal light.
    const c1 = Math.exp(-d / 5);
    const c2 = Math.exp(-d / 26);
    r += 255 * c1 + 52 * c2;
    g += 150 * c1 + 30 * c2;
    bl += 50 * c1 + 12 * c2;
    // The asteroid belt: gritty brown dust thinning to its edges, two Kirkwood gaps.
    const bt = Math.max(0, 1 - Math.abs(d - beltMid) / (beltHalf + 3));
    if (bt > 0) {
      const gap = 1 - 0.7 * Math.exp(-(((d - (beltMid - 4)) / 0.9) ** 2)) - 0.7 * Math.exp(-(((d - (beltMid + 5)) / 0.9) ** 2));
      const k = smooth(0, 0.55, bt) * gap * (0.35 + 0.65 * clumps(u, v)) * (0.5 + 0.9 * grit(u, v));
      r += 44 * k;
      g += 34 * k;
      bl += 24 * k;
    }
    // The Kuiper belt's icy haze, and the heliopause.
    const kt = smooth(kuiper - 12, kuiper + 8, d) * (1 - smooth(helio + 4, helio + 40, d));
    const kk = kt * (0.3 + 0.9 * ice(u, v));
    r += 8 * kk;
    g += 18 * kk;
    bl += 30 * kk;
    const hp = Math.exp(-(((d - helio) / 2.5) ** 2));
    r += 8 * hp;
    g += 22 * hp;
    bl += 34 * hp;
    // The map's edge: a faint line, interstellar dark past it.
    const ex = Math.max(b.minX - x, x - b.maxX, 0);
    const ez = Math.max(b.minZ - z, z - b.maxZ, 0);
    const outside = Math.hypot(ex, ez);
    const toEdge = outside > 0 ? outside : Math.min(x - b.minX, b.maxX - x, z - b.minZ, b.maxZ - z);
    const line = Math.exp(-((toEdge / 0.5) ** 2));
    if (outside > 0) {
      const dim = 0.35 + 0.35 * Math.exp(-outside / 30);
      r *= dim;
      g *= dim;
      bl *= dim;
    }
    o[0] = Math.min(255, r + 26 * line);
    o[1] = Math.min(255, g + 52 * line);
    o[2] = Math.min(255, bl + 72 * line);
  });

  const map = new CanvasTexture(colorCanvas);
  map.colorSpace = SRGBColorSpace;
  map.anisotropy = 8;
  const stars = starTile();
  const starRepeat = E / STAR_TILE;
  const emissive = { value: 0.8 };
  const starStrength = { value: 0.9 };
  const mat = new MeshStandardMaterial({ map, color: '#5a5a5a', emissiveMap: map, emissive: '#ffffff', emissiveIntensity: emissive.value, roughness: 1, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.starMap = { value: stars };
    shader.uniforms.starRepeat = { value: starRepeat };
    shader.uniforms.starStrength = starStrength;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D starMap;\nuniform float starRepeat;\nuniform float starStrength;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += texture2D(starMap, vMapUv * starRepeat).rgb * starStrength * (0.55 + 6.0 * dot(texture2D(emissiveMap, vMapUv).rgb, vec3(0.3, 0.5, 0.2)));');
  };
  mat.customProgramCacheKey = () => 'solar-surface';
  const plane = new Mesh(new PlaneGeometry(E, E), mat);
  plane.rotation.x = -Math.PI / 2;
  plane.position.set(x0 + E / 2, 0.01, z0 + E / 2);
  plane.receiveShadow = true;
  plane.name = 'solarSurface';

  const lanes = buildOrbitLanes(layout);
  const gravel = buildBeltGravel(layout);
  const object = new Group();
  object.name = 'solarSystem';
  object.add(plane, lanes.mesh, gravel);
  return {
    object,
    setDim(lit) {
      mat.emissiveIntensity = 0.04 + (emissive.value - 0.04) * lit;
      starStrength.value = 0.25 + 0.65 * lit;
      lanes.uniforms.uOpacity.value = lit;
    },
    dispose() {
      map.dispose();
      stars.dispose();
      mat.dispose();
      plane.geometry.dispose();
      lanes.mesh.geometry.dispose();
      gravel.geometry.dispose();
      (gravel.material as MeshStandardMaterial).dispose();
      (lanes.mesh.material as ShaderMaterial).dispose();
    },
  };
}

/** Belt gravel: tiny lumpy rocks strewn over the asteroid belt (not Debris: scenery, one draw call). */
const GRAVEL = { count: 9000, size: [0.04, 0.24] as const };

export function buildBeltGravel(layout: HouseLayout): InstancedMesh {
  const sun = sunCentre(layout);
  const rng = new Rng(layout.seed).fork('solar:gravel');
  const geo = new IcosahedronGeometry(1, 0);
  const pos = geo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) pos.setXYZ(i, pos.getX(i) * rng.range(0.75, 1.2), pos.getY(i) * rng.range(0.55, 0.9), pos.getZ(i) * rng.range(0.75, 1.2));
  geo.computeVertexNormals();
  const mat = new MeshStandardMaterial({ color: '#ffffff', roughness: 1, flatShading: true });
  const mesh = new InstancedMesh(geo, mat, GRAVEL.count);
  const m = new Matrix4();
  const q = new Quaternion();
  const e = new Euler();
  const p = new Vector3();
  const sc = new Vector3();
  const c = new Color();
  const mid = (SOLAR.innerOrbits + SOLAR.belt) / 2;
  const half = (SOLAR.belt - SOLAR.innerOrbits) / 2 + 2;
  for (let i = 0; i < GRAVEL.count; i++) {
    const a = rng.range(-Math.PI, Math.PI);
    const d = mid + (rng.next() + rng.next() - 1) * half;
    const s = GRAVEL.size[0] + (GRAVEL.size[1] - GRAVEL.size[0]) * rng.next() ** 2.5;
    p.set(sun.x + Math.cos(a) * d, s * 0.5, sun.z + Math.sin(a) * d);
    q.setFromEuler(e.set(rng.range(0, 6.3), rng.range(0, 6.3), rng.range(0, 6.3)));
    sc.setScalar(s);
    mesh.setMatrixAt(i, m.compose(p, q, sc));
    const v = rng.range(0.32, 0.62);
    mesh.setColorAt(i, c.setRGB(v * 1.05, v * 0.93, v * 0.8));
  }
  mesh.computeBoundingSphere();
  mesh.receiveShadow = true;
  mesh.name = 'beltGravel';
  return mesh;
}

const LANE_VERT = /* glsl */ `
attribute float aAcross;
attribute float aAngle;
attribute float aDash;
attribute float aHalf;
attribute vec3 aColor;
varying float vAcross;
varying float vAngle;
varying float vDash;
varying float vHalf;
varying vec3 vColor;
#include <fog_pars_vertex>
void main() {
  vAcross = aAcross;
  vAngle = aAngle;
  vDash = aDash;
  vHalf = aHalf;
  vColor = aColor;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const LANE_FRAG = /* glsl */ `
uniform float uOpacity;
varying float vAcross;
varying float vAngle;
varying float vDash;
varying float vHalf;
varying vec3 vColor;
#include <fog_pars_fragment>
void main() {
  float d = abs(vAcross) * vHalf;
  float fw = max(fwidth(d), 1e-4);
  float w = max(fw * 0.7, 0.025);
  float line = 1.0 - smoothstep(w, w + fw * 1.4, d);
  float band = pow(1.0 - abs(vAcross), 2.0);
  float dash = mix(1.0, step(0.45, fract(vAngle * 160.0)), vDash);
  float a = (line * 0.42 * dash + band * 0.05) * uOpacity;
  gl_FragColor = vec4(vColor, a);
  #include <fog_fragment>
}`;

/** The orbit rings as faint lanes (one mesh, one draw call). */
export function buildOrbitLanes(layout: HouseLayout): { mesh: Mesh; uniforms: { uOpacity: { value: number } } } {
  const sun = sunCentre(layout);
  const pos: number[] = [];
  const across: number[] = [];
  const angle: number[] = [];
  const dash: number[] = [];
  const half: number[] = [];
  const color: number[] = [];
  const index: number[] = [];
  const c = new Color();
  const SEG = 360;
  for (const route of layout.routes ?? []) {
    if (route.kind !== 'orbit') continue;
    const p0 = route.points[0]!;
    const radius = Math.hypot(p0.x - sun.x, p0.z - sun.z);
    const hw = route.width / 2;
    const earth = Math.abs(radius - SOLAR.earthOrbit) < 0.5;
    const jupiter = Math.abs(radius - SOLAR.jupiterOrbit) < 0.5;
    c.set(jupiter ? '#ffcf96' : earth ? '#9fd4ff' : '#c8d2ff').convertSRGBToLinear();
    const base = pos.length / 3;
    for (let k = 0; k <= SEG; k++) {
      const a = (k / SEG) * Math.PI * 2;
      for (const s of [-1, 1]) {
        const rr = radius + s * hw;
        pos.push(sun.x + Math.cos(a) * rr, 0.03, sun.z + Math.sin(a) * rr);
        across.push(s);
        angle.push(k / SEG);
        dash.push(earth ? 1 : 0);
        half.push(hw);
        color.push(c.r, c.g, c.b);
      }
      if (k < SEG) {
        const i = base + k * 2;
        index.push(i, i + 2, i + 1, i + 1, i + 2, i + 3);
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('aAcross', new Float32BufferAttribute(across, 1));
  g.setAttribute('aAngle', new Float32BufferAttribute(angle, 1));
  g.setAttribute('aDash', new Float32BufferAttribute(dash, 1));
  g.setAttribute('aHalf', new Float32BufferAttribute(half, 1));
  g.setAttribute('aColor', new Float32BufferAttribute(color, 3));
  g.setIndex(index);
  g.computeBoundingSphere();
  const uniforms = UniformsUtils.merge([UniformsLib.fog, { uOpacity: { value: 1 } }]) as { uOpacity: { value: number } };
  const mat = new ShaderMaterial({
    uniforms,
    vertexShader: LANE_VERT,
    fragmentShader: LANE_FRAG,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    fog: true,
  });
  const mesh = new Mesh(g, mat);
  mesh.renderOrder = 1;
  mesh.name = 'orbitLanes';
  return { mesh, uniforms };
}
