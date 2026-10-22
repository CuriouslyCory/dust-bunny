/**
 * Procedural region landmarks, used when no .glb override is loaded: city centres, hills and
 * ridges (Region units, 1 = 10 m). Same conventions as models.ts: +Z front, origin at the
 * footprint centre on the ground, and the shape fills its footprint box (o.w × o.d) so collision
 * lines up. Low-poly and vertex-coloured: they bake into the static batch. `forestedMound` also
 * builds the wooded hills around the Region's edge (houseView).
 */
import { BufferGeometry, Color, ConeGeometry, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial } from 'three';
import type { Rect } from '../core/math';
import { Rng } from '../core/rng';
import { addBox, addCylinder, hasModel, mat, registerModel, type ModelOptions } from './models';

let vertexMat: MeshStandardMaterial | null = null;
/** Shared vertex-coloured material (the static batch keeps the per-vertex colours). */
function vertexColored(): MeshStandardMaterial {
  return (vertexMat ??= new MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
}

export interface MoundLook {
  /** Colour at the foot and at the top. */
  low: string;
  high: string;
  /** Squareness of the outline (2 = ellipse, higher fills the footprint's corners). */
  square?: number;
  /** Lumpiness as a fraction of the height. */
  noise?: number;
  /** Flattened top: 0 = a dome, 1 = a mesa. */
  plateau?: number;
}

/** Height profile of a mound at (u, v) ∈ [−1, 1]²: 0 at the outline, 1 at the top. */
function profile(u: number, v: number, square: number, plateau: number): number {
  const e = 1 - (Math.abs(u) ** square + Math.abs(v) ** square);
  if (e <= 0) return 0;
  return Math.min(1, e ** 0.65 * (1 + plateau * 1.5));
}

/**
 * A mound filling a w × d footprint with peak height h: a displaced grid with seeded lumps,
 * coloured from `low` to `high` by height. The rim sits a hair below the ground so no seam shows.
 */
export function moundGeometry(w: number, d: number, h: number, seed: number, look: MoundLook): { geometry: BufferGeometry; heightAt(x: number, z: number): number } {
  const rng = new Rng(seed);
  const square = look.square ?? 3;
  const plateau = look.plateau ?? 0;
  const noise = look.noise ?? 0.18;
  const waves = Array.from({ length: 4 }, () => ({ fu: rng.range(1.5, 4.5), fv: rng.range(1.5, 4.5), p: rng.range(0, 6.3), q: rng.range(0, 6.3), a: rng.range(0.4, 1) }));
  const heightAt = (x: number, z: number): number => {
    const u = (x / w) * 2;
    const v = (z / d) * 2;
    const base = profile(u, v, square, plateau);
    if (base <= 0) return 0;
    let n = 0;
    for (const k of waves) n += Math.sin(u * k.fu + k.p) * Math.sin(v * k.fv + k.q) * k.a;
    return h * base * (1 + (n / 2.5) * noise * 2);
  };
  const segX = Math.max(6, Math.min(24, Math.round(w / Math.max(0.6, Math.min(w, d) / 10))));
  const segZ = Math.max(6, Math.min(24, Math.round(d / Math.max(0.6, Math.min(w, d) / 10))));
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const lo = new Color(look.low);
  const hi = new Color(look.high);
  const c = new Color();
  for (let j = 0; j <= segZ; j++) {
    for (let i = 0; i <= segX; i++) {
      const x = (i / segX - 0.5) * w;
      const z = (j / segZ - 0.5) * d;
      const y = heightAt(x, z);
      pos.push(x, y > 0 ? y : -0.05 * Math.min(1, h), z);
      const t = Math.min(1, Math.max(0, y / h));
      c.copy(lo).lerp(hi, t);
      const shade = 0.92 + rng.range(0, 0.16);
      col.push(c.r * shade, c.g * shade, c.b * shade);
    }
  }
  for (let j = 0; j < segZ; j++) {
    for (let i = 0; i < segX; i++) {
      const a = j * (segX + 1) + i;
      const b = a + 1;
      const cc = a + segX + 1;
      const dd = cc + 1;
      idx.push(a, cc, b, b, cc, dd);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return { geometry: g, heightAt };
}

const TREE_GREENS = ['#2f4a26', '#36522b', '#3d5a2e', '#2b4424', '#46632f'];

/**
 * A mound with trees on it: conifers and round crowns scattered over the slopes (`trees` per
 * 100 square units), skipping the steepest rock if `rocky`.
 */
export function forestedMound(w: number, d: number, h: number, seed: number, look: MoundLook, trees: number, treeSize: number): Group {
  const g = new Group();
  const { geometry, heightAt } = moundGeometry(w, d, h, seed, look);
  const ground = new Mesh(geometry, vertexColored());
  g.add(ground);
  const rng = new Rng(seed ^ 0x5a5a);
  const n = Math.round((w * d * trees) / 100);
  for (let i = 0; i < n; i++) {
    const x = rng.range(-w / 2, w / 2) * 0.92;
    const z = rng.range(-d / 2, d / 2) * 0.92;
    const y = heightAt(x, z);
    if (y <= 0.05 * h) continue;
    const s = treeSize * rng.range(0.7, 1.3);
    const m = mat(rng.pick(TREE_GREENS), 1);
    if (rng.chance(0.55)) {
      const cone = new Mesh(new ConeGeometry(s * 0.45, s * 1.6, 5), m);
      cone.position.set(x, y + s * 0.7, z);
      g.add(cone);
    } else {
      addCylinder(g, s * 0.5, s * 0.38, s * 0.7, x, y + s * 0.1, z, m, 6);
    }
  }
  return g;
}

/** City centre: a podium crowded with towers, tallest in the middle, outer towers flush with the footprint. */
function cityCore(o: ModelOptions): Group {
  const rng = new Rng(o.seed ?? 41);
  const g = new Group();
  addBox(g, o.w, 0.25, o.d, 0, 0, 0, mat('#8d8f93', 0.9));
  const shells = ['#d8dbe0', '#bfc6cf', '#c9b48f', '#a4513f', '#e6d3b3', '#9aa3ad', '#d9d1c4'];
  const glasses = ['#3f6f8f', '#2f5f7a', '#5d8aa8', '#33485c'];
  const nx = Math.max(2, Math.round(o.w / 2.6));
  const nz = Math.max(2, Math.round(o.d / 2.6));
  const cw = o.w / nx;
  const cd = o.d / nz;
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const dn = Math.hypot((i + 0.5) / nx - 0.5, (j + 0.5) / nz - 0.5) * 2;
      const h = o.h * Math.min(1, Math.max(0.22, 1 - dn * 0.55 + rng.range(-0.18, 0.12)));
      const tw = cw * rng.range(0.72, 0.92);
      const td = cd * rng.range(0.72, 0.92);
      const x = i === 0 ? -o.w / 2 + tw / 2 : i === nx - 1 ? o.w / 2 - tw / 2 : -o.w / 2 + cw * (i + 0.5);
      const z = j === 0 ? -o.d / 2 + td / 2 : j === nz - 1 ? o.d / 2 - td / 2 : -o.d / 2 + cd * (j + 0.5);
      const shell = mat(rng.pick(shells), 0.6, 0.1);
      const glass = mat(rng.pick(glasses), 0.25, 0.3);
      addBox(g, tw, h, td, x, 0.25, z, shell);
      // Window bands: one slightly proud box per band.
      const band = rng.range(0.55, 0.8);
      for (let y = 0.6; y + band * 0.5 < h; y += band) addBox(g, tw + 0.04, band * 0.45, td + 0.04, x, 0.25 + y, z, glass);
      addBox(g, tw * 0.5, 0.25, td * 0.45, x + rng.range(-0.1, 0.1) * tw, 0.25 + h, z, mat('#8d939b', 0.7));
      if (h > o.h * 0.9) addCylinder(g, 0.03, 0.07, o.h * 0.15, x, 0.5 + h, z, mat('#c0c4c8', 0.4, 0.6), 6);
    }
  }
  return g;
}

/** Hill: a grassy dome with a wooded crown. */
function hill(o: ModelOptions): Group {
  return forestedMound(o.w, o.d, o.h, o.seed ?? 42, { low: '#7d8f4e', high: '#55693a', square: 3.2, noise: 0.22 }, 7, 0.8);
}

/** Ridge: a long rocky crest with scrub on its lower slopes. */
function ridge(o: ModelOptions): Group {
  return forestedMound(o.w, o.d, o.h, o.seed ?? 43, { low: '#6f7a4a', high: '#8a8273', square: 3.5, noise: 0.35, plateau: 0.15 }, 5, 0.7);
}

/**
 * Closed roadblock where a motorway leaves the Region (world coordinates, spanning the opening
 * `r`): alternating orange and white barrier blocks under a striped boom on two posts.
 */
export function regionRoadblock(r: Rect): Group {
  const g = new Group();
  const alongX = r.maxX - r.minX > r.maxZ - r.minZ;
  const span = alongX ? r.maxX - r.minX : r.maxZ - r.minZ;
  const orange = mat('#e8731c', 0.7);
  const white = mat('#f1efe8', 0.7);
  const red = mat('#c8322a', 0.6);
  const post = mat('#5b5f66', 0.5, 0.4);
  const n = 6;
  for (let i = 0; i < n; i++) {
    const t = -span / 2 + (span * (i + 0.5)) / n;
    const len = (span / n) * 0.82;
    addBox(g, alongX ? len : 0.5, 0.24, alongX ? 0.5 : len, alongX ? t : 0, 0, alongX ? 0 : t, i % 2 ? white : orange);
  }
  for (const s of [-1, 1]) addBox(g, 0.18, 1.1, 0.18, alongX ? (s * span) / 2 : 0, 0, alongX ? 0 : (s * span) / 2, post);
  const seg = span / 8;
  for (let i = 0; i < 8; i++) {
    const t = -span / 2 + seg * (i + 0.5);
    addBox(g, alongX ? seg : 0.12, 0.12, alongX ? 0.12 : seg, alongX ? t : 0, 0.85, alongX ? 0 : t, i % 2 ? white : red);
  }
  g.position.set((r.minX + r.maxX) / 2, 0, (r.minZ + r.maxZ) / 2);
  return g;
}

const FACTORIES: Record<string, (o: ModelOptions) => Group> = {
  region_city_core: cityCore,
  region_hill: hill,
  region_ridge: ridge,
};
for (const [id, f] of Object.entries(FACTORIES)) if (!hasModel(id)) registerModel(id, f);
