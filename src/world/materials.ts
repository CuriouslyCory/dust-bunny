/** Procedural canvas textures (floors, rugs, fur). Browser only. */
import { CanvasTexture, RepeatWrapping, SRGBColorSpace, type Texture } from 'three';
import { Rng } from '../core/rng';
import type { FloorMaterialId } from './types';

export interface FloorTextureInfo {
  texture: Texture;
  /** World size (cm) covered by one texture repeat. */
  worldSize: number;
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
  const baseHue = dark ? 22 : 30;
  for (let p = 0; p < planks; p++) {
    let x = -rng.range(0, S * 0.6);
    while (x < S) {
      const len = rng.range(S * 0.45, S * 0.9);
      const l = (dark ? 30 : 52) + rng.range(-7, 7);
      ctx.fillStyle = hsl(baseHue + rng.range(-4, 4), dark ? 40 : 45, l);
      ctx.fillRect(x, p * ph, len, ph);
      // Grain: long faint sine strokes.
      for (let g = 0; g < 22; g++) {
        ctx.strokeStyle = hsl(baseHue, 40, l + rng.range(-12, 6), rng.range(0.08, 0.25));
        ctx.lineWidth = rng.range(0.6, 2);
        ctx.beginPath();
        const y0 = p * ph + rng.range(2, ph - 2);
        const amp = rng.range(0.5, 3);
        const freq = rng.range(0.004, 0.02);
        for (let xx = 0; xx <= len; xx += 12) ctx.lineTo(x + xx, y0 + Math.sin((x + xx) * freq + g) * amp);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(40,20,10,0.55)';
      ctx.fillRect(x, p * ph, 2, ph);
      x += len;
    }
    ctx.fillStyle = 'rgba(30,15,8,0.6)';
    ctx.fillRect(0, p * ph, S, 2);
  }
  speckle(ctx, S, S, rng, 4000, 0.08);
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
      ctx.fillStyle = hsl(hue + rng.range(-3, 3), sat, light + rng.range(-3, 3));
      ctx.fillRect(i * ts + g / 2, j * ts + g / 2, ts - g, ts - g);
      const grd = ctx.createLinearGradient(i * ts, j * ts, (i + 1) * ts, (j + 1) * ts);
      grd.addColorStop(0, 'rgba(255,255,255,0.12)');
      grd.addColorStop(1, 'rgba(0,0,0,0.06)');
      ctx.fillStyle = grd;
      ctx.fillRect(i * ts + g / 2, j * ts + g / 2, ts - g, ts - g);
    }
  }
  speckle(ctx, S, S, rng, 1500, 0.06);
  return c;
}

function carpetTexture(): HTMLCanvasElement {
  const S = 512;
  const [c, ctx] = canvas(S, S);
  const rng = new Rng('carpet');
  ctx.fillStyle = hsl(210, 14, 62);
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 60000; i++) {
    ctx.fillStyle = hsl(210 + rng.range(-10, 10), 14, 62 + rng.range(-14, 12), 0.5);
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
        info = { texture: toTexture(woodTexture(false)), worldSize: 160 };
        break;
      case 'woodDark':
        info = { texture: toTexture(woodTexture(true)), worldSize: 160 };
        break;
      case 'tile':
        info = { texture: toTexture(tileTexture(4, 40, 20, 86, '#b9b1a4')), worldSize: 120 };
        break;
      case 'tileSmall':
        info = { texture: toTexture(tileTexture(8, 195, 35, 80, '#e9eef0')), worldSize: 80 };
        break;
      case 'carpet':
        info = { texture: toTexture(carpetTexture()), worldSize: 60 };
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
