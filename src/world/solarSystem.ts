/**
 * The Solar System (Act 7), in Solar System units (1 = 0.01 AU, `AREAS.solar_system.unit`): the
 * ecliptic seen from above, a flat disc round the Sun at the centre of the map. Zones are rings by
 * distance from the Sun: the corona, the inner (rocky) orbits, the asteroid belt, the outer (giant)
 * orbits and the icy Kuiper belt out to the edge. `layout.routes` carries the planets' orbit rings
 * (kind 'orbit', closed polylines round the Sun). Jupiter sits on its ring (an Obstacle until Tier
 * 17, src/data/solarDebris.ts) and Voyager 1 drifts near the spawn. The map does not wrap; the
 * Solar System is the last built Area, so it has no exit (the Sun wins the Run).
 *
 * Placeholder map (Act 7 groundwork): the world pass replaces it.
 */
import { rect, rectContains } from '../core/math';
import { Rng } from '../core/rng';
import type { DebrisPlacement, FloorMaterialId, HouseLayout, MapRoute, SolarZoneType } from './types';
import { ZoneGrid } from './zoneGrid';

export const SOLAR = {
  /** Map size in units (0.01 AU); the Sun is at the centre. */
  width: 360,
  depth: 360,
  /** Zone rings: outer radius (units from the Sun) of the corona, the inner orbits, the belt and the outer orbits; the Kuiper belt is the rest. */
  corona: 14,
  innerOrbits: 80,
  belt: 100,
  outerOrbits: 155,
  /** Orbit rings (units from the Sun): Mercury, Venus, Earth's (empty: the Globe was Earth), Mars, Jupiter, Saturn, Uranus, Neptune. */
  orbits: [22, 36, 50, 66, 118, 136, 150, 166] as readonly number[],
  /** Jupiter's orbit (one of `orbits`). */
  jupiterOrbit: 118,
  /** Orbit ring width (units) for Hazards that follow one. */
  laneWidth: 3,
  /** Segments per orbit ring polyline. */
  ringSegments: 96,
  /** Debris spatial hash cell (units). */
  debrisCellSize: 1.5,
  /**
   * Real radius (cm) for Runs that start here (?area=solar_system): about the size after the
   * Orbital Sweeper (4.4 Globe units, 4,400 km). Entering the Solar System re-bases it, then the
   * arrival leap takes it to 0.85 units.
   */
  debugStartRadiusCm: 4.4e8,
};

const FLOORS: Record<SolarZoneType, FloorMaterialId> = {
  corona: 'solarCorona',
  inner_orbits: 'solarSpace',
  asteroid_belt: 'solarBelt',
  outer_orbits: 'solarSpace',
  kuiper_belt: 'solarKuiper',
};

/** The Sun's position: the centre of the map. */
export function sunCentre(layout: Pick<HouseLayout, 'bounds'>): { x: number; z: number } {
  const b = layout.bounds;
  return { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 };
}

export function generateSolarSystem(seed: number | string): HouseLayout {
  const root = new Rng(seed);
  const S = SOLAR;
  const W = S.width;
  const D = S.depth;
  const cx = W / 2;
  const cz = D / 2;

  // ── Zones: rings round the Sun ──
  const grid = new ZoneGrid<SolarZoneType>(W, D, 'kuiper_belt', FLOORS);
  const corona = grid.feature('corona', 'corona');
  const inner = grid.feature('inner_orbits', 'inner_orbits');
  const belt = grid.feature('asteroid_belt', 'asteroid_belt');
  const outer = grid.feature('outer_orbits', 'outer_orbits');
  for (let z = 0; z < D; z++) {
    for (let x = 0; x < W; x++) {
      const d = Math.hypot(x + 0.5 - cx, z + 0.5 - cz);
      const f = d < S.corona ? corona : d < S.innerOrbits ? inner : d < S.belt ? belt : d < S.outerOrbits ? outer : 0;
      if (f) grid.cells[z * W + x] = f;
    }
  }
  const rooms = grid.rooms();

  // The Bunny arrives on Earth's old orbit, south of the Sun (the Sun is up the screen).
  const spawn = { x: cx, z: cz + S.orbits[2]!, roomId: 'inner_orbits' };
  spawn.roomId = rooms.find((r) => rectContains(r.rect, spawn.x, spawn.z))!.id;

  // ── Placements: Jupiter on its orbit, Voyager 1 just outward of the spawn ──
  const prng = root.fork('solar:placements');
  const debrisPlacements: DebrisPlacement[] = [];
  const place = (typeId: string, x: number, z: number) =>
    debrisPlacements.push({ typeId, x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100, rotY: Math.round(prng.range(0, Math.PI * 2) * 1000) / 1000 });
  const ja = prng.range(-Math.PI * 0.8, -Math.PI * 0.2);
  place('jupiter', cx + Math.cos(ja) * S.jupiterOrbit, cz + Math.sin(ja) * S.jupiterOrbit);
  const va = Math.PI / 2 + prng.range(-0.5, 0.5);
  place('voyager_1', spawn.x + Math.cos(va) * 9, spawn.z + Math.sin(va) * 9);

  // ── Orbit rings: closed polylines round the Sun ──
  const routes: MapRoute[] = S.orbits.map((r, i) => {
    const points = [];
    for (let k = 0; k <= S.ringSegments; k++) {
      const a = (k / S.ringSegments) * Math.PI * 2;
      points.push({ x: Math.round((cx + Math.cos(a) * r) * 100) / 100, z: Math.round((cz + Math.sin(a) * r) * 100) / 100 });
    }
    return { id: `orbit${i}`, kind: 'orbit', points, width: S.laneWidth };
  });

  return {
    area: 'solar_system',
    seed: root.seed,
    bounds: rect(0, 0, W, D),
    rooms,
    doorways: [],
    walls: [],
    furniture: [],
    obstacles: [],
    rugs: [],
    debrisPlacements,
    spawn,
    routes,
  };
}
