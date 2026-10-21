import { describe, expect, it } from 'vitest';
import { rectContains } from '../core/math';
import { generateHouse, HOUSE, roomAt } from './house';

describe('house generation', () => {
  it('reproduces the same layout for the same seed', () => {
    expect(generateHouse('abc')).toEqual(generateHouse('abc'));
    expect(generateHouse('abc')).not.toEqual(generateHouse('xyz'));
  });

  it('builds all room types inside the floor bounds with doorways', () => {
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f']) {
      const h = generateHouse(seed);
      expect(h.bounds).toEqual({ minX: 0, minZ: 0, maxX: HOUSE.width, maxZ: HOUSE.depth });
      expect(new Set(h.rooms.map((r) => r.type))).toEqual(new Set(['living', 'kitchen', 'hallway', 'bedroom', 'bathroom']));
      expect(h.doorways.length).toBe(h.rooms.length + 1); // one per non-hallway room + living/kitchen + front door
      expect(h.exit?.open).toBe(false);
      expect(h.obstacles.some((o) => o.id === h.exit!.obstacleId)).toBe(true);
      expect(h.furniture.some((f) => f.defId === 'couch')).toBe(true);
      for (const f of h.furniture) {
        const room = h.rooms.find((r) => r.id === f.roomId)!;
        expect(f.rect.minX).toBeGreaterThanOrEqual(room.rect.minX);
        expect(f.rect.maxX).toBeLessThanOrEqual(room.rect.maxX);
        expect(f.rect.minZ).toBeGreaterThanOrEqual(room.rect.minZ);
        expect(f.rect.maxZ).toBeLessThanOrEqual(room.rect.maxZ);
      }
    }
  });

  it('spawns the Bunny under the couch in the living room', () => {
    for (const seed of ['a', 'b', 'c', 'd']) {
      const h = generateHouse(seed);
      expect(roomAt(h, h.spawn.x, h.spawn.z)?.type).toBe('living');
      const couch = h.furniture.find((f) => f.defId === 'couch')!;
      expect(rectContains(couch.rect, h.spawn.x, h.spawn.z)).toBe(true);
    }
  });
});
