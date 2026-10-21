/**
 * Procedural fallbacks for the neighborhood models (houses, trees), used when no .glb override
 * is loaded. Same conventions as models.ts: cm, +Z front, origin at the footprint centre on the
 * ground. Houses fill their footprint box; trees get a trunk of the footprint size and a canopy
 * that overhangs it (only the trunk collides).
 */
import { BufferGeometry, ConeGeometry, Float32BufferAttribute, Group, IcosahedronGeometry, Mesh, type MeshStandardMaterial } from 'three';
import { Rng } from '../core/rng';
import { addBox, addCylinder, hasModel, mat, registerModel, type ModelOptions } from './models';

/** Gable roof prism: ridge along X, eaves overhanging by `over`, bottom at y = 0. */
function gableRoof(w: number, d: number, h: number, over: number): BufferGeometry {
  const x0 = -w / 2 - over;
  const x1 = w / 2 + over;
  const z0 = -d / 2 - over;
  const z1 = d / 2 + over;
  const p = (x: number, y: number, z: number) => [x, y, z];
  const a = p(x0, 0, z0), b = p(x1, 0, z0), c = p(x1, 0, z1), dd = p(x0, 0, z1), r0 = p(x0, h, 0), r1 = p(x1, h, 0);
  const tris = [
    // Slopes.
    dd, c, r1, dd, r1, r0,
    b, a, r0, b, r0, r1,
    // Gable ends.
    a, dd, r0,
    c, b, r1,
    // Underside.
    a, b, c, a, c, dd,
  ];
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(tris.flat(), 3));
  g.computeVertexNormals();
  return g;
}

function addRoof(g: Group, o: ModelOptions, wallH: number, roofH: number, m: MeshStandardMaterial): void {
  const roof = new Mesh(gableRoof(o.w, o.d, roofH, 30), m);
  roof.position.y = wallH;
  roof.castShadow = true;
  roof.receiveShadow = true;
  g.add(roof);
}

/** Windows on all four walls at the given sill heights. */
function addWindows(g: Group, o: ModelOptions, sills: number[], frame: MeshStandardMaterial, rng: Rng, skipFrontCentre = false): void {
  const glass = mat('#3d5a73', 0.25, 0.1);
  const winW = 110;
  const winH = 120;
  for (const y of sills) {
    for (const side of ['front', 'back', 'left', 'right'] as const) {
      const along = side === 'front' || side === 'back' ? o.w : o.d;
      const n = Math.max(1, Math.floor((along - 120) / 300));
      for (let i = 0; i < n; i++) {
        const t = -along / 2 + (along / n) * (i + 0.5);
        if (skipFrontCentre && side === 'front' && y < 200 && Math.abs(t) < 160) continue;
        if (rng.chance(0.08)) continue;
        const out = side === 'front' || side === 'right' ? 1 : -1;
        if (side === 'front' || side === 'back') {
          const z = out * (o.d / 2 + 1);
          addBox(g, winW + 16, winH + 16, 4, t, y - 8, z, frame);
          addBox(g, winW, winH, 4, t, y, z + out * 1.5, glass);
        } else {
          const x = out * (o.w / 2 + 1);
          addBox(g, 4, winH + 16, winW + 16, x, y - 8, t, frame);
          addBox(g, 4, winH, winW, x + out * 1.5, y, t, glass);
        }
      }
    }
  }
}

function addDoor(g: Group, x: number, o: ModelOptions, color: string): void {
  addBox(g, 120, 16, 70, x, 0, o.d / 2 + 35, mat('#b9b2a5', 0.9));
  addBox(g, 104, 212, 6, x, 16, o.d / 2 + 2, mat('#f4efe6', 0.6));
  addBox(g, 90, 200, 6, x, 16, o.d / 2 + 4, mat(color, 0.55));
  addBox(g, 8, 8, 6, x + 30, 110, o.d / 2 + 8, mat('#d4af37', 0.3, 0.8));
}

const SIDINGS_A = ['#a9c6dd', '#b8d8c8', '#efe3c8', '#d9c2dd'];
const SIDINGS_B = ['#f2d98a', '#f4c7a1', '#cfe0b4'];
const BRICKS = ['#a4483a', '#8e3b30', '#b5654a'];

function houseA(o: ModelOptions): Group {
  const rng = new Rng(o.seed ?? 1);
  const g = new Group();
  const wallH = o.h * 0.68;
  const trim = mat('#f7f3ea', 0.6);
  addBox(g, o.w, wallH, o.d, 0, 0, 0, mat(o.color ?? rng.pick(SIDINGS_A), 0.85));
  addBox(g, o.w + 6, 14, o.d + 6, 0, wallH / 2 - 7, 0, trim);
  addRoof(g, o, wallH, o.h - wallH, mat('#4b4f58', 0.8));
  addBox(g, 70, o.h * 0.35, 70, o.w * 0.28, wallH + o.h * 0.1, -o.d * 0.15, mat('#8e4a3c', 0.9));
  addWindows(g, o, [80, wallH * 0.62], trim, rng, true);
  addDoor(g, 0, o, rng.pick(['#7b2e2e', '#2f4858', '#3d5a40']));
  return g;
}

function houseB(o: ModelOptions): Group {
  const rng = new Rng(o.seed ?? 2);
  const g = new Group();
  const wallH = o.h * 0.58;
  const trim = mat('#f7f3ea', 0.6);
  addBox(g, o.w, wallH, o.d, 0, 0, 0, mat(o.color ?? rng.pick(SIDINGS_B), 0.85));
  addRoof(g, o, wallH, o.h - wallH, mat('#6b4a3a', 0.8));
  addWindows(g, o, [90], trim, rng, true);
  // Garage door on the +X half of the front, front door on the −X half.
  addBox(g, o.w * 0.36, wallH * 0.72, 6, o.w * 0.22, 0, o.d / 2 + 2, mat('#f1ede4', 0.6));
  for (let i = 1; i < 4; i++) addBox(g, o.w * 0.36, 3, 8, o.w * 0.22, (wallH * 0.72 * i) / 4, o.d / 2 + 3, mat('#d6d0c4', 0.6));
  addDoor(g, -o.w * 0.25, o, rng.pick(['#2f4858', '#7b2e2e']));
  return g;
}

function houseC(o: ModelOptions): Group {
  const rng = new Rng(o.seed ?? 3);
  const g = new Group();
  const wallH = o.h * 0.66;
  const trim = mat('#f7f3ea', 0.6);
  addBox(g, o.w, wallH, o.d, 0, 0, 0, mat(o.color ?? rng.pick(BRICKS), 0.95));
  addRoof(g, o, wallH, o.h - wallH, mat('#3a3a40', 0.8));
  addWindows(g, o, [90, wallH * 0.6], trim, rng, true);
  addDoor(g, 0, o, '#1f3b2c');
  return g;
}

const LEAVES = ['#4f7f3a', '#5b8c3e', '#3f6e35', '#6a9a45'];

function treeOak(o: ModelOptions): Group {
  const rng = new Rng(o.seed ?? 4);
  const g = new Group();
  const trunkR = o.w / 2;
  addCylinder(g, trunkR * 0.7, trunkR, o.h * 0.5, 0, 0, 0, mat('#6b4a32', 0.95), 10);
  const leaf = mat(rng.pick(LEAVES), 0.95);
  const R = o.h * 0.26;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + rng.range(-0.3, 0.3);
    const d = i === 0 ? 0 : R * 0.55;
    const r = R * rng.range(0.6, 0.85);
    const m = new Mesh(new IcosahedronGeometry(r, 1), leaf);
    m.position.set(Math.cos(a) * d, o.h * 0.62 + rng.range(-0.08, 0.12) * o.h, Math.sin(a) * d);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  }
  return g;
}

function treePine(o: ModelOptions): Group {
  const rng = new Rng(o.seed ?? 5);
  const g = new Group();
  const trunkR = o.w / 2;
  addCylinder(g, trunkR * 0.7, trunkR, o.h * 0.3, 0, 0, 0, mat('#5a3d2b', 0.95), 8);
  const leaf = mat(rng.pick(['#2f5d3a', '#355e3b', '#2b4f36']), 0.95);
  for (let i = 0; i < 3; i++) {
    const r = o.h * (0.21 - i * 0.045);
    const ch = o.h * 0.36;
    const m = new Mesh(new ConeGeometry(r, ch, 9), leaf);
    m.position.y = o.h * 0.22 + i * o.h * 0.22 + ch / 2;
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  }
  return g;
}

const FACTORIES: Record<string, (o: ModelOptions) => Group> = { house_a: houseA, house_b: houseB, house_c: houseC, tree_oak: treeOak, tree_pine: treePine };
for (const [id, f] of Object.entries(FACTORIES)) if (!hasModel(id)) registerModel(id, f);
