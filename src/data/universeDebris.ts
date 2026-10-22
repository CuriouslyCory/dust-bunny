/**
 * Universe Debris (area 'universe'), Tiers 19–21. Same format as DEBRIS_TYPES in debris.ts, but
 * sizes are in Universe units (1 = 10 Mly, `AREAS.universe.unit`). Placeholder (Act 9 groundwork):
 * recipes only, no Blender props yet. The ladder repeats the Galaxy's shape (both Acts arrive at
 * 0.85 units and end past ≈4): Tier 19 types (0.11–0.33) feed the arrival size (absorbable up to
 * ≈0.6): cosmic lint, lost stars, hydrogen wisps, dwarf and satellite galaxies and a sock; Tier 20
 * types (0.45–1.35) the Dust Singularity: spiral, elliptical, irregular and starburst galaxies,
 * galaxy pairs and groups, filament knots and a lint web; Tier 21 types (1.8–3.1) Everything:
 * galaxy clusters, giant ellipticals, cluster mergers, supercluster cores and the great lint
 * attractor. Galaxies and clusters are drawn at play size, not to scale.
 *
 * Room weights use the universe zone types (superclusters, filaments, sheets, voids): the nodes
 * lean on clusters and big ellipticals, the filaments on galaxies strung along them, the sheets on
 * thinner stragglers, and the voids hold almost nothing (a few dwarf galaxies and lint). Every type
 * is self-lit: an `emissive` glow in its main colour.
 */
import type { DebrisType, RecipePart } from './debris';

const WHITE = ['#ffffff'];

/** A flat spiral galaxy lying on the floor: a thin disc with a bright bulge (radius 1). */
const spiral = (disc: string, bulge: string): RecipePart[] => [
  { shape: 'cylinder', radiusTop: 1, height: 0.12, segments: 24, pos: [0, 0.06, 0], color: disc },
  { shape: 'sphere', radius: 0.32, pos: [0, 0.2, 0], scale: [1, 0.6, 1], color: bulge },
];
/** An elliptical galaxy: a soft squashed ball. */
const elliptical = (color: string, r = 1): RecipePart => ({ shape: 'sphere', radius: r, pos: [0, r * 0.55, 0], scale: [1, 0.55, 0.8], color });
/** A lumpy irregular cloud lying low (wisps, irregular galaxies, knots). */
const cloud = (color: string, x = 0, z = 0, r = 1): RecipePart => ({ shape: 'blob', radius: r, noise: 0.45, detail: 1, pos: [x, r * 0.5, z], scale: [1, 0.45, 1], color });
/** `n` small galaxies within radius 1 (groups and clusters). */
const group = (n: number, color: string): RecipePart[] =>
  Array.from({ length: n }, (_, i) => {
    const r = 0.8 * Math.sqrt((i + 0.5) / n);
    const a = i * 2.39996;
    return { shape: 'sphere', radius: 0.14 + (i % 3) * 0.06, pos: [Math.cos(a) * r, 0.25, Math.sin(a) * r], scale: [1, 0.5, 1], color } satisfies RecipePart;
  });
/** A lint clump: a fuzzy lumpy ball. */
const lint = (color: string): RecipePart => ({ shape: 'blob', radius: 0.8, noise: 0.35, detail: 2, pos: [0, 0.8, 0], color });
/** A sock lying flat. */
const sock: RecipePart[] = [
  { shape: 'capsule', radius: 0.28, length: 1.2, pos: [0, 0.28, 0], rot: [Math.PI / 2, 0, 0], color: '#d84a8a' },
  { shape: 'capsule', radius: 0.26, length: 0.5, pos: [0.45, 0.27, 0.65], rot: [0, 0, Math.PI / 2], color: '#4ac8e8' },
];

/** Self-lit: a uniform glow in the main colour. */
const lit = (main: string, intensity = 0.6) => ({ roughness: 0.6, emissive: main, emissiveIntensity: intensity });

export const UNIVERSE_DEBRIS: DebrisType[] = [
  // ── Arrival (Bunny r = 0.85 units after the leap; Tier 20 starts at 1) ──────────────
  {
    id: 'universe_lint', name: 'Cosmic Lint', size: 0.11, mass: 1.26, tiers: [19, 20], area: 'universe',
    colors: WHITE,
    recipe: [lint('#c8b8e0')],
    material: lit('#c8a8e8', 0.25),
    rooms: { sheets: 1.2, filaments: 0.6, voids: 0.5, superclusters: 0.3 },
  },
  {
    id: 'lost_star', name: 'Lost Star', size: 0.13, mass: 1.38, tiers: [19, 20], area: 'universe',
    colors: ['#fff4d8', '#d8e8ff'],
    recipe: [{ shape: 'sphere', radius: 1, pos: [0, 1, 0], color: '#ffffff' }],
    material: lit('#fff0c8', 0.8),
    rooms: { filaments: 1, sheets: 1, voids: 0.3, superclusters: 0.6 },
  },
  {
    id: 'hydrogen_wisp', name: 'Hydrogen Wisp', size: 0.16, mass: 1.3, tiers: [19, 20], area: 'universe',
    colors: ['#ffc8d8'],
    recipe: [cloud('#c85a7a'), cloud('#a84a6a', 0.5, 0.3, 0.6)],
    material: lit('#ff6a8a', 0.4),
    rooms: { sheets: 1.4, filaments: 0.8, voids: 0.2 },
  },
  {
    id: 'dwarf_galaxy', name: 'Dwarf Galaxy', size: 0.22, mass: 1.45, tiers: [19, 20], area: 'universe',
    colors: WHITE,
    recipe: [cloud('#b8c8ff', 0, 0, 0.9)],
    material: lit('#a8b8ff', 0.5),
    rooms: { filaments: 1, sheets: 1, voids: 0.4, superclusters: 0.5 },
  },
  {
    id: 'satellite_galaxy', name: 'Satellite Galaxy', size: 0.27, mass: 1.5, tiers: [19, 20], area: 'universe',
    colors: WHITE,
    recipe: spiral('#8aa8ff', '#fff0c8'),
    material: lit('#9ab8ff', 0.5),
    rooms: { filaments: 1.2, superclusters: 0.8, sheets: 0.6 },
  },
  {
    id: 'cosmic_sock', name: 'Cosmic Sock', size: 0.33, mass: 1.5, tiers: [19, 20], area: 'universe',
    colors: WHITE,
    recipe: sock,
    material: lit('#d84a8a', 0.3),
    rooms: { sheets: 0.4, voids: 0.2 },
  },
  // ── Tier 20: Dust Singularity (r 1–3) ──────────────
  {
    id: 'spiral_galaxy', name: 'Spiral Galaxy', size: 0.45, mass: 2.31, tiers: [20, 20], area: 'universe',
    colors: ['#ffffff', '#e0e8ff'],
    recipe: spiral('#7a98ff', '#ffe8b8'),
    material: lit('#8aa8ff', 0.55),
    rooms: { filaments: 1.6, sheets: 0.8, superclusters: 0.6 },
  },
  {
    id: 'elliptical_galaxy', name: 'Elliptical Galaxy', size: 0.57, mass: 2.42, tiers: [20, 20], area: 'universe',
    colors: ['#ffffff', '#ffe8d0'],
    recipe: [elliptical('#ffd8a8')],
    material: lit('#ffc890', 0.5),
    rooms: { superclusters: 1.4, filaments: 0.8, sheets: 0.4 },
  },
  {
    id: 'irregular_galaxy', name: 'Irregular Galaxy', size: 0.66, mass: 2.53, tiers: [20, 20], area: 'universe',
    colors: WHITE,
    recipe: [cloud('#9ab8ff'), cloud('#c8a8ff', 0.6, 0.4, 0.6), cloud('#ffb8d8', -0.5, -0.3, 0.5)],
    material: lit('#b8b8ff', 0.5),
    rooms: { sheets: 1.2, filaments: 0.8, voids: 0.2 },
  },
  {
    id: 'galaxy_pair', name: 'Galaxy Pair', size: 0.85, mass: 2.75, tiers: [20, 20], area: 'universe',
    colors: WHITE,
    recipe: [
      { shape: 'cylinder', radiusTop: 0.55, height: 0.1, segments: 20, pos: [-0.42, 0.05, 0], color: '#8aa8ff' },
      { shape: 'cylinder', radiusTop: 0.45, height: 0.1, segments: 20, pos: [0.5, 0.08, 0.15], rot: [0.3, 0, 0], color: '#a8b8ff' },
    ],
    material: lit('#9ab0ff', 0.55),
    rooms: { filaments: 1.2, superclusters: 0.8 },
  },
  {
    id: 'galaxy_group', name: 'Galaxy Group', size: 1.05, mass: 2.9, tiers: [20, 20], area: 'universe',
    colors: WHITE,
    recipe: group(7, '#c8d0ff'),
    material: lit('#b8c0ff', 0.6),
    rooms: { superclusters: 1.6, filaments: 1 },
  },
  {
    id: 'filament_knot', name: 'Filament Knot', size: 1.15, mass: 2.7, tiers: [20, 21], area: 'universe',
    colors: WHITE,
    recipe: [cloud('#8ac8ff'), cloud('#b8e0ff', 0.5, 0.2, 0.6)],
    material: lit('#7ab8ff', 0.6),
    rooms: { filaments: 1.6, superclusters: 0.4 },
  },
  {
    id: 'lint_web', name: 'Lint Web', size: 1.25, mass: 2.8, tiers: [20, 21], area: 'universe',
    colors: ['#f0e4ff'],
    recipe: [lint('#b8a8d0'), cloud('#8a6aa8', 0.5, 0.4, 0.75)],
    material: lit('#c8a8e8', 0.3),
    rooms: { sheets: 0.8, filaments: 0.5, voids: 0.2 },
  },
  {
    id: 'starburst_galaxy', name: 'Starburst Galaxy', size: 1.35, mass: 2.9, tiers: [20, 21], area: 'universe',
    colors: WHITE,
    recipe: spiral('#ff9ad8', '#fff8e8'),
    material: lit('#ff8ac8', 0.7),
    rooms: { filaments: 0.9, superclusters: 0.6, sheets: 0.4 },
  },
  // ── Tier 21: Everything (r 3+) ──────────────
  {
    id: 'galaxy_cluster', name: 'Galaxy Cluster', size: 1.8, mass: 3.9, tiers: [21, 21], area: 'universe',
    colors: WHITE,
    recipe: group(14, '#ffe8c8'),
    material: lit('#ffd8a8', 0.6),
    rooms: { superclusters: 1.6, filaments: 1 },
  },
  {
    id: 'giant_elliptical', name: 'Giant Elliptical', size: 2.0, mass: 4, tiers: [21, 21], area: 'universe',
    colors: ['#ffffff', '#ffe0c0'],
    recipe: [elliptical('#ffc890')],
    material: lit('#ffb878', 0.5),
    rooms: { superclusters: 1.4, filaments: 0.6 },
  },
  {
    id: 'cluster_merger', name: 'Cluster Merger', size: 2.3, mass: 4.2, tiers: [21, 21], area: 'universe',
    colors: WHITE,
    recipe: [...group(8, '#ffe8c8'), cloud('#ff6ad8', 0, 0, 0.9)],
    material: lit('#ff8ae8', 0.5),
    rooms: { superclusters: 1, filaments: 0.8 },
  },
  {
    id: 'supercluster_core', name: 'Supercluster Core', size: 2.6, mass: 4.4, tiers: [21, 21], area: 'universe',
    colors: WHITE,
    recipe: group(20, '#fff4d8'),
    material: lit('#ffe8b8', 0.7),
    rooms: { superclusters: 2, filaments: 0.5 },
  },
  {
    id: 'great_lint_attractor', name: 'Great Lint Attractor', size: 3.1, mass: 4.9, tiers: [21, 21], area: 'universe',
    colors: ['#f0e4ff'],
    recipe: [lint('#b8a8d0'), cloud('#8a6aa8', 0.5, 0.4, 0.75)],
    material: lit('#c8a8e8', 0.35),
    rooms: { sheets: 0.6, filaments: 0.5, superclusters: 0.4, voids: 0.2 },
  },
];
