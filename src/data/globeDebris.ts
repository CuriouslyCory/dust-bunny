/**
 * Globe Debris (area 'globe'), Tiers 13–15. Same format as DEBRIS_TYPES in debris.ts, but sizes
 * are in Globe units (1 = 1,000 km, `AREAS.globe.unit`): the Bunny arrives at 0.85 units (the
 * arrival leap) and absorbs the Orbital Sweeper at ≈3–4, so the ladder runs from satellites, spent
 * rocket stages, space junk and weather systems (0.1–0.15) through atolls, islands and patches of
 * ocean (0.3–0.6) to archipelagos, the Moon and whole landmasses (1–2.5). Room weights use the
 * globe zone types (oceans, shelves, landmasses, archipelagos, icecaps).
 *
 * Types whose id matches a loaded Globe model (public/models/manifest.json) render the Blender
 * mesh; their recipes are the headless / no-model fallback.
 */
import type { DebrisType, RecipePart } from './debris';

const WATER = '#2f6fa8';
const DEEP = '#1d4f86';
const SAND = '#e3d29a';
const GREEN = '#4f8a45';
const ROCK = '#8a8378';
const METAL = '#c9ccd2';
const PANEL = '#2b3f7a';
const CLOUD = '#f4f6f8';

/** Flat disc a hair above the floor. */
const pad = (radius: number, color: string, y = 0.01): RecipePart => ({ shape: 'cylinder', radiusTop: radius, height: 0.02, segments: 18, pos: [0, y, 0], color });

/** A small satellite: a box bus with two panel wings. */
const satellite = (wing: number): RecipePart[] => [
  { shape: 'box', size: [0.45, 0.4, 0.45], pos: [0, 0.3, 0], color: METAL },
  { shape: 'box', size: [wing, 0.04, 0.32], pos: [-(wing / 2 + 0.22), 0.3, 0], color: PANEL },
  { shape: 'box', size: [wing, 0.04, 0.32], pos: [wing / 2 + 0.22, 0.3, 0], color: PANEL },
];

const TINTS = ['#ffffff', '#f3f0e8', '#eaf0ee'];

export const GLOBE_DEBRIS: DebrisType[] = [
  // ── Arrival (Bunny r = 0.85 units after the leap; Tier 14 starts at 1) ──────────────
  {
    id: 'satellite', name: 'Satellite', size: 0.1, mass: 1.0, tiers: [13, 14], area: 'globe',
    colors: TINTS,
    recipe: satellite(0.5),
    material: { roughness: 0.5, metalness: 0.4 },
    rooms: { oceans: 1, shelves: 1, landmasses: 1, archipelagos: 1, icecaps: 0.6 },
  },
  {
    id: 'cloud_swirl', name: 'Weather System', size: 0.12, mass: 0.8, tiers: [13, 14], area: 'globe',
    colors: [CLOUD, '#e8edf2'],
    recipe: [{ shape: 'torus', radius: 0.6, tube: 0.25, pos: [0, 0.1, 0], rot: [Math.PI / 2, 0, 0], scale: [1, 1, 0.3] }, { shape: 'blob', radius: 0.4, noise: 0.3, pos: [0, 0.1, 0], scale: [1, 0.3, 1] }],
    material: { roughness: 1 },
    rooms: { oceans: 1.6, shelves: 1, landmasses: 0.6, archipelagos: 1 },
  },
  {
    id: 'rocket_stage', name: 'Spent Rocket Stage', size: 0.13, mass: 1.1, tiers: [13, 14], area: 'globe',
    colors: TINTS,
    recipe: [{ shape: 'cylinder', radiusTop: 0.28, height: 1.6, segments: 10, pos: [0, 0.28, 0], rot: [Math.PI / 2, 0, 0], color: '#e9e6df' }, { shape: 'cone', radius: 0.3, height: 0.35, pos: [0, 0.28, -0.95], rot: [-Math.PI / 2, 0, 0], color: '#5a5a5a' }],
    material: { roughness: 0.6, metalness: 0.3 },
    rooms: { any: 1 },
  },
  {
    id: 'space_junk', name: 'Space Junk', size: 0.15, mass: 1.2, tiers: [13, 14], area: 'globe',
    colors: TINTS,
    recipe: [
      { shape: 'box', size: [0.4, 0.2, 0.3], pos: [-0.3, 0.15, 0.1], rot: [0.3, 0.6, 0.1], color: METAL },
      { shape: 'box', size: [0.6, 0.04, 0.25], pos: [0.3, 0.1, -0.2], rot: [0, 1.1, 0.2], color: PANEL },
      { shape: 'cylinder', radiusTop: 0.12, height: 0.5, pos: [0.1, 0.12, 0.45], rot: [1.3, 0, 0.4], color: '#9a9a9a' },
    ],
    material: { roughness: 0.6, metalness: 0.3 },
    rooms: { any: 1 },
  },
  // ── Tier 14 (r 1–3) ──────────────
  {
    id: 'atoll', name: 'Atoll', size: 0.3, mass: 1.1, tiers: [14, 14], area: 'globe',
    colors: TINTS,
    recipe: [{ shape: 'torus', radius: 0.7, tube: 0.18, pos: [0, 0.02, 0], rot: [Math.PI / 2, 0, 0], scale: [1, 1, 0.2], color: SAND }, pad(0.6, '#4fb3c8')],
    material: { roughness: 0.5 },
    rooms: { oceans: 1.2, shelves: 1, archipelagos: 1.5 },
  },
  {
    id: 'island', name: 'Island', size: 0.45, mass: 1.2, tiers: [14, 15], area: 'globe',
    colors: TINTS,
    recipe: [pad(1, '#5fc0cf'), { shape: 'blob', radius: 0.75, noise: 0.25, pos: [0, 0, 0], scale: [1, 0.3, 0.8], color: GREEN }, pad(0.85, SAND, 0.005)],
    material: { roughness: 0.9 },
    rooms: { oceans: 0.8, shelves: 1.4, archipelagos: 2 },
  },
  {
    id: 'ocean_patch', name: 'Patch of Ocean', size: 0.6, mass: 0.9, tiers: [14, 15], area: 'globe',
    colors: [WATER, DEEP],
    recipe: [pad(1, DEEP), { shape: 'cylinder', radiusTop: 0.8, height: 0.03, segments: 18, pos: [0, 0.02, 0], color: WATER }],
    material: { roughness: 0.2 },
    rooms: { oceans: 2, shelves: 0.6 },
  },
  // ── Tier 15 (r ≥ 3) ──────────────
  {
    id: 'archipelago', name: 'Archipelago', size: 0.9, mass: 1.2, tiers: [14, 15], area: 'globe',
    colors: TINTS,
    recipe: ([[-0.6, -0.2, 0.3], [-0.15, 0.2, 0.35], [0.35, -0.1, 0.28], [0.7, 0.3, 0.22]] as const).flatMap(([x, z, r]): RecipePart[] => [
      { shape: 'cylinder', radiusTop: r * 1.3, height: 0.02, segments: 12, pos: [x, 0.01, z], color: '#5fc0cf' },
      { shape: 'blob', radius: r, noise: 0.25, pos: [x, 0, z], scale: [1, 0.35, 1], color: GREEN },
    ]),
    material: { roughness: 0.9 },
    rooms: { archipelagos: 2.5, shelves: 1, oceans: 0.6 },
  },
  {
    id: 'moon', name: 'The Moon', size: 1.74, mass: 1.6, tiers: [14, 15], area: 'globe',
    colors: ['#b9b6b0', '#a9a6a0'],
    recipe: [{ shape: 'blob', radius: 1, noise: 0.06, detail: 2, pos: [0, 1, 0], color: ROCK }],
    material: { roughness: 1 },
    rooms: { oceans: 0.25, landmasses: 0.15 },
  },
  {
    id: 'landmass', name: 'Landmass', size: 2.4, mass: 1.4, tiers: [15, 15], area: 'globe',
    colors: TINTS,
    recipe: [{ shape: 'blob', radius: 1, noise: 0.3, detail: 1, pos: [0, 0, 0], scale: [1, 0.15, 0.75], color: GREEN }, pad(1.05, SAND, 0.004)],
    material: { roughness: 1 },
    rooms: { landmasses: 1.5, oceans: 0.4, shelves: 0.6 },
  },
];
