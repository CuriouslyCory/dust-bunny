/**
 * Globe Debris (area 'globe'), Tiers 13–15. Same format as DEBRIS_TYPES in debris.ts, but sizes
 * are in Globe units (1 = 1,000 km, `AREAS.globe.unit`). The ladder repeats the Continent's shape
 * (both Acts arrive at 0.85 units and end past ≈4): Tier 13 types (0.11–0.34) feed the arrival size
 * (absorbable up to ≈0.6, meaningful from ≈0.1): satellites, rocket stages, space junk, weather,
 * ice floes, volcanic islands, reefs, atolls, islands; Tier 14 types (0.45–1.4) the Dust Moon: great
 * deserts, patches of ocean, ice shelves, the Great Barrier Reef, storm systems, archipelagos,
 * cordilleras, large islands, inland seas, island arcs; Tier 15 types (1.74–3.4) the Dust Planet:
 * the Moon, polar caps, landmasses, subcontinents, ocean basins, a whole continent and an ocean.
 * Room weights use the globe zone types (oceans, shelves, landmasses, archipelagos, icecaps).
 *
 * The Moon (`moon`, radius 1.74 = 1,737 km) is the Orbital Sweeper's stun obstacle: an Obstacle
 * until the Bunny reaches ≈2.5 (late Tier 14), spawned in every zone in Tier 14 and 15 and placed in
 * the open oceans by the generator (`GLOBE.moons`).
 *
 * Types whose id (or `model`) matches a loaded Globe model (public/models/manifest.json; island,
 * atoll, archipelago, ocean_patch, landmass, moon, satellite, rocket_stage, space_junk,
 * cloud_swirl) render the Blender mesh, normalised to the type's size (so `big_island` is the
 * island prop at 1.1 units, `continent_whole` the landmass prop at 3.1); their recipes are the
 * headless / no-model fallback. The rest are recipes.
 */
import type { DebrisType, RecipePart } from './debris';

const WATER = '#2f6fa8';
const DEEP = '#1b4a80';
const LAGOON = '#5fc0cf';
const SAND = '#e3d29a';
const GREEN = '#4f8a45';
const JUNGLE = '#2f6b35';
const ROCK = '#8a8378';
const METAL = '#c9ccd2';
const PANEL = '#2b3f7a';
const CLOUD = '#f4f6f8';
const ICE = '#eef4f8';
const ICE_BLUE = '#b9d6e8';
const DESERT = '#d1a868';

/** Flat disc a hair above the floor. */
const pad = (radius: number, color: string, y = 0.01, x = 0, z = 0): RecipePart => ({ shape: 'cylinder', radiusTop: radius, height: 0.02, segments: 18, pos: [x, y, z], color });

/** A small satellite: a box bus with two panel wings. */
const satellite = (wing: number): RecipePart[] => [
  { shape: 'box', size: [0.45, 0.4, 0.45], pos: [0, 0.3, 0], color: '#c9a640' },
  { shape: 'box', size: [wing, 0.04, 0.32], pos: [-(wing / 2 + 0.22), 0.3, 0], color: PANEL },
  { shape: 'box', size: [wing, 0.04, 0.32], pos: [wing / 2 + 0.22, 0.3, 0], color: PANEL },
];

/** A cloud spiral: flattened torus arms round a puffy core. */
const swirl = (core: number): RecipePart[] => [
  { shape: 'torus', radius: 0.6, tube: 0.22, pos: [0, 0.12, 0], rot: [Math.PI / 2, 0, 0], scale: [1, 0.85, 0.25], color: CLOUD },
  { shape: 'blob', radius: core, noise: 0.3, pos: [0, 0.12, 0], scale: [1, 0.3, 1], color: CLOUD },
  { shape: 'blob', radius: 0.3, noise: 0.4, pos: [0.75, 0.1, 0.35], scale: [1, 0.25, 0.6], color: '#dfe6ee' },
  { shape: 'blob', radius: 0.3, noise: 0.4, pos: [-0.7, 0.1, -0.4], scale: [1, 0.25, 0.6], color: '#dfe6ee' },
];

/** An island: lagoon, beach and a green hill. */
const island = (hill: string): RecipePart[] => [pad(1, LAGOON), pad(0.82, SAND, 0.015), { shape: 'blob', radius: 0.72, noise: 0.25, pos: [0, 0, 0], scale: [1, 0.32, 0.82], color: hill }];

/** A lump of land: a flattened green blob on a sandy rim, with darker and drier patches. */
const land = (desert: number): RecipePart[] => [
  pad(1.04, SAND, 0.004),
  { shape: 'blob', radius: 1, noise: 0.3, detail: 1, pos: [0, 0, 0], scale: [1, 0.14, 0.78], color: GREEN },
  { shape: 'blob', radius: 0.45, noise: 0.3, pos: [0.3, 0.05, 0.15], scale: [1, 0.14, 0.8], color: DESERT },
  { shape: 'blob', radius: 0.35 + desert * 0.1, noise: 0.3, pos: [-0.35, 0.05, -0.2], scale: [1, 0.14, 0.8], color: JUNGLE },
  { shape: 'cone', radius: 0.18, height: 0.22, pos: [-0.1, 0.1, 0.05], color: '#d9dde0' },
];

/** A lifted lozenge of ocean with paler swells. */
const ocean = (): RecipePart[] => [
  { shape: 'cylinder', radiusTop: 1, height: 0.06, segments: 22, pos: [0, 0.03, 0], scale: [1, 1, 0.72], color: DEEP },
  { shape: 'cylinder', radiusTop: 0.8, height: 0.02, segments: 22, pos: [0.08, 0.07, 0], scale: [1, 1, 0.66], color: WATER },
  { shape: 'torus', radius: 0.97, tube: 0.025, pos: [0, 0.06, 0], rot: [Math.PI / 2, 0, 0], scale: [1, 0.72, 1], color: '#e8f2f6' },
];

/** A chain of islands along x. */
const chain = (islands: ReadonlyArray<readonly [number, number, number]>): RecipePart[] =>
  islands.flatMap(([x, z, r]): RecipePart[] => [pad(r * 1.35, LAGOON, 0.01, x, z), { shape: 'blob', radius: r, noise: 0.25, pos: [x, 0, z], scale: [1, 0.35, 1], color: GREEN }]);

const TINTS = ['#ffffff', '#f3f0e8', '#eaf0ee'];
const ICE_TINTS = ['#ffffff', '#eef6fb', '#e4eef6'];

export const GLOBE_DEBRIS: DebrisType[] = [
  // ── Arrival (Bunny r = 0.85 units after the leap; Tier 14 starts at 1) ──────────────
  {
    id: 'satellite', name: 'Satellite', size: 0.11, mass: 1.0, tiers: [13, 14], area: 'globe',
    colors: TINTS,
    recipe: satellite(0.5),
    material: { roughness: 0.5, metalness: 0.4 },
    rooms: { oceans: 0.6, shelves: 0.6, landmasses: 0.6, archipelagos: 0.6, icecaps: 0.42 },
  },
  {
    id: 'cloud_swirl', name: 'Weather System', size: 0.12, mass: 0.9, tiers: [13, 14], area: 'globe',
    colors: [CLOUD, '#e8edf2'],
    recipe: swirl(0.4),
    material: { roughness: 1 },
    rooms: { oceans: 0.96, shelves: 0.6, landmasses: 0.48, archipelagos: 0.6, icecaps: 0.3 },
  },
  {
    id: 'rocket_stage', name: 'Spent Rocket Stage', size: 0.13, mass: 1.1, tiers: [13, 14], area: 'globe',
    colors: TINTS,
    recipe: [
      { shape: 'cylinder', radiusTop: 0.26, height: 1.5, segments: 10, pos: [0, 0.26, 0.05], rot: [Math.PI / 2, 0, 0], color: '#e9e6df' },
      { shape: 'cylinder', radiusTop: 0.27, height: 0.25, segments: 10, pos: [0, 0.26, 0.2], rot: [Math.PI / 2, 0, 0], color: '#d9822b' },
      { shape: 'cone', radius: 0.24, height: 0.3, pos: [0, 0.26, -0.85], rot: [-Math.PI / 2, 0, 0], color: '#3a3a3a' },
    ],
    material: { roughness: 0.6, metalness: 0.3 },
    rooms: { any: 0.6 },
  },
  {
    id: 'space_junk', name: 'Space Junk', size: 0.15, mass: 1.2, tiers: [13, 14], area: 'globe',
    colors: TINTS,
    recipe: [
      { shape: 'box', size: [0.4, 0.2, 0.3], pos: [-0.3, 0.15, 0.1], rot: [0.3, 0.6, 0.1], color: METAL },
      { shape: 'box', size: [0.6, 0.04, 0.25], pos: [0.3, 0.1, -0.2], rot: [0, 1.1, 0.2], color: PANEL },
      { shape: 'cylinder', radiusTop: 0.12, height: 0.5, pos: [0.1, 0.12, 0.45], rot: [1.3, 0, 0.4], color: '#9a9a9a' },
      { shape: 'sphere', radius: 0.14, pos: [0.45, 0.14, 0.4], color: '#d6c27a' },
    ],
    material: { roughness: 0.6, metalness: 0.3 },
    rooms: { any: 0.6 },
  },
  {
    id: 'ice_floe', name: 'Ice Floe', size: 0.17, mass: 1.1, tiers: [13, 14], area: 'globe',
    colors: ICE_TINTS,
    recipe: [
      { shape: 'blob', radius: 0.62, noise: 0.35, pos: [-0.25, 0, 0.1], scale: [1, 0.16, 0.8], color: ICE },
      { shape: 'blob', radius: 0.42, noise: 0.35, pos: [0.45, 0, -0.25], scale: [1, 0.14, 0.9], color: ICE },
      { shape: 'blob', radius: 0.25, noise: 0.35, pos: [0.4, 0, 0.5], scale: [1, 0.12, 0.8], color: ICE_BLUE },
    ],
    material: { roughness: 0.45 },
    rooms: { icecaps: 1.56, shelves: 0.21 },
  },
  {
    id: 'volcanic_island', name: 'Volcanic Island', size: 0.2, mass: 1.2, tiers: [13, 14], area: 'globe',
    colors: TINTS,
    recipe: [pad(1, LAGOON), { shape: 'cone', radius: 0.75, height: 0.55, segments: 12, pos: [0, 0, 0], color: '#4c4a46' }, { shape: 'blob', radius: 0.8, noise: 0.2, pos: [0, 0, 0], scale: [1, 0.15, 1], color: JUNGLE }, { shape: 'sphere', radius: 0.1, pos: [0, 0.52, 0], color: '#e8572a' }],
    material: { roughness: 0.9, emissive: '#3a0d00', emissiveIntensity: 0.4 },
    rooms: { oceans: 0.42, archipelagos: 0.96, shelves: 0.3 },
  },
  {
    id: 'rainforest', name: 'Rainforest', size: 0.21, mass: 1.2, tiers: [13, 14], area: 'globe',
    colors: TINTS,
    recipe: [
      { shape: 'blob', radius: 1, noise: 0.35, pos: [0, 0, 0], scale: [1, 0.18, 0.8], color: JUNGLE },
      { shape: 'blob', radius: 0.5, noise: 0.4, pos: [0.3, 0.06, 0.2], scale: [1, 0.3, 0.9], color: '#3b7d3c' },
      { shape: 'blob', radius: 0.4, noise: 0.4, pos: [-0.4, 0.06, -0.2], scale: [1, 0.3, 0.9], color: '#285c2c' },
    ],
    material: { roughness: 1 },
    rooms: { landmasses: 1.32, archipelagos: 0.3 },
  },
  {
    id: 'coral_reef', name: 'Coral Reef', size: 0.24, mass: 1.1, tiers: [13, 14], area: 'globe',
    colors: TINTS,
    recipe: [
      pad(1, '#57c7c9'),
      { shape: 'torus', radius: 0.62, tube: 0.12, pos: [0, 0.03, 0], rot: [Math.PI / 2, 0, 0.6], scale: [1.2, 0.5, 0.3], color: '#e98a8a' },
      { shape: 'blob', radius: 0.2, noise: 0.4, pos: [0.3, 0.02, 0.2], scale: [1, 0.4, 1], color: '#f2c26b' },
      { shape: 'blob', radius: 0.18, noise: 0.4, pos: [-0.35, 0.02, -0.1], scale: [1, 0.4, 1], color: '#c86fb0' },
    ],
    material: { roughness: 0.6 },
    rooms: { shelves: 0.96, archipelagos: 0.96, oceans: 0.12 },
  },
  {
    id: 'atoll', name: 'Atoll', size: 0.28, mass: 1.2, tiers: [13, 14], area: 'globe',
    colors: TINTS,
    recipe: [{ shape: 'torus', radius: 0.7, tube: 0.18, pos: [0, 0.02, 0], rot: [Math.PI / 2, 0, 0], scale: [1, 1, 0.2], color: SAND }, pad(0.6, '#4fb3c8')],
    material: { roughness: 0.5 },
    rooms: { oceans: 0.6, shelves: 0.48, archipelagos: 1.2 },
  },
  {
    id: 'cloud_bank', name: 'Cloud Bank', size: 0.3, mass: 1.0, tiers: [13, 14], area: 'globe', model: 'cloud_swirl',
    colors: [CLOUD, '#e8edf2'],
    recipe: swirl(0.55),
    material: { roughness: 1 },
    rooms: { oceans: 0.72, shelves: 0.48, landmasses: 0.48, archipelagos: 0.48, icecaps: 0.24 },
  },
  {
    id: 'island', name: 'Island', size: 0.34, mass: 1.3, tiers: [13, 14], area: 'globe',
    colors: TINTS,
    recipe: island(GREEN),
    material: { roughness: 0.9 },
    rooms: { oceans: 0.48, shelves: 0.84, archipelagos: 1.2 },
  },
  // ── Tier 14: Dust Moon (r 1–3) ──────────────
  {
    id: 'great_desert', name: 'A Great Desert', size: 0.48, mass: 1.8, tiers: [14, 14], area: 'globe',
    colors: ['#ffffff', '#f6ead8'],
    recipe: [
      { shape: 'blob', radius: 1, noise: 0.3, pos: [0, 0, 0], scale: [1, 0.12, 0.7], color: DESERT },
      { shape: 'torus', radius: 0.45, tube: 0.06, pos: [0.1, 0.07, 0], rot: [Math.PI / 2, 0, 0], scale: [1.4, 0.6, 0.3], color: '#c28d50' },
      { shape: 'torus', radius: 0.25, tube: 0.05, pos: [-0.3, 0.07, 0.15], rot: [Math.PI / 2, 0, 0], scale: [1.4, 0.6, 0.3], color: '#e2bc7c' },
    ],
    material: { roughness: 1 },
    rooms: { landmasses: 1.8 },
  },
  {
    id: 'ocean_patch', name: 'Patch of Ocean', size: 0.55, mass: 1.7, tiers: [14, 15], area: 'globe',
    colors: ['#ffffff', '#e6eef6'],
    recipe: ocean(),
    material: { roughness: 0.2 },
    rooms: { oceans: 1.1, shelves: 0.6 },
  },
  {
    id: 'ice_shelf', name: 'Ice Shelf', size: 0.62, mass: 1.8, tiers: [14, 14], area: 'globe',
    colors: ICE_TINTS,
    recipe: [
      { shape: 'box', size: [1.8, 0.16, 1.2], pos: [0, 0.08, 0], rot: [0, 0.2, 0], color: ICE },
      { shape: 'box', size: [0.7, 0.14, 0.5], pos: [0.75, 0.07, 0.55], rot: [0, -0.4, 0], color: ICE_BLUE },
      { shape: 'box', size: [0.5, 0.12, 0.4], pos: [-0.8, 0.06, 0.6], rot: [0, 0.7, 0], color: ICE },
    ],
    material: { roughness: 0.4 },
    rooms: { icecaps: 2.4, shelves: 0.4 },
  },
  {
    id: 'great_reef', name: 'The Great Barrier Reef', size: 0.68, mass: 2.0, tiers: [14, 15], area: 'globe',
    colors: TINTS,
    recipe: [
      { shape: 'cylinder', radiusTop: 0.35, height: 0.02, segments: 14, pos: [0, 0.01, 0], scale: [2.8, 1, 0.8], rot: [0, 0.5, 0], color: '#57c7c9' },
      ...([-0.7, -0.35, 0, 0.35, 0.7] as const).map((t, i): RecipePart => ({ shape: 'blob', radius: 0.17, noise: 0.4, pos: [t, 0.01, -t * 0.55], scale: [1.6, 0.35, 0.7], rot: [0, 0.5, 0], color: i % 2 ? '#e98a8a' : '#f2c26b' })),
    ],
    material: { roughness: 0.6 },
    rooms: { shelves: 1.5, archipelagos: 1 },
  },
  {
    id: 'storm_system', name: 'Storm System', size: 0.75, mass: 1.9, tiers: [14, 15], area: 'globe', model: 'cloud_swirl',
    colors: [CLOUD, '#e3e8ee'],
    recipe: swirl(0.5),
    material: { roughness: 1 },
    rooms: { oceans: 1.4, shelves: 0.7, landmasses: 0.6, archipelagos: 0.8, icecaps: 0.3 },
  },
  {
    id: 'archipelago', name: 'Archipelago', size: 0.9, mass: 2.2, tiers: [14, 15], area: 'globe',
    colors: TINTS,
    recipe: chain([[-0.65, -0.2, 0.28], [-0.2, 0.15, 0.33], [0.3, -0.1, 0.27], [0.7, 0.25, 0.2]]),
    material: { roughness: 0.9 },
    rooms: { archipelagos: 2.5, shelves: 1, oceans: 0.6 },
  },
  {
    id: 'cordillera', name: 'Cordillera', size: 1.0, mass: 2.4, tiers: [14, 15], area: 'globe',
    colors: TINTS,
    recipe: [
      { shape: 'blob', radius: 1, noise: 0.25, pos: [0, 0, 0], scale: [1, 0.12, 0.4], color: '#7c7a5a' },
      ...([-0.6, -0.25, 0.1, 0.45, 0.75] as const).flatMap((t, i): RecipePart[] => [
        { shape: 'cone', radius: 0.22, height: 0.38 - (i % 2) * 0.1, segments: 7, pos: [t, 0.02, (i % 2) * 0.12 - 0.05], color: ROCK },
        { shape: 'cone', radius: 0.09, height: 0.13, segments: 7, pos: [t, 0.27 - (i % 2) * 0.1, (i % 2) * 0.12 - 0.05], color: '#f4f6f8' },
      ]),
    ],
    material: { roughness: 0.95 },
    rooms: { landmasses: 1.8, icecaps: 0.3 },
  },
  {
    id: 'big_island', name: 'Large Island', size: 1.1, mass: 2.4, tiers: [14, 15], area: 'globe', model: 'island',
    colors: TINTS,
    recipe: island(JUNGLE),
    material: { roughness: 0.9 },
    rooms: { oceans: 0.6, shelves: 1, archipelagos: 1.4 },
  },
  {
    id: 'inland_sea', name: 'Inland Sea', size: 1.25, mass: 2.5, tiers: [14, 15], area: 'globe', model: 'ocean_patch',
    colors: ['#ffffff', '#e6eef6'],
    recipe: ocean(),
    material: { roughness: 0.2 },
    rooms: { shelves: 1.2, landmasses: 1, oceans: 0.4 },
  },
  {
    id: 'island_arc', name: 'Island Arc', size: 1.4, mass: 2.7, tiers: [14, 15], area: 'globe', model: 'archipelago',
    colors: TINTS,
    recipe: chain([[-0.75, 0.3, 0.2], [-0.4, 0.05, 0.25], [0, -0.1, 0.28], [0.4, 0.05, 0.25], [0.75, 0.3, 0.2]]),
    material: { roughness: 0.9 },
    rooms: { archipelagos: 2, oceans: 0.7, shelves: 0.6 },
  },
  // ── Tier 15: Dust Planet (r ≥ 3); the Moon from late Tier 14 ──────────────
  {
    id: 'moon', name: 'The Moon', size: 1.74, mass: 3.0, tiers: [14, 15], area: 'globe',
    colors: ['#ffffff', '#ecebe8'],
    recipe: [
      { shape: 'blob', radius: 1, noise: 0.06, detail: 2, pos: [0, 1, 0], color: '#b9b6b0' },
      { shape: 'sphere', radius: 0.3, pos: [0.4, 1.75, 0.35], scale: [1, 0.35, 1], color: '#8e8b86' },
      { shape: 'sphere', radius: 0.22, pos: [-0.35, 1.8, -0.3], scale: [1, 0.35, 1], color: '#8e8b86' },
    ],
    material: { roughness: 1 },
    rooms: { oceans: 0.35, shelves: 0.2, landmasses: 0.15, archipelagos: 0.2, icecaps: 0.15 },
  },
  {
    id: 'polar_cap', name: 'Polar Ice Cap', size: 2.0, mass: 3.2, tiers: [15, 15], area: 'globe',
    colors: ICE_TINTS,
    recipe: [
      { shape: 'blob', radius: 1, noise: 0.22, detail: 1, pos: [0, 0, 0], scale: [1, 0.12, 0.85], color: ICE },
      { shape: 'blob', radius: 0.55, noise: 0.3, pos: [0.15, 0.04, 0.1], scale: [1, 0.16, 0.9], color: '#ffffff' },
      { shape: 'torus', radius: 0.95, tube: 0.05, pos: [0, 0.02, 0], rot: [Math.PI / 2, 0, 0], scale: [1, 0.85, 0.4], color: ICE_BLUE },
    ],
    material: { roughness: 0.45 },
    rooms: { icecaps: 2.6, shelves: 0.3 },
  },
  {
    id: 'landmass', name: 'Landmass', size: 2.2, mass: 3.3, tiers: [15, 15], area: 'globe',
    colors: TINTS,
    recipe: land(0),
    material: { roughness: 1 },
    rooms: { landmasses: 2, shelves: 0.8, oceans: 0.3, archipelagos: 0.4 },
  },
  {
    id: 'subcontinent', name: 'Subcontinent', size: 2.5, mass: 3.5, tiers: [15, 15], area: 'globe', model: 'landmass',
    colors: ['#ffffff', '#f6f0e2'],
    recipe: land(1),
    material: { roughness: 1 },
    rooms: { landmasses: 1.6, shelves: 0.5 },
  },
  {
    id: 'ocean_basin', name: 'Ocean Basin', size: 2.8, mass: 3.6, tiers: [15, 15], area: 'globe', model: 'ocean_patch',
    colors: ['#ffffff', '#e2ebf5'],
    recipe: ocean(),
    material: { roughness: 0.2 },
    rooms: { oceans: 2, shelves: 0.4, archipelagos: 0.5 },
  },
  {
    id: 'continent_whole', name: 'A Continent', size: 3.1, mass: 3.9, tiers: [15, 15], area: 'globe', model: 'landmass',
    colors: TINTS,
    recipe: land(2),
    material: { roughness: 1 },
    rooms: { landmasses: 1.4, oceans: 0.3, shelves: 0.4 },
  },
  {
    id: 'an_ocean', name: 'An Ocean', size: 3.4, mass: 4.0, tiers: [15, 15], area: 'globe', model: 'ocean_patch',
    colors: ['#ffffff', '#dfe8f2'],
    recipe: ocean(),
    material: { roughness: 0.2 },
    rooms: { oceans: 1.5, shelves: 0.3 },
  },
];
