/**
 * Procedural fallbacks for the Hazard models (used when no .glb override is loaded).
 * They follow docs/models.md: cm units, +Z forward, origin at the floor contact point
 * (the broom's origin is the top of the handle), and the same named animatable nodes
 * (roomba `side_brush`, lint_roller `drum`, robovac_9000 / street_sweeper `brush_l` /
 * `brush_r`, robo_mower `blade`, sprinkler `head`; all spin about Y).
 * If another module already registered a factory for an id, it is kept.
 */
import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, Quaternion, TorusGeometry, Vector3, type Object3D } from 'three';
import { addBox, addCylinder, hasModel, mat, registerModel } from '../world/models';

/** Native sizes from public/models/catalog.json (cm): footprint w (X) × d (Z), height h. */
export const HAZARD_MODEL_SIZES = {
  roomba: { w: 34.5, d: 33.9, h: 9.7 },
  lint_roller: { w: 13.8, d: 25.7, h: 10.2 },
  broom: { w: 36, d: 45.9, h: 114.7 },
  spray_bottle: { w: 10.2, d: 13.6, h: 24.5 },
  mop: { w: 28.2, d: 28.2, h: 47.6 },
  upright_vacuum: { w: 30.8, d: 46, h: 109.5 },
  robovac_9000: { w: 64.6, d: 69.4, h: 20.4 },
  // Neighborhood (measured from the Blender GLBs).
  robo_mower: { w: 91, d: 106.5, h: 31.4 },
  lawn_mower: { w: 78.2, d: 98.9, h: 98.6 },
  leaf_blower: { w: 41, d: 87.7, h: 40 },
  sprinkler: { w: 77.7, d: 68, h: 69.5 },
  street_sweeper: { w: 223, d: 309.7, h: 228.5 },
} as const;

export type HazardModelId = keyof typeof HAZARD_MODEL_SIZES;

const glowCache = new Map<string, MeshStandardMaterial>();
function glow(color: string, intensity = 1.6): MeshStandardMaterial {
  const key = `${color}|${intensity}`;
  let m = glowCache.get(key);
  if (!m) {
    m = new MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity, roughness: 0.4 });
    glowCache.set(key, m);
  }
  return m;
}

function shadow<T extends Mesh>(m: T): T {
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Cylinder between two points. */
function rod(g: Object3D, from: Vector3, to: Vector3, radius: number, m: MeshStandardMaterial): Mesh {
  const dir = to.clone().sub(from);
  const len = dir.length();
  const mesh = shadow(new Mesh(new CylinderGeometry(radius, radius, len, 10), m));
  mesh.position.copy(from).addScaledVector(dir, 0.5);
  mesh.quaternion.copy(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir.normalize()));
  g.add(mesh);
  return mesh;
}

function bristleBrush(name: string, x: number, y: number, z: number, radius: number, m: MeshStandardMaterial): Group {
  const brush = new Group();
  brush.name = name;
  brush.position.set(x, y, z);
  for (let i = 0; i < 3; i++) {
    const arm = shadow(new Mesh(new BoxGeometry(radius * 2, 0.4, 0.6), m));
    arm.rotation.y = (i * Math.PI) / 3;
    brush.add(arm);
  }
  return brush;
}

function roomba(): Object3D {
  const g = new Group();
  addCylinder(g, 17, 17.2, 7.5, 0, 0.6, 0, mat('#2b2d31', 0.5, 0.2), 32);
  addCylinder(g, 15.5, 16.5, 1.4, 0, 8.1, 0, mat('#41454d', 0.35, 0.4), 32);
  // Front bumper band in warning orange.
  const bumper = shadow(new Mesh(new CylinderGeometry(17.4, 17.4, 3, 32, 1, true, -Math.PI / 2.4, Math.PI / 1.2), mat('#ff8a1f', 0.6)));
  bumper.position.set(0, 3.2, 0);
  g.add(bumper);
  addCylinder(g, 2.6, 2.6, 0.8, 0, 9.3, 3, glow('#4dff7a', 1.4), 16);
  const ring = new Mesh(new TorusGeometry(10, 0.35, 6, 40), glow('#ff3b30', 1.2));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 9.6;
  g.add(ring);
  g.add(bristleBrush('side_brush', 7.71, 0.6, 9.19, 4.5, mat('#d8d2c4', 0.9)));
  return g;
}

function lintRoller(): Object3D {
  const g = new Group();
  const drum = new Group();
  drum.name = 'drum';
  drum.position.set(0, 3, 0);
  const roll = shadow(new Mesh(new CylinderGeometry(3, 3, 11, 20), mat('#f4efe6', 0.95)));
  roll.rotation.z = Math.PI / 2;
  drum.add(roll);
  for (const x of [-3.5, 0, 3.5]) {
    const band = new Mesh(new CylinderGeometry(3.05, 3.05, 0.25, 20), mat('#d9d0c0', 0.9));
    band.rotation.z = Math.PI / 2;
    band.position.x = x;
    drum.add(band);
  }
  g.add(drum);
  const frame = mat('#9aa0a6', 0.4, 0.6);
  rod(g, new Vector3(-6, 3, 0), new Vector3(6, 3, 0), 0.35, frame);
  rod(g, new Vector3(6, 3, 0), new Vector3(0, 6, -6), 0.35, frame);
  rod(g, new Vector3(-6, 3, 0), new Vector3(0, 6, -6), 0.35, frame);
  rod(g, new Vector3(0, 6, -6), new Vector3(0, 9.5, -19), 1.3, mat('#e8452c', 0.5));
  return g;
}

function broom(): Object3D {
  // Origin at the top of the handle (sweep pivot); floor at y = -113; head 40 cm forward.
  const g = new Group();
  rod(g, new Vector3(0, 0, 0), new Vector3(0, -103, 38), 1.3, mat('#b07a3c', 0.7));
  addCylinder(g, 1.6, 1.6, 4, 0, -2, 0, mat('#c0392b', 0.5));
  const head = new Group();
  head.position.set(0, -113, 40);
  addBox(head, 34, 3, 8, 0, 7, 0, mat('#c0392b', 0.5));
  addBox(head, 36, 7, 10, 0, 0, 0, mat('#d9b45a', 1));
  g.add(head);
  return g;
}

function sprayBottle(): Object3D {
  const g = new Group();
  addCylinder(g, 4.3, 4.6, 15, 0, 0, 0, new MeshStandardMaterial({ color: '#5bc0eb', roughness: 0.15, transparent: true, opacity: 0.85 }), 20);
  addCylinder(g, 4.65, 4.65, 5, 0, 4, 0, mat('#ffffff', 0.6), 20);
  addCylinder(g, 1.8, 2.4, 3, 0, 15, 0, mat('#f2f2f2', 0.5), 12);
  addBox(g, 3.6, 3.6, 9, 0, 18, 3, mat('#ffffff', 0.5));
  addBox(g, 1.6, 1.6, 1.5, 0, 20.9, 7.8, mat('#ff6b35', 0.5));
  const trigger = addBox(g, 1.4, 5, 1.2, 0, 13.5, 5.5, mat('#ff6b35', 0.5));
  trigger.rotation.x = -0.3;
  addBox(g, 4.9, 3, 0.5, 0, 6, 4.3, mat('#e63946', 0.6));
  return g;
}

function mop(): Object3D {
  const g = new Group();
  const strands = mat('#e8e2d0', 1);
  addCylinder(g, 12, 14, 3.5, 0, 0, 0, strands, 20);
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    addCylinder(g, 1.4, 1.8, 2.6, Math.cos(a) * 12.5, 0, Math.sin(a) * 12.5, strands, 6);
  }
  addCylinder(g, 4, 4, 3, 0, 3.5, 0, mat('#3a7bd5', 0.5), 12);
  rod(g, new Vector3(0, 6, 0), new Vector3(0, 47.5, -10), 1.2, mat('#3a7bd5', 0.5));
  return g;
}

function uprightVacuum(): Object3D {
  const g = new Group();
  const red = mat('#d63031', 0.45, 0.1);
  const grey = mat('#3d4047', 0.5, 0.3);
  addBox(g, 30, 9, 26, 0, 1.5, 8, red);
  addBox(g, 26, 1.8, 2, 0, 1.6, 21.2, mat('#111111', 0.9));
  addCylinder(g, 0.9, 0.9, 1.4, -9, 7.5, 21.2, glow('#fff3b0', 2), 10);
  addCylinder(g, 0.9, 0.9, 1.4, 9, 7.5, 21.2, glow('#fff3b0', 2), 10);
  for (const x of [-14.5, 14.5]) {
    const wheel = shadow(new Mesh(new CylinderGeometry(4, 4, 2.4, 16), mat('#1b1b1b', 0.8)));
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(x, 4, -6);
    g.add(wheel);
  }
  addBox(g, 18, 58, 14, 0, 9, -6, grey);
  addCylinder(g, 6.5, 6.5, 30, 0, 22, -0.5, new MeshStandardMaterial({ color: '#9ad1ff', roughness: 0.1, transparent: true, opacity: 0.7 }), 18);
  addCylinder(g, 0.8, 0.8, 0.6, 0, 66, 1.2, glow('#4dff7a', 1.6), 10);
  rod(g, new Vector3(0, 67, -8), new Vector3(0, 104, -16), 1.4, grey);
  addBox(g, 12, 3, 3, 0, 104, -17.5, mat('#111111', 0.7));
  return g;
}

function robovac(): Object3D {
  const g = new Group();
  addCylinder(g, 32, 32.3, 12, 0, 1.2, 0, mat('#1d1f24', 0.35, 0.5), 40);
  addCylinder(g, 26, 30, 4, 0, 13.2, 0, mat('#2c2f36', 0.3, 0.6), 40);
  addCylinder(g, 14, 18, 3, 0, 17.2, -3, mat('#3b3f48', 0.3, 0.6), 32);
  // Warning-orange bumper and hazard stripes.
  const bumper = shadow(new Mesh(new CylinderGeometry(32.8, 32.8, 4.5, 40, 1, true, -Math.PI / 2.2, Math.PI / 1.1), mat('#ff7a1a', 0.55)));
  bumper.position.y = 5;
  g.add(bumper);
  for (let i = 0; i < 6; i++) {
    const a = -Math.PI / 3 + (i / 5) * ((Math.PI * 2) / 3);
    const stripe = addBox(g, 2.2, 0.4, 7, Math.sin(a) * 22, 15.2, Math.cos(a) * 22, mat('#ffd400', 0.6));
    stripe.rotation.y = a;
  }
  // Red visor eye.
  const visor = addBox(g, 26, 3.2, 3, 0, 13.6, 25.5, glow('#ff1e1e', 2.2));
  visor.name = 'eye';
  const bristles = mat('#cfc6b5', 0.9);
  g.add(bristleBrush('brush_l', -17.09, 1.0, 15.39, 8, bristles), bristleBrush('brush_r', 17.09, 1.0, 15.39, 8, bristles));
  return g;
}

/** Wheel with its axle along X, centre at (x, y, z). */
function wheel(g: Object3D, x: number, y: number, z: number, radius: number, width: number, m: MeshStandardMaterial): Mesh {
  const w = shadow(new Mesh(new CylinderGeometry(radius, radius, width, 18), m));
  w.rotation.z = Math.PI / 2;
  w.position.set(x, y, z);
  g.add(w);
  return w;
}

// ── Neighborhood Hazards ──

function roboMower(): Object3D {
  const g = new Group();
  const tyre = mat('#1e1e1e', 0.85);
  addBox(g, 78, 12, 92, 0, 6, 0, mat('#2f8f3a', 0.5, 0.1));
  addBox(g, 70, 10, 70, 0, 18, -4, mat('#24272c', 0.4, 0.3));
  addBox(g, 86, 8, 6, 0, 6, 47, mat('#ff8a1f', 0.6));
  for (const x of [-41, 41]) {
    wheel(g, x, 10, -30, 10, 8, tyre);
    wheel(g, x, 7, 32, 7, 7, tyre);
  }
  // Red stop button and status light on the lid.
  addCylinder(g, 6, 6, 3, 0, 28, -12, mat('#e63946', 0.5), 18);
  addCylinder(g, 2.5, 2.5, 1, 0, 28, 16, glow('#4dff7a', 1.4), 12);
  const blade = new Group();
  blade.name = 'blade';
  blade.position.set(0, 2.2, 0);
  const steel = mat('#c9ced6', 0.3, 0.8);
  for (let i = 0; i < 2; i++) {
    const arm = shadow(new Mesh(new BoxGeometry(56, 0.8, 5), steel));
    arm.rotation.y = (i * Math.PI) / 2;
    blade.add(arm);
  }
  g.add(blade);
  return g;
}

function lawnMower(): Object3D {
  // Push mower: round deck in front, handle back towards −Z.
  const g = new Group();
  const red = mat('#c62828', 0.45, 0.2);
  const tyre = mat('#1e1e1e', 0.85);
  addCylinder(g, 34, 36, 14, 0, 6, 10, red, 28);
  addBox(g, 50, 4, 10, 0, 6, -24, red);
  addCylinder(g, 14, 15, 16, 0, 20, 10, mat('#2b2d31', 0.5, 0.3), 18);
  addCylinder(g, 9, 9, 4, 0, 36, 10, mat('#f2c94c', 0.5), 16);
  for (const x of [-36, 36]) {
    wheel(g, x, 9, 36, 9, 6, tyre);
    wheel(g, x, 10, -18, 10, 6, tyre);
  }
  const bar = mat('#2b2d31', 0.4, 0.6);
  rod(g, new Vector3(-22, 18, -24), new Vector3(-24, 96, -48), 1.6, bar);
  rod(g, new Vector3(22, 18, -24), new Vector3(24, 96, -48), 1.6, bar);
  rod(g, new Vector3(-25, 96, -48), new Vector3(25, 96, -48), 1.8, mat('#111111', 0.7));
  // Grass catcher bag between the handles.
  addBox(g, 40, 26, 22, 0, 16, -36, mat('#3d6b3a', 0.9));
  return g;
}

function leafBlower(): Object3D {
  // Engine at the back, tube forward along +Z; nozzle tip at (0, 4.5, 45).
  const g = new Group();
  const orange = mat('#f07f1a', 0.5);
  addBox(g, 34, 24, 30, 0, 2, -26, orange);
  addBox(g, 28, 8, 22, 0, 26, -28, mat('#2b2d31', 0.5, 0.3));
  addCylinder(g, 9, 9, 6, 15, 8, -26, mat('#2b2d31', 0.5), 16).rotation.z = Math.PI / 2;
  rod(g, new Vector3(-8, 34, -36), new Vector3(-8, 40, -22), 1.6, mat('#111111', 0.7));
  rod(g, new Vector3(8, 34, -36), new Vector3(8, 40, -22), 1.6, mat('#111111', 0.7));
  rod(g, new Vector3(-8, 40, -22), new Vector3(8, 40, -22), 1.6, mat('#111111', 0.7));
  const tube = mat('#e8e2d0', 0.5);
  rod(g, new Vector3(0, 14, -12), new Vector3(0, 4.5, 41), 4.5, tube);
  const tip = shadow(new Mesh(new CylinderGeometry(6, 4.5, 8, 16, 1, true), mat('#f07f1a', 0.5)));
  tip.rotation.x = Math.PI / 2;
  tip.position.set(0, 4.5, 41);
  g.add(tip);
  return g;
}

function sprinkler(): Object3D {
  // Impact sprinkler on a three-legged stand; `head` turns about Y at (0, 50, 0).
  const g = new Group();
  const green = mat('#2e7d32', 0.6);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const leg = addBox(g, 4, 3, 36, Math.sin(a) * 18, 0, Math.cos(a) * 18, green);
    leg.rotation.y = a;
  }
  addCylinder(g, 6, 7, 4, 0, 0, 0, green, 16);
  addCylinder(g, 2.2, 2.2, 46, 0, 4, 0, mat('#b0b6bd', 0.3, 0.8), 12);
  const head = new Group();
  head.name = 'head';
  head.position.set(0, 50, 0);
  const brass = mat('#c9a227', 0.35, 0.8);
  addCylinder(head, 5, 6, 8, 0, 0, 0, brass, 16);
  rod(head, new Vector3(0, 5, 0), new Vector3(0, 12.9, 13.7), 1.6, brass);
  addCylinder(head, 2.4, 1.6, 3, 0, 11.4, 13, mat('#ffd400', 0.5), 10).rotation.x = Math.PI / 2.6;
  // Impact arm and spring towards the back.
  rod(head, new Vector3(0, 8, 0), new Vector3(0, 10, -14), 1, mat('#2b2d31', 0.5, 0.4));
  addBox(head, 5, 3, 4, 0, 8.5, -15, mat('#2b2d31', 0.5, 0.4));
  g.add(head);
  return g;
}

/** Big disc brush (street sweeper gutter broom), centre at (x, y, z). */
function discBrush(name: string, x: number, y: number, z: number, radius: number): Group {
  const brush = new Group();
  brush.name = name;
  brush.position.set(x, y, z);
  addCylinder(brush, radius * 0.35, radius * 0.35, 4, 0, 2, 0, mat('#2b2d31', 0.5, 0.3), 16);
  const bristles = mat('#3a3a3a', 0.95);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const tuft = addBox(brush, 3, 3, radius, Math.sin(a) * radius * 0.5, -2, Math.cos(a) * radius * 0.5, bristles);
    tuft.rotation.y = a;
  }
  return brush;
}

function streetSweeper(): Object3D {
  // Cab at the front (+Z), hopper behind, gutter brushes under the front corners.
  const g = new Group();
  const white = mat('#f1efe8', 0.5, 0.1);
  const yellow = mat('#f2b705', 0.5);
  const tyre = mat('#1b1b1b', 0.85);
  addBox(g, 200, 30, 290, 0, 22, -5, mat('#2b2d31', 0.5, 0.4));
  for (const x of [-98, 98]) {
    wheel(g, x, 36, 85, 36, 26, tyre);
    wheel(g, x, 36, -95, 36, 26, tyre);
  }
  // Cab.
  addBox(g, 196, 125, 80, 0, 52, 100, white);
  addBox(g, 180, 50, 4, 0, 112, 141, mat('#1d3557', 0.15, 0.6));
  addBox(g, 200, 8, 6, 0, 52, 142, yellow);
  for (const x of [-80, 80]) addBox(g, 18, 10, 2, x, 70, 142, glow('#fff3b0', 1.8));
  // Hopper with hazard stripes.
  addBox(g, 212, 140, 175, 0, 52, -60, white);
  for (let i = 0; i < 5; i++) addBox(g, 214, 8, 14, 0, 160, -140 + i * 38, yellow);
  addBox(g, 160, 10, 120, 0, 192, -60, mat('#d9d6cc', 0.6));
  // Beacon bar on the cab roof.
  addBox(g, 120, 10, 22, 0, 177, 100, mat('#2b2d31', 0.5));
  for (const x of [-40, 40]) addCylinder(g, 8, 8, 14, x, 187, 100, glow('#ff8a00', 2), 14);
  // Rear pick-up broom under the hopper.
  wheel(g, 0, 18, -10, 18, 150, mat('#3a3a3a', 0.95));
  g.add(discBrush('brush_l', -75, 5, 120, 42), discBrush('brush_r', 75, 5, 120, 42));
  return g;
}

const FACTORIES: Record<HazardModelId, () => Object3D> = {
  roomba,
  lint_roller: lintRoller,
  broom,
  spray_bottle: sprayBottle,
  mop,
  upright_vacuum: uprightVacuum,
  robovac_9000: robovac,
  robo_mower: roboMower,
  lawn_mower: lawnMower,
  leaf_blower: leafBlower,
  sprinkler,
  street_sweeper: streetSweeper,
};

for (const [id, factory] of Object.entries(FACTORIES)) {
  if (!hasModel(id)) registerModel(id, () => factory());
}
