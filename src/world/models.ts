/**
 * Model registry. createModel(id, opts) returns a GLB override if one was loaded from
 * public/models/ (listed in public/models/manifest.json), otherwise the procedural factory.
 *
 * Conventions: local origin at the footprint centre on the floor (y = 0), front faces +Z,
 * units cm. Every object returned by createModel() follows this, GLB or procedural.
 *
 * manifest.json entries: { "file": "couch.glb", "fit"?: "footprint" | "xz" | "none", "scale"?: n }
 *   - "footprint" (default): stretched to opts {w, h, d}.
 *   - "xz": X/Z stretched to opts {w, d}; height kept at `scale` (the Blender models are authored
 *     in cm, so clearances under furniture stay exact). Used for furniture.
 *   - "none": only `scale` is applied; opts are ignored (hazards).
 *   A model whose lowest point is below y = 0 is lifted onto the floor. The broom is authored
 *   with its origin at the top of the handle; after loading, the origin sits on the floor
 *   straight below that pivot, so rotating the object about Y still sweeps around the handle top.
 *
 * Child nodes keep their glTF names after cloning (roomba `side_brush`, lint_roller `drum`,
 * robovac_9000 `brush_l` / `brush_r`): use `obj.getObjectByName('side_brush')`.
 * Prop models (shoe, sock, toy_car, ...) also back Debris visuals: see getModelTemplate().
 */
import { Box3, BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, SphereGeometry, Vector3, type Object3D } from 'three';
import { Rng } from '../core/rng';

export interface ModelOptions {
  /** Target size (cm): w along X, d along Z, h height. */
  w: number;
  d: number;
  h: number;
  /** Per-instance variation seed (colours etc.). */
  seed?: number;
  color?: string;
}

export type ModelFactory = (opts: ModelOptions) => Object3D;

interface OverrideEntry {
  template: Object3D;
  fit: FitMode;
  scale: number;
  /** Bounds of the template at scale 1. */
  box: Box3;
}

type FitMode = 'footprint' | 'xz' | 'none';

interface ManifestEntry {
  file: string;
  fit?: FitMode;
  scale?: number;
}

const factories = new Map<string, ModelFactory>();
const overrides = new Map<string, OverrideEntry>();

/** Registers (or replaces) the procedural factory for a model id. */
export function registerModel(id: string, factory: ModelFactory): void {
  factories.set(id, factory);
}

export function hasModel(id: string): boolean {
  return factories.has(id) || overrides.has(id);
}

export function hasModelOverride(id: string): boolean {
  return overrides.has(id);
}

/** The loaded GLB scene for `id` (shared: do not mutate), or undefined if none was loaded. */
export function getModelTemplate(id: string): Object3D | undefined {
  return overrides.get(id)?.template;
}

export function createModel(id: string, opts: ModelOptions): Object3D {
  const ov = overrides.get(id);
  const obj = ov ? instantiateOverride(ov, opts) : (factories.get(id) ?? placeholder)(opts);
  obj.name = id;
  return obj;
}

const _size = new Vector3();
const _c = new Vector3();

function instantiateOverride(ov: OverrideEntry, opts: ModelOptions): Object3D {
  const inner = ov.template.clone(true);
  const wrapper = new Group();
  wrapper.add(inner);
  const box = ov.box;
  const size = box.getSize(_size);
  const c = box.getCenter(_c);
  if (ov.fit === 'none') {
    const s = ov.scale;
    inner.scale.multiplyScalar(s);
    if (box.min.y < -0.5) inner.position.y = -box.min.y * s;
  } else {
    const sx = (opts.w || size.x) / (size.x || 1);
    const sz = (opts.d || size.z) / (size.z || 1);
    const sy = ov.fit === 'xz' ? ov.scale : (opts.h || size.y) / (size.y || 1);
    inner.scale.set(sx, sy, sz);
    inner.position.set(-c.x * sx, -box.min.y * sy, -c.z * sz);
  }
  wrapper.traverse((o) => {
    if ((o as Mesh).isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return wrapper;
}

/**
 * Loads GLB overrides listed in models/manifest.json. Never throws; missing manifest or
 * failing files fall back to procedural models. Resolves after `timeoutMs` at the latest.
 * `onProgress(done, total)` reports finished files (for a loading indicator).
 */
export async function loadModelOverrides(timeoutMs = 8000, onProgress?: (done: number, total: number) => void): Promise<string[]> {
  const base = import.meta.env.BASE_URL ?? '/';
  const loaded: string[] = [];
  const work = (async () => {
    let manifest: Record<string, string | ManifestEntry>;
    try {
      const res = await fetch(`${base}models/manifest.json`, { cache: 'no-cache' });
      if (!res.ok) return loaded;
      manifest = await res.json();
    } catch {
      return loaded;
    }
    // Keys starting with "$" are comments.
    const entries = Object.entries(manifest).filter(([id]) => !id.startsWith('$'));
    if (entries.length === 0) return loaded;
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
    const loader = new GLTFLoader();
    let done = 0;
    onProgress?.(0, entries.length);
    await Promise.all(
      entries.map(async ([id, spec]) => {
        const s: ManifestEntry = typeof spec === 'string' ? { file: spec } : spec;
        try {
          const gltf = await loader.loadAsync(`${base}models/${s.file}`);
          const template = gltf.scene;
          template.updateMatrixWorld(true);
          overrides.set(id, { template, fit: s.fit ?? 'footprint', scale: s.scale ?? 1, box: new Box3().setFromObject(template) });
          loaded.push(id);
        } catch (err) {
          console.warn(`[models] failed to load override "${id}", using procedural model`, err);
        }
        onProgress?.(++done, entries.length);
      }),
    );
    return loaded;
  })();
  const timeout = new Promise<string[]>((r) => setTimeout(() => r([...loaded]), timeoutMs));
  return Promise.race([work, timeout]);
}

// ── Procedural helpers ──────────────────────────────────────────────────────

const matCache = new Map<string, MeshStandardMaterial>();
/** Shared material by colour/roughness/metalness. Callers that need per-instance state must clone. */
export function mat(color: string, roughness = 0.8, metalness = 0): MeshStandardMaterial {
  const key = `${color}|${roughness}|${metalness}`;
  let m = matCache.get(key);
  if (!m) {
    m = new MeshStandardMaterial({ color, roughness, metalness });
    matCache.set(key, m);
  }
  return m;
}

/** Adds a box whose bottom sits at `y`. */
export function addBox(g: Group, w: number, h: number, d: number, x: number, y: number, z: number, m: MeshStandardMaterial): Mesh {
  const mesh = new Mesh(new BoxGeometry(w, h, d), m);
  mesh.position.set(x, y + h / 2, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  g.add(mesh);
  return mesh;
}

export function addCylinder(g: Group, rTop: number, rBottom: number, h: number, x: number, y: number, z: number, m: MeshStandardMaterial, seg = 16): Mesh {
  const mesh = new Mesh(new CylinderGeometry(rTop, rBottom, h, seg), m);
  mesh.position.set(x, y + h / 2, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  g.add(mesh);
  return mesh;
}

function legs(g: Group, o: ModelOptions, inset: number, size: number, h: number, m: MeshStandardMaterial): void {
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      addBox(g, size, h, size, sx * (o.w / 2 - inset - size / 2), 0, sz * (o.d / 2 - inset - size / 2), m);
    }
  }
}

function placeholder(o: ModelOptions): Object3D {
  const g = new Group();
  addBox(g, o.w, o.h, o.d, 0, 0, 0, mat('#ff66cc'));
  return g;
}

const FABRICS = ['#7a8b99', '#9c6644', '#5f7161', '#8d6a9f', '#b5838d', '#6b705c'];
const WOODS = ['#8b5a2b', '#a47148', '#6f4518', '#c19a6b'];

// ── Procedural furniture ───────────────────────────────────────────────────

registerModel('couch', (o) => {
  const rng = new Rng(o.seed ?? 1);
  const fab = mat(o.color ?? rng.pick(FABRICS), 0.95);
  const fabDark = mat('#4a4a4a', 0.9);
  const g = new Group();
  const clear = 6;
  legs(g, o, 8, 5, clear, mat('#3b2a1e', 0.6));
  addBox(g, o.w, 22, o.d, 0, clear, 0, fab);
  // Skirt: a thin fringe hanging down; leaves the gap open for Specks.
  addBox(g, o.w + 1, 4, o.d + 1, 0, clear + 1, 0, fabDark);
  const backD = o.d * 0.24;
  addBox(g, o.w, o.h - clear, backD, 0, clear, -o.d / 2 + backD / 2, fab);
  const armW = o.w * 0.08;
  for (const s of [-1, 1]) addBox(g, armW, 58 - clear, o.d, s * (o.w / 2 - armW / 2), clear, 0, fab);
  const seatW = (o.w - armW * 2) / 3;
  for (let i = 0; i < 3; i++) {
    addBox(g, seatW - 2, 14, o.d - backD - 4, -o.w / 2 + armW + seatW * (i + 0.5), clear + 22, backD / 2, fab);
  }
  return g;
});

registerModel('armchair', (o) => {
  const rng = new Rng(o.seed ?? 2);
  const fab = mat(o.color ?? rng.pick(FABRICS), 0.95);
  const g = new Group();
  const clear = 9;
  legs(g, o, 6, 5, clear, mat('#3b2a1e', 0.6));
  addBox(g, o.w, 26, o.d, 0, clear, 0, fab);
  addBox(g, o.w, o.h - clear, o.d * 0.25, 0, clear, -o.d * 0.375, fab);
  for (const s of [-1, 1]) addBox(g, o.w * 0.15, 52 - clear, o.d, s * o.w * 0.425, clear, 0, fab);
  return g;
});

const tableModel = (topColor?: string, legInset = 4, legSize = 5) => (o: ModelOptions) => {
  const rng = new Rng(o.seed ?? 3);
  const wood = mat(topColor ?? rng.pick(WOODS), 0.7);
  const g = new Group();
  legs(g, o, legInset, legSize, o.h - 4, wood);
  addBox(g, o.w, 4, o.d, 0, o.h - 4, 0, wood);
  return g;
};
registerModel('coffee_table', tableModel());
registerModel('dining_table', tableModel(undefined, 6, 6));
registerModel('desk', tableModel('#d9c5a0'));
registerModel('console_table', tableModel(undefined, 3, 4));

registerModel('tv_stand', (o) => {
  const g = new Group();
  addBox(g, o.w, o.h, o.d, 0, 0, 0, mat('#3d3d3d', 0.6));
  addBox(g, o.w * 0.85, o.w * 0.5, 4, 0, o.h, -o.d * 0.2, mat('#111111', 0.3, 0.2));
  addBox(g, 20, 3, 15, 0, o.h, -o.d * 0.2, mat('#222222', 0.5));
  return g;
});

registerModel('bookshelf', (o) => {
  const rng = new Rng(o.seed ?? 4);
  const wood = mat(rng.pick(WOODS), 0.75);
  const g = new Group();
  addBox(g, o.w, o.h, 2, 0, 0, -o.d / 2 + 1, wood);
  for (const s of [-1, 1]) addBox(g, 2, o.h, o.d, s * (o.w / 2 - 1), 0, 0, wood);
  const shelves = 5;
  for (let i = 0; i <= shelves; i++) {
    const y = (i * (o.h - 2)) / shelves;
    addBox(g, o.w - 4, 2, o.d - 2, 0, y, 1, wood);
    if (i === shelves) break;
    let x = -o.w / 2 + 3;
    while (x < o.w / 2 - 8) {
      const bw = rng.range(3, 6);
      const bh = rng.range(18, (o.h - 2) / shelves - 4);
      addBox(g, bw, bh, o.d * 0.7, x + bw / 2, y + 2, 0, mat(rng.pick(['#264653', '#e76f51', '#2a9d8f', '#e9c46a', '#6d597a', '#b56576']), 0.8));
      x += bw + rng.range(0.2, 1.5);
    }
  }
  return g;
});

registerModel('kitchen_counter', (o) => {
  const g = new Group();
  addBox(g, o.w, 10, o.d - 6, 0, 0, -3, mat('#2b2b2b', 0.8));
  addBox(g, o.w, o.h - 14, o.d - 2, 0, 10, -1, mat('#e8e2d6', 0.6));
  addBox(g, o.w + 1, 4, o.d, 0, o.h - 4, 0, mat('#6b6b6b', 0.35, 0.1));
  const doors = Math.max(1, Math.round(o.w / 60));
  for (let i = 0; i < doors; i++) {
    addBox(g, 2, 3, 1, -o.w / 2 + (o.w / doors) * (i + 0.5), o.h - 25, o.d / 2, mat('#999999', 0.3, 0.8));
  }
  return g;
});

registerModel('stove', (o) => {
  const g = new Group();
  addBox(g, o.w, o.h - 2, o.d, 0, 0, 0, mat('#f0f0f0', 0.4, 0.1));
  addBox(g, o.w, 2, o.d, 0, o.h - 2, 0, mat('#111111', 0.3));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) addCylinder(g, 9, 9, 1, sx * o.w * 0.22, o.h, sz * o.d * 0.22, mat('#333333', 0.5, 0.5));
  addBox(g, o.w * 0.8, o.h * 0.4, 1, 0, o.h * 0.2, o.d / 2, mat('#222222', 0.2));
  return g;
});

registerModel('fridge', (o) => {
  const g = new Group();
  addBox(g, o.w, o.h, o.d, 0, 0, 0, mat('#f4f4f4', 0.35, 0.15));
  addBox(g, o.w - 2, 1, 1, 0, o.h * 0.62, o.d / 2, mat('#cccccc', 0.4));
  addBox(g, 3, 40, 3, o.w * 0.38, o.h * 0.68, o.d / 2 + 1.5, mat('#aaaaaa', 0.3, 0.8));
  addBox(g, 3, 30, 3, o.w * 0.38, o.h * 0.35, o.d / 2 + 1.5, mat('#aaaaaa', 0.3, 0.8));
  return g;
});

registerModel('bed', (o) => {
  const rng = new Rng(o.seed ?? 5);
  const wood = mat(rng.pick(WOODS), 0.7);
  const g = new Group();
  const clear = 24;
  legs(g, o, 5, 8, clear, wood);
  addBox(g, o.w, 11, o.d, 0, clear, 0, wood);
  addBox(g, o.w - 4, 20, o.d - 6, 0, clear + 11, 2, mat('#f5f1e8', 0.9));
  addBox(g, o.w + 2, 12, o.d * 0.62, 0, clear + 21, o.d * 0.18, mat(rng.pick(['#355070', '#b56576', '#6d597a', '#588157', '#e9c46a']), 0.95));
  for (const s of [-1, 1]) addBox(g, o.w * 0.4, 10, 35, s * o.w * 0.23, clear + 31, -o.d / 2 + 28, mat('#ffffff', 0.9));
  addBox(g, o.w, 95, 6, 0, 0, -o.d / 2 + 3, wood);
  return g;
});

const cabinet = (color: string) => (o: ModelOptions) => {
  const g = new Group();
  addBox(g, o.w, o.h, o.d, 0, 0, 0, mat(color, 0.7));
  const drawers = Math.max(1, Math.round(o.h / 28));
  for (let i = 0; i < drawers; i++) {
    const y = ((i + 0.5) * o.h) / drawers;
    addBox(g, o.w - 6, 1, 1, 0, ((i + 1) * o.h) / drawers - 1, o.d / 2, mat('#4a2e18', 0.9));
    addBox(g, 8, 2, 2, 0, y, o.d / 2 + 1, mat('#c9b037', 0.3, 0.8));
  }
  return g;
};
registerModel('nightstand', cabinet('#a47148'));
registerModel('dresser', cabinet('#8b5a2b'));

registerModel('bathtub', (o) => {
  const g = new Group();
  addBox(g, o.w, o.h, o.d, 0, 0, 0, mat('#fbfbfb', 0.25, 0.05));
  addBox(g, o.w - 12, 2, o.d - 12, 0, o.h - 1.5, 0, mat('#a8d5e2', 0.1));
  addCylinder(g, 2, 2, 12, -o.w / 2 + 10, o.h, 0, mat('#cccccc', 0.2, 0.9));
  return g;
});

registerModel('toilet', (o) => {
  const g = new Group();
  const white = mat('#fbfbfb', 0.25, 0.05);
  addCylinder(g, o.w * 0.3, o.w * 0.35, o.h * 0.5, 0, 0, o.d * 0.12, white);
  addCylinder(g, o.w * 0.5, o.w * 0.45, 6, 0, o.h * 0.5, o.d * 0.12, white, 20);
  addBox(g, o.w, o.h * 0.5, o.d * 0.3, 0, o.h * 0.5, -o.d / 2 + o.d * 0.15, white);
  return g;
});

registerModel('sink_cabinet', (o) => {
  const g = new Group();
  addBox(g, o.w, o.h - 4, o.d, 0, 0, 0, mat('#dfe7ec', 0.6));
  addBox(g, o.w + 2, 4, o.d + 2, 0, o.h - 4, 0, mat('#fbfbfb', 0.25));
  addCylinder(g, o.d * 0.3, o.d * 0.25, 1, 0, o.h, 2, mat('#c9d6df', 0.2));
  addCylinder(g, 1.5, 1.5, 14, 0, o.h, -o.d / 2 + 6, mat('#cccccc', 0.2, 0.9));
  return g;
});

registerModel('shoe_rack', (o) => {
  const g = new Group();
  const wood = mat('#c19a6b', 0.7);
  for (const s of [-1, 1]) addBox(g, 2, o.h, o.d, s * (o.w / 2 - 1), 0, 0, wood);
  for (const y of [8, o.h / 2, o.h - 2]) addBox(g, o.w, 2, o.d, 0, y, 0, wood);
  return g;
});

/** Generic sphere-ish blob, handy as a quick procedural model for new entities. */
registerModel('blob', (o) => {
  const g = new Group();
  const m = new Mesh(new SphereGeometry(0.5, 16, 12), mat(o.color ?? '#cccccc'));
  m.scale.set(o.w, o.h, o.d);
  m.position.y = o.h / 2;
  m.castShadow = true;
  g.add(m);
  return g;
});
