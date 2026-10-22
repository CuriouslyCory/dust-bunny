/**
 * Continent floor textures (browser only): the landmass from the stratosphere at dusk. Each is a
 * tileable canvas built from periodic value noise with baked hill shading (light low from the
 * west, like the dusk sun in lighting.ts), so the floor reads as terrain relief even though it is
 * flat: grassland with farmland patchwork, mountain relief with snow on the heights, dunes,
 * snowfields with exposed tundra, ash over ruined street grids, lake water and the open ocean.
 * Canvas +x is world +x (east) and canvas +y is world +z (south): houseView maps uv = (x, −z).
 */
import { Rng } from '../core/rng';

type RGB = readonly [number, number, number];

function canvas(S: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  return [c, c.getContext('2d')!];
}

const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

/** Tileable value noise with `cells` lattice cells per side; (u, v) in [0, 1). */
function tileNoise(rng: Rng, cells: number): (u: number, v: number) => number {
  const g = new Float32Array(cells * cells);
  for (let i = 0; i < g.length; i++) g[i] = rng.next();
  return (u, v) => {
    const x = u * cells;
    const y = v * cells;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const i0 = ((x0 % cells) + cells) % cells;
    const j0 = ((y0 % cells) + cells) % cells;
    const i1 = (i0 + 1) % cells;
    const j1 = (j0 + 1) % cells;
    const a = g[j0 * cells + i0]!;
    const b = g[j0 * cells + i1]!;
    const c = g[j1 * cells + i0]!;
    const d = g[j1 * cells + i1]!;
    return a + (b - a) * sx + (c - a + (a - b - c + d) * sx) * sy;
  };
}

/** Tileable fBm height field (0..1) from octaves of [cells, amplitude]; `ridged` folds each octave into sharp crests. */
function heightField(S: number, rng: Rng, octaves: ReadonlyArray<readonly [number, number]>, ridged = false, warp = 0): Float32Array {
  const fns = octaves.map(([c]) => tileNoise(rng, c));
  const wx = tileNoise(rng, 4);
  const wy = tileNoise(rng, 4);
  const total = octaves.reduce((s, [, a]) => s + a, 0);
  const out = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let u = x / S;
      let v = y / S;
      if (warp) {
        u = (u + (wx(u, v) - 0.5) * warp + 1) % 1;
        v = (v + (wy(u, v) - 0.5) * warp + 1) % 1;
      }
      let h = 0;
      for (let k = 0; k < fns.length; k++) {
        let n = fns[k]!(u, v);
        if (ridged) n = 1 - Math.abs(n * 2 - 1);
        h += n * octaves[k]![1];
      }
      out[y * S + x] = h / total;
    }
  }
  return out;
}

/**
 * The same at half resolution, bilinearly upsampled to S × S (wrapping): the relief is smooth at
 * that scale and it is a quarter of the work (these build while the chapter card shows).
 */
function heightFieldHalf(S: number, rng: Rng, octaves: ReadonlyArray<readonly [number, number]>, ridged = false, warp = 0): Float32Array {
  const H = S >> 1;
  const half = heightField(H, rng, octaves, ridged, warp);
  const out = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    const fy = y / 2;
    const y0 = Math.floor(fy);
    const ty = fy - y0;
    const r0 = y0 * H;
    const r1 = ((y0 + 1) % H) * H;
    for (let x = 0; x < S; x++) {
      const fx = x / 2;
      const x0 = Math.floor(fx);
      const tx = fx - x0;
      const x1 = (x0 + 1) % H;
      const a = half[r0 + x0]!;
      const b = half[r0 + x1]!;
      const c = half[r1 + x0]!;
      const d = half[r1 + x1]!;
      out[y * S + x] = a + (b - a) * tx + (c - a + (a - b - c + d) * tx) * ty;
    }
  }
  return out;
}

/** Hill shading of a tileable height field: 1 on flat ground, brighter on west-facing slopes. */
function hillshade(h: Float32Array, S: number, relief: number): Float32Array {
  const out = new Float32Array(S * S);
  // Towards the dusk sun: low in the west, a little south (canvas −x, +y).
  const lx = -0.88;
  const ly = 0.2;
  const lz = 0.43;
  for (let y = 0; y < S; y++) {
    const ym = ((y - 1 + S) % S) * S;
    const yp = ((y + 1) % S) * S;
    for (let x = 0; x < S; x++) {
      const xm = (x - 1 + S) % S;
      const xp = (x + 1) % S;
      const dx = (h[y * S + xp]! - h[y * S + xm]!) * relief;
      const dy = (h[yp + x]! - h[ym + x]!) * relief;
      const inv = 1 / Math.hypot(dx, dy, 1);
      out[y * S + x] = Math.max(0.25, ((-dx * lx - dy * ly + lz) * inv) / lz);
    }
  }
  return out;
}

/** Colour at t (0..1) along `stops` (ascending t). */
function ramp(stops: ReadonlyArray<readonly [number, RGB]>, t: number, out: number[]): number[] {
  let i = 0;
  while (i < stops.length - 2 && t > stops[i + 1]![0]) i++;
  const [t0, a] = stops[i]!;
  const [t1, b] = stops[i + 1]!;
  const k = Math.min(1, Math.max(0, (t - t0) / (t1 - t0 || 1)));
  out[0] = a[0] + (b[0] - a[0]) * k;
  out[1] = a[1] + (b[1] - a[1]) * k;
  out[2] = a[2] + (b[2] - a[2]) * k;
  return out;
}

/** Writes per-pixel colours: `color(i, out)` fills out with RGB 0..255. */
function paint(ctx: CanvasRenderingContext2D, S: number, color: (i: number, out: number[]) => void): void {
  const img = ctx.createImageData(S, S);
  const d = img.data;
  const c = [0, 0, 0];
  for (let i = 0; i < S * S; i++) {
    color(i, c);
    d[i * 4] = Math.max(0, Math.min(255, c[0]!));
    d[i * 4 + 1] = Math.max(0, Math.min(255, c[1]!));
    d[i * 4 + 2] = Math.max(0, Math.min(255, c[2]!));
    d[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

/** Draws `fn` at (x, y) and its wrapped copies so shapes crossing an edge tile seamlessly. */
function wrapped(S: number, x: number, y: number, r: number, fn: (x: number, y: number) => void): void {
  for (const ox of [0, -S, S]) for (const oy of [0, -S, S]) if (x + ox > -r && x + ox < S + r && y + oy > -r && y + oy < S + r) fn(x + ox, y + oy);
}

/** Plains: grassland and dry steppe in broad patches, low relief, farmland patchwork and dark woods. */
export function steppeTexture(): HTMLCanvasElement {
  const S = 1024;
  const [c, ctx] = canvas(S);
  const rng = new Rng('continent:steppe');
  const relief = heightFieldHalf(S, rng, [[6, 1], [12, 0.5], [24, 0.22]], false, 0.04);
  const moist = heightFieldHalf(S, rng, [[3, 1], [7, 0.6], [16, 0.3]], false, 0.05);
  const sh = hillshade(relief, S, 14);
  const stops = [
    [0, hex('#4a6436')],
    [0.42, hex('#61793f')],
    [0.6, hex('#7f8a4a')],
    [0.78, hex('#a39a5f')],
    [1, hex('#b8a96c')],
  ] as const;
  paint(ctx, S, (i, out) => {
    ramp(stops, 1 - moist[i]!, out);
    const s = sh[i]!;
    out[0] *= s;
    out[1] *= s;
    out[2] *= s * 0.97;
  });
  // Farmland patchwork in clusters, fields at their own angle.
  const crops = ['#8c9a4c', '#b7a75e', '#6d8a3e', '#a08654', '#c9b46c', '#7a9350', '#5e7a3a'];
  for (let k = 0; k < 16; k++) {
    const cx = rng.range(0, S);
    const cy = rng.range(0, S);
    const a = rng.range(-0.4, 0.4);
    const n = rng.int(14, 34);
    const cell = rng.range(18, 30);
    wrapped(S, cx, cy, cell * 6, (px, py) => {
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(a);
      for (let f = 0; f < n; f++) {
        const gx = rng.int(-3, 3);
        const gy = rng.int(-3, 3);
        ctx.fillStyle = rng.pick(crops);
        ctx.globalAlpha = rng.range(0.5, 0.8);
        ctx.fillRect(gx * cell, gy * cell, cell - 2.5, cell - 2.5);
      }
      ctx.restore();
    });
  }
  ctx.globalAlpha = 1;
  // Woods.
  for (let k = 0; k < 70; k++) {
    // A wood: a clump of overlapping dark crowns.
    const cx = rng.range(0, S);
    const cy = rng.range(0, S);
    const n = rng.int(6, 22);
    for (let i = 0; i < n; i++) {
      const r = rng.range(4, 11);
      wrapped(S, cx + rng.range(-24, 24), cy + rng.range(-24, 24), r, (px, py) => {
        ctx.fillStyle = `rgba(38,60,34,${rng.range(0.45, 0.7)})`;
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  }
  return c;
}

/** Mountains: ridged relief, green-brown valleys, grey rock, snow on the heights (bright on the sunlit side). */
export function highlandsTexture(): HTMLCanvasElement {
  const S = 1024;
  const [c, ctx] = canvas(S);
  const rng = new Rng('continent:highlands');
  const h = heightFieldHalf(S, rng, [[5, 1], [10, 0.6], [20, 0.32], [40, 0.16], [80, 0.07]], true, 0.12);
  const sh = hillshade(h, S, 90);
  const stops = [
    [0, hex('#56603a')],
    [0.45, hex('#6f6a4c')],
    [0.6, hex('#80746a')],
    [0.72, hex('#958d84')],
    [0.78, hex('#e8edf2')],
    [1, hex('#f7f9fb')],
  ] as const;
  paint(ctx, S, (i, out) => {
    ramp(stops, h[i]!, out);
    const s = sh[i]!;
    // Shadowed snow goes blue, shadowed rock goes violet-brown (dusk sky fill).
    const snow = out[2]! > 200;
    out[0] *= snow ? 0.55 + s * 0.45 : s;
    out[1] *= snow ? 0.62 + s * 0.38 : s;
    out[2] *= snow ? 0.8 + s * 0.2 : s * 1.02;
  });
  return c;
}

/** Desert: linear dunes over sand, darker rocky reg and pale pans. */
export function desertTexture(): HTMLCanvasElement {
  const S = 1024;
  const [c, ctx] = canvas(S);
  const rng = new Rng('continent:desert');
  const base = heightFieldHalf(S, rng, [[4, 1], [9, 0.5], [20, 0.25]], false, 0.2);
  const warp = tileNoise(rng, 6);
  const dunes = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const v = y / S;
      // Crests running roughly north-south (8 per tile), bent by the noise; asymmetric like real dunes.
      const p = (u + (warp(u, v) - 0.5) * 0.2) * 18;
      const crest = 0.5 + 0.5 * Math.sin(p * Math.PI * 2 + Math.sin(p * Math.PI * 2) * 0.5);
      dunes[y * S + x] = crest * 0.04 + base[y * S + x]! * 0.96;
    }
  }
  const sh = hillshade(dunes, S, 14);
  const stops = [
    [0, hex('#9a6a42')],
    [0.3, hex('#bd8550')],
    [0.55, hex('#d3a064')],
    [0.8, hex('#e0b77c')],
    [1, hex('#ead0a0')],
  ] as const;
  paint(ctx, S, (i, out) => {
    ramp(stops, base[i]!, out);
    const s = sh[i]!;
    out[0] *= s;
    out[1] *= s * 0.98;
    out[2] *= s * 0.95;
  });
  for (let k = 0; k < 10; k++) {
    const r = rng.range(14, 40);
    wrapped(S, rng.range(0, S), rng.range(0, S), r, (px, py) => {
      const g = ctx.createRadialGradient(px, py, 0, px, py, r);
      g.addColorStop(0, 'rgba(240,232,214,0.75)');
      g.addColorStop(1, 'rgba(240,232,214,0)');
      ctx.fillStyle = g;
      ctx.fillRect(px - r, py - r, r * 2, r * 2);
    });
  }
  return c;
}

/** Tundra: snowfields with blue shadows, exposed brown tundra and rock, frozen lakes. */
export function tundraTexture(): HTMLCanvasElement {
  const S = 1024;
  const [c, ctx] = canvas(S);
  const rng = new Rng('continent:tundra');
  const h = heightFieldHalf(S, rng, [[5, 1], [11, 0.55], [24, 0.25]], false, 0.06);
  const bare = heightFieldHalf(S, rng, [[6, 1], [14, 0.5], [32, 0.3]], false, 0.06);
  const sh = hillshade(h, S, 22);
  const snow = hex('#eef3f7');
  const ground = hex('#8b8572');
  const out2 = [0, 0, 0];
  paint(ctx, S, (i, out) => {
    const b = Math.min(1, Math.max(0, (bare[i]! - 0.58) * 6));
    out2[0] = snow[0] + (ground[0] - snow[0]) * b;
    out2[1] = snow[1] + (ground[1] - snow[1]) * b;
    out2[2] = snow[2] + (ground[2] - snow[2]) * b;
    const s = sh[i]!;
    out[0] = out2[0]! * (0.5 + s * 0.5);
    out[1] = out2[1]! * (0.6 + s * 0.4);
    out[2] = out2[2]! * (0.82 + s * 0.18);
  });
  for (let k = 0; k < 40; k++) {
    const r = rng.range(3, 9);
    const a = rng.range(0, Math.PI);
    wrapped(S, rng.range(0, S), rng.range(0, S), r, (px, py) => {
      ctx.fillStyle = 'rgba(176,206,222,0.85)';
      ctx.beginPath();
      ctx.ellipse(px, py, r, r * rng.range(0.4, 0.8), a, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  return c;
}

/** Ruins: ash and rubble over what is left of a street grid, scorch marks, green coming back. */
export function ruinsTexture(): HTMLCanvasElement {
  const S = 512;
  const [c, ctx] = canvas(S);
  const rng = new Rng('continent:ruins');
  const h = heightFieldHalf(S, rng, [[6, 1], [16, 0.5], [40, 0.25]]);
  paint(ctx, S, (i, out) => {
    const v = 86 + h[i]! * 40;
    out[0] = v;
    out[1] = v * 0.97;
    out[2] = v * 0.93;
  });
  // Street grid (broken), blocks of rubble.
  const block = 32;
  for (let gx = 0; gx < S; gx += block) {
    for (let gy = 0; gy < S; gy += block) {
      if (rng.chance(0.8)) {
        ctx.fillStyle = `rgba(150,144,136,${rng.range(0.25, 0.5)})`;
        ctx.fillRect(gx + 4, gy + 4, block - 8, block - 8);
        for (let k = 0; k < 6; k++) {
          ctx.fillStyle = rng.chance(0.3) ? 'rgba(52,48,45,0.7)' : `rgba(${rng.int(150, 190)},${rng.int(145, 180)},${rng.int(135, 170)},0.7)`;
          ctx.fillRect(gx + rng.range(5, block - 10), gy + rng.range(5, block - 10), rng.range(2, 6), rng.range(2, 6));
        }
      }
    }
  }
  ctx.strokeStyle = 'rgba(48,45,42,0.75)';
  ctx.lineWidth = 2;
  for (let p = 0; p <= S; p += block) {
    for (let s = 0; s < S; s += block) {
      if (rng.chance(0.82)) {
        ctx.beginPath();
        ctx.moveTo(p, s);
        ctx.lineTo(p, s + block);
        ctx.stroke();
      }
      if (rng.chance(0.82)) {
        ctx.beginPath();
        ctx.moveTo(s, p);
        ctx.lineTo(s + block, p);
        ctx.stroke();
      }
    }
  }
  for (let k = 0; k < 18; k++) {
    const r = rng.range(16, 50);
    const green = rng.chance(0.4);
    wrapped(S, rng.range(0, S), rng.range(0, S), r, (px, py) => {
      const g = ctx.createRadialGradient(px, py, 0, px, py, r);
      g.addColorStop(0, green ? 'rgba(84,104,60,0.5)' : 'rgba(30,26,24,0.55)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(px - r, py - r, r * 2, r * 2);
    });
  }
  return c;
}

/** Lake and river water from the stratosphere: deep blue with drifting lighter bands. */
export function lakeWaterTexture(): HTMLCanvasElement {
  const S = 512;
  const [c, ctx] = canvas(S);
  const rng = new Rng('continent:lake');
  const h = heightFieldHalf(S, rng, [[4, 1], [9, 0.5], [22, 0.25]], false, 0.3);
  const stops = [
    [0, hex('#24506f')],
    [0.5, hex('#2e6185')],
    [1, hex('#3d7597')],
  ] as const;
  paint(ctx, S, (i, out) => ramp(stops, h[i]!, out));
  return c;
}

/** The ocean past the coast: dark blue with long swell streaks. */
export function oceanTexture(): HTMLCanvasElement {
  const S = 512;
  const [c, ctx] = canvas(S);
  const rng = new Rng('continent:ocean');
  const h = heightFieldHalf(S, rng, [[3, 1], [8, 0.5], [20, 0.2]], false, 0.25);
  const stops = [
    [0, hex('#173554')],
    [0.5, hex('#1d4265')],
    [1, hex('#255074')],
  ] as const;
  paint(ctx, S, (i, out) => ramp(stops, h[i]!, out));
  for (let k = 0; k < 500; k++) {
    const l = rng.range(10, 40);
    const alpha = rng.range(0.03, 0.08);
    wrapped(S, rng.range(0, S), rng.range(0, S), l, (px, py) => {
      ctx.strokeStyle = `rgba(190,215,235,${alpha})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + l, py + l * 0.12);
      ctx.stroke();
    });
  }
  return c;
}

/** Average colour of the ocean texture (the coast overlay fades its deep water into it). */
export const OCEAN_DEEP = '#1d4265';
