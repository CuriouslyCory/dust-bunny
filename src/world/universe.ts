/**
 * The Universe (Act 9), in Universe units (1 = 10 Mly, `AREAS.universe.unit`): the cosmic web seen
 * from outside, flat. Pure data, same shape as a house floor (HouseLayout); the map does not wrap
 * and has no exit (the last Area: the Expansion's collapse wins the Run).
 *
 * The web is the edges of a Voronoi diagram (`universeWeb`): seeded void centres (dart-thrown at
 * irregular spacing round `voidGap`, also `voidReach` past the map so the web runs off its edge)
 * are the voids; the corners where three voids meet are the nodes (`superclusters`, radius by how
 * heavy their filaments are) and the borders between two voids are straight `filaments` joining
 * them (half-width by a seeded strength, `filamentWidth`); `sheets` lie within `sheetWidth` of a
 * filament's edge and everything else is `voids`. Zones are painted on a coarse grid (`cell` units
 * per cell, merged into rects). The map's edge is the bounds; no walls, obstacles or exit.
 * `layout.routes` carries the filaments that lie wholly on the map (kind 'filament', open
 * two-point polylines, node to node) for Hazards that ride them.
 *
 * The Bunny arrives on a filament near the middle of the map (`universeCentre`), `spawnFromNode`
 * units along it from a node, preferring a node up the screen (north). `layout.debrisPlacements`:
 * the Great Attractor (a one-off with its own narrator line) on that node, too big to absorb until
 * about Tier 21, and a sock a few units from the spawn, in the first screen.
 */
import { rect, rectContains } from '../core/math';
import { Rng } from '../core/rng';
import type { DebrisPlacement, FloorMaterialId, HouseLayout, MapRoute, UniverseZoneType } from './types';
import { ZoneGrid } from './zoneGrid';

export const UNIVERSE = {
  /** Map size in units (10 Mly). */
  width: 360,
  depth: 360,
  /** Zone grid cell (units). */
  cell: 3,
  /** Void centres: typical spacing (each gets its own size, × 0.7–1.35), and how far past the map they are thrown. */
  voidGap: 66,
  voidReach: 90,
  /** Nodes closer than this are merged into one (a heavier node). */
  nodeMerge: 7,
  /** Supercluster radius round a node: from `nodeRadius[0]` (light) to `nodeRadius[1]` (heavy). */
  nodeRadius: [4.5, 8] as const,
  /** Filament half-width: from `filamentWidth[0]` (a thin strand) to `filamentWidth[1]` (a thick one). */
  filamentWidth: [2.2, 4.6] as const,
  /** How far a sheet reaches past a filament's edge. */
  sheetWidth: 7,
  /** Route ends (and the nodes `universeNodes` returns) are at least this far inside the bounds. */
  nodeMargin: 3,
  /** The spawn sits this far along its filament from a node (where the Great Attractor waits). */
  spawnFromNode: 17,
  /** The sock's distance from the spawn. */
  sockDistance: 6,
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

export interface WebNode {
  x: number;
  z: number;
  /** Supercluster radius (units). */
  r: number;
  /** 0..1: how heavy (the sum of its filaments' strengths, normalised). */
  mass: number;
}

export interface WebLink {
  /** Indexes into `nodes`. */
  a: number;
  b: number;
  /** Half-width (units). */
  w: number;
  /** 0..1 (thin strand → thick filament). */
  strength: number;
}

/** The cosmic web for a seed: void centres, nodes (some past the map's edge) and filaments. */
export interface UniverseWeb {
  voids: ReadonlyArray<{ x: number; z: number; r: number }>;
  nodes: readonly WebNode[];
  links: readonly WebLink[];
}

/** The middle of the map (the spawn is on a filament near it). */
export function universeCentre(layout: Pick<HouseLayout, 'bounds'>): { x: number; z: number } {
  const b = layout.bounds;
  return { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 };
}

/** Distance from (x, z) to the segment a–b, and the segment parameter (0..1) of the nearest point. */
export function segmentDistance(x: number, z: number, a: { x: number; z: number }, b: { x: number; z: number }): { d: number; t: number } {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len2 = dx * dx + dz * dz;
  const t = len2 > 0 ? Math.min(1, Math.max(0, ((x - a.x) * dx + (z - a.z) * dz) / len2)) : 0;
  return { d: Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t)), t };
}

const round2 = (v: number) => Math.round(v * 100) / 100;
const webCache = new Map<number, UniverseWeb>();

/**
 * The Voronoi web for `seed` (cached): void centres dart-thrown with their own spacing, the
 * Delaunay triangles between them (brute force: a few dozen points), whose circumcentres are the
 * nodes and whose shared edges are the filaments.
 */
export function universeWeb(seed: number | string): UniverseWeb {
  const root = new Rng(seed);
  const hit = webCache.get(root.seed);
  if (hit) return hit;
  const U = UNIVERSE;
  const rng = root.fork('universe:web');
  const R = U.voidReach;
  // ── Void centres ──
  const voids: Array<{ x: number; z: number; r: number }> = [];
  for (let tries = 0; tries < 4000; tries++) {
    const x = rng.range(-R, U.width + R);
    const z = rng.range(-R, U.depth + R);
    const r = U.voidGap * rng.range(0.7, 1.35) * 0.5;
    if (voids.every((v) => Math.hypot(v.x - x, v.z - z) >= v.r + r)) voids.push({ x, z, r });
  }
  // ── Delaunay triangles (circumcircle empty of other centres) ──
  const maxEdge = U.voidGap * 3.2;
  const tris: Array<{ x: number; z: number; v: [number, number, number] }> = [];
  const n = voids.length;
  for (let i = 0; i < n; i++) {
    const p = voids[i]!;
    for (let j = i + 1; j < n; j++) {
      const q = voids[j]!;
      if (Math.hypot(q.x - p.x, q.z - p.z) > maxEdge) continue;
      for (let k = j + 1; k < n; k++) {
        const s = voids[k]!;
        if (Math.hypot(s.x - p.x, s.z - p.z) > maxEdge || Math.hypot(s.x - q.x, s.z - q.z) > maxEdge) continue;
        const d = 2 * (p.x * (q.z - s.z) + q.x * (s.z - p.z) + s.x * (p.z - q.z));
        if (Math.abs(d) < 1e-6) continue;
        const p2 = p.x * p.x + p.z * p.z;
        const q2 = q.x * q.x + q.z * q.z;
        const s2 = s.x * s.x + s.z * s.z;
        const ux = (p2 * (q.z - s.z) + q2 * (s.z - p.z) + s2 * (p.z - q.z)) / d;
        const uz = (p2 * (s.x - q.x) + q2 * (p.x - s.x) + s2 * (q.x - p.x)) / d;
        const rr = (p.x - ux) ** 2 + (p.z - uz) ** 2 - 1e-6;
        let empty = true;
        for (let m = 0; m < n && empty; m++) if (m !== i && m !== j && m !== k && (voids[m]!.x - ux) ** 2 + (voids[m]!.z - uz) ** 2 < rr) empty = false;
        if (empty) tris.push({ x: ux, z: uz, v: [i, j, k] });
      }
    }
  }
  // ── Nodes: circumcentres, close ones merged; filaments: the Voronoi edges between them ──
  const nodeOf: number[] = [];
  const sums: Array<{ x: number; z: number; n: number }> = [];
  for (const t of tris) {
    let id = sums.findIndex((s) => Math.hypot(s.x / s.n - t.x, s.z / s.n - t.z) < U.nodeMerge);
    if (id < 0) {
      id = sums.length;
      sums.push({ x: 0, z: 0, n: 0 });
    }
    sums[id]!.x += t.x;
    sums[id]!.z += t.z;
    sums[id]!.n += 1;
    nodeOf.push(id);
  }
  const edgeTris = new Map<string, number[]>();
  tris.forEach((t, ti) => {
    const [i, j, k] = t.v;
    for (const [a, b] of [[i, j], [j, k], [i, k]] as const) {
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      const list = edgeTris.get(key);
      if (list) list.push(ti);
      else edgeTris.set(key, [ti]);
    }
  });
  const pts = sums.map((s) => ({ x: round2(s.x / s.n), z: round2(s.z / s.n) }));
  const limit = (p: { x: number; z: number }) => p.x > -R && p.x < U.width + R && p.z > -R && p.z < U.depth + R;
  const seen = new Set<string>();
  const raw: Array<{ a: number; b: number; strength: number }> = [];
  const srng = root.fork('universe:strength');
  for (const list of [...edgeTris.values()].sort((p, q) => p[0]! - q[0]! || (p[1] ?? -1) - (q[1] ?? -1))) {
    if (list.length !== 2) continue;
    const a = nodeOf[list[0]!]!;
    const b = nodeOf[list[1]!]!;
    if (a === b || !limit(pts[a]!) || !limit(pts[b]!)) continue;
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const len = Math.hypot(pts[b]!.x - pts[a]!.x, pts[b]!.z - pts[a]!.z);
    // Short filaments between close nodes run thicker; a few long ones are faint strands.
    const shortness = Math.min(1, Math.max(0, 1.25 - len / (U.voidGap * 1.1)));
    const strength = Math.min(1, Math.max(0, 0.15 + 0.55 * srng.next() ** 0.8 + 0.4 * shortness));
    raw.push({ a: Math.min(a, b), b: Math.max(a, b), strength: round2(strength) });
  }
  const [w0, w1] = U.filamentWidth;
  const links: WebLink[] = raw.map((l) => ({ ...l, w: round2(w0 + (w1 - w0) * l.strength) }));
  const load = pts.map(() => 0);
  for (const l of links) {
    load[l.a]! += l.strength;
    load[l.b]! += l.strength;
  }
  const [r0, r1] = U.nodeRadius;
  const nodes: WebNode[] = pts.map((p, i) => {
    const mass = Math.min(1, Math.max(0, (load[i]! - 0.9) / 2.2));
    return { ...p, r: round2(r0 + (r1 - r0) * mass), mass: round2(mass) };
  });
  const web: UniverseWeb = { voids: voids.map((v) => ({ x: round2(v.x), z: round2(v.z), r: round2(v.r) })), nodes, links };
  if (webCache.size > 6) webCache.delete(webCache.keys().next().value!);
  webCache.set(root.seed, web);
  return web;
}

/** The web's nodes (supercluster centres) on the map for `seed`, in map units. */
export function universeNodes(seed: number | string): Array<{ x: number; z: number }> {
  const m = UNIVERSE.nodeMargin;
  return universeWeb(seed)
    .nodes.filter((n) => n.x >= m && n.x <= UNIVERSE.width - m && n.z >= m && n.z <= UNIVERSE.depth - m)
    .map((n) => ({ x: n.x, z: n.z }));
}

/** Which zone (x, z) lies in: within a node's radius, a filament's half-width, a sheet's reach, or a void. */
export function webZoneAt(web: UniverseWeb, x: number, z: number): UniverseZoneType {
  for (const n of web.nodes) if (Math.abs(n.x - x) < n.r && Math.abs(n.z - z) < n.r && Math.hypot(n.x - x, n.z - z) < n.r) return 'superclusters';
  let edge = Infinity;
  for (const l of web.links) {
    const a = web.nodes[l.a]!;
    const b = web.nodes[l.b]!;
    const reach = l.w + UNIVERSE.sheetWidth;
    if (x < Math.min(a.x, b.x) - reach || x > Math.max(a.x, b.x) + reach || z < Math.min(a.z, b.z) - reach || z > Math.max(a.z, b.z) + reach) continue;
    edge = Math.min(edge, segmentDistance(x, z, a, b).d - l.w);
    if (edge < 0) return 'filaments';
  }
  return edge < UNIVERSE.sheetWidth ? 'sheets' : 'voids';
}

export function generateUniverse(seed: number | string): HouseLayout {
  const root = new Rng(seed);
  const U = UNIVERSE;
  const W = U.width;
  const D = U.depth;
  const web = universeWeb(seed);
  const { nodes, links } = web;

  // ── Zones: superclusters, filaments, sheets, voids ──
  const gw = Math.ceil(W / U.cell);
  const gd = Math.ceil(D / U.cell);
  const grid = new ZoneGrid<UniverseZoneType>(gw, gd, 'voids', FLOORS);
  const ids: Record<UniverseZoneType, number> = {
    voids: 0,
    superclusters: grid.feature('superclusters', 'superclusters'),
    filaments: grid.feature('filaments', 'filaments'),
    sheets: grid.feature('sheets', 'sheets'),
  };
  for (let gz = 0; gz < gd; gz++) {
    for (let gx = 0; gx < gw; gx++) grid.cells[gz * gw + gx] = ids[webZoneAt(web, (gx + 0.5) * U.cell, (gz + 0.5) * U.cell)];
  }
  const rooms = grid.rooms().map((r) => ({
    ...r,
    rect: rect(r.rect.minX * U.cell, r.rect.minZ * U.cell, Math.min(W, r.rect.maxX * U.cell), Math.min(D, r.rect.maxZ * U.cell)),
  }));
  const zoneAt = (x: number, z: number) => grid.typeAt(x / U.cell, z / U.cell);

  // The Bunny arrives on a filament near the middle of the map, `spawnFromNode` along it from a node
  // (preferring a node up the screen, north), clear of every node.
  const cx = W / 2;
  const cz = D / 2;
  let best: { x: number; z: number; node: number; score: number } | null = null;
  for (const l of links) {
    for (const [from, to] of [[l.a, l.b], [l.b, l.a]] as const) {
      const a = nodes[from]!;
      const b = nodes[to]!;
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len < U.spawnFromNode + b.r + 8) continue;
      const x = a.x + ((b.x - a.x) / len) * U.spawnFromNode;
      const z = a.z + ((b.z - a.z) / len) * U.spawnFromNode;
      if (x < 40 || x > W - 40 || z < 40 || z > D - 40 || zoneAt(x, z) !== 'filaments') continue;
      if (nodes.some((n) => Math.hypot(n.x - x, n.z - z) < n.r + 6)) continue;
      // Near the middle, the node north of the spawn, on a thick filament.
      const score = Math.hypot(x - cx, z - cz) + (a.z < z - 4 ? 0 : 40) - l.strength * 20;
      if (!best || score < best.score) best = { x, z, node: from, score };
    }
  }
  const pick = best ?? { x: cx, z: cz, node: -1, score: 0 };
  const spawn = { x: round2(pick.x), z: round2(pick.z), roomId: '' };
  spawn.roomId = rooms.find((r) => rectContains(r.rect, spawn.x, spawn.z))!.id;

  // ── Placements: the Great Attractor on the spawn's node, a sock in the first screen ──
  const prng = root.fork('universe:placements');
  const debrisPlacements: DebrisPlacement[] = [];
  const place = (typeId: string, x: number, z: number) => debrisPlacements.push({ typeId, x: round2(x), z: round2(z), rotY: Math.round(prng.range(0, Math.PI * 2) * 1000) / 1000 });
  if (pick.node >= 0) place('great_attractor', nodes[pick.node]!.x, nodes[pick.node]!.z);
  {
    // Beside the filament (across it from the attractor's side), up and to one side of the screen.
    const a = prng.range(-2.4, -0.7);
    place('universe_sock', spawn.x + Math.cos(a) * U.sockDistance, spawn.z + Math.sin(a) * U.sockDistance);
  }

  // ── The filaments wholly on the map as routes, node to node ──
  const m = U.nodeMargin;
  const inside = (p: { x: number; z: number }) => p.x >= m && p.x <= W - m && p.z >= m && p.z <= D - m;
  const routes: MapRoute[] = links
    .filter((l) => inside(nodes[l.a]!) && inside(nodes[l.b]!))
    .map((l, k) => ({ id: `filament${k}`, kind: 'filament', points: [{ x: nodes[l.a]!.x, z: nodes[l.a]!.z }, { x: nodes[l.b]!.x, z: nodes[l.b]!.z }], width: round2(l.w * 2) }));

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
    debrisPlacements,
    spawn,
    routes,
  };
}
