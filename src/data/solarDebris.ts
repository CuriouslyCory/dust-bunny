/**
 * Solar System Debris (area 'solar_system'), Tiers 15–17. Same format as DEBRIS_TYPES in
 * debris.ts, but sizes are in Solar System units (1 = 0.01 AU, `AREAS.solar_system.unit`). The
 * ladder repeats the Globe's shape (both Acts arrive at 0.85 units and end past ≈4): Tier 15 types
 * (0.11–0.33) feed the arrival size (absorbable up to ≈0.6, meaningful from ≈0.1): meteoroids,
 * asteroids, comets, moonlets, asteroid clusters, Kuiper belt objects, rubble piles, Phobos; Tier
 * 16 types (0.45–1.35) the Dust Giant: Vesta, Mercury, Io, Europa, Mars, great comets, Ceres, icy
 * moons, Ganymede, Titan, Pluto, Venus, dwarf planets; Tier 17 types (1.8–3.1) the Dust Star:
 * comet swarms, Uranus, asteroid swarms, Neptune, Saturn, Jupiter, rogue planets, a slice of
 * Saturn's rings and the leftover dust. Planets and moons are drawn at play size, not to scale.
 * Room weights use the solar zone types (corona, inner_orbits, asteroid_belt, outer_orbits,
 * kuiper_belt); the belt leans hard on rocks (and the generator scatters more there,
 * `SOLAR.beltRocks`), the Kuiper belt on ice.
 *
 * One-offs placed by the generator (src/world/solarSystem.ts): Voyager 1 (`voyager_1`, its own
 * narrator line in `STORY.debris`), Jupiter (`jupiter`, `lockedUntilTier: 17`: an Obstacle until
 * Tier 17, then Debris the Bunny can absorb from r ≈ 3.4), and one of each planet on its orbit
 * (Mercury, Venus, Mars, Saturn, Uranus, Neptune, Pluto: those also spawn at random, lightly).
 * Mars (0.68) is absorbable from r ≈ 0.97, just before Tier 16 ("It eats Mars").
 *
 * Types whose id (or `model`) matches a loaded Solar System model (public/models/manifest.json:
 * asteroid, asteroid_cluster, comet_nucleus, voyager_1, moonlet, icy_moon, rocky_planet, mars,
 * venus, jupiter, saturn, ice_giant, dwarf_planet) render the Blender mesh normalised to the type's
 * size, tinted by `colors` (Mercury, Io and Titan are the grey `rocky_planet` in three tints; Uranus
 * and Neptune the `ice_giant`); their recipes are the headless / no-model fallback (neutral part
 * colours where the tint carries the hue). The rest are recipes.
 */
import type { DebrisType, RecipePart } from './debris';

const ROCK = '#8d8378';
const ROCK_DARK = '#6e655c';
const ICE = '#dcebf3';
const ICE_BLUE = '#a9d3e6';
const NUCLEUS = '#5c5a58';
const LIGHT = '#d9d6d0';

const ROCK_TINTS = ['#ffffff', '#e6ded4', '#cfc6bb'];
const ICE_TINTS = ['#ffffff', '#eef6fb', '#e2eef8'];
const WHITE = ['#ffffff'];

/** A ball resting on the floor (radius 1 at y = 1). */
const ball = (color: string, noise = 0): RecipePart =>
  noise > 0 ? { shape: 'blob', radius: 1, noise, detail: 2, pos: [0, 1, 0], color } : { shape: 'sphere', radius: 1, pos: [0, 1, 0], color };
/** A flat crater (or spot) on the ball's top. */
const spot = (x: number, z: number, r: number, color: string): RecipePart => ({ shape: 'sphere', radius: r, pos: [x, 1.72 + 0.2 * (1 - Math.hypot(x, z)), z], scale: [1, 0.3, 1], color });
/** An equatorial band (a flattened torus hugging the ball). */
const band = (y: number, r: number, color: string, tube = 0.1): RecipePart => ({ shape: 'torus', radius: r, tube, pos: [0, y, 0], rot: [Math.PI / 2, 0, 0], scale: [1, 1, 0.55], color });
/** A lumpy rock. */
const rock = (r: number, x = 0, z = 0, color = ROCK, noise = 0.35): RecipePart => ({ shape: 'blob', radius: r, noise, detail: 1, pos: [x, r * 0.8, z], scale: [1, 0.8, 0.9], color });
/** A comet: dark nucleus, pale coma, an ice tail streaming to −Z. */
const comet = (s = 1): RecipePart[] => [
  { shape: 'blob', radius: 0.45 * s, noise: 0.3, detail: 1, pos: [0, 0.5 * s, 0.4 * s], color: NUCLEUS },
  { shape: 'sphere', radius: 0.6 * s, pos: [0, 0.5 * s, 0.4 * s], scale: [1, 0.6, 1], color: '#eef8ff' },
  { shape: 'cone', radius: 0.45 * s, height: 1.5 * s, pos: [0, 0.45 * s, -0.55 * s], rot: [-Math.PI / 2, 0, 0], scale: [1, 0.4, 1], color: ICE_BLUE },
];

export const SOLAR_DEBRIS: DebrisType[] = [
  // ── Arrival (Bunny r = 0.85 units after the leap; Tier 16 starts at 1) ──────────────
  {
    id: 'voyager_1', name: 'Voyager 1', size: 0.12, mass: 1.0, tiers: [15, 17], area: 'solar_system',
    colors: WHITE,
    recipe: [
      { shape: 'cylinder', radiusTop: 0.5, radiusBottom: 0.3, height: 0.12, pos: [0, 0.55, 0], color: '#eeeeee' },
      { shape: 'box', size: [0.3, 0.22, 0.3], pos: [0, 0.35, 0], color: '#c9a640' },
      { shape: 'box', size: [1.2, 0.04, 0.04], pos: [0.6, 0.35, 0], color: '#9a9a9a' },
      { shape: 'cylinder', radiusTop: 0.07, height: 0.3, pos: [1.15, 0.35, 0], rot: [0, 0, Math.PI / 2], color: '#5b5b5b' },
      { shape: 'box', size: [0.04, 0.04, 1.6], pos: [0, 0.4, -0.8], color: '#b0b0b0' },
    ],
    material: { roughness: 0.45, metalness: 0.45 },
    // A one-off: never spawned, placed once by the generator.
    rooms: {},
  },
  {
    id: 'meteoroid', name: 'Meteoroid', size: 0.11, mass: 1.1, tiers: [15, 16], area: 'solar_system', model: 'asteroid',
    colors: ROCK_TINTS,
    recipe: [rock(1, 0, 0, ROCK_DARK, 0.45)],
    material: { roughness: 1 },
    rooms: { any: 0.6 },
  },
  {
    id: 'asteroid', name: 'Asteroid', size: 0.14, mass: 1.2, tiers: [15, 16], area: 'solar_system',
    colors: ROCK_TINTS,
    recipe: [rock(1), { shape: 'sphere', radius: 0.25, pos: [0.3, 1.45, 0.2], scale: [1, 0.3, 1], color: ROCK_DARK }],
    material: { roughness: 1 },
    rooms: { asteroid_belt: 2.4, inner_orbits: 0.6, outer_orbits: 0.6, kuiper_belt: 0.3, corona: 0.3 },
  },
  {
    id: 'comet_nucleus', name: 'Comet', size: 0.18, mass: 1.1, tiers: [15, 16], area: 'solar_system',
    colors: ICE_TINTS,
    recipe: comet(),
    material: { roughness: 0.7 },
    rooms: { kuiper_belt: 1.6, outer_orbits: 0.7, inner_orbits: 0.35, asteroid_belt: 0.3, corona: 0.4 },
  },
  {
    id: 'moonlet', name: 'Moonlet', size: 0.2, mass: 1.2, tiers: [15, 16], area: 'solar_system',
    colors: ROCK_TINTS,
    recipe: [ball('#a7a39c', 0.08), spot(0.35, 0.2, 0.28, '#7f7b75'), spot(-0.3, -0.35, 0.2, '#7f7b75')],
    material: { roughness: 1 },
    rooms: { inner_orbits: 0.8, outer_orbits: 0.8, asteroid_belt: 0.6, kuiper_belt: 0.3 },
  },
  {
    id: 'asteroid_cluster', name: 'Asteroid Cluster', size: 0.24, mass: 1.3, tiers: [15, 16], area: 'solar_system',
    colors: ROCK_TINTS,
    recipe: [rock(0.55, -0.35, 0.1), rock(0.42, 0.45, -0.25, ROCK_DARK), rock(0.3, 0.3, 0.55), rock(0.22, -0.5, -0.55, ROCK_DARK)],
    material: { roughness: 1 },
    rooms: { asteroid_belt: 2, inner_orbits: 0.4, outer_orbits: 0.4 },
  },
  {
    id: 'kuiper_object', name: 'Kuiper Belt Object', size: 0.27, mass: 1.2, tiers: [15, 16], area: 'solar_system', model: 'icy_moon',
    colors: ['#ffffff', '#e8f0ff', '#f3e6da'],
    recipe: [ball(ICE, 0.18), spot(0.3, 0.3, 0.3, '#c9b8a8')],
    material: { roughness: 0.8 },
    rooms: { kuiper_belt: 1.8, outer_orbits: 0.5 },
  },
  {
    id: 'rubble_pile', name: 'Rubble Pile', size: 0.3, mass: 1.3, tiers: [15, 16], area: 'solar_system', model: 'asteroid_cluster',
    colors: ROCK_TINTS,
    recipe: [rock(0.5, 0.1, 0.1), rock(0.38, -0.5, -0.2, ROCK_DARK), rock(0.35, 0.5, -0.45), rock(0.3, -0.25, 0.6), rock(0.25, 0.6, 0.5, ROCK_DARK)],
    material: { roughness: 1 },
    rooms: { asteroid_belt: 1.4, inner_orbits: 0.3, outer_orbits: 0.3, corona: 0.2 },
  },
  {
    id: 'phobos', name: 'Phobos', size: 0.33, mass: 1.3, tiers: [15, 16], area: 'solar_system', model: 'moonlet',
    colors: ['#ffffff', '#f0e2d4'],
    recipe: [{ shape: 'blob', radius: 1, noise: 0.25, detail: 1, pos: [0, 0.75, 0], scale: [1.25, 0.75, 0.9], color: '#8f8173' }, spot(0.4, 0.1, 0.32, '#6d6156')],
    material: { roughness: 1 },
    rooms: { inner_orbits: 0.6, asteroid_belt: 0.4 },
  },
  // ── Tier 16: Dust Giant (r ≥ 1) ──────────────
  {
    id: 'vesta', name: 'Vesta', size: 0.45, mass: 1.7, tiers: [16, 16], area: 'solar_system', model: 'asteroid',
    colors: ROCK_TINTS,
    recipe: [{ shape: 'blob', radius: 1, noise: 0.18, detail: 2, pos: [0, 0.9, 0], scale: [1, 0.9, 0.95], color: '#9a9187' }, spot(0, 0, 0.5, '#7d756c')],
    material: { roughness: 1 },
    rooms: { asteroid_belt: 1.6, inner_orbits: 0.4 },
  },
  {
    id: 'mercury', name: 'Mercury', size: 0.5, mass: 1.8, tiers: [16, 16], area: 'solar_system', model: 'rocky_planet',
    colors: ['#c9c3ba', '#bdb7af'],
    recipe: [ball(LIGHT, 0.04), spot(0.35, 0.25, 0.3, '#a9a49d'), spot(-0.4, -0.2, 0.22, '#a9a49d'), spot(0.05, -0.5, 0.18, '#a9a49d')],
    material: { roughness: 1 },
    rooms: { corona: 1.0, inner_orbits: 0.6 },
  },
  {
    id: 'io', name: 'Io', size: 0.56, mass: 1.8, tiers: [16, 16], area: 'solar_system', model: 'rocky_planet',
    colors: ['#f2dc78', '#ead06a'],
    recipe: [ball(LIGHT), spot(0.3, 0.3, 0.2, '#b8642c'), spot(-0.35, 0.1, 0.16, '#5a3a20'), spot(0.1, -0.45, 0.18, '#e8e0b0')],
    material: { roughness: 0.9 },
    rooms: { outer_orbits: 0.8 },
  },
  {
    id: 'europa', name: 'Europa', size: 0.62, mass: 1.8, tiers: [16, 16], area: 'solar_system', model: 'icy_moon',
    colors: ['#ffffff', '#f6efe6'],
    recipe: [ball('#ece4d8'), band(1, 1.0, '#b48a6a', 0.025), { shape: 'torus', radius: 0.98, tube: 0.025, pos: [0, 1, 0], rot: [0.9, 0.4, 0], color: '#b48a6a' }],
    material: { roughness: 0.6 },
    rooms: { outer_orbits: 0.8, kuiper_belt: 0.3 },
  },
  {
    id: 'mars', name: 'Mars', size: 0.68, mass: 1.9, tiers: [16, 16], area: 'solar_system',
    colors: ['#ffffff', '#f6e4da'],
    recipe: [ball('#c1532f', 0.03), { shape: 'sphere', radius: 0.35, pos: [0, 1.88, 0], scale: [1, 0.3, 1], color: '#f4f1ec' }, spot(0.45, 0.3, 0.3, '#93391f')],
    material: { roughness: 0.95 },
    rooms: { inner_orbits: 0.6 },
  },
  {
    id: 'great_comet', name: 'Great Comet', size: 0.75, mass: 1.8, tiers: [16, 17], area: 'solar_system', model: 'comet_nucleus',
    colors: ICE_TINTS,
    recipe: comet(),
    material: { roughness: 0.7 },
    rooms: { kuiper_belt: 1.2, outer_orbits: 0.6, inner_orbits: 0.4, corona: 0.5 },
  },
  {
    id: 'ceres', name: 'Ceres', size: 0.78, mass: 2.0, tiers: [16, 16], area: 'solar_system', model: 'moonlet',
    colors: ['#ffffff', '#ece8e2'],
    recipe: [ball('#9c968e', 0.05), spot(0.2, 0.15, 0.12, '#f2f2ee'), spot(-0.4, -0.25, 0.25, '#827c75')],
    material: { roughness: 1 },
    rooms: { asteroid_belt: 1.2 },
  },
  {
    id: 'icy_moon', name: 'Icy Moon', size: 0.85, mass: 2.0, tiers: [16, 17], area: 'solar_system',
    colors: ICE_TINTS,
    recipe: [ball(ICE, 0.05), spot(0.3, -0.2, 0.3, ICE_BLUE), spot(-0.35, 0.3, 0.2, '#c8d8e2')],
    material: { roughness: 0.55 },
    rooms: { outer_orbits: 1, kuiper_belt: 0.8 },
  },
  {
    id: 'ganymede', name: 'Ganymede', size: 0.95, mass: 2.2, tiers: [16, 16], area: 'solar_system', model: 'icy_moon',
    colors: ['#e9ddd0', '#ddd2c4'],
    recipe: [ball('#b6a896', 0.04), spot(0.3, 0.2, 0.42, '#8a7c6c'), spot(-0.35, -0.3, 0.3, '#d8d0c4')],
    material: { roughness: 0.8 },
    rooms: { outer_orbits: 0.8 },
  },
  {
    id: 'titan', name: 'Titan', size: 1.05, mass: 2.3, tiers: [16, 17], area: 'solar_system', model: 'rocky_planet',
    colors: ['#e6a85a', '#dc9f52'],
    recipe: [ball(LIGHT), band(1.25, 0.9, '#f0e0c8', 0.06)],
    material: { roughness: 1 },
    rooms: { outer_orbits: 0.8 },
  },
  {
    id: 'pluto', name: 'Pluto', size: 1.15, mass: 2.3, tiers: [16, 17], area: 'solar_system', model: 'dwarf_planet',
    colors: ['#ffffff', '#f4ece4'],
    recipe: [ball('#c9b29a', 0.04), { shape: 'sphere', radius: 0.42, pos: [0.15, 1.75, 0.45], scale: [1, 0.35, 1.1], color: '#f2ebe2' }, spot(-0.45, -0.1, 0.4, '#7a5a44')],
    material: { roughness: 0.9 },
    rooms: { kuiper_belt: 1.0 },
  },
  {
    id: 'venus', name: 'Venus', size: 1.25, mass: 2.4, tiers: [16, 17], area: 'solar_system',
    colors: ['#ffffff', '#f6ecd6'],
    recipe: [ball('#e8cf8e'), band(1.3, 0.78, '#f4e3b2', 0.08), band(0.75, 0.82, '#d6b678', 0.07)],
    material: { roughness: 0.85 },
    rooms: { inner_orbits: 0.7, corona: 0.4 },
  },
  {
    id: 'dwarf_planet', name: 'Dwarf Planet', size: 1.35, mass: 2.5, tiers: [16, 17], area: 'solar_system',
    colors: ['#ffffff', '#f0f0f6', '#f4ece6'],
    recipe: [ball('#cfc8c2', 0.05), spot(0.3, 0.3, 0.3, '#f2f2f6'), spot(-0.35, -0.2, 0.3, '#9d8f84')],
    material: { roughness: 0.9 },
    rooms: { kuiper_belt: 1.4, outer_orbits: 0.3 },
  },
  // ── Tier 17: Dust Star (r ≥ 3) ──────────────
  {
    id: 'comet_swarm', name: 'Comet Swarm', size: 1.8, mass: 3.1, tiers: [17, 17], area: 'solar_system',
    colors: ICE_TINTS,
    recipe: [
      ...comet(0.55).map((p) => ({ ...p, pos: [p.pos![0] - 0.45, p.pos![1], p.pos![2] + 0.3] as [number, number, number] })),
      ...comet(0.45).map((p) => ({ ...p, pos: [p.pos![0] + 0.5, p.pos![1], p.pos![2] + 0.1] as [number, number, number] })),
      ...comet(0.35).map((p) => ({ ...p, pos: [p.pos![0] + 0.05, p.pos![1], p.pos![2] - 0.5] as [number, number, number] })),
    ],
    material: { roughness: 0.7 },
    rooms: { kuiper_belt: 1.4, outer_orbits: 0.6, inner_orbits: 0.4, corona: 0.3 },
  },
  {
    id: 'uranus', name: 'Uranus', size: 1.9, mass: 3.2, tiers: [17, 17], area: 'solar_system', model: 'ice_giant',
    colors: ['#c8f0f2', '#bfe9ee'],
    recipe: [ball(LIGHT), { shape: 'torus', radius: 1.35, tube: 0.03, pos: [0, 1, 0], rot: [0.15, 0, Math.PI / 2 - 0.1], color: '#9ab8c0' }],
    material: { roughness: 0.6 },
    rooms: { outer_orbits: 0.5, kuiper_belt: 0.4 },
  },
  {
    id: 'asteroid_swarm', name: 'Asteroid Swarm', size: 2.0, mass: 3.2, tiers: [17, 17], area: 'solar_system', model: 'asteroid_cluster',
    colors: ROCK_TINTS,
    recipe: [rock(0.45, -0.4, 0.1), rock(0.38, 0.45, -0.3, ROCK_DARK), rock(0.3, 0.2, 0.6), rock(0.28, -0.55, -0.5, ROCK_DARK), rock(0.22, 0.7, 0.35), rock(0.2, -0.1, -0.7)],
    material: { roughness: 1 },
    rooms: { asteroid_belt: 2.0, inner_orbits: 0.5, outer_orbits: 0.4 },
  },
  {
    id: 'neptune', name: 'Neptune', size: 2.05, mass: 3.3, tiers: [17, 17], area: 'solar_system', model: 'ice_giant',
    colors: ['#7aa6f0', '#6f9aea'],
    recipe: [ball(LIGHT), band(1.25, 0.88, '#e8f0ff', 0.04), spot(0.4, 0.4, 0.2, '#30448a')],
    material: { roughness: 0.6 },
    rooms: { outer_orbits: 0.4, kuiper_belt: 0.5 },
  },
  {
    id: 'saturn', name: 'Saturn', size: 2.3, mass: 3.5, tiers: [17, 17], area: 'solar_system',
    colors: WHITE,
    recipe: [
      { shape: 'sphere', radius: 0.62, pos: [0, 0.62, 0], color: '#e3c78f' },
      band(0.75, 0.55, '#cfae74', 0.05),
      { shape: 'torus', radius: 0.95, tube: 0.2, pos: [0, 0.62, 0], rot: [Math.PI / 2, 0, 0], scale: [1, 1, 0.12], color: '#d8c08e' },
      { shape: 'torus', radius: 0.72, tube: 0.08, pos: [0, 0.62, 0], rot: [Math.PI / 2, 0, 0], scale: [1, 1, 0.12], color: '#b39a6c' },
    ],
    material: { roughness: 0.75 },
    rooms: { outer_orbits: 0.4, inner_orbits: 0.2 },
  },
  {
    id: 'jupiter', name: 'Jupiter', size: 2.4, mass: 3.8, tiers: [17, 17], area: 'solar_system',
    colors: WHITE,
    recipe: [
      ball('#d8b48a'),
      band(1.35, 0.9, '#b98a62', 0.08),
      band(1.0, 1.0, '#c99a6c', 0.07),
      band(0.65, 0.92, '#b98a62', 0.08),
      { shape: 'sphere', radius: 0.2, pos: [0.45, 0.8, 0.84], scale: [1.4, 0.7, 0.5], color: '#b5532f' },
    ],
    material: { roughness: 0.75 },
    // A one-off placed by the generator on its orbit; an Obstacle until Tier 17.
    rooms: {},
    lockedUntilTier: 17,
  },
  {
    id: 'rogue_planet', name: 'Rogue Planet', size: 2.6, mass: 3.6, tiers: [17, 17], area: 'solar_system', model: 'rocky_planet',
    colors: ['#a8a2b8', '#b4a89c'],
    recipe: [ball(LIGHT, 0.04), spot(0.35, 0.3, 0.3, '#9a96a0'), spot(-0.3, -0.35, 0.35, '#9a96a0')],
    material: { roughness: 1 },
    rooms: { kuiper_belt: 0.8, outer_orbits: 0.6, inner_orbits: 0.5, asteroid_belt: 0.4, corona: 0.3 },
  },
  {
    id: 'ring_arc', name: "A Slice of Saturn's Rings", size: 2.8, mass: 3.6, tiers: [17, 17], area: 'solar_system',
    colors: ['#ffffff', '#f4ead8'],
    recipe: [
      { shape: 'torus', radius: 0.85, tube: 0.18, arc: 2.2, pos: [0, 0.06, 0.4], rot: [Math.PI / 2, 0, 0.5], scale: [1, 1, 0.15], color: '#dcc8a0' },
      { shape: 'torus', radius: 0.62, tube: 0.08, arc: 2.2, pos: [0, 0.06, 0.4], rot: [Math.PI / 2, 0, 0.5], scale: [1, 1, 0.15], color: '#b8a07a' },
      rock(0.12, 0.6, -0.1, '#e8dcc4', 0.3),
      rock(0.1, -0.45, 0.1, '#e8dcc4', 0.3),
    ],
    material: { roughness: 0.8 },
    rooms: { outer_orbits: 0.6, asteroid_belt: 0.4 },
  },
  {
    id: 'leftover_dust', name: 'Leftover Dust', size: 3.1, mass: 3.9, tiers: [17, 17], area: 'solar_system',
    colors: ['#ffffff', '#f4ece6', '#ece6f4'],
    recipe: [
      { shape: 'blob', radius: 1, noise: 0.35, detail: 2, pos: [0, 0.1, 0], scale: [1, 0.14, 0.85], color: '#b9a99a' },
      { shape: 'blob', radius: 0.6, noise: 0.4, detail: 1, pos: [0.35, 0.15, -0.2], scale: [1, 0.2, 0.9], color: '#cfc2b4' },
      { shape: 'blob', radius: 0.35, noise: 0.4, detail: 1, pos: [-0.5, 0.15, 0.4], scale: [1, 0.25, 0.9], color: '#a8988a' },
    ],
    material: { roughness: 1 },
    rooms: { inner_orbits: 0.7, kuiper_belt: 0.7, outer_orbits: 0.5, corona: 0.6, asteroid_belt: 0.3 },
  },
];
