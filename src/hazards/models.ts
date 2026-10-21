/**
 * Procedural fallbacks for the Hazard models (used when no .glb override is loaded).
 * They follow docs/models.md: cm units, +Z forward, origin at the floor contact point
 * (the broom's origin is the top of the handle), and the same named animatable nodes
 * (roomba `side_brush`, lint_roller `drum`, robovac_9000 `brush_l` / `brush_r`).
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

const FACTORIES: Record<HazardModelId, () => Object3D> = {
  roomba,
  lint_roller: lintRoller,
  broom,
  spray_bottle: sprayBottle,
  mop,
  upright_vacuum: uprightVacuum,
  robovac_9000: robovac,
};

for (const [id, factory] of Object.entries(FACTORIES)) {
  if (!hasModel(id)) registerModel(id, () => factory());
}
