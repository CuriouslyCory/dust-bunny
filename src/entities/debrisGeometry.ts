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
  type Object3D,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { DebrisType, RecipePart } from '../data/debris';
import { bakeParts, mergeParts } from '../world/meshBake';
import { getModelTemplate } from '../world/models';

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

/**
 * GLB-backed Debris: types whose id matches a loaded model (public/models/manifest.json) use the
 * Blender mesh instead of the recipe. The model is scaled so its footprint radius is 1 (= `size`)
 * and rests on y = 0. For ids listed here the largest material is replaced by the per-instance
 * colour (other parts keep their authored colours); other GLB types ignore instance colours.
 */
const GLB_TINTED = new Set(['shoe', 'sock', 'toy_car', 'book']);

/** Bakes a loaded model into a normalised Debris geometry with a `tint` mask attribute. */
export function modelDebrisGeometry(id: string, template: Object3D): BufferGeometry | null {
  const parts = bakeParts(template, { attributes: [{ name: 'tint', itemSize: 1, value: () => [0] }] });
  if (parts.length === 0) return null;
  if (GLB_TINTED.has(id)) {
    const area = new Map<string, number>();
    for (const p of parts) area.set(p.material.uuid, (area.get(p.material.uuid) ?? 0) + geometryArea(p.geometry));
    let best = '';
    for (const [k, a] of area) if (!best || a > area.get(best)!) best = k;
    for (const p of parts) {
      if (p.material.uuid !== best) continue;
      (p.geometry.getAttribute('tint').array as Float32Array).fill(1);
      (p.geometry.getAttribute('color').array as Float32Array).fill(1);
    }
  }
  const g = mergeParts(parts.map((p) => p.geometry));
  if (!g) return null;
  const pos = g.getAttribute('position');
  let r = 0;
  for (let i = 0; i < pos.count; i++) r = Math.max(r, Math.hypot(pos.getX(i), pos.getZ(i)));
  const s = 1 / (r || 1);
  g.scale(s, s, s);
  g.computeBoundingBox();
  g.translate(0, -g.boundingBox!.min.y, 0);
  g.computeBoundingSphere();
  return g;
}

const _a = new Vector3();
const _b = new Vector3();
const _cc = new Vector3();
function geometryArea(g: BufferGeometry): number {
  const pos = g.getAttribute('position');
  const idx = g.index!;
  let sum = 0;
  for (let i = 0; i < idx.count; i += 3) {
    _a.fromBufferAttribute(pos, idx.getX(i));
    _b.fromBufferAttribute(pos, idx.getX(i + 1)).sub(_a);
    _cc.fromBufferAttribute(pos, idx.getX(i + 2)).sub(_a);
    sum += _b.cross(_cc).length() * 0.5;
  }
  return sum;
}

const geoCache = new Map<string, BufferGeometry>();
const matCache = new Map<string, MeshStandardMaterial>();
const glbTypes = new Set<string>();

export function debrisGeometry(type: DebrisType): BufferGeometry {
  let g = geoCache.get(type.id);
  if (!g) {
    const template = getModelTemplate(type.id);
    const fromModel = template ? modelDebrisGeometry(type.id, template) : null;
    if (fromModel) glbTypes.add(type.id);
    g = fromModel ?? buildRecipeGeometry(type.recipe);
    geoCache.set(type.id, g);
  }
  return g;
}

export function debrisMaterial(type: DebrisType): MeshStandardMaterial {
  let m = matCache.get(type.id);
  if (!m) {
    debrisGeometry(type); // decides recipe vs GLB
    const md = type.material ?? {};
    const glb = glbTypes.has(type.id);
    m = new MeshStandardMaterial({
      vertexColors: true,
      roughness: glb ? 0.6 : (md.roughness ?? 0.7),
      metalness: glb ? 0.05 : (md.metalness ?? 0),
      emissive: md.emissive ?? '#000000',
      emissiveIntensity: md.emissiveIntensity ?? 1,
    });
    if (glb) {
      // Instance colour only applies where the `tint` mask is set.
      m.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nattribute float tint;')
          .replace('vColor.rgb *= instanceColor.rgb;', 'vColor.rgb *= mix(vec3(1.0), instanceColor.rgb, tint);');
      };
      m.customProgramCacheKey = () => 'debris-glb-tint';
    }
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
