/** Procedural canvas textures (floors, rugs, fur). Browser only. */
import { CanvasTexture, RepeatWrapping, SRGBColorSpace, type MeshStandardMaterial, type Texture } from 'three';
import { Rng } from '../core/rng';
import type { FloorMaterialId } from './types';

export interface FloorTextureInfo {
  texture: Texture;
  /** World size (cm) covered by one texture repeat. */
  worldSize: number;
  roughness: number;
}

let maxAnisotropy = 4;
export function setMaxAnisotropy(n: number): void {
  maxAnisotropy = n;
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function toTexture(c: HTMLCanvasElement, repeat = true): CanvasTexture {
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = RepeatWrapping;
  t.anisotropy = maxAnisotropy;
  return t;
}

const hsl = (h: number, s: number, l: number, a = 1) => `hsla(${h},${s}%,${l}%,${a})`;

function speckle(ctx: CanvasRenderingContext2D, w: number, h: number, rng: Rng, n: number, alpha: number): void {
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = rng.chance(0.5) ? `rgba(0,0,0,${alpha * rng.next()})` : `rgba(255,255,255,${alpha * rng.next()})`;
    ctx.fillRect(rng.range(0, w), rng.range(0, h), rng.range(1, 3), rng.range(1, 3));
  }
}

function woodTexture(dark: boolean): HTMLCanvasElement {
  const S = 1024;
  const [c, ctx] = canvas(S, S);
  const rng = new Rng(dark ? 'wood-dark' : 'wood');
  const planks = 8;
  const ph = S / planks;
  const baseHue = dark ? 20 : 31;
  const baseL = dark ? 31 : 54;
  for (let p = 0; p < planks; p++) {
    const y = p * ph;
    // Planks wrap around the right edge so the texture tiles seamlessly.
    const start = rng.range(0, S);
    let x = start;
    while (x < start + S) {
      const len = Math.min(rng.range(S * 0.35, S * 0.8), start + S - x);
      const hue = baseHue + rng.range(-5, 4);
      const l = baseL + rng.range(-8, 7);
      const sat = (dark ? 42 : 48) + rng.range(-8, 6);
      const seed = rng.next() * 1000;
      for (const off of [0, -S]) {
        const px = x + off;
        if (px > S || px + len < 0) continue;
        ctx.save();
        ctx.beginPath();
        ctx.rect(px, y, len, ph);
        ctx.clip();
        // Base with a soft lengthwise tone gradient.
        const grd = ctx.createLinearGradient(px, y, px + len, y + ph);
        grd.addColorStop(0, hsl(hue, sat, l + 2));
        grd.addColorStop(0.5, hsl(hue + 2, sat, l - 2));
        grd.addColorStop(1, hsl(hue - 1, sat, l + 1));
        ctx.fillStyle = grd;
        ctx.fillRect(px, y, len, ph);
        const prng = new Rng(Math.floor(seed));
        // Grain: long faint wavy strokes.
        for (let g = 0; g < 26; g++) {
          ctx.strokeStyle = hsl(hue, sat - 6, l + prng.range(-14, 8), prng.range(0.08, 0.28));
          ctx.lineWidth = prng.range(0.6, 2.2);
          ctx.beginPath();
          const y0 = y + prng.range(3, ph - 3);
          const amp = prng.range(0.5, 3.5);
          const freq = prng.range(0.004, 0.02);
          const ph0 = prng.range(0, 6);
          for (let xx = 0; xx <= len; xx += 10) ctx.lineTo(px + xx, y0 + Math.sin(xx * freq + ph0) * amp);
          ctx.stroke();
        }
        // Occasional knot.
        if (prng.chance(0.35)) {
          const kx = px + prng.range(len * 0.15, len * 0.85);
          const ky = y + prng.range(ph * 0.3, ph * 0.7);
          for (let k = 5; k > 0; k--) {
            ctx.strokeStyle = hsl(hue - 4, sat, l - 6 - k * 3, 0.35);
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.ellipse(kx, ky, k * 4.5, k * 1.8, 0, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
        // Bevelled edges: light top edge, dark seams.
        ctx.fillStyle = 'rgba(255,240,220,0.10)';
        ctx.fillRect(px, y + 2, len, 2);
        ctx.fillStyle = 'rgba(40,20,10,0.5)';
        ctx.fillRect(px, y, 2.5, ph);
        ctx.restore();
      }
      x += len;
    }
    ctx.fillStyle = 'rgba(30,15,8,0.55)';
    ctx.fillRect(0, y, S, 2.5);
  }
  speckle(ctx, S, S, rng, 5000, 0.07);
  return c;
}

function tileTexture(tiles: number, hue: number, sat: number, light: number, grout: string): HTMLCanvasElement {
  const S = 512;
  const [c, ctx] = canvas(S, S);
  const rng = new Rng(`tile${tiles}${hue}`);
  const ts = S / tiles;
  ctx.fillStyle = grout;
  ctx.fillRect(0, 0, S, S);
  const g = Math.max(2, ts * 0.05);
  for (let i = 0; i < tiles; i++) {
    for (let j = 0; j < tiles; j++) {
      const x0 = i * ts + g / 2;
      const y0 = j * ts + g / 2;
      const w = ts - g;
      const tl = light + rng.range(-3, 3);
      ctx.fillStyle = hsl(hue + rng.range(-3, 3), sat, tl);
      ctx.fillRect(x0, y0, w, w);
      // Soft cloudy mottling inside each tile.
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0, y0, w, w);
      ctx.clip();
      for (let k = 0; k < 10; k++) {
        const r = rng.range(w * 0.15, w * 0.5);
        const cx = x0 + rng.range(0, w);
        const cy = y0 + rng.range(0, w);
        const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        const dl = rng.range(-5, 4);
        rg.addColorStop(0, hsl(hue + rng.range(-6, 6), sat, tl + dl, 0.35));
        rg.addColorStop(1, hsl(hue, sat, tl + dl, 0));
        ctx.fillStyle = rg;
        ctx.fillRect(x0, y0, w, w);
      }
      ctx.restore();
      // Glaze: light top-left, slightly darker bottom-right, bevel lines.
      const grd = ctx.createLinearGradient(x0, y0, x0 + w, y0 + w);
      grd.addColorStop(0, 'rgba(255,255,255,0.16)');
      grd.addColorStop(1, 'rgba(0,0,0,0.07)');
      ctx.fillStyle = grd;
      ctx.fillRect(x0, y0, w, w);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(x0, y0, w, 1.5);
      ctx.fillRect(x0, y0, 1.5, w);
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.fillRect(x0, y0 + w - 1.5, w, 1.5);
      ctx.fillRect(x0 + w - 1.5, y0, 1.5, w);
    }
  }
  speckle(ctx, S, S, rng, 1500, 0.05);
  return c;
}

function carpetTexture(): HTMLCanvasElement {
  const S = 512;
  const [c, ctx] = canvas(S, S);
  const rng = new Rng('carpet');
  ctx.fillStyle = hsl(205, 16, 60);
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 70000; i++) {
    ctx.fillStyle = hsl(205 + rng.range(-12, 12), 16, 60 + rng.range(-16, 12), 0.5);
    ctx.fillRect(rng.range(0, S), rng.range(0, S), 1.5, 1.5);
  }
  return c;
}

function grassTexture(): HTMLCanvasElement {
  const S = 512;
  const [c, ctx] = canvas(S, S);
  const rng = new Rng('grass');
  ctx.fillStyle = hsl(98, 38, 40);
  ctx.fillRect(0, 0, S, S);
  // Soft mowing patches, then short blade strokes (drawn wrapped so the texture tiles).
  for (let k = 0; k < 40; k++) {
    const r = rng.range(30, 110);
    const cx = rng.range(0, S);
    const cy = rng.range(0, S);
    const l = 40 + rng.range(-6, 6);
    for (const [ox, oy] of [[0, 0], [-S, 0], [0, -S], [-S, -S], [S, 0], [0, S]] as const) {
      const rg = ctx.createRadialGradient(cx + ox, cy + oy, 0, cx + ox, cy + oy, r);
      rg.addColorStop(0, hsl(96 + rng.range(-8, 8), 40, l, 0.35));
      rg.addColorStop(1, hsl(96, 40, l, 0));
      ctx.fillStyle = rg;
      ctx.fillRect(cx + ox - r, cy + oy - r, r * 2, r * 2);
    }
  }
  for (let i = 0; i < 26000; i++) {
    ctx.fillStyle = hsl(92 + rng.range(-14, 16), 42 + rng.range(-8, 10), 40 + rng.range(-14, 14), 0.7);
    ctx.fillRect(rng.range(0, S), rng.range(0, S), 1.2, rng.range(2, 5));
  }
  return c;
}

function asphaltTexture(): HTMLCanvasElement {
  const S = 512;
  const [c, ctx] = canvas(S, S);
  const rng = new Rng('asphalt');
  ctx.fillStyle = hsl(220, 6, 30);
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 40000; i++) {
    ctx.fillStyle = hsl(220, 5, 30 + rng.range(-12, 14), 0.6);
    ctx.fillRect(rng.range(0, S), rng.range(0, S), 1.5, 1.5);
  }
  return c;
}

function concreteTexture(): HTMLCanvasElement {
  const S = 512;
  const [c, ctx] = canvas(S, S);
  const rng = new Rng('concrete');
  ctx.fillStyle = hsl(40, 8, 74);
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 18000; i++) {
    ctx.fillStyle = hsl(40, 6, 74 + rng.range(-10, 8), 0.45);
    ctx.fillRect(rng.range(0, S), rng.range(0, S), 1.5, 1.5);
  }
  // Expansion joints: a 2 × 2 slab grid.
  ctx.fillStyle = 'rgba(60,55,50,0.45)';
  for (const p of [0, S / 2]) {
    ctx.fillRect(p, 0, 3, S);
    ctx.fillRect(0, p, S, 3);
  }
  return c;
}

/** City plaza stone pavers: offset rows of warm grey slabs. */
function pavingTexture(): HTMLCanvasElement {
  const S = 512;
  const [c, ctx] = canvas(S, S);
  const rng = new Rng('paving');
  ctx.fillStyle = hsl(30, 6, 46);
  ctx.fillRect(0, 0, S, S);
  const rows = 8;
  const rh = S / rows;
  for (let r = 0; r < rows; r++) {
    const cols = 4;
    const cw = S / cols;
    const off = (r % 2) * (cw / 2);
    for (let k = -1; k < cols; k++) {
      const x = k * cw + off;
      ctx.fillStyle = hsl(32 + rng.range(-6, 6), 8 + rng.range(-3, 4), 68 + rng.range(-7, 6));
      ctx.fillRect(x + 3, r * rh + 3, cw - 6, rh - 6);
    }
  }
  for (let i = 0; i < 12000; i++) {
    ctx.fillStyle = hsl(30, 6, 66 + rng.range(-12, 8), 0.35);
    ctx.fillRect(rng.range(0, S), rng.range(0, S), 1.5, 1.5);
  }
  return c;
}

const floorCache = new Map<FloorMaterialId, FloorTextureInfo>();

export function floorTexture(id: FloorMaterialId): FloorTextureInfo {
  let info = floorCache.get(id);
  if (!info) {
    switch (id) {
      case 'wood':
        info = { texture: toTexture(woodTexture(false)), worldSize: 160, roughness: 0.62 };
        break;
      case 'woodDark':
        info = { texture: toTexture(woodTexture(true)), worldSize: 160, roughness: 0.58 };
        break;
      case 'tile':
        info = { texture: toTexture(tileTexture(4, 38, 24, 84, '#b3a998')), worldSize: 120, roughness: 0.32 };
        break;
      case 'tileSmall':
        info = { texture: toTexture(tileTexture(8, 192, 34, 80, '#e6ebec')), worldSize: 80, roughness: 0.28 };
        break;
      case 'carpet':
        info = { texture: toTexture(carpetTexture()), worldSize: 60, roughness: 1 };
        break;
      case 'grass':
        info = { texture: toTexture(grassTexture()), worldSize: 420, roughness: 1 };
        break;
      case 'asphalt':
        info = { texture: toTexture(asphaltTexture()), worldSize: 360, roughness: 0.95 };
        break;
      case 'concrete':
        info = { texture: toTexture(concreteTexture()), worldSize: 300, roughness: 0.9 };
        break;
      case 'paving':
        info = { texture: toTexture(pavingTexture()), worldSize: 480, roughness: 0.85 };
        break;
      // Region floors (1 world unit = 10 m). Placeholders until the Region look lands.
      case 'fields':
      case 'forest':
        info = { texture: toTexture(grassTexture()), worldSize: 12, roughness: 1 };
        break;
      case 'motorway':
      case 'water':
        info = { texture: toTexture(asphaltTexture()), worldSize: 8, roughness: 0.95 };
        break;
      case 'townRoofs':
      case 'landfill':
        info = { texture: toTexture(concreteTexture()), worldSize: 10, roughness: 0.9 };
        break;
    }
    floorCache.set(id, info);
  }
  return info;
}

const RUG_PALETTES = [
  ['#8c2f39', '#e9c46a', '#f4f1de', '#3d405b'],
  ['#264653', '#2a9d8f', '#e9c46a', '#f4a261'],
  ['#6d597a', '#b56576', '#eaac8b', '#355070'],
  ['#3a5a40', '#a3b18a', '#dad7cd', '#588157'],
];

/** One-off rug texture sized to the rug's aspect ratio. */
export function rugTexture(seed: number, w: number, d: number): Texture {
  const rng = new Rng(seed);
  const pal = rng.pick(RUG_PALETTES);
  const W = 512;
  const H = Math.max(64, Math.round((512 * d) / w));
  const [c, ctx] = canvas(W, Math.min(1024, H));
  const h = c.height;
  ctx.fillStyle = pal[0]!;
  ctx.fillRect(0, 0, W, h);
  const b = Math.min(W, h) * 0.08;
  ctx.strokeStyle = pal[1]!;
  ctx.lineWidth = b * 0.5;
  ctx.strokeRect(b, b, W - 2 * b, h - 2 * b);
  ctx.strokeStyle = pal[2]!;
  ctx.lineWidth = b * 0.2;
  ctx.strokeRect(b * 1.8, b * 1.8, W - 3.6 * b, h - 3.6 * b);
  const cells = rng.int(3, 6);
  const cw = (W - 5 * b) / cells;
  const rows = Math.max(1, Math.round((h - 5 * b) / cw));
  const ch = (h - 5 * b) / rows;
  for (let i = 0; i < cells; i++) {
    for (let j = 0; j < rows; j++) {
      const x = 2.5 * b + i * cw + cw / 2;
      const y = 2.5 * b + j * ch + ch / 2;
      ctx.fillStyle = pal[(i + j) % 2 ? 3 : 1]!;
      ctx.beginPath();
      ctx.moveTo(x, y - ch * 0.4);
      ctx.lineTo(x + cw * 0.4, y);
      ctx.lineTo(x, y + ch * 0.4);
      ctx.lineTo(x - cw * 0.4, y);
      ctx.closePath();
      ctx.fill();
    }
  }
  for (let i = 0; i < 20000; i++) {
    ctx.fillStyle = `rgba(${rng.chance(0.5) ? '0,0,0' : '255,255,255'},${rng.range(0, 0.08)})`;
    ctx.fillRect(rng.range(0, W), rng.range(0, h), 1.5, 1.5);
  }
  return toTexture(c, false);
}

let detailCache: Texture | null = null;

/** Tileable grey fibre/grain noise (mean ≈ 0.5, linear) used as a close-up detail layer. */
function detailTexture(): Texture {
  if (detailCache) return detailCache;
  const S = 256;
  const [c, ctx] = canvas(S, S);
  const rng = new Rng('detail');
  ctx.fillStyle = 'rgb(128,128,128)';
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 2600; i++) {
    const v = Math.floor(rng.range(70, 190));
    ctx.strokeStyle = `rgba(${v},${v},${v},0.5)`;
    ctx.lineWidth = rng.range(0.6, 1.6);
    const x = rng.range(0, S);
    const y = rng.range(0, S);
    const a = rng.range(0, Math.PI * 2);
    const l = rng.range(3, 12);
    for (const [ox, oy] of [
      [0, 0],
      [-S, 0],
      [0, -S],
      [-S, -S],
    ] as const) {
      ctx.beginPath();
      ctx.moveTo(x + ox, y + oy);
      ctx.lineTo(x + ox + Math.cos(a) * l, y + oy + Math.sin(a) * l);
      ctx.stroke();
    }
  }
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.anisotropy = maxAnisotropy;
  detailCache = t;
  return t;
}

/**
 * Multiplies a fine fibre/grain detail texture over `material.map` so floors and rugs stay crisp
 * when the camera is a few centimetres away (Tier 1). `scale` = detail repeats per map repeat.
 */
export function addFloorDetail(material: MeshStandardMaterial, scale: number, strength = 0.35): void {
  const tex = detailTexture();
  material.onBeforeCompile = (shader) => {
    shader.uniforms.detailMap = { value: tex };
    shader.uniforms.detailScale = { value: scale };
    shader.uniforms.detailStrength = { value: strength };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D detailMap;\nuniform float detailScale;\nuniform float detailStrength;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        #ifdef USE_MAP
          diffuseColor.rgb *= mix(1.0, texture2D(detailMap, vMapUv * detailScale).r * 2.0, detailStrength);
        #endif`,
      );
  };
  material.customProgramCacheKey = () => `floor-detail`;
}

let furCache: { map: Texture; alpha: Texture } | null = null;

/** Fur colour-variation map and a strand alpha map for shell fur. */
export function furTextures(): { map: Texture; alpha: Texture } {
  if (furCache) return furCache;
  const S = 256;
  const rng = new Rng('fur');
  const [c1, a] = canvas(S, S);
  a.fillStyle = '#ffffff';
  a.fillRect(0, 0, S, S);
  for (let i = 0; i < 9000; i++) {
    const v = Math.floor(rng.range(150, 255));
    a.strokeStyle = `rgba(${v},${v},${v},0.35)`;
    a.lineWidth = rng.range(0.5, 1.5);
    const x = rng.range(0, S);
    const y = rng.range(0, S);
    const ang = rng.range(0, Math.PI * 2);
    const l = rng.range(2, 7);
    a.beginPath();
    a.moveTo(x, y);
    a.lineTo(x + Math.cos(ang) * l, y + Math.sin(ang) * l);
    a.stroke();
  }
  const [c2, b] = canvas(S, S);
  b.fillStyle = '#000000';
  b.fillRect(0, 0, S, S);
  for (let i = 0; i < 5000; i++) {
    const v = Math.floor(rng.range(120, 255));
    b.fillStyle = `rgb(${v},${v},${v})`;
    b.beginPath();
    b.arc(rng.range(0, S), rng.range(0, S), rng.range(0.6, 1.6), 0, Math.PI * 2);
    b.fill();
  }
  const map = toTexture(c1);
  const alpha = new CanvasTexture(c2);
  alpha.wrapS = alpha.wrapT = RepeatWrapping;
  furCache = { map, alpha };
  return furCache;
}
