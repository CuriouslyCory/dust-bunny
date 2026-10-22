/**
 * Seeded globe generator (the area after the continent): the Earth seen from orbit, laid out as a
 * flat map that wraps east–west (`layout.wrapX`: roll off the east edge, arrive from the west; see
 * src/world/wrap.ts). Pure data, same shape as a house floor (HouseLayout). World units are the
 * Globe's: 1 unit = 1,000 km (`AREAS.globe.unit`); the Bunny leaps to 0.85 units on arrival
 * (`AREAS.globe.arrivalRadius`) and absorbs the Orbital Sweeper at ≈3–4.
 *
 * The map is an equirectangular Earth (north is −Z; x = longitude from 180° W, z = latitude from
 * 90° N), stylised and ten times the real size so a 6-unit Bunny still has a planet to roll on:
 * the continents are hand-drawn outlines (`SHAPES`), each nudged by the seed and their coasts
 * warped by seeded noise, so every Run gets a slightly different but recognisable Earth. Inland
 * seas (the Mediterranean, the Black Sea, the Caspian, the Baltic, Hudson Bay) are cut out; the
 * Arctic sea ice and Antarctica are wandering bands along the poles, Greenland and the Antarctic
 * Peninsula ice. `globeSurface(seed, q)` rasterises that land at any resolution: the generator
 * paints zones from it at 1 cell per unit and the view (globeTextures.ts) the coastlines at 2.
 *
 * Zones: `landmasses` (one feature per continent or large island), `archipelagos` (island chains:
 * the islands and the shallows round them: the Caribbean, the Malay Archipelago, the Pacific
 * chains), `shelves` (shallow sea within `shelfWidth` of land, and the inland seas), `icecaps` and
 * `oceans` (the rest). The International Date Line runs down the seam: everything within
 * `seamMargin` of it is open ocean (or polar ice), and the only obstacle is the exit's gate (the
 * poles are the bounds), so collision never needs to look across the seam. The exit
 * (`layout.exit`) is the escape trajectory to the Solar System: a strip of the north bound north of
 * Europe or Africa, barred by `escape_gate` until the Orbital Sweeper falls.
 *
 * Size: half a lap (240 units) stays beyond the widest view of a 6-unit Tier 15 Bunny (camera
 * distance 29 × 6 = 174; a 16:9 view reaches ≈1.25 × that sideways at the top of the screen), so
 * the wrap System's lap moves stay off screen. `layout.routes` carries the orbit lanes (kind
 * 'orbit'): straight east–west lines across the whole map that a lane Hazard can follow round the
 * planet. `layout.debrisPlacements` puts a few Moons out in the open oceans (the Orbital Sweeper is
 * stunned by them) and the Great Barrier Reef off Australia.
 */
import { rect, rectContains } from '../core/math';
import { Rng } from '../core/rng';
import type { DebrisPlacement, ExitDoor, FloorMaterialId, GlobeZoneType, HouseLayout, MapRoute, Obstacle } from './types';
import { ZoneGrid } from './zoneGrid';

export const GLOBE = {
  /** Map size in units (1,000 km): a 2:1 lap, like an equirectangular map (1⅓ units per degree). */
  width: 480,
  depth: 240,
  /** Arctic sea ice depth from the north edge (units, wanders along the edge). */
  northCap: [9, 14] as const,
  /** Antarctica's depth from the south edge (units, wanders along the edge). */
  southCap: [18, 25] as const,
  /** Open ocean on each side of the east–west seam (the date line). */
  seamMargin: 14,
  /** Shelf seas reach this far from a landmass's coast (units). */
  shelfWidth: 3,
  /** An archipelago zone reaches this far from its islands (units). */
  archipelagoReach: 3,
  /** Seeded nudge of each continent (units, each axis) and the coastline warp amplitude (units). */
  jitter: 2,
  warp: 1.4,
  /** Orbit lane width (units). */
  laneWidth: 3,
  /** Moons placed in the open oceans (more spawn later, see globeDebris.ts). */
  moons: 5,
  /** Width of the escape trajectory over the North Pole (the exit to the Solar System, units). */
  exitWidth: 10,
  /** The exit's longitude range (degrees): north of Europe and Africa, far from the seam. */
  exitLon: [-20, 30] as const,
  /** Debris spatial hash cell (units). */
  debrisCellSize: 1.5,
  /**
   * Real radius (cm) for Runs that start here (?area=globe): about the size after the Ice Sheet
   * (4.4 Continent units, 44 km). Entering the Globe re-bases it, then the arrival leap takes it
   * to 0.85 units.
   */
  debugStartRadiusCm: 4.4e6,
};

const FLOORS: Record<GlobeZoneType, FloorMaterialId> = {
  oceans: 'globeOcean',
  shelves: 'globeShelf',
  landmasses: 'globeLand',
  archipelagos: 'globeShelf',
  icecaps: 'globeIce',
};

type LonLat = readonly [number, number];
/** What a shape is: land (landmass zone), islands (an archipelago zone), ice, or an inland sea cut out of the land. */
type ShapeKind = 'land' | 'islands' | 'ice' | 'sea';
interface ShapeGroup {
  id: string;
  kind: ShapeKind;
  polys: ReadonlyArray<ReadonlyArray<LonLat>>;
}

/** Ellipse island (centre, radii in degrees) as a polygon. */
const isle = (lon: number, lat: number, rx: number, ry: number, rot = 0): LonLat[] => {
  const pts: LonLat[] = [];
  const c = Math.cos((rot * Math.PI) / 180);
  const s = Math.sin((rot * Math.PI) / 180);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const x = Math.cos(a) * rx;
    const y = Math.sin(a) * ry;
    pts.push([lon + x * c - y * s, lat + x * s + y * c]);
  }
  return pts;
};

/** Stylised continents in longitude / latitude (degrees). Order matters only for kind 'sea' (cut last). */
export const SHAPES: readonly ShapeGroup[] = [
  {
    id: 'northAmerica',
    kind: 'land',
    polys: [
      // Mainland, Alaska to Panama.
      [
        [-164, 66], [-162, 70], [-156, 71.3], [-141, 69.8], [-128, 70.2], [-117, 68.8], [-108, 68], [-97, 68.5], [-94, 71.5], [-89, 69], [-82, 67],
        [-80, 63], [-77, 60], [-70, 59], [-64, 60], [-61, 56], [-56, 52], [-60, 48], [-66, 45], [-70, 42], [-71, 41.5], [-74, 40.5], [-76, 38],
        [-76, 35], [-79, 33], [-81, 31], [-80.2, 27], [-80.4, 25.2], [-81.6, 25.8], [-82.8, 28], [-84, 30], [-89, 30.2], [-91, 29.2], [-94, 29.6],
        [-97.2, 27.5], [-97.6, 24], [-97.3, 21.5], [-95, 18.6], [-91.5, 18.5], [-90.4, 21], [-87, 21.5], [-87.5, 18], [-88.3, 15.8], [-84, 15.6],
        [-83.3, 12], [-83.6, 10.8], [-81.7, 9], [-79.5, 9.5], [-77.4, 8.6], [-78.2, 7.4], [-80, 7.2], [-82.8, 8.2], [-85.7, 10], [-87.5, 13],
        [-91.5, 14], [-94.5, 16], [-96.5, 15.7], [-101, 17.3], [-105.5, 20], [-105.5, 22.5], [-109, 26], [-113, 30.5], [-114.7, 31.5], [-113, 29],
        [-111, 25], [-109.5, 23], [-112, 25], [-114, 28], [-116.5, 31.5], [-117.2, 32.6], [-118.5, 34], [-120.6, 34.6], [-122.5, 37.5], [-124, 40.3],
        [-124.5, 43], [-124, 46.5], [-124.6, 48.4], [-123, 49], [-127.5, 51], [-130.5, 54.5], [-134, 58], [-137.5, 59], [-141, 60], [-146, 60.8],
        [-151.5, 59.5], [-154, 57.5], [-158.5, 56], [-162, 55], [-163.5, 55], [-160, 58], [-161.5, 59.8], [-164, 60.5], [-164, 62.7], [-164.5, 64.4],
      ],
      // Baffin Island and the Canadian Arctic islands.
      [[-80, 63.5], [-72, 62], [-64, 63], [-62, 66.5], [-68, 70], [-75, 72.5], [-84, 73.5], [-90, 71], [-86, 68.5]],
      [[-120, 71.5], [-108, 70.5], [-100, 72.5], [-97, 76], [-86, 76.5], [-78, 78], [-92, 79], [-105, 78.5], [-118, 76], [-123, 73.5]],
    ],
  },
  {
    id: 'southAmerica',
    kind: 'land',
    polys: [
      [
        [-77.2, 8.4], [-75.5, 10.5], [-72.5, 11.8], [-71, 12.4], [-68, 10.6], [-62, 10.7], [-60, 8.5], [-57, 6], [-52, 4.8], [-50, 1.8], [-48, -1],
        [-44, -2.5], [-39, -3], [-35, -5.2], [-34.8, -7.5], [-35.5, -9.5], [-38.6, -13], [-39.2, -17.8], [-40.8, -22], [-44, -23], [-48.5, -26],
        [-48.8, -28.5], [-50.5, -31], [-53, -33.8], [-56, -34.9], [-57.5, -36.5], [-57, -38.5], [-62, -39], [-62.5, -41], [-65, -42], [-64.5, -45],
        [-67.5, -46.5], [-66, -48], [-68.5, -50.5], [-68.5, -52.5], [-66.5, -54.8], [-70, -55.3], [-74, -52.5], [-75.5, -48], [-73.5, -43],
        [-73.5, -37], [-71.5, -32], [-71.3, -25], [-70.3, -18.5], [-75.5, -15], [-78, -11], [-81.2, -5.5], [-80.3, -3], [-80.8, -1], [-79.8, 1],
        [-78.6, 2.6], [-77.5, 4], [-77.3, 6.5],
      ],
    ],
  },
  {
    id: 'africa',
    kind: 'land',
    polys: [
      [
        [-17.2, 14.7], [-16.6, 19.5], [-17, 21], [-15.8, 24], [-13, 27.6], [-9.8, 30.5], [-9.6, 32.5], [-6.8, 34], [-5.9, 35.6], [-2, 35.1], [1, 36.5],
        [6, 37], [10.2, 37.2], [11.1, 35.2], [10, 34], [11.5, 33], [15, 32.3], [19.8, 30.6], [20.2, 32.2], [23, 32.6], [25.5, 31.6], [29, 30.9],
        [32.3, 31.3], [33, 28], [35, 24], [37.3, 21], [38.8, 17.5], [40.5, 15], [43.2, 12.4], [44.5, 10.8], [51.2, 11.8], [51.2, 10.4], [48, 5],
        [43, -1], [40, -3], [39, -6], [39.5, -10], [40.5, -15], [36, -19], [35.3, -22.5], [32.8, -25.8], [32.4, -28.8], [30.5, -31], [27.5, -33.6],
        [25, -34], [20, -34.8], [18.4, -34.2], [17.9, -31], [15, -27], [14.5, -22.5], [11.8, -17], [12.3, -13], [13.5, -10], [12.2, -6], [9, -1],
        [9.6, 2.5], [8.6, 4.5], [5.8, 4.3], [1, 6], [-3, 5], [-7.5, 4.4], [-11, 6.8], [-13.5, 9.5], [-15, 11], [-16.8, 12.5],
      ],
      // Madagascar.
      [[44, -25], [47, -25.2], [50.4, -15.5], [49.3, -12], [48, -13.5], [44.3, -16.2], [43.3, -21.6]],
    ],
  },
  {
    id: 'eurasia',
    kind: 'land',
    polys: [
      [
        // Iberia, along the north shore of the Mediterranean, Italy, the Balkans, Anatolia.
        [-9.3, 43], [-9.5, 38.8], [-8.8, 37], [-6.2, 36.6], [-5.6, 36.1], [-4.4, 36.7], [-2, 36.8], [-0.6, 38.3], [0.2, 39.5], [3.1, 41.8],
        [3.2, 43.2], [6.2, 43.1], [8.8, 44.4], [10.4, 43], [12.2, 41.8], [15.6, 40.1], [16, 38], [17, 39], [18.4, 40.1], [16, 41.6], [13.6, 43.6],
        [12.3, 44.9], [13.7, 45.6], [15.3, 44.1], [18.5, 42.4], [19.4, 41.8], [19.8, 39.8], [21.2, 37.6], [22.9, 36.4], [23.1, 38], [24, 40.6],
        [26.4, 40.6], [27, 38], [28.2, 36.7], [30.6, 36.7], [33, 36.1], [36, 36.8], [35.9, 35.2], [35, 33], [34.3, 31.3],
        // Arabia, Persia, India, south-east Asia, China, Korea, the Russian Far East.
        [34.9, 29.5], [36.5, 26], [38.5, 23.5], [39.2, 21.5], [41, 19], [42.6, 16], [43.4, 12.7], [45, 12.9], [48.7, 14], [52.2, 15.6], [55.4, 17.8],
        [57.8, 18.9], [59.8, 22.5], [58.6, 23.7], [56.4, 24.9], [56.3, 26.2], [54.6, 24.3], [51.6, 24.5], [51.3, 26.1], [48.5, 28.5], [48, 30],
        [50, 30.1], [51.5, 27.9], [54.7, 26.5], [57.3, 25.8], [61.6, 25.2], [66.6, 25.4], [67.4, 24], [68.8, 23.2], [70.2, 22.6], [72.6, 21.5],
        [72.9, 19], [73.4, 16], [74.6, 13], [76.3, 9.5], [77.5, 8.1], [78.2, 8.9], [79.9, 10.4], [80.2, 13.3], [81, 15.8], [82.4, 16.9], [85, 19.4],
        [87, 21.5], [88.9, 21.6], [91.7, 22.5], [92.4, 20.6], [94.2, 18.3], [94.4, 16], [97.6, 16.5], [98.5, 13], [98.3, 10], [98.5, 8],
        [100.4, 5.5], [101.3, 2.9], [103.5, 1.3], [104.2, 1.4], [103.4, 4.5], [102.2, 6.2], [100.5, 7.4], [100, 9.3], [99.2, 10.4], [100.1, 13.4],
        [100.9, 12.7], [102.3, 12.2], [103, 11], [104.8, 8.6], [106.7, 10.4], [109.2, 11.6], [109.3, 13.4], [108.8, 15.3], [106.4, 17.8],
        [105.7, 19], [106.8, 20.7], [108.1, 21.6], [110.4, 20.6], [110.2, 21.6], [112, 21.8], [114.3, 22.4], [116.5, 23], [118.5, 24.6],
        [119.6, 26], [121.6, 28.5], [122, 30.5], [121, 32], [120.3, 34.3], [119.2, 35.2], [120.7, 36.4], [122.5, 37.4], [118.9, 37.2], [118, 38.8],
        [119.5, 39.9], [121.6, 40.8], [124.3, 39.9], [125.2, 38], [126.3, 36.4], [126.5, 34.4], [128.5, 34.9], [129.4, 36], [129.4, 37.4],
        [128.4, 38.6], [127.5, 39.8], [129.7, 40.9], [129.7, 42.3], [131, 42.8], [133, 42.8], [135.2, 43.8], [138.2, 46.5], [140.3, 48.5],
        [141.4, 52.2], [140.6, 53.4], [137.6, 54], [139.8, 57.5], [142.2, 59], [146, 59.3], [150.6, 59.6], [154.2, 59.2], [155.6, 57],
        [156.2, 52.5], [156.7, 51], [158.5, 52.6], [160.1, 54.2], [162.2, 56.2], [163.3, 58.6], [164.8, 59.9], [166, 61],
        // Siberia's Arctic coast, Scandinavia, the North Sea coast, France.
        [166, 66], [164, 69], [160, 69.8], [150, 71], [140, 72.2], [130, 71.4], [127, 73.3], [120, 73.2], [113, 73.8], [110, 76.5], [104, 77.7],
        [96, 76.1], [88, 75.2], [80.5, 73.6], [80, 72.2], [70, 73], [66, 69], [60, 69.6], [54, 68.5], [46, 68.4], [44, 66.2], [40.5, 64.6],
        [37, 66.1], [41, 66.9], [39.8, 68.3], [33, 69.4], [28.5, 70.9], [24.5, 71], [18.5, 70.1], [15, 68.6], [12.5, 66], [10, 64], [5, 62],
        [5.3, 59.4], [7, 58], [8.5, 58.3], [10.5, 59.3], [11.4, 58.9], [12.8, 56.2], [8.1, 56.8], [8.6, 55], [8.7, 53.9], [7, 53.5], [4.7, 52.9],
        [3.6, 51.4], [1.6, 50.9], [0, 49.6], [-1.9, 48.7], [-4.7, 48.5], [-4.3, 47.8], [-2.2, 47.1], [-1.2, 46], [-1.4, 44.4], [-1.8, 43.4],
        [-4.5, 43.4], [-8, 43.7],
      ],
      // Britain, Ireland, Iceland, Sri Lanka, Taiwan, Sakhalin.
      [[-5.7, 50], [-3, 50.6], [1.4, 51.2], [1.7, 52.6], [0.2, 53.5], [-0.3, 54.5], [-1.6, 55.6], [-2.1, 57.1], [-1.8, 57.6], [-4, 57.6], [-3, 58.6], [-5, 58.6], [-6.2, 57.2], [-5.6, 56], [-4.8, 55], [-3, 54.9], [-3.4, 54], [-3, 53.4], [-4.6, 53.2], [-4.2, 52.3], [-5.2, 51.7], [-3.4, 51.4], [-4.4, 51.2]],
      [[-10, 51.6], [-6.2, 52.2], [-6, 53.9], [-5.5, 54.9], [-7.2, 55.3], [-8.5, 54.6], [-10, 54.2], [-9.3, 53.3], [-10.3, 52.2]],
      [[-24, 65.5], [-21.5, 66.4], [-15, 66.3], [-13.5, 65], [-18, 63.4], [-22.5, 63.8]],
      [[79.8, 8], [80, 6], [81.7, 6.3], [81.9, 7.6], [80.3, 9.8]],
      [[120.1, 23], [120.8, 22], [121.9, 24.8], [121.5, 25.3]],
      [[142.2, 46.2], [143.8, 49.2], [144.2, 51], [143.2, 54.3], [142.4, 53.6], [142, 50.9], [141.9, 48]],
    ],
  },
  {
    id: 'japan',
    kind: 'land',
    polys: [
      [[129.7, 33.2], [130.2, 31.2], [131.4, 31.4], [132, 33.7], [134.7, 33.8], [135.8, 33.5], [136.8, 34.3], [138.8, 34.6], [140.9, 35.7], [141, 38.3], [142, 39.6], [141.4, 41.4], [140, 40.8], [139.8, 39.5], [139.2, 38], [137.4, 36.9], [136.7, 37.2], [136, 36], [133.3, 35.6], [131, 34.5]],
      [[140, 41.6], [141.2, 41.8], [143.3, 42], [145.8, 43.3], [144.6, 44], [141.7, 45.4], [141.5, 43.4], [140.3, 43.2]],
    ],
  },
  {
    id: 'australia',
    kind: 'land',
    polys: [
      [
        [113.5, -22], [114.1, -26.5], [115, -30], [115, -33.6], [116.7, -35], [119.8, -34], [123.7, -33.9], [126, -32.3], [131.2, -31.5],
        [134.2, -32.8], [135.9, -34.9], [137.7, -33], [137.8, -35.6], [139.6, -36.3], [140.6, -38], [143.6, -38.8], [146.3, -39.1], [150, -37.4],
        [150.9, -34.4], [152.6, -32], [153.6, -28.5], [153.1, -25.8], [150.8, -22.6], [149.3, -21], [146.3, -19], [145.4, -16], [145.3, -14.6],
        [143.5, -12.8], [142.5, -10.7], [141.6, -12.9], [141.6, -15.7], [140.8, -17.4], [139.3, -17.4], [137.8, -16.3], [135.9, -15], [136.7, -12.3],
        [135.5, -12], [132.6, -11.5], [131, -12.2], [129.4, -14.9], [127.6, -14.2], [125.9, -14.5], [124.4, -16.4], [122.2, -17.9], [121.1, -19.5],
        [118.8, -20.3], [116.7, -20.6],
      ],
      // Tasmania.
      [[144.6, -40.7], [148.3, -40.9], [148.2, -42.2], [147.1, -43.5], [146, -43.5], [145.2, -42.2]],
    ],
  },
  {
    // New Zealand, moved west of the date line (stylised: it keeps the seam open).
    id: 'newZealand',
    kind: 'land',
    polys: [
      [[158.5, -46], [160.4, -46.6], [162.8, -45.8], [164.7, -43.6], [165.9, -42], [166.3, -41.2], [164.7, -40.5], [163.5, -41.8], [162.2, -43.1], [160.3, -44.2], [158.6, -45.5]],
      [[163.8, -34.4], [165.2, -35.5], [166.4, -36.8], [167.2, -37.7], [168.3, -37.7], [167.9, -39.2], [167.2, -39.5], [166.8, -40.9], [166, -41.4], [165.4, -40.2], [164.8, -39.2], [165.4, -38.2], [165.2, -36.9], [164.2, -35.3]],
    ],
  },
  {
    // The Malay Archipelago: Sumatra, Java, Borneo, Sulawesi, New Guinea, the Lesser Sundas, the Philippines.
    id: 'malayArchipelago',
    kind: 'islands',
    polys: [
      [[95.3, 5.6], [97.5, 5.2], [100.3, 2], [103.8, -1], [106, -3.2], [105.8, -5.9], [104.5, -5.9], [102.3, -4], [100.5, -1.5], [98.7, 1.7]],
      [[105.2, -6.8], [106.1, -5.9], [108.3, -6.2], [111, -6.4], [112.6, -6.9], [114.6, -7.7], [114.4, -8.7], [111, -8.2], [108, -7.8], [106.4, -7.4]],
      [[109, 1.5], [109.7, -1], [110.3, -2.9], [114.5, -3.8], [116.5, -2.5], [116, 1], [118.8, 1], [119.2, 5], [117.2, 6.9], [116, 6], [113.2, 3.2], [111, 1.7]],
      [[119, -3.5], [119.8, 0], [120.5, 0.9], [124.5, 1.4], [121.5, -0.8], [121.4, -1.9], [122.9, -4.6], [121.2, -4.8], [120.5, -5.6], [119.5, -5.5]],
      [[131, -1], [134, -0.8], [137.5, -1.5], [141, -2.6], [144.5, -3.8], [146, -5.5], [147.8, -6.3], [150.4, -10.4], [147.8, -10], [146, -8], [143.5, -9], [141, -9.1], [138.8, -8.2], [137.8, -5.3], [134.3, -4], [132.2, -2.9]],
      [[120.6, 18.5], [122.2, 18.5], [122.4, 16.5], [121.5, 15.8], [122, 14.2], [124, 13], [123, 12.9], [121.7, 13.9], [120.6, 14.2], [120, 16.2]],
      [[122, 7], [125.3, 5.6], [126.6, 7.3], [125.6, 9.5], [123.7, 8.6], [122.2, 8]],
      isle(123.5, 11, 1.6, 1, 20), isle(116.3, -8.6, 1.1, 0.5), isle(118.5, -8.6, 1.4, 0.5), isle(121, -8.7, 1.6, 0.5), isle(124.5, -9.4, 1.8, 0.6, 30),
      isle(127.8, 0.8, 0.7, 1.4), isle(129.5, -3.2, 1.6, 0.6), isle(126.4, -3.4, 1, 0.6),
    ],
  },
  {
    id: 'caribbean',
    kind: 'islands',
    polys: [
      [[-84.9, 21.9], [-82, 23.1], [-79.5, 22.6], [-77.2, 21.6], [-74.2, 20.2], [-75.8, 19.9], [-78.2, 20.6], [-80.6, 21.6], [-82.8, 22.2]],
      [[-74.4, 19.8], [-72.8, 19.9], [-70, 19.8], [-68.4, 18.6], [-70, 18.2], [-71.6, 17.7], [-74.4, 18.3]],
      isle(-77.3, 18.1, 1.2, 0.5), isle(-66.4, 18.2, 1, 0.4), isle(-77.5, 24.5, 0.7, 1.6, 35), isle(-75.5, 23, 0.6, 1.2, 40),
      isle(-61.7, 16.2, 0.5, 0.6), isle(-61.2, 14.4, 0.4, 0.6), isle(-61.4, 10.6, 0.8, 0.5),
    ],
  },
  {
    id: 'hawaii',
    kind: 'islands',
    polys: [isle(-155.5, 19.6, 1, 1.1), isle(-156.4, 20.8, 0.6, 0.4), isle(-157.9, 21.4, 0.6, 0.35), isle(-159.5, 22.1, 0.5, 0.4), isle(-161.5, 23, 0.3, 0.3)],
  },
  {
    id: 'polynesia',
    kind: 'islands',
    polys: [
      isle(-149.5, -17.6, 0.6, 0.4), isle(-147.5, -15.5, 0.8, 0.4, 30), isle(-145, -16.5, 0.6, 0.3, 30), isle(-143, -17.8, 0.7, 0.3, 20),
      isle(-140.5, -18.8, 0.6, 0.3), isle(-139.6, -9.6, 0.5, 0.5), isle(-152, -16.6, 0.4, 0.4), isle(-157.8, -21.2, 0.4, 0.4),
    ],
  },
  {
    // Fiji, Vanuatu, New Caledonia and the Solomons (west of the date line).
    id: 'melanesia',
    kind: 'islands',
    polys: [
      isle(165.5, -21.4, 2.6, 0.6, -35), isle(167.6, -16, 0.5, 1.4, 15), isle(166.4, -14.5, 0.4, 0.8), isle(158.5, -8.2, 2, 0.5, -30),
      isle(160.5, -9.6, 1.5, 0.45, -30), isle(155.6, -6.3, 1.2, 0.5, -40),
    ],
  },
  {
    id: 'greenland',
    kind: 'ice',
    polys: [[[-73, 78], [-66, 76], [-58, 75.5], [-54, 71], [-52.5, 68], [-50, 64], [-44, 60], [-41, 62.5], [-38, 65.5], [-31, 68], [-22, 70.5], [-20, 75], [-18, 79], [-22, 81.5], [-35, 83], [-55, 82.5], [-65, 81]]],
  },
  {
    // The Antarctic Peninsula, reaching for Cape Horn.
    id: 'antarctica',
    kind: 'ice',
    polys: [[[-68, -73], [-66.5, -67], [-63, -64.6], [-57.5, -63.3], [-59.5, -66], [-61.5, -70], [-60, -74]]],
  },
  {
    id: 'blackSea',
    kind: 'sea',
    polys: [[[27.8, 42], [28.6, 44], [30.2, 45.8], [31.8, 46.6], [33.5, 44.5], [36.5, 45.2], [38.2, 47.1], [39.4, 47.1], [37.8, 44.7], [41.6, 41.6], [38, 41], [35, 42], [31.3, 41.2], [29, 41.2]]],
  },
  {
    id: 'caspian',
    kind: 'sea',
    polys: [[[49, 37.7], [51, 36.8], [53.9, 36.9], [53, 39.5], [53.1, 42], [51.2, 41], [50.3, 44.4], [51.3, 45.2], [53, 46.7], [49.3, 46.6], [47.5, 45.5], [47, 43.5], [48.6, 41.8], [49.4, 40.2], [48.9, 38.4]]],
  },
  {
    id: 'baltic',
    kind: 'sea',
    polys: [
      [[10.8, 54.4], [14.2, 53.9], [18.5, 54.6], [21, 55], [21.1, 56.8], [23.9, 57], [24.4, 58.4], [22.5, 59.1], [24, 59.5], [28.5, 59.9], [30.2, 59.9], [26.5, 60.4], [22.4, 60.2], [21.4, 61.2], [21.4, 63], [25.4, 65], [23, 65.9], [21.5, 64.8], [19.5, 63.4], [17.4, 62.4], [17.3, 60.7], [18.9, 59.8], [16.6, 57.4], [16, 56.2], [14.4, 55.5], [12.8, 55.4], [10.6, 56.2]],
      [[7.5, 57.6], [10.3, 59.2], [11.3, 58.5], [12.4, 56.2], [10.8, 55.5], [10.5, 57], [8.5, 57.4]],
    ],
  },
  {
    id: 'hudsonBay',
    kind: 'sea',
    polys: [[[-94.5, 59], [-92, 57], [-88, 56], [-82, 55], [-79.5, 54], [-78.5, 58.5], [-77.5, 62], [-82, 64], [-87, 64], [-90.5, 63.5], [-94, 61]]],
  },
];

/** Mountain belts (lon / lat polylines) the view draws as relief: the Rockies, the Andes, the Alps, the Himalaya, the Urals. */
export const RANGES: ReadonlyArray<{ group: string; pts: ReadonlyArray<LonLat> }> = [
  { group: 'northAmerica', pts: [[-150, 63], [-135, 60], [-125, 55], [-117, 49], [-111, 43], [-106, 37], [-105, 31], [-104, 25], [-100, 20]] },
  { group: 'southAmerica', pts: [[-75, 9], [-77, 3], [-78.5, -3], [-76, -10], [-71, -16], [-68.5, -22], [-69.5, -30], [-70.5, -38], [-72, -46], [-73, -52]] },
  { group: 'eurasia', pts: [[6, 45], [9, 46.3], [13, 47], [16, 47.5]] },
  { group: 'eurasia', pts: [[70, 36], [76, 35], [81, 31], [86, 28.3], [92, 28], [97, 28.5]] },
  { group: 'eurasia', pts: [[59, 67], [59.5, 62], [58.5, 57], [58, 52]] },
  { group: 'africa', pts: [[-8, 31], [-3, 32.5], [3, 34.5]] },
];

/** Map x / z (units) of a longitude / latitude, and back. */
export const lonToX = (lon: number) => ((lon + 180) / 360) * GLOBE.width;
export const latToZ = (lat: number) => ((90 - lat) / 180) * GLOBE.depth;
export const zToLat = (z: number) => 90 - (z / GLOBE.depth) * 180;

/** Smooth value noise, periodic in x with period `w` (`cols` lattice cells across it). */
export function periodicNoise(rng: Rng, w: number, h: number, cols: number): (x: number, z: number) => number {
  const cell = w / cols;
  const rows = Math.ceil(h / cell) + 2;
  const g = new Float32Array(cols * rows);
  for (let i = 0; i < g.length; i++) g[i] = rng.next();
  return (x, z) => {
    const fx = (((x / cell) % cols) + cols) % cols;
    const fz = Math.min(rows - 1.001, Math.max(0, z / cell + 1));
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const tx = fx - ix;
    const tz = fz - iz;
    const sx = tx * tx * (3 - 2 * tx);
    const sz = tz * tz * (3 - 2 * tz);
    const i1 = (ix + 1) % cols;
    const a = g[iz * cols + ix]!;
    const b = g[iz * cols + i1]!;
    const c = g[(iz + 1) * cols + ix]!;
    const d = g[(iz + 1) * cols + i1]!;
    return a + (b - a) * sx + (c - a + (a - b - c + d) * sx) * sz;
  };
}

/** Cell kinds in `globeSurface`. */
export const SURFACE = { ocean: 0, land: 1, ice: 2, sea: 3 } as const;

export interface GlobeSurface {
  /** Cells per unit. */
  q: number;
  cols: number;
  rows: number;
  /** SURFACE kind per cell (row-major, z rows). */
  kind: Uint8Array;
  /** Index into SHAPES of the shape group a land / ice / sea cell belongs to (255: the polar bands or open ocean). */
  group: Uint8Array;
  /** The seed's nudge (units) of each SHAPES group. */
  offsets: Array<readonly [number, number]>;
}

interface PlacedPoly {
  pts: Float32Array;
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

/** Even-odd point-in-polygon. */
function inside(p: PlacedPoly, x: number, z: number): boolean {
  if (x < p.minX || x > p.maxX || z < p.minZ || z > p.maxZ) return false;
  const a = p.pts;
  const n = a.length / 2;
  let c = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = a[i * 2]!;
    const zi = a[i * 2 + 1]!;
    const xj = a[j * 2]!;
    const zj = a[j * 2 + 1]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

const surfaceCache = new Map<string, GlobeSurface>();

/**
 * The seed's Earth rasterised at `q` cells per unit (cell centres sampled): every continent nudged
 * by up to `jitter` units (kept clear of the seam), the coasts warped by periodic noise, the polar
 * bands' edges wandering. Deterministic per seed; the generator and the view share it.
 */
export function globeSurface(seed: number, q: number): GlobeSurface {
  const key = `${seed}:${q}`;
  const hit = surfaceCache.get(key);
  if (hit) return hit;
  const G = GLOBE;
  const W = G.width;
  const D = G.depth;
  const rng = new Rng(seed).fork('globe:surface');
  const lo = G.seamMargin + G.warp + 0.5;
  const hi = W - G.seamMargin - G.warp - 0.5;
  const offsets: Array<readonly [number, number]> = [];
  const placed = SHAPES.map((g) => {
    const polys = g.polys.map((poly) => poly.map(([lon, lat]) => [lonToX(lon), latToZ(lat)] as const));
    const minX = Math.min(...polys.flat().map((p) => p[0]));
    const maxX = Math.max(...polys.flat().map((p) => p[0]));
    // A nudge that keeps the group off the seam strip.
    const dx = Math.min(hi - maxX, Math.max(lo - minX, rng.range(-G.jitter, G.jitter)));
    const dz = g.kind === 'sea' ? 0 : rng.range(-G.jitter, G.jitter) * 0.6;
    offsets.push([dx, dz]);
    return polys.map((pts): PlacedPoly => {
      const a = new Float32Array(pts.length * 2);
      pts.forEach(([x, z], i) => {
        a[i * 2] = x + dx;
        a[i * 2 + 1] = z + dz;
      });
      const xs = pts.map((p) => p[0] + dx);
      const zs = pts.map((p) => p[1] + dz);
      return { pts: a, minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
    });
  });
  // Inland seas move with the land they sit in.
  const landDx = (id: string) => {
    const i = SHAPES.findIndex((s) => s.id === id);
    const p = placed[i]![0]!;
    const orig = lonToX(SHAPES[i]!.polys[0]![0]![0]);
    return [p.pts[0]! - orig, p.pts[1]! - latToZ(SHAPES[i]!.polys[0]![0]![1])] as const;
  };
  const host: Record<string, string> = { blackSea: 'eurasia', caspian: 'eurasia', baltic: 'eurasia', hudsonBay: 'northAmerica' };
  SHAPES.forEach((g, i) => {
    const h = host[g.id];
    if (!h) return;
    const [dx, dz] = landDx(h);
    offsets[i] = [dx, dz];
    for (const p of placed[i]!) {
      for (let k = 0; k < p.pts.length; k += 2) {
        p.pts[k] = p.pts[k]! + dx;
        p.pts[k + 1] = p.pts[k + 1]! + dz;
      }
      p.minX += dx;
      p.maxX += dx;
      p.minZ += dz;
      p.maxZ += dz;
    }
  });

  const wx = periodicNoise(rng.fork('wx'), W, D, 60);
  const wz = periodicNoise(rng.fork('wz'), W, D, 60);
  const wx2 = periodicNoise(rng.fork('wx2'), W, D, 160);
  const wz2 = periodicNoise(rng.fork('wz2'), W, D, 160);
  const cap = periodicNoise(rng.fork('cap'), W, 4, 40);
  const cap2 = periodicNoise(rng.fork('cap2'), W, 4, 120);
  const cols = Math.round(W * q);
  const rows = Math.round(D * q);
  const kind = new Uint8Array(cols * rows);
  const group = new Uint8Array(cols * rows).fill(255);
  const [n0, n1] = G.northCap;
  const [s0, s1] = G.southCap;
  const order = SHAPES.map((_, i) => i).sort((a, b) => Number(SHAPES[a]!.kind === 'sea') - Number(SHAPES[b]!.kind === 'sea'));
  for (let j = 0; j < rows; j++) {
    const z = (j + 0.5) / q;
    for (let i = 0; i < cols; i++) {
      const x = (i + 0.5) / q;
      const k = j * cols + i;
      // Polar bands.
      const c = cap(x, 1) * 0.7 + cap2(x, 1) * 0.3;
      if (z < n0 + (n1 - n0) * c || z > D - (s0 + (s1 - s0) * (1 - c))) {
        kind[k] = SURFACE.ice;
        continue;
      }
      const px = x + (wx(x, z) - 0.5) * 2 * G.warp + (wx2(x, z) - 0.5) * G.warp * 0.6;
      const pz = z + (wz(x, z) - 0.5) * 2 * G.warp + (wz2(x, z) - 0.5) * G.warp * 0.6;
      for (const gi of order) {
        const g = SHAPES[gi]!;
        if (!placed[gi]!.some((p) => inside(p, px, pz))) continue;
        if (g.kind === 'sea') {
          if (kind[k] === SURFACE.land) {
            kind[k] = SURFACE.sea;
            group[k] = gi;
          }
        } else if (kind[k] === SURFACE.ocean) {
          kind[k] = g.kind === 'ice' ? SURFACE.ice : SURFACE.land;
          group[k] = gi;
        }
      }
    }
  }
  const out = { q, cols, rows, kind, group, offsets };
  surfaceCache.set(key, out);
  return out;
}

/** 8-neighbour chamfer distance (cells) from every cell to the nearest `src` cell, capped at `cap`. */
export function distanceTo(src: (k: number) => boolean, w: number, h: number, cap: number): Float32Array {
  const d = new Float32Array(w * h);
  for (let k = 0; k < d.length; k++) d[k] = src(k) ? 0 : cap;
  const S = Math.SQRT2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const k = y * w + x;
      let v = d[k]!;
      if (x > 0) v = Math.min(v, d[k - 1]! + 1);
      if (y > 0) {
        v = Math.min(v, d[k - w]! + 1);
        if (x > 0) v = Math.min(v, d[k - w - 1]! + S);
        if (x < w - 1) v = Math.min(v, d[k - w + 1]! + S);
      }
      d[k] = v;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const k = y * w + x;
      let v = d[k]!;
      if (x < w - 1) v = Math.min(v, d[k + 1]! + 1);
      if (y < h - 1) {
        v = Math.min(v, d[k + w]! + 1);
        if (x < w - 1) v = Math.min(v, d[k + w + 1]! + S);
        if (x > 0) v = Math.min(v, d[k + w - 1]! + S);
      }
      d[k] = v;
    }
  }
  return d;
}

export function generateGlobe(seed: string | number): HouseLayout {
  const root = new Rng(seed);
  const G = GLOBE;
  const W = G.width;
  const D = G.depth;
  const surf = globeSurface(root.seed, 1);
  const grid = new ZoneGrid<GlobeZoneType>(W, D, 'oceans', FLOORS);
  const at = (x: number, z: number) => z * W + x;

  // ── Distances (cells) to landmass coasts and to each island chain ──
  const landmass = (k: number) => surf.kind[k] === SURFACE.land && SHAPES[surf.group[k]!]?.kind === 'land';
  const toLand = distanceTo(landmass, W, D, 99);
  const chains = SHAPES.map((s, i) => (s.kind === 'islands' ? i : -1)).filter((i) => i >= 0);
  const toChain = chains.map((gi) => distanceTo((k) => surf.group[k] === gi, W, D, 99));

  // ── Features: one per continent / island chain, then the shelves and the ice ──
  const features = new Map<string, number>();
  const featureFor = (name: string, type: GlobeZoneType) => {
    let f = features.get(name);
    if (f === undefined) features.set(name, (f = grid.feature(name, type)));
    return f;
  };
  const shelves = featureFor('shelves', 'shelves');
  const iceNorth = featureFor('arctic', 'icecaps');
  const iceSouth = featureFor('antarctica', 'icecaps');
  for (let z = 0; z < D; z++) {
    for (let x = 0; x < W; x++) {
      const k = at(x, z);
      const kind = surf.kind[k]!;
      const gi = surf.group[k]!;
      let f = 0;
      if (kind === SURFACE.ice) f = gi !== 255 && SHAPES[gi]!.id === 'greenland' ? featureFor('greenland', 'icecaps') : z < D / 2 ? iceNorth : iceSouth;
      else if (kind === SURFACE.land && SHAPES[gi]!.kind === 'land') f = featureFor(SHAPES[gi]!.id, 'landmasses');
      else if (kind === SURFACE.sea) f = shelves;
      else {
        const c = toChain.findIndex((d) => d[k]! <= G.archipelagoReach);
        if (c >= 0) f = featureFor(SHAPES[chains[c]!]!.id, 'archipelagos');
        else if (toLand[k]! <= G.shelfWidth) f = shelves;
      }
      // The date line: open ocean (or polar ice) within seamMargin of the seam.
      if ((x < G.seamMargin || x >= W - G.seamMargin) && kind !== SURFACE.ice) f = 0;
      if (f) grid.cells[k] = f;
    }
  }
  const rooms = grid.rooms();

  // The Bunny arrives over the Gulf of Guinea, where the equator meets the prime meridian.
  const spawn = { x: Math.round(W / 2), z: Math.round(D / 2), roomId: 'oceans' };
  spawn.roomId = rooms.find((r) => rectContains(r.rect, spawn.x, spawn.z))!.id;

  // ── Moons out in the open oceans, and the Great Barrier Reef ──
  const prng = root.fork('globe:placements');
  const open = (x: number, z: number, clear: number) => {
    for (let dz = -clear; dz <= clear; dz++) {
      for (let dx = -clear; dx <= clear; dx++) {
        const cx = Math.floor(x + dx);
        const cz = Math.floor(z + dz);
        if (cx < 0 || cz < 0 || cx >= W || cz >= D || grid.typeAt(cx, cz) !== 'oceans') return false;
      }
    }
    return true;
  };
  const debrisPlacements: DebrisPlacement[] = [];
  const place = (typeId: string, x: number, z: number) =>
    debrisPlacements.push({ typeId, x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100, rotY: Math.round(prng.range(0, Math.PI * 2) * 1000) / 1000 });
  const MOON_SPOTS: LonLat[] = [[-35, 28], [-22, -35], [75, -25], [-145, 30], [-118, -28], [150, 18], [-95, -45]];
  for (const [lon, lat] of MOON_SPOTS) {
    if (debrisPlacements.length >= G.moons) break;
    for (let t = 0; t < 30; t++) {
      const x = lonToX(lon) + prng.range(-6, 6);
      const z = latToZ(lat) + prng.range(-5, 5);
      if (!open(x, z, 4) || Math.hypot(x - spawn.x, z - spawn.z) < 40) continue;
      place('moon', x, z);
      break;
    }
  }
  {
    // Off Queensland, on the shelf: the nearest shelf cell to the reef's real spot.
    const rx = lonToX(147.5);
    const rz = latToZ(-18);
    let best: [number, number] | null = null;
    let bestD = Infinity;
    for (let z = Math.floor(rz - 8); z <= rz + 8; z++) {
      for (let x = Math.floor(rx - 6); x <= rx + 8; x++) {
        if (grid.typeAt(x, z) !== 'shelves' || toLand[at(x, z)]! < 1.5) continue;
        const d = Math.hypot(x - rx, z - rz);
        if (d < bestD) {
          bestD = d;
          best = [x + 0.5, z + 0.5];
        }
      }
    }
    if (best) place('great_reef', best[0], best[1]);
  }

  // ── Orbit lanes: east–west lines across the whole lap ──
  const routes: MapRoute[] = [0.3, 0.5, 0.7].map((f, i) => {
    const z = Math.round(D * f) + 0.5 + (i === 1 ? 7 : 0);
    return { id: `orbit${i}`, kind: 'orbit', points: [{ x: 0, z }, { x: W, z }], width: G.laneWidth };
  });

  // ── The exit: the escape trajectory, a strip of the North Pole's edge (the map's north bound) ──
  const exit: ExitDoor = (() => {
    const erng = root.fork('globe:exit');
    const cx = Math.round(lonToX(erng.range(G.exitLon[0], G.exitLon[1])));
    const hw = G.exitWidth / 2;
    return { rect: rect(cx - hw, 0, cx + hw, 1.5), dir: { x: 0, z: -1 }, obstacleId: 'escape_gate', open: false };
  })();
  // Bars the trajectory until the Orbital Sweeper falls (an obstacle, not a wall: the poles are the bounds).
  const gate: Obstacle = { id: exit.obstacleId, kind: 'wall', rect: exit.rect, height: 0.3, clearance: 0 };

  return {
    area: 'globe',
    seed: root.seed,
    bounds: rect(0, 0, W, D),
    rooms,
    doorways: [],
    walls: [],
    furniture: [],
    obstacles: [gate],
    rugs: [],
    debrisPlacements,
    spawn,
    exit,
    routes,
    wrapX: true,
  };
}
