/**
 * Solar System Debris (area 'solar_system'), Tiers 15–17. Same format as DEBRIS_TYPES in
 * debris.ts, but sizes are in Solar System units (1 = 0.01 AU, `AREAS.solar_system.unit`). The
 * ladder repeats the Globe's shape (both Acts arrive at 0.85 units and end past ≈4): Tier 15 types
 * feed the arrival size, Tier 16 types the Dust Giant, Tier 17 types the Dust Star. Planets and
 * moons are drawn at play size, not to scale. Room weights use the solar zone types (corona,
 * inner_orbits, asteroid_belt, outer_orbits, kuiper_belt).
 *
 * Jupiter (`jupiter`) is `lockedUntilTier: 17`: an Obstacle until Tier 17, then Debris the Bunny
 * can absorb from r ≈ 3.4. Voyager 1 (`voyager_1`) is a one-off placed by the generator, with its
 * own narrator line (`STORY.debris`).
 *
 * Placeholder ladder (Act 7 groundwork): the world pass replaces it.
 */
import type { DebrisType } from './debris';

const ROCK = '#8d8378';
const ROCK_TINTS = ['#ffffff', '#e6ded4', '#cfc6bb'];
const ICE = '#d8ecf5';

export const SOLAR_DEBRIS: DebrisType[] = [
  // ── Tier 15: arrival (r ≈ 0.85) ──────────────
  {
    id: 'voyager_1', name: 'Voyager 1', size: 0.12, mass: 1.0, tiers: [15, 17], area: 'solar_system',
    colors: ['#ffffff'],
    recipe: [
      { shape: 'cylinder', radiusTop: 0.5, height: 0.2, pos: [0, 0.4, 0], color: '#e8e8e8' },
      { shape: 'box', size: [0.25, 0.25, 0.25], pos: [0, 0.2, 0], color: '#c9a640' },
      { shape: 'box', size: [1.4, 0.04, 0.04], pos: [0.5, 0.2, 0], color: '#9a9a9a' },
    ],
    // A one-off: never spawned, placed once by the generator.
    rooms: {},
  },
  {
    id: 'asteroid', name: 'Asteroid', size: 0.15, mass: 1.2, tiers: [15, 16], area: 'solar_system',
    colors: ROCK_TINTS,
    recipe: [{ shape: 'blob', radius: 1, noise: 0.35, detail: 1, pos: [0, 0.8, 0], scale: [1, 0.8, 0.9], color: ROCK }],
    rooms: { asteroid_belt: 2.4, inner_orbits: 0.6, outer_orbits: 0.5, kuiper_belt: 0.4, corona: 0.3 },
  },
  {
    id: 'comet_nucleus', name: 'Comet', size: 0.25, mass: 1.1, tiers: [15, 16], area: 'solar_system',
    colors: ['#ffffff', '#eef6fa'],
    recipe: [
      { shape: 'blob', radius: 0.6, noise: 0.3, detail: 1, pos: [0, 0.6, 0], color: '#5c5a58' },
      { shape: 'cone', radius: 0.5, height: 1.6, pos: [0, 0.6, -1.0], rot: [-Math.PI / 2, 0, 0], color: ICE },
    ],
    rooms: { kuiper_belt: 2, outer_orbits: 0.8, inner_orbits: 0.4 },
  },
  // ── Tier 16: Dust Giant (r ≥ 1) ──────────────
  {
    id: 'mercury', name: 'Mercury', size: 0.38, mass: 1.6, tiers: [16, 16], area: 'solar_system',
    colors: ROCK_TINTS,
    recipe: [{ shape: 'sphere', radius: 1, pos: [0, 1, 0], color: '#9a948c' }],
    rooms: { inner_orbits: 0.8, corona: 0.6 },
  },
  {
    id: 'mars', name: 'Mars', size: 0.53, mass: 1.8, tiers: [16, 16], area: 'solar_system',
    colors: ['#ffffff', '#f0dcd0'],
    recipe: [{ shape: 'sphere', radius: 1, pos: [0, 1, 0], color: '#c1532f' }],
    rooms: { inner_orbits: 0.8 },
  },
  {
    id: 'venus', name: 'Venus', size: 0.95, mass: 2.2, tiers: [16, 17], area: 'solar_system',
    colors: ['#ffffff', '#f6ecd6'],
    recipe: [{ shape: 'sphere', radius: 1, pos: [0, 1, 0], color: '#e3c27a' }],
    rooms: { inner_orbits: 0.8 },
  },
  {
    id: 'ice_giant', name: 'Ice Giant', size: 1.3, mass: 2.6, tiers: [16, 17], area: 'solar_system',
    colors: ['#ffffff', '#dff4f7'],
    recipe: [{ shape: 'sphere', radius: 1, pos: [0, 1, 0], color: '#7fc8d8' }],
    rooms: { outer_orbits: 1, kuiper_belt: 0.5 },
  },
  // ── Tier 17: Dust Star (r ≥ 3) ──────────────
  {
    id: 'saturn', name: 'Saturn', size: 2.1, mass: 3.4, tiers: [17, 17], area: 'solar_system',
    colors: ['#ffffff'],
    recipe: [
      { shape: 'sphere', radius: 0.8, pos: [0, 1, 0], color: '#e0c48c' },
      { shape: 'torus', radius: 1, tube: 0.12, pos: [0, 1, 0], rot: [Math.PI / 2, 0, 0], scale: [1, 1, 0.2], color: '#cdb27c' },
    ],
    rooms: { outer_orbits: 0.4 },
  },
  {
    id: 'jupiter', name: 'Jupiter', size: 2.4, mass: 3.8, tiers: [17, 17], area: 'solar_system',
    colors: ['#ffffff'],
    recipe: [
      { shape: 'sphere', radius: 1, pos: [0, 1, 0], color: '#d2a477' },
      { shape: 'sphere', radius: 0.18, pos: [0.45, 0.85, 0.8], scale: [1.4, 0.7, 0.5], color: '#b5532f' },
    ],
    // A one-off placed by the generator on its orbit.
    rooms: {},
    lockedUntilTier: 17,
  },
];
