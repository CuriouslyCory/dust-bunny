/**
 * Neighborhood Debris (area 'neighborhood'), Tiers 5–7. Same format as DEBRIS_TYPES in
 * debris.ts; room weights use the outdoor zone types (yard, street, sidewalk, driveway, park).
 * Ids that match a Blender model (car, mailbox, trash_can, bicycle, garden_gnome,
 * fire_hydrant) render the GLB when it is loaded and fall back to the recipe otherwise.
 */
import type { DebrisType, RecipePart } from './debris';

const PI = Math.PI;
const H = PI / 2;

const wheel = (x: number, y: number, z: number, r: number, t: number): RecipePart => ({
  shape: 'cylinder', radiusTop: r, height: t, segments: 14, pos: [x, y, z], rot: [0, 0, H], color: '#222222',
});

export const OUTDOOR_DEBRIS: DebrisType[] = [
  // ── Tier 5 outdoors (Bunny r ≈ 50–75) ─────────────────────────
  {
    id: 'pinecone', name: 'Pinecone', size: 7, mass: 1.2, tiers: [5, 5], area: 'neighborhood',
    colors: ['#8a5a32', '#6f4526'],
    recipe: [{ shape: 'cone', radius: 0.55, height: 1.9, segments: 8, rot: [H, 0, 0], pos: [0, 0.5, 0] }, { shape: 'blob', radius: 0.5, noise: 0.35, pos: [0, 0.5, 0.3] }],
    material: { roughness: 1 },
    rooms: { yard: 2, park: 4, sidewalk: 1 },
  },
  {
    id: 'tennis_ball', name: 'Tennis Ball', size: 8, mass: 0.8, tiers: [5, 5], area: 'neighborhood',
    colors: ['#d8f04a'],
    recipe: [{ shape: 'sphere', radius: 1, pos: [0, 1, 0] }],
    material: { roughness: 1 },
    rooms: { yard: 2, park: 2, street: 0.5 },
  },
  {
    id: 'soccer_ball', name: 'Soccer Ball', size: 11, mass: 0.8, tiers: [5, 5], area: 'neighborhood',
    colors: ['#f4f4f4', '#ffd166', '#90e0ef'],
    recipe: [{ shape: 'sphere', radius: 1, pos: [0, 1, 0] }, { shape: 'blob', radius: 0.35, noise: 0.05, scale: [1, 1, 0.3], pos: [0, 1.2, 0.85], color: '#222222' }],
    material: { roughness: 0.6 },
    rooms: { yard: 2, park: 2, street: 0.5 },
  },
  {
    id: 'newspaper', name: 'Newspaper', size: 12, mass: 0.8, tiers: [5, 5], area: 'neighborhood',
    colors: ['#e9e4d8'],
    recipe: [{ shape: 'cylinder', radiusTop: 0.35, height: 1.8, segments: 10, rot: [0, 0, H], pos: [0, 0.35, 0] }, { shape: 'torus', radius: 0.36, tube: 0.04, rot: [0, H, 0], pos: [0, 0.35, 0], color: '#d1495b' }],
    rooms: { sidewalk: 3, driveway: 3, yard: 1 },
  },
  {
    id: 'flower_pot', name: 'Flower Pot', size: 14, mass: 1.6, tiers: [5, 5], area: 'neighborhood',
    colors: ['#ffffff'],
    recipe: [
      { shape: 'cylinder', radiusTop: 0.7, radiusBottom: 0.5, height: 1.1, segments: 14, pos: [0, 0.55, 0], color: '#c46a3a' },
      { shape: 'blob', radius: 0.75, noise: 0.25, pos: [0, 1.4, 0], color: '#3a7d44' },
      { shape: 'sphere', radius: 0.22, pos: [0.3, 1.9, 0.2], color: '#ff6b9a' },
      { shape: 'sphere', radius: 0.2, pos: [-0.35, 1.75, -0.1], color: '#ffd166' },
    ],
    rooms: { yard: 2, sidewalk: 1 },
  },
  {
    id: 'watering_can', name: 'Watering Can', size: 15, mass: 1.2, tiers: [5, 5], area: 'neighborhood',
    colors: ['#2a9d8f', '#e76f51', '#8d99ae'],
    recipe: [
      { shape: 'cylinder', radiusTop: 0.55, height: 1.1, segments: 14, pos: [0, 0.55, 0] },
      { shape: 'cylinder', radiusTop: 0.08, radiusBottom: 0.12, height: 1.0, rot: [-0.9, 0, 0], pos: [0, 0.8, 0.75] },
      { shape: 'torus', radius: 0.35, tube: 0.06, arc: PI, pos: [0, 1.1, -0.2], rot: [0, H, 0] },
    ],
    material: { roughness: 0.4, metalness: 0.3 },
    rooms: { yard: 3 },
  },
  {
    id: 'garden_gnome', name: 'Garden Gnome', size: 16, mass: 2.0, tiers: [5, 5], area: 'neighborhood',
    colors: ['#ffffff'],
    recipe: [
      { shape: 'cylinder', radiusTop: 0.45, radiusBottom: 0.6, height: 1.0, segments: 12, pos: [0, 0.5, 0], color: '#3a6ea5' },
      { shape: 'sphere', radius: 0.38, pos: [0, 1.25, 0], color: '#f2c6a0' },
      { shape: 'cone', radius: 0.42, height: 1.0, segments: 12, pos: [0, 1.9, 0], color: '#d62828' },
      { shape: 'cone', radius: 0.32, height: 0.6, segments: 10, rot: [PI, 0, 0], pos: [0, 0.95, 0.22], color: '#f4f4f4' },
    ],
    rooms: { yard: 3, park: 1 },
  },
  {
    id: 'pumpkin', name: 'Pumpkin', size: 18, mass: 1.6, tiers: [5, 5], area: 'neighborhood',
    colors: ['#f77f00', '#e36414'],
    recipe: [{ shape: 'blob', radius: 1, noise: 0.08, scale: [1, 0.75, 1], pos: [0, 0.75, 0] }, { shape: 'cylinder', radiusTop: 0.08, height: 0.4, pos: [0, 1.6, 0], color: '#4f772d' }],
    rooms: { yard: 2, sidewalk: 1 },
  },
  {
    id: 'traffic_cone', name: 'Traffic Cone', size: 18, mass: 1.0, tiers: [5, 6], area: 'neighborhood',
    colors: ['#ff7b00'],
    recipe: [
      { shape: 'box', size: [1.6, 0.12, 1.6], pos: [0, 0.06, 0] },
      { shape: 'cone', radius: 0.6, height: 2.6, segments: 14, pos: [0, 1.4, 0] },
      { shape: 'cylinder', radiusTop: 0.36, radiusBottom: 0.42, height: 0.3, segments: 14, pos: [0, 1.2, 0], color: '#f4f4f4' },
    ],
    rooms: { street: 3, sidewalk: 1 },
  },
  {
    id: 'lawn_flamingo', name: 'Lawn Flamingo', size: 20, mass: 0.8, tiers: [5, 5], area: 'neighborhood',
    colors: ['#ff6fae'],
    recipe: [
      { shape: 'cylinder', radiusTop: 0.04, height: 2.0, pos: [0, 1.0, 0], color: '#333333' },
      { shape: 'sphere', radius: 0.55, scale: [0.6, 0.6, 1], pos: [0, 2.2, 0] },
      { shape: 'capsule', radius: 0.08, length: 0.9, rot: [0.3, 0, 0], pos: [0, 2.8, 0.35] },
      { shape: 'sphere', radius: 0.16, pos: [0, 3.25, 0.55] },
    ],
    rooms: { yard: 2 },
  },
  {
    id: 'leaf_pile', name: 'Leaf Pile', size: 24, mass: 0.6, tiers: [5, 6], area: 'neighborhood',
    colors: ['#d97b29', '#c1440e', '#e9b44c'],
    recipe: [{ shape: 'blob', radius: 1, noise: 0.35, detail: 2, scale: [1, 0.35, 1], pos: [0, 0.25, 0] }],
    material: { roughness: 1 },
    rooms: { yard: 3, park: 4, sidewalk: 1 },
  },
  {
    id: 'skateboard', name: 'Skateboard', size: 26, mass: 1.4, tiers: [5, 6], area: 'neighborhood',
    colors: ['#e63946', '#457b9d', '#2a2a2a'],
    recipe: [
      { shape: 'capsule', radius: 0.26, length: 1.4, scale: [1, 0.12, 1], rot: [H, 0, 0], pos: [0, 0.2, 0] },
      wheel(0.18, 0.08, 0.55, 0.08, 0.08), wheel(-0.18, 0.08, 0.55, 0.08, 0.08), wheel(0.18, 0.08, -0.55, 0.08, 0.08), wheel(-0.18, 0.08, -0.55, 0.08, 0.08),
    ],
    rooms: { driveway: 3, sidewalk: 2, street: 1 },
  },
  {
    id: 'tire', name: 'Old Tire', size: 30, mass: 1.6, tiers: [5, 6], area: 'neighborhood',
    colors: ['#2b2b2b'],
    recipe: [{ shape: 'torus', radius: 0.72, tube: 0.28, rot: [H, 0, 0], pos: [0, 0.28, 0] }],
    material: { roughness: 0.9 },
    rooms: { driveway: 2, street: 1, yard: 0.5 },
  },
  {
    id: 'fire_hydrant', name: 'Fire Hydrant', size: 30, mass: 3.0, tiers: [5, 6], area: 'neighborhood',
    colors: ['#d62828', '#f4d35e'],
    recipe: [
      { shape: 'cylinder', radiusTop: 0.42, height: 1.9, segments: 14, pos: [0, 0.95, 0] },
      { shape: 'sphere', radius: 0.44, pos: [0, 1.9, 0] },
      { shape: 'cylinder', radiusTop: 0.18, height: 1.3, segments: 10, rot: [0, 0, H], pos: [0, 1.3, 0], color: '#c0c0c0' },
      { shape: 'cylinder', radiusTop: 0.6, height: 0.15, segments: 14, pos: [0, 0.08, 0] },
    ],
    material: { roughness: 0.5, metalness: 0.2 },
    rooms: { sidewalk: 3 },
  },
  // ── Tier 6: Dust Storm (r 75–160) ─────────────────────────────
  {
    id: 'mailbox', name: 'Mailbox', size: 36, mass: 2.0, tiers: [6, 6], area: 'neighborhood',
    colors: ['#3d405b', '#f4f1de', '#264653'],
    recipe: [
      { shape: 'box', size: [0.18, 2.4, 0.18], pos: [0, 1.2, 0], color: '#8a6a4a' },
      { shape: 'capsule', radius: 0.32, length: 0.9, rot: [H, 0, 0], pos: [0, 2.6, 0] },
      { shape: 'box', size: [0.06, 0.5, 0.18], pos: [0.36, 2.9, -0.2], color: '#d62828' },
    ],
    rooms: { sidewalk: 1 },
  },
  {
    id: 'trash_can', name: 'Trash Can', size: 40, mass: 1.6, tiers: [6, 6], area: 'neighborhood',
    colors: ['#2d6a4f', '#3d5a80', '#6c757d'],
    recipe: [
      { shape: 'box', size: [1.25, 2.2, 1.35], pos: [0, 1.15, 0] },
      { shape: 'box', size: [1.35, 0.12, 1.45], pos: [0, 2.3, 0] },
      wheel(0.55, 0.18, -0.6, 0.18, 0.12), wheel(-0.55, 0.18, -0.6, 0.18, 0.12),
    ],
    material: { roughness: 0.6 },
    rooms: { driveway: 2, sidewalk: 2, street: 0.5 },
  },
  {
    id: 'lawn_chair', name: 'Lawn Chair', size: 42, mass: 1.2, tiers: [6, 6], area: 'neighborhood',
    colors: ['#2a9d8f', '#f4a261', '#e9c46a'],
    recipe: [
      { shape: 'box', size: [1.2, 0.08, 1.1], pos: [0, 0.75, 0.1] },
      { shape: 'box', size: [1.2, 1.1, 0.08], rot: [-0.35, 0, 0], pos: [0, 1.3, -0.55] },
      { shape: 'box', size: [0.06, 0.8, 1.3], pos: [0.62, 0.4, 0], color: '#cfcfcf' },
      { shape: 'box', size: [0.06, 0.8, 1.3], pos: [-0.62, 0.4, 0], color: '#cfcfcf' },
    ],
    rooms: { yard: 3, park: 1 },
  },
  {
    id: 'bbq_grill', name: 'BBQ Grill', size: 50, mass: 3.0, tiers: [6, 7], area: 'neighborhood',
    colors: ['#1f1f1f', '#6b0f1a'],
    recipe: [
      { shape: 'sphere', radius: 0.6, pos: [0, 1.6, 0] },
      ...([[0.35, 0.2], [-0.35, 0.2], [0, -0.4]] as const).map(([x, z]): RecipePart => ({ shape: 'cylinder', radiusTop: 0.05, height: 1.5, pos: [x, 0.75, z], color: '#888888' })),
      { shape: 'cylinder', radiusTop: 0.06, height: 0.3, pos: [0, 2.3, 0], color: '#888888' },
    ],
    material: { roughness: 0.5, metalness: 0.4 },
    rooms: { yard: 3 },
  },
  {
    id: 'wheelbarrow', name: 'Wheelbarrow', size: 60, mass: 2.0, tiers: [6, 7], area: 'neighborhood',
    colors: ['#2a9d8f', '#e63946', '#f4a261'],
    recipe: [
      { shape: 'box', size: [0.9, 0.5, 1.1], pos: [0, 0.75, 0.1] },
      wheel(0, 0.3, 0.8, 0.3, 0.12),
      { shape: 'capsule', radius: 0.04, length: 1.4, rot: [H - 0.2, 0, 0], pos: [0.35, 0.7, -0.4], color: '#8a6a4a' },
      { shape: 'capsule', radius: 0.04, length: 1.4, rot: [H - 0.2, 0, 0], pos: [-0.35, 0.7, -0.4], color: '#8a6a4a' },
    ],
    rooms: { yard: 2, driveway: 1 },
  },
  {
    id: 'shrub', name: 'Shrub', size: 70, mass: 1.0, tiers: [6, 7], area: 'neighborhood',
    colors: ['#3a7d44', '#4f772d', '#2d6a4f'],
    recipe: [{ shape: 'blob', radius: 1, noise: 0.3, detail: 2, scale: [1, 0.85, 1], pos: [0, 0.8, 0] }],
    material: { roughness: 1 },
    rooms: { yard: 2, park: 3 },
  },
  {
    id: 'bicycle', name: 'Bicycle', size: 78, mass: 1.4, tiers: [6, 7], area: 'neighborhood',
    colors: ['#e63946', '#219ebc', '#ffb703'],
    recipe: [
      { shape: 'torus', radius: 0.36, tube: 0.04, rot: [0, H, 0], pos: [0, 0.4, 0.62], color: '#222222' },
      { shape: 'torus', radius: 0.36, tube: 0.04, rot: [0, H, 0], pos: [0, 0.4, -0.62], color: '#222222' },
      { shape: 'capsule', radius: 0.035, length: 1.0, rot: [H, 0, 0], pos: [0, 0.75, 0] },
      { shape: 'capsule', radius: 0.035, length: 0.6, rot: [0.5, 0, 0], pos: [0, 0.55, -0.3] },
      { shape: 'capsule', radius: 0.035, length: 0.6, rot: [-0.4, 0, 0], pos: [0, 0.6, 0.45] },
      { shape: 'box', size: [0.1, 0.05, 0.25], pos: [0, 0.95, -0.3], color: '#222222' },
      { shape: 'capsule', radius: 0.03, length: 0.45, rot: [0, 0, H], pos: [0, 1.0, 0.55], color: '#222222' },
    ],
    material: { roughness: 0.4, metalness: 0.4 },
    rooms: { driveway: 3, sidewalk: 1, yard: 1 },
  },
  {
    id: 'doghouse', name: 'Doghouse', size: 80, mass: 2.0, tiers: [6, 7], area: 'neighborhood',
    colors: ['#b5651d', '#9c6644', '#d4a373'],
    recipe: [
      { shape: 'box', size: [1.3, 1.0, 1.4], pos: [0, 0.5, 0] },
      { shape: 'cone', radius: 1.05, height: 0.7, segments: 4, rot: [0, PI / 4, 0], pos: [0, 1.35, 0], color: '#7f4f24' },
      { shape: 'box', size: [0.45, 0.6, 0.05], pos: [0, 0.32, 0.71], color: '#1f1f1f' },
    ],
    rooms: { yard: 2 },
  },
  {
    id: 'park_bench', name: 'Park Bench', size: 90, mass: 2.2, tiers: [6, 7], area: 'neighborhood',
    colors: ['#8a5a32', '#4f6d7a'],
    recipe: [
      { shape: 'box', size: [1.8, 0.08, 0.5], pos: [0, 0.45, 0] },
      { shape: 'box', size: [1.8, 0.4, 0.06], rot: [-0.2, 0, 0], pos: [0, 0.75, -0.25] },
      ...([0.8, -0.8] as const).map((x): RecipePart => ({ shape: 'box', size: [0.08, 0.45, 0.45], pos: [x, 0.22, 0], color: '#2b2b2b' })),
    ],
    rooms: { park: 2, sidewalk: 0.5 },
  },
  {
    id: 'kiddie_pool', name: 'Kiddie Pool', size: 100, mass: 1.0, tiers: [6, 7], area: 'neighborhood',
    colors: ['#48cae4', '#ff8fab'],
    recipe: [
      { shape: 'torus', radius: 0.85, tube: 0.15, rot: [H, 0, 0], pos: [0, 0.15, 0] },
      { shape: 'cylinder', radiusTop: 0.85, height: 0.04, segments: 24, pos: [0, 0.12, 0], color: '#90e0ef' },
    ],
    material: { roughness: 0.3 },
    rooms: { yard: 2 },
  },
  // ── Tier 7: Dust Cyclone (r 160+) ─────────────────────────────
  {
    id: 'picnic_table', name: 'Picnic Table', size: 115, mass: 2.4, tiers: [7, 7], area: 'neighborhood',
    colors: ['#a47148', '#8a5a32'],
    recipe: [
      { shape: 'box', size: [1.7, 0.08, 0.7], pos: [0, 0.65, 0] },
      { shape: 'box', size: [1.7, 0.06, 0.25], pos: [0, 0.38, 0.65] },
      { shape: 'box', size: [1.7, 0.06, 0.25], pos: [0, 0.38, -0.65] },
      ...([0.7, -0.7] as const).map((x): RecipePart => ({ shape: 'box', size: [0.08, 0.65, 1.5], pos: [x, 0.32, 0] })),
    ],
    rooms: { park: 3, yard: 1 },
  },
  {
    id: 'golf_cart', name: 'Golf Cart', size: 130, mass: 3.0, tiers: [7, 7], area: 'neighborhood',
    colors: ['#f4f4f4', '#90be6d'],
    recipe: [
      { shape: 'box', size: [0.9, 0.4, 1.6], pos: [0, 0.45, 0] },
      { shape: 'box', size: [0.9, 0.06, 1.0], pos: [0, 1.4, -0.1] },
      ...([0.42, -0.42] as const).flatMap((x): RecipePart[] => [
        { shape: 'box', size: [0.05, 0.9, 0.05], pos: [x, 0.95, 0.35], color: '#555555' },
        { shape: 'box', size: [0.05, 0.9, 0.05], pos: [x, 0.95, -0.55], color: '#555555' },
      ]),
      wheel(0.45, 0.2, 0.55, 0.2, 0.12), wheel(-0.45, 0.2, 0.55, 0.2, 0.12), wheel(0.45, 0.2, -0.55, 0.2, 0.12), wheel(-0.45, 0.2, -0.55, 0.2, 0.12),
    ],
    rooms: { driveway: 1, street: 1, park: 1 },
  },
  {
    id: 'swing_set', name: 'Swing Set', size: 150, mass: 2.0, tiers: [7, 7], area: 'neighborhood',
    colors: ['#e63946', '#219ebc'],
    recipe: [
      { shape: 'cylinder', radiusTop: 0.04, height: 1.8, rot: [0, 0, H], pos: [0, 1.25, 0] },
      ...([0.9, -0.9] as const).flatMap((x): RecipePart[] => [
        { shape: 'cylinder', radiusTop: 0.04, height: 1.35, rot: [0.4, 0, 0], pos: [x, 0.62, 0.25] },
        { shape: 'cylinder', radiusTop: 0.04, height: 1.35, rot: [-0.4, 0, 0], pos: [x, 0.62, -0.25] },
      ]),
      ...([0.4, -0.4] as const).map((x): RecipePart => ({ shape: 'box', size: [0.3, 0.04, 0.12], pos: [x, 0.35, 0], color: '#2b2b2b' })),
    ],
    rooms: { park: 3, yard: 1 },
  },
  {
    id: 'car', name: 'Car', size: 160, mass: 4.0, tiers: [7, 7], area: 'neighborhood',
    colors: ['#d62828', '#277da1', '#f4f1de', '#43aa8b', '#2b2d42', '#f9c74f'],
    recipe: [
      { shape: 'box', size: [0.88, 0.42, 1.95], pos: [0, 0.38, 0] },
      { shape: 'box', size: [0.8, 0.34, 1.05], pos: [0, 0.75, -0.15], color: '#a8c5d6' },
      wheel(0.45, 0.17, 0.62, 0.17, 0.12), wheel(-0.45, 0.17, 0.62, 0.17, 0.12), wheel(0.45, 0.17, -0.62, 0.17, 0.12), wheel(-0.45, 0.17, -0.62, 0.17, 0.12),
      { shape: 'box', size: [0.2, 0.08, 0.02], pos: [0.28, 0.45, 0.98], color: '#fff3b0' },
      { shape: 'box', size: [0.2, 0.08, 0.02], pos: [-0.28, 0.45, 0.98], color: '#fff3b0' },
    ],
    material: { roughness: 0.35, metalness: 0.3 },
    rooms: { driveway: 0.4, street: 0.6 },
  },
  {
    id: 'trampoline', name: 'Trampoline', size: 175, mass: 1.5, tiers: [7, 7], area: 'neighborhood',
    colors: ['#3a86ff', '#38b000'],
    recipe: [
      { shape: 'torus', radius: 0.95, tube: 0.06, rot: [H, 0, 0], pos: [0, 0.45, 0] },
      { shape: 'cylinder', radiusTop: 0.9, height: 0.02, segments: 24, pos: [0, 0.45, 0], color: '#1f1f1f' },
      ...([0, 2, 4] as const).map((k): RecipePart => ({ shape: 'cylinder', radiusTop: 0.03, height: 0.45, pos: [Math.cos((k * PI) / 3) * 0.9, 0.22, Math.sin((k * PI) / 3) * 0.9], color: '#888888' })),
    ],
    rooms: { yard: 2, park: 1 },
  },
];
