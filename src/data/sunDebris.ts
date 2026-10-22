/**
 * Debris the Sun drops or swings round (src/hazards/theSun.ts), kept out of solarDebris.ts so a
 * rewrite of the Solar System's Debris ladder can't drop it. Sizes are Solar System units (1 =
 * 0.01 AU). Neither comes from the spawner (no room weights) or from shedding (`pickShedType` skips
 * types without room weights): the boss places them with an explicit size.
 *
 * - `prominence`: the Sun's chip pieces, scattered when the Bunny rams it while it is stunned
 *   (sized like any boss chip: 0.45 × the Bunny's radius). Renders the `prominence` Blender prop.
 * - `hot_jupiter`: a giant the Sun swings round near the Bunny when no giant planet it can't absorb
 *   is near (THE_SUN.giants), so its charges have something to crash into once Jupiter is eaten.
 *   Sized max(its size, margin × the Bunny's absorb limit). Renders the `jupiter` prop.
 */
import type { DebrisType } from './debris';

export const PROMINENCE_ID = 'prominence';
export const HOT_JUPITER_ID = 'hot_jupiter';

export const SUN_DEBRIS: DebrisType[] = [
  {
    id: PROMINENCE_ID, name: 'Prominence', size: 1.4, mass: 2.2, tiers: [17, 17], area: 'solar_system',
    colors: ['#ffd27a', '#ffb347', '#ff9a3a'],
    recipe: [
      { shape: 'torus', radius: 0.7, tube: 0.18, arc: Math.PI, pos: [0, 0.05, 0] },
      { shape: 'sphere', radius: 0.28, pos: [-0.7, 0.12, 0], scale: [1, 0.5, 1] },
      { shape: 'sphere', radius: 0.28, pos: [0.7, 0.12, 0], scale: [1, 0.5, 1] },
    ],
    material: { roughness: 0.5, emissive: '#ff7a1a', emissiveIntensity: 1.2 },
    rooms: {},
  },
  {
    id: HOT_JUPITER_ID, name: 'Hot Jupiter', size: 2.4, mass: 3.8, tiers: [17, 17], area: 'solar_system', model: 'jupiter',
    colors: ['#ffffff', '#ffe6d0'],
    recipe: [
      { shape: 'sphere', radius: 1, pos: [0, 1, 0], color: '#d9945e' },
      { shape: 'sphere', radius: 0.18, pos: [0.45, 0.85, 0.8], scale: [1.4, 0.7, 0.5], color: '#b5532f' },
    ],
    material: { emissive: '#ff5a1a', emissiveIntensity: 0.25 },
    rooms: {},
  },
];
