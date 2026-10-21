/** Plain-data description of a generated house floor. No three.js here. */
import type { Rect } from '../core/math';

/** Which world a layout describes: the house floor, then the street outside. */
export type AreaId = 'house' | 'neighborhood';

export type IndoorRoomType = 'living' | 'kitchen' | 'hallway' | 'bedroom' | 'bathroom';
/** Neighborhood zones (they play the part of rooms outdoors). */
export type OutdoorZoneType = 'yard' | 'street' | 'sidewalk' | 'driveway' | 'park';
export type RoomType = IndoorRoomType | OutdoorZoneType;
export const ROOM_TYPES: readonly IndoorRoomType[] = ['living', 'kitchen', 'hallway', 'bedroom', 'bathroom'];
export const OUTDOOR_ZONE_TYPES: readonly OutdoorZoneType[] = ['yard', 'street', 'sidewalk', 'driveway', 'park'];

export function isOutdoorZone(type: RoomType): type is OutdoorZoneType {
  return (OUTDOOR_ZONE_TYPES as readonly string[]).includes(type);
}

export type FloorMaterialId = 'wood' | 'woodDark' | 'tile' | 'tileSmall' | 'carpet' | 'grass' | 'asphalt' | 'concrete';

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

/**
 * The house's front door: closed (an obstacle) until the Robo-Vac 9000 is absorbed, then the
 * way out to the neighborhood. `rect` is the opening in the outer wall.
 */
export interface ExitDoor {
  rect: Rect;
  /** Outward normal of the wall the door is in. */
  dir: { x: number; z: number };
  /** Id of the obstacle that blocks the opening while the door is closed. */
  obstacleId: string;
  open: boolean;
}

/** Flat painted shape on the ground (road lines, crosswalks). Render-only. */
export interface GroundMarking {
  rect: Rect;
  color: string;
}

export interface HouseLayout {
  area: AreaId;
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
  exit?: ExitDoor;
  markings?: GroundMarking[];
}
