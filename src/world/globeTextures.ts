/**
 * The Globe seen from orbit (browser only). `buildGlobeSurface` paints the whole map as one plane
 * (the zone floors are not drawn under it): oceans that deepen away from the coasts with surf and
 * turquoise shallows, land coloured by latitude (rainforest, savanna, desert belts, temperate green,
 * boreal forest, tundra) with drier interiors, mountain belts with snow, beaches, and the polar ice
 * fraying into floes at its edge. Coastlines come from a signed distance field of
 * `globeSurface(seed, 2)` (globe.ts), blurred and wobbled by noise so the grid never shows.
 *
 * Seamless wrap-around: the plane covers exactly one lap (x 0 → width) and HouseView draws it at
 * the neighbouring laps too, so the painting's left and right edges must match. Every distance
 * field is computed on a grid padded with the opposite edge, every noise is periodic in x, and the
 * tiled detail (ocean ripples as a normal map, land grain, clouds) repeats a whole number of times
 * per lap (tile sizes divide 480).
 *
 * Materials: a roughness map (G: water 0.2, ice 0.5, land 1, so the hard sun glints off the
 * oceans) whose R channel also marks land for the shader (ripples only on water, grain only on
 * land). A cloud layer drifts east a little above the floor (`update`). Also the tileable floor
 * textures for the Globe's zone floor ids (`globeOcean` …), used past the poles.
 * Canvas +x is world +x (east) and canvas +y is world +z (south).
 */
import {
  CanvasTexture,
  Group,
  LinearSRGBColorSpace,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  RepeatWrapping,
  SRGBColorSpace,
  Vector2,
  type Texture,
} from 'three';
import { Rng } from '../core/rng';
import { GLOBE, RANGES, SHAPES, SURFACE, distanceTo, globeSurface, latToZ, lonToX, periodicNoise, zToLat } from './globe';
import type { HouseLayout } from './types';

type RGB = readonly [number, number, number];
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const mixInto = (o: number[], a: RGB, b: RGB, t: number) => {
  o[0] = a[0] + (b[0] - a[0]) * t;
  o[1] = a[1] + (b[1] - a[1]) * t;
  o[2] = a[2] + (b[2] - a[2]) * t;
};
const lerpTo = (o: number[], b: RGB, t: number) => {
  o[0] = o[0]! + (b[0] - o[0]!) * t;
  o[1] = o[1]! + (b[1] - o[1]!) * t;
  o[2] = o[2]! + (b[2] - o[2]!) * t;
};

/** Colour at t along ascending stops. */
function ramp(stops: ReadonlyArray<readonly [number, RGB]>, t: number, out: number[]): void {
  let i = 0;
  while (i < stops.length - 2 && t > stops[i + 1]![0]) i++;
  const [t0, a] = stops[i]!;
  const [t1, b] = stops[i + 1]!;
  mixInto(out, a, b, clamp01((t - t0) / (t1 - t0 || 1)));
}

function canvas(w: number, h = w): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

/** Tileable value noise with `cells` lattice cells per side; (u, v) in [0, 1). */
function tileNoise(rng: Rng, cells: number): (u: number, v: number) => number {
  const g = new Float32Array(cells * cells);
  for (let i = 0; i < g.length; i++) g[i] = rng.next();
  return (u, v) => {
    const x = (((u % 1) + 1) % 1) * cells;
    const y = (((v % 1) + 1) % 1) * cells;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const x1 = (x0 + 1) % cells;
    const y1 = (y0 + 1) % cells;
    const a = g[y0 * cells + x0]!;
    const b = g[y0 * cells + x1]!;
    const c = g[y1 * cells + x0]!;
    const d = g[y1 * cells + x1]!;
    return a + (b - a) * sx + (c - a + (a - b - c + d) * sx) * sy;
  };
}

/** Tileable fBm (0..1) from octaves of [cells, amplitude]. */
function fbm(rng: Rng, octaves: ReadonlyArray<readonly [number, number]>): (u: number, v: number) => number {
  const fns = octaves.map(([c]) => tileNoise(rng, c));
  const total = octaves.reduce((s, [, a]) => s + a, 0);
  return (u, v) => {
    let h = 0;
    for (let k = 0; k < fns.length; k++) h += fns[k]!(u, v) * octaves[k]![1];
    return h / total;
  };
}

function paint(ctx: CanvasRenderingContext2D, w: number, h: number, color: (x: number, y: number, out: number[]) => void): void {
  const img = ctx.createImageData(w, h);
  const out = [0, 0, 0, 255];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      out[3] = 255;
      color(x, y, out);
      const o = (y * w + x) * 4;
      img.data[o] = out[0]!;
      img.data[o + 1] = out[1]!;
      img.data[o + 2] = out[2]!;
      img.data[o + 3] = out[3]!;
    }
  }
  ctx.putImageData(img, 0, 0);
}

function repeatTexture(c: HTMLCanvasElement, srgb = true): CanvasTexture {
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = srgb ? SRGBColorSpace : LinearSRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// ── Tileable floor textures (zone floor ids; the ground past the poles) ──────────────

const OCEAN_STOPS: ReadonlyArray<readonly [number, RGB]> = [
  [0, hex('#0a2852')],
  [0.5, hex('#0f3466')],
  [1, hex('#164682')],
];

/** Open ocean from orbit: deep blue with faint swells. */
export function globeOceanTexture(): HTMLCanvasElement {
  const S = 256;
  const [c, ctx] = canvas(S);
  const n = fbm(new Rng('globe-ocean'), [[4, 1], [16, 0.5], [48, 0.25]]);
  paint(ctx, S, S, (x, y, o) => ramp(OCEAN_STOPS, n(x / S, y / S), o));
  return c;
}

/** Shelf seas: lighter, greener blue. */
export function globeShelfTexture(): HTMLCanvasElement {
  const S = 256;
  const [c, ctx] = canvas(S);
  const n = fbm(new Rng('globe-shelf'), [[4, 1], [16, 0.5]]);
  paint(ctx, S, S, (x, y, o) => mixInto(o, hex('#1d6c9c'), hex('#2a8cb0'), n(x / S, y / S)));
  return c;
}

/** Land from orbit: greens and browns in patches. */
export function globeLandTexture(): HTMLCanvasElement {
  const S = 256;
  const [c, ctx] = canvas(S);
  const n = fbm(new Rng('globe-land'), [[4, 1], [12, 0.6], [40, 0.3]]);
  const stops: ReadonlyArray<readonly [number, RGB]> = [[0.3, hex('#3b6431')], [0.5, hex('#5d7a3c')], [0.7, hex('#9c8a58')]];
  paint(ctx, S, S, (x, y, o) => ramp(stops, n(x / S, y / S), o));
  return c;
}

/** Polar ice: white with blue-grey ridges. */
export function globeIceTexture(): HTMLCanvasElement {
  const S = 256;
  const [c, ctx] = canvas(S);
  const n = fbm(new Rng('globe-ice'), [[4, 1], [16, 0.6], [48, 0.3]]);
  paint(ctx, S, S, (x, y, o) => mixInto(o, hex('#c9dbe8'), hex('#f2f7fb'), smooth(0.3, 0.7, n(x / S, y / S))));
  return c;
}

// ── Tiled detail for the painted surface ──────────────

/** Ocean ripples as a tileable normal map (wind-streaked swells running mostly east–west). */
function rippleNormals(): Texture {
  const S = 256;
  const rng = new Rng('globe-ripples');
  const n1 = tileNoise(rng, 24);
  const n2 = tileNoise(rng, 64);
  const h = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const v = y / S;
      h[y * S + x] = Math.sin((v * 22 + n1(u, v) * 3) * Math.PI * 2) * 0.5 + n2(u * 2, v) * 0.9 + n1(u, v * 3) * 0.4;
    }
  }
  const [c, ctx] = canvas(S);
  const k = 1.6;
  paint(ctx, S, S, (x, y, o) => {
    const dx = (h[y * S + ((x + 1) % S)]! - h[y * S + ((x - 1 + S) % S)]!) * k;
    const dy = (h[((y + 1) % S) * S + x]! - h[((y - 1 + S) % S) * S + x]!) * k;
    const inv = 1 / Math.hypot(dx, dy, 1);
    o[0] = (-dx * inv * 0.5 + 0.5) * 255;
    o[1] = (dy * inv * 0.5 + 0.5) * 255;
    o[2] = (inv * 0.5 + 0.5) * 255;
  });
  return repeatTexture(c, false);
}

/** Land grain: grey around 0.5 with ridges and speckle (multiplied in by the shader). */
function landGrain(): Texture {
  const S = 256;
  const rng = new Rng('globe-grain');
  const n = fbm(rng, [[8, 1], [32, 0.7], [96, 0.5]]);
  const r = tileNoise(rng, 16);
  const [c, ctx] = canvas(S);
  paint(ctx, S, S, (x, y, o) => {
    const ridge = 1 - Math.abs(r(x / S, y / S) * 2 - 1);
    const v = 128 + (n(x / S, y / S) - 0.5) * 120 + (ridge - 0.5) * 50;
    o[0] = o[1] = o[2] = Math.max(0, Math.min(255, v));
  });
  return repeatTexture(c, false);
}

/** Clouds: a tileable fBm field thresholded into white wisps with soft alpha. */
function cloudTexture(): Texture {
  const S = 512;
  const rng = new Rng('globe-clouds');
  const n = fbm(rng, [[3, 1], [7, 0.6], [18, 0.35], [44, 0.18]]);
  const streak = tileNoise(rng, 5);
  const [c, ctx] = canvas(S);
  paint(ctx, S, S, (x, y, o) => {
    const u = x / S;
    const v = y / S;
    const t = n(u + (streak(u, v) - 0.5) * 0.12, v);
    const a = smooth(0.54, 0.74, t);
    o[0] = o[1] = o[2] = 236 + a * 19;
    o[3] = Math.round(a * 0.62 * 255);
  });
  return repeatTexture(c);
}

// ── The painted surface ──────────────

/** Texture pixels per unit; distance-field cells per unit; ice drawn past each pole (units). */
const PX = 4;
const Q = 2;
const POLE_MARGIN = 8;
/** Tiled detail sizes (units): each divides the lap width. */
const RIPPLE_TILE = 4;
const GRAIN_TILE = 6;
const CLOUD_TILE = 60;
/** Cloud drift (units / s, eastwards). */
const CLOUD_SPEED = 0.25;

const LAND_STOPS: ReadonlyArray<readonly [number, RGB]> = [
  [0, hex('#24502a')],
  [9, hex('#2f5f2e')],
  [15, hex('#6e7d3f')],
  [22, hex('#8f8a52')],
  [32, hex('#5f7a3c')],
  [45, hex('#4c6d36')],
  [56, hex('#2e4c33')],
  [64, hex('#3c5440')],
  [70, hex('#7a7a68')],
  [80, hex('#a9aba2')],
];
const DESERT = hex('#d0a76a');
const DESERT_RED = hex('#c08250');
const STEPPE = hex('#a3995f');
const ROCK = hex('#7a7062');
const SNOW = hex('#eef2f5');
const BEACH = hex('#d8c793');
const SURF = hex('#a5dadb');
const WATER_STOPS: ReadonlyArray<readonly [number, RGB]> = [
  [0.12, hex('#46b6c4')],
  [0.7, hex('#2689ad')],
  [1.8, hex('#1b6a9b')],
  [4, hex('#154e86')],
  [9, hex('#0f3a6f')],
  [16, hex('#0b2c5a')],
];
const ICE = hex('#eaf1f7');
const ICE_SHADE = hex('#c3d6e6');

/** Separable box blur of radius `r` cells, wrapping in x and clamped in z, in place. */
function boxBlur(f: Float32Array, w: number, h: number, r: number): void {
  const n = 2 * r + 1;
  const row = new Float32Array(w);
  for (let y = 0; y < h; y++) {
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += f[y * w + ((k + w) % w)]!;
    for (let x = 0; x < w; x++) {
      row[x] = sum / n;
      sum += f[y * w + ((x + r + 1) % w)]! - f[y * w + ((x - r + w) % w)]!;
    }
    f.set(row, y * w);
  }
  const col = new Float32Array(h);
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += f[Math.min(h - 1, Math.max(0, k)) * w + x]!;
    for (let y = 0; y < h; y++) {
      col[y] = sum / n;
      sum += f[Math.min(h - 1, y + r + 1) * w + x]! - f[Math.max(0, y - r) * w + x]!;
    }
    for (let y = 0; y < h; y++) f[y * w + x] = col[y]!;
  }
}

/**
 * Distance field on the lap with wrap-around: the grid is padded with `pad` columns from the
 * opposite edge before the (non-wrapping) chamfer passes, then cropped back.
 */
function wrappedDistance(src: (k: number) => boolean, w: number, h: number, pad: number, cap: number): Float32Array {
  const pw = w + pad * 2;
  const d = distanceTo((k) => {
    const y = Math.floor(k / pw);
    const x = (((k % pw) - pad) % w + w) % w;
    return src(y * w + x);
  }, pw, h, cap);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) out.set(d.subarray(y * pw + pad, y * pw + pad + w), y * w);
  return out;
}

export interface GlobeSurfaceView {
  object: Group;
  update(dt: number): void;
  /** Frees the painted textures and materials (geometry goes with HouseView's). */
  dispose(): void;
}

/** The painted Earth for `layout` (one lap) plus its drifting cloud layer. */
export function buildGlobeSurface(layout: HouseLayout): GlobeSurfaceView {
  const W = GLOBE.width;
  const D = GLOBE.depth;
  const M = POLE_MARGIN;
  const surf = globeSurface(layout.seed, Q);
  const rng = new Rng((layout.seed ^ 0x910be) >>> 0);

  // ── Fields on the distance grid (Q per unit, rows from z = −M to D + M; outside the map rows are ice) ──
  const gw = surf.cols;
  const gh = Math.round((D + 2 * M) * Q);
  const off = M * Q;
  const kindAt = (k: number) => {
    const y = Math.floor(k / gw) - off;
    if (y < 0 || y >= surf.rows) return SURFACE.ice;
    return surf.kind[y * gw + (k % gw)]!;
  };
  const kinds = new Uint8Array(gw * gh);
  for (let k = 0; k < kinds.length; k++) kinds[k] = kindAt(k);
  const isWater = (k: number) => kinds[k] === SURFACE.ocean || kinds[k] === SURFACE.sea;
  const CAP = 40;
  const PAD = CAP;
  const toWater = wrappedDistance(isWater, gw, gh, PAD, CAP);
  const toSolid = wrappedDistance((k) => !isWater(k), gw, gh, PAD, CAP);
  const toIce = wrappedDistance((k) => kinds[k] === SURFACE.ice, gw, gh, PAD, CAP);
  const toNonIce = wrappedDistance((k) => kinds[k] !== SURFACE.ice, gw, gh, PAD, CAP);
  // Signed distances (cells): + in the water / + inside the ice; blurred so the cells round off.
  const sd = new Float32Array(gw * gh);
  const sdIce = new Float32Array(gw * gh);
  for (let k = 0; k < sd.length; k++) {
    sd[k] = isWater(k) ? toSolid[k]! : -toWater[k]!;
    sdIce[k] = kinds[k] === SURFACE.ice ? toNonIce[k]! : -toIce[k]!;
  }
  for (let i = 0; i < 2; i++) boxBlur(sd, gw, gh, 2);
  for (let i = 0; i < 2; i++) boxBlur(sdIce, gw, gh, 2);
  // Mountain belts: stamped along their polylines (moved with their continent), then a distance field.
  const ranges = new Uint8Array(gw * gh);
  for (const r of RANGES) {
    const gi = SHAPES.findIndex((s) => s.id === r.group);
    const [dx, dz] = surf.offsets[gi] ?? [0, 0];
    for (let i = 0; i + 1 < r.pts.length; i++) {
      const [ax, az] = [lonToX(r.pts[i]![0]) + dx, latToZ(r.pts[i]![1]) + dz];
      const [bx, bz] = [lonToX(r.pts[i + 1]![0]) + dx, latToZ(r.pts[i + 1]![1]) + dz];
      const steps = Math.ceil(Math.hypot(bx - ax, bz - az) * Q * 2);
      for (let s = 0; s <= steps; s++) {
        const x = Math.floor((ax + ((bx - ax) * s) / steps) * Q);
        const y = Math.floor((az + ((bz - az) * s) / steps) * Q) + off;
        if (y >= 0 && y < gh) ranges[y * gw + ((x % gw) + gw) % gw] = 1;
      }
    }
  }
  const toRange = wrappedDistance((k) => ranges[k] === 1, gw, gh, PAD, CAP);
  const sample = (f: Float32Array, x: number, z: number) => {
    let fx = x * Q - 0.5;
    fx = ((fx % gw) + gw) % gw;
    const fz = Math.min(gh - 1.001, Math.max(0, (z + M) * Q - 0.5));
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const tx = fx - i;
    const tz = fz - j;
    const i1 = (i + 1) % gw;
    const a = f[j * gw + i]!;
    const b = f[j * gw + i1]!;
    const c = f[(j + 1) * gw + i]!;
    const d = f[(j + 1) * gw + i1]!;
    return (a + (b - a) * tx + (c - a + (a - b - c + d) * tx) * tz) / Q;
  };

  // ── Paint ──
  const tw = W * PX;
  const th = (D + 2 * M) * PX;
  const [colorCanvas, cctx] = canvas(tw, th);
  const [roughCanvas, rctx] = canvas(tw, th);
  const rough = rctx.createImageData(tw, th);
  const n1 = periodicNoise(rng.fork('n1'), W, D + 2 * M, 120);
  const n2 = periodicNoise(rng.fork('n2'), W, D + 2 * M, 480);
  const n3 = periodicNoise(rng.fork('n3'), W, D + 2 * M, 1200);
  const dry = periodicNoise(rng.fork('dry'), W, D + 2 * M, 40);
  const col = [0, 0, 0];
  const sand = [0, 0, 0];
  paint(cctx, tw, th, (px, py, o) => {
    const x = (px + 0.5) / PX;
    const z = (py + 0.5) / PX - M;
    const zz = z + M;
    const a = n1(x, zz);
    const b = n2(x, zz);
    const c = n3(x, zz);
    // Shores wobble at two scales so the coast never follows the grid.
    const wob = (a - 0.5) * 0.9 + (b - 0.5) * 0.45 + (c - 0.5) * 0.18;
    const s = sample(sd, x, z) + wob;
    const si = sample(sdIce, x, z) + wob;
    const lat = zToLat(Math.min(D, Math.max(0, z)));
    const alat = Math.abs(lat);
    let r = 0.2;
    let landK = 0;
    if (si > 0 || (s <= 0 && si > -0.4)) {
      // Ice (with ridged shading), whiter away from its edge.
      mixInto(col, ICE_SHADE, ICE, smooth(0.25, 0.75, b * 0.7 + c * 0.3));
      lerpTo(col, hex('#ffffff'), smooth(2, 8, si) * 0.35);
      r = 0.5;
      landK = 0.5;
    } else if (s > 0) {
      // Water: surf, shallows, shelf, ocean, deep.
      const depth = s;
      ramp(WATER_STOPS, depth + (a - 0.5) * 0.8, col);
      lerpTo(col, SURF, Math.max(0, 1 - Math.abs(depth - 0.05) / 0.12) * 0.75);
      const k = 1 + (b - 0.5) * 0.12;
      col[0] = col[0]! * k;
      col[1] = col[1]! * k;
      col[2] = col[2]! * k;
      r = depth < 0.6 ? 0.32 : 0.2;
      // Floes breaking off the ice edge.
      if (si > -1.6 && c * 0.6 + b * 0.4 > 0.5 + -si * 0.22) {
        mixInto(col, ICE_SHADE, ICE, b);
        r = 0.5;
        landK = 0.5;
      }
    } else {
      // Land: latitude biome, drier inland in the subtropics and continental interiors, ranges, beaches.
      const inland = -s;
      ramp(LAND_STOPS, alat + (b - 0.5) * 6, col);
      const belt = 1 - smooth(5, 13, Math.abs(alat - 24));
      const dryness = belt * smooth(0.8, 7, inland) * 1.25 + (dry(x, zz) - 0.5) * 0.9 - 0.1;
      if (dryness > 0) {
        mixInto(sand, DESERT_RED, DESERT, smooth(0.2, 0.8, a * 0.6 + b * 0.4));
        lerpTo(col, sand as unknown as RGB, smooth(0, 0.45, dryness));
      }
      const steppe = (1 - smooth(4, 10, Math.abs(alat - 46))) * smooth(4, 14, inland) + (dry(x + 37, zz) - 0.5) * 0.5;
      if (steppe > 0.2) lerpTo(col, STEPPE, smooth(0.2, 0.6, steppe) * 0.7);
      const rd = sample(toRange, x, z) + (a - 0.5) * 1.2 + (c - 0.5) * 0.5;
      if (rd < 2.2) {
        lerpTo(col, ROCK, (1 - smooth(0.4, 2.2, rd)) * 0.85);
        if (rd < 0.7) lerpTo(col, SNOW, (1 - smooth(0.1, 0.7, rd)) * 0.9);
      }
      // Lighter on the ridges of the noise, darker in the hollows: a hint of relief.
      const k = 0.88 + c * 0.16 + (a - 0.5) * 0.12;
      col[0] = col[0]! * k;
      col[1] = col[1]! * k;
      col[2] = col[2]! * k;
      if (inland < 0.22 && alat < 42) lerpTo(col, BEACH, (1 - smooth(0.05, 0.22, inland)) * 0.8);
      r = 1;
      landK = 1;
    }
    o[0] = Math.min(255, col[0]!);
    o[1] = Math.min(255, col[1]!);
    o[2] = Math.min(255, col[2]!);
    const ro = (py * tw + px) * 4;
    rough.data[ro] = landK * 255;
    rough.data[ro + 1] = r * 255;
    rough.data[ro + 2] = 0;
    rough.data[ro + 3] = 255;
  });
  rctx.putImageData(rough, 0, 0);

  const map = new CanvasTexture(colorCanvas);
  map.colorSpace = SRGBColorSpace;
  map.anisotropy = 8;
  const roughnessMap = new CanvasTexture(roughCanvas);
  roughnessMap.colorSpace = LinearSRGBColorSpace;
  const ripples = rippleNormals();
  ripples.repeat.set(W / RIPPLE_TILE, (D + 2 * M) / RIPPLE_TILE);
  const grain = landGrain();
  const mat = new MeshStandardMaterial({ map, roughnessMap, roughness: 1, metalness: 0, normalMap: ripples, normalScale: new Vector2(0.28, 0.28) });
  const grainRepeat = new Vector2(W / GRAIN_TILE, (D + 2 * M) / GRAIN_TILE);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.grainMap = { value: grain };
    shader.uniforms.grainRepeat = { value: grainRepeat };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D grainMap;\nuniform vec2 grainRepeat;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        float landK = texture2D(roughnessMap, vMapUv).r;
        float grain = texture2D(grainMap, vMapUv * grainRepeat).r * 2.0;
        diffuseColor.rgb *= mix(1.0, grain, 0.22 * landK);`,
      )
      .replace('mapN.xy *= normalScale;', 'mapN.xy *= normalScale * (1.0 - landK);');
  };
  mat.customProgramCacheKey = () => 'globe-surface';
  const plane = new Mesh(new PlaneGeometry(W, D + 2 * M), mat);
  plane.rotation.x = -Math.PI / 2;
  plane.position.set(W / 2, 0.01, D / 2);
  plane.receiveShadow = true;
  plane.name = 'globeSurface';

  const clouds = cloudTexture();
  clouds.repeat.set(W / CLOUD_TILE, (D + 2 * M) / CLOUD_TILE);
  const cloudMat = new MeshStandardMaterial({ map: clouds, transparent: true, depthWrite: false, roughness: 1, metalness: 0 });
  const cloudPlane = new Mesh(new PlaneGeometry(W, D + 2 * M), cloudMat);
  cloudPlane.rotation.x = -Math.PI / 2;
  cloudPlane.position.set(W / 2, 0.05, D / 2);
  cloudPlane.renderOrder = 2;
  cloudPlane.name = 'globeClouds';

  const object = new Group();
  object.name = 'globe';
  object.add(plane, cloudPlane);
  return {
    object,
    update(dt) {
      clouds.offset.x = (clouds.offset.x - (dt * CLOUD_SPEED) / CLOUD_TILE) % 1;
    },
    dispose() {
      for (const t of [map, roughnessMap, ripples, grain, clouds]) t.dispose();
      mat.dispose();
      cloudMat.dispose();
    },
  };
}
