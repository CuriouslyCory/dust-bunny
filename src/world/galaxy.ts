/**
 * The Galaxy (Act 8), in Galaxy units (1 = 100 ly, `AREAS.galaxy.unit`): the galactic disc seen
 * from above, flat, with Sagittarius A* at the centre of the map. Pure data, same shape as a house
 * floor (HouseLayout); the map does not wrap and has no exit yet (Act 9, the Universe, does not
 * exist: Sagittarius A* wins the Run).
 *
 * Zones are painted on a coarse grid (`cell` units per cell, merged into rects) by distance from
 * the centre and by `armPhase`, a logarithmic spiral (`pitch`) of four arms: two major arms
 * leaving the ends of the bar and two minor arms between them that only start `minorFrom` units
 * out (so the inner disc has two arms and the outer disc four). Zones: `galactic_core` (the bulge
 * round Sagittarius A*), the `bar` through it (at a seeded angle), the spiral arms (`inner_arms`
 * within `innerArms` of the centre, `outer_arms` beyond) with the dark `dust_lanes` between them,
 * and the thin stellar `halo` past the disc's edge (`disc`) out to the corners. The map's edge is
 * the bounds; no walls. `armDensity` is the same spiral as a smooth 0..1 (the painted floor,
 * src/world/galaxyTextures.ts, and the starfield, src/fx/galaxy.ts, follow it).
 *
 * The Bunny arrives out in an arm (`spawnDistance` from the centre, past the minor arms' fade-in:
 * the arm crossing nearest due south, so the core is up the screen). `layout.debrisPlacements` puts a rogue planet
 * (`free_floating_planet`, its own narrator line) and a sock (`space_sock`) a few units from the
 * spawn, on screen at arrival, and `coreClusters` star clusters (`star_cluster`: they stun
 * Sagittarius A*) round the bulge and along the bar. `layout.routes` carries orbits round the core
 * (kind 'orbit', closed polylines, first point repeated last) for Hazards that ride them (Globular
 * Clusters). The spawner fills the rest from src/data/galaxyDebris.ts.
 *
 * Size: at arrival (r 0.85, camera 32 × r) the view reaches ≈21 units, so the spawn's arm, the
 * dust lane beside it and the two one-offs are in view; at the end of the Act (r ≈ 4.5, Tier 19)
 * ≈120, a third of the map, with the core's glow up the screen.
 */
import { rect, rectContains } from '../core/math';
import { Rng } from '../core/rng';
import type { DebrisPlacement, FloorMaterialId, GalaxyZoneType, HouseLayout, MapRoute } from './types';
import { ZoneGrid } from './zoneGrid';

export const GALAXY = {
  /** Map size in units (100 ly); Sagittarius A* is at the centre. */
  width: 360,
  depth: 360,
  /** Zone grid cell (units): zones are painted on a coarse grid so the spiral merges into few rects. */
  cell: 3,
  /** Radius (units from the centre) of the bulge, the bar's half-length and half-width, the inner arms' reach and the disc. */
  core: 16,
  barLength: 40,
  barWidth: 8,
  innerArms: 95,
  disc: 168,
  /** Spiral arms: two major arms from the bar's ends, wound at this pitch (tan of the pitch angle). */
  pitch: 0.25,
  /** The two minor arms (between the major ones) fade in from here outwards (units from the centre). */
  minorFrom: 62,
  /** armPhase above this is an arm; below it, a dust lane. */
  armWidth: 0.1,
  /** The spawn: this far from the centre (past the minor arms' fade-in), on the arm crossing nearest due south. */
  spawnDistance: 112,
  /** One-offs near the spawn (distance from it, units): the rogue planet and the sock. */
  roguePlanetDistance: 6.5,
  sockDistance: 8,
  /** Star clusters placed round the core: how many, between these distances from the centre, at least `clusterGap` apart. */
  coreClusters: 16,
  clusterRing: [19, 46] as const,
  clusterGap: 7,
  /** Orbits round the core (units) for Hazards that ride them. */
  orbits: [30, 60, 90, 120, 150] as readonly number[],
  laneWidth: 3,
  ringSegments: 96,
  /** Debris spatial hash cell (units). */
  debrisCellSize: 1.5,
  /**
   * Real radius (cm) for Runs that start here (?area=galaxy): about the size after the Sun (4.4
   * Solar System units, 0.044 AU). Entering the Galaxy re-bases it, then the arrival leap takes it
   * to 0.85 units.
   */
  debugStartRadiusCm: 4.4 * 1.496e11,
};

const FLOORS: Record<GalaxyZoneType, FloorMaterialId> = {
  galactic_core: 'galaxyCore',
  bar: 'galaxyCore',
  inner_arms: 'galaxyArm',
  dust_lanes: 'galaxyDust',
  outer_arms: 'galaxyArm',
  halo: 'galaxyHalo',
};

/** Sagittarius A*'s position: the centre of the map. */
export function galacticCentre(layout: Pick<HouseLayout, 'bounds'>): { x: number; z: number } {
  const b = layout.bounds;
  return { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 };
}

/** The angle (radians) of major arm 0's centre line at distance `d` from the centre, for a bar at `barAngle`. */
export function armAngle(d: number, barAngle: number): number {
  return barAngle + Math.log(Math.max(d, 1) / GALAXY.barLength) / GALAXY.pitch;
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** How far out the minor arms are (0 inside `minorFrom`, 1 from 24 units past it). */
export function minorArms(d: number): number {
  return smoothstep(GALAXY.minorFrom, GALAXY.minorFrom + 24, d);
}

/**
 * How much a point at distance `d`, angle `a` lies on an arm: 1 on a major arm's centre line (0.88
 * on a minor arm's), −1 midway between arms. Two major arms (from the bar's ends, half a turn apart) everywhere; the minor arms
 * half-way between them only from `minorFrom` out, a little narrower (inside it the space between
 * the major arms is all dust lane).
 */
export function armPhase(d: number, a: number, barAngle: number): number {
  const t = a - armAngle(d, barAngle);
  const c4 = Math.cos(4 * t);
  if (Math.cos(2 * t) >= 0) return c4;
  return -1 + (c4 + 0.88) * minorArms(d);
}

/** Smooth arm density 0..1 (1 on an arm's centre line, 0 in the middle of a lane), for painting. */
export function armDensity(d: number, a: number, barAngle: number): number {
  const p = Math.min(1, Math.max(0, (armPhase(d, a, barAngle) + 1) / 2));
  return p * p * (3 - 2 * p);
}

/** The bar's seeded angle (radians), as the generator picks it. */
export function barAngleFor(seed: number | string): number {
  return new Rng(seed).fork('galaxy:bar').range(-Math.PI, Math.PI);
}

export function generateGalaxy(seed: number | string): HouseLayout {
  const root = new Rng(seed);
  const G = GALAXY;
  const W = G.width;
  const D = G.depth;
  const cx = W / 2;
  const cz = D / 2;
  const barAngle = barAngleFor(seed);

  // ── Zones: bulge, bar, arms and dust lanes, halo ──
  const gw = Math.ceil(W / G.cell);
  const gd = Math.ceil(D / G.cell);
  const grid = new ZoneGrid<GalaxyZoneType>(gw, gd, 'halo', FLOORS);
  const core = grid.feature('galactic_core', 'galactic_core');
  const bar = grid.feature('bar', 'bar');
  const inner = grid.feature('inner_arms', 'inner_arms');
  const lanes = grid.feature('dust_lanes', 'dust_lanes');
  const outer = grid.feature('outer_arms', 'outer_arms');
  const bc = Math.cos(barAngle);
  const bs = Math.sin(barAngle);
  for (let gz = 0; gz < gd; gz++) {
    for (let gx = 0; gx < gw; gx++) {
      const x = (gx + 0.5) * G.cell - cx;
      const z = (gz + 0.5) * G.cell - cz;
      const d = Math.hypot(x, z);
      const along = x * bc + z * bs;
      const across = -x * bs + z * bc;
      let f = 0;
      if (d < G.core) f = core;
      else if (Math.abs(along) < G.barLength && Math.abs(across) < G.barWidth) f = bar;
      else if (d < G.disc) f = armPhase(d, Math.atan2(z, x), barAngle) > G.armWidth ? (d < G.innerArms ? inner : outer) : lanes;
      grid.cells[gz * gw + gx] = f;
    }
  }
  const rooms = grid.rooms().map((r) => ({
    ...r,
    rect: rect(r.rect.minX * G.cell, r.rect.minZ * G.cell, Math.min(W, r.rect.maxX * G.cell), Math.min(D, r.rect.maxZ * G.cell)),
  }));

  // The Bunny arrives on an arm at `spawnDistance` (major or minor: the minor arms are full there), the crossing nearest due south (+Z), so the core is up the screen.
  const a0 = armAngle(G.spawnDistance, barAngle);
  let spawnAngle = a0;
  let best = Infinity;
  for (let k = -8; k <= 8; k++) {
    const a = a0 + (k * Math.PI) / 2;
    const gap = Math.abs(Math.atan2(Math.sin(a - Math.PI / 2), Math.cos(a - Math.PI / 2)));
    if (gap < best) {
      best = gap;
      spawnAngle = a;
    }
  }
  const spawn = { x: Math.round((cx + Math.cos(spawnAngle) * G.spawnDistance) * 100) / 100, z: Math.round((cz + Math.sin(spawnAngle) * G.spawnDistance) * 100) / 100, roomId: '' };
  spawn.roomId = rooms.find((r) => rectContains(r.rect, spawn.x, spawn.z))!.id;

  // ── Placements ──
  const prng = root.fork('galaxy:placements');
  const debrisPlacements: DebrisPlacement[] = [];
  const placed: Array<{ x: number; z: number }> = [];
  const place = (typeId: string, x: number, z: number) => {
    debrisPlacements.push({ typeId, x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100, rotY: Math.round(prng.range(0, Math.PI * 2) * 1000) / 1000 });
    placed.push({ x, z });
  };
  // A rogue planet a few units north-west of the spawn and a sock north-east: in the first screen.
  {
    const a = prng.range(-2.6, -2.0);
    place('free_floating_planet', spawn.x + Math.cos(a) * G.roguePlanetDistance, spawn.z + Math.sin(a) * G.roguePlanetDistance);
    const b = prng.range(-1.1, -0.5);
    place('space_sock', spawn.x + Math.cos(b) * G.sockDistance, spawn.z + Math.sin(b) * G.sockDistance);
  }
  // Star clusters round the bulge and along the bar (Sagittarius A*'s stun), well apart.
  for (let n = 0, tries = 0; n < G.coreClusters && tries < G.coreClusters * 60; tries++) {
    let x: number;
    let z: number;
    if (n % 2 === 0) {
      // Along the bar, either side of its spine.
      const along = prng.range(G.core + 3, G.barLength + 4) * (prng.next() < 0.5 ? -1 : 1);
      const across = prng.range(-G.barWidth - 3, G.barWidth + 3);
      x = cx + along * bc - across * bs;
      z = cz + along * bs + across * bc;
    } else {
      const a = prng.range(-Math.PI, Math.PI);
      const d = prng.range(G.clusterRing[0], G.clusterRing[1]);
      x = cx + Math.cos(a) * d;
      z = cz + Math.sin(a) * d;
    }
    const d = Math.hypot(x - cx, z - cz);
    if (d < G.clusterRing[0] || d > G.clusterRing[1]) continue;
    if (!placed.every((p) => Math.hypot(p.x - x, p.z - z) >= G.clusterGap)) continue;
    place('star_cluster', x, z);
    n++;
  }

  // ── Orbits round the core: closed polylines ──
  const routes: MapRoute[] = G.orbits.map((r, i) => {
    const points = [];
    for (let k = 0; k <= G.ringSegments; k++) {
      const a = (k / G.ringSegments) * Math.PI * 2;
      points.push({ x: Math.round((cx + Math.cos(a) * r) * 100) / 100, z: Math.round((cz + Math.sin(a) * r) * 100) / 100 });
    }
    return { id: `orbit${i}`, kind: 'orbit', points, width: G.laneWidth };
  });

  return {
    area: 'galaxy',
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
