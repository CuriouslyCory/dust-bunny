/**
 * Galaxy Debris (area 'galaxy'), Tiers 17–19. Same format as DEBRIS_TYPES in debris.ts, but sizes
 * are in Galaxy units (1 = 100 ly, `AREAS.galaxy.unit`). The ladder repeats the Solar System's
 * shape (both Acts arrive at 0.85 units and end past ≈4): Tier 17 types (0.1–0.32) feed the
 * arrival size (absorbable up to ≈0.6): red dwarfs, brown dwarfs, rogue planets, protostars,
 * binary stars and dust clouds; Tier 18 types (0.45–1.3) the Dust Nebula: sun-like stars, orange
 * dwarfs, planetary nebulae, dark nebulae, blue and red giants, open clusters; Tier 19 types
 * (1.8–3.1) the Dust Cluster: supergiants, star clusters, emission nebulae, molecular clouds and
 * stellar nurseries. Stars, clusters and nebulae are drawn at play size, not to scale.
 * Room weights use the galaxy zone types (galactic_core, bar, inner_arms, dust_lanes, outer_arms,
 * halo): the arms lean on stars and clusters, the dust lanes on clouds and nebulae, the core on
 * old giants, the halo on stragglers.
 *
 * Star clusters (`star_cluster`, `open_cluster`) stun Sagittarius A*'s charges while the Bunny
 * can't absorb them (SAGITTARIUS_A.giants, the Sun's giant-planet stun); `relativistic_jet` is its
 * chip (no room weights: only the boss places it, sized like any boss chip).
 *
 * Placeholder ladder (Act 8 groundwork): recipes only, no models yet; the world pass replaces it.
 */
import type { DebrisType, RecipePart } from './debris';

const STAR_TINTS = ['#ffffff', '#fff4e0', '#ffe9d0'];
const WHITE = ['#ffffff'];

/** A glowing ball resting on the floor (radius 1 at y = 1). Debris rendering ignores emission: bright base colours carry the glow. */
const star = (color: string): RecipePart => ({ shape: 'sphere', radius: 1, pos: [0, 1, 0], color });
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

export const GALAXY_DEBRIS: DebrisType[] = [
  // ── Arrival (Bunny r = 0.85 units after the leap; Tier 18 starts at 1) ──────────────
  {
    id: 'red_dwarf', name: 'Red Dwarf', size: 0.12, mass: 1.2, tiers: [17, 18], area: 'galaxy',
    colors: STAR_TINTS,
    recipe: [star('#ff6a4a')],
    rooms: { inner_arms: 1.6, outer_arms: 1.6, dust_lanes: 0.8, bar: 0.8, galactic_core: 0.6, halo: 1.2 },
  },
  {
    id: 'brown_dwarf', name: 'Brown Dwarf', size: 0.14, mass: 1.1, tiers: [17, 18], area: 'galaxy',
    colors: STAR_TINTS,
    recipe: [star('#8a4a3a'), { shape: 'torus', radius: 0.95, tube: 0.06, pos: [0, 1.05, 0], rot: [Math.PI / 2, 0, 0], color: '#a8644c' }],
    rooms: { dust_lanes: 1.4, outer_arms: 0.8, inner_arms: 0.6, halo: 0.8 },
  },
  {
    id: 'free_floating_planet', name: 'Rogue Planet', size: 0.18, mass: 1.3, tiers: [17, 18], area: 'galaxy',
    colors: ['#ffffff', '#e2e8ee'],
    recipe: [{ shape: 'blob', radius: 1, noise: 0.15, detail: 2, pos: [0, 1, 0], color: '#4c5a66' }],
    rooms: { dust_lanes: 1.2, halo: 1.4, outer_arms: 0.8, inner_arms: 0.5 },
  },
  {
    id: 'protostar', name: 'Protostar', size: 0.22, mass: 1.1, tiers: [17, 18], area: 'galaxy',
    colors: WHITE,
    recipe: [star('#ffcf9a'), { shape: 'torus', radius: 1.4, tube: 0.25, pos: [0, 1, 0], rot: [Math.PI / 2, 0, 0], scale: [1, 1, 0.3], color: '#a86a4a' }],
    rooms: { dust_lanes: 1.4, inner_arms: 1, outer_arms: 1 },
  },
  {
    id: 'binary_star', name: 'Binary Star', size: 0.26, mass: 1.3, tiers: [17, 18], area: 'galaxy',
    colors: STAR_TINTS,
    recipe: [
      { shape: 'sphere', radius: 0.55, pos: [-0.45, 0.8, 0], color: '#fff1c8' },
      { shape: 'sphere', radius: 0.4, pos: [0.55, 0.8, 0], color: '#ff9a6a' },
    ],
    rooms: { inner_arms: 1.2, outer_arms: 1.2, bar: 0.8, galactic_core: 0.6 },
  },
  {
    id: 'dust_cloud', name: 'Dust Cloud', size: 0.32, mass: 1.0, tiers: [17, 18], area: 'galaxy',
    colors: ['#ffffff', '#efe6f6'],
    recipe: [cloud('#5a4a6a'), cloud('#6a5a7a', 0.5, 0.3, 0.6)],
    rooms: { dust_lanes: 2.2, inner_arms: 0.6, outer_arms: 0.6 },
  },
  // ── Tier 18: Dust Nebula (r ≥ 1) ──────────────
  {
    id: 'orange_dwarf', name: 'Orange Dwarf', size: 0.45, mass: 1.6, tiers: [18, 19], area: 'galaxy',
    colors: STAR_TINTS,
    recipe: [star('#ffa64a')],
    rooms: { inner_arms: 1.2, outer_arms: 1.2, bar: 0.8, halo: 0.6 },
  },
  {
    id: 'sun_like_star', name: 'Sun-like Star', size: 0.5, mass: 1.7, tiers: [18, 19], area: 'galaxy',
    colors: STAR_TINTS,
    recipe: [star('#ffe27a')],
    rooms: { inner_arms: 1.4, outer_arms: 1.4, bar: 0.6 },
  },
  {
    id: 'planetary_nebula', name: 'Planetary Nebula', size: 0.7, mass: 1.6, tiers: [18, 19], area: 'galaxy',
    colors: ['#ffffff', '#e8f8f4'],
    recipe: [
      { shape: 'torus', radius: 0.8, tube: 0.25, pos: [0, 0.5, 0], rot: [Math.PI / 2, 0, 0], scale: [1, 1, 0.5], color: '#6ad8c8' },
      { shape: 'sphere', radius: 0.15, pos: [0, 0.5, 0], color: '#f4fbff' },
    ],
    rooms: { inner_arms: 0.8, outer_arms: 0.8, galactic_core: 0.6 },
  },
  {
    id: 'blue_giant', name: 'Blue Giant', size: 0.9, mass: 2.1, tiers: [18, 19], area: 'galaxy',
    colors: STAR_TINTS,
    recipe: [star('#8ab8ff')],
    rooms: { inner_arms: 1, outer_arms: 0.8 },
  },
  {
    id: 'dark_nebula', name: 'Dark Nebula', size: 1.0, mass: 1.8, tiers: [18, 19], area: 'galaxy',
    colors: ['#ffffff', '#ece4f0'],
    recipe: [cloud('#2a2030'), cloud('#3a2c40', -0.5, 0.4, 0.7), cloud('#33283a', 0.6, -0.3, 0.6)],
    rooms: { dust_lanes: 1.8, inner_arms: 0.3 },
  },
  {
    id: 'red_giant', name: 'Red Giant', size: 1.1, mass: 2.2, tiers: [18, 19], area: 'galaxy',
    colors: STAR_TINTS,
    recipe: [star('#ff7a4a')],
    rooms: { galactic_core: 1.4, bar: 1.2, inner_arms: 0.6, halo: 0.6 },
  },
  {
    id: 'open_cluster', name: 'Open Cluster', size: 1.3, mass: 2.5, tiers: [18, 19], area: 'galaxy',
    colors: STAR_TINTS,
    recipe: cluster(14, '#cfe0ff'),
    rooms: { inner_arms: 0.9, outer_arms: 0.9 },
  },
  // ── Tier 19: Dust Cluster (r ≥ 3) ──────────────
  {
    id: 'supergiant', name: 'Supergiant', size: 1.8, mass: 3.0, tiers: [19, 19], area: 'galaxy',
    colors: STAR_TINTS,
    recipe: [star('#ff9a5a')],
    rooms: { inner_arms: 0.7, outer_arms: 0.5, bar: 0.6, galactic_core: 0.8 },
  },
  {
    id: 'star_cluster', name: 'Star Cluster', size: 2.1, mass: 3.4, tiers: [19, 19], area: 'galaxy',
    colors: STAR_TINTS,
    recipe: cluster(24, '#fff1c8'),
    rooms: { inner_arms: 0.6, outer_arms: 0.5, galactic_core: 0.5, halo: 0.4 },
  },
  {
    id: 'emission_nebula', name: 'Emission Nebula', size: 2.4, mass: 3.2, tiers: [19, 19], area: 'galaxy',
    colors: ['#ffffff', '#ffe8f4'],
    recipe: [cloud('#d85a9a'), cloud('#9a5ad8', 0.6, 0.4, 0.7), cloud('#ff8ab8', -0.5, -0.3, 0.6)],
    rooms: { inner_arms: 0.6, outer_arms: 0.6, dust_lanes: 0.4 },
  },
  {
    id: 'molecular_cloud', name: 'Molecular Cloud', size: 2.8, mass: 3.6, tiers: [19, 19], area: 'galaxy',
    colors: ['#ffffff', '#eae2f2'],
    recipe: [cloud('#3a3048'), cloud('#4a3a58', 0.6, 0.5, 0.75), cloud('#30283c', -0.6, -0.4, 0.7)],
    rooms: { dust_lanes: 0.9, inner_arms: 0.2 },
  },
  {
    id: 'stellar_nursery', name: 'Stellar Nursery', size: 3.1, mass: 3.9, tiers: [19, 19], area: 'galaxy',
    colors: ['#ffffff', '#f2e8ff'],
    recipe: [cloud('#6a4a9a'), ...cluster(8, '#e8f4ff')],
    rooms: { inner_arms: 0.4, outer_arms: 0.4, dust_lanes: 0.3 },
  },
  // ── Sagittarius A*'s chips ──────────────
  {
    id: 'relativistic_jet', name: 'Relativistic Jet', size: 1.4, mass: 2.2, tiers: [19, 19], area: 'galaxy',
    colors: ['#e6d8ff', '#cfe0ff', '#ffffff'],
    recipe: [
      { shape: 'cone', radius: 0.35, height: 1.8, pos: [0, 0.35, 0], rot: [-Math.PI / 2, 0, 0], color: '#c9b8ff' },
      { shape: 'sphere', radius: 0.25, pos: [0, 0.35, -0.9], color: '#f4f0ff' },
    ],
    // A chip: only Sagittarius A* places it.
    rooms: {},
  },
];
