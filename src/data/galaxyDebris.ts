/**
 * Galaxy Debris (area 'galaxy'), Tiers 17–19. Same format as DEBRIS_TYPES in debris.ts, but sizes
 * are in Galaxy units (1 = 100 ly, `AREAS.galaxy.unit`). The ladder repeats the Solar System's
 * shape (both Acts arrive at 0.85 units and end past ≈4): Tier 17 types (0.11–0.33) feed the
 * arrival size (absorbable up to ≈0.6): cosmic lint, red and brown dwarfs, comet clouds, rogue
 * planets, white dwarfs, binary stars and a sock; Tier 18 types (0.45–1.35) the Dust Nebula:
 * sun-like stars, Bok globules, planetary nebulae, blue giants, lint clouds, dark nebulae, red
 * giants, open clusters, Oort clouds, a sock nebula and blue supergiants; Tier 19 types (1.8–3.1)
 * the Dust Cluster: red supergiants, emission nebulae, supergiant binaries, stellar nurseries,
 * molecular clouds, yellow hypergiants, star clusters and interstellar lint. Stars, clusters and nebulae are drawn at play size, not to scale.
 * Room weights use the galaxy zone types (galactic_core, bar, inner_arms, dust_lanes, outer_arms,
 * halo): the arms lean on young stars and clusters, the dust lanes on dark clouds, lint and socks,
 * the core and the bar on old red stars and star clusters, the halo on stragglers (comet clouds,
 * rogue planets, white dwarfs).
 *
 * Every type renders a Galaxy Blender prop (public/models: by id or `model`; several types reuse
 * one prop at another size, tinted with `tintAll`) and is self-lit: `material.glow` adds each
 * part's own emission (baked per vertex, src/entities/debrisGeometry.ts), so the stars' cores,
 * rays and halos and the nebulae's rims glow in their own colours. The recipes are the headless /
 * no-model fallback, glowing in the type's main colour (`emissive`).
 *
 * Star clusters (`star_cluster`, 2.8: absorbable from r = 4, about when Sagittarius A* is) stun
 * Sagittarius A*; besides the spawner's weights (heaviest in the galactic core and the bar), the
 * map places `GALAXY.coreClusters` of them round the core (src/world/galaxy.ts). `open_cluster`
 * is the Tier 18 cluster. `relativistic_jet` is the boss's chip (no room weights: only the boss
 * places it, sized like any boss chip).
 *
 * One-offs placed by the map: a rogue planet (`free_floating_planet`) and a sock (`space_sock`)
 * a few units from the spawn, on screen at arrival; the rogue planet has its own narrator line
 * (`STORY.debris.free_floating_planet`), the sock is the Tier 18 line's.
 */
import type { DebrisType, RecipePart } from './debris';

const WHITE = ['#ffffff'];

/** A glowing ball resting on the floor (radius 1 at y = 1). */
const star = (color: string, r = 1): RecipePart => ({ shape: 'sphere', radius: r, pos: [0, r, 0], color });
/** A soft lumpy cloud lying low (nebulae, dust clouds). */
const cloud = (color: string, x = 0, z = 0, r = 1): RecipePart => ({ shape: 'blob', radius: r, noise: 0.45, detail: 1, pos: [x, r * 0.5, z], scale: [1, 0.45, 1], color });
/** A ball of `n` stars within radius 1 (clusters). */
const cluster = (n: number, color: string): RecipePart[] =>
  Array.from({ length: n }, (_, i) => {
    const r = 0.8 * Math.cbrt((i + 0.5) / n);
    const a = i * 2.39996;
    const y = ((i * 0.618) % 1) * 2 - 1;
    const k = Math.sqrt(1 - y * y);
    return { shape: 'sphere', radius: 0.12 + (i % 3) * 0.05, pos: [Math.cos(a) * k * r, 1 + y * r * 0.8, Math.sin(a) * k * r], color } satisfies RecipePart;
  });
/** A flat ring lying on the floor (planetary nebulae, comet clouds). */
const ring = (color: string, r = 0.8, tube = 0.2): RecipePart => ({ shape: 'torus', radius: r, tube, pos: [0, 0.3, 0], rot: [Math.PI / 2, 0, 0], scale: [1, 1, 0.4], color });
/** A lint clump: a fuzzy lumpy ball. */
const lint = (color: string): RecipePart => ({ shape: 'blob', radius: 0.8, noise: 0.35, detail: 2, pos: [0, 0.8, 0], color });
/** A sock lying flat. */
const sock: RecipePart[] = [
  { shape: 'capsule', radius: 0.28, length: 1.2, pos: [0, 0.28, 0], rot: [Math.PI / 2, 0, 0], color: '#d84a8a' },
  { shape: 'capsule', radius: 0.26, length: 0.5, pos: [0.45, 0.27, 0.65], rot: [0, 0, Math.PI / 2], color: '#4ac8e8' },
];

/** How strongly the props' own emission shows (× each type's `glow` factor): enough to glow, not so much that every star tone-maps to white. */
const GLOW = 0.38;
/** Self-lit (stars, clusters, glowing nebulae): own emission, a fallback glow in the main colour. */
const lit = (main: string, glow = 1, fallback = 0.6) => ({ roughness: 0.6, glow: GLOW * glow, emissive: main, emissiveIntensity: fallback });

export const GALAXY_DEBRIS: DebrisType[] = [
  // ── Arrival (Bunny r = 0.85 units after the leap; Tier 18 starts at 1) ──────────────
  {
    id: 'cosmic_lint', name: 'Cosmic Lint', size: 0.11, mass: 1.26, tiers: [17, 18], area: 'galaxy',
    colors: WHITE,
    recipe: [lint('#b8a8d0')],
    material: lit('#c8a8e8', 1, 0.25),
    rooms: { dust_lanes: 1.6, inner_arms: 0.6, outer_arms: 0.6, halo: 0.6, bar: 0.3 },
  },
  {
    id: 'red_dwarf', name: 'Red Dwarf', size: 0.13, mass: 1.38, tiers: [17, 18], area: 'galaxy',
    colors: WHITE,
    recipe: [star('#ff5a3a')],
    material: lit('#ff4a2a'),
    rooms: { inner_arms: 1.6, outer_arms: 1.6, bar: 1, galactic_core: 0.8, halo: 1, dust_lanes: 0.6 },
  },
  {
    id: 'brown_dwarf', name: 'Brown Dwarf', size: 0.16, mass: 1.3, tiers: [17, 18], area: 'galaxy',
    colors: WHITE,
    recipe: [star('#8a4a3a'), { shape: 'torus', radius: 0.95, tube: 0.06, pos: [0, 1.05, 0], rot: [Math.PI / 2, 0, 0], color: '#a8644c' }],
    material: lit('#7a3a3a', 1, 0.2),
    rooms: { dust_lanes: 1.4, halo: 1, inner_arms: 0.6, outer_arms: 0.6 },
  },
  {
    id: 'comet_cloud', name: 'Comet Cloud', size: 0.19, mass: 1.3, tiers: [17, 18], area: 'galaxy',
    colors: WHITE,
    recipe: [ring('#bfe3ff', 0.8, 0.12), ...cluster(6, '#e8f6ff')],
    material: lit('#9ad8ff', 1, 0.3),
    rooms: { halo: 1.6, outer_arms: 0.9, dust_lanes: 0.6, inner_arms: 0.3 },
  },
  {
    id: 'free_floating_planet', name: 'Rogue Planet', size: 0.22, mass: 1.45, tiers: [17, 18], area: 'galaxy', model: 'rogue_planet',
    colors: WHITE,
    recipe: [{ shape: 'blob', radius: 1, noise: 0.15, detail: 2, pos: [0, 1, 0], color: '#3c4a66' }],
    material: lit('#4a6aa8', 1, 0.15),
    rooms: { halo: 1.4, dust_lanes: 1.1, outer_arms: 0.7, inner_arms: 0.4 },
  },
  {
    id: 'white_dwarf', name: 'White Dwarf', size: 0.25, mass: 1.45, tiers: [17, 18], area: 'galaxy',
    colors: WHITE,
    recipe: [star('#f4f8ff', 0.4), ring('#cfe0ff', 0.7, 0.06)],
    material: lit('#e8f0ff'),
    rooms: { galactic_core: 1.2, bar: 1, inner_arms: 0.8, outer_arms: 0.8, halo: 0.6 },
  },
  {
    id: 'binary_star', name: 'Binary Star', size: 0.29, mass: 1.5, tiers: [17, 18], area: 'galaxy',
    colors: WHITE,
    recipe: [
      { shape: 'sphere', radius: 0.55, pos: [-0.45, 0.8, 0], color: '#fff1c8' },
      { shape: 'sphere', radius: 0.4, pos: [0.55, 0.8, 0], color: '#9ac8ff' },
    ],
    material: lit('#fff0c8'),
    rooms: { inner_arms: 1.4, outer_arms: 1.4, bar: 0.9, galactic_core: 0.7 },
  },
  {
    id: 'space_sock', name: 'Space Sock', size: 0.33, mass: 1.5, tiers: [17, 18], area: 'galaxy',
    colors: WHITE,
    recipe: sock,
    material: lit('#d84a8a', 1, 0.15),
    rooms: { dust_lanes: 0.7, halo: 0.3, inner_arms: 0.2, outer_arms: 0.2 },
  },
  // ── Tier 18: Dust Nebula (r ≥ 1) ──────────────
  {
    id: 'sun_like_star', name: 'Sun-like Star', size: 0.45, mass: 2.31, tiers: [18, 18], area: 'galaxy', model: 'yellow_star',
    colors: WHITE,
    recipe: [star('#ffe27a')],
    material: lit('#ffd24a'),
    rooms: { inner_arms: 1.4, outer_arms: 1.4, bar: 0.8, galactic_core: 0.5, halo: 0.4 },
  },
  {
    id: 'bok_globule', name: 'Bok Globule', size: 0.5, mass: 2.31, tiers: [18, 18], area: 'galaxy', model: 'dark_nebula',
    colors: ['#ffd0e0'],
    recipe: [cloud('#2a2030'), cloud('#3a2c40', -0.5, 0.4, 0.6)],
    material: { ...lit('#ff6a4a', 0.8, 0.12), tintAll: true },
    rooms: { dust_lanes: 1.8, inner_arms: 0.3, outer_arms: 0.3 },
  },
  {
    id: 'planetary_nebula', name: 'Planetary Nebula', size: 0.57, mass: 2.42, tiers: [18, 18], area: 'galaxy',
    colors: WHITE,
    recipe: [ring('#6ad8c8'), { shape: 'sphere', radius: 0.15, pos: [0, 0.3, 0], color: '#f4fbff' }],
    material: lit('#4ad8c8'),
    rooms: { inner_arms: 0.8, outer_arms: 0.8, galactic_core: 0.7, bar: 0.5, halo: 0.4 },
  },
  {
    id: 'blue_giant', name: 'Blue Giant', size: 0.66, mass: 2.53, tiers: [18, 18], area: 'galaxy',
    colors: WHITE,
    recipe: [star('#8ab8ff')],
    material: lit('#7aa8ff'),
    rooms: { inner_arms: 1.2, outer_arms: 1 },
  },
  {
    id: 'lint_cloud', name: 'Lint Cloud', size: 0.75, mass: 2.53, tiers: [18, 18], area: 'galaxy', model: 'cosmic_lint',
    colors: ['#e8dcff'],
    recipe: [lint('#a898c8'), cloud('#8a6aa8', 0.4, 0.3, 0.7)],
    material: { ...lit('#c8a8e8', 1, 0.25), tintAll: true },
    rooms: { dust_lanes: 1.4, halo: 0.5, inner_arms: 0.3, outer_arms: 0.3 },
  },
  {
    id: 'dark_nebula', name: 'Dark Nebula', size: 0.85, mass: 2.75, tiers: [18, 18], area: 'galaxy',
    colors: WHITE,
    recipe: [cloud('#2a2030'), cloud('#3a2c40', -0.5, 0.4, 0.7), cloud('#33283a', 0.6, -0.3, 0.6)],
    material: lit('#ff5a3a', 1, 0.12),
    rooms: { dust_lanes: 1.6, inner_arms: 0.3 },
  },
  {
    id: 'red_giant', name: 'Red Giant', size: 0.95, mass: 2.9, tiers: [18, 18], area: 'galaxy',
    colors: WHITE,
    recipe: [star('#ff7a4a')],
    material: lit('#ff6a2a'),
    rooms: { galactic_core: 1.4, bar: 1.2, inner_arms: 0.6, outer_arms: 0.4, halo: 0.5 },
  },
  {
    id: 'open_cluster', name: 'Open Cluster', size: 1.05, mass: 2.9, tiers: [18, 18], area: 'galaxy', model: 'open_star_cluster',
    colors: WHITE,
    recipe: cluster(14, '#cfe0ff'),
    material: lit('#a8c8ff'),
    rooms: { inner_arms: 1, outer_arms: 1, bar: 0.3 },
  },
  {
    id: 'oort_cloud', name: 'Oort Cloud', size: 1.15, mass: 2.7, tiers: [18, 19], area: 'galaxy', model: 'comet_cloud',
    colors: ['#e0f0ff'],
    recipe: [ring('#bfe3ff', 0.85, 0.1), ...cluster(10, '#e8f6ff')],
    material: { ...lit('#9ad8ff', 1, 0.3), tintAll: true },
    rooms: { halo: 1.4, outer_arms: 0.6, dust_lanes: 0.4 },
  },
  {
    id: 'sock_nebula', name: 'Sock Nebula', size: 1.25, mass: 2.8, tiers: [18, 19], area: 'galaxy', model: 'space_sock',
    colors: ['#ffe0f4'],
    recipe: sock,
    material: { ...lit('#d84a8a', 1, 0.2), tintAll: true },
    rooms: { dust_lanes: 0.5, halo: 0.3 },
  },
  {
    id: 'blue_supergiant', name: 'Blue Supergiant', size: 1.35, mass: 2.9, tiers: [18, 19], area: 'galaxy', model: 'blue_giant',
    colors: ['#dce8ff'],
    recipe: [star('#9ac0ff')],
    material: { ...lit('#8ab0ff', 1.2), tintAll: true },
    rooms: { inner_arms: 1, outer_arms: 0.9, bar: 0.5 },
  },
  // ── Tier 19: Dust Cluster (r ≥ 3) ──────────────
  {
    id: 'red_supergiant', name: 'Red Supergiant', size: 1.8, mass: 3.9, tiers: [19, 19], area: 'galaxy', model: 'red_giant',
    colors: ['#ffc8b8'],
    recipe: [star('#ff6a3a')],
    material: { ...lit('#ff5a2a', 1.15), tintAll: true },
    rooms: { galactic_core: 1, bar: 1, inner_arms: 0.6, outer_arms: 0.5, halo: 0.3 },
  },
  {
    id: 'supergiant_binary', name: 'Supergiant Binary', size: 2.15, mass: 4.1, tiers: [19, 19], area: 'galaxy', model: 'binary_star',
    colors: ['#f0f0ff'],
    recipe: [
      { shape: 'sphere', radius: 0.55, pos: [-0.45, 0.8, 0], color: '#fff1c8' },
      { shape: 'sphere', radius: 0.4, pos: [0.55, 0.8, 0], color: '#9ac8ff' },
    ],
    material: { ...lit('#fff0c8', 1.1), tintAll: true },
    rooms: { inner_arms: 0.6, outer_arms: 0.5, bar: 0.4, galactic_core: 0.3 },
  },
  {
    id: 'yellow_hypergiant', name: 'Yellow Hypergiant', size: 2.6, mass: 4.4, tiers: [19, 19], area: 'galaxy', model: 'yellow_star',
    colors: ['#ffe8c8'],
    recipe: [star('#ffd27a')],
    material: { ...lit('#ffc24a', 1.1), tintAll: true },
    rooms: { galactic_core: 0.5, bar: 0.5, inner_arms: 0.4, outer_arms: 0.3 },
  },
  {
    id: 'emission_nebula', name: 'Emission Nebula', size: 2.0, mass: 4, tiers: [19, 19], area: 'galaxy',
    colors: WHITE,
    recipe: [cloud('#d85a9a'), cloud('#9a5ad8', 0.6, 0.4, 0.7), cloud('#ff8ab8', -0.5, -0.3, 0.6)],
    material: lit('#e84a9a'),
    rooms: { inner_arms: 0.5, outer_arms: 0.45, dust_lanes: 0.2 },
  },
  {
    id: 'stellar_nursery', name: 'Stellar Nursery', size: 2.3, mass: 4.2, tiers: [19, 19], area: 'galaxy', model: 'emission_nebula',
    colors: ['#e0d0ff'],
    recipe: [cloud('#6a4a9a'), ...cluster(8, '#e8f4ff')],
    material: { ...lit('#a85ae8'), tintAll: true },
    rooms: { inner_arms: 0.35, outer_arms: 0.35, dust_lanes: 0.2 },
  },
  {
    id: 'molecular_cloud', name: 'Molecular Cloud', size: 2.5, mass: 4.3, tiers: [19, 19], area: 'galaxy', model: 'dark_nebula',
    colors: ['#d8d0ff'],
    recipe: [cloud('#3a3048'), cloud('#4a3a58', 0.6, 0.5, 0.75), cloud('#30283c', -0.6, -0.4, 0.7)],
    material: { ...lit('#c85aff', 0.9, 0.12), tintAll: true },
    rooms: { dust_lanes: 0.6 },
  },
  {
    id: 'star_cluster', name: 'Star Cluster', size: 2.8, mass: 4.6, tiers: [19, 19], area: 'galaxy',
    colors: WHITE,
    recipe: cluster(24, '#fff1c8'),
    material: lit('#ffe08a', 1.1),
    rooms: { galactic_core: 2.2, bar: 1.6, inner_arms: 0.5, outer_arms: 0.4, halo: 0.3 },
  },
  {
    id: 'interstellar_lint', name: 'Interstellar Lint', size: 3.1, mass: 4.9, tiers: [19, 19], area: 'galaxy', model: 'cosmic_lint',
    colors: ['#f0e4ff'],
    recipe: [lint('#b8a8d0'), cloud('#8a6aa8', 0.5, 0.4, 0.75)],
    material: { ...lit('#c8a8e8', 1, 0.25), tintAll: true },
    rooms: { dust_lanes: 0.8, halo: 0.5, inner_arms: 0.3, outer_arms: 0.3 },
  },
  // ── Sagittarius A*'s chips ──────────────
  {
    id: 'relativistic_jet', name: 'Relativistic Jet', size: 1.4, mass: 2.2, tiers: [19, 19], area: 'galaxy',
    colors: ['#e6d8ff', '#cfe0ff', '#ffffff'],
    recipe: [
      { shape: 'cone', radius: 0.35, height: 1.8, pos: [0, 0.35, 0], rot: [-Math.PI / 2, 0, 0], color: '#c9b8ff' },
      { shape: 'sphere', radius: 0.25, pos: [0, 0.35, -0.9], color: '#f4f0ff' },
    ],
    material: { ...lit('#b49cff'), tintAll: true },
    // A chip: only Sagittarius A* places it.
    rooms: {},
  },
];
