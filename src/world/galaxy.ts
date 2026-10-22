/**
 * The Galaxy (Act 8), in Galaxy units (1 = 100 ly, `AREAS.galaxy.unit`): the galactic disc seen
 * from above, flat, with Sagittarius A* at the centre of the map. Pure data, same shape as a house
 * floor (HouseLayout); the map does not wrap and has no exit yet (Act 9, the Universe, does not
 * exist: Sagittarius A* wins the Run).
 *
 * Placeholder map (Act 8 groundwork; the world pass replaces it). Zones are painted on a coarse
 * grid (`cell` units per cell, merged into rects) by distance from the centre and by the phase of a
 * two-armed logarithmic spiral: `galactic_core` (the bulge round Sagittarius A*), the `bar` through
 * it (at a seeded angle), the spiral arms (`inner_arms` within `innerArms` of the centre,
 * `outer_arms` beyond) with the dark `dust_lanes` between them, and the thin stellar `halo` past
 * the disc's edge (`disc`) out to the corners. The map's edge is the bounds; no walls.
 *
 * The Bunny arrives out in an arm (`spawnDistance` from the centre, on the arm nearest due south,
 * so the core is up the screen). `layout.routes` carries orbits round the core (kind 'orbit',
 * closed polylines, first point repeated last) for Hazards that ride them (Globular Clusters).
 * No Debris is placed by the generator: the spawner fills the map from src/data/galaxyDebris.ts.
 */
import { rect, rectContains } from '../core/math';
import { Rng } from '../core/rng';
import type { FloorMaterialId, GalaxyZoneType, HouseLayout, MapRoute } from './types';
import { ZoneGrid } from './zoneGrid';

export const GALAXY = {
  /** Map size in units (100 ly); Sagittarius A* is at the centre. */
  width: 360,
  depth: 360,
  /** Zone grid cell (units): zones are painted on a coarse grid so the spiral merges into few rects. */
  cell: 3,
  /** Radius (units from the centre) of the bulge, the bar's half-length and half-width, the inner arms' reach and the disc. */
  core: 14,
  barLength: 38,
  barWidth: 7,
  innerArms: 95,
  disc: 168,
  /** Spiral arms: two, wound at this pitch (tan of the pitch angle), starting from the bar's ends. */
  arms: 2,
  pitch: 0.26,
  /** cos(arms × phase) above this is an arm; below it, a dust lane. */
  armWidth: 0.1,
  /** The spawn: this far from the centre, on the arm nearest due south. */
  spawnDistance: 120,
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

/** The angle (radians) of arm 0's centre line at distance `d` from the centre, for a bar at `barAngle`. */
function armAngle(d: number, barAngle: number): number {
  return barAngle + Math.log(Math.max(d, 1) / GALAXY.barLength) / GALAXY.pitch;
}

/** How much a point at distance `d`, angle `a` lies on an arm: 1 on an arm's centre line, −1 midway between arms. */
export function armPhase(d: number, a: number, barAngle: number): number {
  return Math.cos(GALAXY.arms * (a - armAngle(d, barAngle)));
}

export function generateGalaxy(seed: number | string): HouseLayout {
  const root = new Rng(seed);
  const G = GALAXY;
  const W = G.width;
  const D = G.depth;
  const cx = W / 2;
  const cz = D / 2;
  const barAngle = root.fork('galaxy:bar').range(-Math.PI, Math.PI);

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

  // The Bunny arrives on an arm at `spawnDistance`, the arm crossing nearest due south (+Z), so the core is up the screen.
  const a0 = armAngle(G.spawnDistance, barAngle);
  let spawnAngle = a0;
  let best = Infinity;
  for (let k = -8; k <= 8; k++) {
    const a = a0 + (k * Math.PI * 2) / G.arms;
    const gap = Math.abs(Math.atan2(Math.sin(a - Math.PI / 2), Math.cos(a - Math.PI / 2)));
    if (gap < best) {
      best = gap;
      spawnAngle = a;
    }
  }
  const spawn = { x: Math.round((cx + Math.cos(spawnAngle) * G.spawnDistance) * 100) / 100, z: Math.round((cz + Math.sin(spawnAngle) * G.spawnDistance) * 100) / 100, roomId: '' };
  spawn.roomId = rooms.find((r) => rectContains(r.rect, spawn.x, spawn.z))!.id;

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
    debrisPlacements: [],
    spawn,
    routes,
  };
}
