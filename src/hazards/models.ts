/**
 * Procedural fallbacks for the Hazard models (used when no .glb override is loaded).
 * They follow docs/models.md: cm units, +Z forward, origin at the floor contact point
 * (the broom's origin is the top of the handle), and the same named animatable nodes
 * (roomba `side_brush`, lint_roller `drum`, robovac_9000 / street_sweeper / garbage_truck
 * `brush_l` / `brush_r`, robo_mower `blade`, floor_scrubber `brush`, sprinkler and
 * pressure_washer `head`; all spin about Y).
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
  // City (measured from the real-size Blender GLBs; the Hazards scale them up to their size,
  // see modelSize in src/data/hazards.ts).
  floor_scrubber: { w: 95, d: 154, h: 139 },
  pressure_washer: { w: 69.8, d: 89.3, h: 106.8 },
  street_flusher: { w: 263, d: 691.7, h: 286 },
  litter_vacuum: { w: 87.8, d: 174.6, h: 160.5 },
  garbage_truck: { w: 273, d: 924.4, h: 381 },
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

// ── City Hazards (real size; front +Z, origin bottom-centre) ──

function floorScrubber(): Object3D {
  // Ride-on scrubber: scrub disc `brush` under the front, seat and recovery tank behind.
  const g = new Group();
  const yellow = mat('#f2b705', 0.5, 0.1);
  const dark = mat('#2b2d31', 0.5, 0.3);
  const tyre = mat('#1b1b1b', 0.85);
  addBox(g, 88, 70, 130, 0, 14, -8, yellow);
  addBox(g, 84, 8, 120, 0, 84, -8, dark);
  // Seat, backrest and steering column.
  addBox(g, 44, 10, 36, 0, 92, -30, mat('#1d1f24', 0.7));
  addBox(g, 44, 34, 8, 0, 102, -50, mat('#1d1f24', 0.7));
  rod(g, new Vector3(0, 92, 30), new Vector3(0, 128, 18), 2.5, dark);
  addCylinder(g, 16, 16, 3, 0, 128, 18, mat('#111111', 0.6), 18);
  // Warning beacon and headlights.
  addCylinder(g, 5, 5, 10, 30, 92, 40, glow('#ff8a00', 2), 12);
  for (const x of [-28, 28]) addBox(g, 12, 6, 2, x, 60, 57, glow('#fff3b0', 1.8));
  // Squeegee at the back, wheels.
  addBox(g, 95, 6, 8, 0, 2, -76, mat('#3a3a3a', 0.9));
  for (const x of [-44, 44]) wheel(g, x, 16, -40, 16, 10, tyre);
  wheel(g, 0, 12, 52, 12, 10, tyre);
  // Scrub disc (pad driver with bristle tufts).
  const brush = new Group();
  brush.name = 'brush';
  brush.position.set(0, 5, 38);
  addCylinder(brush, 38, 38, 6, 0, 0, 0, mat('#3d6fb6', 0.5, 0.2), 24);
  const bristles = mat('#e8e2d0', 0.95);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const tuft = addBox(brush, 6, 3, 28, Math.sin(a) * 20, -2, Math.cos(a) * 20, bristles);
    tuft.rotation.y = a;
  }
  g.add(brush);
  return g;
}

function pressureWasher(): Object3D {
  // Wheeled cart with an engine; the lance `head` turns about Y at (0, 90, 0), nozzle +Z.
  const g = new Group();
  const yellow = mat('#f5c400', 0.45, 0.1);
  const black = mat('#1d1f24', 0.6, 0.2);
  addBox(g, 56, 10, 70, 0, 18, -5, black);
  addBox(g, 50, 40, 46, 0, 28, -8, yellow);
  addCylinder(g, 12, 12, 30, 0, 68, -12, mat('#c9ced6', 0.3, 0.8), 16);
  for (const x of [-32, 32]) wheel(g, x, 18, -26, 18, 8, mat('#1b1b1b', 0.85));
  addBox(g, 8, 18, 8, 0, 0, 28, black);
  // Hose reel and the post that carries the head.
  addCylinder(g, 14, 14, 8, 26, 36, 10, mat('#2e7d32', 0.6), 18).rotation.z = Math.PI / 2;
  addCylinder(g, 4, 4, 30, 0, 60, 18, black, 10);
  rod(g, new Vector3(-22, 40, -34), new Vector3(-22, 108, -44), 2, black);
  rod(g, new Vector3(22, 40, -34), new Vector3(22, 108, -44), 2, black);
  rod(g, new Vector3(-23, 108, -44), new Vector3(23, 108, -44), 2.2, black);
  const head = new Group();
  head.name = 'head';
  head.position.set(0, 90, 0);
  addCylinder(head, 7, 7, 8, 0, -4, 0, black, 14);
  addBox(head, 8, 14, 12, 0, 0, 4, yellow);
  rod(head, new Vector3(0, 8, 8), new Vector3(0, 4, 44), 1.8, mat('#c9ced6', 0.3, 0.8));
  addCylinder(head, 3, 2, 6, 0, 3, 44, mat('#e63946', 0.5), 10).rotation.x = Math.PI / 2;
  g.add(head);
  return g;
}

function streetFlusher(): Object3D {
  // Water truck: cab at the front (+Z), big tank behind, spray bar across the front bumper.
  const g = new Group();
  const white = mat('#f1efe8', 0.5, 0.1);
  const orange = mat('#f07f1a', 0.5);
  const tyre = mat('#1b1b1b', 0.85);
  addBox(g, 230, 40, 660, 0, 30, -10, mat('#2b2d31', 0.5, 0.4));
  for (const x of [-112, 112]) {
    wheel(g, x, 50, 230, 50, 30, tyre);
    wheel(g, x, 50, -180, 50, 30, tyre);
    wheel(g, x, 50, -290, 50, 30, tyre);
  }
  // Cab with windscreen, headlights and a beacon bar.
  addBox(g, 240, 190, 130, 0, 70, 270, white);
  addBox(g, 220, 70, 4, 0, 175, 336, mat('#1d3557', 0.15, 0.6));
  addBox(g, 244, 14, 6, 0, 70, 337, orange);
  for (const x of [-95, 95]) addBox(g, 24, 14, 2, x, 100, 337, glow('#fff3b0', 1.8));
  addBox(g, 150, 14, 30, 0, 260, 270, mat('#2b2d31', 0.5));
  for (const x of [-50, 50]) addCylinder(g, 10, 10, 18, x, 274, 270, glow('#ff8a00', 2), 14);
  // Water tank lying along Z, with orange bands.
  const tank = shadow(new Mesh(new CylinderGeometry(110, 110, 440, 24), mat('#cfd6dc', 0.35, 0.5)));
  tank.rotation.x = Math.PI / 2;
  tank.position.set(0, 180, -100);
  g.add(tank);
  for (const z of [-280, -100, 80]) {
    const band = shadow(new Mesh(new CylinderGeometry(112, 112, 16, 24), orange));
    band.rotation.x = Math.PI / 2;
    band.position.set(0, 180, z);
    g.add(band);
  }
  // Spray bar with glowing nozzles in front of the bumper.
  addBox(g, 250, 10, 12, 0, 22, 346, mat('#9aa0a6', 0.3, 0.7));
  for (let i = 0; i < 6; i++) addCylinder(g, 5, 5, 6, -100 + i * 40, 16, 350, glow('#3aa8ff', 1.6), 10);
  return g;
}

function litterVacuum(): Object3D {
  // Electric street litter vacuum: bin body, handle at the back, intake nozzle at the front (+Z).
  const g = new Group();
  const green = mat('#2e8b57', 0.5, 0.1);
  const grey = mat('#3d4047', 0.5, 0.3);
  addBox(g, 90, 100, 110, 0, 20, -20, green);
  addBox(g, 84, 10, 104, 0, 120, -20, grey);
  for (const x of [-44, 44]) wheel(g, x, 20, -50, 20, 10, mat('#1b1b1b', 0.85));
  wheel(g, 0, 12, 22, 12, 10, mat('#1b1b1b', 0.85));
  rod(g, new Vector3(-30, 120, -70), new Vector3(-30, 158, -85), 2.2, grey);
  rod(g, new Vector3(30, 120, -70), new Vector3(30, 158, -85), 2.2, grey);
  rod(g, new Vector3(-31, 158, -85), new Vector3(31, 158, -85), 2.4, mat('#111111', 0.7));
  addCylinder(g, 3.2, 3.2, 3, 0, 130, 20, glow('#4dff7a', 1.6), 10);
  // Hose arching forward to a wide intake mouth on the ground.
  const hose = mat('#1d1f24', 0.7);
  rod(g, new Vector3(0, 110, 30), new Vector3(0, 90, 62), 9, hose);
  rod(g, new Vector3(0, 90, 62), new Vector3(0, 20, 74), 9, hose);
  addBox(g, 70, 18, 22, 0, 0, 74, mat('#f2b705', 0.5));
  addBox(g, 62, 4, 2, 0, 3, 85.5, mat('#111111', 0.9));
  return g;
}

function garbageTruck(): Object3D {
  // Cab at the front (+Z), compactor body behind, rear loader at the back (−Z);
  // street brushes `brush_l` / `brush_r` under the front bumper corners.
  const g = new Group();
  const green = mat('#2f7d32', 0.5, 0.1);
  const white = mat('#f1efe8', 0.5, 0.1);
  const yellow = mat('#f2b705', 0.5);
  const tyre = mat('#1b1b1b', 0.85);
  addBox(g, 240, 50, 860, 0, 30, -10, mat('#2b2d31', 0.5, 0.4));
  for (const x of [-118, 118]) {
    wheel(g, x, 55, 300, 55, 34, tyre);
    wheel(g, x, 55, -150, 55, 34, tyre);
    wheel(g, x, 55, -270, 55, 34, tyre);
  }
  // Cab.
  addBox(g, 250, 230, 150, 0, 70, 360, white);
  addBox(g, 230, 80, 4, 0, 205, 436, mat('#1d3557', 0.15, 0.6));
  addBox(g, 254, 20, 10, 0, 60, 440, mat('#9aa0a6', 0.3, 0.7));
  for (const x of [-95, 95]) addBox(g, 26, 16, 2, x, 110, 436, glow('#fff3b0', 1.8));
  addBox(g, 160, 14, 30, 0, 300, 360, mat('#2b2d31', 0.5));
  for (const x of [-55, 55]) addCylinder(g, 11, 11, 20, x, 314, 360, glow('#ff8a00', 2), 14);
  // Compactor body with hazard stripes.
  addBox(g, 260, 300, 560, 0, 80, -10, green);
  addBox(g, 230, 10, 520, 0, 380, -10, mat('#256628', 0.6));
  for (let i = 0; i < 6; i++) addBox(g, 262, 14, 30, 0, 250, -240 + i * 92, yellow);
  // Rear loader with the dark hopper mouth.
  addBox(g, 250, 280, 140, 0, 60, -360, white);
  addBox(g, 200, 110, 6, 0, 90, -432, mat('#111111', 0.9));
  for (const x of [-110, 110]) addBox(g, 14, 120, 8, x, 80, -434, yellow);
  g.add(discBrush('brush_l', -100, 5, 428, 46), discBrush('brush_r', 100, 5, 428, 46));
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
  floor_scrubber: floorScrubber,
  pressure_washer: pressureWasher,
  street_flusher: streetFlusher,
  litter_vacuum: litterVacuum,
  garbage_truck: garbageTruck,
};

for (const [id, factory] of Object.entries(FACTORIES)) {
  if (!hasModel(id)) registerModel(id, () => factory());
}
