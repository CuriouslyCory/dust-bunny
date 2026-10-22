/**
 * Continent Debris (area 'continent'), Tiers 11–13. Same format as DEBRIS_TYPES in debris.ts, but
 * sizes are in Continent units (1 = 10 km, `AREAS.continent.unit`): the Bunny arrives at 0.85
 * units (the arrival leap) and absorbs the Ice Sheet at ≈3–4, so the ladder runs from forests,
 * farmland, hills and what is left of the suburbs (0.1–0.2) through lakes, mesas, icebergs and
 * ruined megacities (0.5–1) to mountain ranges, great lakes, sand seas, ice caps and a small
 * country (2–3). Room weights use the continent zone types (plains, mountains, lakes, rivers,
 * desert, tundra, ruins). The generator places some at fixed spots (the ruins, mesa country, sea
 * ice, forests along the rivers, volcanoes).
 *
 * Types whose id matches a loaded Continent model (`forest_patch`, `lake`, `city_ruins`, `mesa`,
 * `iceberg`, `mountain_range`; public/models/manifest.json) render the Blender mesh; their recipes
 * are the headless / no-model fallback.
 */
import type { DebrisType, RecipePart, V3 } from './debris';

const PI = Math.PI;
const H = PI / 2;

const WATER = '#3a6f96';
const DEEP = '#2b5878';
const SAND = '#c9b07a';
const ROCK = '#7a6e62';
const SNOW = '#f1f4f7';
const GRASS = '#6f8a48';
const FOREST = '#2f5233';
const RUIN = '#8a8580';
const ASH = '#5d5a56';

/** Flat ground disc a hair above the floor. */
const pad = (radius: number, color?: string, scale: V3 = [1, 1, 1], segments = 18, y = 0.01): RecipePart => ({
  shape: 'cylinder', radiusTop: radius, height: 0.02, segments, pos: [0, y, 0], scale, ...(color ? { color } : {}),
});

/** A water body: a shore ring and the water a hair above it. */
const pond = (x: number, z: number, r: number, scale: V3 = [1, 1, 1], shore = SAND, water = WATER): RecipePart[] => [
  { shape: 'cylinder', radiusTop: r * 1.12, height: 0.02, segments: 16, pos: [x, 0.012, z], scale, color: shore },
  { shape: 'cylinder', radiusTop: r, height: 0.025, segments: 16, pos: [x, 0.02, z], scale, color: water },
];

/** A snow-capped peak (cone of rock with a white cap) of base radius r and height h at (x, z). */
const peak = (x: number, z: number, r: number, h: number, rock = ROCK, snowAt = 0.62, squash = 0.7): RecipePart[] => [
  { shape: 'cone', radius: r, height: h, segments: 6, pos: [x, h / 2, z], scale: [1, 1, squash], color: rock },
  { shape: 'cone', radius: r * (1 - snowAt), height: h * (1 - snowAt), segments: 6, pos: [x, h * snowAt + (h * (1 - snowAt)) / 2 + 0.004, z], scale: [1.04, 1.02, squash * 1.04], color: SNOW },
];

/** Little broken towers on a pad: what is left of a city at `n` blocks around (0, 0). */
function rubble(n: number, spread: number, maxH: number, seed: number): RecipePart[] {
  const out: RecipePart[] = [];
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < n; i++) {
    const a = rnd() * PI * 2;
    const d = Math.sqrt(rnd()) * spread;
    const w = 0.05 + rnd() * 0.08;
    const h = 0.04 + rnd() * maxH * (1 - d / (spread * 1.3));
    out.push({ shape: 'box', size: [w, h, w * (0.7 + rnd() * 0.6)], rot: [rnd() * 0.25, rnd() * PI, rnd() * 0.25], pos: [Math.cos(a) * d, h / 2, Math.sin(a) * d], color: i % 4 === 0 ? '#4a4643' : i % 3 === 0 ? '#a29c94' : RUIN });
  }
  return out;
}

/** A patchwork of square fields in a grid of `n` × `n` over radius `r`. */
function fields(n: number, r: number, palette: readonly string[]): RecipePart[] {
  const out: RecipePart[] = [];
  const cell = (r * 2) / n;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const x = -r + cell * (i + 0.5);
      const z = -r + cell * (j + 0.5);
      if (Math.hypot(x, z) > r * 0.95) continue;
      out.push({ shape: 'box', size: [cell * 0.9, 0.02, cell * 0.9], pos: [x, 0.02, z], color: palette[(i * 3 + j * 5) % palette.length] });
    }
  }
  return out;
}

/** Instance tints for recipes whose parts carry their own colours (final colour = part × instance). */
const TINTS = ['#ffffff', '#f3f0e8', '#eaf0ee'];

const CROPS = ['#8a9a4a', '#b9a65a', '#6f8a3c', '#a68a52', '#c7b56a', '#7d9450'] as const;

export const CONTINENT_DEBRIS: DebrisType[] = [
  // ── Arrival (Bunny r = 0.85 units after the leap; Tier 12 starts at 1) ──────────────
  {
    id: 'forest_patch', name: 'Forest', size: 0.11, mass: 1.0, tiers: [11, 12], area: 'continent',
    colors: ['#2f5a33', '#3b6a3a', '#284d2c'],
    recipe: [
      pad(1, '#4d4630'),
      ...([[-0.35, -0.25, 0.36], [0.35, 0.1, 0.32], [-0.05, 0.45, 0.3], [0.1, -0.5, 0.26], [-0.55, 0.3, 0.24], [0.6, -0.35, 0.22]] as const).map(
        ([x, z, r]): RecipePart => ({ shape: 'cone', radius: r, height: r * 1.6, segments: 6, pos: [x, r * 0.8 + 0.02, z] }),
      ),
    ],
    material: { roughness: 1 },
    rooms: { plains: 1.4, mountains: 1, tundra: 0.8, lakes: 0.3 },
  },
  {
    id: 'farmland', name: 'Farmland', size: 0.12, mass: 1.1, tiers: [11, 12], area: 'continent',
    colors: TINTS,
    recipe: [pad(1, '#5f6a3c'), ...fields(4, 0.9, CROPS), { shape: 'box', size: [0.12, 0.08, 0.1], pos: [0.12, 0.06, 0.1], color: '#d9d4c8' }],
    material: { roughness: 1 },
    rooms: { plains: 1.8, ruins: 0.3, rivers: 0.2 },
  },
  {
    id: 'oasis', name: 'Oasis', size: 0.13, mass: 1.1, tiers: [11, 12], area: 'continent',
    colors: TINTS,
    recipe: [
      pad(1, '#d9c08a'),
      ...pond(0.1, 0.05, 0.42, [1, 1, 0.8], '#b9a46a', '#2f86a8'),
      ...([[-0.45, -0.35], [0.6, -0.3], [-0.35, 0.55], [0.55, 0.5], [-0.65, 0.15]] as const).map(
        ([x, z]): RecipePart => ({ shape: 'cone', radius: 0.17, height: 0.32, segments: 5, pos: [x, 0.17, z], color: '#3f7a3a' }),
      ),
    ],
    material: { roughness: 0.9 },
    rooms: { desert: 2.5, rivers: 0.3 },
  },
  {
    id: 'hill_country', name: 'Hills', size: 0.15, mass: 1.2, tiers: [11, 12], area: 'continent',
    colors: ['#7b8a4c', '#8a8a56', '#6f7d48'],
    recipe: [
      { shape: 'blob', radius: 0.55, noise: 0.2, detail: 1, pos: [-0.3, 0, -0.1], scale: [1, 0.45, 0.9] },
      { shape: 'blob', radius: 0.45, noise: 0.2, detail: 1, pos: [0.35, 0, 0.2], scale: [1, 0.5, 1] },
      { shape: 'blob', radius: 0.35, noise: 0.2, detail: 1, pos: [0.05, 0, 0.6], scale: [1, 0.4, 1] },
    ],
    material: { roughness: 1 },
    rooms: { plains: 0.8, mountains: 1.5, desert: 0.4, tundra: 0.4 },
  },
  {
    id: 'oxbow_lake', name: 'Oxbow Lake', size: 0.16, mass: 1.1, tiers: [11, 12], area: 'continent',
    colors: TINTS,
    recipe: [
      pad(1, '#6f8a48', [1, 1, 0.8]),
      { shape: 'torus', radius: 0.55, tube: 0.13, arc: PI * 1.4, rot: [H, 0, 0.6], scale: [1, 0.8, 0.2], pos: [0, 0.03, 0], color: WATER },
    ],
    material: { roughness: 0.35 },
    rooms: { rivers: 2.5, plains: 0.5, lakes: 0.4 },
  },
  {
    id: 'ruined_suburbs', name: 'Ruined Suburbs', size: 0.18, mass: 1.3, tiers: [11, 12], area: 'continent',
    colors: TINTS,
    recipe: [
      pad(1, ASH),
      { shape: 'box', size: [1.8, 0.01, 0.06], pos: [0, 0.025, 0], color: '#3f3d3a' },
      { shape: 'box', size: [0.06, 0.01, 1.8], pos: [0.1, 0.025, 0], color: '#3f3d3a' },
      ...rubble(18, 0.85, 0.12, 7),
    ],
    material: { roughness: 0.95 },
    rooms: { ruins: 3, plains: 0.25 },
  },
  {
    id: 'lake', name: 'Lake', size: 0.2, mass: 1.2, tiers: [11, 12], area: 'continent',
    colors: TINTS,
    recipe: [...pond(0, 0, 0.85, [1, 1, 0.8], '#9fae74'), { shape: 'blob', radius: 0.15, noise: 0.2, pos: [0.25, 0.02, 0.1], scale: [1, 0.3, 1], color: FOREST }],
    material: { roughness: 0.3 },
    rooms: { lakes: 3, plains: 1, tundra: 0.8, mountains: 0.3 },
  },
  {
    id: 'pack_ice', name: 'Pack Ice', size: 0.24, mass: 1.2, tiers: [11, 12], area: 'continent',
    colors: ['#e8f2f7', '#d5e7f0'],
    recipe: [
      { shape: 'box', size: [1.1, 0.08, 0.9], pos: [-0.3, 0.04, -0.1], rot: [0, 0.3, 0] },
      { shape: 'box', size: [0.8, 0.1, 0.7], pos: [0.45, 0.05, 0.4], rot: [0, -0.4, 0] },
      { shape: 'box', size: [0.5, 0.07, 0.5], pos: [0.4, 0.035, -0.55], rot: [0, 0.9, 0] },
      { shape: 'box', size: [0.4, 0.06, 0.35], pos: [-0.55, 0.03, 0.6], rot: [0, 0.2, 0] },
    ],
    material: { roughness: 0.4 },
    rooms: { tundra: 3, lakes: 0.5 },
  },
  {
    id: 'dune_field', name: 'Dune Field', size: 0.26, mass: 1.2, tiers: [11, 12], area: 'continent',
    colors: ['#d8a868', '#e0b679', '#c99a5a'],
    recipe: [
      pad(1, undefined, [1, 1, 0.85]),
      ...([-0.55, -0.2, 0.15, 0.5] as const).map((z, i): RecipePart => ({ shape: 'capsule', radius: 0.09, length: 1.2 - Math.abs(z) * 0.8, rot: [0, 0, H], scale: [1, 0.55, 1], pos: [i % 2 ? 0.08 : -0.08, 0.03, z], color: '#f0dcc0' })),
    ],
    material: { roughness: 1 },
    rooms: { desert: 3 },
  },
  {
    id: 'hydro_dam', name: 'Dam and Reservoir', size: 0.28, mass: 1.6, tiers: [12, 12], area: 'continent',
    colors: TINTS,
    recipe: [
      ...pond(0, -0.25, 0.7, [1, 1, 0.75], '#7d8a50', DEEP),
      { shape: 'box', size: [1.1, 0.12, 0.08], pos: [0, 0.06, 0.32], color: '#d6d2c8' },
      { shape: 'box', size: [0.1, 0.03, 0.7], pos: [0, 0.015, 0.7], color: WATER },
    ],
    material: { roughness: 0.6 },
    rooms: { rivers: 2, mountains: 0.5 },
  },
  {
    id: 'city_ruins', name: 'City Ruins', size: 0.32, mass: 1.6, tiers: [11, 12], area: 'continent',
    colors: TINTS,
    recipe: [pad(1, '#6b6966'), ...rubble(30, 0.8, 0.45, 3)],
    material: { roughness: 0.95 },
    rooms: { ruins: 4, plains: 0.7, desert: 0.3 },
  },
  // ── Tier 12 (Dustmass, r 1–3 units) ──────────────
  {
    id: 'farm_belt', name: 'Farm Belt', size: 0.3, mass: 1.5, tiers: [12, 12], area: 'continent',
    colors: TINTS,
    recipe: [pad(1, '#5f6a3c', [1, 1, 0.7]), ...fields(6, 0.92, CROPS).map((p) => ({ ...p, scale: [1, 1, 0.7] as V3, pos: [p.pos![0], p.pos![1], p.pos![2] * 0.7] as V3 })), { shape: 'box', size: [1.8, 0.012, 0.03], pos: [0, 0.04, 0.05], rot: [0, 0.15, 0], color: '#8a8478' }],
    material: { roughness: 1 },
    rooms: { plains: 2, rivers: 0.2 },
  },
  {
    id: 'old_growth_forest', name: 'Old-Growth Forest', size: 0.44, mass: 1.6, tiers: [12, 13], area: 'continent',
    colors: TINTS,
    recipe: [
      { shape: 'blob', radius: 1, noise: 0.22, detail: 1, pos: [0, 0, 0], scale: [1, 0.12, 0.8], color: '#2c4a2c' },
      ...Array.from({ length: 14 }, (_, i): RecipePart => {
        const a = i * 2.39;
        const d = 0.15 + (i / 14) * 0.7;
        return { shape: 'blob', radius: 0.16, noise: 0.25, pos: [Math.cos(a) * d, 0.1, Math.sin(a) * d * 0.8], scale: [1, 0.6, 1], color: i % 3 ? '#2f5531' : '#3d6436' };
      }),
    ],
    material: { roughness: 1 },
    rooms: { plains: 1.4, mountains: 0.5, tundra: 0.3, rivers: 0.2 },
  },
  {
    id: 'taiga', name: 'Taiga', size: 0.36, mass: 1.5, tiers: [12, 12], area: 'continent',
    colors: TINTS,
    recipe: [
      pad(1, '#dfe7eb', [1, 1, 0.85]),
      ...Array.from({ length: 16 }, (_, i): RecipePart => {
        const a = i * 2.4;
        const d = 0.18 + (i / 16) * 0.65;
        return { shape: 'cone', radius: 0.13, height: 0.3, segments: 5, pos: [Math.cos(a) * d, 0.16, Math.sin(a) * d * 0.85], color: i % 3 ? '#24402a' : '#2f5236' };
      }),
    ],
    material: { roughness: 1 },
    rooms: { tundra: 2.5, mountains: 0.4 },
  },
  {
    id: 'salt_flat', name: 'Salt Flat', size: 0.38, mass: 1.3, tiers: [12, 12], area: 'continent',
    colors: ['#ece6da', '#e2dccd'],
    recipe: [
      pad(1, '#c9a46a', [1, 1, 0.75], 11),
      pad(0.86, undefined, [1, 1, 0.68], 11, 0.022),
      ...([[-0.3, -0.1, 0.6], [0.25, 0.2, -0.4], [0.05, -0.3, 1.2]] as const).map(([x, z, a]): RecipePart => ({ shape: 'box', size: [0.7, 0.004, 0.012], pos: [x, 0.034, z], rot: [0, a, 0], color: '#cfc6b2' })),
    ],
    material: { roughness: 0.6 },
    rooms: { desert: 2, plains: 0.3 },
  },
  {
    id: 'river_delta', name: 'River Delta', size: 0.42, mass: 1.5, tiers: [12, 13], area: 'continent',
    colors: TINTS,
    recipe: [
      { shape: 'cylinder', radiusTop: 1, height: 0.02, segments: 3, pos: [0, 0.01, 0.1], rot: [0, PI, 0], color: '#6b8f4c' },
      { shape: 'box', size: [0.12, 0.03, 0.9], pos: [0, 0.025, -0.5], color: WATER },
      ...([-0.55, -0.2, 0.2, 0.55] as const).map((x): RecipePart => ({ shape: 'box', size: [0.05, 0.03, 0.75], pos: [x * 0.6, 0.026, 0.2], rot: [0, x, 0], color: WATER })),
    ],
    material: { roughness: 0.6 },
    rooms: { rivers: 2, lakes: 1.5, plains: 0.15 },
  },
  {
    id: 'impact_crater', name: 'Impact Crater', size: 0.48, mass: 1.8, tiers: [12, 13], area: 'continent',
    colors: ['#9c8564', '#8d7a5e', '#a89276'],
    recipe: [
      { shape: 'torus', radius: 0.75, tube: 0.2, rot: [H, 0, 0], scale: [1, 1, 0.45], pos: [0, 0.02, 0] },
      pad(0.68, '#94846a', [1, 1, 1], 16, 0.004),
      { shape: 'cone', radius: 0.14, height: 0.1, segments: 7, pos: [0, 0.05, 0], color: '#a8977a' },
    ],
    material: { roughness: 1 },
    rooms: { desert: 1.2, plains: 0.45, tundra: 0.5 },
  },
  {
    id: 'mesa', name: 'Mesa', size: 0.55, mass: 2.0, tiers: [12, 13], area: 'continent',
    colors: ['#b5603a', '#a85634', '#c26d42'],
    recipe: [
      { shape: 'cylinder', radiusTop: 1, radiusBottom: 1.05, height: 0.04, segments: 9, pos: [0, 0.02, 0], color: '#d1a26f' },
      { shape: 'cylinder', radiusTop: 0.62, radiusBottom: 0.82, height: 0.38, segments: 9, pos: [-0.1, 0.19, 0] },
      { shape: 'cylinder', radiusTop: 0.64, height: 0.03, segments: 9, pos: [-0.1, 0.39, 0], color: '#9a7a4a' },
      { shape: 'cylinder', radiusTop: 0.16, radiusBottom: 0.24, height: 0.26, segments: 7, pos: [0.75, 0.13, 0.45] },
    ],
    material: { roughness: 0.95 },
    rooms: { desert: 4, mountains: 0.3 },
  },
  {
    id: 'fjord', name: 'Fjord', size: 0.62, mass: 1.9, tiers: [12, 13], area: 'continent',
    colors: TINTS,
    recipe: [
      { shape: 'blob', radius: 1, noise: 0.18, detail: 1, pos: [0, 0, 0], scale: [1, 0.14, 0.8], color: '#6b7466' },
      // A long sea inlet winding in between snowy cliffs.
      ...([[-0.62, 0.1, 0.3], [-0.22, -0.02, -0.25], [0.18, 0.06, 0.35], [0.55, -0.04, -0.1]] as const).map(
        ([x, z, a]): RecipePart => ({ shape: 'box', size: [0.48, 0.02, 0.12], pos: [x, 0.13, z], rot: [0, a, 0], color: DEEP }),
      ),
      ...([[-0.4, -0.35, 0.3], [0.3, -0.35, 0.26], [-0.3, 0.4, 0.24], [0.45, 0.38, 0.2]] as const).map(
        ([x, z, r]): RecipePart => ({ shape: 'blob', radius: r, noise: 0.25, pos: [x, 0.08, z], scale: [1, 0.35, 1], color: SNOW }),
      ),
    ],
    material: { roughness: 0.8 },
    rooms: { tundra: 1.5, mountains: 1 },
  },
  {
    id: 'lake_islands', name: 'Lake Islands', size: 0.66, mass: 1.9, tiers: [12, 13], area: 'continent',
    colors: TINTS,
    recipe: [
      ...pond(0, 0, 0.95, [1, 1, 0.85], '#8a9a62'),
      ...([[-0.35, -0.2, 0.28], [0.3, 0.25, 0.22], [0.4, -0.35, 0.14], [-0.2, 0.45, 0.12]] as const).flatMap(([x, z, r]): RecipePart[] => [
        { shape: 'cylinder', radiusTop: r, height: 0.04, segments: 10, pos: [x, 0.03, z], color: '#c9b07a' },
        ...fields(2, r * 0.75, CROPS).map((p) => ({ ...p, pos: [p.pos![0] + x, 0.05, p.pos![2] + z] as V3 })),
      ]),
    ],
    material: { roughness: 0.5 },
    rooms: { lakes: 2.5 },
  },
  {
    id: 'iceberg', name: 'Iceberg', size: 0.7, mass: 2.0, tiers: [12, 13], area: 'continent',
    colors: ['#d8eef7', '#c4e3f0'],
    recipe: [
      { shape: 'blob', radius: 0.8, noise: 0.3, detail: 0, pos: [0, 0.3, 0], scale: [1, 0.55, 0.85] },
      { shape: 'blob', radius: 0.35, noise: 0.3, detail: 0, pos: [0.75, 0.15, 0.3], scale: [1, 0.6, 1] },
    ],
    material: { roughness: 0.35 },
    rooms: { tundra: 2.5, lakes: 1 },
  },
  {
    id: 'ruined_megacity', name: 'Ruined Megacity', size: 0.8, mass: 2.2, tiers: [12, 13], area: 'continent',
    colors: TINTS,
    recipe: [
      pad(1, '#57534f'),
      { shape: 'torus', radius: 0.62, tube: 0.015, rot: [H, 0, 0], scale: [1, 1, 0.2], pos: [0, 0.025, 0], color: '#3c3a37' },
      { shape: 'box', size: [1.9, 0.01, 0.04], pos: [0, 0.027, 0.05], color: '#3c3a37' },
      { shape: 'box', size: [0.04, 0.01, 1.9], pos: [-0.05, 0.027, 0], color: '#3c3a37' },
      ...rubble(42, 0.85, 0.3, 11),
    ],
    material: { roughness: 0.95 },
    rooms: { ruins: 3, plains: 0.1 },
  },
  {
    id: 'canyon', name: 'Canyon', size: 0.85, mass: 2.3, tiers: [12, 13], area: 'continent',
    colors: TINTS,
    recipe: [
      pad(1, '#c07a48', [1, 1, 0.55], 12),
      // A gorge zig-zagging across a red plateau, a thread of river at the bottom.
      ...([[-0.62, 0.05, 0.5], [-0.2, -0.08, -0.35], [0.22, 0.04, 0.45], [0.62, -0.06, -0.3]] as const).flatMap(([x, z, a]): RecipePart[] => [
        { shape: 'box', size: [0.5, 0.012, 0.13], pos: [x, 0.026, z], rot: [0, a, 0], color: '#5c3424' },
        { shape: 'box', size: [0.48, 0.01, 0.03], pos: [x, 0.03, z], rot: [0, a, 0], color: WATER },
      ]),
      ...([[-0.5, -0.3], [0.1, 0.3], [0.55, 0.25]] as const).map(([x, z]): RecipePart => ({ shape: 'cylinder', radiusTop: 0.09, radiusBottom: 0.12, height: 0.1, segments: 6, pos: [x, 0.06, z], color: '#a85f38' })),
    ],
    material: { roughness: 1 },
    rooms: { desert: 0.8, mountains: 0.4 },
  },
  {
    id: 'volcanic_field', name: 'Volcanic Field', size: 0.95, mass: 2.4, tiers: [12, 13], area: 'continent',
    colors: TINTS,
    recipe: [
      pad(1, '#57493f', [1, 1, 1], 10),
      ...([[-0.3, -0.2, 0.3], [0.4, 0.3, 0.22], [0.35, -0.45, 0.16], [-0.5, 0.45, 0.14]] as const).flatMap(([x, z, r]): RecipePart[] => [
        { shape: 'cone', radius: r, height: r, segments: 8, pos: [x, r / 2, z], color: '#3a3330' },
        { shape: 'cylinder', radiusTop: r * 0.28, height: 0.01, segments: 8, pos: [x, r * 0.74, z], color: '#e0582a' },
      ]),
    ],
    material: { roughness: 0.85, emissive: '#2a0a00', emissiveIntensity: 0.6 },
    rooms: { mountains: 2, desert: 0.6 },
  },
  {
    id: 'wetlands', name: 'Wetlands', size: 1.0, mass: 2.4, tiers: [12, 13], area: 'continent',
    colors: TINTS,
    recipe: [
      pad(1, '#557a4a', [1, 1, 1], 12),
      ...([[-0.35, 0.2, 0.3], [0.4, -0.25, 0.22], [0.2, 0.45, 0.16], [-0.45, -0.4, 0.14], [0.55, 0.3, 0.1]] as const).map(
        ([x, z, r]): RecipePart => ({ shape: 'cylinder', radiusTop: r, height: 0.03, segments: 10, pos: [x, 0.02, z], color: WATER }),
      ),
    ],
    material: { roughness: 0.6 },
    rooms: { lakes: 1.5, plains: 0.7, rivers: 1.5 },
  },
  {
    id: 'mountain_range', name: 'Mountain Range', size: 1.15, mass: 3.0, tiers: [12, 13], area: 'continent',
    colors: TINTS,
    recipe: [
      { shape: 'blob', radius: 1, noise: 0.15, detail: 1, pos: [0, 0, 0], scale: [1, 0.12, 0.42], color: '#6f7d48' },
      ...peak(-0.6, 0.02, 0.36, 0.42),
      ...peak(-0.15, -0.05, 0.42, 0.55),
      ...peak(0.3, 0.04, 0.38, 0.48),
      ...peak(0.7, -0.03, 0.28, 0.34),
    ],
    material: { roughness: 0.95 },
    rooms: { mountains: 4, tundra: 0.5, plains: 0.3 },
  },
  {
    id: 'ice_field', name: 'Ice Field', size: 1.25, mass: 2.6, tiers: [12, 13], area: 'continent',
    colors: ['#eaf3f8', '#dcebf3'],
    recipe: [
      { shape: 'blob', radius: 1, noise: 0.12, detail: 1, pos: [0, 0, 0], scale: [1, 0.08, 0.8] },
      ...([[-0.4, 0.1, 0.8], [0.2, -0.25, -0.5], [0.35, 0.35, 1.4]] as const).map(([x, z, a]): RecipePart => ({ shape: 'box', size: [0.6, 0.012, 0.02], pos: [x, 0.08, z], rot: [0, a, 0], color: '#8fb4c8' })),
    ],
    material: { roughness: 0.45 },
    rooms: { tundra: 2.5, mountains: 0.3 },
  },
  // ── Tier 13 (Dust Pangaea, r ≥ 3 units; the Ice Sheet arrives). The spawner brings these in during Tier 12 once absorbable ──
  {
    id: 'shield_volcano', name: 'Shield Volcano', size: 1.4, mass: 3.0, tiers: [13, 13], area: 'continent',
    colors: TINTS,
    recipe: [
      { shape: 'cylinder', radiusTop: 0.25, radiusBottom: 1, height: 0.3, segments: 12, pos: [0, 0.15, 0], color: '#574a46' },
      { shape: 'cylinder', radiusTop: 0.2, height: 0.02, segments: 10, pos: [0, 0.305, 0], color: '#e0582a' },
      ...([0.4, 2.1, 4.0] as const).map((a): RecipePart => ({ shape: 'box', size: [0.05, 0.02, 0.55], pos: [Math.sin(a) * 0.5, 0.17, Math.cos(a) * 0.5], rot: [-0.3, a, 0], color: '#c24a22' })),
    ],
    material: { roughness: 0.8, emissive: '#3a0e00', emissiveIntensity: 0.6 },
    rooms: { mountains: 2, desert: 0.5, tundra: 0.4 },
  },
  {
    id: 'metropolis_ruins', name: 'Metropolis Ruins', size: 1.6, mass: 3.0, tiers: [13, 13], area: 'continent',
    colors: TINTS,
    recipe: [
      pad(1, '#4f4c48'),
      ...pond(0.55, -0.5, 0.18, [1, 1, 0.7], '#4f4c48', DEEP),
      ...([-0.6, -0.2, 0.2, 0.6] as const).flatMap((t): RecipePart[] => [
        { shape: 'box', size: [1.9, 0.008, 0.025], pos: [0, 0.025, t], color: '#34322f' },
        { shape: 'box', size: [0.025, 0.008, 1.9], pos: [t, 0.025, 0], color: '#34322f' },
      ]),
      ...rubble(60, 0.9, 0.22, 19),
    ],
    material: { roughness: 0.95 },
    rooms: { ruins: 3, plains: 0.2 },
  },
  {
    id: 'river_basin', name: 'River Basin', size: 1.7, mass: 3.0, tiers: [13, 13], area: 'continent',
    colors: TINTS,
    recipe: [
      pad(1, '#6a8a4a', [1, 1, 1], 14),
      { shape: 'box', size: [0.1, 0.02, 1.8], pos: [0, 0.025, 0], color: WATER },
      ...([[-0.4, -0.3, 0.9], [0.35, 0.1, -0.8], [-0.3, 0.45, 0.7], [0.45, -0.55, -0.6]] as const).map(([x, z, a]): RecipePart => ({ shape: 'box', size: [0.05, 0.02, 0.7], pos: [x, 0.024, z], rot: [0, a, 0], color: WATER })),
      ...fields(6, 0.8, CROPS).filter((_, i) => i % 3 === 0),
    ],
    material: { roughness: 0.8 },
    rooms: { rivers: 2, plains: 0.6, lakes: 0.4 },
  },
  {
    id: 'great_lake', name: 'Great Lake', size: 2.0, mass: 3.2, tiers: [13, 13], area: 'continent',
    colors: TINTS,
    recipe: [...pond(0, 0, 0.88, [1, 1, 0.66], '#9fae74', DEEP), { shape: 'blob', radius: 0.12, noise: 0.3, pos: [-0.3, 0.02, 0.1], scale: [1.4, 0.3, 1], color: FOREST }],
    material: { roughness: 0.3 },
    rooms: { lakes: 3, plains: 0.5, tundra: 0.4 },
  },
  {
    id: 'sand_sea', name: 'Sand Sea', size: 2.2, mass: 3.3, tiers: [13, 13], area: 'continent',
    colors: ['#d9a663', '#e2b475'],
    recipe: [
      pad(1, undefined, [1, 1, 0.8], 14),
      ...Array.from({ length: 7 }, (_, i): RecipePart => {
        const z = -0.6 + i * 0.2;
        return { shape: 'capsule', radius: 0.05, length: 1.5 - Math.abs(z) * 1.1, rot: [0, 0.15, H], scale: [1, 0.5, 1], pos: [i % 2 ? 0.05 : -0.05, 0.03, z], color: '#c58f50' };
      }),
    ],
    material: { roughness: 1 },
    rooms: { desert: 3 },
  },
  {
    id: 'breadbasket', name: 'Breadbasket', size: 2.3, mass: 3.4, tiers: [13, 13], area: 'continent',
    colors: TINTS,
    recipe: [pad(1, '#5f6a3c'), ...fields(8, 0.95, CROPS), { shape: 'box', size: [0.05, 0.01, 1.9], pos: [0.12, 0.035, 0], rot: [0, 0.2, 0], color: WATER }],
    material: { roughness: 1 },
    rooms: { plains: 2.5 },
  },
  {
    id: 'plateau', name: 'Plateau', size: 2.5, mass: 3.5, tiers: [13, 13], area: 'continent',
    colors: TINTS,
    recipe: [
      { shape: 'cylinder', radiusTop: 0.85, radiusBottom: 1, height: 0.16, segments: 11, pos: [0, 0.08, 0], rot: [0, PI / 7, 0], color: '#b47a4c' },
      { shape: 'cylinder', radiusTop: 0.84, height: 0.012, segments: 11, pos: [0, 0.166, 0], rot: [0, PI / 7, 0], color: '#c9a271' },
      { shape: 'cylinder', radiusTop: 0.3, height: 0.012, segments: 9, pos: [0.25, 0.172, -0.2], color: '#8f8a5a' },
    ],
    rooms: { desert: 1.5, mountains: 1.5 },
  },
  {
    id: 'small_country', name: 'A Small Country', size: 2.7, mass: 3.6, tiers: [13, 13], area: 'continent',
    colors: TINTS,
    recipe: [
      pad(1, GRASS),
      ...fields(6, 0.7, CROPS).filter((_, i) => i % 2 === 0),
      { shape: 'blob', radius: 0.3, noise: 0.2, pos: [-0.55, 0, -0.3], scale: [1, 0.2, 1.2], color: FOREST },
      ...peak(0.55, -0.45, 0.2, 0.22),
      ...peak(0.7, -0.2, 0.16, 0.18),
      ...pond(-0.3, 0.55, 0.14, [1.4, 1, 1]),
      { shape: 'box', size: [0.18, 0.04, 0.16], pos: [0.1, 0.03, 0.1], color: RUIN },
      { shape: 'torus', radius: 0.95, tube: 0.012, rot: [H, 0, 0], pos: [0, 0.03, 0], color: '#d9d4c8' },
    ],
    material: { roughness: 0.95 },
    rooms: { plains: 1.2, ruins: 0.8 },
  },
  {
    id: 'ice_cap', name: 'Ice Cap', size: 2.9, mass: 3.8, tiers: [13, 13], area: 'continent',
    colors: ['#eef6fa', '#e2eef4'],
    recipe: [
      { shape: 'blob', radius: 1, noise: 0.15, detail: 1, pos: [0, 0, 0], scale: [1, 0.16, 0.85] },
      { shape: 'blob', radius: 0.5, noise: 0.15, detail: 1, pos: [0.15, 0.05, -0.05], scale: [1, 0.2, 0.8], color: '#f8fbfd' },
    ],
    material: { roughness: 0.4 },
    rooms: { tundra: 3 },
  },
  {
    id: 'mountain_chain', name: 'Mountain Chain', size: 3.1, mass: 4.0, tiers: [13, 13], area: 'continent',
    colors: TINTS,
    recipe: [
      { shape: 'blob', radius: 1, noise: 0.15, detail: 1, pos: [0, 0, 0], scale: [1, 0.08, 0.35], color: '#6f7d48' },
      ...peak(-0.72, 0.02, 0.24, 0.3),
      ...peak(-0.38, -0.04, 0.3, 0.4),
      ...peak(-0.02, 0.05, 0.32, 0.46),
      ...peak(0.34, -0.03, 0.28, 0.38),
      ...peak(0.68, 0.03, 0.24, 0.3),
    ],
    material: { roughness: 0.95 },
    rooms: { mountains: 3, tundra: 0.4 },
  },
];
