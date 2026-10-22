/**
 * Universe Debris (area 'universe'), Tiers 19–21. Same format as DEBRIS_TYPES in debris.ts, but
 * sizes are in Universe units (1 = 10 Mly, `AREAS.universe.unit`). The ladder repeats the Galaxy's
 * shape (both Acts arrive at 0.85 units and end past ≈4): Tier 19 types (0.11–0.33) feed the
 * arrival size (absorbable up to ≈0.6): intergalactic lint, stray stars, hydrogen clouds, dwarf
 * and satellite galaxies and a sock; Tier 20 types (0.45–1.35) the Dust Singularity: spiral,
 * lenticular, elliptical, barred and starburst galaxies, galaxy pairs, radio galaxies, groups,
 * filament knots, someone's couch, a lint web and giant spirals; Tier 21 types (1.8–3.1)
 * Everything: galaxy clusters, giant ellipticals, cluster mergers, superclusters, a great wall and
 * a lint supercluster. Galaxies and clusters are drawn at play size, not to scale.
 *
 * Room weights use the universe zone types (superclusters, filaments, sheets, voids): the nodes
 * lean on clusters, groups and big ellipticals, the filaments on galaxies strung along them (the
 * richest zone), the sheets on thin stragglers (dwarfs, gas, lint) and the voids hold almost
 * nothing (a few dwarf galaxies, stray stars and lint at arrival size; nothing bigger).
 *
 * Every type renders a Blender prop (public/models, docs/models.md "Universe scale"; by id or
 * `model`) and is self-lit: `material.glow` adds each part's own emission (baked per vertex,
 * src/entities/debrisGeometry.ts). The plain galaxies (`spiral_galaxy`, `barred_spiral`,
 * `elliptical_galaxy`, `lenticular_galaxy`, `irregular_galaxy`, `dwarf_galaxy`) are pale and
 * take `tintAll` so one prop reads at several sizes and colours; the rest keep their own colours.
 * The lint and the sock reuse the Galaxy's `cosmic_lint` and `space_sock`, the stray stars and gas
 * the Galaxy's `yellow_star` and `emission_nebula`, and the couch is the House's (no emission of
 * its own: a uniform `emissive` so it shows in the dark). The recipes are the headless / no-model
 * fallback, glowing in the type's main colour (`emissive`).
 *
 * One-offs placed by the map (src/world/universe.ts): the Great Attractor (`great_attractor`, no
 * room weights, 2.2: absorbable from r ≈ 3.1, just past Tier 21) on the node by the spawn, with its
 * own narrator line (`STORY.debris.great_attractor`), and a sock (`universe_sock`) beside the spawn.
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
/** A lumpy irregular cloud lying low (gas, irregular galaxies, knots). */
const cloud = (color: string, x = 0, z = 0, r = 1): RecipePart => ({ shape: 'blob', radius: r, noise: 0.45, detail: 1, pos: [x, r * 0.5, z], scale: [1, 0.45, 1], color });
/** `n` small galaxies within radius 1 (groups and clusters). */
const group = (n: number, color: string): RecipePart[] =>
  Array.from({ length: n }, (_, i) => {
    const r = 0.8 * Math.sqrt((i + 0.5) / n);
    const a = i * 2.39996;
    return { shape: 'sphere', radius: 0.14 + (i % 3) * 0.06, pos: [Math.cos(a) * r, 0.25, Math.sin(a) * r], scale: [1, 0.5, 1], color } satisfies RecipePart;
  });
/** A strand of the web along X with a knot in the middle. */
const strand = (color: string): RecipePart[] => [
  { shape: 'capsule', radius: 0.12, length: 1.7, pos: [0, 0.15, 0], rot: [0, 0, Math.PI / 2], color },
  { shape: 'sphere', radius: 0.3, pos: [0, 0.3, 0], color: '#ffffff' },
];
/** A lint clump: a fuzzy lumpy ball. */
const lint = (color: string): RecipePart => ({ shape: 'blob', radius: 0.8, noise: 0.35, detail: 2, pos: [0, 0.8, 0], color });
/** A sock lying flat. */
const sock: RecipePart[] = [
  { shape: 'capsule', radius: 0.28, length: 1.2, pos: [0, 0.28, 0], rot: [Math.PI / 2, 0, 0], color: '#d84a8a' },
  { shape: 'capsule', radius: 0.26, length: 0.5, pos: [0.45, 0.27, 0.65], rot: [0, 0, Math.PI / 2], color: '#4ac8e8' },
];

/** How strongly the props' own emission shows (× each type's `glow` factor): as the Galaxy's. */
const GLOW = 0.38;
/** Self-lit: own emission (`glow`), a fallback glow in the main colour for recipes. */
const lit = (main: string, glow = 1, fallback = 0.6) => ({ roughness: 0.6, glow: GLOW * glow, emissive: main, emissiveIntensity: fallback });
/** Self-lit and tinted: the instance colour multiplies every part and its glow (the pale galaxies, reused props). */
const tinted = (main: string, glow = 1, fallback = 0.6) => ({ ...lit(main, glow, fallback), tintAll: true });

export const UNIVERSE_DEBRIS: DebrisType[] = [
  // ── Arrival (Bunny r = 0.85 units after the leap; Tier 20 starts at 1) ──────────────
  {
    id: 'universe_lint', name: 'Intergalactic Lint', size: 0.11, mass: 1.26, tiers: [19, 20], area: 'universe', model: 'cosmic_lint',
    colors: ['#f4eeff', '#e8dcff'],
    recipe: [lint('#c8b8e0')],
    material: tinted('#c8a8e8', 1.2, 0.25),
    rooms: { sheets: 1.2, filaments: 0.9, voids: 0.8, superclusters: 0.4 },
  },
  {
    id: 'stray_star', name: 'Intergalactic Star', size: 0.13, mass: 1.38, tiers: [19, 20], area: 'universe', model: 'yellow_star',
    colors: ['#fff4d8', '#d8e8ff', '#ffd8b8'],
    recipe: [{ shape: 'sphere', radius: 1, pos: [0, 1, 0], color: '#ffffff' }],
    material: tinted('#fff0c8', 1.1, 0.8),
    rooms: { filaments: 1.2, sheets: 1, voids: 0.3, superclusters: 0.7 },
  },
  {
    id: 'hydrogen_cloud', name: 'Hydrogen Cloud', size: 0.17, mass: 1.3, tiers: [19, 20], area: 'universe', model: 'emission_nebula',
    colors: ['#ffb8d0', '#c8b8ff'],
    recipe: [cloud('#c85a7a'), cloud('#a84a6a', 0.5, 0.3, 0.6)],
    material: tinted('#ff6a8a', 0.9, 0.4),
    rooms: { sheets: 1.4, filaments: 1, voids: 0.15 },
  },
  {
    id: 'dwarf_galaxy', name: 'Dwarf Galaxy', size: 0.22, mass: 1.45, tiers: [19, 20], area: 'universe',
    colors: ['#c8d4ff', '#ffffff', '#e8d8ff'],
    recipe: [cloud('#b8c8ff', 0, 0, 0.9)],
    material: tinted('#a8b8ff', 1.2, 0.5),
    rooms: { filaments: 1.1, sheets: 1.1, voids: 0.3, superclusters: 0.6 },
  },
  {
    id: 'satellite_galaxy', name: 'Satellite Galaxy', size: 0.27, mass: 1.5, tiers: [19, 20], area: 'universe', model: 'irregular_galaxy',
    colors: ['#c8d8ff', '#ffffff'],
    recipe: [cloud('#9ab8ff'), cloud('#c8a8ff', 0.6, 0.4, 0.6)],
    material: tinted('#9ab8ff', 1.1, 0.5),
    rooms: { filaments: 1.3, superclusters: 0.9, sheets: 0.6 },
  },
  {
    id: 'universe_sock', name: 'Lost Sock', size: 0.33, mass: 1.5, tiers: [19, 20], area: 'universe', model: 'space_sock',
    colors: WHITE,
    recipe: sock,
    material: lit('#d84a8a', 1, 0.3),
    rooms: { sheets: 0.08, filaments: 0.04, voids: 0.1 },
  },
  // ── Tier 20: Dust Singularity (r ≥ 1) ──────────────
  {
    id: 'spiral_galaxy', name: 'Spiral Galaxy', size: 0.45, mass: 2.31, tiers: [20, 20], area: 'universe',
    colors: ['#ffffff', '#d8e4ff', '#fff0dc'],
    recipe: spiral('#7a98ff', '#ffe8b8'),
    material: tinted('#8aa8ff'),
    rooms: { filaments: 1.8, sheets: 0.7, superclusters: 0.7 },
  },
  {
    id: 'lenticular_galaxy', name: 'Lenticular Galaxy', size: 0.52, mass: 2.31, tiers: [20, 20], area: 'universe',
    colors: ['#ffffff', '#ffecd8'],
    recipe: [{ shape: 'cylinder', radiusTop: 1, height: 0.2, segments: 24, pos: [0, 0.1, 0], color: '#ffe0c0' }, { shape: 'sphere', radius: 0.4, pos: [0, 0.25, 0], scale: [1, 0.6, 1], color: '#fff4e0' }],
    material: tinted('#ffd8a8'),
    rooms: { superclusters: 1.3, filaments: 1, sheets: 0.3 },
  },
  {
    id: 'elliptical_galaxy', name: 'Elliptical Galaxy', size: 0.6, mass: 2.42, tiers: [20, 20], area: 'universe',
    colors: ['#ffffff', '#ffe8d0'],
    recipe: [elliptical('#ffd8a8')],
    material: tinted('#ffc890'),
    rooms: { superclusters: 1.6, filaments: 0.9, sheets: 0.25 },
  },
  {
    id: 'barred_spiral', name: 'Barred Spiral', size: 0.68, mass: 2.53, tiers: [20, 20], area: 'universe',
    colors: ['#ffffff', '#dce6ff'],
    recipe: spiral('#8aa0ff', '#ffd890'),
    material: tinted('#9ab0ff'),
    rooms: { filaments: 1.6, sheets: 0.5, superclusters: 0.6 },
  },
  {
    id: 'starburst_galaxy', name: 'Starburst Galaxy', size: 0.76, mass: 2.53, tiers: [20, 20], area: 'universe', model: 'irregular_galaxy',
    colors: ['#ffb8e0', '#ffc8f0'],
    recipe: [cloud('#ff9ad8'), cloud('#fff8e8', 0.5, 0.3, 0.5)],
    material: tinted('#ff8ac8', 1.25, 0.7),
    rooms: { filaments: 1.1, sheets: 0.6, superclusters: 0.5 },
  },
  {
    id: 'galaxy_pair', name: 'Galaxy Pair', size: 0.85, mass: 2.75, tiers: [20, 20], area: 'universe',
    colors: WHITE,
    recipe: [
      { shape: 'cylinder', radiusTop: 0.55, height: 0.1, segments: 20, pos: [-0.42, 0.05, 0], color: '#8aa8ff' },
      { shape: 'cylinder', radiusTop: 0.45, height: 0.1, segments: 20, pos: [0.5, 0.08, 0.15], rot: [0.3, 0, 0], color: '#ffc8a8' },
    ],
    material: lit('#9ab0ff'),
    rooms: { filaments: 1.3, superclusters: 0.9, sheets: 0.2 },
  },
  {
    id: 'radio_galaxy', name: 'Radio Galaxy', size: 0.95, mass: 2.9, tiers: [20, 20], area: 'universe',
    colors: WHITE,
    recipe: [elliptical('#ffe8c8', 0.35), cloud('#ff6a3a', -0.75, 0, 0.3), cloud('#ff6a3a', 0.75, 0, 0.3)],
    material: lit('#ff8a5a'),
    rooms: { superclusters: 1.1, filaments: 0.8 },
  },
  {
    id: 'galaxy_group', name: 'Galaxy Group', size: 1.05, mass: 2.9, tiers: [20, 20], area: 'universe',
    colors: WHITE,
    recipe: group(7, '#c8d0ff'),
    material: lit('#b8c0ff'),
    rooms: { superclusters: 1.7, filaments: 1 },
  },
  {
    id: 'filament_knot', name: 'Filament Knot', size: 1.15, mass: 2.7, tiers: [20, 21], area: 'universe',
    colors: WHITE,
    recipe: strand('#8ac8ff'),
    material: lit('#7ab8ff'),
    rooms: { filaments: 1.8, superclusters: 0.3, sheets: 0.2 },
  },
  {
    id: 'lost_couch', name: "Someone's Couch", size: 1.25, mass: 2.8, tiers: [20, 21], area: 'universe', model: 'couch',
    colors: WHITE,
    recipe: [
      { shape: 'box', size: [2, 0.45, 0.9], pos: [0, 0.3, 0], color: '#8a5a7a' },
      { shape: 'box', size: [2, 0.6, 0.25], pos: [0, 0.7, -0.35], color: '#8a5a7a' },
    ],
    material: { roughness: 0.8, emissive: '#6a4a5a', emissiveIntensity: 0.45 },
    rooms: { sheets: 0.04, filaments: 0.015 },
  },
  {
    id: 'lint_web', name: 'Lint Web', size: 1.3, mass: 2.8, tiers: [20, 21], area: 'universe', model: 'cosmic_lint',
    colors: ['#f0e4ff'],
    recipe: [lint('#b8a8d0'), cloud('#8a6aa8', 0.5, 0.4, 0.75)],
    material: tinted('#c8a8e8', 1.2, 0.3),
    rooms: { sheets: 0.22, filaments: 0.1 },
  },
  {
    id: 'giant_spiral', name: 'Giant Spiral', size: 1.35, mass: 2.9, tiers: [20, 21], area: 'universe', model: 'spiral_galaxy',
    colors: ['#e0e8ff', '#ffffff'],
    recipe: spiral('#7a98ff', '#ffe8b8'),
    material: tinted('#8aa8ff', 1.15),
    rooms: { filaments: 1.1, superclusters: 0.6, sheets: 0.3 },
  },
  // ── Tier 21: Everything (r ≥ 3) ──────────────
  {
    id: 'galaxy_cluster', name: 'Galaxy Cluster', size: 1.8, mass: 3.9, tiers: [21, 21], area: 'universe',
    colors: WHITE,
    recipe: group(14, '#ffe8c8'),
    material: lit('#ffd8a8'),
    rooms: { superclusters: 1.8, filaments: 1 },
  },
  {
    id: 'giant_elliptical', name: 'Giant Elliptical', size: 2.0, mass: 4, tiers: [21, 21], area: 'universe', model: 'elliptical_galaxy',
    colors: ['#ffe0c0', '#fff0dc'],
    recipe: [elliptical('#ffc890')],
    material: tinted('#ffb878', 1.1),
    rooms: { superclusters: 1.5, filaments: 0.7 },
  },
  {
    id: 'cluster_merger', name: 'Cluster Merger', size: 2.3, mass: 4.2, tiers: [21, 21], area: 'universe', model: 'galaxy_cluster',
    colors: ['#ffc8f0', '#e8c8ff'],
    recipe: [...group(8, '#ffe8c8'), cloud('#ff6ad8', 0, 0, 0.9)],
    material: tinted('#ff8ae8', 1.1),
    rooms: { superclusters: 1.1, filaments: 0.8 },
  },
  {
    id: 'supercluster', name: 'Supercluster', size: 2.6, mass: 4.4, tiers: [21, 21], area: 'universe', model: 'supercluster_node',
    colors: WHITE,
    recipe: group(20, '#fff4d8'),
    material: lit('#c8e0ff', 1.1),
    rooms: { superclusters: 2, filaments: 0.5 },
  },
  {
    id: 'great_wall', name: 'Great Wall', size: 2.8, mass: 4.6, tiers: [21, 21], area: 'universe', model: 'filament_knot',
    colors: ['#d8e8ff', '#fff0dc'],
    recipe: strand('#8ac8ff'),
    material: tinted('#8ac8ff', 1.2),
    rooms: { filaments: 1.2, sheets: 0.3 },
  },
  {
    id: 'lint_supercluster', name: 'Lint Supercluster', size: 3.1, mass: 4.9, tiers: [21, 21], area: 'universe', model: 'cosmic_lint',
    colors: ['#f0e4ff'],
    recipe: [lint('#b8a8d0'), cloud('#8a6aa8', 0.5, 0.4, 0.75)],
    material: tinted('#c8a8e8', 1.2, 0.35),
    rooms: { sheets: 0.2, filaments: 0.12, superclusters: 0.08 },
  },
  // ── One-off (placed by the map only) ──────────────
  {
    id: 'great_attractor', name: 'The Great Attractor', size: 2.2, mass: 4.2, tiers: [21, 21], area: 'universe',
    colors: WHITE,
    recipe: [elliptical('#ffd890', 0.5), ...group(10, '#fff0d8'), cloud('#ff9a4a', 0, 0, 0.9)],
    material: lit('#ffb860', 1.15),
    rooms: {},
  },
];
