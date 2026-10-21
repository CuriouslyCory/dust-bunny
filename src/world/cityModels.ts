/**
 * Procedural fallbacks for the city buildings, used when no .glb override is loaded. Same
 * conventions as models.ts: cm, +Z front, origin at the footprint centre on the ground, and the
 * walls fill the footprint box (o.w × o.d) so collision lines up.
 */
import { Group, type MeshStandardMaterial } from 'three';
import { Rng } from '../core/rng';
import { addBox, addCylinder, hasModel, mat, registerModel, type ModelOptions } from './models';

/** Horizontal window bands on all four faces, from `y0` up to `y1`, one per `floor` cm. */
function windowBands(g: Group, o: ModelOptions, y0: number, y1: number, floor: number, glass: MeshStandardMaterial, inset = 0): void {
  for (let y = y0; y + floor * 0.55 < y1; y += floor) {
    const h = floor * 0.55;
    addBox(g, o.w - inset * 2 + 4, h, 4, 0, y, o.d / 2 + 1, glass);
    addBox(g, o.w - inset * 2 + 4, h, 4, 0, y, -o.d / 2 - 1, glass);
    addBox(g, 4, h, o.d - inset * 2 + 4, o.w / 2 + 1, y, 0, glass);
    addBox(g, 4, h, o.d - inset * 2 + 4, -o.w / 2 - 1, y, 0, glass);
  }
}

/** Grid of punched windows on the four faces (apartments, lofts). */
function punchedWindows(g: Group, o: ModelOptions, y0: number, y1: number, floor: number, spacing: number, glass: MeshStandardMaterial, frame: MeshStandardMaterial): void {
  for (let y = y0; y + 160 < y1; y += floor) {
    for (const side of ['front', 'back', 'left', 'right'] as const) {
      const along = side === 'front' || side === 'back' ? o.w : o.d;
      const n = Math.max(1, Math.floor((along - 100) / spacing));
      for (let i = 0; i < n; i++) {
        const t = -along / 2 + (along / n) * (i + 0.5);
        const out = side === 'front' || side === 'right' ? 1 : -1;
        if (side === 'front' || side === 'back') {
          addBox(g, 130, 180, 4, t, y - 10, out * (o.d / 2 + 1), frame);
          addBox(g, 110, 160, 4, t, y, out * (o.d / 2 + 2.5), glass);
        } else {
          addBox(g, 4, 180, 130, out * (o.w / 2 + 1), y - 10, t, frame);
          addBox(g, 4, 160, 110, out * (o.w / 2 + 2.5), y, t, glass);
        }
      }
    }
  }
}

function office(o: ModelOptions): Group {
  const rng = new Rng(o.seed ?? 11);
  const g = new Group();
  const glass = mat(rng.pick(['#5d8aa8', '#4f7c8a', '#6b8fb0']), 0.2, 0.3);
  addBox(g, o.w, 500, o.d, 0, 0, 0, mat('#3b4048', 0.6));
  addBox(g, o.w, o.h - 500, o.d, 0, 500, 0, mat('#c9ccd1', 0.6, 0.2));
  windowBands(g, o, 600, o.h - 200, 380, glass);
  addBox(g, o.w * 0.4, 260, o.d * 0.35, -o.w * 0.15, o.h, 0, mat('#8d939b', 0.7));
  addBox(g, o.w * 0.2, 180, o.d * 0.2, o.w * 0.25, o.h, o.d * 0.2, mat('#8d939b', 0.7));
  return g;
}

function tower(o: ModelOptions): Group {
  const rng = new Rng(o.seed ?? 12);
  const g = new Group();
  const shell = mat(rng.pick(['#d8dbe0', '#bfc6cf', '#d9d1c4']), 0.5, 0.2);
  const glass = mat(rng.pick(['#3f6f8f', '#2f5f7a']), 0.15, 0.4);
  const h1 = o.h * 0.72;
  addBox(g, o.w, h1, o.d, 0, 0, 0, shell);
  windowBands(g, o, 400, h1 - 100, 360, glass);
  const top = { ...o, w: o.w * 0.7, d: o.d * 0.7 };
  addBox(g, top.w, o.h * 0.2, top.d, 0, h1, 0, shell);
  windowBands(g, top, h1 + 100, h1 + o.h * 0.2 - 50, 360, glass);
  addBox(g, o.w * 0.4, o.h * 0.06, o.d * 0.4, 0, h1 + o.h * 0.2, 0, mat('#9aa3ad', 0.6, 0.3));
  addCylinder(g, 12, 25, o.h * 0.08, 0, o.h * 0.98, 0, mat('#c0c4c8', 0.4, 0.6), 8);
  return g;
}

function apartment(o: ModelOptions): Group {
  const rng = new Rng(o.seed ?? 13);
  const g = new Group();
  addBox(g, o.w, o.h, o.d, 0, 0, 0, mat(rng.pick(['#a4513f', '#8e4636', '#b86a4b', '#c9b48f']), 0.95));
  addBox(g, o.w + 20, 40, o.d + 20, 0, o.h - 40, 0, mat('#e8e0d0', 0.8));
  punchedWindows(g, o, 140, o.h - 60, 320, 300, mat('#33485c', 0.25, 0.1), mat('#efe8da', 0.7));
  addBox(g, 300, 260, 30, 0, 0, o.d / 2 + 15, mat('#3a2e2a', 0.7));
  // Rooftop water tank.
  const legs = mat('#5a4636', 0.9);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) addBox(g, 16, 160, 16, o.w * 0.25 + sx * 70, o.h, -o.d * 0.2 + sz * 70, legs);
  addCylinder(g, 120, 120, 220, o.w * 0.25, o.h + 160, -o.d * 0.2, mat('#7a5a3f', 0.9), 12);
  addCylinder(g, 0, 130, 70, o.w * 0.25, o.h + 380, -o.d * 0.2, mat('#5e4532', 0.9), 12);
  return g;
}

function shops(o: ModelOptions): Group {
  const rng = new Rng(o.seed ?? 14);
  const g = new Group();
  addBox(g, o.w, o.h, o.d, 0, 0, 0, mat(rng.pick(['#e6d3b3', '#d8c4a8', '#c7d3d8']), 0.9));
  addBox(g, o.w + 10, 60, o.d + 10, 0, o.h - 60, 0, mat('#8c7a66', 0.8));
  const n = 3;
  for (let i = 0; i < n; i++) {
    const x = -o.w / 2 + (o.w / n) * (i + 0.5);
    const sw = (o.w / n) * 0.8;
    addBox(g, sw, 360, 6, x, 40, o.d / 2 + 3, mat('#3d5a73', 0.2, 0.1));
    addBox(g, sw + 20, 30, 120, x, 430, o.d / 2 + 60, mat(rng.pick(['#d1495b', '#2a9d8f', '#e9c46a', '#3d405b', '#f4a261']), 0.8));
    addBox(g, sw * 0.7, 90, 8, x, 480, o.d / 2 + 4, mat('#f4efe6', 0.6));
  }
  punchedWindows(g, { ...o }, 700, o.h - 60, 400, 320, mat('#33485c', 0.25, 0.1), mat('#f7f3ea', 0.6));
  return g;
}

function brick(o: ModelOptions): Group {
  const rng = new Rng(o.seed ?? 15);
  const g = new Group();
  addBox(g, o.w, o.h, o.d, 0, 0, 0, mat(rng.pick(['#7f3b2c', '#934534', '#6f3a2e']), 0.95));
  addBox(g, o.w + 24, 70, o.d + 24, 0, o.h - 40, 0, mat('#5b2a20', 0.95));
  punchedWindows(g, o, 160, o.h - 80, 420, 340, mat('#2c3a46', 0.3, 0.1), mat('#d9cbb5', 0.8));
  addBox(g, 360, 320, 30, 0, 0, o.d / 2 + 15, mat('#2f2a28', 0.7));
  return g;
}

const FACTORIES: Record<string, (o: ModelOptions) => Group> = {
  building_office: office,
  building_tower: tower,
  building_apartment: apartment,
  building_shops: shops,
  building_brick: brick,
};
for (const [id, f] of Object.entries(FACTORIES)) if (!hasModel(id)) registerModel(id, f);
