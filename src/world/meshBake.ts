/**
 * Bakes a hierarchy of meshes (procedural or GLB) into one indexed BufferGeometry with
 * per-vertex material data, so many differently coloured parts can share a single draw call.
 * Used by the static house batch (houseView) and by GLB-backed Debris (debrisGeometry).
 */
import { BufferAttribute, BufferGeometry, Color, Float32BufferAttribute, Matrix4, type Material, type Mesh, type MeshStandardMaterial, type Object3D } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface BakeAttribute {
  name: string;
  itemSize: number;
  /** Value written to every vertex of a part drawn with `material`. */
  value(mesh: Mesh, material: MeshStandardMaterial): number[];
}

export interface BakeOptions {
  /** Applied after each mesh's world matrix (e.g. the inverse of the root's world matrix). */
  transform?: Matrix4;
  /** Extra per-vertex attributes besides position, normal and color. */
  attributes?: BakeAttribute[];
  /** Skip parts (e.g. emissive or transparent materials that need their own draw call). */
  filter?(mesh: Mesh, material: MeshStandardMaterial): boolean;
}

const _m = new Matrix4();
const _c = new Color();

/** Standard material fields as a stable key (used to decide what can merge). */
export function materialOf(m: Material | Material[], group = 0): MeshStandardMaterial {
  return (Array.isArray(m) ? m[group] ?? m[0] : m) as MeshStandardMaterial;
}

export interface BakedPart {
  geometry: BufferGeometry;
  material: MeshStandardMaterial;
  mesh: Mesh;
}

/** One indexed geometry per (mesh, material group), with baked transform and attributes. */
export function bakeParts(root: Object3D, opts: BakeOptions = {}): BakedPart[] {
  root.updateMatrixWorld(true);
  const parts: BakedPart[] = [];
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh || !mesh.visible) return;
    const src = mesh.geometry;
    const groups = src.groups.length > 0 && Array.isArray(mesh.material) ? src.groups : [{ start: 0, count: Infinity, materialIndex: 0 }];
    for (const grp of groups) {
      const material = materialOf(mesh.material, grp.materialIndex ?? 0);
      if (!material || (opts.filter && !opts.filter(mesh, material))) continue;
      const g = new BufferGeometry();
      const pos = src.getAttribute('position');
      g.setAttribute('position', pos.clone() as BufferAttribute);
      if (src.getAttribute('normal')) g.setAttribute('normal', src.getAttribute('normal').clone() as BufferAttribute);
      const n = pos.count;
      if (src.index) {
        const idx = src.index.array;
        const end = Math.min(idx.length, grp.start + grp.count);
        g.setIndex(Array.from(idx.slice(grp.start, end)));
      } else {
        const end = Math.min(n, grp.start + grp.count);
        const arr: number[] = [];
        for (let i = grp.start; i < end; i++) arr.push(i);
        g.setIndex(arr);
      }
      if (!g.getAttribute('normal')) g.computeVertexNormals();
      _m.copy(mesh.matrixWorld);
      if (opts.transform) _m.premultiply(opts.transform);
      g.applyMatrix4(_m);
      if (material.color) _c.copy(material.color);
      else _c.set(1, 1, 1);
      const col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) col.set([_c.r, _c.g, _c.b], i * 3);
      g.setAttribute('color', new Float32BufferAttribute(col, 3));
      for (const a of opts.attributes ?? []) {
        const v = a.value(mesh, material);
        const arr = new Float32Array(n * a.itemSize);
        for (let i = 0; i < n; i++) arr.set(v, i * a.itemSize);
        g.setAttribute(a.name, new Float32BufferAttribute(arr, a.itemSize));
      }
      parts.push({ geometry: g, material, mesh });
    }
  });
  return parts;
}

/** Bakes and merges everything under `root`; null if there is nothing to bake. */
export function bakeObject(root: Object3D, opts: BakeOptions = {}): BufferGeometry | null {
  return mergeParts(bakeParts(root, opts).map((p) => p.geometry));
}

export function mergeParts(parts: BufferGeometry[]): BufferGeometry | null {
  if (parts.length === 0) return null;
  const merged = parts.length === 1 ? parts[0]! : mergeGeometries(parts, false);
  if (parts.length > 1) for (const p of parts) p.dispose();
  if (!merged) return null;
  merged.computeBoundingSphere();
  merged.computeBoundingBox();
  return merged;
}
