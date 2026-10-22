/** Plain-data description of a generated house floor. No three.js here. */
import type { Rect } from '../core/math';

/** Which world a layout describes: the house floor, the street outside, the city, then the region. */
export type AreaId = 'house' | 'neighborhood' | 'city' | 'region';
export const AREA_ORDER: readonly AreaId[] = ['house', 'neighborhood', 'city', 'region'];

/** The area after `area` (null for the last one). */
export function nextArea(area: AreaId): AreaId | null {
  return AREA_ORDER[AREA_ORDER.indexOf(area) + 1] ?? null;
}

export type IndoorRoomType = 'living' | 'kitchen' | 'hallway' | 'bedroom' | 'bathroom';
/** Neighborhood zones (they play the part of rooms outdoors). */
export type OutdoorZoneType = 'yard' | 'street' | 'sidewalk' | 'driveway' | 'park';
/** City zones: roads, sidewalks, paved plazas, parking lots and a park square. */
export type CityZoneType = 'avenue' | 'pavement' | 'plaza' | 'parking' | 'square';
/** Region zones, seen from a few kilometres up: fields, highways, a river, towns, woods and the landfill. */
export type RegionZoneType = 'farmland' | 'highway' | 'river' | 'town' | 'woods' | 'landfill';
export type RoomType = IndoorRoomType | OutdoorZoneType | CityZoneType | RegionZoneType;
export const ROOM_TYPES: readonly IndoorRoomType[] = ['living', 'kitchen', 'hallway', 'bedroom', 'bathroom'];
export const OUTDOOR_ZONE_TYPES: readonly OutdoorZoneType[] = ['yard', 'street', 'sidewalk', 'driveway', 'park'];
export const CITY_ZONE_TYPES: readonly CityZoneType[] = ['avenue', 'pavement', 'plaza', 'parking', 'square'];
export const REGION_ZONE_TYPES: readonly RegionZoneType[] = ['farmland', 'highway', 'river', 'town', 'woods', 'landfill'];

export function isOutdoorZone(type: RoomType): type is OutdoorZoneType {
  return (OUTDOOR_ZONE_TYPES as readonly string[]).includes(type);
}

export function isCityZone(type: RoomType): type is CityZoneType {
  return (CITY_ZONE_TYPES as readonly string[]).includes(type);
}

export function isRegionZone(type: RoomType): type is RegionZoneType {
  return (REGION_ZONE_TYPES as readonly string[]).includes(type);
}

/** The area a room / zone type belongs to. */
export function zoneArea(type: RoomType): AreaId {
  return isRegionZone(type) ? 'region' : isCityZone(type) ? 'city' : isOutdoorZone(type) ? 'neighborhood' : 'house';
}

export type FloorMaterialId =
  | 'wood'
  | 'woodDark'
  | 'tile'
  | 'tileSmall'
  | 'carpet'
  | 'grass'
  | 'asphalt'
  | 'concrete'
  | 'paving'
  // Region (seen from altitude): crop patchwork, motorway, river water, town roofs, forest canopy, landfill.
  | 'fields'
  | 'motorway'
  | 'water'
  | 'townRoofs'
  | 'forest'
  | 'landfill';

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
 * The way to the next area: the house's front door (closed until the Robo-Vac 9000 is absorbed),
 * the neighborhood's road barrier to the city (closed until the Street Sweeper is absorbed) or
 * the city's highway on-ramp to the region (closed until the Garbage Truck is absorbed).
 * While closed it is an obstacle; `rect` is the opening in the outer wall / hedge.
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
