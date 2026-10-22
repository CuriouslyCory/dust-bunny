/**
 * The Universe (Act 9), in Universe units (1 = 10 Mly, `AREAS.universe.unit`): the cosmic web seen
 * from outside, flat. Pure data, same shape as a house floor (HouseLayout); the map does not wrap
 * and has no exit (the last Area: the Expansion's collapse wins the Run).
 *
 * Placeholder (Act 9 groundwork): seeded nodes (`nodes`, at least `nodeGap` apart, kept
 * `nodeMargin` from the edge) are the `superclusters` (within `nodeRadius`); each node is joined
 * to its `links` nearest neighbours by straight `filaments` (within `filamentWidth` of the segment),
 * `sheets` lie within `sheetWidth` of a filament and everything else is `voids`. Zones are painted
 * on a coarse grid (`cell` units per cell, merged into rects). The map's edge is the bounds; no
 * walls, obstacles or exit. `layout.routes` carries the filaments (kind 'filament', open two-point
 * polylines, node to node) for Hazards that ride them.
 *
 * The Bunny arrives on a filament near the middle of the map (`universeCentre`): the point of the
 * filament nearest the centre, kept off the nodes.
 */
import { rect, rectContains } from '../core/math';
import { Rng } from '../core/rng';
import type { FloorMaterialId, HouseLayout, MapRoute, UniverseZoneType } from './types';
import { ZoneGrid } from './zoneGrid';

export const UNIVERSE = {
  /** Map size in units (10 Mly). */
  width: 360,
  depth: 360,
  /** Zone grid cell (units). */
  cell: 3,
  /** Supercluster nodes: how many, at least `nodeGap` apart, `nodeMargin` from the edge. */
  nodes: 24,
  nodeGap: 48,
  nodeMargin: 18,
  /** Radius of a supercluster round its node. */
  nodeRadius: 9,
  /** Each node is joined to this many nearest neighbours (no filament longer than `maxLink`). */
  links: 3,
  maxLink: 120,
  /** Half-width of a filament, and how far its sheet reaches from the segment. */
  filamentWidth: 4.5,
  sheetWidth: 15,
  /** Debris spatial hash cell (units). */
  debrisCellSize: 1.5,
  /**
   * Real radius (cm) for Runs that start here (?area=universe): about the size after Sagittarius
   * A* (4 Galaxy units, 400 ly). Entering the Universe re-bases it, then the arrival leap takes it
   * to 0.85 units.
   */
  debugStartRadiusCm: 4 * 9.461e19,
};

const FLOORS: Record<UniverseZoneType, FloorMaterialId> = {
  superclusters: 'universeNode',
  filaments: 'universeFilament',
  sheets: 'universeSheet',
  voids: 'universeVoid',
};

/** The middle of the map (the spawn is on the filament nearest it). */
export function universeCentre(layout: Pick<HouseLayout, 'bounds'>): { x: number; z: number } {
  const b = layout.bounds;
  return { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 };
}

/** Distance from (x, z) to the segment a–b, and the segment parameter (0..1) of the nearest point. */
function segmentDistance(x: number, z: number, a: { x: number; z: number }, b: { x: number; z: number }): { d: number; t: number } {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len2 = dx * dx + dz * dz;
  const t = len2 > 0 ? Math.min(1, Math.max(0, ((x - a.x) * dx + (z - a.z) * dz) / len2)) : 0;
  return { d: Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t)), t };
}

/** The web's nodes (supercluster centres) for `seed`, in map units. */
export function universeNodes(seed: number | string): Array<{ x: number; z: number }> {
  const U = UNIVERSE;
  const rng = new Rng(seed).fork('universe:nodes');
  const nodes: Array<{ x: number; z: number }> = [];
  for (let tries = 0; nodes.length < U.nodes && tries < U.nodes * 80; tries++) {
    const x = rng.range(U.nodeMargin, U.width - U.nodeMargin);
    const z = rng.range(U.nodeMargin, U.depth - U.nodeMargin);
    if (nodes.every((n) => Math.hypot(n.x - x, n.z - z) >= U.nodeGap)) nodes.push({ x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100 });
  }
  return nodes;
}

/** Filaments joining each node to its nearest neighbours (index pairs into `nodes`, each pair once). */
function universeLinks(nodes: ReadonlyArray<{ x: number; z: number }>): Array<[number, number]> {
  const seen = new Set<string>();
  const links: Array<[number, number]> = [];
  nodes.forEach((n, i) => {
    const near = nodes
      .map((m, j) => ({ j, d: Math.hypot(m.x - n.x, m.z - n.z) }))
      .filter((e) => e.j !== i && e.d <= UNIVERSE.maxLink)
      .sort((a, b) => a.d - b.d)
      .slice(0, UNIVERSE.links);
    for (const { j } of near) {
      const key = i < j ? `${i}:${j}` : `${j}:${i}`;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push(i < j ? [i, j] : [j, i]);
    }
  });
  return links;
}

export function generateUniverse(seed: number | string): HouseLayout {
  const root = new Rng(seed);
  const U = UNIVERSE;
  const W = U.width;
  const D = U.depth;
  const nodes = universeNodes(seed);
  const links = universeLinks(nodes);

  // ── Zones: superclusters, filaments, sheets, voids ──
  const gw = Math.ceil(W / U.cell);
  const gd = Math.ceil(D / U.cell);
  const grid = new ZoneGrid<UniverseZoneType>(gw, gd, 'voids', FLOORS);
  const node = grid.feature('superclusters', 'superclusters');
  const filament = grid.feature('filaments', 'filaments');
  const sheet = grid.feature('sheets', 'sheets');
  for (let gz = 0; gz < gd; gz++) {
    for (let gx = 0; gx < gw; gx++) {
      const x = (gx + 0.5) * U.cell;
      const z = (gz + 0.5) * U.cell;
      let f = 0;
      if (nodes.some((n) => Math.hypot(n.x - x, n.z - z) < U.nodeRadius)) f = node;
      else {
        let d = Infinity;
        for (const [i, j] of links) d = Math.min(d, segmentDistance(x, z, nodes[i]!, nodes[j]!).d);
        if (d < U.filamentWidth) f = filament;
        else if (d < U.sheetWidth) f = sheet;
      }
      grid.cells[gz * gw + gx] = f;
    }
  }
  const rooms = grid.rooms().map((r) => ({
    ...r,
    rect: rect(r.rect.minX * U.cell, r.rect.minZ * U.cell, Math.min(W, r.rect.maxX * U.cell), Math.min(D, r.rect.maxZ * U.cell)),
  }));

  // The Bunny arrives on the filament nearest the middle of the map, at its point nearest the middle (kept off the nodes).
  const cx = W / 2;
  const cz = D / 2;
  const candidates = links
    .map(([i, j]) => {
      const a = nodes[i]!;
      const b = nodes[j]!;
      const { t } = segmentDistance(cx, cz, a, b);
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const keep = Math.min(0.5, (U.nodeRadius + U.cell * 2) / len);
      const tt = Math.min(1 - keep, Math.max(keep, t));
      const x = a.x + (b.x - a.x) * tt;
      const z = a.z + (b.z - a.z) * tt;
      return { x, z, d: Math.hypot(x - cx, z - cz) };
    })
    .sort((p, q) => p.d - q.d);
  const onFilament = (x: number, z: number) => grid.typeAt(x / U.cell, z / U.cell) === 'filaments';
  const pick = candidates.find((c) => onFilament(c.x, c.z)) ?? candidates[0] ?? { x: cx, z: cz };
  const spawn = { x: Math.round(pick.x * 100) / 100, z: Math.round(pick.z * 100) / 100, roomId: '' };
  spawn.roomId = rooms.find((r) => rectContains(r.rect, spawn.x, spawn.z))!.id;

  // ── The filaments as routes, node to node ──
  const routes: MapRoute[] = links.map(([i, j], k) => ({ id: `filament${k}`, kind: 'filament', points: [{ ...nodes[i]! }, { ...nodes[j]! }], width: U.filamentWidth * 2 }));

  return {
    area: 'universe',
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
