/**
 * Furniture definitions (data). The id doubles as the model id for createModel().
 * Furniture is always an Obstacle; pieces with `clearance` can be passed under by a Bunny
 * whose diameter is smaller than the gap (the couch skirt gates Tier 1 → 2).
 * Sizes, clearances and legs of pieces with a Blender model match public/models/*.glb
 * (docs/models.md); those load at scale 1 (fit "xz"), so collision lines up with the visuals.
 * Absorbable "furniture" (chairs, baskets, plants) are Debris types placed by room templates.
 */
import type { Rect } from '../core/math';
import type { FurnitureInstance, Obstacle } from './types';

const FACING = [
  { x: 0, z: 1 },
  { x: 1, z: 0 },
  { x: 0, z: -1 },
  { x: -1, z: 0 },
];

export interface FurnitureDef {
  id: string;
  name: string;
  /** Unrotated size: w along X, d along Z (front faces +Z), h height. cm. */
  w: number;
  d: number;
  h: number;
  /** Gap under the body in cm (0 = solid down to the floor). */
  clearance: number;
  /** Corner legs (solid) when clearance > 0. */
  legs?: { inset: number; size: number };
}

export const FURNITURE: Record<string, FurnitureDef> = {
  couch: { id: 'couch', name: 'Couch', w: 200, d: 90, h: 85, clearance: 6, legs: { inset: 3, size: 6 } },
  armchair: { id: 'armchair', name: 'Armchair', w: 90, d: 85, h: 85, clearance: 9, legs: { inset: 3, size: 6 } },
  coffee_table: { id: 'coffee_table', name: 'Coffee Table', w: 110, d: 60, h: 42, clearance: 38, legs: { inset: 5, size: 6 } },
  tv_stand: { id: 'tv_stand', name: 'TV Stand', w: 160, d: 45, h: 55, clearance: 0 },
  bookshelf: { id: 'bookshelf', name: 'Bookshelf', w: 80, d: 30, h: 180, clearance: 0 },
  dining_table: { id: 'dining_table', name: 'Dining Table', w: 160, d: 90, h: 75, clearance: 71, legs: { inset: 6, size: 6 } },
  kitchen_counter: { id: 'kitchen_counter', name: 'Counter', w: 200, d: 62, h: 90, clearance: 0 },
  stove: { id: 'stove', name: 'Stove', w: 76, d: 64, h: 90, clearance: 0 },
  fridge: { id: 'fridge', name: 'Fridge', w: 75, d: 72, h: 180, clearance: 0 },
  bed: { id: 'bed', name: 'Bed', w: 160, d: 205, h: 55, clearance: 24, legs: { inset: 4, size: 6 } },
  nightstand: { id: 'nightstand', name: 'Nightstand', w: 45, d: 40, h: 55, clearance: 0 },
  dresser: { id: 'dresser', name: 'Dresser', w: 120, d: 50, h: 90, clearance: 0 },
  desk: { id: 'desk', name: 'Desk', w: 130, d: 65, h: 75, clearance: 70, legs: { inset: 4, size: 5 } },
  bathtub: { id: 'bathtub', name: 'Bathtub', w: 170, d: 75, h: 58, clearance: 0 },
  toilet: { id: 'toilet', name: 'Toilet', w: 42, d: 68, h: 78, clearance: 0 },
  sink_cabinet: { id: 'sink_cabinet', name: 'Sink', w: 80, d: 50, h: 88, clearance: 0 },
  console_table: { id: 'console_table', name: 'Console Table', w: 120, d: 38, h: 78, clearance: 72, legs: { inset: 3, size: 4 } },
  shoe_rack: { id: 'shoe_rack', name: 'Shoe Rack', w: 90, d: 32, h: 45, clearance: 0 },
  // Neighborhood. Houses are permanent Obstacles; trees collide by the trunk only (the canopy overhangs).
  house_a: { id: 'house_a', name: 'House', w: 1000, d: 800, h: 750, clearance: 0 },
  house_b: { id: 'house_b', name: 'Bungalow', w: 1200, d: 800, h: 520, clearance: 0 },
  house_c: { id: 'house_c', name: 'Brick House', w: 900, d: 900, h: 800, clearance: 0 },
  tree_oak: { id: 'tree_oak', name: 'Oak', w: 50, d: 50, h: 800, clearance: 0 },
  tree_pine: { id: 'tree_pine', name: 'Pine', w: 40, d: 40, h: 900, clearance: 0 },
  // City buildings (footprints match the Blender models, fit "xz").
  building_office: { id: 'building_office', name: 'Office Tower', w: 2400, d: 2400, h: 6000, clearance: 0 },
  building_tower: { id: 'building_tower', name: 'Skyscraper', w: 2000, d: 2000, h: 9000, clearance: 0 },
  building_apartment: { id: 'building_apartment', name: 'Apartments', w: 2000, d: 1600, h: 3200, clearance: 0 },
  building_shops: { id: 'building_shops', name: 'Shops', w: 2400, d: 1400, h: 1200, clearance: 0 },
  building_brick: { id: 'building_brick', name: 'Brick Loft', w: 2200, d: 2000, h: 2000, clearance: 0 },
  // Region (sizes in Region units, 1 = 10 m): permanent landmarks seen from altitude. The generator
  // jitters w / d / h per instance; these are the nominal sizes.
  region_city_core: { id: 'region_city_core', name: 'City Centre', w: 8, d: 7, h: 9, clearance: 0 },
  region_hill: { id: 'region_hill', name: 'Hill', w: 12, d: 9, h: 4, clearance: 0 },
  region_ridge: { id: 'region_ridge', name: 'Ridge', w: 20, d: 4.5, h: 5, clearance: 0 },
};

/** Footprint after rotation by quarter turns. */
export function rotatedSize(def: { w: number; d: number }, quarterTurns: number): { w: number; d: number } {
  return quarterTurns % 2 === 0 ? { w: def.w, d: def.d } : { w: def.d, d: def.w };
}

/** Collision boxes for a placed furniture instance: body (with clearance) + solid legs. */
export function furnitureObstacles(inst: FurnitureInstance, def: FurnitureDef): Obstacle[] {
  const out: Obstacle[] = [
    {
      id: `${inst.id}:body`,
      kind: 'furniture',
      rect: inst.rect,
      height: inst.height,
      clearance: def.clearance,
      furnitureId: inst.id,
      exitDir: def.clearance > 0 ? FACING[inst.quarterTurns % 4] : undefined,
    },
  ];
  if (def.clearance > 0 && def.legs) {
    const { inset, size } = def.legs;
    const r = inst.rect;
    const xs = [r.minX + inset, r.maxX - inset - size];
    const zs = [r.minZ + inset, r.maxZ - inset - size];
    let i = 0;
    for (const x of xs) {
      for (const z of zs) {
        const leg: Rect = { minX: x, minZ: z, maxX: x + size, maxZ: z + size };
        out.push({ id: `${inst.id}:leg${i++}`, kind: 'furniture', rect: leg, height: def.clearance, clearance: 0, furnitureId: inst.id });
      }
    }
  }
  return out;
}
