/** Builds (and caches) one merged BufferGeometry + material per Debris type from its recipe. */
import {
  BoxGeometry,
  BufferGeometry,
  CapsuleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Euler,
  Float32BufferAttribute,
  IcosahedronGeometry,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { DebrisType, RecipePart } from '../data/debris';

function lumpy(radius: number, noise: number, detail: number): BufferGeometry {
  const g = new IcosahedronGeometry(radius, detail);
  const pos = g.getAttribute('position');
  const v = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    // Position-hashed noise so shared vertices of the non-indexed mesh move together.
    const n = Math.sin(v.x * 12.9898 + v.y * 78.233 + v.z * 37.719) * 43758.5453;
    const f = 1 + (n - Math.floor(n) - 0.5) * 2 * noise;
    v.multiplyScalar(f);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

function partGeometry(p: RecipePart): BufferGeometry {
  switch (p.shape) {
    case 'box':
      return new BoxGeometry(p.size[0], p.size[1], p.size[2]);
    case 'sphere':
      return new SphereGeometry(p.radius, 14, 10);
    case 'cylinder':
      return new CylinderGeometry(p.radiusTop, p.radiusBottom ?? p.radiusTop, p.height, p.segments ?? 14);
    case 'cone':
      return new ConeGeometry(p.radius, p.height, p.segments ?? 12);
    case 'torus':
      return new TorusGeometry(p.radius, p.tube, 8, 24, p.arc ?? Math.PI * 2);
    case 'capsule':
      return new CapsuleGeometry(p.radius, p.length, 4, 10);
    case 'blob':
      return lumpy(p.radius, p.noise, p.detail ?? 1);
  }
}

const _m = new Matrix4();
const _q = new Quaternion();
const _e = new Euler();
const _s = new Vector3();
const _p = new Vector3();
const _c = new Color();

export function buildRecipeGeometry(recipe: RecipePart[]): BufferGeometry {
  const parts = recipe.map((p) => {
    let g = partGeometry(p);
    if (g.index) g = g.toNonIndexed();
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    _e.set(...(p.rot ?? [0, 0, 0]));
    _q.setFromEuler(_e);
    _s.set(...(p.scale ?? [1, 1, 1]));
    _p.set(...(p.pos ?? [0, 0, 0]));
    g.applyMatrix4(_m.compose(_p, _q, _s));
    _c.set(p.color ?? '#ffffff');
    const n = g.getAttribute('position').count;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) colors.set([_c.r, _c.g, _c.b], i * 3);
    g.setAttribute('color', new Float32BufferAttribute(colors, 3));
    return g;
  });
  const merged = mergeGeometries(parts, false)!;
  for (const g of parts) g.dispose();
  merged.computeBoundingSphere();
  return merged;
}

const geoCache = new Map<string, BufferGeometry>();
const matCache = new Map<string, MeshStandardMaterial>();

export function debrisGeometry(type: DebrisType): BufferGeometry {
  let g = geoCache.get(type.id);
  if (!g) {
    g = buildRecipeGeometry(type.recipe);
    geoCache.set(type.id, g);
  }
  return g;
}

export function debrisMaterial(type: DebrisType): MeshStandardMaterial {
  let m = matCache.get(type.id);
  if (!m) {
    const md = type.material ?? {};
    m = new MeshStandardMaterial({
      vertexColors: true,
      roughness: md.roughness ?? 0.7,
      metalness: md.metalness ?? 0,
      emissive: md.emissive ?? '#000000',
      emissiveIntensity: md.emissiveIntensity ?? 1,
    });
    matCache.set(type.id, m);
  }
  return m;
}

/** Pre-parsed instance colours per type. */
const colorCache = new Map<string, Color[]>();
export function debrisColors(type: DebrisType): Color[] {
  let c = colorCache.get(type.id);
  if (!c) {
    c = type.colors.map((hex) => new Color(hex));
    colorCache.set(type.id, c);
  }
  return c;
}
