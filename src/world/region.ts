/**
 * Seeded region generator (the area after the city). Pure data, same shape as a house floor
 * (HouseLayout). World units here are the Region's: 1 unit = 10 m (`AREAS.region.unit`).
 *
 * PLACEHOLDER: one field with the Bunny arriving at the west edge. The real map (fields,
 * highways, a river, towns, woods and the landfill) replaces it.
 */
import { rect } from '../core/math';
import { Rng } from '../core/rng';
import { wallSegments } from './house';
import type { HouseLayout, Obstacle, Room } from './types';

export const REGION = {
  /** Map size in units (10 m): 2 km × 1.5 km. */
  width: 200,
  depth: 150,
  /** Ridge around the edge. */
  wallThickness: 2,
  wallHeight: 3,
  /** Debris spatial hash cell (units). */
  debrisCellSize: 1.5,
  /** Bunny radius (units) for Runs that start here (?area=region); about the size after the Garbage Truck. */
  debugStartRadius: 0.9,
};

export function generateRegion(seed: string | number): HouseLayout {
  const root = new Rng(seed);
  const R = REGION;
  const rooms: Room[] = [{ id: 'fields', type: 'farmland', rect: rect(0, 0, R.width, R.depth), floor: 'fields' }];
  const T = R.wallThickness;
  const wallRects = [...wallSegments('h', 0, 0, R.width, [], T), ...wallSegments('h', R.depth, 0, R.width, [], T), ...wallSegments('v', 0, 0, R.depth, [], T), ...wallSegments('v', R.width, 0, R.depth, [], T)];
  const walls: Obstacle[] = wallRects.map((r, i) => ({ id: `ridge${i}`, kind: 'wall', rect: r, height: R.wallHeight, clearance: 0 }));
  return {
    area: 'region',
    seed: root.seed,
    bounds: rect(0, 0, R.width, R.depth),
    rooms,
    doorways: [],
    walls,
    furniture: [],
    obstacles: [...walls],
    rugs: [],
    debrisPlacements: [],
    spawn: { x: 8, z: R.depth / 2, roomId: 'fields' },
  };
}
