/**
 * Continent Debris (area 'continent'), Tiers 11–13. Same format as DEBRIS_TYPES in debris.ts, but
 * sizes are in Continent units (1 = 10 km, `AREAS.continent.unit`): the Bunny arrives at 0.85
 * units (the arrival leap) and absorbs the Ice Sheet at ≈3–4, so the ladder runs from forest patches
 * (0.1) to ice caps and mountain chains (3+). Room weights use the continent zone types (plains,
 * mountains, lakes, desert, tundra, ruins).
 *
 * PLACEHOLDER (Act 5 groundwork): a simple ladder so the spawner can populate the Area. Types whose
 * id matches a loaded Continent model (`forest_patch`, `lake`, `city_ruins`, `mesa`, `iceberg`,
 * `mountain_range`; public/models/manifest.json) render the Blender mesh; the recipes are the
 * headless / no-model fallback. The World agent replaces and extends this list.
 */
import type { DebrisType } from './debris';

const PI = Math.PI;

export const CONTINENT_DEBRIS: DebrisType[] = [
  // ── Arrival (Bunny r ≈ 0.85 units, Tier 11 → 12) ──────────────
  {
    id: 'forest_patch', name: 'Forest', size: 0.1, mass: 1.0, tiers: [11, 12], area: 'continent',
    colors: ['#2f5a33', '#3b6a3a', '#284d2c'],
    recipe: [
      { shape: 'cylinder', radiusTop: 1, height: 0.04, segments: 14, pos: [0, 0.02, 0], color: '#5c4a32' },
      { shape: 'cone', radius: 0.35, height: 0.5, segments: 6, pos: [-0.3, 0.27, -0.2] },
      { shape: 'cone', radius: 0.3, height: 0.45, segments: 6, pos: [0.35, 0.25, 0.1] },
      { shape: 'cone', radius: 0.3, height: 0.4, segments: 6, pos: [-0.05, 0.22, 0.45] },
    ],
    rooms: { plains: 2, mountains: 1, tundra: 0.6, lakes: 0.4 },
  },
  {
    id: 'oasis', name: 'Oasis', size: 0.14, mass: 1.1, tiers: [11, 12], area: 'continent',
    colors: ['#d9c08a', '#e3cc98'],
    recipe: [
      { shape: 'cylinder', radiusTop: 1, height: 0.03, segments: 16, pos: [0, 0.015, 0] },
      { shape: 'cylinder', radiusTop: 0.45, height: 0.04, segments: 14, pos: [0, 0.03, 0], color: '#3f86a8' },
      { shape: 'cone', radius: 0.18, height: 0.4, segments: 5, pos: [0.55, 0.2, 0.2], color: '#3f7a3a' },
    ],
    rooms: { desert: 3 },
  },
  {
    id: 'lake', name: 'Lake', size: 0.2, mass: 1.2, tiers: [11, 12], area: 'continent',
    colors: ['#3b7fa6', '#2f6f96', '#4a8db3'],
    recipe: [
      { shape: 'cylinder', radiusTop: 1, height: 0.03, segments: 18, pos: [0, 0.015, 0], color: '#b8a77a' },
      { shape: 'cylinder', radiusTop: 0.85, height: 0.04, segments: 18, pos: [0, 0.02, 0], scale: [1, 1, 0.8] },
    ],
    material: { roughness: 0.3 },
    rooms: { lakes: 4, plains: 1, tundra: 1 },
  },
  {
    id: 'pack_ice', name: 'Pack Ice', size: 0.26, mass: 1.2, tiers: [11, 12], area: 'continent',
    colors: ['#e8f2f7', '#d5e7f0'],
    recipe: [
      { shape: 'box', size: [1.4, 0.1, 1.1], pos: [-0.2, 0.05, 0], rot: [0, 0.3, 0] },
      { shape: 'box', size: [0.8, 0.12, 0.7], pos: [0.5, 0.06, 0.4], rot: [0, -0.4, 0] },
    ],
    rooms: { tundra: 3, lakes: 1 },
  },
  {
    id: 'city_ruins', name: 'City Ruins', size: 0.32, mass: 1.6, tiers: [11, 12], area: 'continent',
    colors: ['#8d8a86', '#7a7672', '#9c9893'],
    recipe: [
      { shape: 'cylinder', radiusTop: 1, height: 0.03, segments: 12, pos: [0, 0.015, 0], color: '#6b6966' },
      { shape: 'box', size: [0.25, 0.5, 0.25], pos: [-0.2, 0.25, -0.1] },
      { shape: 'box', size: [0.2, 0.35, 0.2], pos: [0.25, 0.18, 0.15] },
      { shape: 'box', size: [0.3, 0.2, 0.25], pos: [0.05, 0.1, 0.5] },
    ],
    rooms: { ruins: 4, plains: 0.4 },
  },
  // ── Tier 12 (Dustmass, r 1–3 units) ──────────────
  {
    id: 'river_delta', name: 'River Delta', size: 0.42, mass: 1.4, tiers: [12, 12], area: 'continent',
    colors: ['#5f8a4a', '#6b9452'],
    recipe: [
      { shape: 'cylinder', radiusTop: 1, height: 0.03, segments: 3, pos: [0, 0.015, 0] },
      { shape: 'box', size: [0.08, 0.04, 1.6], pos: [0, 0.03, 0], color: '#3f7fa0' },
      { shape: 'box', size: [0.06, 0.04, 1.1], pos: [0.3, 0.03, 0.2], rot: [0, 0.5, 0], color: '#3f7fa0' },
    ],
    rooms: { lakes: 2, plains: 1 },
  },
  {
    id: 'salt_flat', name: 'Salt Flat', size: 0.36, mass: 1.2, tiers: [12, 12], area: 'continent',
    colors: ['#ece6da', '#e2dccd'],
    recipe: [{ shape: 'cylinder', radiusTop: 1, height: 0.02, segments: 9, pos: [0, 0.01, 0], scale: [1, 1, 0.75] }],
    rooms: { desert: 2, plains: 0.5 },
  },
  {
    id: 'mesa', name: 'Mesa', size: 0.55, mass: 2.0, tiers: [12, 13], area: 'continent',
    colors: ['#b5603a', '#a85634', '#c26d42'],
    recipe: [
      { shape: 'cylinder', radiusTop: 0.75, radiusBottom: 1, height: 0.35, segments: 9, pos: [0, 0.175, 0] },
      { shape: 'cylinder', radiusTop: 0.2, radiusBottom: 0.28, height: 0.25, segments: 7, pos: [0.85, 0.125, 0.5] },
    ],
    rooms: { desert: 4, plains: 0.4 },
  },
  {
    id: 'fjord', name: 'Fjord', size: 0.62, mass: 1.8, tiers: [12, 13], area: 'continent',
    colors: ['#5f6e66', '#56645c'],
    recipe: [
      { shape: 'box', size: [1.8, 0.25, 0.5], pos: [0, 0.125, -0.45] },
      { shape: 'box', size: [1.8, 0.25, 0.5], pos: [0, 0.125, 0.45] },
      { shape: 'box', size: [1.8, 0.03, 0.4], pos: [0, 0.015, 0], color: '#2f5f80' },
    ],
    rooms: { tundra: 2, mountains: 1 },
  },
  {
    id: 'iceberg', name: 'Iceberg', size: 0.7, mass: 2.0, tiers: [12, 13], area: 'continent',
    colors: ['#d8eef7', '#c4e3f0'],
    recipe: [
      { shape: 'blob', radius: 0.8, noise: 0.3, detail: 0, pos: [0, 0.3, 0], scale: [1, 0.55, 0.85] },
      { shape: 'blob', radius: 0.35, noise: 0.3, detail: 0, pos: [0.75, 0.15, 0.3], scale: [1, 0.6, 1] },
    ],
    material: { roughness: 0.35 },
    rooms: { tundra: 2, lakes: 2 },
  },
  {
    id: 'canyon', name: 'Canyon', size: 0.8, mass: 2.2, tiers: [12, 13], area: 'continent',
    colors: ['#b0623d', '#a35a39'],
    recipe: [
      { shape: 'box', size: [1.9, 0.3, 0.7], pos: [0, 0.15, -0.6] },
      { shape: 'box', size: [1.9, 0.3, 0.7], pos: [0, 0.15, 0.6] },
      { shape: 'box', size: [1.9, 0.03, 0.5], pos: [0, 0.015, 0], color: '#6d4a35' },
    ],
    rooms: { desert: 3, mountains: 0.5 },
  },
  {
    id: 'wetlands', name: 'Wetlands', size: 1.0, mass: 2.4, tiers: [12, 13], area: 'continent',
    colors: ['#557a4a', '#4d7044'],
    recipe: [
      { shape: 'cylinder', radiusTop: 1, height: 0.03, segments: 12, pos: [0, 0.015, 0] },
      { shape: 'cylinder', radiusTop: 0.3, height: 0.04, segments: 10, pos: [-0.35, 0.02, 0.2], color: '#3f7fa0' },
      { shape: 'cylinder', radiusTop: 0.22, height: 0.04, segments: 10, pos: [0.4, 0.02, -0.25], color: '#3f7fa0' },
    ],
    rooms: { lakes: 2, plains: 1.5 },
  },
  {
    id: 'volcanic_field', name: 'Volcanic Field', size: 0.9, mass: 2.4, tiers: [12, 13], area: 'continent',
    colors: ['#4a403b', '#57493f'],
    recipe: [
      { shape: 'cylinder', radiusTop: 1, height: 0.03, segments: 10, pos: [0, 0.015, 0] },
      { shape: 'cone', radius: 0.3, height: 0.3, segments: 8, pos: [-0.3, 0.15, -0.2], color: '#3a3330' },
      { shape: 'cone', radius: 0.22, height: 0.22, segments: 8, pos: [0.4, 0.11, 0.3], color: '#3a3330' },
    ],
    rooms: { mountains: 2, desert: 1 },
  },
  {
    id: 'mountain_range', name: 'Mountain Range', size: 1.15, mass: 3.0, tiers: [12, 13], area: 'continent',
    colors: ['#7d7468', '#6f675d', '#857b6c'],
    recipe: [
      { shape: 'cone', radius: 0.45, height: 0.5, segments: 6, pos: [-0.55, 0.25, 0], scale: [1, 1, 0.6] },
      { shape: 'cone', radius: 0.5, height: 0.6, segments: 6, pos: [0, 0.3, 0], scale: [1, 1, 0.6] },
      { shape: 'cone', radius: 0.4, height: 0.45, segments: 6, pos: [0.55, 0.225, 0], scale: [1, 1, 0.6] },
      { shape: 'cone', radius: 0.16, height: 0.16, segments: 6, pos: [0, 0.52, 0], scale: [1, 1, 0.6], color: '#f2f4f6' },
    ],
    rooms: { mountains: 4, plains: 0.3, tundra: 0.5 },
  },
  // ── Tier 13 (Dust Pangaea, r ≥ 3 units; the Ice Sheet arrives) ──────────────
  {
    id: 'shield_volcano', name: 'Shield Volcano', size: 1.3, mass: 3.0, tiers: [13, 13], area: 'continent',
    colors: ['#4d4240', '#574a46'],
    recipe: [
      { shape: 'cylinder', radiusTop: 0.25, radiusBottom: 1, height: 0.3, segments: 12, pos: [0, 0.15, 0] },
      { shape: 'cylinder', radiusTop: 0.18, height: 0.04, segments: 10, pos: [0, 0.3, 0], color: '#e0582a' },
    ],
    material: { roughness: 0.8 },
    rooms: { mountains: 2, desert: 0.5, tundra: 0.5 },
  },
  {
    id: 'metropolis_ruins', name: 'Metropolis Ruins', size: 1.5, mass: 3.0, tiers: [13, 13], area: 'continent',
    colors: ['#8a8784', '#7b7875'],
    recipe: [
      { shape: 'cylinder', radiusTop: 1, height: 0.03, segments: 12, pos: [0, 0.015, 0], color: '#5f5d5a' },
      { shape: 'box', size: [0.18, 0.4, 0.18], pos: [-0.3, 0.2, -0.2] },
      { shape: 'box', size: [0.15, 0.3, 0.15], pos: [0.2, 0.15, -0.35] },
      { shape: 'box', size: [0.2, 0.25, 0.2], pos: [0.35, 0.125, 0.3] },
      { shape: 'box', size: [0.14, 0.35, 0.14], pos: [-0.25, 0.175, 0.4] },
    ],
    rooms: { ruins: 3, plains: 0.3 },
  },
  {
    id: 'great_lake', name: 'Great Lake', size: 1.9, mass: 3.2, tiers: [13, 13], area: 'continent',
    colors: ['#2f6f96', '#3a7aa0'],
    recipe: [
      { shape: 'cylinder', radiusTop: 1, height: 0.03, segments: 20, pos: [0, 0.015, 0], scale: [1, 1, 0.7], color: '#a89a72' },
      { shape: 'cylinder', radiusTop: 0.9, height: 0.04, segments: 20, pos: [0, 0.02, 0], scale: [1, 1, 0.62] },
    ],
    material: { roughness: 0.3 },
    rooms: { lakes: 3, plains: 1 },
  },
  {
    id: 'plateau', name: 'Plateau', size: 2.4, mass: 3.5, tiers: [13, 13], area: 'continent',
    colors: ['#a7744c', '#9a6b46'],
    recipe: [{ shape: 'cylinder', radiusTop: 0.85, radiusBottom: 1, height: 0.18, segments: 11, pos: [0, 0.09, 0], rot: [0, PI / 7, 0] }],
    rooms: { desert: 2, mountains: 2 },
  },
  {
    id: 'ice_cap', name: 'Ice Cap', size: 3.0, mass: 4.0, tiers: [13, 13], area: 'continent',
    colors: ['#eef6fa', '#e2eef4'],
    recipe: [{ shape: 'blob', radius: 1, noise: 0.15, detail: 1, pos: [0, 0, 0], scale: [1, 0.18, 0.85] }],
    rooms: { tundra: 3 },
  },
  {
    id: 'mountain_chain', name: 'Mountain Chain', size: 3.4, mass: 4.0, tiers: [13, 13], area: 'continent',
    colors: ['#776e63', '#6a6258'],
    recipe: [
      { shape: 'cone', radius: 0.35, height: 0.4, segments: 6, pos: [-0.65, 0.2, 0], scale: [1, 1, 0.5] },
      { shape: 'cone', radius: 0.4, height: 0.5, segments: 6, pos: [-0.2, 0.25, 0.05], scale: [1, 1, 0.5] },
      { shape: 'cone', radius: 0.38, height: 0.45, segments: 6, pos: [0.25, 0.225, -0.05], scale: [1, 1, 0.5] },
      { shape: 'cone', radius: 0.3, height: 0.35, segments: 6, pos: [0.68, 0.175, 0], scale: [1, 1, 0.5] },
    ],
    rooms: { mountains: 3, tundra: 0.5 },
  },
];
