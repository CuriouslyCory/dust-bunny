/** Procedural canvas textures (floors, rugs, fur). Browser only. */
import { CanvasTexture, RepeatWrapping, SRGBColorSpace, type MeshStandardMaterial, type Texture } from 'three';
import { Rng } from '../core/rng';
import { solarBeltTexture, solarCoronaTexture, solarKuiperTexture, solarSpaceTexture } from './solarTextures';
import { globeIceTexture, globeLandTexture, globeOceanTexture, globeShelfTexture } from './globeTextures';
import { desertTexture, highlandsTexture, lakeWaterTexture, oceanTexture, ruinsTexture, steppeTexture, tundraTexture } from './continentTextures';
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

// ── Region floors (seen from altitude) ─────────────────────────────

/** Draws `fn` at (x, y) and at its wrapped copies, so shapes crossing an edge tile seamlessly. */
function wrapped(S: number, x: number, y: number, r: number, fn: (x: number, y: number) => void): void {
  for (const ox of [0, -S, S]) for (const oy of [0, -S, S]) if (x + ox > -r && x + ox < S + r && y + oy > -r && y + oy < S + r) fn(x + ox, y + oy);
}

/** Splits [0, S] at points between `min` and `max` apart (the last piece takes the rest). */
function splits(rng: Rng, S: number, min: number, max: number): number[] {
  const out = [0];
  let at = 0;
  while (S - at > max) {
    at += Math.min(rng.range(min, max), S - at - min);
    out.push(Math.round(at));
  }
  out.push(S);
  return out;
}

/**
 * Crop patchwork: columns of parcels, each a crop colour (greens, wheat gold, ploughed brown,
 * the odd rapeseed yellow) with rows at its own angle and dark field margins between them.
 */
function fieldsTexture(): HTMLCanvasElement {
  const S = 2048;
  const [c, ctx] = canvas(S, S);
  const rng = new Rng('fields');
  ctx.fillStyle = hsl(80, 22, 30);
  ctx.fillRect(0, 0, S, S);
  const crops = [
    () => hsl(rng.range(88, 108), rng.range(30, 42), rng.range(34, 44)),
    () => hsl(rng.range(75, 92), rng.range(32, 44), rng.range(40, 50)),
    () => hsl(rng.range(42, 50), rng.range(45, 58), rng.range(56, 64)),
    () => hsl(rng.range(24, 32), rng.range(24, 34), rng.range(32, 40)),
    () => hsl(rng.range(36, 44), rng.range(30, 40), rng.range(46, 54)),
    () => hsl(rng.range(54, 58), rng.range(62, 72), rng.range(52, 58)),
  ];
  const cropWeights = [3, 2.5, 2.5, 2, 1.5, 0.5];
  const xs = splits(rng, S, 180, 420);
  for (let i = 0; i < xs.length - 1; i++) {
    const x0 = xs[i]!;
    const x1 = xs[i + 1]!;
    const ys = splits(rng, S, 150, 380);
    for (let j = 0; j < ys.length - 1; j++) {
      const y0 = ys[j]!;
      const y1 = ys[j + 1]!;
      const crop = rng.weighted([0, 1, 2, 3, 4, 5], (k) => cropWeights[k]!)!;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0, y0, x1 - x0, y1 - y0);
      ctx.clip();
      ctx.fillStyle = crops[crop]!();
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      // Soft tone drift across the parcel.
      const g = ctx.createLinearGradient(x0, y0, x1, y1);
      g.addColorStop(0, `rgba(255,255,255,${rng.range(0, 0.08)})`);
      g.addColorStop(1, `rgba(0,0,0,${rng.range(0, 0.1)})`);
      ctx.fillStyle = g;
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      // Rows: parallel strokes at the parcel's angle (mostly along an edge).
      const alongEdge = rng.chance(0.8);
      const ang = alongEdge ? (rng.chance(0.5) ? 0 : Math.PI / 2) + rng.range(-0.04, 0.04) : rng.range(0, Math.PI);
      const gap = crop === 3 ? rng.range(5, 8) : rng.range(6, 11);
      const reach = Math.hypot(x1 - x0, y1 - y0);
      ctx.translate((x0 + x1) / 2, (y0 + y1) / 2);
      ctx.rotate(ang);
      ctx.lineWidth = gap * 0.42;
      for (let k = -reach / 2; k < reach / 2; k += gap) {
        ctx.strokeStyle = crop === 3 ? `rgba(40,25,15,${rng.range(0.18, 0.3)})` : `rgba(${rng.chance(0.5) ? '255,255,230' : '20,30,10'},${rng.range(0.06, 0.14)})`;
        ctx.beginPath();
        ctx.moveTo(-reach / 2, k);
        ctx.lineTo(reach / 2, k);
        ctx.stroke();
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      // Tractor turning strip along one edge, and a few damp patches.
      if (rng.chance(0.5)) {
        ctx.fillStyle = 'rgba(80,60,40,0.18)';
        if (ang < 0.5) ctx.fillRect(x0, y0, 10, y1 - y0);
        else ctx.fillRect(x0, y0, x1 - x0, 10);
      }
      for (let k = rng.int(0, 3); k > 0; k--) {
        const r = rng.range(20, 70);
        const px = rng.range(x0, x1);
        const py = rng.range(y0, y1);
        const rg = ctx.createRadialGradient(px, py, 0, px, py, r);
        rg.addColorStop(0, `rgba(0,0,0,${rng.range(0.05, 0.12)})`);
        rg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = rg;
        ctx.fillRect(px - r, py - r, r * 2, r * 2);
      }
      ctx.restore();
      // Field margin.
      ctx.strokeStyle = 'rgba(52,62,34,0.7)';
      ctx.lineWidth = 3;
      ctx.strokeRect(x0 + 1.5, y0 + 1.5, x1 - x0 - 3, y1 - y0 - 3);
    }
  }
  speckle(ctx, S, S, rng, 30000, 0.06);
  return c;
}

/** Motorway asphalt from altitude: grey with repair patches, oil stains and sealed cracks (no direction). */
function motorwayTexture(): HTMLCanvasElement {
  const S = 512;
  const [c, ctx] = canvas(S, S);
  const rng = new Rng('motorway');
  ctx.fillStyle = hsl(220, 5, 34);
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 30000; i++) {
    ctx.fillStyle = hsl(220, 4, 34 + rng.range(-10, 10), 0.5);
    ctx.fillRect(rng.range(0, S), rng.range(0, S), 1.5, 1.5);
  }
  for (let i = 0; i < 10; i++) {
    const w = rng.range(30, 120);
    const h = rng.range(30, 120);
    const l = 34 + rng.range(-6, 5);
    wrapped(S, rng.range(0, S), rng.range(0, S), Math.max(w, h), (px, py) => {
      ctx.fillStyle = hsl(220, 4, l, 0.45);
      ctx.fillRect(px, py, w, h);
    });
  }
  for (let i = 0; i < 18; i++) {
    const r = rng.range(8, 30);
    wrapped(S, rng.range(0, S), rng.range(0, S), r, (px, py) => {
      const rg = ctx.createRadialGradient(px, py, 0, px, py, r);
      rg.addColorStop(0, 'rgba(10,10,14,0.22)');
      rg.addColorStop(1, 'rgba(10,10,14,0)');
      ctx.fillStyle = rg;
      ctx.fillRect(px - r, py - r, r * 2, r * 2);
    });
  }
  ctx.strokeStyle = 'rgba(15,15,18,0.35)';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 14; i++) {
    let x = rng.range(40, S - 40);
    let y = rng.range(40, S - 40);
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let k = 0; k < 4; k++) {
      x += rng.range(-9, 9);
      y += rng.range(-9, 9);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  return c;
}

/** River water from altitude: slate blue-green with drifting lighter streaks and silt clouds. */
function waterTexture(): HTMLCanvasElement {
  const S = 512;
  const [c, ctx] = canvas(S, S);
  const rng = new Rng('water');
  ctx.fillStyle = hsl(196, 24, 34);
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 26; i++) {
    const r = rng.range(40, 130);
    const tone = rng.chance(0.5) ? hsl(rng.range(170, 190), 22, 40, 0.25) : hsl(205, 30, 26, 0.25);
    wrapped(S, rng.range(0, S), rng.range(0, S), r, (px, py) => {
      const rg = ctx.createRadialGradient(px, py, 0, px, py, r);
      rg.addColorStop(0, tone);
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = rg;
      ctx.fillRect(px - r, py - r, r * 2, r * 2);
    });
  }
  for (let i = 0; i < 900; i++) {
    const l = rng.range(6, 22);
    const a = rng.range(-0.3, 0.3);
    const alpha = rng.range(0.05, 0.16);
    const w = rng.range(0.6, 1.4);
    wrapped(S, rng.range(0, S), rng.range(0, S), l, (px, py) => {
      ctx.strokeStyle = `rgba(225,238,240,${alpha})`;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l);
      ctx.stroke();
    });
  }
  speckle(ctx, S, S, rng, 3000, 0.04);
  return c;
}

/** A town from above: a street grid around blocks of pitched roofs, back gardens and trees. */
function townRoofsTexture(): HTMLCanvasElement {
  const S = 1024;
  const [c, ctx] = canvas(S, S);
  const rng = new Rng('townRoofs');
  // Streets underneath; each block is inset from a grid cell, so a street runs along every edge (and across the seams).
  ctx.fillStyle = hsl(30, 4, 42);
  ctx.fillRect(0, 0, S, S);
  const roofs = [
    [12, 48, 40],
    [16, 42, 34],
    [8, 40, 46],
    [210, 8, 34],
    [215, 10, 46],
    [30, 18, 38],
    [0, 0, 55],
  ] as const;
  const xs = splits(rng, S, 170, 280);
  for (let i = 0; i < xs.length - 1; i++) {
    const ys = splits(rng, S, 150, 260);
    for (let j = 0; j < ys.length - 1; j++) {
      const street = 14;
      const x0 = xs[i]! + street / 2;
      const x1 = xs[i + 1]! - street / 2;
      const y0 = ys[j]! + street / 2;
      const y1 = ys[j + 1]! - street / 2;
      // Pavement, then back gardens.
      ctx.fillStyle = hsl(36, 8, 62);
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      ctx.fillStyle = hsl(95, 26, 38);
      ctx.fillRect(x0 + 4, y0 + 4, x1 - x0 - 8, y1 - y0 - 8);
      if (rng.chance(0.12)) {
        // A park or square: trees on grass.
        for (let k = 0; k < 14; k++) {
          const r = rng.range(6, 14);
          ctx.fillStyle = hsl(105 + rng.range(-12, 10), 32, 26 + rng.range(-4, 6));
          ctx.beginPath();
          ctx.arc(rng.range(x0 + r, x1 - r), rng.range(y0 + r, y1 - r), r, 0, Math.PI * 2);
          ctx.fill();
        }
        continue;
      }
      // Houses fronting the street on all four sides of the block.
      const depth = rng.range(26, 38);
      const sides: Array<[number, number, number, number, boolean]> = [
        [x0 + 4, y0 + 4, x1 - x0 - 8, depth, true],
        [x0 + 4, y1 - 4 - depth, x1 - x0 - 8, depth, true],
        [x0 + 4, y0 + 4 + depth, depth, y1 - y0 - 8 - 2 * depth, false],
        [x1 - 4 - depth, y0 + 4 + depth, depth, y1 - y0 - 8 - 2 * depth, false],
      ];
      for (const [sx, sy, sw, sh, horizontal] of sides) {
        const len = horizontal ? sw : sh;
        for (let t = 0; t < len - 8; ) {
          const w = Math.min(len - t, rng.range(14, 30));
          if (rng.chance(0.08)) {
            t += w;
            continue;
          }
          const [hh, ss, ll] = rng.pick(roofs);
          const l = ll + rng.range(-5, 5);
          const bx = horizontal ? sx + t : sx;
          const by = horizontal ? sy : sy + t;
          const bw = horizontal ? w - 2 : sw;
          const bh = horizontal ? sh : w - 2;
          // Two roof slopes, one lit and one in shade, the ridge parallel to the street.
          ctx.fillStyle = hsl(hh, ss, l + 6);
          ctx.fillRect(bx, by, horizontal ? bw : bw / 2, horizontal ? bh / 2 : bh);
          ctx.fillStyle = hsl(hh, ss, l - 6);
          ctx.fillRect(horizontal ? bx : bx + bw / 2, horizontal ? by + bh / 2 : by, horizontal ? bw : bw / 2, horizontal ? bh / 2 : bh);
          ctx.fillStyle = 'rgba(0,0,0,0.25)';
          if (horizontal) ctx.fillRect(bx + bw - 1.5, by, 1.5, bh);
          else ctx.fillRect(bx, by + bh - 1.5, bw, 1.5);
          t += w;
        }
      }
      // A few garden trees.
      for (let k = rng.int(1, 4); k > 0; k--) {
        const r = rng.range(5, 9);
        ctx.fillStyle = hsl(105 + rng.range(-12, 10), 30, 26);
        ctx.beginPath();
        ctx.arc(rng.range(x0 + depth + 8, Math.max(x0 + depth + 9, x1 - depth - 8)), rng.range(y0 + depth + 8, Math.max(y0 + depth + 9, y1 - depth - 8)), r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  speckle(ctx, S, S, rng, 12000, 0.06);
  return c;
}

/** Forest canopy: overlapping tree crowns lit from one side, with dark gaps between. */
function forestTexture(): HTMLCanvasElement {
  const S = 1024;
  const [c, ctx] = canvas(S, S);
  const rng = new Rng('forest');
  ctx.fillStyle = hsl(110, 30, 14);
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 2600; i++) {
    const r = rng.range(9, 24);
    const conifer = rng.chance(0.35);
    const h = conifer ? rng.range(130, 150) : rng.range(85, 115);
    const sat = conifer ? rng.range(22, 32) : rng.range(30, 44);
    const l = conifer ? rng.range(18, 26) : rng.range(24, 36);
    wrapped(S, rng.range(0, S), rng.range(0, S), r, (px, py) => {
      const rg = ctx.createRadialGradient(px - r * 0.35, py - r * 0.35, r * 0.1, px, py, r);
      rg.addColorStop(0, hsl(h - 4, sat, l + 12));
      rg.addColorStop(0.7, hsl(h, sat, l));
      rg.addColorStop(1, hsl(h, sat, l - 8, 0.9));
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  speckle(ctx, S, S, rng, 8000, 0.06);
  return c;
}

/** Landfill: grey-brown rubble with flecks of colour, bare soil caps, puddles and dozer tracks. */
function landfillTexture(): HTMLCanvasElement {
  const S = 1024;
  const [c, ctx] = canvas(S, S);
  const rng = new Rng('landfill');
  ctx.fillStyle = hsl(36, 10, 40);
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 40; i++) {
    const r = rng.range(50, 160);
    const tone = rng.chance(0.4) ? hsl(30, 22, 34, 0.4) : hsl(40, 6, rng.range(36, 50), 0.4);
    wrapped(S, rng.range(0, S), rng.range(0, S), r, (px, py) => {
      const rg = ctx.createRadialGradient(px, py, 0, px, py, r);
      rg.addColorStop(0, tone);
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = rg;
      ctx.fillRect(px - r, py - r, r * 2, r * 2);
    });
  }
  const flecks = ['#c1121f', '#1d4e89', '#f4f4f4', '#e9c46a', '#2a9d8f', '#3a3a3a', '#d8c4a8'];
  for (let i = 0; i < 26000; i++) {
    ctx.fillStyle = rng.chance(0.12) ? rng.pick(flecks) : hsl(36, rng.range(4, 14), rng.range(24, 58), 0.7);
    const s = rng.range(1, 4);
    ctx.fillRect(rng.range(0, S), rng.range(0, S), s, s * rng.range(0.6, 1.6));
  }
  for (let i = 0; i < 7; i++) {
    const r = rng.range(14, 40);
    const a = rng.range(0, Math.PI);
    wrapped(S, rng.range(0, S), rng.range(0, S), r, (px, py) => {
      ctx.fillStyle = hsl(200, 12, 24, 0.7);
      ctx.beginPath();
      ctx.ellipse(px, py, r, r * 0.6, a, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  ctx.strokeStyle = 'rgba(60,48,36,0.35)';
  ctx.lineWidth = 5;
  for (let i = 0; i < 6; i++) {
    const r = rng.range(120, 300);
    const x = rng.range(r, S - r);
    const y = rng.range(r, S - r);
    const a = rng.range(0, Math.PI * 2);
    ctx.beginPath();
    ctx.arc(x, y, r, a, a + rng.range(0.6, 1.4));
    ctx.stroke();
  }
  return c;
}

const floorCache = new Map<FloorMaterialId, FloorTextureInfo>();

/**
 * Dark space with `n` specks of starlight over a soft `glow` haze (the Galaxy's placeholder floors,
 * Act 8 groundwork: the world pass paints the disc instead).
 */
function starfieldTexture(base: string, glow: string, speck: string, n: number): HTMLCanvasElement {
  const S = 256;
  const [c, ctx] = canvas(S, S);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, S, S);
  const rng = new Rng(n);
  ctx.fillStyle = glow;
  for (let i = 0; i < 18; i++) {
    ctx.globalAlpha = rng.range(0.04, 0.12);
    ctx.beginPath();
    ctx.arc(rng.range(0, S), rng.range(0, S), rng.range(20, 60), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = speck;
  for (let i = 0; i < n; i++) {
    ctx.globalAlpha = rng.range(0.15, 0.85);
    const r = rng.range(0.4, 1.6);
    ctx.fillRect(rng.range(0, S), rng.range(0, S), r, r);
  }
  ctx.globalAlpha = 1;
  return c;
}

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
      // Region floors: world sizes in Region units (1 = 10 m), seen from a few kilometres up.
      case 'fields':
        info = { texture: toTexture(fieldsTexture()), worldSize: 72, roughness: 1 };
        break;
      case 'motorway':
        info = { texture: toTexture(motorwayTexture()), worldSize: 9, roughness: 0.92 };
        break;
      case 'water':
        info = { texture: toTexture(waterTexture()), worldSize: 16, roughness: 0.32 };
        break;
      case 'townRoofs':
        info = { texture: toTexture(townRoofsTexture()), worldSize: 18, roughness: 0.85 };
        break;
      case 'forest':
        info = { texture: toTexture(forestTexture()), worldSize: 20, roughness: 1 };
        break;
      case 'landfill':
        info = { texture: toTexture(landfillTexture()), worldSize: 16, roughness: 0.95 };
        break;
      // Continent floors (1 unit = 10 km), seen from the stratosphere: continentTextures.ts.
      case 'steppe':
        info = { texture: toTexture(steppeTexture()), worldSize: 40, roughness: 1 };
        break;
      case 'highlands':
        info = { texture: toTexture(highlandsTexture()), worldSize: 26, roughness: 0.95 };
        break;
      case 'lakeWater':
        info = { texture: toTexture(lakeWaterTexture()), worldSize: 20, roughness: 0.3 };
        break;
      case 'desertSand':
        info = { texture: toTexture(desertTexture()), worldSize: 28, roughness: 1 };
        break;
      case 'tundraSnow':
        info = { texture: toTexture(tundraTexture()), worldSize: 30, roughness: 0.8 };
        break;
      case 'ruinsAsh':
        info = { texture: toTexture(ruinsTexture()), worldSize: 12, roughness: 0.95 };
        break;
      case 'ocean':
        info = { texture: toTexture(oceanTexture()), worldSize: 40, roughness: 0.35 };
        break;
      // Globe floors (1 unit = 1,000 km), seen from orbit: globeTextures.ts. HouseView paints the map
      // itself (buildGlobeSurface); these tile the ground past the poles. Sizes divide the 480-unit lap.
      case 'globeOcean':
        info = { texture: toTexture(globeOceanTexture()), worldSize: 40, roughness: 0.2 };
        break;
      case 'globeShelf':
        info = { texture: toTexture(globeShelfTexture()), worldSize: 30, roughness: 0.3 };
        break;
      case 'globeLand':
        info = { texture: toTexture(globeLandTexture()), worldSize: 40, roughness: 1 };
        break;
      case 'globeIce':
        info = { texture: toTexture(globeIceTexture()), worldSize: 40, roughness: 0.5 };
        break;
      // Solar System floors (1 unit = 0.01 AU, solarTextures.ts): past the painted ecliptic.
      case 'solarSpace':
        info = { texture: toTexture(solarSpaceTexture()), worldSize: 40, roughness: 1 };
        break;
      case 'solarCorona':
        info = { texture: toTexture(solarCoronaTexture()), worldSize: 30, roughness: 1 };
        break;
      case 'solarBelt':
        info = { texture: toTexture(solarBeltTexture()), worldSize: 30, roughness: 1 };
        break;
      case 'solarKuiper':
        info = { texture: toTexture(solarKuiperTexture()), worldSize: 40, roughness: 1 };
        break;
      // Galaxy floors (1 unit = 100 ly): placeholder starfields until the disc is painted.
      case 'galaxyCore':
        info = { texture: toTexture(starfieldTexture('#2a1a10', '#ffcf8a', '#fff1d0', 1400)), worldSize: 30, roughness: 1 };
        break;
      case 'galaxyArm':
        info = { texture: toTexture(starfieldTexture('#0c1028', '#7a8cff', '#e8f0ff', 900)), worldSize: 40, roughness: 1 };
        break;
      case 'galaxyDust':
        info = { texture: toTexture(starfieldTexture('#08060c', '#5a2a4a', '#b8a8c8', 160)), worldSize: 40, roughness: 1 };
        break;
      case 'galaxyHalo':
        info = { texture: toTexture(starfieldTexture('#030308', '#2a2a5a', '#c9d4ff', 90)), worldSize: 50, roughness: 1 };
        break;
      // Universe floors (1 unit = 10 Mly): fields of faint galaxies in the web's colours. The view
      // paints the web as one plane (universeTextures.ts), so only `universeVoid` shows, as the outer
      // floor past the painting.
      case 'universeNode':
        info = { texture: toTexture(starfieldTexture('#1c1218', '#ffc88a', '#fff0d8', 1000)), worldSize: 30, roughness: 1 };
        break;
      case 'universeFilament':
        info = { texture: toTexture(starfieldTexture('#0a1030', '#7a9cff', '#e8f0ff', 700)), worldSize: 40, roughness: 1 };
        break;
      case 'universeSheet':
        info = { texture: toTexture(starfieldTexture('#04060f', '#2a3466', '#b8c4f0', 200)), worldSize: 40, roughness: 1 };
        break;
      case 'universeVoid':
        info = { texture: toTexture(starfieldTexture('#010103', '#140f22', '#7a6c98', 24)), worldSize: 50, roughness: 1 };
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
