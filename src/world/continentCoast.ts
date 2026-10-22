/**
 * The Continent's water seen from the stratosphere (browser only): one transparent plane over the
 * map and a margin of sea around it, textured from a signed distance field of the water. The sea
 * is the coast walls (`layout.walls`) plus everything past the map edge; inland water is the
 * lake and river zones. Coastlines get a sandy beach, a foam line, surf and shallows that deepen
 * into the open ocean (which fades into the ocean ground plane past the margin); lakes and rivers
 * get green banks and a thinner foam line. Noise wobbles every shore so the 1-unit zone grid does
 * not show. A few islands sit offshore. The collision edge stays the wall rects (within ~0.6 units).
 * The same plane softens the edges of the tundra, desert, mountain and ruin zones: their colour
 * frays out over the neighbouring ground (snow drifts, blown sand, scree, ash), so no zone ends in
 * a straight line.
 */
import { CanvasTexture, Mesh, MeshStandardMaterial, PlaneGeometry, SRGBColorSpace } from 'three';
import { Rng } from '../core/rng';
import { OCEAN_DEEP } from './continentTextures';
import type { ContinentZoneType, HouseLayout } from './types';

/** Zones whose colour frays out over their neighbours, with that colour and how far (units). */
const FRINGES: ReadonlyArray<{ type: ContinentZoneType; color: string; reach: number }> = [
  { type: 'tundra', color: '#e4ebf0', reach: 3.5 },
  { type: 'desert', color: '#cf9e64', reach: 3 },
  { type: 'mountains', color: '#7d7462', reach: 2.4 },
  { type: 'ruins', color: '#7a7670', reach: 1.4 },
];

/** Sea margin drawn around the map (units). */
const MARGIN = 36;
/** Texture pixels per unit. */
const PX = 4;
/** Distance-field cells per unit. */
const Q = 2;

type RGB = [number, number, number];
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** 8-neighbour chamfer distance (in cells) from every cell to the nearest cell with `src` set. */
function distanceTo(src: Uint8Array, w: number, h: number): Float32Array {
  const INF = 1e9;
  const d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = src[i] ? 0 : INF;
  const D1 = 1;
  const D2 = Math.SQRT2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let v = d[i]!;
      if (x > 0) v = Math.min(v, d[i - 1]! + D1);
      if (y > 0) {
        v = Math.min(v, d[i - w]! + D1);
        if (x > 0) v = Math.min(v, d[i - w - 1]! + D2);
        if (x < w - 1) v = Math.min(v, d[i - w + 1]! + D2);
      }
      d[i] = v;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      let v = d[i]!;
      if (x < w - 1) v = Math.min(v, d[i + 1]! + D1);
      if (y < h - 1) {
        v = Math.min(v, d[i + w]! + D1);
        if (x < w - 1) v = Math.min(v, d[i + w + 1]! + D2);
        if (x > 0) v = Math.min(v, d[i + w - 1]! + D2);
      }
      d[i] = v;
    }
  }
  return d;
}

/** Separable box blur of radius `r` cells (edges clamped), in place. */
function boxBlur(f: Float32Array, w: number, h: number, r: number): void {
  const tmp = new Float32Array(Math.max(w, h));
  const n = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += f[y * w + Math.min(w - 1, Math.max(0, k))]!;
    for (let x = 0; x < w; x++) {
      tmp[x] = sum / n;
      sum += f[y * w + Math.min(w - 1, x + r + 1)]! - f[y * w + Math.max(0, x - r)]!;
    }
    for (let x = 0; x < w; x++) f[y * w + x] = tmp[x]!;
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += f[Math.min(h - 1, Math.max(0, k)) * w + x]!;
    for (let y = 0; y < h; y++) {
      tmp[y] = sum / n;
      sum += f[Math.min(h - 1, y + r + 1) * w + x]! - f[Math.max(0, y - r) * w + x]!;
    }
    for (let y = 0; y < h; y++) f[y * w + x] = tmp[y]!;
  }
}

/** Smooth 2D value noise (not tiled) on a lattice of `cell` units. */
function valueNoise(rng: Rng, cols: number, rows: number, cell: number): (x: number, z: number) => number {
  const g = new Float32Array((cols + 2) * (rows + 2));
  for (let i = 0; i < g.length; i++) g[i] = rng.next();
  const W = cols + 2;
  return (x, z) => {
    const fx0 = Math.max(0, x / cell);
    const fz0 = Math.max(0, z / cell);
    const ix = Math.min(cols, Math.floor(fx0));
    const iz = Math.min(rows, Math.floor(fz0));
    const fx = fx0 - ix;
    const fz = fz0 - iz;
    const sx = fx * fx * (3 - 2 * fx);
    const sz = fz * fz * (3 - 2 * fz);
    const a = g[iz * W + ix]!;
    const b = g[iz * W + ix + 1]!;
    const c = g[(iz + 1) * W + ix]!;
    const d = g[(iz + 1) * W + ix + 1]!;
    return a + (b - a) * sx + (c - a + (a - b - c + d) * sx) * sz;
  };
}

const BEACH = hex('#d9c694');
const BANK = hex('#7f8f58');
const FOAM = hex('#eef5f6');
const SHALLOW = hex('#4c9fb0');
const MID = hex('#2c6a91');
const DEEP = hex(OCEAN_DEEP);
const LAKE_SHALLOW = hex('#3f86a3');
const LAKE_DEEP = hex('#285a7e');
const ISLAND = hex('#6f7f4a');

export function buildContinentWater(layout: HouseLayout): Mesh {
  const b = layout.bounds;
  const x0 = b.minX - MARGIN;
  const z0 = b.minZ - MARGIN;
  const spanX = b.maxX - b.minX + MARGIN * 2;
  const spanZ = b.maxZ - b.minZ + MARGIN * 2;
  const rng = new Rng((layout.seed ^ 0xc0a57) >>> 0);

  // ── Masks on the distance grid: sea, inland water, land ──
  const gw = Math.round(spanX * Q);
  const gh = Math.round(spanZ * Q);
  const sea = new Uint8Array(gw * gh);
  const lake = new Uint8Array(gw * gh);
  const land = new Uint8Array(gw * gh);
  const waterRooms = layout.rooms.filter((r) => r.floor === 'lakeWater');
  const islands = Array.from({ length: rng.int(7, 11) }, () => {
    // Offshore, past the map edge (never where the Bunny could think it can roll).
    const side = rng.int(0, 3);
    const t = rng.next();
    const off = rng.range(5, MARGIN - 8);
    const x = side === 0 ? b.minX - off : side === 1 ? b.maxX + off : b.minX + t * (b.maxX - b.minX);
    const z = side === 2 ? b.minZ - off : side === 3 ? b.maxZ + off : b.minZ + t * (b.maxZ - b.minZ);
    return { x, z, r: rng.range(0.8, 3.2), sx: rng.range(0.6, 1.4) };
  });
  /** Calls fn(k) for every cell whose centre lies in r. */
  const cellsIn = (r: { minX: number; minZ: number; maxX: number; maxZ: number }, fn: (k: number) => void) => {
    const i0 = Math.max(0, Math.ceil((r.minX - x0) * Q - 0.5));
    const i1 = Math.min(gw - 1, Math.floor((r.maxX - x0) * Q - 0.5));
    const j0 = Math.max(0, Math.ceil((r.minZ - z0) * Q - 0.5));
    const j1 = Math.min(gh - 1, Math.floor((r.maxZ - z0) * Q - 0.5));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) fn(j * gw + i);
  };
  // Everything is sea, then the map is land, then the coast walls are sea again, then lakes and rivers.
  sea.fill(1);
  cellsIn(b, (k) => {
    sea[k] = 0;
    land[k] = 1;
  });
  for (const w of layout.walls) {
    cellsIn(w.rect, (k) => {
      sea[k] = 1;
      land[k] = 0;
    });
  }
  for (const r of waterRooms) {
    cellsIn(r.rect, (k) => {
      if (sea[k]) return;
      lake[k] = 1;
      land[k] = 0;
    });
  }
  for (const s of islands) {
    cellsIn({ minX: s.x - s.r * s.sx, minZ: s.z - s.r, maxX: s.x + s.r * s.sx, maxZ: s.z + s.r }, (k) => {
      const x = x0 + ((k % gw) + 0.5) / Q;
      const z = z0 + (Math.floor(k / gw) + 0.5) / Q;
      if (Math.hypot((x - s.x) / s.sx, z - s.z) < s.r) {
        sea[k] = 0;
        land[k] = 1;
      }
    });
  }
  const toSea = distanceTo(sea, gw, gh);
  const toLake = distanceTo(lake, gw, gh);
  const toLand = distanceTo(land, gw, gh);
  // Signed distances (cells, + in the water), blurred so the grid's corners round off: the coast
  // more (bays and headlands), lakes and rivers less (rivers are only 3 units wide).
  const sdSea = new Float32Array(gw * gh);
  const sdLake = new Float32Array(gw * gh);
  for (let k = 0; k < gw * gh; k++) {
    sdSea[k] = sea[k] ? toLand[k]! : -Math.min(toSea[k]!, 60);
    sdLake[k] = lake[k] ? toLand[k]! : -Math.min(toLake[k]!, 60);
  }
  for (let i = 0; i < 2; i++) boxBlur(sdSea, gw, gh, 3);
  for (let i = 0; i < 2; i++) boxBlur(sdLake, gw, gh, 1);
  // Zone fringes: signed distance to each fraying zone (+ inside), blurred a little.
  const fringes = FRINGES.map((f) => {
    const inside = new Uint8Array(gw * gh);
    for (const r of layout.rooms) {
      if (r.type !== f.type) continue;
      for (let j = Math.max(0, Math.floor((r.rect.minZ - z0) * Q)); j < Math.min(gh, Math.ceil((r.rect.maxZ - z0) * Q)); j++) {
        for (let i = Math.max(0, Math.floor((r.rect.minX - x0) * Q)); i < Math.min(gw, Math.ceil((r.rect.maxX - x0) * Q)); i++) inside[j * gw + i] = 1;
      }
    }
    const outside = new Uint8Array(gw * gh);
    for (let k = 0; k < gw * gh; k++) outside[k] = inside[k] ? 0 : 1;
    const dIn = distanceTo(inside, gw, gh);
    const dOut = distanceTo(outside, gw, gh);
    const sd = new Float32Array(gw * gh);
    for (let k = 0; k < gw * gh; k++) sd[k] = inside[k] ? Math.min(dOut[k]!, 20) : -Math.min(dIn[k]!, 20);
    for (let i = 0; i < 2; i++) boxBlur(sd, gw, gh, 1);
    return { sd, color: hex(f.color), reach: f.reach };
  });
  const sample = (f: Float32Array, x: number, z: number) => {
    const fx = Math.min(gw - 1.001, Math.max(0, (x - x0) * Q - 0.5));
    const fz = Math.min(gh - 1.001, Math.max(0, (z - z0) * Q - 0.5));
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const tx = fx - i;
    const tz = fz - j;
    const a = f[j * gw + i]!;
    const bb = f[j * gw + i + 1]!;
    const c = f[(j + 1) * gw + i]!;
    const d = f[(j + 1) * gw + i + 1]!;
    return (a + (bb - a) * tx + (c - a + (a - bb - c + d) * tx) * tz) / Q;
  };

  // ── Texture ──
  const tw = Math.round(spanX * PX);
  const th = Math.round(spanZ * PX);
  const canvas = document.createElement('canvas');
  canvas.width = tw;
  canvas.height = th;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(tw, th);
  const data = img.data;
  const n1 = valueNoise(rng, Math.ceil(spanX / 3), Math.ceil(spanZ / 3), 3);
  const n2 = valueNoise(rng, Math.ceil(spanX / 0.8), Math.ceil(spanZ / 0.8), 0.8);
  const n3 = valueNoise(rng, Math.ceil(spanX / 0.5), Math.ceil(spanZ / 0.5), 0.5);
  const fadeIn = 8;
  for (let py = 0; py < th; py++) {
    const z = z0 + (py + 0.5) / PX;
    for (let px = 0; px < tw; px++) {
      const x = x0 + (px + 0.5) / PX;
      const wob = (n1(x - x0, z - z0) - 0.5) * 1.1 + (n2(x - x0, z - z0) - 0.5) * 0.45;
      // Signed distances (units, + in the water) with the shore wobble.
      const sSea = sample(sdSea, x, z) + wob;
      const sLake = sample(sdLake, x, z) + wob * 0.6;
      let col: RGB;
      let a = 0;
      if (sSea > 0) {
        const depth = sSea;
        col = depth < 0.14 ? FOAM : depth < 0.5 ? mix(FOAM, SHALLOW, smooth(0.14, 0.5, depth)) : depth < 2.4 ? mix(SHALLOW, MID, smooth(0.5, 2.4, depth)) : mix(MID, DEEP, smooth(2.4, 6, depth));
        // Surf: a faint second line offshore.
        const surf = Math.max(0, 1 - Math.abs(depth - 0.85) / 0.12) * 0.35;
        col = mix(col, FOAM, surf);
        // Fade into the ocean ground plane at the outer edge of the margin.
        const edge = Math.min(x - x0, x0 + spanX - x, z - z0, z0 + spanZ - z);
        a = smooth(0, fadeIn, edge);
        a = Math.max(a, depth < 6 ? 1 : 0);
      } else if (sSea > -0.4) {
        col = BEACH;
        a = smooth(-0.4, -0.05, sSea) * 0.92;
      } else if (sLake > 0) {
        const depth = sLake;
        col = depth < 0.08 ? mix(FOAM, LAKE_SHALLOW, 0.4) : mix(LAKE_SHALLOW, LAKE_DEEP, smooth(0.08, 1.8, depth));
        a = 0.95;
      } else if (sLake > -0.28) {
        col = BANK;
        a = smooth(-0.28, -0.02, sLake) * 0.75;
      } else {
        col = ISLAND;
        a = 0;
        // Fraying zone edges over the neighbouring land.
        for (const f of fringes) {
          const t = sample(f.sd, x, z) + wob * 1.6 * (f.reach / 3) + (n3(x - x0, z - z0) - 0.5) * 1.2;
          if (t >= 0.6 || t <= -f.reach) continue;
          // Solid at the zone's edge (hiding its straight line), fraying out into drifts and patches.
          const fa = Math.min(1, (1 + t / f.reach) ** 2.2 * 1.1) * 0.92 * smooth(0.6, 0, t);
          if (fa > a) {
            a = fa;
            col = mix(f.color, [f.color[0] * 0.9, f.color[1] * 0.9, f.color[2] * 0.9], n3(x - x0, z - z0));
          }
        }
      }
      // Offshore islands: green with a beach (the land mask covers them, past the map edge only).
      const outside = x < b.minX - 1 || x > b.maxX + 1 || z < b.minZ - 1 || z > b.maxZ + 1;
      if (outside && sSea <= -0.4) {
        col = mix(ISLAND, hex('#8a8a58'), n2(x - x0, z - z0));
        a = 1;
      }
      const o = (py * tw + px) * 4;
      data[o] = col[0];
      data[o + 1] = col[1];
      data[o + 2] = col[2];
      data[o + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  const mat = new MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.32, metalness: 0.05, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 });
  const mesh = new Mesh(new PlaneGeometry(spanX, spanZ), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(x0 + spanX / 2, 0.02, z0 + spanZ / 2);
  mesh.receiveShadow = true;
  mesh.renderOrder = 1;
  mesh.name = 'continentWater';
  return mesh;
}
