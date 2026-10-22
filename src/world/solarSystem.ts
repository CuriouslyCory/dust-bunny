/**
 * The Solar System (Act 7), in Solar System units (1 = 0.01 AU, `AREAS.solar_system.unit`): the
 * ecliptic seen from above, a flat disc round the Sun at the centre of the map. Pure data, same
 * shape as a house floor (HouseLayout); the map does not wrap and has no exit (the Sun wins the Run).
 *
 * Zones are rings by distance from the Sun: `corona` (round the Sun), `inner_orbits` (the rocky
 * planets), `asteroid_belt` (a cluttered ring: the generator scatters `beltRocks` asteroids in it on
 * top of the spawner's Debris, and the Trojans at Jupiter's L4 / L5 points), `outer_orbits` (the
 * giants) and `kuiper_belt` (icy bodies out to the edge). The map's edge is the heliopause: the
 * bounds rect, drawn as the Kuiper belt thinning into interstellar dark (solarTextures.ts); no walls.
 *
 * Planets are drawn at play size, not to scale, on stylised orbits (`orbits`): Mercury, Venus,
 * Earth's (empty: the Globe was Earth; the Bunny arrives on it, south of the Sun, so the Sun is up
 * the screen), Mars, Jupiter, Saturn, Uranus, Neptune. `layout.debrisPlacements` puts each planet
 * on its ring at a seeded angle (Debris that blocks until the Bunny can absorb it; Jupiter is
 * `lockedUntilTier: 17`, src/data/solarDebris.ts), Mars within reach of the spawn (Tier 16: "It eats
 * Mars"), Pluto out in the Kuiper belt, and Voyager 1 a few units ahead of the spawn, on screen at
 * arrival. `layout.routes` carries the orbit rings (kind 'orbit', closed polylines round the Sun,
 * first point repeated last) for Hazards that ride them (Comets).
 *
 * Size: at the end of the Act (r ≈ 4.5, Tier 17, camera 31 × r) the view reaches ≈120 units, a
 * third of the map; at arrival (0.85) ≈21, so Voyager 1 and Earth's ring are in view and the Sun
 * (50 units north) is not.
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
  innerOrbits: 78,
  belt: 102,
  outerOrbits: 160,
  /** Orbit rings (units from the Sun): Mercury, Venus, Earth's (empty: the Globe was Earth), Mars, Jupiter, Saturn, Uranus, Neptune. */
  orbits: [22, 36, 50, 66, 118, 136, 150, 166] as readonly number[],
  /** Earth's orbit (the spawn's ring) and Jupiter's (one of `orbits`). */
  earthOrbit: 50,
  jupiterOrbit: 118,
  /** The planets placed on their rings (orbit index), in Debris type ids. */
  planets: [
    ['mercury', 0],
    ['venus', 1],
    ['mars', 3],
    ['jupiter', 4],
    ['saturn', 5],
    ['uranus', 6],
    ['neptune', 7],
  ] as ReadonlyArray<readonly [string, number]>,
  /** Mars sits on its ring within this angle (radians) of due south, so it is a short roll from the spawn. */
  marsSpread: 0.45,
  /** Pluto's distance from the Sun (in the Kuiper belt). */
  plutoOrbit: 174,
  /** Asteroids scattered in the belt by the generator (the spawner adds more), and per Trojan camp. */
  beltRocks: 420,
  trojans: 26,
  /** Voyager 1: this far from the spawn, north-east (on screen at arrival). */
  voyagerDistance: 7,
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

/** Belt Debris the generator scatters (type id, weight). */
const BELT_MIX: ReadonlyArray<readonly [string, number]> = [
  ['asteroid', 10],
  ['asteroid_cluster', 5],
  ['rubble_pile', 3],
  ['vesta', 0.6],
  ['ceres', 0.25],
];

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

/** Rough Debris radius per placed type id (units), for spacing the generator's placements. */
const PLACED_SIZE: Record<string, number> = { asteroid: 0.14, asteroid_cluster: 0.24, rubble_pile: 0.3, vesta: 0.45, ceres: 0.78 };

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
  const spawn = { x: cx, z: cz + S.earthOrbit, roomId: 'inner_orbits' };
  spawn.roomId = rooms.find((r) => rectContains(r.rect, spawn.x, spawn.z))!.id;

  // ── Placements ──
  const prng = root.fork('solar:placements');
  const debrisPlacements: DebrisPlacement[] = [];
  const placed: Array<{ x: number; z: number; r: number }> = [];
  const place = (typeId: string, x: number, z: number, r = 0) => {
    debrisPlacements.push({ typeId, x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100, rotY: Math.round(prng.range(0, Math.PI * 2) * 1000) / 1000 });
    placed.push({ x, z, r });
  };
  const free = (x: number, z: number, r: number, gap: number) => placed.every((p) => Math.hypot(p.x - x, p.z - z) >= p.r + r + gap);
  const onRing = (radius: number, a: number) => [cx + Math.cos(a) * radius, cz + Math.sin(a) * radius] as const;

  // Voyager 1 first: a few units north-east of the spawn, in the first screen.
  {
    const a = prng.range(-1.0, -0.35);
    place('voyager_1', spawn.x + Math.cos(a) * S.voyagerDistance, spawn.z + Math.sin(a) * S.voyagerDistance, 0.5);
  }
  // Jupiter on the far (north) side of the Sun; the other planets anywhere on their rings, apart
  // from Jupiter and from the spawn; Mars a short roll south of the spawn.
  const jupiterAngle = prng.range(-Math.PI * 0.8, -Math.PI * 0.2);
  for (const [id, k] of S.planets) {
    const radius = S.orbits[k]!;
    let a = jupiterAngle;
    if (id === 'mars') a = Math.PI / 2 + prng.range(-S.marsSpread, S.marsSpread);
    else if (id !== 'jupiter') {
      for (let t = 0; t < 40; t++) {
        a = prng.range(-Math.PI, Math.PI);
        const [x, z] = onRing(radius, a);
        const gapToJupiter = Math.abs(Math.atan2(Math.sin(a - jupiterAngle), Math.cos(a - jupiterAngle)));
        if (Math.hypot(x - spawn.x, z - spawn.z) > 14 && gapToJupiter > 0.7 && free(x, z, 2.5, 6)) break;
      }
    }
    const [x, z] = onRing(radius, a);
    place(id, x, z, 2.5);
  }
  {
    const a = prng.range(-Math.PI, Math.PI);
    const [x, z] = onRing(S.plutoOrbit, a);
    place('pluto', x, z, 1.2);
  }

  // The asteroid belt, cluttered: rocks across the ring (thinner at its edges, with two Kirkwood
  // gaps), and two camps of Trojans 60° ahead of and behind Jupiter.
  const beltMid = (S.innerOrbits + S.belt) / 2;
  const beltHalf = (S.belt - S.innerOrbits) / 2 - 1;
  const pickRock = () => {
    const total = BELT_MIX.reduce((s, [, w]) => s + w, 0);
    let v = prng.range(0, total);
    for (const [id, w] of BELT_MIX) if ((v -= w) <= 0) return id;
    return BELT_MIX[0]![0];
  };
  const scatterRock = (x: number, z: number) => {
    const id = pickRock();
    const r = PLACED_SIZE[id]!;
    if (!free(x, z, r, 0.25 + r * 0.6)) return false;
    place(id, x, z, r);
    return true;
  };
  for (let n = 0, tries = 0; n < S.beltRocks && tries < S.beltRocks * 4; tries++) {
    const off = (prng.next() + prng.next() - 1) * beltHalf;
    const d = beltMid + off;
    if (Math.abs(d - (beltMid - 4)) < 0.8 || Math.abs(d - (beltMid + 5)) < 0.8) continue;
    const [x, z] = onRing(d, prng.range(-Math.PI, Math.PI));
    if (scatterRock(x, z)) n++;
  }
  for (const side of [-1, 1]) {
    const a0 = jupiterAngle + (side * Math.PI) / 3;
    for (let n = 0, tries = 0; n < S.trojans && tries < S.trojans * 5; tries++) {
      const [x, z] = onRing(S.jupiterOrbit + prng.range(-4, 4), a0 + prng.range(-0.09, 0.09));
      if (scatterRock(x, z)) n++;
    }
  }

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
