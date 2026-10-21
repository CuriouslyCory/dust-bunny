/**
 * Debris catalogue. Each type is rendered with one InstancedMesh built from `recipe`.
 *
 * Recipe units are normalised: the type's `size` (radius, cm) maps to 1, y = 0 is the floor.
 * Final colour = part colour (default white) × instance colour (picked from `colors`).
 *
 * To add a type: append to DEBRIS_TYPES (or call registerDebrisType() before a Run starts).
 */
import { zoneArea, type AreaId, type RoomType } from '../world/types';
import { OUTDOOR_DEBRIS } from './outdoorDebris';

export type V3 = [number, number, number];

interface PartBase {
  pos?: V3;
  /** Euler XYZ radians. */
  rot?: V3;
  scale?: V3;
  color?: string;
}

export type RecipePart =
  | (PartBase & { shape: 'box'; size: V3 })
  | (PartBase & { shape: 'sphere'; radius: number })
  | (PartBase & { shape: 'cylinder'; radiusTop: number; radiusBottom?: number; height: number; segments?: number })
  | (PartBase & { shape: 'cone'; radius: number; height: number; segments?: number })
  | (PartBase & { shape: 'torus'; radius: number; tube: number; arc?: number })
  | (PartBase & { shape: 'capsule'; radius: number; length: number })
  /** Lumpy icosphere; `noise` is displacement as a fraction of radius. */
  | (PartBase & { shape: 'blob'; radius: number; noise: number; detail?: number });

export interface DebrisMaterial {
  roughness?: number;
  metalness?: number;
  emissive?: string;
  emissiveIntensity?: number;
}

export interface DebrisType {
  id: string;
  name: string;
  /** Radius in cm; compared against Bunny radius × absorb ratio. */
  size: number;
  /** Multiplies growth gained when absorbed (dense things count more). */
  mass: number;
  colors: string[];
  recipe: RecipePart[];
  material?: DebrisMaterial;
  /** Spawn weight per room type; `any` is the fallback for unlisted rooms. */
  rooms: Partial<Record<RoomType | 'any', number>>;
  /** Inclusive Tier band in which the spawner produces this type. */
  tiers: [number, number];
  /** Where it spawns (default 'house'). Room weights only apply in rooms of that area. */
  area?: AreaId;
}

const PI = Math.PI;
const H = PI / 2;

export const DEBRIS_TYPES: DebrisType[] = [
  // ── Tier 1: Speck ─────────────────────────────────────────────
  {
    id: 'sand_grain', name: 'Sand Grain', size: 0.18, mass: 1.3, tiers: [1, 1],
    colors: ['#c9b48a', '#b59e74', '#d8c9a3'],
    recipe: [{ shape: 'blob', radius: 0.9, noise: 0.25, detail: 0, pos: [0, 0.6, 0], scale: [1, 0.7, 1] }],
    rooms: { any: 1, hallway: 2, bathroom: 1.5, kitchen: 1.5 },
  },
  {
    id: 'crumb', name: 'Crumb', size: 0.3, mass: 0.9, tiers: [1, 1],
    colors: ['#d9a35b', '#c58a3f', '#e8c27d'],
    recipe: [{ shape: 'blob', radius: 0.9, noise: 0.35, detail: 1, pos: [0, 0.5, 0], scale: [1, 0.6, 0.8] }],
    rooms: { any: 0.5, kitchen: 4, living: 2 },
  },
  {
    id: 'sequin', name: 'Sequin', size: 0.35, mass: 0.8, tiers: [1, 1],
    colors: ['#ff4fa3', '#ffd23f', '#4fd1ff', '#b388ff'],
    recipe: [{ shape: 'cylinder', radiusTop: 1, height: 0.12, segments: 6, pos: [0, 0.06, 0] }],
    material: { roughness: 0.25, metalness: 0.6, emissiveIntensity: 0.15, emissive: '#332233' },
    rooms: { any: 0.3, bedroom: 2, living: 1.5 },
  },
  {
    id: 'lint_ball', name: 'Lint Ball', size: 0.45, mass: 0.6, tiers: [1, 2],
    colors: ['#9aa0a8', '#b7b1c9', '#a7b8c4', '#c9b0b0'],
    recipe: [{ shape: 'blob', radius: 0.95, noise: 0.4, detail: 1, pos: [0, 0.75, 0], scale: [1, 0.8, 1] }],
    material: { roughness: 1 },
    rooms: { any: 1, living: 2, bedroom: 2.5 },
  },
  {
    id: 'staple', name: 'Staple', size: 0.55, mass: 1.6, tiers: [1, 2],
    colors: ['#c8cdd2'],
    recipe: [
      { shape: 'box', size: [1.8, 0.08, 0.08], pos: [0, 0.04, 0] },
      { shape: 'box', size: [0.08, 0.08, 0.6], pos: [-0.86, 0.04, 0.3] },
      { shape: 'box', size: [0.08, 0.08, 0.6], pos: [0.86, 0.04, 0.3] },
    ],
    material: { roughness: 0.3, metalness: 0.8 },
    rooms: { any: 0.5, living: 1, hallway: 2, bedroom: 1 },
  },
  {
    id: 'hair_strand', name: 'Hair', size: 0.6, mass: 0.3, tiers: [1, 1],
    colors: ['#3b2a1e', '#7a5a3a', '#d8b46a', '#222222'],
    recipe: [{ shape: 'torus', radius: 0.75, tube: 0.05, arc: 4.5, rot: [H, 0, 0], pos: [0, 0.05, 0] }],
    rooms: { any: 0.5, bathroom: 4, bedroom: 2 },
  },
  {
    id: 'marble', name: 'Marble', size: 0.9, mass: 1.8, tiers: [1, 2],
    colors: ['#7ec8e3', '#ff6b6b', '#95d5b2', '#ffd166'],
    recipe: [{ shape: 'sphere', radius: 1, pos: [0, 1, 0] }],
    material: { roughness: 0.08, metalness: 0.1 },
    rooms: { any: 0.3, living: 1.5, bedroom: 1.5, hallway: 1 },
  },
  {
    id: 'cereal_loop', name: 'Cereal', size: 1.0, mass: 0.8, tiers: [1, 2],
    colors: ['#f2a541', '#e2563f', '#9b5de5', '#f1c453'],
    recipe: [{ shape: 'torus', radius: 0.65, tube: 0.33, rot: [H, 0, 0], pos: [0, 0.33, 0] }],
    rooms: { kitchen: 4, living: 1.5 },
  },
  {
    id: 'button', name: 'Button', size: 1.1, mass: 1.0, tiers: [1, 2],
    colors: ['#e63946', '#457b9d', '#f4a261', '#2a9d8f', '#eeeeee'],
    recipe: [
      { shape: 'cylinder', radiusTop: 1, height: 0.2, segments: 20, pos: [0, 0.1, 0] },
      { shape: 'cylinder', radiusTop: 0.12, height: 0.22, segments: 8, pos: [0.25, 0.11, 0.25], color: '#555555' },
      { shape: 'cylinder', radiusTop: 0.12, height: 0.22, segments: 8, pos: [-0.25, 0.11, 0.25], color: '#555555' },
      { shape: 'cylinder', radiusTop: 0.12, height: 0.22, segments: 8, pos: [0.25, 0.11, -0.25], color: '#555555' },
      { shape: 'cylinder', radiusTop: 0.12, height: 0.22, segments: 8, pos: [-0.25, 0.11, -0.25], color: '#555555' },
    ],
    rooms: { any: 0.3, bedroom: 3, living: 1.5 },
  },
  // ── Tier 2: Fluff ─────────────────────────────────────────────
  {
    id: 'coin', name: 'Coin', size: 1.2, mass: 2.2, tiers: [2, 2],
    colors: ['#d4a73c', '#b8bcc2', '#b87333'],
    recipe: [{ shape: 'cylinder', radiusTop: 1, height: 0.14, segments: 24, pos: [0, 0.07, 0] }],
    material: { roughness: 0.35, metalness: 0.8 },
    rooms: { any: 1, living: 2 },
  },
  {
    id: 'bottle_cap', name: 'Bottle Cap', size: 1.5, mass: 1.2, tiers: [2, 2],
    colors: ['#d62828', '#f77f00', '#003049', '#cccccc'],
    recipe: [{ shape: 'cylinder', radiusTop: 1, height: 0.5, segments: 16, pos: [0, 0.25, 0] }],
    material: { roughness: 0.4, metalness: 0.5 },
    rooms: { kitchen: 4, living: 1 },
  },
  {
    id: 'paperclip', name: 'Paperclip', size: 1.6, mass: 1.0, tiers: [2, 2],
    colors: ['#c0c6cc', '#ef476f', '#06d6a0', '#118ab2'],
    recipe: [
      { shape: 'torus', radius: 0.5, tube: 0.05, rot: [H, 0, 0], scale: [1.9, 1, 1], pos: [0, 0.05, 0] },
      { shape: 'torus', radius: 0.3, tube: 0.05, rot: [H, 0, 0], scale: [2.1, 1, 1], pos: [0.15, 0.05, 0] },
    ],
    material: { roughness: 0.3, metalness: 0.6 },
    rooms: { any: 0.5, living: 1.5, hallway: 1.5, bedroom: 1 },
  },
  {
    id: 'lego_brick', name: 'LEGO Brick', size: 1.7, mass: 1.3, tiers: [2, 3],
    colors: ['#d01012', '#f5cd2f', '#0055bf', '#237841', '#ffffff'],
    recipe: [
      { shape: 'box', size: [1.6, 0.8, 0.8], pos: [0, 0.4, 0] },
      ...[-0.6, -0.2, 0.2, 0.6].flatMap((x): RecipePart[] => [
        { shape: 'cylinder', radiusTop: 0.13, height: 0.16, segments: 10, pos: [x, 0.88, 0.2] },
        { shape: 'cylinder', radiusTop: 0.13, height: 0.16, segments: 10, pos: [x, 0.88, -0.2] },
      ]),
    ],
    material: { roughness: 0.35 },
    rooms: { living: 2, bedroom: 3, hallway: 0.5 },
  },
  {
    id: 'bobby_pin', name: 'Bobby Pin', size: 1.8, mass: 0.7, tiers: [2, 2],
    colors: ['#2b2b2b', '#5a4632'],
    recipe: [
      { shape: 'box', size: [1.9, 0.06, 0.06], pos: [0, 0.03, 0.06], rot: [0, 0.05, 0] },
      { shape: 'box', size: [1.9, 0.06, 0.06], pos: [0, 0.03, -0.06], rot: [0, -0.05, 0] },
    ],
    material: { roughness: 0.4, metalness: 0.5 },
    rooms: { bathroom: 4, bedroom: 2 },
  },
  {
    id: 'eraser', name: 'Eraser', size: 2.4, mass: 1.0, tiers: [2, 3],
    colors: ['#f4a6b8', '#ffffff', '#f6d365'],
    recipe: [{ shape: 'box', size: [1.8, 0.5, 0.8], pos: [0, 0.25, 0] }],
    material: { roughness: 0.9 },
    rooms: { bedroom: 2, living: 1.5 },
  },
  {
    id: 'battery', name: 'Battery', size: 3.0, mass: 2.2, tiers: [2, 3],
    colors: ['#ffffff'],
    recipe: [
      { shape: 'cylinder', radiusTop: 0.33, height: 1.5, segments: 16, rot: [0, 0, H], pos: [-0.2, 0.33, 0], color: '#d98e04' },
      { shape: 'cylinder', radiusTop: 0.33, height: 0.4, segments: 16, rot: [0, 0, H], pos: [0.75, 0.33, 0], color: '#222222' },
      { shape: 'cylinder', radiusTop: 0.12, height: 0.12, segments: 10, rot: [0, 0, H], pos: [-1.0, 0.33, 0], color: '#bbbbbb' },
    ],
    material: { roughness: 0.4, metalness: 0.4 },
    rooms: { kitchen: 2, living: 1.5, any: 0.3 },
  },
  {
    id: 'tennis_ball', name: 'Tennis Ball', size: 3.3, mass: 1.0, tiers: [2, 3],
    colors: ['#d4e157', '#c6e03a'],
    recipe: [{ shape: 'sphere', radius: 1, pos: [0, 1, 0] }],
    material: { roughness: 1 },
    rooms: { living: 2, hallway: 2 },
  },
  {
    id: 'crayon', name: 'Crayon', size: 4.0, mass: 0.8, tiers: [2, 3],
    colors: ['#e63946', '#f4a261', '#2a9d8f', '#457b9d', '#9b5de5', '#06d6a0'],
    recipe: [
      { shape: 'cylinder', radiusTop: 0.12, height: 1.6, segments: 8, rot: [0, 0, H], pos: [-0.1, 0.12, 0] },
      { shape: 'cone', radius: 0.12, height: 0.3, segments: 8, rot: [0, 0, -H], pos: [0.85, 0.12, 0] },
    ],
    rooms: { bedroom: 2, living: 2 },
  },
  // ── Tier 3: Tumbleweed ───────────────────────────────────────
  {
    id: 'keys', name: 'Keys', size: 4.5, mass: 2.0, tiers: [3, 3],
    colors: ['#c9b037', '#b8bcc2'],
    recipe: [
      { shape: 'torus', radius: 0.35, tube: 0.05, rot: [H, 0, 0], pos: [-0.55, 0.05, 0] },
      { shape: 'box', size: [1.1, 0.06, 0.28], pos: [0.25, 0.05, 0.12], rot: [0, -0.3, 0] },
      { shape: 'box', size: [1.0, 0.06, 0.26], pos: [0.2, 0.1, -0.2], rot: [0, 0.4, 0] },
    ],
    material: { roughness: 0.3, metalness: 0.85 },
    rooms: { hallway: 4, living: 1, kitchen: 1 },
  },
  {
    id: 'toy_car', name: 'Toy Car', size: 5, mass: 1.8, tiers: [3, 3],
    colors: ['#e63946', '#1d3557', '#ffb703', '#2a9d8f'],
    recipe: [
      { shape: 'box', size: [1.8, 0.45, 0.9], pos: [0, 0.45, 0] },
      { shape: 'box', size: [0.9, 0.35, 0.8], pos: [-0.1, 0.85, 0] },
      ...([[0.6, 0.47], [-0.6, 0.47], [0.6, -0.47], [-0.6, -0.47]] as const).map(
        ([x, z]): RecipePart => ({ shape: 'cylinder', radiusTop: 0.22, height: 0.15, segments: 12, rot: [H, 0, 0], pos: [x, 0.22, z], color: '#222222' }),
      ),
    ],
    material: { roughness: 0.4, metalness: 0.3 },
    rooms: { living: 2, bedroom: 3 },
  },
  {
    id: 'rubber_duck', name: 'Rubber Duck', size: 5, mass: 0.9, tiers: [3, 3],
    colors: ['#ffd60a'],
    recipe: [
      { shape: 'sphere', radius: 0.8, scale: [1.2, 0.8, 1], pos: [0, 0.65, 0] },
      { shape: 'sphere', radius: 0.48, pos: [0.55, 1.4, 0] },
      { shape: 'box', size: [0.4, 0.12, 0.3], pos: [1.05, 1.32, 0], color: '#ff8c00' },
    ],
    material: { roughness: 0.4 },
    rooms: { bathroom: 5 },
  },
  {
    id: 'sponge', name: 'Sponge', size: 6, mass: 0.5, tiers: [3, 3],
    colors: ['#ffffff'],
    recipe: [
      { shape: 'box', size: [1.6, 0.45, 1.0], pos: [0, 0.225, 0], color: '#f6d743' },
      { shape: 'box', size: [1.6, 0.18, 1.0], pos: [0, 0.54, 0], color: '#3a9d4a' },
    ],
    material: { roughness: 1 },
    rooms: { kitchen: 4, bathroom: 2 },
  },
  {
    id: 'pen', name: 'Pen', size: 7, mass: 1.0, tiers: [3, 3],
    colors: ['#1d3557', '#e63946', '#222222'],
    recipe: [
      { shape: 'cylinder', radiusTop: 0.09, height: 1.7, segments: 10, rot: [0, 0, H], pos: [-0.1, 0.09, 0] },
      { shape: 'cone', radius: 0.09, height: 0.25, segments: 10, rot: [0, 0, -H], pos: [0.87, 0.09, 0], color: '#dddddd' },
      { shape: 'box', size: [0.5, 0.04, 0.05], pos: [-0.6, 0.2, 0] },
    ],
    material: { roughness: 0.3 },
    rooms: { living: 1.5, bedroom: 1.5, kitchen: 1 },
  },
  {
    id: 'cat_toy', name: 'Cat Toy', size: 6, mass: 0.8, tiers: [3, 4],
    colors: ['#9e9e9e', '#c9a27e', '#7d6b91'],
    recipe: [
      { shape: 'sphere', radius: 0.6, scale: [1.4, 0.75, 0.85], pos: [0, 0.45, 0] },
      { shape: 'sphere', radius: 0.18, pos: [0.45, 0.85, 0.22], color: '#f4acb7' },
      { shape: 'sphere', radius: 0.18, pos: [0.45, 0.85, -0.22], color: '#f4acb7' },
      { shape: 'torus', radius: 0.35, tube: 0.04, arc: 3.5, rot: [H, 0, 0], pos: [-1.0, 0.05, 0] },
    ],
    material: { roughness: 1 },
    rooms: { living: 2, hallway: 1, bedroom: 1, kitchen: 1 },
  },
  {
    id: 'sock', name: 'Sock', size: 10, mass: 0.8, tiers: [3, 4],
    colors: ['#f1faee', '#e63946', '#457b9d', '#2a9d8f', '#888888'],
    recipe: [
      { shape: 'capsule', radius: 0.3, length: 1.1, rot: [0, 0, H], scale: [1, 1, 0.9], pos: [-0.2, 0.22, 0] },
      { shape: 'capsule', radius: 0.28, length: 0.4, rot: [H, 0, 0], pos: [0.7, 0.22, 0.25] },
    ],
    material: { roughness: 1 },
    rooms: { bedroom: 4, bathroom: 2, hallway: 1.5, living: 1, kitchen: 0.5 },
  },
  {
    id: 'tv_remote', name: 'TV Remote', size: 10, mass: 1.6, tiers: [3, 4],
    colors: ['#222222', '#3a3a3a'],
    recipe: [
      { shape: 'box', size: [1.9, 0.25, 0.5], pos: [0, 0.125, 0] },
      { shape: 'box', size: [0.15, 0.05, 0.15], pos: [0.65, 0.27, 0], color: '#ff4d4d' },
      ...[0.3, 0, -0.3, -0.6].map((x): RecipePart => ({ shape: 'box', size: [0.12, 0.04, 0.3], pos: [x, 0.27, 0], color: '#888888' })),
    ],
    rooms: { living: 4 },
  },
  // ── Tier 4: Dust Devil ───────────────────────────────────────
  {
    id: 'slipper', name: 'Slipper', size: 13, mass: 0.9, tiers: [4, 4],
    colors: ['#f4acb7', '#9d8189', '#83c5be'],
    recipe: [
      { shape: 'box', size: [1.9, 0.15, 0.75], pos: [0, 0.075, 0], color: '#dddddd' },
      { shape: 'sphere', radius: 0.5, scale: [1.2, 0.6, 0.8], pos: [0.45, 0.2, 0] },
    ],
    material: { roughness: 1 },
    rooms: { bedroom: 3, hallway: 2, bathroom: 1, kitchen: 1 },
  },
  {
    id: 'book', name: 'Book', size: 14, mass: 1.8, tiers: [4, 4],
    colors: ['#264653', '#e76f51', '#2a9d8f', '#e9c46a', '#6d597a'],
    recipe: [
      { shape: 'box', size: [1.6, 0.35, 1.15], pos: [0, 0.175, 0] },
      { shape: 'box', size: [1.5, 0.27, 1.08], pos: [0.06, 0.175, 0], color: '#fff6dc' },
    ],
    material: { roughness: 0.8 },
    rooms: { living: 2, bedroom: 3, kitchen: 1 },
  },
  {
    id: 'shoe', name: 'Shoe', size: 15, mass: 1.6, tiers: [4, 4],
    colors: ['#5c4033', '#222222', '#ffffff', '#1d3557'],
    recipe: [
      { shape: 'box', size: [1.9, 0.18, 0.72], pos: [0, 0.09, 0], color: '#eeeeee' },
      { shape: 'sphere', radius: 0.55, scale: [1.6, 0.8, 0.62], pos: [0.1, 0.35, 0] },
      { shape: 'cylinder', radiusTop: 0.32, height: 0.6, segments: 12, pos: [-0.62, 0.45, 0] },
    ],
    material: { roughness: 0.7 },
    rooms: { hallway: 5, bedroom: 2 },
  },
  {
    id: 'plush_bear', name: 'Plush Bear', size: 16, mass: 1.0, tiers: [4, 4],
    colors: ['#a0522d', '#d2b48c', '#f4acb7'],
    recipe: [
      { shape: 'sphere', radius: 0.6, scale: [1, 0.9, 0.85], pos: [0, 0.55, 0] },
      { shape: 'sphere', radius: 0.42, pos: [0, 1.3, 0] },
      { shape: 'sphere', radius: 0.15, pos: [0.3, 1.65, 0] },
      { shape: 'sphere', radius: 0.15, pos: [-0.3, 1.65, 0] },
      { shape: 'sphere', radius: 0.12, pos: [0, 1.25, 0.38], color: '#333333' },
    ],
    material: { roughness: 1 },
    rooms: { bedroom: 4, living: 1 },
  },
  {
    id: 'waste_bin', name: 'Waste Bin', size: 18, mass: 1.5, tiers: [4, 5],
    colors: ['#6c757d', '#2a9d8f', '#e9ecef'],
    recipe: [{ shape: 'cylinder', radiusTop: 1, radiusBottom: 0.8, height: 2.0, segments: 18, pos: [0, 1.0, 0] }],
    material: { roughness: 0.5 },
    rooms: { kitchen: 2, bathroom: 2, bedroom: 1 },
  },
  {
    id: 'cushion', name: 'Cushion', size: 22, mass: 0.9, tiers: [4, 5],
    colors: ['#e76f51', '#2a9d8f', '#e9c46a', '#8d99ae'],
    recipe: [{ shape: 'sphere', radius: 1, scale: [0.95, 0.3, 0.95], pos: [0, 0.3, 0] }],
    material: { roughness: 1 },
    rooms: { living: 4, bedroom: 2 },
  },
  // ── Tier 5: Dust Titan ───────────────────────────────────────
  {
    id: 'potted_plant', name: 'Potted Plant', size: 26, mass: 2.0, tiers: [5, 5],
    colors: ['#ffffff'],
    recipe: [
      { shape: 'cylinder', radiusTop: 0.6, radiusBottom: 0.45, height: 1.0, segments: 16, pos: [0, 0.5, 0], color: '#c46a3a' },
      { shape: 'blob', radius: 0.9, noise: 0.25, detail: 1, pos: [0, 1.7, 0], color: '#3a7d44' },
    ],
    material: { roughness: 0.8 },
    rooms: { living: 3, hallway: 2, bedroom: 1, kitchen: 1 },
  },
  {
    id: 'laundry_basket', name: 'Laundry Basket', size: 28, mass: 1.2, tiers: [4, 5],
    colors: ['#e9ecef', '#a8dadc', '#f1c0e8'],
    recipe: [
      { shape: 'cylinder', radiusTop: 1, radiusBottom: 0.88, height: 1.3, segments: 20, pos: [0, 0.65, 0] },
      { shape: 'blob', radius: 0.8, noise: 0.3, detail: 1, scale: [1, 0.4, 1], pos: [0, 1.3, 0], color: '#8fa8c8' },
    ],
    material: { roughness: 0.8 },
    rooms: { bedroom: 3, bathroom: 3 },
  },
  {
    id: 'ottoman', name: 'Ottoman', size: 30, mass: 2.0, tiers: [5, 5],
    colors: ['#6d597a', '#355070', '#b56576'],
    recipe: [{ shape: 'cylinder', radiusTop: 1, height: 1.3, segments: 24, pos: [0, 0.65, 0] }],
    material: { roughness: 0.9 },
    rooms: { living: 3, bedroom: 1 },
  },
  {
    id: 'chair', name: 'Chair', size: 32, mass: 2.5, tiers: [5, 5],
    colors: ['#a47148', '#6f4518', '#d9c5a0'],
    recipe: [
      { shape: 'box', size: [1.3, 0.1, 1.3], pos: [0, 1.4, 0] },
      ...([[0.55, 0.55], [-0.55, 0.55], [0.55, -0.55], [-0.55, -0.55]] as const).map(
        ([x, z]): RecipePart => ({ shape: 'box', size: [0.1, 1.4, 0.1], pos: [x, 0.7, z] }),
      ),
      { shape: 'box', size: [1.3, 1.2, 0.1], pos: [0, 2.05, -0.6] },
    ],
    material: { roughness: 0.7 },
    rooms: { kitchen: 3, living: 0.5 },
  },
  ...OUTDOOR_DEBRIS,
];

/** Adds (or replaces by id) a Debris type. Call before a Run starts. */
export function registerDebrisType(type: DebrisType): void {
  const i = DEBRIS_TYPES.findIndex((t) => t.id === type.id);
  if (i >= 0) DEBRIS_TYPES[i] = type;
  else DEBRIS_TYPES.push(type);
}

export function getDebrisType(id: string): DebrisType | undefined {
  return DEBRIS_TYPES.find((t) => t.id === id);
}

export function roomWeight(type: DebrisType, room: RoomType): number {
  if (zoneArea(room) !== (type.area ?? 'house')) return 0;
  return type.rooms[room] ?? type.rooms.any ?? 0;
}
