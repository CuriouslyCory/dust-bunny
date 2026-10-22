/**
 * The Universe's floor (browser only). `buildUniverseSurface` paints the cosmic web as one plane
 * covering the map and `MARGIN` units round it (the zone floors are not drawn under it), seen from
 * outside: near-black voids with a faint violet haze, the sheets as a dim blue mist round the
 * filaments, the filaments (the same web as the zones, `universeWeb`, wobbled with noise so they
 * are not ruler-straight) in bright blue-white, clumped into knots of galaxies, and the nodes as
 * warm gold cores in a violet-pink halo of hot gas. The web runs on past the map's edge (the void
 * centres are thrown `voidReach` past it), dimmer, with a faint line along the edge. A tiled field
 * of tiny galaxies (`GALAXY_TILE` units) is added in the shader so the floor stays crisp close up,
 * thick on the filaments and nearly gone in the voids. The painting is mostly emissive (the web is
 * its own light) but still takes the light and shadows. The instanced galaxies over it (and the
 * deep field under it) are src/fx/universe.ts. Canvas +x is world +x (east) and canvas +y is world
 * +z (south).
 */
import { CanvasTexture, Group, Mesh, MeshStandardMaterial, PlaneGeometry, SRGBColorSpace, type Texture } from 'three';
import { Rng } from '../core/rng';
import { canvas, fbm, paint, repeatTexture, smooth } from './globeTextures';
import type { HouseLayout } from './types';
import { universeWeb } from './universe';

/** Painting margin round the map (units), its texture size (px) and the tiled galaxy field's size (units). */
const MARGIN = 120;
const TEX = 2048;
const GALAXY_TILE = 14;

/** Tileable field of tiny galaxies: little smudges and discs at random tilts, blue-white, some warm. */
function galaxyTile(): Texture {
  const S = 512;
  const [c, ctx] = canvas(S);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, S, S);
  const rng = new Rng('universe-galaxies');
  for (let i = 0; i < 420; i++) {
    const b = rng.next();
    const r = b > 0.96 ? 3.2 : b > 0.8 ? 1.9 : 1.1;
    const a = 0.2 + b * b * 0.8;
    const tint = rng.next();
    const col = tint > 0.8 ? [255, 214, 170] : tint > 0.45 ? [170, 196, 255] : [236, 240, 255];
    const x = rng.range(0, S);
    const y = rng.range(0, S);
    const rot = rng.range(0, Math.PI);
    const flat = rng.range(0.3, 1);
    for (const dx of [-S, 0, S]) {
      for (const dy of [-S, 0, S]) {
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 1.8);
        g.addColorStop(0, `rgba(${col[0]},${col[1]},${col[2]},${a})`);
        g.addColorStop(0.35, `rgba(${col[0]},${col[1]},${col[2]},${a * 0.45})`);
        g.addColorStop(1, `rgba(${col[0]},${col[1]},${col[2]},0)`);
        ctx.save();
        ctx.translate(x + dx, y + dy);
        ctx.rotate(rot);
        ctx.scale(1, flat);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, r * 1.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
  }
  return repeatTexture(c);
}

export interface UniverseSurfaceView {
  object: Group;
  dispose(): void;
}

/**
 * The web's light per pixel of a `size`² grid over [x0, x0 + E]² (row-major, +z down): `fil`
 * (filament cores, 0..1), `sheet` (the wider mist round them) and `node` (supercluster cores).
 * Stamped per filament and node over their bounding boxes only.
 */
function webFields(layout: HouseLayout, x0: number, z0: number, E: number, size: number): { fil: Float32Array; sheet: Float32Array; node: Float32Array } {
  const web = universeWeb(layout.seed);
  const px = E / size;
  const fil = new Float32Array(size * size);
  const sheet = new Float32Array(size * size);
  const node = new Float32Array(size * size);
  const toPx = (v: number, o: number) => Math.floor((v - o) / px);
  for (const l of web.links) {
    const a = web.nodes[l.a]!;
    const b = web.nodes[l.b]!;
    const reach = l.w * 2 + 16;
    const ix0 = Math.max(0, toPx(Math.min(a.x, b.x) - reach, x0));
    const ix1 = Math.min(size - 1, toPx(Math.max(a.x, b.x) + reach, x0));
    const iz0 = Math.max(0, toPx(Math.min(a.z, b.z) - reach, z0));
    const iz1 = Math.min(size - 1, toPx(Math.max(a.z, b.z) + reach, z0));
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len2 = dx * dx + dz * dz || 1;
    const core = l.w * 0.55;
    const mist = l.w + 7;
    const bright = 0.55 + 0.45 * l.strength;
    for (let iz = iz0; iz <= iz1; iz++) {
      const z = z0 + (iz + 0.5) * px;
      for (let ix = ix0; ix <= ix1; ix++) {
        const x = x0 + (ix + 0.5) * px;
        const t = Math.min(1, Math.max(0, ((x - a.x) * dx + (z - a.z) * dz) / len2));
        const d = Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t));
        const i = iz * size + ix;
        const f = Math.exp(-((d / core) ** 2)) * bright;
        if (f > fil[i]!) fil[i] = f;
        const s = Math.exp(-((d / mist) ** 2)) * (0.6 + 0.4 * l.strength);
        if (s > sheet[i]!) sheet[i] = s;
      }
    }
  }
  for (const n of web.nodes) {
    const reach = n.r * 3;
    const ix0 = Math.max(0, toPx(n.x - reach, x0));
    const ix1 = Math.min(size - 1, toPx(n.x + reach, x0));
    const iz0 = Math.max(0, toPx(n.z - reach, z0));
    const iz1 = Math.min(size - 1, toPx(n.z + reach, z0));
    for (let iz = iz0; iz <= iz1; iz++) {
      const z = z0 + (iz + 0.5) * px;
      for (let ix = ix0; ix <= ix1; ix++) {
        const x = x0 + (ix + 0.5) * px;
        const d = Math.hypot(x - n.x, z - n.z);
        const i = iz * size + ix;
        const v = Math.exp(-((d / (n.r * 0.75)) ** 2)) * (0.5 + 0.5 * n.mass);
        if (v > node[i]!) node[i] = v;
      }
    }
  }
  return { fil, sheet, node };
}

export function buildUniverseSurface(layout: HouseLayout): UniverseSurfaceView {
  const b = layout.bounds;
  const E = b.maxX - b.minX + 2 * MARGIN;
  const x0 = b.minX - MARGIN;
  const z0 = b.minZ - MARGIN;
  const px = E / TEX;
  const rng = new Rng(layout.seed).fork('universe:paint');
  const haze = fbm(rng.fork('haze'), [[3, 1], [7, 0.6], [17, 0.3]]);
  const haze2 = fbm(rng.fork('haze2'), [[5, 1], [13, 0.5]]);
  const warpX = fbm(rng.fork('warpX'), [[24, 1], [60, 0.45]]);
  const warpZ = fbm(rng.fork('warpZ'), [[24, 1], [60, 0.45]]);
  const clumps = fbm(rng.fork('clumps'), [[90, 1], [200, 0.6]]);
  const knots = fbm(rng.fork('knots'), [[260, 1], [520, 0.5]]);
  // Fields at half resolution (bilinear below), wobbled by sampling a little off each pixel.
  const F = TEX / 2;
  const fields = webFields(layout, x0, z0, E, F);
  const sample = (arr: Float32Array, fx: number, fz: number) => {
    const x = Math.min(F - 1.001, Math.max(0, fx));
    const z = Math.min(F - 1.001, Math.max(0, fz));
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    const tx = x - ix;
    const tz = z - iz;
    const i = iz * F + ix;
    const a = arr[i]! + (arr[i + 1]! - arr[i]!) * tx;
    const c = arr[i + F]! + (arr[i + F + 1]! - arr[i + F]!) * tx;
    return a + (c - a) * tz;
  };
  const wobble = 2.6 / (E / F); // units → field px

  const [colorCanvas, ctx] = canvas(TEX);
  paint(ctx, TEX, TEX, (ix, iy, o) => {
    const x = x0 + (ix + 0.5) * px;
    const z = z0 + (iy + 0.5) * px;
    const u = (ix + 0.5) / TEX;
    const v = (iy + 0.5) / TEX;
    const fx = (ix + 0.5) / 2 - 0.5 + (warpX(u, v) - 0.5) * 2 * wobble;
    const fz = (iy + 0.5) / 2 - 0.5 + (warpZ(u, v) - 0.5) * 2 * wobble;
    const fil = sample(fields.fil, fx, fz);
    const sheet = sample(fields.sheet, fx, fz);
    const node = sample(fields.node, (ix + 0.5) / 2 - 0.5, (iy + 0.5) / 2 - 0.5);
    // The voids: near black, a faint violet-blue haze.
    const h1 = haze(u, v) ** 2;
    const h2 = haze2(u, v) ** 2;
    let r = 2 + 9 * h1 + 3 * h2;
    let g = 2 + 4 * h1 + 5 * h2;
    let bl = 6 + 16 * h1 + 12 * h2;
    // The sheets: a dim blue mist round the filaments.
    const mist = sheet * (0.6 + 0.6 * clumps(u, v));
    r += 16 * mist;
    g += 24 * mist;
    bl += 54 * mist;
    // The filaments: blue-white, clumped into knots of galaxies.
    const cl = 0.35 + 1.0 * smooth(0.3, 0.8, clumps(u, v));
    const f = fil * cl;
    r += 70 * f;
    g += 108 * f;
    bl += 190 * f;
    const kn = smooth(0.62, 0.82, knots(u, v)) * fil * fil;
    r += 150 * kn;
    g += 150 * kn;
    bl += 170 * kn;
    // The nodes: warm gold cores in a violet-pink halo of hot gas.
    const halo = Math.sqrt(node);
    r += 70 * halo + 255 * node * node;
    g += 22 * halo + 200 * node * node;
    bl += 70 * halo + 120 * node * node;
    // The map's edge: a faint line, the web dimmer past it.
    const ex = Math.max(b.minX - x, x - b.maxX, 0);
    const ez = Math.max(b.minZ - z, z - b.maxZ, 0);
    const out = Math.hypot(ex, ez);
    const toEdge = out > 0 ? out : Math.min(x - b.minX, b.maxX - x, z - b.minZ, b.maxZ - z);
    const line = Math.exp(-((toEdge / 0.5) ** 2));
    if (out > 0) {
      const dim = 0.35 + 0.35 * Math.exp(-out / 30);
      r *= dim;
      g *= dim;
      bl *= dim;
    }
    o[0] = Math.min(255, r + 40 * line);
    o[1] = Math.min(255, g + 24 * line);
    o[2] = Math.min(255, bl + 16 * line);
  });

  const map = new CanvasTexture(colorCanvas);
  map.colorSpace = SRGBColorSpace;
  map.anisotropy = 8;
  const galaxies = galaxyTile();
  const mat = new MeshStandardMaterial({ map, color: '#4a4a4a', emissiveMap: map, emissive: '#ffffff', emissiveIntensity: 0.9, roughness: 1, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.galaxyMap = { value: galaxies };
    shader.uniforms.galaxyRepeat = { value: E / GALAXY_TILE };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D galaxyMap;\nuniform float galaxyRepeat;')
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance += texture2D(galaxyMap, vMapUv * galaxyRepeat).rgb * (0.08 + 6.0 * dot(texture2D(emissiveMap, vMapUv).rgb, vec3(0.3, 0.5, 0.2)));',
      );
  };
  mat.customProgramCacheKey = () => 'universe-surface';
  const plane = new Mesh(new PlaneGeometry(E, E), mat);
  plane.rotation.x = -Math.PI / 2;
  plane.position.set(x0 + E / 2, 0.01, z0 + E / 2);
  plane.receiveShadow = true;
  // Drawn first: the deep field (src/fx/universe.ts) goes over it, everything else after.
  plane.renderOrder = -2;
  plane.name = 'universeSurface';

  const object = new Group();
  object.name = 'universe';
  object.add(plane);
  return {
    object,
    dispose() {
      map.dispose();
      galaxies.dispose();
      mat.dispose();
      plane.geometry.dispose();
    },
  };
}
