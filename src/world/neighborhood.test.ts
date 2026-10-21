import { describe, expect, it } from 'vitest';
import { rectContains, rectsOverlap } from '../core/math';
import { getDebrisType } from '../data/debris';
import { isFloorFree } from '../systems/spawner';
import { roomAt } from './house';
import { generateNeighborhood, NEIGHBORHOOD } from './neighborhood';
import { isOutdoorZone } from './types';

describe('neighborhood generation', () => {
  it('is deterministic per seed', () => {
    expect(generateNeighborhood('x')).toEqual(generateNeighborhood('x'));
    expect(generateNeighborhood('x').furniture).not.toEqual(generateNeighborhood('y').furniture);
  });

  for (const seed of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
    it(`builds a valid layout (seed ${seed})`, () => {
      const n = generateNeighborhood(seed);
      expect(n.area).toBe('neighborhood');
      expect(n.bounds).toEqual({ minX: 0, minZ: 0, maxX: NEIGHBORHOOD.width, maxZ: NEIGHBORHOOD.depth });
      for (const r of n.rooms) expect(isOutdoorZone(r.type)).toBe(true);
      // Zones tile the map without overlapping (sampled).
      for (let i = 0; i < n.rooms.length; i++) for (let j = i + 1; j < n.rooms.length; j++) expect(rectsOverlap(n.rooms[i]!.rect, n.rooms[j]!.rect, -0.5)).toBe(false);
      for (let x = 50; x < NEIGHBORHOOD.width; x += 400) for (let z = 50; z < NEIGHBORHOOD.depth; z += 400) expect(roomAt(n, x, z)).toBeDefined();
      // Houses sit in yards, never on the street or sidewalk.
      const houses = n.furniture.filter((f) => f.defId.startsWith('house'));
      expect(houses.length).toBe(7);
      for (const hs of houses) {
        for (const r of n.rooms) if (r.type === 'street' || r.type === 'sidewalk') expect(rectsOverlap(hs.rect, r.rect)).toBe(false);
      }
      // The Bunny starts on free floor big enough for a house-cleared Bunny.
      expect(isFloorFree(n, n.spawn.x, n.spawn.z, NEIGHBORHOOD.debugStartRadius)).not.toBeNull();
      expect(rectContains(n.bounds, n.spawn.x, n.spawn.z)).toBe(true);
      // Fixed Debris refers to real types and lands in the map.
      for (const p of n.debrisPlacements) {
        expect(getDebrisType(p.typeId)?.area).toBe('neighborhood');
        expect(roomAt(n, p.x, p.z)).toBeDefined();
      }
    });
  }
});
