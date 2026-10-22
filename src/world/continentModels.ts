/**
 * Continent landmarks (Continent units, 1 = 10 km): the mountain ranges that stand as obstacles.
 * Same conventions as models.ts: +Z front, origin at the footprint centre on the ground, and the
 * shape fills its footprint box (o.w × o.d, long axis along local X) so collision lines up.
 *
 * With the Blender `mountain_range` prop loaded (the one the absorbable Mountain Range Debris
 * uses), a range is that model stretched over the footprint and a massif three of them side by
 * side, so the ranges too big to eat look like the ones that are not. Without it (or headless),
 * a procedural range: a displaced grid coloured by height (foothill green, brown and grey rock,
 * snow caps above a ragged snow line), flat-shaded and vertex-coloured for the static batch.
 */
import { Box3, BufferGeometry, Color, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { Rng } from '../core/rng';
import { getModelTemplate, hasModel, registerModel, type ModelOptions } from './models';

let vertexMat: MeshStandardMaterial | null = null;
function vertexColored(): MeshStandardMaterial {
  return (vertexMat ??= new MeshStandardMaterial({ vertexColors: true, roughness: 0.92 }));
}

const BANDS: ReadonlyArray<readonly [number, Color]> = [
  [0, new Color('#5f6d3e')],
  [0.12, new Color('#6c6a45')],
  [0.3, new Color('#77654f')],
  [0.48, new Color('#8a8074')],
  [0.6, new Color('#a19a90')],
];
const SNOW = new Color('#f2f5f8');

interface Peak {
  u: number;
  v: number;
  h: number;
  /** Falloff along / across the range (higher = steeper). */
  ku: number;
  kv: number;
}

/**
 * A range of peaks filling a w × d footprint with peak height h: pointed summits along a wandering
 * crest (or spread over both axes for a `massif`), cut by ridged gullies and spurs, flat-shaded.
 */
function mountains(o: ModelOptions, massif: boolean): Group {
  const rng = new Rng(o.seed ?? 51);
  const { w, d, h } = o;
  const crest = Array.from({ length: 3 }, () => ({ f: rng.range(2, 5), p: rng.range(0, 6.3), a: rng.range(0.04, 0.1) }));
  const crestAt = (u: number) => (massif ? 0 : crest.reduce((s, c) => s + Math.sin(u * c.f + c.p) * c.a, 0));
  const peaks: Peak[] = [];
  const n = massif ? rng.int(7, 10) : Math.max(5, Math.round(w / 2.2));
  for (let i = 0; i < n; i++) {
    const u = massif ? rng.range(-0.62, 0.62) : -0.8 + (1.6 * (i + rng.range(0.25, 0.75))) / n;
    const v = massif ? rng.range(-0.55, 0.55) : crestAt(u) + rng.range(-0.06, 0.06);
    const centre = 1 - Math.abs(u) * 0.4;
    peaks.push({ u, v, h: rng.range(0.62, 1) * centre, ku: massif ? rng.range(2.4, 3.2) : rng.range(3, 4.4), kv: massif ? rng.range(2.2, 3) : rng.range(1.7, 2.3) });
  }
  const top = Math.max(...peaks.map((p) => p.h));
  for (const p of peaks) p.h /= top;
  const gullies = Array.from({ length: 5 }, () => ({ a: rng.range(5, 13), b: rng.range(5, 13) * rng.sign(), p: rng.range(0, 6.3), k: rng.range(0.5, 1) }));
  const spur = { f: rng.range(9, 15), p: rng.range(0, 6.3) };
  const snowWaves = Array.from({ length: 3 }, () => ({ fu: rng.range(6, 16), fv: rng.range(6, 16), p: rng.range(0, 6.3) }));
  const heightAt = (u: number, v: number): number => {
    // Envelope: 0 at the footprint edge (the foothills reach it), 1 inside.
    // Envelope: rises gently from 0 at the footprint edge (foothills) to 1 inside.
    const ss = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
    const e = ss((1 - Math.abs(u)) / 0.4) * ss((1 - Math.abs(v)) / (massif ? 0.45 : 0.6));
    if (e <= 0) return 0;
    let m = 0;
    for (const p of peaks) m = Math.max(m, p.h * Math.exp(-Math.hypot((u - p.u) * p.ku, (v - p.v) * p.kv)));
    // Ridged gullies (sharper high up) and spurs running down from the crest.
    let g = 0;
    let gk = 0;
    for (const q of gullies) {
      g += (1 - Math.abs(Math.sin(u * q.a + v * q.b + q.p))) * q.k;
      gk += q.k;
    }
    const spurs = 0.88 + 0.12 * Math.abs(Math.sin(u * spur.f + spur.p));
    return h * e * (0.06 + 0.94 * m * (0.74 + 0.26 * (g / gk)) * spurs);
  };
  const segX = Math.max(28, Math.min(80, Math.round(w * 4)));
  const segZ = Math.max(16, Math.min(56, Math.round(d * 4)));
  const pos: number[] = [];
  const col: number[] = [];
  const c = new Color();
  const vertex = (i: number, j: number) => {
    const u = (i / segX) * 2 - 1;
    const v = (j / segZ) * 2 - 1;
    const y = heightAt(u, v);
    return { x: (u * w) / 2, y: y > 0 ? y : -0.04, z: (v * d) / 2, u, v, t: y / h };
  };
  const colorAt = (t: number, u: number, v: number, steep: number) => {
    let sn = 0;
    for (const k of snowWaves) sn += Math.sin(u * k.fu + k.p) * Math.cos(v * k.fv - k.p);
    const snowLine = 0.56 + sn * 0.04 + steep * 0.12;
    if (t > snowLine) return c.copy(SNOW);
    let b = 0;
    while (b < BANDS.length - 2 && t > BANDS[b + 1]![0]) b++;
    const [t0, a] = BANDS[b]!;
    const [t1, bb] = BANDS[b + 1]!;
    c.copy(a).lerp(bb, Math.min(1, Math.max(0, (t - t0) / (t1 - t0))));
    // Steep faces show bare, darker rock.
    return c.multiplyScalar(1 - steep * 0.25);
  };
  // Flat-shaded triangles (non-indexed), coloured per face: crisp facets catch the low sun.
  const grid = [] as Array<ReturnType<typeof vertex>>;
  for (let j = 0; j <= segZ; j++) for (let i = 0; i <= segX; i++) grid.push(vertex(i, j));
  const at = (i: number, j: number) => grid[j * (segX + 1) + i]!;
  const tri = (a: ReturnType<typeof vertex>, b: ReturnType<typeof vertex>, cc: ReturnType<typeof vertex>) => {
    const t = Math.max(a.t, b.t, cc.t) * 0.6 + ((a.t + b.t + cc.t) / 3) * 0.4;
    const span = Math.max(a.y, b.y, cc.y) - Math.min(a.y, b.y, cc.y);
    const steep = Math.min(1, span / (Math.max(w / segX, d / segZ) * 2.2));
    colorAt(t, (a.u + b.u + cc.u) / 3, (a.v + b.v + cc.v) / 3, steep);
    const shade = 0.94 + rng.range(0, 0.1);
    for (const p of [a, b, cc]) {
      pos.push(p.x, p.y, p.z);
      col.push(c.r * shade, c.g * shade, c.b * shade);
    }
  };
  for (let j = 0; j < segZ; j++) {
    for (let i = 0; i < segX; i++) {
      const a = at(i, j);
      const b = at(i + 1, j);
      const cc = at(i, j + 1);
      const dd = at(i + 1, j + 1);
      tri(a, cc, b);
      tri(b, cc, dd);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  const group = new Group();
  group.add(new Mesh(g, vertexColored()));
  return group;
}

const _box = new Box3();
const _size = new Vector3();
const _centre = new Vector3();

/** The `mountain_range` prop stretched over a w × d footprint, h tall, centred at (x, z); null without the model. */
function rangeProp(w: number, d: number, h: number, x = 0, z = 0, yaw = 0): Group | null {
  const tpl = getModelTemplate('mountain_range');
  if (!tpl) return null;
  const inner = tpl.clone(true);
  _box.setFromObject(inner);
  _box.getSize(_size);
  _box.getCenter(_centre);
  inner.scale.set(w / (_size.x || 1), h / (_size.y || 1), d / (_size.z || 1));
  inner.position.set(-_centre.x * inner.scale.x, -_box.min.y * inner.scale.y, -_centre.z * inner.scale.z);
  const g = new Group();
  g.add(inner);
  g.position.set(x, 0, z);
  g.rotation.y = yaw;
  return g;
}

function range(o: ModelOptions): Group {
  const prop = rangeProp(o.w, o.d, o.h);
  if (!prop) return mountains(o, false);
  const g = new Group();
  g.add(prop);
  return g;
}

/** A massif: three ranges side by side across the footprint, the middle one tallest. */
function massif(o: ModelOptions): Group {
  const rng = new Rng(o.seed ?? 52);
  const g = new Group();
  const rows = [
    { z: -o.d / 3, w: o.w * rng.range(0.75, 0.9), x: rng.range(-0.06, 0.06) * o.w, h: o.h * rng.range(0.75, 0.88) },
    { z: 0, w: o.w, x: 0, h: o.h },
    { z: o.d / 3, w: o.w * rng.range(0.75, 0.9), x: rng.range(-0.06, 0.06) * o.w, h: o.h * rng.range(0.72, 0.86) },
  ];
  for (const r of rows) {
    const prop = rangeProp(r.w, o.d / 2.2, r.h, r.x, r.z, rng.range(-0.08, 0.08));
    if (!prop) return mountains(o, true);
    g.add(prop);
  }
  return g;
}

const FACTORIES: Record<string, (o: ModelOptions) => Group> = {
  continent_range: range,
  continent_massif: massif,
};
for (const [id, f] of Object.entries(FACTORIES)) if (!hasModel(id)) registerModel(id, f);
