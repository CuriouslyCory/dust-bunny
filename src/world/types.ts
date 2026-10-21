/** Plain-data description of a generated house floor. No three.js here. */
import type { Rect } from '../core/math';

export type RoomType = 'living' | 'kitchen' | 'hallway' | 'bedroom' | 'bathroom';
export const ROOM_TYPES: readonly RoomType[] = ['living', 'kitchen', 'hallway', 'bedroom', 'bathroom'];

export type FloorMaterialId = 'wood' | 'woodDark' | 'tile' | 'tileSmall' | 'carpet';

export interface Room {
  id: string;
  type: RoomType;
  rect: Rect;
  floor: FloorMaterialId;
}

export interface Doorway {
  /** Opening rectangle (spans the wall thickness). */
  rect: Rect;
  rooms: [string, string];
}

/**
 * Something the Bunny collides with. `clearance` > 0 means there is a gap underneath
 * (couch skirt, bed, table top): a Bunny whose diameter is below the clearance passes under it.
 */
export interface Obstacle {
  id: string;
  kind: 'wall' | 'furniture';
  rect: Rect;
  height: number;
  clearance: number;
  /** Furniture instance this obstacle belongs to (for fading / gating). */
  furnitureId?: string;
  /**
   * Open side to eject a Bunny that outgrew the clearance while underneath
   * (e.g. the couch front), so it is not wedged against the wall behind.
   */
  exitDir?: { x: number; z: number };
}

export interface FurnitureInstance {
  id: string;
  /** Furniture def id, also the model id passed to createModel(). */
  defId: string;
  roomId: string;
  x: number;
  z: number;
  /** Rotation around Y in quarter turns (0..3); 0 = front faces +Z. */
  quarterTurns: number;
  /** Unrotated size (w along local X, d along local Z), may differ from the def (e.g. counters). */
  w: number;
  d: number;
  height: number;
  /** World-space footprint (already rotated). */
  rect: Rect;
}

export interface Rug {
  roomId: string;
  rect: Rect;
  seed: number;
}

/** A Debris type placed at a fixed spot by a room template (chairs around tables, baskets...). */
export interface DebrisPlacement {
  typeId: string;
  x: number;
  z: number;
  rotY: number;
}

export interface HouseLayout {
  seed: number;
  bounds: Rect;
  rooms: Room[];
  doorways: Doorway[];
  walls: Obstacle[];
  furniture: FurnitureInstance[];
  /** Walls + furniture collision boxes. */
  obstacles: Obstacle[];
  rugs: Rug[];
  debrisPlacements: DebrisPlacement[];
  spawn: { x: number; z: number; roomId: string };
}
