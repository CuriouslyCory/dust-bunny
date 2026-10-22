/** Plain-data description of a generated house floor. No three.js here. */
import type { Rect } from '../core/math';

/** Which world a layout describes: the house floor, the street outside, the city, the region, the continent, the globe, the solar system, the galaxy, then the universe. */
export type AreaId = 'house' | 'neighborhood' | 'city' | 'region' | 'continent' | 'globe' | 'solar_system' | 'galaxy' | 'universe';
export const AREA_ORDER: readonly AreaId[] = ['house', 'neighborhood', 'city', 'region', 'continent', 'globe', 'solar_system', 'galaxy', 'universe'];

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
/** Continent zones, seen from the stratosphere: plains, mountains, lakes, rivers, desert, tundra and the ruins of cities. */
export type ContinentZoneType = 'plains' | 'mountains' | 'lakes' | 'rivers' | 'desert' | 'tundra' | 'ruins';
/** Globe zones, seen from orbit: open ocean, shallow shelf seas, landmasses, island chains and the polar ice caps. */
export type GlobeZoneType = 'oceans' | 'shelves' | 'landmasses' | 'archipelagos' | 'icecaps';
/**
 * Solar System zones, the ecliptic seen from above: the Sun's corona, the inner (rocky) orbits, the
 * asteroid belt, the outer (giant) orbits and the icy Kuiper belt at the edge.
 */
export type SolarZoneType = 'corona' | 'inner_orbits' | 'asteroid_belt' | 'outer_orbits' | 'kuiper_belt';
/**
 * Galaxy zones, the galactic disc seen from above: the bulge round Sagittarius A* (`galactic_core`),
 * the central `bar`, the `inner_arms`, the dark `dust_lanes` between the arms, the `outer_arms`
 * and the thin stellar `halo` at the edge.
 */
export type GalaxyZoneType = 'galactic_core' | 'bar' | 'inner_arms' | 'dust_lanes' | 'outer_arms' | 'halo';
/**
 * Universe zones, the cosmic web seen from outside: the `superclusters` at the web's nodes, the
 * bright `filaments` joining them, the thinner `sheets` beside the filaments and the empty `voids`
 * between (voids slow the Bunny).
 */
export type UniverseZoneType = 'superclusters' | 'filaments' | 'sheets' | 'voids';
export type RoomType = IndoorRoomType | OutdoorZoneType | CityZoneType | RegionZoneType | ContinentZoneType | GlobeZoneType | SolarZoneType | GalaxyZoneType | UniverseZoneType;
export const ROOM_TYPES: readonly IndoorRoomType[] = ['living', 'kitchen', 'hallway', 'bedroom', 'bathroom'];
export const OUTDOOR_ZONE_TYPES: readonly OutdoorZoneType[] = ['yard', 'street', 'sidewalk', 'driveway', 'park'];
export const CITY_ZONE_TYPES: readonly CityZoneType[] = ['avenue', 'pavement', 'plaza', 'parking', 'square'];
export const REGION_ZONE_TYPES: readonly RegionZoneType[] = ['farmland', 'highway', 'river', 'town', 'woods', 'landfill'];
export const CONTINENT_ZONE_TYPES: readonly ContinentZoneType[] = ['plains', 'mountains', 'lakes', 'rivers', 'desert', 'tundra', 'ruins'];
export const GLOBE_ZONE_TYPES: readonly GlobeZoneType[] = ['oceans', 'shelves', 'landmasses', 'archipelagos', 'icecaps'];
export const SOLAR_ZONE_TYPES: readonly SolarZoneType[] = ['corona', 'inner_orbits', 'asteroid_belt', 'outer_orbits', 'kuiper_belt'];
export const GALAXY_ZONE_TYPES: readonly GalaxyZoneType[] = ['galactic_core', 'bar', 'inner_arms', 'dust_lanes', 'outer_arms', 'halo'];
export const UNIVERSE_ZONE_TYPES: readonly UniverseZoneType[] = ['superclusters', 'filaments', 'sheets', 'voids'];

export function isOutdoorZone(type: RoomType): type is OutdoorZoneType {
  return (OUTDOOR_ZONE_TYPES as readonly string[]).includes(type);
}

export function isCityZone(type: RoomType): type is CityZoneType {
  return (CITY_ZONE_TYPES as readonly string[]).includes(type);
}

export function isRegionZone(type: RoomType): type is RegionZoneType {
  return (REGION_ZONE_TYPES as readonly string[]).includes(type);
}

export function isContinentZone(type: RoomType): type is ContinentZoneType {
  return (CONTINENT_ZONE_TYPES as readonly string[]).includes(type);
}

export function isGlobeZone(type: RoomType): type is GlobeZoneType {
  return (GLOBE_ZONE_TYPES as readonly string[]).includes(type);
}

export function isSolarZone(type: RoomType): type is SolarZoneType {
  return (SOLAR_ZONE_TYPES as readonly string[]).includes(type);
}

export function isGalaxyZone(type: RoomType): type is GalaxyZoneType {
  return (GALAXY_ZONE_TYPES as readonly string[]).includes(type);
}

export function isUniverseZone(type: RoomType): type is UniverseZoneType {
  return (UNIVERSE_ZONE_TYPES as readonly string[]).includes(type);
}

/** The area a room / zone type belongs to. */
export function zoneArea(type: RoomType): AreaId {
  return isUniverseZone(type) ? 'universe' : isGalaxyZone(type) ? 'galaxy' : isSolarZone(type) ? 'solar_system' : isGlobeZone(type) ? 'globe' : isContinentZone(type) ? 'continent' : isRegionZone(type) ? 'region' : isCityZone(type) ? 'city' : isOutdoorZone(type) ? 'neighborhood' : 'house';
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
  | 'landfill'
  // Continent (from the stratosphere, 1 unit = 10 km): grassland, mountain relief, lake and river water, dunes,
  // snow, ash over ruined street grids, and the ocean past the coast.
  | 'steppe'
  | 'highlands'
  | 'lakeWater'
  | 'desertSand'
  | 'tundraSnow'
  | 'ruinsAsh'
  | 'ocean'
  // Globe (from orbit, 1 unit = 1,000 km): open ocean, shelf seas, land and polar ice (globeTextures.ts).
  | 'globeOcean'
  | 'globeShelf'
  | 'globeLand'
  | 'globeIce'
  // Solar System (the ecliptic, 1 unit = 0.01 AU): open space, the Sun's corona, the asteroid belt and the Kuiper belt.
  | 'solarSpace'
  | 'solarCorona'
  | 'solarBelt'
  | 'solarKuiper'
  // Galaxy (the galactic disc, 1 unit = 100 ly): the glowing bulge, the star-packed arms, the dark dust lanes and the halo.
  | 'galaxyCore'
  | 'galaxyArm'
  | 'galaxyDust'
  | 'galaxyHalo'
  // Universe (the cosmic web, 1 unit = 10 Mly): the bright nodes and filaments, the faint sheets and the dark voids.
  | 'universeNode'
  | 'universeFilament'
  | 'universeSheet'
  | 'universeVoid';

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
 * the neighborhood's road barrier to the city (closed until the Street Sweeper is absorbed),
 * the city's highway on-ramp to the region (closed until the Garbage Truck is absorbed) or the
 * region's westbound motorway out to the continent (closed until the Incinerator is absorbed) or
 * the continent's launch corridor up to orbit on the north coast (closed until the Ice Sheet is absorbed) or
 * the globe's escape trajectory over the North Pole (closed until the Orbital Sweeper is absorbed) or
 * the solar system's heliopause gate on the north edge of the ecliptic (closed until the Sun is absorbed) or
 * the galaxy's intergalactic gate out of the halo (closed until Sagittarius A* is absorbed).
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
  /** Drawn this many steps above layer 0, for marks painted over other marks (default 0). */
  layer?: number;
}

/**
 * A route across the map that lane / trail Hazards can follow (the Continent's rivers and glacier
 * lanes, the Globe's orbit lanes, the Solar System's orbit rings, the Galaxy's orbits round the core, the Universe's filaments): a polyline in course order (source
 * first), `width` across; axis-aligned except the Universe's filaments (straight, node to node) and the Solar System's and the Galaxy's rings, which are closed loops round the
 * Sun / the galactic core (first point repeated last). Data only.
 */
export interface MapRoute {
  id: string;
  kind: 'river' | 'glacier' | 'orbit' | 'filament';
  points: Array<{ x: number; z: number }>;
  width: number;
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
  /** Rivers and glacier lanes (the Continent), orbit lanes (the Globe), orbit rings (the Solar System, the Galaxy), for Hazards that follow a course. */
  routes?: MapRoute[];
  /**
   * The map wraps east–west (the Globe): rolling off `bounds.maxX` arrives at `bounds.minX`. World
   * x is unbounded (the Bunny keeps its own coordinate as it circles the planet); everything static
   * (rooms, obstacles, routes, the exit) is stored once in the canonical strip [minX, maxX) and
   * looked up through `canonicalX` (src/world/wrap.ts). A wrapping layout has no obstacles that
   * stop short of the full width (only east–west bands such as polar walls), so collision needs no
   * wrapping. See docs/architecture.md, "Wrap-around".
   */
  wrapX?: boolean;
}
