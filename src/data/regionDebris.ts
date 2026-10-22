/**
 * Region Debris (area 'region'), Tiers 10–11. Same format as DEBRIS_TYPES in debris.ts, but sizes
 * are in Region units (1 = 10 m, `AREAS.region.unit`): the Bunny arrives at ≈0.65–0.9 units and
 * absorbs the Incinerator at ≈3–4, so the ladder runs from hay bales (0.08) to whole small towns
 * (3.1) and cooling towers (3.3). Room weights use the region zone types (farmland, highway, river,
 * town, woods, landfill). The region generator places some of these at fixed spots (traffic on
 * the highways, farms, town buildings, the landfill heaps, boats, cabins, wind turbines).
 */
import type { DebrisType, RecipePart, V3 } from './debris';

const PI = Math.PI;
const H = PI / 2;

const wheel = (x: number, y: number, z: number, r: number, t: number): RecipePart => ({
  shape: 'cylinder', radiusTop: r, height: t, segments: 10, pos: [x, y, z], rot: [0, 0, H], color: '#222222',
});
/** Four wheels at (±x, ±z) for a vehicle facing +Z. */
const wheels = (x: number, z: number, r: number, t = 0.12): RecipePart[] => [wheel(x, r, z, r, t), wheel(-x, r, z, r, t), wheel(x, r, -z, r, t), wheel(-x, r, -z, r, t)];
const GLASS = '#a8c5d6';
const ROOF_RED = '#8e3b30';
const ROOF_GREY = '#5b5f66';
const GRASS = '#8a9a5b';

/**
 * Gable roof over a box of width w (X), depth d (Z) whose top is at y: two slabs meeting at a
 * ridge along Z (or X with `alongX`).
 */
function gable(x: number, y: number, z: number, w: number, d: number, color: string, alongX = false, pitch = 0.55): RecipePart[] {
  const span = (alongX ? d : w) / 2;
  const slab = span / Math.cos(pitch);
  const rise = Math.sin(pitch) * slab * 0.5;
  const off = span / 2;
  if (alongX) {
    return [
      { shape: 'box', size: [w * 1.04, 0.04, slab * 1.08], rot: [pitch, 0, 0], pos: [x, y + rise, z + off], color },
      { shape: 'box', size: [w * 1.04, 0.04, slab * 1.08], rot: [-pitch, 0, 0], pos: [x, y + rise, z - off], color },
    ];
  }
  return [
    { shape: 'box', size: [slab * 1.08, 0.04, d * 1.04], rot: [0, 0, -pitch], pos: [x + off, y + rise, z], color },
    { shape: 'box', size: [slab * 1.08, 0.04, d * 1.04], rot: [0, 0, pitch], pos: [x - off, y + rise, z], color },
  ];
}

/** A small house (body + gable roof) centred at (x, z), facing +Z. */
function cottage(x: number, z: number, w: number, d: number, h: number, wall: string, roof: string, alongX = true): RecipePart[] {
  return [{ shape: 'box', size: [w, h, d], pos: [x, h / 2, z], color: wall }, ...gable(x, h, z, w, d, roof, alongX)];
}

/** Flat ground disc (yard, forecourt, village green) a hair above the floor. */
const pad = (radius: number, color?: string, scale: V3 = [1, 1, 1]): RecipePart => ({
  shape: 'cylinder', radiusTop: radius, height: 0.02, segments: 20, pos: [0, 0.01, 0], scale, ...(color ? { color } : {}),
});

const TOWN_WALLS = ['#e6d3b3', '#d8c4a8', '#c9b48f', '#efe8da', '#b5654a', '#c7d3d8'];
const TOWN_ROOFS = [ROOF_RED, '#7a3b2e', ROOF_GREY, '#6b4f3a', '#a4513f'];

/** A ring of `n` small houses around a centre, for villages and towns. */
function houseRing(n: number, radius: number, scale: number, phase = 0): RecipePart[] {
  const out: RecipePart[] = [];
  for (let i = 0; i < n; i++) {
    const a = phase + (i / n) * PI * 2;
    const x = Math.cos(a) * radius;
    const z = Math.sin(a) * radius;
    out.push(...cottage(x, z, 0.18 * scale, 0.14 * scale, 0.12 * scale, TOWN_WALLS[i % TOWN_WALLS.length]!, TOWN_ROOFS[i % TOWN_ROOFS.length]!, i % 2 === 0));
  }
  return out;
}

export const REGION_DEBRIS: DebrisType[] = [
  // ── Arrival and Tier 10 (Bunny r ≈ 0.65–3 units) ──────────────
  {
    id: 'hay_bales', name: 'Hay Bales', size: 0.08, mass: 1.0, tiers: [10, 10], area: 'region',
    colors: ['#d9b75e', '#c9a64a', '#e3c677'],
    recipe: [
      { shape: 'cylinder', radiusTop: 0.3, height: 0.42, segments: 12, rot: [0, 0, H], pos: [-0.45, 0.3, -0.3] },
      { shape: 'cylinder', radiusTop: 0.3, height: 0.42, segments: 12, rot: [0, 0, H], pos: [0.1, 0.3, -0.35] },
      { shape: 'cylinder', radiusTop: 0.3, height: 0.42, segments: 12, rot: [0, 0, H], pos: [-0.15, 0.3, 0.35] },
      { shape: 'cylinder', radiusTop: 0.3, height: 0.42, segments: 12, rot: [0, 0, H], pos: [-0.18, 0.82, -0.32] },
      { shape: 'cylinder', radiusTop: 0.3, height: 0.42, segments: 12, rot: [0, 0, H], pos: [0.6, 0.3, 0.3] },
    ],
    material: { roughness: 1 },
    rooms: { farmland: 3, any: 0.3 },
  },
  {
    id: 'dairy_cows', name: 'Dairy Cows', size: 0.1, mass: 1.4, tiers: [10, 10], area: 'region',
    colors: ['#f4f1ea', '#e8e2d6', '#8a5a3b'],
    recipe: ([[-0.45, -0.2, 0.3], [0.35, -0.4, -0.5], [0.15, 0.45, 1.6]] as const).flatMap(([x, z, a]): RecipePart[] => [
      { shape: 'box', size: [0.24, 0.22, 0.5], rot: [0, a, 0], pos: [x, 0.36, z] },
      { shape: 'box', size: [0.14, 0.14, 0.16], rot: [0, a, 0], pos: [x + Math.sin(a) * 0.3, 0.42, z + Math.cos(a) * 0.3], color: '#e8e2d6' },
      { shape: 'box', size: [0.2, 0.24, 0.42], rot: [0, a, 0], pos: [x, 0.13, z], color: '#3a3a3a', scale: [0.9, 1, 0.8] },
      { shape: 'box', size: [0.25, 0.1, 0.18], rot: [0, a, 0], pos: [x, 0.43, z], color: '#222222' },
    ]),
    material: { roughness: 0.9 },
    rooms: { farmland: 2.5 },
  },
  {
    id: 'log_pile', name: 'Log Pile', size: 0.12, mass: 1.6, tiers: [10, 10], area: 'region',
    colors: ['#8a6a48', '#7a5a3a', '#9c7a55'],
    recipe: ([[-0.42, 0.2], [0, 0.2], [0.42, 0.2], [-0.21, 0.56], [0.21, 0.56], [0, 0.92]] as const).map(
      ([x, y]): RecipePart => ({ shape: 'cylinder', radiusTop: 0.2, height: 1.7, segments: 8, rot: [H, 0, 0], pos: [x, y, 0] }),
    ),
    material: { roughness: 1 },
    rooms: { woods: 3, farmland: 0.3 },
  },
  {
    id: 'fishing_boat', name: 'Fishing Boat', size: 0.14, mass: 1.8, tiers: [10, 10], area: 'region',
    colors: ['#f4f1ea', '#d62828', '#1d4e89', '#2a9d8f'],
    recipe: [
      { shape: 'box', size: [0.55, 0.3, 1.5], pos: [0, 0.15, -0.1] },
      { shape: 'cone', radius: 0.39, height: 0.45, segments: 4, rot: [H, PI / 4, 0], scale: [1, 1, 0.75], pos: [0, 0.15, 0.85] },
      { shape: 'box', size: [0.4, 0.35, 0.45], pos: [0, 0.47, -0.35], color: '#f4f1ea' },
      { shape: 'box', size: [0.42, 0.1, 0.12], pos: [0, 0.55, -0.1], color: GLASS },
      { shape: 'cylinder', radiusTop: 0.025, height: 1.0, pos: [0, 0.8, 0.25], color: '#d9d9d9' },
    ],
    material: { roughness: 0.5 },
    rooms: { river: 3 },
  },
  {
    id: 'region_car', name: 'Car', size: 0.17, mass: 3.5, tiers: [10, 10], area: 'region',
    colors: ['#c1121f', '#1d4e89', '#f4f4f4', '#2b2d42', '#6c757d', '#e9c46a', '#2a9d8f'],
    recipe: [
      { shape: 'box', size: [0.82, 0.38, 1.95], pos: [0, 0.37, 0] },
      { shape: 'box', size: [0.74, 0.32, 1.0], pos: [0, 0.72, -0.12], color: GLASS },
      { shape: 'box', size: [0.7, 0.04, 0.85], pos: [0, 0.9, -0.12] },
      ...wheels(0.42, 0.62, 0.17),
    ],
    material: { roughness: 0.35, metalness: 0.35 },
    rooms: { highway: 4, town: 0.8 },
  },
  {
    id: 'log_cabin', name: 'Log Cabin', size: 0.2, mass: 2.0, tiers: [10, 10], area: 'region',
    colors: ['#8a5a3b', '#7a4e33', '#9c6644'],
    recipe: [
      { shape: 'box', size: [1.2, 0.6, 0.9], pos: [0, 0.3, 0] },
      ...gable(0, 0.6, 0, 1.2, 0.9, '#4a3a2e', true, 0.6),
      { shape: 'box', size: [0.16, 0.5, 0.16], pos: [0.4, 0.85, -0.15], color: '#7a7a7a' },
      { shape: 'box', size: [0.25, 0.42, 0.04], pos: [0, 0.21, 0.46], color: '#3a2a1e' },
      { shape: 'box', size: [1.4, 0.06, 0.4], pos: [0, 0.03, 0.62], color: '#6b4f3a' },
    ],
    material: { roughness: 0.95 },
    rooms: { woods: 2, farmland: 0.3 },
  },
  {
    id: 'tractor', name: 'Tractor', size: 0.24, mass: 3.5, tiers: [10, 10], area: 'region',
    colors: ['#2d6a4f', '#c1121f', '#1d4e89', '#f4a261'],
    recipe: [
      { shape: 'box', size: [0.5, 0.4, 1.1], pos: [0, 0.6, 0.25] },
      { shape: 'box', size: [0.62, 0.62, 0.6], pos: [0, 0.95, -0.35], color: GLASS },
      { shape: 'box', size: [0.66, 0.06, 0.66], pos: [0, 1.29, -0.35] },
      { shape: 'cylinder', radiusTop: 0.05, height: 0.4, pos: [0.15, 0.95, 0.55], color: '#333333' },
      wheel(0.42, 0.48, -0.4, 0.48, 0.26), wheel(-0.42, 0.48, -0.4, 0.48, 0.26),
      wheel(0.34, 0.27, 0.62, 0.27, 0.18), wheel(-0.34, 0.27, 0.62, 0.27, 0.18),
    ],
    material: { roughness: 0.45, metalness: 0.2 },
    rooms: { farmland: 2.5, highway: 0.2 },
  },
  {
    id: 'bulldozer', name: 'Bulldozer', size: 0.28, mass: 4.0, tiers: [10, 10], area: 'region',
    colors: ['#f2b705', '#e9a400'],
    recipe: [
      { shape: 'box', size: [0.28, 0.3, 1.3], pos: [0.38, 0.15, -0.1], color: '#2b2b2b' },
      { shape: 'box', size: [0.28, 0.3, 1.3], pos: [-0.38, 0.15, -0.1], color: '#2b2b2b' },
      { shape: 'box', size: [0.6, 0.35, 1.1], pos: [0, 0.48, -0.15] },
      { shape: 'box', size: [0.5, 0.42, 0.45], pos: [0, 0.86, -0.4], color: GLASS },
      { shape: 'box', size: [0.55, 0.05, 0.5], pos: [0, 1.09, -0.4] },
      { shape: 'box', size: [1.3, 0.42, 0.1], rot: [-0.25, 0, 0], pos: [0, 0.28, 0.72], color: '#6b6b6b' },
    ],
    material: { roughness: 0.5, metalness: 0.3 },
    rooms: { landfill: 3, highway: 0.1 },
  },
  {
    id: 'grain_silo', name: 'Grain Silo', size: 0.32, mass: 2.5, tiers: [10, 10], area: 'region',
    colors: ['#c9ccd1', '#b8bcc2', '#d9d4c8'],
    recipe: [
      { shape: 'cylinder', radiusTop: 0.62, height: 3.4, segments: 14, pos: [-0.25, 1.7, 0] },
      { shape: 'cone', radius: 0.66, height: 0.45, segments: 14, pos: [-0.25, 3.62, 0], color: '#9aa0a6' },
      { shape: 'cylinder', radiusTop: 0.36, height: 2.2, segments: 12, pos: [0.6, 1.1, 0.25] },
      { shape: 'cone', radius: 0.39, height: 0.3, segments: 12, pos: [0.6, 2.35, 0.25], color: '#9aa0a6' },
      { shape: 'box', size: [0.06, 3.4, 0.08], pos: [-0.25, 1.7, 0.63], color: '#6c757d' },
    ],
    material: { roughness: 0.45, metalness: 0.5 },
    rooms: { farmland: 2, town: 0.4 },
  },
  {
    id: 'electricity_pylon', name: 'Electricity Pylon', size: 0.36, mass: 2.2, tiers: [10, 10], area: 'region',
    colors: ['#9aa0a6', '#b0b5ba'],
    recipe: [
      { shape: 'cylinder', radiusTop: 0.07, radiusBottom: 0.42, height: 5.2, segments: 4, pos: [0, 2.6, 0] },
      { shape: 'box', size: [1.9, 0.07, 0.07], pos: [0, 4.1, 0] },
      { shape: 'box', size: [1.5, 0.07, 0.07], pos: [0, 4.7, 0] },
      { shape: 'box', size: [1.1, 0.07, 0.07], pos: [0, 5.2, 0] },
      ...([-0.9, 0.9, -0.7, 0.7] as const).map((x, i): RecipePart => ({ shape: 'cylinder', radiusTop: 0.03, height: 0.3, pos: [x, i < 2 ? 3.92 : 4.52, 0], color: '#5b5f66' })),
    ],
    material: { roughness: 0.5, metalness: 0.6 },
    rooms: { farmland: 1, woods: 0.5, highway: 0.2 },
  },
  {
    id: 'houseboats', name: 'Houseboats', size: 0.4, mass: 2.0, tiers: [10, 10], area: 'region',
    colors: ['#e9c46a', '#2a9d8f', '#f4a261', '#e5e5e5'],
    recipe: [
      { shape: 'box', size: [0.55, 0.16, 1.7], pos: [-0.35, 0.08, 0], color: '#3a3a3a' },
      { shape: 'box', size: [0.48, 0.38, 1.2], pos: [-0.35, 0.35, -0.1] },
      { shape: 'box', size: [0.55, 0.05, 1.3], pos: [-0.35, 0.56, -0.1], color: ROOF_GREY },
      { shape: 'box', size: [0.55, 0.16, 1.5], pos: [0.4, 0.08, 0.1], color: '#3a3a3a' },
      { shape: 'box', size: [0.48, 0.38, 1.0], pos: [0.4, 0.35, 0.05], color: '#f4f1ea' },
      { shape: 'box', size: [0.55, 0.05, 1.1], pos: [0.4, 0.56, 0.05], color: '#7a3b2e' },
    ],
    material: { roughness: 0.7 },
    rooms: { river: 2 },
  },
  {
    id: 'scrap_heap', name: 'Scrap Heap', size: 0.42, mass: 3.5, tiers: [10, 10], area: 'region',
    colors: ['#7d6b5d', '#8a7f68', '#6c757d'],
    recipe: [
      { shape: 'blob', radius: 0.85, noise: 0.35, detail: 1, scale: [1, 0.45, 0.9], pos: [0, 0.1, 0] },
      { shape: 'box', size: [0.5, 0.25, 0.9], rot: [0.3, 0.5, 0.2], pos: [0.2, 0.42, -0.1], color: '#a23b2e' },
      { shape: 'box', size: [0.4, 0.2, 0.7], rot: [-0.2, 1.2, 0.4], pos: [-0.35, 0.38, 0.2], color: '#3d5a80' },
      { shape: 'cylinder', radiusTop: 0.15, height: 0.6, rot: [0.9, 0, 0.4], pos: [0.4, 0.3, 0.45], color: '#b0b5ba' },
    ],
    material: { roughness: 0.75, metalness: 0.4 },
    rooms: { landfill: 2.2 },
  },
  {
    id: 'terraced_houses', name: 'Terraced Houses', size: 0.45, mass: 3.0, tiers: [10, 10], area: 'region',
    colors: ['#b5654a', '#a4483a', '#c9b48f', '#d8c4a8'],
    recipe: [
      { shape: 'box', size: [1.9, 0.5, 0.5], pos: [0, 0.25, -0.4] },
      ...gable(0, 0.5, -0.4, 1.9, 0.5, ROOF_GREY, true, 0.7),
      { shape: 'box', size: [1.9, 0.5, 0.5], pos: [0, 0.25, 0.45] },
      ...gable(0, 0.5, 0.45, 1.9, 0.5, ROOF_RED, true, 0.7),
      ...([-0.76, -0.38, 0, 0.38, 0.76] as const).map((x): RecipePart => ({ shape: 'box', size: [0.08, 0.3, 0.08], pos: [x, 0.78, -0.4], color: '#6b4f3a' })),
      { shape: 'box', size: [1.9, 0.02, 0.3], pos: [0, 0.01, 0.0], color: GRASS },
    ],
    material: { roughness: 0.9 },
    rooms: { town: 2.5, farmland: 0.2 },
  },
  {
    id: 'combine_harvester', name: 'Combine Harvester', size: 0.5, mass: 4.0, tiers: [10, 10], area: 'region',
    colors: ['#2d6a4f', '#c1121f', '#e9c46a'],
    recipe: [
      { shape: 'box', size: [0.75, 0.65, 1.2], pos: [0, 0.75, -0.2] },
      { shape: 'box', size: [0.5, 0.42, 0.4], pos: [0, 1.28, 0.25], color: GLASS },
      { shape: 'box', size: [0.55, 0.05, 0.45], pos: [0, 1.51, 0.25] },
      { shape: 'box', size: [1.9, 0.2, 0.35], pos: [0, 0.22, 0.85], color: '#e9c46a' },
      { shape: 'cylinder', radiusTop: 0.08, height: 1.8, rot: [0, 0, H], pos: [0, 0.3, 0.92], color: '#c9a64a' },
      { shape: 'cylinder', radiusTop: 0.06, height: 1.1, rot: [0, 0, 1.2], pos: [0.75, 1.3, -0.3], color: '#3a3a3a' },
      wheel(0.42, 0.42, 0.25, 0.42, 0.22), wheel(-0.42, 0.42, 0.25, 0.42, 0.22),
      wheel(0.38, 0.25, -0.7, 0.25, 0.16), wheel(-0.38, 0.25, -0.7, 0.25, 0.16),
    ],
    material: { roughness: 0.45, metalness: 0.2 },
    rooms: { farmland: 1.8 },
  },
  {
    id: 'town_water_tower', name: 'Water Tower', size: 0.55, mass: 2.5, tiers: [10, 11], area: 'region',
    colors: ['#e5e5e5', '#a8c5d6', '#9fb8a0'],
    recipe: [
      ...([[0.35, 0.35], [-0.35, 0.35], [0.35, -0.35], [-0.35, -0.35]] as const).map(
        ([x, z]): RecipePart => ({ shape: 'box', size: [0.06, 2.4, 0.06], rot: [-z * 0.12, 0, x * 0.12], pos: [x * 0.85, 1.2, z * 0.85], color: '#6c757d' }),
      ),
      { shape: 'cylinder', radiusTop: 0.08, height: 2.4, pos: [0, 1.2, 0], color: '#6c757d' },
      { shape: 'sphere', radius: 0.75, scale: [1, 0.8, 1], pos: [0, 2.85, 0] },
      { shape: 'cone', radius: 0.3, height: 0.25, pos: [0, 3.55, 0], color: '#6c757d' },
    ],
    material: { roughness: 0.5, metalness: 0.4 },
    rooms: { town: 1.5, farmland: 0.4 },
  },
  {
    id: 'coach', name: 'Coach', size: 0.6, mass: 3.8, tiers: [10, 11], area: 'region',
    colors: ['#f4f4f4', '#277da1', '#e63946', '#ffb703'],
    recipe: [
      { shape: 'box', size: [0.42, 0.5, 1.95], pos: [0, 0.33, 0] },
      { shape: 'box', size: [0.43, 0.15, 1.75], pos: [0, 0.45, -0.05], color: '#2b2d42' },
      { shape: 'box', size: [0.38, 0.22, 0.02], pos: [0, 0.42, 0.98], color: GLASS },
      { shape: 'box', size: [0.3, 0.04, 0.6], pos: [0, 0.6, -0.4], color: '#cfcfcf' },
      ...wheels(0.2, 0.65, 0.09, 0.06),
    ],
    material: { roughness: 0.35, metalness: 0.3 },
    rooms: { highway: 2, town: 0.6 },
  },
  {
    id: 'farmhouse', name: 'Farmhouse', size: 0.65, mass: 3.0, tiers: [10, 11], area: 'region',
    colors: ['#f4efe6', '#efe3c8', '#d9c2a5'],
    recipe: [
      pad(1, '#a3ad6c', [1, 1, 0.85]),
      { shape: 'box', size: [0.9, 0.5, 0.6], pos: [-0.1, 0.25, -0.1] },
      ...gable(-0.1, 0.5, -0.1, 0.9, 0.6, ROOF_RED, true, 0.65),
      { shape: 'box', size: [0.45, 0.35, 0.4], pos: [0.5, 0.17, 0.05] },
      ...gable(0.5, 0.35, 0.05, 0.45, 0.4, ROOF_RED, false, 0.6),
      { shape: 'box', size: [0.6, 0.04, 0.2], pos: [-0.1, 0.3, 0.3], color: '#7a5a3f' },
      { shape: 'blob', radius: 0.22, noise: 0.25, pos: [-0.7, 0.3, 0.45], color: '#3a7d44' },
      { shape: 'box', size: [0.12, 0.3, 0.12], pos: [-0.35, 0.78, -0.1], color: '#7a3b2e' },
    ],
    material: { roughness: 0.85 },
    rooms: { farmland: 2, town: 0.3 },
  },
  {
    id: 'tyre_mountain', name: 'Tyre Mountain', size: 0.72, mass: 3.0, tiers: [10, 11], area: 'region',
    colors: ['#2b2b2b', '#333333'],
    recipe: [
      { shape: 'blob', radius: 0.9, noise: 0.25, detail: 1, scale: [1, 0.55, 0.95], pos: [0, 0.05, 0] },
      ...([[0.5, 0.25, 0.4, 0.3], [-0.4, 0.3, 0.3, 1.1], [0.1, 0.5, -0.3, 0.6], [-0.2, 0.25, -0.65, 1.8], [0.65, 0.18, -0.35, 2.4]] as const).map(
        ([x, y, z, a]): RecipePart => ({ shape: 'torus', radius: 0.18, tube: 0.07, rot: [H + 0.3, a, 0], pos: [x, y, z], color: '#1f1f1f' }),
      ),
    ],
    material: { roughness: 0.95 },
    rooms: { landfill: 2.5 },
  },
  {
    id: 'lorry', name: 'Lorry', size: 0.8, mass: 4.0, tiers: [10, 11], area: 'region',
    colors: ['#f4f4f4', '#c1121f', '#1d4e89', '#2a9d8f', '#f77f00'],
    recipe: [
      { shape: 'box', size: [0.32, 0.36, 0.3], pos: [0, 0.3, 0.82], color: '#e5e5e5' },
      { shape: 'box', size: [0.28, 0.12, 0.02], pos: [0, 0.38, 0.98], color: GLASS },
      { shape: 'box', size: [0.34, 0.42, 1.45], pos: [0, 0.34, -0.2] },
      { shape: 'box', size: [0.3, 0.06, 1.85], pos: [0, 0.1, 0], color: '#3a3a3a' },
      ...wheels(0.15, 0.8, 0.07, 0.05),
      wheel(0.15, 0.07, -0.55, 0.07, 0.05), wheel(-0.15, 0.07, -0.55, 0.07, 0.05),
    ],
    material: { roughness: 0.45, metalness: 0.2 },
    rooms: { highway: 3, town: 0.2 },
  },
  {
    id: 'barn', name: 'Barn', size: 0.88, mass: 3.0, tiers: [10, 11], area: 'region',
    colors: ['#9b2226', '#ae2012', '#7f5539'],
    recipe: [
      { shape: 'box', size: [0.9, 0.6, 1.5], pos: [0, 0.3, 0] },
      // Gambrel roof: steep lower slabs, shallow upper slabs.
      { shape: 'box', size: [0.3, 0.04, 1.55], rot: [0, 0, 1.1], pos: [0.38, 0.72, 0], color: ROOF_GREY },
      { shape: 'box', size: [0.3, 0.04, 1.55], rot: [0, 0, -1.1], pos: [-0.38, 0.72, 0], color: ROOF_GREY },
      { shape: 'box', size: [0.36, 0.04, 1.55], rot: [0, 0, -0.38], pos: [0.16, 0.92, 0], color: ROOF_GREY },
      { shape: 'box', size: [0.36, 0.04, 1.55], rot: [0, 0, 0.38], pos: [-0.16, 0.92, 0], color: ROOF_GREY },
      { shape: 'box', size: [0.4, 0.42, 0.03], pos: [0, 0.21, 0.76], color: '#f4f1ea' },
      { shape: 'box', size: [0.32, 0.36, 0.035], pos: [0, 0.21, 0.765], color: '#6b2a20' },
      { shape: 'cylinder', radiusTop: 0.22, height: 1.2, segments: 12, pos: [0.75, 0.6, -0.5], color: '#c9ccd1' },
      { shape: 'sphere', radius: 0.22, pos: [0.75, 1.2, -0.5], color: '#c9ccd1' },
    ],
    material: { roughness: 0.85 },
    rooms: { farmland: 2 },
  },
  {
    id: 'petrol_station', name: 'Petrol Station', size: 0.95, mass: 3.2, tiers: [10, 11], area: 'region',
    colors: ['#2a9d8f', '#e63946', '#ffb703', '#1d4e89'],
    recipe: [
      { shape: 'box', size: [1.9, 0.02, 1.5], pos: [0, 0.01, 0], color: '#8d8f93' },
      { shape: 'box', size: [1.2, 0.08, 0.7], pos: [-0.25, 0.55, 0.3] },
      ...([[-0.7, 0.05], [0.2, 0.05], [-0.7, 0.55], [0.2, 0.55]] as const).map(([x, z]): RecipePart => ({ shape: 'box', size: [0.05, 0.55, 0.05], pos: [x, 0.27, z], color: '#e5e5e5' })),
      { shape: 'box', size: [0.08, 0.16, 0.06], pos: [-0.45, 0.08, 0.15], color: '#e5e5e5' },
      { shape: 'box', size: [0.08, 0.16, 0.06], pos: [-0.05, 0.08, 0.15], color: '#e5e5e5' },
      { shape: 'box', size: [0.08, 0.16, 0.06], pos: [-0.45, 0.08, 0.45], color: '#e5e5e5' },
      { shape: 'box', size: [0.08, 0.16, 0.06], pos: [-0.05, 0.08, 0.45], color: '#e5e5e5' },
      { shape: 'box', size: [0.7, 0.32, 0.45], pos: [0.45, 0.16, -0.45], color: '#efe8da' },
      { shape: 'box', size: [0.72, 0.05, 0.47], pos: [0.45, 0.34, -0.45] },
      { shape: 'cylinder', radiusTop: 0.025, height: 0.9, pos: [0.8, 0.45, 0.6], color: '#5b5f66' },
      { shape: 'box', size: [0.3, 0.22, 0.04], pos: [0.8, 1.0, 0.6] },
    ],
    material: { roughness: 0.5, metalness: 0.2 },
    rooms: { highway: 1.2, town: 1 },
  },
  {
    id: 'church', name: 'Church', size: 1.05, mass: 3.5, tiers: [10, 11], area: 'region',
    colors: ['#d9d4c8', '#c9c1b0', '#b8b2a7'],
    recipe: [
      pad(1, '#93a067', [0.8, 1, 1]),
      { shape: 'box', size: [0.55, 0.55, 1.2], pos: [0, 0.27, -0.15] },
      ...gable(0, 0.55, -0.15, 0.55, 1.2, ROOF_GREY, false, 0.75),
      { shape: 'box', size: [0.36, 1.1, 0.36], pos: [0, 0.55, 0.6] },
      { shape: 'cone', radius: 0.27, height: 0.9, segments: 4, rot: [0, PI / 4, 0], pos: [0, 1.55, 0.6], color: ROOF_GREY },
      { shape: 'box', size: [0.18, 0.18, 0.02], pos: [0, 0.85, 0.79], color: '#e9c46a' },
      ...([[-0.6, 0.2], [-0.55, -0.4], [0.58, -0.5], [0.6, 0.15]] as const).map(([x, z]): RecipePart => ({ shape: 'blob', radius: 0.16, noise: 0.2, pos: [x, 0.2, z], color: '#3a6b35' })),
    ],
    material: { roughness: 0.85 },
    rooms: { town: 2, farmland: 0.3 },
  },
  {
    id: 'river_ferry', name: 'River Ferry', size: 1.15, mass: 3.0, tiers: [10, 11], area: 'region',
    colors: ['#f4f4f4', '#ffd166', '#e63946'],
    recipe: [
      { shape: 'box', size: [0.7, 0.18, 1.9], pos: [0, 0.09, 0], color: '#2b2d42' },
      { shape: 'box', size: [0.66, 0.05, 1.8], pos: [0, 0.2, 0], color: '#6c757d' },
      { shape: 'box', size: [0.2, 0.35, 0.5], pos: [0.22, 0.4, 0] },
      { shape: 'box', size: [0.22, 0.06, 0.55], pos: [0.22, 0.6, 0], color: '#f4f4f4' },
      { shape: 'box', size: [0.12, 0.08, 0.25], pos: [-0.15, 0.26, 0.55], color: '#c1121f' },
      { shape: 'box', size: [0.12, 0.08, 0.25], pos: [-0.15, 0.26, 0.15], color: '#1d4e89' },
      { shape: 'box', size: [0.12, 0.08, 0.25], pos: [-0.15, 0.26, -0.3], color: '#f4f4f4' },
      { shape: 'box', size: [0.12, 0.08, 0.25], pos: [-0.15, 0.26, -0.7], color: '#2a9d8f' },
    ],
    material: { roughness: 0.5, metalness: 0.2 },
    rooms: { river: 1.5 },
  },
  {
    id: 'motel', name: 'Motel', size: 1.25, mass: 3.0, tiers: [10, 11], area: 'region',
    colors: ['#f4a261', '#e9c46a', '#90e0ef', '#e5e5e5'],
    recipe: [
      { shape: 'box', size: [1.9, 0.02, 1.6], pos: [0, 0.01, 0.1], color: '#55575b' },
      { shape: 'box', size: [1.6, 0.32, 0.4], pos: [-0.1, 0.16, -0.55] },
      { shape: 'box', size: [0.4, 0.32, 1.0], pos: [-0.7, 0.16, 0.15] },
      { shape: 'box', size: [1.65, 0.04, 0.48], pos: [-0.1, 0.34, -0.55], color: '#7a3b2e' },
      { shape: 'box', size: [0.48, 0.04, 1.05], pos: [-0.7, 0.34, 0.15], color: '#7a3b2e' },
      ...([-0.5, -0.1, 0.3, 0.7] as const).map((x): RecipePart => ({ shape: 'box', size: [0.06, 0.18, 0.02], pos: [x, 0.09, -0.34], color: '#3d5a73' })),
      { shape: 'cylinder', radiusTop: 0.03, height: 1.1, pos: [0.8, 0.55, 0.7], color: '#5b5f66' },
      { shape: 'box', size: [0.45, 0.25, 0.05], pos: [0.8, 1.15, 0.7], color: '#e63946' },
      { shape: 'box', size: [0.25, 0.08, 0.4], pos: [0.2, 0.06, 0.3], color: '#c1121f' },
      { shape: 'box', size: [0.25, 0.08, 0.4], pos: [0.55, 0.06, 0.2], color: '#1d4e89' },
    ],
    material: { roughness: 0.75 },
    rooms: { highway: 1, town: 1 },
  },
  {
    id: 'wind_turbine', name: 'Wind Turbine', size: 1.4, mass: 2.0, tiers: [10, 11], area: 'region',
    colors: ['#f4f4f4', '#e8ecef'],
    recipe: [
      { shape: 'cylinder', radiusTop: 0.15, height: 0.06, pos: [0, 0.03, 0], color: '#b8b2a7' },
      { shape: 'cylinder', radiusTop: 0.035, radiusBottom: 0.07, height: 3.4, segments: 10, pos: [0, 1.7, 0] },
      { shape: 'box', size: [0.12, 0.12, 0.32], pos: [0, 3.45, -0.05] },
      { shape: 'sphere', radius: 0.07, pos: [0, 3.45, 0.13] },
      ...[0, (2 * PI) / 3, (4 * PI) / 3].map((a): RecipePart => ({
        shape: 'box', size: [0.07, 1.0, 0.02], rot: [0, 0, a], pos: [-Math.sin(a) * 0.52, 3.45 + Math.cos(a) * 0.52, 0.15],
      })),
    ],
    material: { roughness: 0.4, metalness: 0.1 },
    rooms: { farmland: 1.5, woods: 0.2 },
  },
  {
    id: 'sawmill', name: 'Sawmill', size: 1.55, mass: 3.2, tiers: [10, 11], area: 'region',
    colors: ['#8a5a3b', '#6b4f3a'],
    recipe: [
      pad(1, '#8a7a5c', [1, 1, 0.8]),
      { shape: 'box', size: [0.9, 0.35, 0.5], pos: [-0.3, 0.17, -0.3] },
      ...gable(-0.3, 0.35, -0.3, 0.9, 0.5, ROOF_GREY, true, 0.5),
      { shape: 'box', size: [0.4, 0.25, 0.35], pos: [0.5, 0.12, -0.35], color: '#7a7a7a' },
      { shape: 'cylinder', radiusTop: 0.05, height: 0.5, pos: [0.55, 0.5, -0.35], color: '#5b5f66' },
      ...([[0.1, 0.35], [0.1, 0.5], [-0.5, 0.4], [0.6, 0.3]] as const).map(
        ([x, z]): RecipePart => ({ shape: 'cylinder', radiusTop: 0.06, height: 0.7, segments: 6, rot: [0, 0, H], pos: [x, 0.06, z], color: '#a47148' }),
      ),
      { shape: 'blob', radius: 0.2, noise: 0.2, scale: [1.4, 0.5, 1], pos: [-0.2, 0.02, 0.55], color: '#c9a66b' },
    ],
    material: { roughness: 0.9 },
    rooms: { woods: 2 },
  },
  // ── Tier 11: Dust Front (r 3+) and the biggest Tier 10 things ──
  {
    id: 'grain_elevator', name: 'Grain Elevator', size: 1.7, mass: 3.5, tiers: [11, 11], area: 'region',
    colors: ['#d9d4c8', '#c9ccd1'],
    recipe: [
      ...([-0.6, -0.2, 0.2, 0.6] as const).map((x): RecipePart => ({ shape: 'cylinder', radiusTop: 0.2, height: 1.5, segments: 12, pos: [x, 0.75, -0.1] })),
      ...([-0.4, 0, 0.4] as const).map((x): RecipePart => ({ shape: 'cylinder', radiusTop: 0.18, height: 1.5, segments: 12, pos: [x, 0.75, 0.25] })),
      { shape: 'box', size: [0.35, 0.55, 0.35], pos: [0.85, 1.55, 0], color: '#b8b2a7' },
      { shape: 'box', size: [0.35, 1.3, 0.35], pos: [0.85, 0.65, 0], color: '#b8b2a7' },
      { shape: 'box', size: [1.6, 0.12, 0.12], pos: [0, 1.56, 0.05], color: '#9aa0a6' },
      { shape: 'box', size: [1.9, 0.03, 0.18], pos: [0, 0.015, 0.75], color: '#5a4636' },
    ],
    material: { roughness: 0.6, metalness: 0.2 },
    rooms: { farmland: 1.2, town: 0.8 },
  },
  {
    id: 'strip_mall', name: 'Strip Mall', size: 1.85, mass: 3.0, tiers: [11, 11], area: 'region',
    colors: ['#e6d3b3', '#d8c4a8', '#c7d3d8'],
    recipe: [
      { shape: 'box', size: [1.95, 0.02, 1.2], pos: [0, 0.01, 0.25], color: '#4f5257' },
      ...([-0.6, -0.2, 0.2, 0.6] as const).flatMap((x): RecipePart[] => [
        { shape: 'box', size: [0.02, 0.005, 0.5], pos: [x, 0.025, 0.1], color: '#f4f1ea' },
        { shape: 'box', size: [0.02, 0.005, 0.5], pos: [x, 0.025, 0.6], color: '#f4f1ea' },
      ]),
      { shape: 'box', size: [1.9, 0.22, 0.42], pos: [0, 0.11, -0.6] },
      { shape: 'box', size: [1.92, 0.03, 0.44], pos: [0, 0.23, -0.6], color: '#9aa0a6' },
      ...([[-0.7, '#d1495b'], [-0.25, '#2a9d8f'], [0.2, '#e9c46a'], [0.65, '#3d405b']] as const).map(
        ([x, c]): RecipePart => ({ shape: 'box', size: [0.36, 0.06, 0.02], pos: [x, 0.17, -0.385], color: c }),
      ),
      ...([[-0.4, 0.1, '#c1121f'], [0.0, 0.6, '#f4f4f4'], [0.4, 0.1, '#1d4e89'], [0.8, 0.6, '#6c757d']] as const).map(
        ([x, z, c]): RecipePart => ({ shape: 'box', size: [0.1, 0.05, 0.2], pos: [x + 0.2, 0.035, z], color: c }),
      ),
      { shape: 'cylinder', radiusTop: 0.02, height: 0.7, pos: [-0.9, 0.35, 0.8], color: '#5b5f66' },
      { shape: 'box', size: [0.3, 0.3, 0.04], pos: [-0.9, 0.8, 0.8], color: '#e63946' },
    ],
    material: { roughness: 0.7 },
    rooms: { town: 1.5, highway: 0.6 },
  },
  {
    id: 'farmstead', name: 'Farmstead', size: 2.0, mass: 3.2, tiers: [11, 11], area: 'region',
    colors: ['#a3ad6c', '#9aa86a', '#8f9c5e'],
    recipe: [
      pad(1),
      ...([-0.7, -0.55, -0.4, -0.25] as const).map((x, i): RecipePart => ({ shape: 'box', size: [0.12, 0.012, 1.1], pos: [x, 0.025, 0.2], color: i % 2 ? '#c9a64a' : '#6b8f3a' })),
      ...cottage(0.15, -0.3, 0.35, 0.25, 0.18, '#f4efe6', ROOF_RED),
      { shape: 'box', size: [0.32, 0.25, 0.5], pos: [0.55, 0.12, 0.15], color: '#9b2226' },
      ...gable(0.55, 0.25, 0.15, 0.32, 0.5, ROOF_GREY, false, 0.7),
      { shape: 'cylinder', radiusTop: 0.08, height: 0.55, segments: 10, pos: [0.85, 0.27, -0.2], color: '#c9ccd1' },
      { shape: 'cylinder', radiusTop: 0.08, height: 0.45, segments: 10, pos: [0.85, 0.22, -0.4], color: '#c9ccd1' },
      { shape: 'blob', radius: 0.12, noise: 0.25, pos: [-0.1, 0.1, -0.6], color: '#3a6b35' },
      { shape: 'blob', radius: 0.1, noise: 0.25, pos: [0.4, 0.1, -0.7], color: '#3a6b35' },
    ],
    material: { roughness: 0.9 },
    rooms: { farmland: 1.5 },
  },
  {
    id: 'trash_mountain', name: 'Trash Mountain', size: 2.2, mass: 3.5, tiers: [10, 11], area: 'region',
    colors: ['#7d7462', '#6f6a5c', '#8a7f68'],
    recipe: [
      { shape: 'blob', radius: 1, noise: 0.18, detail: 2, scale: [1, 0.42, 0.9], pos: [0, -0.05, 0] },
      { shape: 'blob', radius: 0.5, noise: 0.3, detail: 1, scale: [1, 0.6, 1], pos: [0.2, 0.3, -0.1], color: '#8f8a7a' },
      ...([[0.3, 0.33, 0.2, '#c1121f'], [-0.3, 0.3, -0.2, '#1d4e89'], [0.0, 0.38, 0.4, '#e9c46a'], [-0.5, 0.2, 0.3, '#2a9d8f'], [0.55, 0.22, -0.3, '#f4f4f4']] as const).map(
        ([x, y, z, c]): RecipePart => ({ shape: 'box', size: [0.12, 0.06, 0.08], rot: [0.3, x * 3, 0.2], pos: [x, y, z], color: c }),
      ),
      { shape: 'box', size: [0.08, 0.06, 0.14], pos: [0.1, 0.46, -0.05], color: '#f2b705' },
    ],
    material: { roughness: 1 },
    rooms: { landfill: 2.5 },
  },
  {
    id: 'marina', name: 'Marina', size: 2.0, mass: 2.8, tiers: [11, 11], area: 'region',
    colors: ['#b8a58a', '#a8977c'],
    recipe: [
      { shape: 'box', size: [0.12, 0.04, 1.9], pos: [0, 0.03, 0] },
      ...([-0.6, -0.2, 0.2, 0.6] as const).flatMap((z): RecipePart[] => [
        { shape: 'box', size: [1.4, 0.04, 0.06], pos: [0, 0.03, z] },
        { shape: 'box', size: [0.12, 0.06, 0.3], pos: [0.35, 0.04, z + 0.12], color: '#f4f4f4' },
        { shape: 'box', size: [0.1, 0.06, 0.26], pos: [-0.45, 0.04, z - 0.12], color: '#f4f4f4' },
        { shape: 'cylinder', radiusTop: 0.008, height: 0.35, pos: [0.35, 0.2, z + 0.12], color: '#d9d9d9' },
      ]),
      { shape: 'box', size: [0.3, 0.12, 0.2], pos: [0, 0.07, -0.95], color: '#e9c46a' },
    ],
    material: { roughness: 0.7 },
    rooms: { river: 1.2 },
  },
  {
    id: 'village', name: 'Village', size: 2.4, mass: 3.5, tiers: [11, 11], area: 'region',
    colors: ['#9aa86a', '#a0a070', '#8f9c5e'],
    recipe: [
      pad(1),
      { shape: 'box', size: [1.9, 0.01, 0.08], pos: [0, 0.025, 0.05], color: '#8a8478' },
      { shape: 'box', size: [0.08, 0.01, 1.5], rot: [0, 0.4, 0], pos: [0.1, 0.025, 0], color: '#8a8478' },
      ...houseRing(7, 0.38, 1.1, 0.3),
      ...houseRing(9, 0.7, 1, 0),
      { shape: 'box', size: [0.12, 0.14, 0.22], pos: [0, 0.07, -0.05], color: '#d9d4c8' },
      { shape: 'box', size: [0.07, 0.24, 0.07], pos: [0, 0.12, 0.09], color: '#d9d4c8' },
      { shape: 'cone', radius: 0.055, height: 0.18, segments: 4, pos: [0, 0.33, 0.09], color: ROOF_GREY },
      ...([[-0.15, 0.25], [0.2, -0.25], [0.5, 0.35], [-0.55, -0.3]] as const).map(([x, z]): RecipePart => ({ shape: 'blob', radius: 0.08, noise: 0.25, pos: [x, 0.07, z], color: '#3a6b35' })),
    ],
    material: { roughness: 0.9 },
    rooms: { farmland: 1, woods: 0.4, town: 0.3 },
  },
  {
    id: 'stadium', name: 'Stadium', size: 2.6, mass: 3.5, tiers: [11, 11], area: 'region',
    colors: ['#d9d9d9', '#c9c1b0'],
    recipe: [
      { shape: 'box', size: [1.95, 0.015, 1.5], pos: [0, 0.008, 0], color: '#55575b' },
      { shape: 'torus', radius: 0.66, tube: 0.2, rot: [H, 0, 0], scale: [1.15, 0.85, 0.9], pos: [0, 0.1, 0] },
      { shape: 'cylinder', radiusTop: 0.6, height: 0.03, segments: 24, scale: [1.05, 1, 0.75], pos: [0, 0.02, 0], color: '#3f8f3a' },
      { shape: 'box', size: [0.5, 0.005, 0.3], pos: [0, 0.04, 0], color: '#4fa046' },
      { shape: 'box', size: [0.008, 0.006, 0.6], pos: [0, 0.045, 0], color: '#f4f4f4' },
      ...([[0.95, 0.65], [-0.95, 0.65], [0.95, -0.65], [-0.95, -0.65]] as const).map(
        ([x, z]): RecipePart => ({ shape: 'cylinder', radiusTop: 0.015, height: 0.55, pos: [x * 0.9, 0.27, z * 0.9], color: '#9aa0a6' }),
      ),
      { shape: 'torus', radius: 0.66, tube: 0.03, rot: [H, 0, 0], scale: [1.2, 0.9, 1], pos: [0, 0.24, 0], color: '#e63946' },
    ],
    material: { roughness: 0.6, metalness: 0.2 },
    rooms: { town: 1.2, farmland: 0.1 },
  },
  {
    id: 'highway_interchange', name: 'Highway Interchange', size: 2.85, mass: 4.0, tiers: [11, 11], area: 'region',
    colors: ['#56585c', '#5f6165'],
    recipe: [
      pad(1, '#7f9a5a'),
      { shape: 'box', size: [2.0, 0.02, 0.2], pos: [0, 0.03, 0] },
      { shape: 'box', size: [0.2, 0.03, 2.0], pos: [0, 0.1, 0] },
      { shape: 'box', size: [0.14, 0.08, 0.14], pos: [0, 0.04, 0], color: '#b8b2a7' },
      ...([[0.36, 0.36], [-0.36, 0.36], [0.36, -0.36], [-0.36, -0.36]] as const).map(
        ([x, z]): RecipePart => ({ shape: 'torus', radius: 0.25, tube: 0.04, rot: [H, 0, 0], scale: [1, 1, 0.3], pos: [x, 0.025, z] }),
      ),
      ...([[0.5, 0.12], [-0.5, -0.12], [0.12, -0.5], [-0.12, 0.5]] as const).map(
        ([x, z]): RecipePart => ({ shape: 'box', size: [Math.abs(x) > 0.2 ? 0.9 : 0.1, 0.015, Math.abs(z) > 0.2 ? 0.9 : 0.1], pos: [x, 0.025, z] }),
      ),
      { shape: 'box', size: [0.08, 0.04, 0.02], pos: [0.7, 0.05, 0.02], color: '#c1121f' },
      { shape: 'box', size: [0.08, 0.04, 0.02], pos: [-0.4, 0.05, -0.02], color: '#f4f4f4' },
      { shape: 'box', size: [0.02, 0.04, 0.08], pos: [0.03, 0.13, 0.6], color: '#1d4e89' },
    ],
    material: { roughness: 0.9 },
    rooms: { highway: 1.2, farmland: 0.2 },
  },
  {
    id: 'small_town', name: 'Small Town', size: 3.1, mass: 4.0, tiers: [11, 11], area: 'region',
    colors: ['#c9c1b0', '#b8b2a7'],
    recipe: [
      pad(1),
      { shape: 'box', size: [1.95, 0.01, 0.07], pos: [0, 0.025, 0], color: '#55575b' },
      { shape: 'box', size: [0.07, 0.01, 1.95], pos: [0, 0.025, 0], color: '#55575b' },
      ...([[0.2, 0.2, 0.22, 0.32], [-0.22, 0.18, 0.18, 0.14], [0.24, -0.22, 0.2, 0.2], [-0.2, -0.24, 0.22, 0.46], [0.48, 0.2, 0.14, 0.12], [-0.5, 0.15, 0.16, 0.1], [0.15, 0.52, 0.18, 0.12], [-0.12, -0.55, 0.2, 0.16]] as const).map(
        ([x, z, w, h], i): RecipePart => ({ shape: 'box', size: [w, h, w * 0.9], pos: [x, h / 2, z], color: TOWN_WALLS[i % TOWN_WALLS.length] }),
      ),
      ...houseRing(12, 0.78, 0.9, 0.2),
      { shape: 'sphere', radius: 0.07, pos: [0.55, 0.32, -0.45], color: '#a8c5d6' },
      { shape: 'cylinder', radiusTop: 0.012, height: 0.28, pos: [0.55, 0.14, -0.45], color: '#6c757d' },
      ...([[0.45, 0.5], [-0.42, 0.48], [0.38, -0.6], [-0.6, -0.4], [0.7, -0.1]] as const).map(([x, z]): RecipePart => ({ shape: 'blob', radius: 0.07, noise: 0.25, pos: [x, 0.06, z], color: '#3a6b35' })),
    ],
    material: { roughness: 0.85 },
    rooms: { town: 1, farmland: 0.6 },
  },
  {
    id: 'cooling_towers', name: 'Cooling Towers', size: 3.3, mass: 4.0, tiers: [11, 11], area: 'region',
    colors: ['#c9c6bf', '#bdb9b0'],
    recipe: [
      { shape: 'box', size: [1.9, 0.015, 1.6], pos: [0, 0.008, 0], color: '#8d8f93' },
      { shape: 'cylinder', radiusTop: 0.28, radiusBottom: 0.42, height: 0.7, segments: 18, pos: [-0.45, 0.35, -0.2] },
      { shape: 'cylinder', radiusTop: 0.32, radiusBottom: 0.28, height: 0.3, segments: 18, pos: [-0.45, 0.85, -0.2] },
      { shape: 'cylinder', radiusTop: 0.28, radiusBottom: 0.42, height: 0.7, segments: 18, pos: [0.45, 0.35, -0.3] },
      { shape: 'cylinder', radiusTop: 0.32, radiusBottom: 0.28, height: 0.3, segments: 18, pos: [0.45, 0.85, -0.3] },
      { shape: 'blob', radius: 0.3, noise: 0.25, scale: [1, 0.7, 1], pos: [-0.45, 1.15, -0.2], color: '#f4f4f4' },
      { shape: 'box', size: [0.6, 0.3, 0.35], pos: [0.1, 0.15, 0.5], color: '#9aa0a6' },
      { shape: 'cylinder', radiusTop: 0.04, height: 1.0, pos: [0.55, 0.5, 0.55], color: '#c1121f' },
    ],
    material: { roughness: 0.85 },
    rooms: { landfill: 0.8, farmland: 0.3 },
  },
];
