/**
 * Procedural fallbacks for the Hazard models (used when no .glb override is loaded).
 * They follow docs/models.md: cm units (Continent ones: Continent units, Globe ones: Globe units, Solar System ones: Solar System units), +Z forward, origin at the floor contact point
 * (the broom's origin is the top of the handle), and the same named animatable nodes
 * (roomba `side_brush`, lint_roller `drum`, robovac_9000 / street_sweeper / garbage_truck
 * `brush_l` / `brush_r`, robo_mower `blade`, floor_scrubber `brush`, sprinkler and
 * pressure_washer `head`, landfill_compactor `beacon`, incinerator `brush_l` / `brush_r`, tornado
 * `funnel`, hurricane `bands`; all spin about Y; crop_duster `propeller` spins about Z; volcano
 * `crater` at the vent; ice_sheet `calving_l` / `calving_r` hide when they calve; debris_satellite
 * `panels`, asat_laser `head` and globe_hurricane `spiral` turn about Y; space_station `arrays`
 * tilts about X; orbital_sweeper `net` and `wings` (flaps about Z); rogue_asteroid `rock`, sunspot
 * `head`, solar_flare `loop` and the_sun `corona` turn about Y; comet `tail` flutters (scale);
 * solar_flare `loop` pulses (scale); the_sun `prominence_l` / `prominence_r` hide on a hit;
 * black_hole and sagittarius_a `disk`, globular_cluster `swarm` and pulsar `head` turn about Y;
 * supernova_remnant `shell` and supernova `core` pulse (scale); sagittarius_a `jet_n` swells (scale
 * Y) and hides on a hit, `jet_s` stays); quasar `disk`, colliding_galaxy `galaxy_a` / `galaxy_b`,
 * gamma_ray_burst `head` and the_expansion `ring` turn about Y; quasar `jets` pulse (scale Y);
 * cosmic_void `shell` and dark_energy_gust `core` pulse (scale); the_expansion `grid` stretches (scale X/Z).
 * If another module already registered a factory for an id, it is kept.
 */
import { BoxGeometry, ConeGeometry, CylinderGeometry, DoubleSide, Group, IcosahedronGeometry, Mesh, MeshBasicMaterial, MeshStandardMaterial, Quaternion, RingGeometry, TorusGeometry, Vector3, type Object3D } from 'three';
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
  // Region (real size, cm; scaled to Region units by size / modelSize, see src/data/hazards.ts).
  // Footprints from the Blender brief; reconciled with public/models/catalog.json once the GLBs land.
  landfill_compactor: { w: 470, d: 700, h: 380 },
  freight_train: { w: 310, d: 2200, h: 450 },
  snowplow: { w: 440, d: 1040, h: 350 },
  crop_duster: { w: 1120, d: 820, h: 300 },
  river_barge: { w: 480, d: 1400, h: 300 },
  water_bomber: { w: 2800, d: 2200, h: 700 },
  incinerator: { w: 2400, d: 3600, h: 2600 },
  // Continent (public/models/catalog.json in 100 m units ÷ 100: Continent units, as loaded at scale 0.01).
  tornado: { w: 2.87, d: 2.84, h: 4.49 },
  glacier_tongue: { w: 1, d: 2.46, h: 0.15 },
  volcano: { w: 4, d: 4, h: 1.1 },
  river_surge: { w: 2.2, d: 1.9, h: 0.2 },
  hurricane: { w: 5.75, d: 5.75, h: 0.4 },
  ice_sheet: { w: 6, d: 4.02, h: 0.63 },
  // Globe (public/models/catalog.json in 10 km units ÷ 100: Globe units, as loaded at scale 0.01).
  debris_satellite: { w: 2.77, d: 1.76, h: 0.8 },
  space_station: { w: 2.56, d: 1.38, h: 0.33 },
  asat_laser: { w: 2.36, d: 2.65, h: 0.68 },
  reentry_burn: { w: 0.92, d: 2.43, h: 0.47 },
  globe_hurricane: { w: 6.22, d: 6.16, h: 0.42 },
  orbital_sweeper: { w: 5.04, d: 3.9, h: 1.35 },
  mini_sweeper: { w: 1, d: 0.54, h: 0.29 },
  // Solar System (public/models/catalog.json in 0.0001 AU units ÷ 100: Solar System units, as loaded at scale 0.01).
  rogue_asteroid: { w: 1.8, d: 2.01, h: 0.8 },
  comet: { w: 2.51, d: 4.86, h: 1.2 },
  sunspot: { w: 2.49, d: 2.45, h: 0.77 },
  sungrazer: { w: 1.36, d: 2.04, h: 0.51 },
  solar_flare: { w: 1.91, d: 3.15, h: 1.21 },
  the_sun: { w: 5.83, d: 5.85, h: 3.79 },
  // Galaxy (public/models/catalog.json in 1 ly units ÷ 100: Galaxy units, as loaded at scale 0.01).
  black_hole: { w: 2.36, d: 2.36, h: 0.72 },
  globular_cluster: { w: 1.62, d: 1.58, h: 1.28 },
  pulsar: { w: 1.7, d: 3, h: 0.95 },
  supernova_remnant: { w: 1.72, d: 2.11, h: 1.14 },
  supernova: { w: 1.86, d: 3.18, h: 1.11 },
  sagittarius_a: { w: 6.4, d: 6.4, h: 5.39 },
  // Universe (public/models/catalog.json in 100 kly units ÷ 100: Universe units, as loaded at scale 0.01).
  quasar: { w: 2.44, d: 2.44, h: 3.47 },
  colliding_galaxy: { w: 2.32, d: 3.07, h: 0.21 },
  gamma_ray_burst: { w: 1.8, d: 2.48, h: 0.82 },
  cosmic_void: { w: 2.03, d: 2.03, h: 1.64 },
  dark_energy_gust: { w: 2.11, d: 3.28, h: 0.86 },
  the_expansion: { w: 6.99, d: 7.24, h: 0.68 },
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

// ── Region Hazards (real size in cm; front +Z, origin bottom-centre) ──

/** Box rotated about X (ramps, tilted parts), bottom-centre at (x, y, z) before the tilt. */
function tiltedBox(g: Object3D, w: number, h: number, d: number, x: number, y: number, z: number, tilt: number, m: MeshStandardMaterial): Mesh {
  const mesh = shadow(new Mesh(new BoxGeometry(w, h, d), m));
  mesh.position.set(x, y + h / 2, z);
  mesh.rotation.x = tilt;
  g.add(mesh);
  return mesh;
}

function landfillCompactor(): Object3D {
  // Four spiked steel drums, yellow body, cab with the roof `beacon`, dozer blade at the front (+Z).
  const g = new Group();
  const yellow = mat('#e8b20e', 0.5, 0.1);
  const steel = mat('#8a8f96', 0.4, 0.7);
  const dark = mat('#2b2d31', 0.5, 0.3);
  for (const x of [-165, 165]) {
    for (const z of [-200, 200]) {
      wheel(g, x, 95, z, 95, 110, steel);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const cleat = addBox(g, 116, 16, 22, x, 87 + Math.cos(a) * 97, z + Math.sin(a) * 97, dark);
        cleat.rotation.x = -a;
      }
    }
  }
  addBox(g, 230, 130, 520, 0, 70, -10, yellow);
  addBox(g, 220, 90, 170, 0, 200, -170, yellow);
  addBox(g, 160, 115, 150, 0, 200, 40, mat('#1d3557', 0.15, 0.6));
  addBox(g, 180, 14, 175, 0, 315, 40, yellow);
  // Blade on two push arms.
  addBox(g, 470, 150, 28, 0, 15, 330, steel);
  rod(g, new Vector3(-110, 120, 200), new Vector3(-150, 90, 318), 14, dark);
  rod(g, new Vector3(110, 120, 200), new Vector3(150, 90, 318), 14, dark);
  const beacon = new Group();
  beacon.name = 'beacon';
  beacon.position.set(0, 329, 40);
  addCylinder(beacon, 14, 16, 30, 0, 0, 0, glow('#ff8a00', 2), 12);
  addBox(beacon, 34, 10, 8, 0, 12, 13, glow('#ffd400', 2));
  g.add(beacon);
  return g;
}

function freightTrain(): Object3D {
  // Diesel locomotive: blue cab at the front (+Z), long red hood, two bogies, cowcatcher.
  const g = new Group();
  const red = mat('#b3261e', 0.5, 0.15);
  const blue = mat('#1f3b73', 0.5, 0.15);
  const dark = mat('#24272c', 0.6, 0.4);
  const yellow = mat('#f2c230', 0.5);
  addBox(g, 290, 60, 2050, 0, 60, 0, dark);
  for (const z of [-820, -660, 660, 820]) for (const x of [-140, 140]) wheel(g, x, 50, z, 50, 22, mat('#1b1b1b', 0.8, 0.3));
  addBox(g, 270, 270, 1500, 0, 120, -260, red);
  for (let i = 0; i < 4; i++) addCylinder(g, 55, 55, 14, 0, 390, -880 + i * 230, dark, 14);
  addBox(g, 300, 300, 400, 0, 120, 750, blue);
  addBox(g, 262, 90, 6, 0, 300, 953, mat('#9ec9ff', 0.1, 0.5));
  addBox(g, 302, 34, 6, 0, 170, 953, yellow);
  for (const x of [-95, 95]) addBox(g, 30, 22, 4, x, 230, 956, glow('#fff3b0', 1.8));
  addBox(g, 300, 10, 1500, 0, 230, -260, yellow);
  tiltedBox(g, 280, 50, 90, 0, 10, 1020, 0.5, mat('#8a8f96', 0.4, 0.7));
  return g;
}

function snowplow(): Object3D {
  // Orange plow truck: angled yellow blade at the front (+Z), cab, salt hopper behind.
  const g = new Group();
  const orange = mat('#f07f1a', 0.5, 0.1);
  const dark = mat('#2b2d31', 0.5, 0.3);
  const tyre = mat('#1b1b1b', 0.85);
  addBox(g, 230, 60, 820, 0, 55, -60, dark);
  for (const x of [-118, 118]) for (const z of [230, -250, -390]) wheel(g, x, 55, z, 55, 34, tyre);
  addBox(g, 240, 200, 190, 0, 100, 230, orange);
  addBox(g, 220, 80, 4, 0, 205, 326, mat('#1d3557', 0.15, 0.6));
  addBox(g, 150, 14, 30, 0, 300, 230, dark);
  for (const x of [-50, 50]) addCylinder(g, 10, 10, 18, x, 314, 230, glow('#ff8a00', 2), 12);
  // Salt hopper: a V body with a dark load on top.
  addBox(g, 240, 170, 460, 0, 115, -230, orange);
  addBox(g, 210, 18, 430, 0, 285, -230, mat('#d9d6cc', 0.9));
  // Blade: angled across the front, on a push frame.
  const blade = addBox(g, 430, 130, 22, 0, 10, 420, mat('#f2c230', 0.5));
  blade.rotation.y = 0.28;
  rod(g, new Vector3(-80, 70, 330), new Vector3(-90, 70, 408), 9, dark);
  rod(g, new Vector3(80, 70, 330), new Vector3(90, 70, 432), 9, dark);
  return g;
}

function cropDuster(): Object3D {
  // Yellow biplane, nose +Z: `propeller` spins about local Z; spray bar under the lower wing.
  const g = new Group();
  const yellow = mat('#f2c230', 0.45, 0.1);
  const red = mat('#c62828', 0.5);
  const dark = mat('#2b2d31', 0.5, 0.3);
  const body = shadow(new Mesh(new CylinderGeometry(60, 34, 760, 12), yellow));
  body.rotation.x = Math.PI / 2;
  body.position.set(0, 170, 0);
  g.add(body);
  addBox(g, 1120, 14, 160, 0, 110, 120, yellow);
  addBox(g, 1060, 14, 150, 0, 268, 140, yellow);
  for (const x of [-400, 400]) rod(g, new Vector3(x, 124, 120), new Vector3(x, 268, 140), 6, dark);
  addBox(g, 360, 10, 100, 0, 170, -330, yellow);
  addBox(g, 10, 120, 110, 0, 180, -345, red);
  addBox(g, 70, 40, 90, 0, 220, -40, mat('#1d3557', 0.15, 0.6));
  addBox(g, 920, 8, 8, 0, 96, 70, mat('#9aa0a6', 0.3, 0.7));
  for (let i = 0; i < 7; i++) addCylinder(g, 6, 6, 8, -420 + i * 140, 88, 70, glow('#c6e86b', 1.6), 8);
  for (const x of [-120, 120]) {
    rod(g, new Vector3(x * 0.4, 130, 200), new Vector3(x, 40, 210), 5, dark);
    wheel(g, x, 40, 210, 40, 18, mat('#1b1b1b', 0.85));
  }
  const propeller = new Group();
  propeller.name = 'propeller';
  propeller.position.set(0, 170, 392);
  addCylinder(propeller, 16, 16, 30, 0, -15, 0, red, 10).rotation.x = Math.PI / 2;
  for (const r of [0, Math.PI / 2]) {
    const blade = shadow(new Mesh(new BoxGeometry(250, 20, 6), dark));
    blade.rotation.z = r;
    propeller.add(blade);
  }
  g.add(propeller);
  return g;
}

function riverBarge(): Object3D {
  // Rusty barge with heaps of gravel, pushed by a red tug at the back (−Z).
  const g = new Group();
  const hull = mat('#6b4a33', 0.8, 0.2);
  addBox(g, 480, 110, 1000, 0, 0, 120, hull);
  addBox(g, 360, 110, 160, 0, 0, 700, hull);
  addBox(g, 484, 14, 1004, 0, 96, 120, mat('#2b2d31', 0.6, 0.3));
  for (const z of [430, 140, -150]) addCylinder(g, 30, 190, 120, 0, 110, z, mat('#5c5a55', 0.95), 8);
  addBox(g, 440, 100, 250, 0, 0, -510, mat('#c62828', 0.5, 0.1));
  addBox(g, 200, 110, 140, 0, 100, -540, mat('#f1efe8', 0.5, 0.1));
  addBox(g, 190, 36, 4, 0, 160, -469, mat('#1d3557', 0.15, 0.6));
  addBox(g, 220, 10, 160, 0, 210, -540, mat('#2b2d31', 0.5));
  for (const x of [-60, 60]) addCylinder(g, 14, 14, 80, x, 220, -590, mat('#111111', 0.7), 10);
  return g;
}

function waterBomber(): Object3D {
  // Amphibious water bomber: high wing with two engines, T-tail, belly tank doors; nose +Z.
  const g = new Group();
  const yellow = mat('#f2c230', 0.45, 0.1);
  const red = mat('#c62828', 0.5);
  const dark = mat('#2b2d31', 0.5, 0.3);
  addBox(g, 300, 300, 1800, 0, 120, -50, yellow);
  addBox(g, 304, 40, 1804, 0, 230, -50, red);
  const nose = shadow(new Mesh(new CylinderGeometry(20, 150, 300, 12), yellow));
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, 270, 990);
  g.add(nose);
  addBox(g, 220, 70, 120, 0, 380, 760, mat('#1d3557', 0.15, 0.6));
  addBox(g, 2800, 30, 320, 0, 430, 120, yellow);
  for (const x of [-560, 560]) {
    const nacelle = shadow(new Mesh(new CylinderGeometry(70, 80, 420, 12), dark));
    nacelle.rotation.x = Math.PI / 2;
    nacelle.position.set(x, 420, 260);
    g.add(nacelle);
    addCylinder(g, 170, 170, 6, x, 420, 472, mat('#9aa0a6', 0.3, 0.6), 18).rotation.x = Math.PI / 2;
  }
  for (const x of [-1250, 1250]) {
    rod(g, new Vector3(x, 430, 120), new Vector3(x, 330, 120), 8, dark);
    addBox(g, 60, 50, 260, x, 280, 120, red);
  }
  addBox(g, 20, 280, 260, 0, 400, -860, red);
  addBox(g, 900, 20, 200, 0, 680, -880, yellow);
  addBox(g, 140, 10, 500, 0, 115, 100, glow('#3aa8ff', 1.2));
  return g;
}

function incinerator(): Object3D {
  // Rail-mounted waste plant: feed conveyor ramp at the front (+Z) between the intake rollers
  // `brush_l` / `brush_r`, glowing furnace mouth, chimney behind (top at (0, 2600, −600)).
  const g = new Group();
  const concrete = mat('#7a7f86', 0.85, 0.1);
  const dark = mat('#2b2d31', 0.6, 0.4);
  const steel = mat('#8a8f96', 0.4, 0.7);
  const yellow = mat('#f2b705', 0.5);
  for (const x of [-1000, 1000]) {
    addBox(g, 70, 40, 3500, x, 0, 0, steel);
    for (const z of [-1150, -850, 850, 1150]) wheel(g, x, 120, z, 120, 90, dark);
  }
  addBox(g, 2400, 160, 3000, 0, 200, 0, dark);
  addBox(g, 2000, 1000, 1600, 0, 360, -200, concrete);
  addBox(g, 2100, 60, 1700, 0, 1360, -200, mat('#4a4f56', 0.7, 0.2));
  for (let i = 0; i < 5; i++) addBox(g, 2010, 60, 60, 0, 420 + i * 200, 605, yellow);
  addBox(g, 900, 420, 24, 0, 480, 606, glow('#ff5a1f', 2.2));
  tiltedBox(g, 820, 40, 1150, 0, 560, 1080, 0.42, mat('#1d1f24', 0.8));
  for (const x of [-430, 430]) tiltedBox(g, 40, 120, 1150, x, 560, 1080, 0.42, yellow);
  for (const x of [-1100, 1100]) addCylinder(g, 260, 260, 900, x, 360, -880, concrete, 18);
  addCylinder(g, 220, 300, 1240, 0, 1360, -600, concrete, 20);
  for (const y of [1900, 2250]) addCylinder(g, 232, 232, 90, 0, y, -600, mat('#c62828', 0.5), 20);
  addCylinder(g, 200, 200, 30, 0, 2570, -600, glow('#ff7a1a', 2), 20);
  g.add(discBrush('brush_l', -620, 360, 1500, 300), discBrush('brush_r', 620, 360, 1500, 300));
  return g;
}

// ── Continent Hazards (Continent units: the GLBs are authored at 1 = 100 m and loaded at scale
// 0.01, so these fallbacks are built directly at the loaded size: 1 unit = 10 km) ──

function tornado(): Object3D {
  // Dust skirt on the ground; the `funnel` (twisting column under a wall-cloud cap) spins about Y.
  const g = new Group();
  const dust = mat('#9b8a72', 0.95);
  addCylinder(g, 1.5, 1.5, 0.04, 0, 0, 0, dust, 20);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    addCylinder(g, 0.28, 0.36, 0.22, Math.cos(a) * 1.05, 0.02, Math.sin(a) * 1.05, dust, 8);
  }
  const funnel = new Group();
  funnel.name = 'funnel';
  const grey = [mat('#7b8188', 0.9), mat('#5f656c', 0.9)];
  for (let i = 0; i < 8; i++) {
    const r0 = 0.12 + i * 0.1;
    const seg = addCylinder(funnel, r0 + 0.1, r0, 0.46, Math.sin(i * 0.9) * 0.08, 0.05 + i * 0.46, Math.cos(i * 0.9) * 0.08, grey[i % 2]!, 10);
    seg.rotation.y = i * 0.6;
  }
  addCylinder(funnel, 1.3, 0.95, 0.55, 0, 3.75, 0, mat('#4a5058', 0.9), 18);
  addCylinder(funnel, 0.9, 1.3, 0.2, 0, 4.29, 0, mat('#626970', 0.9), 18);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    addBox(funnel, 0.12, 0.08, 0.12, Math.cos(a) * 0.7, 1 + i * 0.5, Math.sin(a) * 0.7, mat('#5b4a36', 0.9));
  }
  rod(funnel, new Vector3(0.4, 3.7, 0.3), new Vector3(0.6, 2.6, 0.5), 0.035, glow('#e8f4ff', 2.4));
  g.add(funnel);
  return g;
}

function glacierTongue(): Object3D {
  // Tongue of ice moving along +Z: crevassed body, moraine stripes, terminal moraine at the snout.
  const g = new Group();
  const ice = mat('#dcecf3', 0.35, 0.05);
  const moraine = mat('#6b6158', 0.95);
  addBox(g, 0.8, 0.12, 2.3, 0, 0, -0.05, ice);
  addBox(g, 0.66, 0.03, 2.2, 0, 0.12, -0.05, mat('#eef6fa', 0.3));
  for (const x of [-0.38, 0, 0.38]) addBox(g, 0.06, 0.02, 2.2, x, 0.14, -0.05, moraine);
  for (let i = 0; i < 6; i++) addBox(g, 0.6, 0.01, 0.025, 0, 0.15, -0.9 + i * 0.32, mat('#7fb8d6', 0.3));
  for (const x of [-0.36, -0.12, 0.12, 0.36]) addBox(g, 0.22, 0.1, 0.16, x, 0, 1.15, moraine);
  return g;
}

function volcano(): Object3D {
  // Ash cone with glowing lava streaks; the `crater` node (lava pool) sits at the vent, (0, 0.96, 0).
  const g = new Group();
  addCylinder(g, 2, 2, 0.03, 0, 0, 0, mat('#4f6b3a', 0.95), 24);
  addCylinder(g, 0.42, 1.85, 0.96, 0, 0, 0, mat('#4a3f3a', 0.95), 18);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    rod(g, new Vector3(Math.cos(a) * 0.4, 0.95, Math.sin(a) * 0.4), new Vector3(Math.cos(a) * 1.7, 0.1, Math.sin(a) * 1.7), 0.05, glow('#ff5a1f', 1.8));
  }
  const crater = new Group();
  crater.name = 'crater';
  crater.position.set(0, 0.96, 0);
  addCylinder(crater, 0.34, 0.34, 0.04, 0, -0.03, 0, glow('#ff7a1a', 2.4), 16);
  addBox(crater, 0.12, 0.05, 0.3, 0, 0, 0.18, glow('#ffb347', 2.2));
  g.add(crater);
  return g;
}

function riverSurge(): Object3D {
  // Flood surge moving +Z: muddy water, a curling wave front with a foam crest, floating logs.
  const g = new Group();
  const mud = mat('#6e5638', 0.6, 0.05);
  addBox(g, 2.1, 0.06, 1.5, 0, 0, -0.15, mud);
  for (const x of [-0.6, 0.1, 0.7]) addBox(g, 0.14, 0.02, 1.3, x, 0.06, -0.2, mat('#3f7fa0', 0.3));
  tiltedBox(g, 2.2, 0.12, 0.35, 0, 0.02, 0.62, -0.5, mat('#7a6142', 0.5, 0.05));
  addBox(g, 2.2, 0.06, 0.12, 0, 0.14, 0.78, mat('#f2f4f0', 0.6));
  for (const [x, z] of [[-0.5, -0.4], [0.4, 0.1], [0.8, -0.6]] as const) {
    const log = addBox(g, 0.3, 0.05, 0.06, x, 0.06, z, mat('#4a3423', 0.9));
    log.rotation.y = x * 2;
  }
  return g;
}

function hurricane(): Object3D {
  // Eyewall ring (body) around a clear eye; the `bands` node (four spiral arms) spins about Y.
  const g = new Group();
  const ring = shadow(new Mesh(new TorusGeometry(0.55, 0.18, 8, 28), mat('#e9eef2', 0.9)));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.25;
  g.add(ring);
  const bands = new Group();
  bands.name = 'bands';
  const cloud = [mat('#f4f7f9', 0.95), mat('#d4dbe1', 0.95)];
  for (let arm = 0; arm < 4; arm++) {
    for (let i = 0; i < 7; i++) {
      const a = (arm / 4) * Math.PI * 2 + i * 0.32;
      const r = 0.85 + i * 0.32;
      const puff = addBox(bands, 0.55 - i * 0.03, 0.16, 0.3, Math.cos(a) * r, 0.12 + (i % 2) * 0.04, Math.sin(a) * r, cloud[(arm + i) % 2]!);
      puff.rotation.y = -a;
    }
  }
  rod(bands, new Vector3(1.4, 0.3, 0.2), new Vector3(1.55, 0.05, 0.45), 0.02, glow('#e8f4ff', 2.4));
  g.add(bands);
  return g;
}

function iceSheet(): Object3D {
  // A slab of continental ice (6 wide × 4 deep) pushing a rubble ridge at its front (+Z) cliff.
  // The face is on the cliff: two glowing crevasse eyes under pressure-ridge brows and a glowing
  // crack for a mouth. `calving_l` / `calving_r` are the chunks at the front corners (base centre
  // on the ground at (∓2.32, 0, 1.22)), hidden when they calve.
  const g = new Group();
  const ice = mat('#e4f1f7', 0.35, 0.05);
  const blue = mat('#a9d3e6', 0.3, 0.05);
  const rubble = mat('#6f665d', 0.95);
  const eye = glow('#7fe8ff', 2.6);
  addBox(g, 5.4, 0.5, 3.4, 0, 0, -0.2, ice);
  addBox(g, 4.6, 0.12, 2.8, 0, 0.5, -0.35, mat('#f3f9fc', 0.3));
  addBox(g, 6, 0.32, 2.6, 0, 0, -0.3, blue);
  for (let i = 0; i < 5; i++) addBox(g, 0.05, 0.02, 1.6 + (i % 2) * 0.6, -1.8 + i * 0.9, 0.62, -0.5, glow('#9fdcf0', 0.8));
  // Rubble ridge bulldozed ahead of the cliff.
  for (let i = 0; i < 9; i++) addBox(g, 0.5, 0.16 + (i % 3) * 0.04, 0.28, -2.4 + i * 0.6, 0, 1.78, rubble);
  // Face: brows, eyes, mouth on the cliff (z ≈ 1.5).
  for (const s of [-1, 1]) {
    addBox(g, 0.62, 0.1, 0.16, s * 0.85, 0.34, 1.42, eye);
    const brow = addBox(g, 0.85, 0.12, 0.24, s * 0.85, 0.47, 1.36, mat('#cfe6f0', 0.4));
    brow.rotation.z = s * 0.22;
  }
  addBox(g, 1.9, 0.05, 0.08, 0, 0.12, 1.52, glow('#5fd2f5', 1.8));
  for (const [name, x] of [['calving_l', -2.32], ['calving_r', 2.32]] as const) {
    const chunk = new Group();
    chunk.name = name;
    chunk.position.set(x, 0, 1.22);
    const c = addBox(chunk, 0.62, 0.44, 0.56, 0, 0, 0, ice);
    c.rotation.y = x * 0.2;
    addBox(chunk, 0.3, 0.2, 0.3, x > 0 ? -0.25 : 0.25, 0.4, -0.05, blue);
    g.add(chunk);
  }
  return g;
}

// ── Globe Hazards (Globe units: the GLBs are authored at 1 = 10 km and loaded at scale 0.01, so
// these fallbacks are built directly at the loaded size: 1 unit = 1,000 km) ──

/** A cylinder lying along Z, centred on (x, y, z). */
function tube(g: Object3D, rFront: number, rBack: number, length: number, x: number, y: number, z: number, m: MeshStandardMaterial, seg = 12): Mesh {
  const mesh = shadow(new Mesh(new CylinderGeometry(rFront, rBack, length, seg), m));
  mesh.rotation.x = Math.PI / 2;
  mesh.position.set(x, y, z);
  g.add(mesh);
  return mesh;
}

/** A named child group at a pivot (the GLB's animatable nodes). */
function node(g: Object3D, name: string, x: number, y: number, z: number): Group {
  const n = new Group();
  n.name = name;
  n.position.set(x, y, z);
  g.add(n);
  return n;
}

function debrisSatellite(): Object3D {
  // Dead satellite: gold-foil bus with a dish and a red beacon, loose fragments around it; the
  // `panels` node (both solar wings, pivot (0, 0.34, 0)) spins about Y.
  const g = new Group();
  const foil = mat('#c9a54a', 0.35, 0.6);
  addBox(g, 0.55, 0.45, 0.5, 0, 0.1, 0, foil);
  addBox(g, 0.2, 0.42, 0.52, 0.2, 0.11, 0, mat('#3b332a', 0.9));
  addCylinder(g, 0.22, 0.05, 0.08, 0, 0.55, 0.1, mat('#e8e8e4', 0.4), 14);
  addCylinder(g, 0.03, 0.03, 0.08, 0, 0.6, -0.15, glow('#ff3b30', 2.4), 8);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    const r = 0.6 + (i % 3) * 0.2;
    const f = addBox(g, 0.12, 0.05, 0.08, Math.cos(a) * r, 0.02, Math.sin(a) * r, mat('#9a9a9a', 0.6, 0.3));
    f.rotation.y = a;
  }
  const panels = node(g, 'panels', 0, 0.34, 0);
  const panel = mat('#2b3f7a', 0.3, 0.4);
  for (const s of [-1, 1]) {
    const w = s > 0 ? 0.75 : 1.05;
    const wing = addBox(panels, w, 0.03, 0.5, s * (0.3 + w / 2), -0.015, 0, panel);
    wing.rotation.x = s * 0.44;
  }
  return g;
}

function spaceStation(): Object3D {
  // Hovering station moving +Z: white modules along Z through the middle, a truss across it (X)
  // with radiators and red / green nav lights; the `arrays` node (eight solar wings at the truss
  // ends, pivot (0, 0.24, 0)) tilts about X.
  const g = new Group();
  const white = mat('#eef0f2', 0.5, 0.1);
  tube(g, 0.13, 0.13, 1.1, 0, 0.27, 0, white);
  tube(g, 0.1, 0.1, 0.3, 0, 0.27, 0.68, mat('#d8dadc', 0.5, 0.1));
  tube(g, 0.11, 0.11, 0.5, 0.0, 0.27, -0.75, white);
  addBox(g, 2.5, 0.06, 0.06, 0, 0.21, 0, mat('#a8acb0', 0.5, 0.5));
  for (const x of [-0.5, 0.5]) addBox(g, 0.08, 0.02, 0.5, x, 0.24, 0, mat('#f6f6f4', 0.6));
  addCylinder(g, 0.03, 0.03, 0.04, -1.25, 0.22, 0, glow('#ff3b30', 2.4), 8);
  addCylinder(g, 0.03, 0.03, 0.04, 1.25, 0.22, 0, glow('#3bff6a', 2.4), 8);
  const arrays = node(g, 'arrays', 0, 0.24, 0);
  const panel = mat('#2f58b8', 0.3, 0.4);
  for (const x of [-1.05, -0.8, 0.8, 1.05]) for (const z of [-0.36, 0.36]) addBox(arrays, 0.2, 0.015, 0.5, x, -0.0075, z, panel);
  return g;
}

function asatLaser(): Object3D {
  // Octagonal armoured pad with a hazard ring and solar petals; the `head` node (turret drum,
  // barrel along +Z with a red lens at the muzzle (0, 0.5, 1.47)) turns about Y from (0, 0.2, 0).
  const g = new Group();
  addCylinder(g, 1.2, 1.2, 0.03, 0, 0, 0, mat('#e8c21a', 0.6), 8);
  addCylinder(g, 1.05, 1.1, 0.12, 0, 0, 0, mat('#5a5e63', 0.7, 0.3), 8);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const p = addBox(g, 0.35, 0.02, 0.5, Math.cos(a) * 0.75, 0.12, Math.sin(a) * 0.75, mat('#2b3f7a', 0.3, 0.4));
    p.rotation.y = -a;
  }
  addCylinder(g, 0.04, 0.04, 0.06, 0.85, 0.12, 0.3, glow('#ff3b30', 2.2), 8);
  addCylinder(g, 0.04, 0.04, 0.06, -0.85, 0.12, -0.3, glow('#ff3b30', 2.2), 8);
  const head = node(g, 'head', 0, 0.2, 0);
  addCylinder(head, 0.32, 0.36, 0.22, 0, -0.08, 0, mat('#6b7076', 0.5, 0.4), 16);
  addCylinder(head, 0.22, 0.05, 0.1, 0, 0.14, -0.3, mat('#e8e8e4', 0.4), 14);
  tube(head, 0.06, 0.09, 1.2, 0, 0.3, 0.87, mat('#3a3e44', 0.4, 0.6));
  tube(head, 0.07, 0.07, 0.04, 0, 0.3, 1.47, glow('#ff3b30', 2.6));
  return g;
}

function reentryBurn(): Object3D {
  // Re-entry capsule moving +Z: a white-hot heat shield at the front, the burnt back shell, an
  // orange bow-shock collar, and a plasma trail streaming back to −Z.
  const g = new Group();
  tube(g, 0.42, 0.28, 0.35, 0, 0.22, 0.85, mat('#3a2e28', 0.9));
  tube(g, 0.44, 0.44, 0.05, 0, 0.22, 1.05, glow('#fff1c8', 2.6));
  tube(g, 0.5, 0.36, 0.18, 0, 0.2, 1.0, glow('#ff8a1a', 1.8));
  const plasma = [glow('#fff3d6', 2.4), glow('#ffa53a', 2), glow('#ff5a1a', 1.8), glow('#c23a1a', 1.2)];
  for (let i = 0; i < 4; i++) tube(g, 0.3 - i * 0.05, 0.25 - i * 0.05, 0.42, 0, 0.18 - i * 0.03, 0.47 - i * 0.42, plasma[i]!, 10);
  addBox(g, 0.2, 0.05, 0.3, 0, 0, -1.05, mat('#6b625c', 0.95));
  return g;
}

function globeHurricane(): Object3D {
  // A hurricane seen from orbit: a clear eye (r 0.4) ringed by the eyewall; the `spiral` node
  // (overcast and five spiral arms out to r ≈ 3.1) spins about Y.
  const g = new Group();
  const ring = shadow(new Mesh(new TorusGeometry(0.55, 0.16, 8, 28), mat('#f2f5f8', 0.9)));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.2;
  g.add(ring);
  const spiral = node(g, 'spiral', 0, 0, 0);
  const cloud = [mat('#f4f7f9', 0.95), mat('#c9d2da', 0.95)];
  for (let arm = 0; arm < 5; arm++) {
    for (let i = 0; i < 9; i++) {
      const a = (arm / 5) * Math.PI * 2 + i * 0.3;
      const r = 0.8 + i * 0.29;
      const puff = addBox(spiral, 0.7 - i * 0.04, 0.14, 0.34, Math.cos(a) * r, 0.1 + (i % 2) * 0.04, Math.sin(a) * r, cloud[(arm + i) % 2]!);
      puff.rotation.y = -a;
    }
  }
  rod(spiral, new Vector3(1.6, 0.3, 0.3), new Vector3(1.75, 0.05, 0.55), 0.02, glow('#e8f4ff', 2.4));
  return g;
}

function orbitalSweeper(): Object3D {
  // The Orbital Sweeper, front +Z: a white octagonal bus with red bands, a dust-bin canister on its
  // back, a red visor eye and a cyan engine glow at the back. `net` (the intake funnel and the
  // orange capture net domed ahead of it, tip at z ≈ 2.3; pivot (0, 0.58, 0.5)) and `wings` (two
  // solar wings, 4.9 tip to tip; pivot (0, 0.58, −0.4)). Laser lenses at (±0.8, 0.62, 0.84).
  const g = new Group();
  const white = mat('#eef0f2', 0.45, 0.15);
  const red = mat('#c8282c', 0.5, 0.1);
  tube(g, 0.45, 0.45, 2.2, 0, 0.58, -0.15, white, 8);
  for (const z of [0.5, -0.6]) tube(g, 0.47, 0.47, 0.12, 0, 0.58, z, red, 8);
  addCylinder(g, 0.32, 0.32, 0.45, 0, 0.95, -0.35, mat('#9aa0a6', 0.5, 0.4), 14);
  addBox(g, 0.5, 0.1, 0.06, 0, 0.72, 0.95, glow('#ff2a1a', 2.4));
  addCylinder(g, 0.05, 0.05, 0.08, 0, 1.4, -0.35, glow('#ffb020', 2.4), 8);
  tube(g, 0.3, 0.36, 0.12, 0, 0.58, -1.3, glow('#5fe6ff', 2.2), 12);
  for (const s of [-1, 1]) {
    addBox(g, 0.36, 0.05, 0.08, s * 0.62, 0.6, 0.6, mat('#a8acb0', 0.5, 0.5));
    tube(g, 0.06, 0.08, 0.5, s * 0.8, 0.62, 0.6, mat('#3a3e44', 0.4, 0.6));
    tube(g, 0.06, 0.06, 0.04, s * 0.8, 0.62, 0.86, glow('#ff3b30', 2.6));
  }
  const net = node(g, 'net', 0, 0.58, 0.5);
  const funnel = tube(net, 1.1, 0.4, 0.6, 0, 0, 0.55, mat('#f2f2ee', 0.5, 0.1), 16);
  funnel.scale.set(1, 1, 0.45);
  tube(net, 1.14, 1.14, 0.06, 0, 0, 0.86, mat('#e8c21a', 0.5), 16).scale.set(1, 1, 0.45);
  tube(net, 0.38, 0.38, 0.03, 0, 0, 0.3, glow('#5fe6ff', 2), 14);
  const mesh = shadow(new Mesh(new CylinderGeometry(0.05, 1.05, 0.95, 16, 1, true), mat('#ff7a1a', 0.8)));
  mesh.rotation.x = Math.PI / 2;
  mesh.scale.set(1, 1, 0.45);
  mesh.position.set(0, 0, 1.35);
  net.add(mesh);
  const wings = node(g, 'wings', 0, 0.58, -0.4);
  const panel = mat('#2f58b8', 0.3, 0.4);
  for (const s of [-1, 1]) {
    addBox(wings, 0.6, 0.04, 0.04, s * 0.75, -0.02, 0, mat('#a8acb0', 0.5, 0.5));
    for (let i = 0; i < 3; i++) addBox(wings, 0.55, 0.02, 0.75, s * (1.15 + i * 0.58), -0.01, 0, panel);
  }
  return g;
}

function miniSweeper(): Object3D {
  // Kessler-swarm minion, front +Z: a small white hexagonal bus with a red band, a red eye, an
  // intake funnel with a cyan throat and two solar wings. Static.
  const g = new Group();
  addCylinder(g, 0.18, 0.18, 0.18, 0, 0.06, 0, mat('#eef0f2', 0.45, 0.15), 6);
  addCylinder(g, 0.185, 0.185, 0.03, 0, 0.13, 0, mat('#c8282c', 0.5, 0.1), 6);
  addBox(g, 0.1, 0.03, 0.02, 0, 0.18, 0.17, glow('#ff2a1a', 2.4));
  tube(g, 0.14, 0.07, 0.12, 0, 0.15, 0.24, mat('#f2f2ee', 0.5, 0.1), 12);
  tube(g, 0.06, 0.06, 0.02, 0, 0.15, 0.2, glow('#5fe6ff', 2), 10);
  for (const s of [-1, 1]) addBox(g, 0.28, 0.015, 0.2, s * 0.36, 0.15, -0.02, mat('#2f58b8', 0.3, 0.4));
  return g;
}

// ── Solar System Hazards (Solar System units: the GLBs are authored at 1 = 0.0001 AU and loaded at
// scale 0.01, so these fallbacks are built directly at the loaded size: 1 unit = 0.01 AU) ──

/** A sphere (or squashed ellipsoid) centred on (x, y, z). */
function ball(g: Object3D, radius: number, x: number, y: number, z: number, m: MeshStandardMaterial, squash = 1, detail = 1): Mesh {
  const mesh = shadow(new Mesh(new IcosahedronGeometry(radius, detail), m));
  mesh.position.set(x, y, z);
  mesh.scale.set(1, squash, 1);
  g.add(mesh);
  return mesh;
}

/** A see-through glowing cone from an apex at (x, y, z) widening back along −Z (comet tails). */
function streamer(g: Object3D, radius: number, length: number, x: number, y: number, z: number, color: string, opacity: number): Mesh {
  const mesh = new Mesh(new ConeGeometry(radius, length, 14, 1, true), new MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
  mesh.rotation.x = Math.PI / 2; // apex (+Y) to +Z
  mesh.position.set(x, y, z - length / 2);
  g.add(mesh);
  return mesh;
}

/** A plasma arch standing in the XY plane (feet at x = ±radius), turned by `yaw`. */
function arch(g: Object3D, radius: number, tube: number, x: number, y: number, z: number, m: MeshStandardMaterial, yaw = 0): Mesh {
  const mesh = new Mesh(new TorusGeometry(radius, tube, 8, 20, Math.PI), m);
  mesh.position.set(x, y, z);
  mesh.rotation.y = yaw;
  g.add(mesh);
  return mesh;
}

function rogueAsteroid(): Object3D {
  // Lumpy cratered rock with a few pebbles; the `rock` node (pivot (0, 0.4, 0)) spins about Y.
  const g = new Group();
  const rock = node(g, 'rock', 0, 0.4, 0);
  const grey = mat('#7d756c', 0.95);
  ball(rock, 0.55, 0, 0, 0, grey, 0.7).scale.set(1.5, 0.7, 1.1);
  ball(rock, 0.3, 0.55, 0.12, 0.25, mat('#8d8378', 0.95), 0.8);
  for (const [x, z] of [[-0.35, 0.3], [0.25, -0.35], [0.6, -0.1]] as const) addCylinder(rock, 0.12, 0.1, 0.03, x, 0.3, z, mat('#4f4a45', 1), 10);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.7;
    ball(rock, 0.08 + (i % 2) * 0.04, Math.cos(a) * 1, -0.3, Math.sin(a) * 0.9, grey, 1, 0);
  }
  return g;
}

function comet(): Object3D {
  // Icy dark nucleus (r 0.6) inside a glowing coma at the origin; the `tail` node (pivot at the
  // nucleus) holds the curved cream dust tail and the straight blue ion tail streaming to −Z.
  const g = new Group();
  ball(g, 0.6, 0, 0.6, 0, mat('#4a4744', 0.9), 0.85);
  ball(g, 0.25, 0.25, 0.85, 0.35, mat('#e8f4fa', 0.4), 1, 0);
  const coma = new Mesh(new IcosahedronGeometry(0.8, 2), new MeshBasicMaterial({ color: '#e8f6ff', transparent: true, opacity: 0.3, depthWrite: false }));
  coma.position.set(0, 0.6, 0);
  g.add(coma);
  const tail = node(g, 'tail', 0, 0.6, 0);
  streamer(tail, 0.75, 3.8, 0, 0, -0.3, '#cfe9ff', 0.35);
  const dust = streamer(tail, 0.9, 3.2, 0.2, 0, -0.3, '#fff1d0', 0.3);
  dust.rotation.z = 0.2;
  dust.rotation.y = 0.18;
  return g;
}

function sunspot(): Object3D {
  // A dark umbra disc in an orange penumbra, flat on the floor; the `head` node (a twisted
  // flux-tube arch along Z with a glowing muzzle at (0, 0.39, 0.77)) turns about Y.
  const g = new Group();
  addCylinder(g, 1.3, 1.3, 0.02, 0, 0, 0, glow('#ff8a1a', 1.2), 24);
  addCylinder(g, 0.75, 0.75, 0.03, 0, 0, 0, mat('#3a1c0e', 0.9), 20);
  addCylinder(g, 0.45, 0.45, 0.035, 0, 0, 0, mat('#140a06', 1), 18);
  const head = node(g, 'head', 0, 0, 0);
  arch(head, 0.36, 0.08, 0, 0.03, 0.4, glow('#ffb347', 1.8), Math.PI / 2);
  arch(head, 0.3, 0.05, 0.08, 0.03, 0.4, glow('#ff6a1a', 1.6), Math.PI / 2 + 0.3);
  ball(head, 0.1, 0, 0.39, 0.77, glow('#fff1c8', 2.6), 1, 0);
  return g;
}

function sungrazer(): Object3D {
  // A small white-hot comet head (r 0.2) at (0, 0.22, 0.46) with a short, wide tail streaming to −Z.
  const g = new Group();
  ball(g, 0.2, 0, 0.22, 0.46, glow('#fff6e0', 2.6), 0.9);
  ball(g, 0.3, 0, 0.22, 0.46, glow('#ffd27a', 1.2), 0.7, 1).scale.set(1, 0.7, 0.8);
  streamer(g, 0.6, 1.5, 0, 0.22, 0.4, '#fff1d0', 0.4);
  streamer(g, 0.4, 1.6, 0, 0.22, 0.4, '#bfe8ff', 0.35);
  return g;
}

function solarFlare(): Object3D {
  // A bright patch on the floor and an arching plasma loop rooted in it (feet at z = ±1.2, top
  // y ≈ 1.2); the `loop` node pulses and spins about Y. The blast faces +Z.
  const g = new Group();
  addCylinder(g, 0.95, 0.95, 0.02, 0, 0, 0, glow('#ff8a1a', 1), 24).scale.set(1, 1, 1.6);
  const loop = node(g, 'loop', 0, 0, 0);
  arch(loop, 1.2, 0.2, 0, 0, 0, glow('#ffb347', 2.2), Math.PI / 2);
  arch(loop, 1.0, 0.1, 0.2, 0, 0, glow('#fff1c8', 2.4), Math.PI / 2 + 0.25);
  for (const s of [-1, 1]) ball(loop, 0.3, 0, 0.1, s * 1.2, glow('#fff6e0', 2.6), 0.6, 0);
  return g;
}

function theSun(): Object3D {
  // The boss, front +Z: a glowing granulated sphere (r 2.7, squashed to 0.7: 3.78 tall, centre
  // y 1.89), two dark sunspot eyes on the +Z side (centres (±0.98, 2.86, 2.1)), the `corona` node
  // (a fringe of flames round the equator, pivot at the centre) turning about Y, and
  // `prominence_l` / `prominence_r` (loops over the −X / +X shoulders) that hide on a hit.
  const g = new Group();
  ball(g, 2.7, 0, 1.89, 0, glow('#ffb03a', 1.6), 0.7, 2);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    ball(g, 0.5, Math.cos(a) * 1.9, 2.9, Math.sin(a) * 1.9, glow('#ffd27a', 1.8), 0.3, 0);
  }
  for (const s of [-1, 1]) {
    ball(g, 0.38, s * 0.98, 2.86, 2.1, mat('#2a1206', 0.9), 0.6, 1);
    ball(g, 0.16, s * 0.98, 2.9, 2.3, mat('#0c0503', 1), 0.6, 0);
  }
  const corona = node(g, 'corona', 0, 1.89, 0);
  const ring = new Mesh(new TorusGeometry(2.75, 0.18, 8, 40), glow('#ff7a1a', 2));
  ring.rotation.x = -Math.PI / 2;
  corona.add(ring);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const flame = new Mesh(new ConeGeometry(0.16, 0.5 + (i % 3) * 0.15, 8), glow(i % 2 ? '#ffb347' : '#ff6a1a', 2));
    flame.position.set(Math.cos(a) * 2.95, 0, Math.sin(a) * 2.95);
    flame.rotation.z = -Math.PI / 2;
    flame.rotation.y = -a;
    corona.add(flame);
  }
  for (const [name, s] of [['prominence_l', -1], ['prominence_r', 1]] as const) {
    const p = node(g, name, s * 2.26, 2.92, 0);
    arch(p, 0.6, 0.13, 0, 0, 0, glow('#ff8a3a', 2.2), Math.PI / 2).scale.set(1, 1.3, 1);
  }
  return g;
}

// ── Galaxy Hazards (Galaxy units: the GLBs are authored at 1 = 1 ly and loaded at scale 0.01, so
// these fallbacks are built directly at the loaded size: 1 unit = 100 ly; node names and pivots
// match the GLBs, public/models/catalog.json) ──

/** A flat glowing ring lying on the floor plane at height y (accretion discs, shock rings). */
function flatRing(g: Object3D, radius: number, tube: number, y: number, m: MeshStandardMaterial): Mesh {
  const mesh = new Mesh(new TorusGeometry(radius, tube, 8, 40), m);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = y;
  g.add(mesh);
  return mesh;
}

/** A flat annulus (inner..outer) lying in a node's XZ plane: accretion discs. */
function annulus(g: Object3D, inner: number, outer: number, color: string, opacity: number): Mesh {
  const mesh = new Mesh(new RingGeometry(inner, outer, 48, 1), new MeshBasicMaterial({ color, transparent: true, opacity, side: DoubleSide, depthWrite: false }));
  mesh.rotation.x = -Math.PI / 2;
  g.add(mesh);
  return mesh;
}

/** Two glowing eyes at (±x, y, z). */
function eyes(g: Object3D, x: number, y: number, z: number, radius: number, color: string): void {
  for (const s of [-1, 1]) ball(g, radius, s * x, y, z, glow(color, 2.6), 1, 0);
}

function blackHole(): Object3D {
  // A dark hole (r 0.36, centre y 0.48) in a white-hot photon ring (r 0.405), two hungry eyes on
  // its +Z side (±0.137, 0.66, 0.28); the `disk` node (pivot at the hole's centre) holds the
  // accretion disc (r 0.43–1.18) and turns about Y.
  const g = new Group();
  ball(g, 0.36, 0, 0.48, 0, mat('#020203', 1), 1, 2);
  flatRing(g, 0.405, 0.025, 0.48, glow('#fff4e0', 2.6));
  eyes(g, 0.137, 0.66, 0.28, 0.05, '#ffd27a');
  const disk = node(g, 'disk', 0, 0.48, 0);
  annulus(disk, 0.43, 0.75, '#ffb347', 0.85);
  annulus(disk, 0.75, 1.18, '#d8507a', 0.55);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    ball(disk, 0.07, Math.cos(a) * 0.8, 0, Math.sin(a) * 0.8, glow('#fff1c8', 2.2), 1, 0);
  }
  return g;
}

function globularCluster(): Object3D {
  // A gold-white core (r 0.34, centre y 0.58) in a golden halo ring (r 0.52); the `swarm` node
  // (pivot at the core) holds the star points out to r 0.95 and turns about Y.
  const g = new Group();
  ball(g, 0.34, 0, 0.58, 0, glow('#fff1c8', 2.2), 1, 1);
  flatRing(g, 0.52, 0.03, 0.58, glow('#ffd27a', 1.8));
  const swarm = node(g, 'swarm', 0, 0.58, 0);
  for (let i = 0; i < 40; i++) {
    const r = 0.4 + 0.55 * Math.cbrt((i + 0.5) / 40);
    const a = i * 2.39996;
    const y = ((i * 0.618) % 1) * 2 - 1;
    const k = Math.sqrt(1 - y * y);
    ball(swarm, 0.03 + (i % 3) * 0.015, Math.cos(a) * k * r, y * r * 0.55, Math.sin(a) * k * r, glow(i % 4 ? '#fff1c8' : i % 8 ? '#ffb26b' : '#cfe0ff', 2.2), 1, 0);
  }
  return g;
}

function pulsar(): Object3D {
  // A violet pulsar-wind disc (r 0.84) on the floor; the `head` node (pivot at the origin) holds
  // the white-hot neutron star (r 0.2, centre y 0.6), two magnetosphere rings and the twin
  // lighthouse beams leaving the star at (0, 0.6, ±0.2), widening to r 0.28 at z ±1.5; it turns about Y.
  const g = new Group();
  addCylinder(g, 0.84, 0.84, 0.02, 0, 0, 0, glow('#8a5ad8', 0.9), 32);
  const head = node(g, 'head', 0, 0, 0);
  ball(head, 0.2, 0, 0.6, 0, glow('#f4fbff', 3), 1, 1);
  for (const tilt of [0.5, -0.5]) {
    const ring = new Mesh(new TorusGeometry(0.34, 0.015, 6, 32), glow('#9fd8ff', 2));
    ring.position.y = 0.6;
    ring.rotation.set(Math.PI / 2 + tilt, 0, 0);
    head.add(ring);
  }
  for (const s of [-1, 1]) {
    const beam = new Mesh(new ConeGeometry(0.28, 1.3, 14, 1, true), new MeshBasicMaterial({ color: '#cfeaff', transparent: true, opacity: 0.45, depthWrite: false, side: DoubleSide }));
    beam.rotation.x = -s * (Math.PI / 2); // apex (+Y) back towards the star
    beam.position.set(0, 0.6, s * (0.2 + 0.65));
    head.add(beam);
  }
  return g;
}

function supernovaRemnant(): Object3D {
  // A Crab-like remnant: the `shell` node (pivot (0, 0.58, 0)) is an oval web of glowing filaments
  // (radii 0.86 × 0.56 × 1.04 along X, Y, Z) that breathes; inside it a blue glow and a white pulsar;
  // a dim violet glow on the floor trails off behind it (−Z).
  const g = new Group();
  const trail = addCylinder(g, 0.7, 0.7, 0.01, 0, 0, -0.35, glow('#6a3a9a', 0.6), 24);
  trail.scale.set(1, 1, 1.5);
  ball(g, 0.3, 0, 0.58, 0, glow('#6fb8ff', 1.4), 1, 1);
  ball(g, 0.05, 0, 0.58, 0, glow('#ffffff', 3), 1, 0);
  const shell = node(g, 'shell', 0, 0.58, 0);
  const web = new Group();
  web.scale.set(0.86, 0.56, 1.04);
  shell.add(web);
  for (let i = 0; i < 6; i++) {
    const ring = new Mesh(new TorusGeometry(1, 0.025, 6, 40), glow(i % 2 ? '#ff7ab8' : '#d68cff', 2));
    ring.rotation.set(0, (i / 6) * Math.PI, 0);
    web.add(ring);
  }
  const belt = new Mesh(new TorusGeometry(1, 0.03, 6, 40), glow('#ffb36b', 2));
  belt.rotation.x = Math.PI / 2;
  web.add(belt);
  return g;
}

function supernova(): Object3D {
  // A swelling, overheated star: the `core` node (pivot (0, 0.58, 0)) holds the star (r 0.54) and
  // its strained eyes on the +Z side; a cyan shock ring (r 0.783) on the floor and five shock
  // tongues fanning out to +Z (to r 2.4, ±30°). The blast leaves the nozzle at (0, 0.58, 0.54).
  const g = new Group();
  const core = node(g, 'core', 0, 0.58, 0);
  ball(core, 0.54, 0, 0, 0, glow('#fff1c8', 2.6), 1, 2);
  eyes(core, 0.17, 0.12, 0.48, 0.07, '#ff5a3a');
  flatRing(g, 0.783, 0.04, 0.05, glow('#6fe8ff', 2.2));
  for (let i = 0; i < 5; i++) {
    const a = ((i - 2) / 2) * (Math.PI / 6);
    const tongue = new Mesh(new ConeGeometry(0.18, 1.6, 8, 1, true), new MeshBasicMaterial({ color: i % 2 ? '#9fe8ff' : '#ffd27a', transparent: true, opacity: 0.5, depthWrite: false, side: DoubleSide }));
    tongue.rotation.set(-Math.PI / 2, 0, 0); // apex (+Y) back towards the star
    const holder = new Group();
    holder.rotation.y = a;
    tongue.position.set(0, 0.15, 0.8 + 0.8);
    holder.add(tongue);
    g.add(holder);
  }
  return g;
}

function sagittariusA(): Object3D {
  // The boss, front +Z: a supermassive black hole (r 1.0, centre y 1.5) in a white-hot photon ring
  // (r 1.09), two slit-pupilled eyes on its +Z side (±0.393, 2.0, 0.772); the `disk` node (pivot at
  // the hole's centre) holds the accretion disc (r 1.16–3.2) and turns about Y; `jet_n` (pivot at
  // the north pole (0, 2.5, 0)) rises to y 5.4; `jet_s` (pivot at the south pole (0, 0.5, 0)) runs
  // down into a blue lobe (r 1.7) on the floor under the disc.
  const g = new Group();
  ball(g, 1, 0, 1.5, 0, mat('#010102', 1), 1, 3);
  flatRing(g, 1.09, 0.05, 1.5, glow('#fff6e8', 2.8));
  eyes(g, 0.393, 2.0, 0.772, 0.13, '#ffd27a');
  for (const s of [-1, 1]) ball(g, 0.05, s * 0.393, 2.0, 0.9, mat('#0a0406', 1), 1, 0).scale.set(0.4, 1.6, 0.4);
  const disk = node(g, 'disk', 0, 1.5, 0);
  annulus(disk, 1.16, 1.7, '#fff1c8', 0.9);
  annulus(disk, 1.7, 2.4, '#ff9a3a', 0.75);
  annulus(disk, 2.4, 3.2, '#a03ad8', 0.5);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    ball(disk, 0.16, Math.cos(a) * 2.0, 0, Math.sin(a) * 2.0, glow('#ffe0b0', 2.4), 1, 0);
  }
  const jetN = node(g, 'jet_n', 0, 2.5, 0);
  const n = new Mesh(new CylinderGeometry(0.12, 0.22, 2.9, 12, 1, true), new MeshBasicMaterial({ color: '#bfeaff', transparent: true, opacity: 0.7, depthWrite: false, side: DoubleSide }));
  n.position.y = 1.45;
  jetN.add(n);
  ball(jetN, 0.18, 0, 2.9, 0, glow('#b48cff', 2.4), 1, 0);
  const jetS = node(g, 'jet_s', 0, 0.5, 0);
  const sj = new Mesh(new CylinderGeometry(0.2, 0.12, 0.5, 12, 1, true), new MeshBasicMaterial({ color: '#bfeaff', transparent: true, opacity: 0.6, depthWrite: false, side: DoubleSide }));
  sj.position.y = -0.25;
  jetS.add(sj);
  addCylinder(g, 1.7, 1.7, 0.02, 0, 0, 0, glow('#3a6aff', 0.9), 32);
  return g;
}

function quasar(): Object3D {
  // A blazing core (r 0.26, centre (0, 0.96, 0)) with two eyes on its +Z side; the `disk` node
  // (pivot at the core) is the accretion disc (r 0.34–1.22, spins about Y); the `jets` node (pivot
  // at the core) holds twin jets up to y 3.47 and down to the floor (pulse with scale Y).
  const g = new Group();
  ball(g, 0.26, 0, 0.96, 0, glow('#f4fbff', 3), 1, 1);
  eyes(g, 0.1, 1.04, 0.22, 0.045, '#2a1a40');
  const disk = node(g, 'disk', 0, 0.96, 0);
  annulus(disk, 0.34, 0.75, '#bfeaff', 0.85);
  annulus(disk, 0.75, 1.22, '#8a5ad8', 0.55);
  const jets = node(g, 'jets', 0, 0.96, 0);
  const jetMat = new MeshBasicMaterial({ color: '#cfeaff', transparent: true, opacity: 0.6, depthWrite: false, side: DoubleSide });
  const north = new Mesh(new CylinderGeometry(0.04, 0.12, 2.5, 10, 1, true), jetMat);
  north.position.y = 1.25;
  const south = new Mesh(new CylinderGeometry(0.12, 0.3, 0.96, 10, 1, true), jetMat);
  south.position.y = -0.48;
  jets.add(north, south);
  return g;
}

function collidingGalaxy(): Object3D {
  // Two spiral galaxies mid-merger travelling +Z: `galaxy_a` (blue-white, r 0.66, pivot
  // (-0.34, 0.14, 0.46)) in front and `galaxy_b` (peach, r 0.56, pivot (0.4, 0.18, -0.34)) behind,
  // each spinning about its own Y; a pink bridge between them and tidal tails back to z -1.9.
  const g = new Group();
  const a = node(g, 'galaxy_a', -0.34, 0.14, 0.46);
  addCylinder(a, 0.66, 0.66, 0.04, 0, 0, 0, glow('#9ab8ff', 1.2), 24);
  ball(a, 0.16, 0, 0.06, 0, glow('#fff1c8', 2.4), 0.6, 1);
  const b = node(g, 'galaxy_b', 0.4, 0.18, -0.34);
  addCylinder(b, 0.56, 0.56, 0.04, 0, 0, 0, glow('#ffc8a0', 1.2), 24);
  ball(b, 0.14, 0, 0.06, 0, glow('#fff1c8', 2.4), 0.6, 1);
  ball(g, 0.12, 0.03, 0.16, 0.06, glow('#ff8ad0', 2), 0.6, 0);
  for (const s of [-1, 1]) {
    const tail = new Mesh(new BoxGeometry(0.08, 0.02, 1.4), glow('#c8d8ff', 0.9));
    tail.position.set(s * 0.45, 0.08, -1.2);
    tail.rotation.y = s * 0.25;
    g.add(tail);
  }
  return g;
}

function gammaRayBurst(): Object3D {
  // The hypernova's ejecta: a dark violet disc (r 0.86) on the floor. The `head` node (pivot at
  // the origin, aims about Y) holds the collapsing star (r 0.24, centre (0, 0.58, 0)), a nozzle
  // mouth at (0, 0.58, 0.39) and a narrow beam along +Z to the muzzle at (0, 0.58, 1.6).
  const g = new Group();
  addCylinder(g, 0.86, 0.86, 0.02, 0, 0, 0, glow('#5a3a9a', 0.8), 24);
  const head = node(g, 'head', 0, 0, 0);
  ball(head, 0.24, 0, 0.58, 0, glow('#f2f8ff', 3), 1, 1);
  flatRing(head, 0.36, 0.03, 0.58, glow('#b48cff', 1.8));
  const nozzle = new Mesh(new ConeGeometry(0.14, 0.2, 12, 1, true), glow('#c08cff', 1.6));
  nozzle.rotation.x = Math.PI / 2;
  nozzle.position.set(0, 0.58, 0.32);
  head.add(nozzle);
  const beam = new Mesh(new CylinderGeometry(0.05, 0.05, 1.21, 8, 1, true), new MeshBasicMaterial({ color: '#f2f8ff', transparent: true, opacity: 0.55, depthWrite: false, side: DoubleSide }));
  beam.rotation.x = Math.PI / 2;
  beam.position.set(0, 0.58, 0.995);
  head.add(beam);
  return g;
}

function cosmicVoid(): Object3D {
  // An empty bubble: the `shell` node (pivot (0, 0.82, 0), pulses) is a near-black sphere (r 0.82)
  // with a dim indigo limb; a CMB-orange glow ring (r 1) lies on the floor round its foot.
  const g = new Group();
  flatRing(g, 1, 0.025, 0.01, glow('#ff9a5a', 1.2));
  const shell = node(g, 'shell', 0, 0.82, 0);
  ball(shell, 0.82, 0, 0, 0, mat('#06040c', 1), 1, 2);
  flatRing(shell, 0.82, 0.03, 0, glow('#6a4ab8', 1.4));
  return g;
}

function darkEnergyGust(): Object3D {
  // A violet swirl (r 0.92) on the floor and three gust wisps blowing out to +Z (to r 2.3, ±22°);
  // the `core` node (pivot (0, 0.52, 0), swells) is a swirling violet ball (r 0.34) with a nozzle
  // facing +Z, its mouth at (0, 0.52, 0.64).
  const g = new Group();
  addCylinder(g, 0.92, 0.92, 0.01, 0, 0, 0, glow('#3a2470', 0.8), 24);
  const core = node(g, 'core', 0, 0.52, 0);
  ball(core, 0.34, 0, 0, 0, glow('#7a4ad8', 1.4), 1, 2);
  flatRing(core, 0.42, 0.025, 0, glow('#c8a8ff', 1.6));
  const nozzle = new Mesh(new ConeGeometry(0.16, 0.3, 12, 1, true), glow('#b48cff', 1.4));
  nozzle.rotation.x = -Math.PI / 2;
  nozzle.position.set(0, 0, 0.49);
  core.add(nozzle);
  for (const a of [-0.38, 0, 0.38]) {
    const wisp = new Mesh(new ConeGeometry(0.14, 1.6, 10, 1, true), new MeshBasicMaterial({ color: '#d8c0ff', transparent: true, opacity: 0.35, depthWrite: false, side: DoubleSide }));
    wisp.rotation.set(-Math.PI / 2, 0, -a);
    wisp.position.set(Math.sin(a) * 1.5, 0.4, Math.cos(a) * 1.5);
    g.add(wisp);
  }
  return g;
}

function theExpansion(): Object3D {
  // Not a body: a frame round the Bunny, hollow inside r 1.3. The `grid` node (pivot at the
  // origin, scales outward in X/Z) is the comoving lattice: five glowing circles (r 1.3–3) and 24
  // spokes; the `ring` node (pivot at the origin, turns about Y) is a CMB-orange band (r 3.22)
  // with small galaxies flying off it.
  const g = new Group();
  const grid = node(g, 'grid', 0, 0, 0);
  for (let i = 0; i < 5; i++) {
    const r = 1.3 + (i / 4) * 1.7;
    flatRing(grid, r, 0.012, 0.02 + i * 0.1, glow(i === 4 ? '#ffb070' : '#6f9aff', 1.4));
  }
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const spoke = new Mesh(new BoxGeometry(0.02, 0.02, 1.7), glow('#4f78d8', 1.1));
    spoke.position.set(Math.sin(a) * 2.15, 0.22, Math.cos(a) * 2.15);
    spoke.rotation.set(-0.23, a, 0);
    grid.add(spoke);
  }
  const ring = node(g, 'ring', 0, 0, 0);
  flatRing(ring, 3.22, 0.04, 0.45, glow('#ff8a4a', 1.8));
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    ball(ring, 0.07, Math.sin(a) * 3.5, 0.45, Math.cos(a) * 3.5, glow(i % 2 ? '#fff1c8' : '#9ab8ff', 2.2), 0.5, 0);
  }
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
  landfill_compactor: landfillCompactor,
  freight_train: freightTrain,
  snowplow,
  crop_duster: cropDuster,
  river_barge: riverBarge,
  water_bomber: waterBomber,
  incinerator,
  tornado,
  glacier_tongue: glacierTongue,
  volcano,
  river_surge: riverSurge,
  hurricane,
  ice_sheet: iceSheet,
  debris_satellite: debrisSatellite,
  space_station: spaceStation,
  asat_laser: asatLaser,
  reentry_burn: reentryBurn,
  globe_hurricane: globeHurricane,
  orbital_sweeper: orbitalSweeper,
  mini_sweeper: miniSweeper,
  rogue_asteroid: rogueAsteroid,
  comet,
  sunspot,
  sungrazer,
  solar_flare: solarFlare,
  the_sun: theSun,
  black_hole: blackHole,
  globular_cluster: globularCluster,
  pulsar,
  supernova_remnant: supernovaRemnant,
  supernova,
  sagittarius_a: sagittariusA,
  quasar,
  colliding_galaxy: collidingGalaxy,
  gamma_ray_burst: gammaRayBurst,
  cosmic_void: cosmicVoid,
  dark_energy_gust: darkEnergyGust,
  the_expansion: theExpansion,
};

for (const [id, factory] of Object.entries(FACTORIES)) {
  if (!hasModel(id)) registerModel(id, () => factory());
}
