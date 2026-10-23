/**
 * Debris the Ice Sheet calves (src/hazards/iceSheet.ts), kept out of continentDebris.ts so a rewrite
 * of the Continent's Debris ladder can't drop it. Sizes are Continent units (1 = 10 km).
 *
 * `calved_iceberg` never comes from the spawner (no room weights): the boss places it with an
 * explicit size (a fraction of the Bunny's radius, see ICE_SHEET.calve) at its front corners, and
 * its hits scatter it. It renders the `iceberg` Blender prop (`model`), or the recipe headless.
 */
import type { DebrisType } from './debris';

export const CALVED_ICEBERG_ID = 'calved_iceberg';

export const ICE_SHEET_DEBRIS: DebrisType[] = [
  {
    id: CALVED_ICEBERG_ID, name: 'Iceberg', size: 0.9, mass: 2.4, tiers: [13, 13], area: 'continent', model: 'iceberg',
    colors: ['#e3f3fa', '#cfe8f3', '#d9eef7'],
    recipe: [
      { shape: 'blob', radius: 0.8, noise: 0.3, detail: 0, pos: [0, 0.35, 0], scale: [1, 0.7, 0.85] },
      { shape: 'blob', radius: 0.35, noise: 0.3, detail: 0, pos: [0.7, 0.18, 0.35], scale: [1, 0.7, 1] },
      { shape: 'cylinder', radiusTop: 0.95, height: 0.06, segments: 9, pos: [0, 0.03, 0], color: '#7fb4cc' },
    ],
    material: { roughness: 0.3 },
    rooms: {},
  },
];
