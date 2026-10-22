/**
 * Renders a HouseLayout: floors, rugs, walls with baseboards, furniture and soft contact
 * shadows. The house's front door swings open once `layout.exit.open` is set, with a light
 * shaft marking the way out. Neighborhood layouts render their walls as a hedge, a grass
 * ground plane and painted road markings; the Region (seen from altitude: its unit is above 1 cm)
 * a wooded ridge edge and a floor that carries on into the haze; the Continent a coast, with the
 * sea past it reaching to the horizon (continentCoast.ts). Anything
 * between the camera and the Bunny (walls, the couch above a Speck) fades out so the Bunny stays visible.
 *
 * Draw-call budget: walls + furniture are baked into one StaticBatch (1 call + shadow), floors
 * are one mesh per floor material with world-space UVs, contact shadows are one mesh. While an
 * object fades it is hidden in the batch and its original (unbatched) meshes are drawn with
 * real transparency instead.
 */
import {
  AdditiveBlending,
  Box3,
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  MeshBasicMaterial,
  Ray,
  Vector3,
  type Material,
  type Object3D,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { damp } from '../core/math';
import { Rng } from '../core/rng';
import { ContactShadows } from '../fx/contactShadows';
import { FURNITURE } from './furniture';
import { HOUSE } from './house';
import { addFloorDetail, floorTexture, rugTexture } from './materials';
import { createModel } from './models';
import './outdoorModels';
import './cityModels';
import { forestedMound, regionRoadblock } from './regionModels';
import './continentModels';
import { buildContinentWater } from './continentCoast';
import { StaticBatch } from './staticBatch';
import { areaUnit } from '../data/areas';
import type { AreaId, FloorMaterialId, HouseLayout } from './types';
import { wrapCopies, wrapWidth } from './wrap';

interface Fadeable {
  /** Original meshes, shown only while fading. */
  object: Object3D;
  box: Box3;
  materials: MeshStandardMaterial[];
  opacity: number;
  batchId: number;
}

const _rays: Array<{ ray: Ray; dist: number }> = [];
const _v = new Vector3();
const _dir = new Vector3();

const WALL_PAINT = '#f1e6d6';
const WALL_CAP = '#8a7a6a';
const BASEBOARD = '#fbf6ee';
const BASEBOARD_H = 9;
const HEDGE = '#3f6b34';
const HEDGE_TOP = '#4f7f3f';
const DOOR_WOOD = '#8a5a3b';
const BARRIER = '#b9b4aa';
const BARRIER_STRIPE = '#e0a526';
const GROUND: Record<AreaId, string> = { house: '#2d2520', neighborhood: '#4d7434', city: '#4f5257', region: '#a3a993', continent: '#d4dbe3', globe: '#16365a' };
/** How each Area's edge (`layout.walls`) is drawn. */
/** How the map's edge is drawn; `wrap`: none east–west (the map repeats) and nothing past the poles but the outer floor. */
const EDGE: Record<AreaId, 'walls' | 'hedges' | 'barriers' | 'ridges' | 'coast' | 'wrap'> = {
  house: 'walls',
  neighborhood: 'hedges',
  city: 'barriers',
  region: 'ridges',
  continent: 'coast',
  globe: 'wrap',
};
/** Areas seen from altitude: the floor that carries on past the map edge into the haze (the Continent's ocean). */
const OUTER_FLOOR: Partial<Record<AreaId, FloorMaterialId>> = { region: 'fields', continent: 'ocean', globe: 'tundraSnow' };
/**
 * Road-gate size (exit booms and sign, cm-sized parts × this) per Area: a neighborhood street, a
 * city avenue (3.5×) and a Region motorway (6 units of 10 m across).
 */
const GATE_SCALE: Partial<Record<AreaId, number>> = { neighborhood: 1, city: 3.5, region: 0.008, continent: 0.03 };

/** The Area is seen from altitude (its unit is above 1 cm): Region-style floors, markings and shadows. */
function fromAltitude(area: AreaId): boolean {
  return areaUnit(area) > 1;
}

export class HouseView {
  readonly root = new Group();
  private fadeables: Fadeable[] = [];
  private readonly batch: StaticBatch;
  /** Furniture objects by FurnitureInstance id (unbatched originals, hidden unless fading). */
  readonly furnitureObjects = new Map<string, Object3D>();
  /** Front door leaf (pivot at the hinge) and the light shaft shown once it opens. */
  private door: Group | null = null;
  /** Neighborhood road barrier to the city: boom arms (pivot at their posts) and the sign. */
  private booms: Array<{ arm: Group; sign: number }> = [];
  private gateSign: Group | null = null;
  private doorOpen = 0;
  private beacon: Mesh | null = null;
  private time = 0;
  /** On a map that wraps east–west: the map drawn three times (laps −1, 0, +1), moved to the camera's lap each frame. */
  private lap: Group | null = null;

  constructor(readonly layout: HouseLayout) {
    this.root.name = layout.area;
    this.batch = new StaticBatch(`${layout.area}:static`, 2048);
    this.buildFloors();
    this.buildMarkings();
    const edge = EDGE[layout.area];
    if (edge === 'hedges') this.buildHedges();
    else if (edge === 'barriers') this.buildBarriers();
    else if (edge === 'ridges') this.buildRidges();
    else if (edge === 'coast') this.root.add(buildContinentWater(layout));
    else if (edge === 'walls') this.buildWalls();
    this.buildFurniture();
    this.root.add(this.batch.build());
    this.buildContactShadows();
    if (layout.area === 'house') this.buildFrontDoor();
    else this.buildRoadGate();
    if (layout.wrapX) this.buildLaps();
  }

  /**
   * A map that wraps east–west: everything but the outer ground goes into one lap that is drawn
   * again one width east and west (clones share geometry and materials), so the view sees the
   * map carry on past either edge. `update` moves the laps to the camera's.
   */
  private buildLaps(): void {
    const w = wrapWidth(this.layout);
    const lap = new Group();
    lap.name = 'laps';
    const tile = new Group();
    tile.name = 'lap:0';
    for (const child of [...this.root.children]) (child.name === 'ground' ? lap : tile).add(child);
    lap.add(tile);
    for (const k of [-1, 1]) {
      const copy = tile.clone();
      copy.name = `lap:${k}`;
      copy.position.x = k * w;
      lap.add(copy);
    }
    this.root.add(lap);
    this.lap = lap;
  }

  private buildFloors(): void {
    const b = this.layout.bounds;
    const altitude = fromAltitude(this.layout.area);
    const outer = OUTER_FLOOR[this.layout.area];
    const groundSize = altitude ? (b.maxX - b.minX) * 4 : Math.max(8000, (b.maxX - b.minX) * 4);
    const groundMat = new MeshStandardMaterial({ color: GROUND[this.layout.area], roughness: outer ? floorTexture(outer).roughness : 1 });
    if (outer) {
      // The land carries on past the edge into the haze (slightly darker, so the map reads as the lit part).
      const info = floorTexture(outer);
      const map = info.texture.clone();
      map.repeat.set(groundSize / info.worldSize, groundSize / info.worldSize);
      map.needsUpdate = true;
      groundMat.map = map;
    }
    const ground = new Mesh(new PlaneGeometry(groundSize, groundSize), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set((b.minX + b.maxX) / 2, altitude ? -0.05 : -0.5, (b.minZ + b.maxZ) / 2);
    ground.receiveShadow = altitude;
    ground.name = 'ground';
    this.root.add(ground);

    // One mesh per floor material; UVs are world-space so a single shared texture tiles seamlessly.
    const byFloor = new Map<FloorMaterialId, BufferGeometry[]>();
    for (const room of this.layout.rooms) {
      const info = floorTexture(room.floor);
      const r = room.rect;
      const g = new BufferGeometry();
      const y = 0;
      g.setAttribute('position', new Float32BufferAttribute([r.minX, y, r.minZ, r.minX, y, r.maxZ, r.maxX, y, r.maxZ, r.maxX, y, r.minZ], 3));
      g.setAttribute('normal', new Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
      const s = 1 / info.worldSize;
      g.setAttribute('uv', new Float32BufferAttribute([r.minX * s, -r.minZ * s, r.minX * s, -r.maxZ * s, r.maxX * s, -r.maxZ * s, r.maxX * s, -r.minZ * s], 2));
      g.setIndex([0, 1, 2, 0, 2, 3]);
      let list = byFloor.get(room.floor);
      if (!list) byFloor.set(room.floor, (list = []));
      list.push(g);
    }
    for (const [id, geos] of byFloor) {
      const info = floorTexture(id);
      const mat = new MeshStandardMaterial({ map: info.texture, roughness: info.roughness, metalness: 0 });
      // Fine grain over the map: a ~7-unit tile up close in cm; from altitude a 2.5-unit tile (25 m in the Region), fainter.
      if (altitude) addFloorDetail(mat, info.worldSize / 2.5, 0.16);
      else addFloorDetail(mat, info.worldSize / (id === 'carpet' ? 3 : 7), id.startsWith('tile') ? 0.12 : 0.3);
      const mesh = new Mesh(mergeGeometries(geos, false)!, mat);
      for (const g of geos) g.dispose();
      mesh.receiveShadow = true;
      mesh.name = `floor:${id}`;
      this.root.add(mesh);
    }

    for (const rug of this.layout.rugs) {
      const w = rug.rect.maxX - rug.rect.minX;
      const d = rug.rect.maxZ - rug.rect.minZ;
      const mat = new MeshStandardMaterial({ map: rugTexture(rug.seed, w, d), roughness: 1 });
      addFloorDetail(mat, w / 3, 0.45);
      const mesh = new Mesh(new PlaneGeometry(w, d), mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(rug.rect.minX + w / 2, 0.12, rug.rect.minZ + d / 2);
      mesh.receiveShadow = true;
      mesh.name = 'rug';
      this.root.add(mesh);
    }
  }

  private buildWalls(): void {
    const h = HOUSE.wallHeight;
    const paint = new MeshStandardMaterial({ color: WALL_PAINT, roughness: 0.92 });
    const capMat = new MeshStandardMaterial({ color: WALL_CAP, roughness: 0.9 });
    const baseMat = new MeshStandardMaterial({ color: BASEBOARD, roughness: 0.55 });
    for (const wall of this.layout.walls) {
      const w = wall.rect.maxX - wall.rect.minX;
      const d = wall.rect.maxZ - wall.rect.minZ;
      const g = new Group();
      const body = new Mesh(new BoxGeometry(w, h, d), paint);
      body.position.y = h / 2;
      const cap = new Mesh(new BoxGeometry(w, 1, d), capMat);
      cap.position.y = h + 0.5;
      // Baseboard with a thin rounded-looking lip on top.
      const base = new Mesh(new BoxGeometry(w + 2.4, BASEBOARD_H, d + 2.4), baseMat);
      base.position.y = BASEBOARD_H / 2;
      const lip = new Mesh(new BoxGeometry(w + 3, 1.2, d + 3), baseMat);
      lip.position.y = BASEBOARD_H + 0.2;
      g.add(body, cap, base, lip);
      g.position.set(wall.rect.minX + w / 2, 0, wall.rect.minZ + d / 2);
      g.name = `wall:${wall.id}`;
      this.addStatic(g);
    }
  }

  /** Painted ground shapes (road lines, crosswalks, front walks): one vertex-coloured mesh. */
  private buildMarkings(): void {
    const marks = this.layout.markings ?? [];
    if (marks.length === 0) return;
    const pos: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    const c = new Color();
    // Height above the floor (and per layer): cm indoors and outdoors; from altitude 0.03 units (30 cm of the
    // Region's 10 m units), which keeps the lane lines under the cars (≈0.15 units tall).
    const [y0, step] = this.layout.area === 'city' ? [2, 1] : fromAltitude(this.layout.area) ? [0.03, 0.03] : [0.25, 0.1];
    for (const m of marks) {
      const r = m.rect;
      const y = y0 + (m.layer ?? 0) * step;
      const i = pos.length / 3;
      pos.push(r.minX, y, r.minZ, r.minX, y, r.maxZ, r.maxX, y, r.maxZ, r.maxX, y, r.minZ);
      c.set(m.color);
      for (let k = 0; k < 4; k++) col.push(c.r, c.g, c.b);
      idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new Float32BufferAttribute(new Array(pos.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    g.setAttribute('color', new Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    const mesh = new Mesh(g, new MeshStandardMaterial({ vertexColors: true, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -2 }));
    mesh.receiveShadow = true;
    mesh.name = 'markings';
    this.root.add(mesh);
  }

  /** Neighborhood edge: a clipped hedge along each wall obstacle. */
  private buildHedges(): void {
    const body = new MeshStandardMaterial({ color: HEDGE, roughness: 1 });
    const top = new MeshStandardMaterial({ color: HEDGE_TOP, roughness: 1 });
    for (const wall of this.layout.walls) {
      const w = wall.rect.maxX - wall.rect.minX;
      const d = wall.rect.maxZ - wall.rect.minZ;
      const h = wall.height;
      const g = new Group();
      const m = new Mesh(new BoxGeometry(w, h, d), body);
      m.position.y = h / 2;
      const cap = new Mesh(new BoxGeometry(w + 16, 24, d + 16), top);
      cap.position.y = h - 4;
      g.add(m, cap);
      g.position.set(wall.rect.minX + w / 2, 0, wall.rect.minZ + d / 2);
      g.name = `hedge:${wall.id}`;
      this.addStatic(g);
    }
  }

  /** City edge: a concrete barrier with a hazard-yellow stripe along each wall obstacle. */
  private buildBarriers(): void {
    const body = new MeshStandardMaterial({ color: BARRIER, roughness: 0.95 });
    const stripe = new MeshStandardMaterial({ color: BARRIER_STRIPE, roughness: 0.8 });
    for (const wall of this.layout.walls) {
      const w = wall.rect.maxX - wall.rect.minX;
      const d = wall.rect.maxZ - wall.rect.minZ;
      const h = wall.height;
      const g = new Group();
      const m = new Mesh(new BoxGeometry(w, h, d), body);
      m.position.y = h / 2;
      const band = new Mesh(new BoxGeometry(w + 8, h * 0.18, d + 8), stripe);
      band.position.y = h * 0.62;
      const foot = new Mesh(new BoxGeometry(w + 40, h * 0.2, d + 40), body);
      foot.position.y = h * 0.1;
      g.add(m, band, foot);
      g.position.set(wall.rect.minX + w / 2, 0, wall.rect.minZ + d / 2);
      g.name = `barrier:${wall.id}`;
      this.addStatic(g);
    }
  }

  /**
   * Region edge, in the Area's unit: a dark tree line along each ridge obstacle with rolling wooded
   * hills rising just outside it, a second, higher row behind (none on the south side, where the
   * camera looks over it), in ~18-unit pieces so only the piece between the camera and the Bunny
   * fades. Where a motorway leaves the map: a closed roadblock across the carriageways.
   */
  private buildRidges(): void {
    const b = this.layout.bounds;
    const rng = new Rng((this.layout.seed ^ 0x2e6) >>> 0);
    const treeLine = new MeshStandardMaterial({ color: '#3f5230', roughness: 1 });
    const near = { low: '#6f7f45', high: '#4f6236', square: 2.6, noise: 0.25 };
    const far = { low: '#66764a', high: '#56664a', square: 2.4, noise: 0.3 };
    for (const wall of this.layout.walls) {
      const r = wall.rect;
      if (wall.id.startsWith('roadblock')) {
        this.addStatic(regionRoadblock(r));
        continue;
      }
      const alongX = r.maxX - r.minX > r.maxZ - r.minZ;
      const len = alongX ? r.maxX - r.minX : r.maxZ - r.minZ;
      const thick = alongX ? r.maxZ - r.minZ : r.maxX - r.minX;
      const out = alongX ? (r.minZ + r.maxZ < b.minZ + b.maxZ ? -1 : 1) : r.minX + r.maxX < b.minX + b.maxX ? -1 : 1;
      const inner = alongX ? (out < 0 ? r.maxZ : r.minZ) : out < 0 ? r.maxX : r.minX;
      const south = alongX && out > 0;
      const pieces = Math.max(1, Math.round(len / 18));
      const pl = len / pieces;
      const a0 = alongX ? r.minX : r.minZ;
      for (let p = 0; p < pieces; p++) {
        const g = new Group();
        const s0 = a0 + p * pl;
        const strip = new Mesh(new BoxGeometry(alongX ? pl : thick, 0.7, alongX ? thick : pl), treeLine);
        strip.position.set(alongX ? s0 + pl / 2 : (r.minX + r.maxX) / 2, 0.35, alongX ? (r.minZ + r.maxZ) / 2 : s0 + pl / 2);
        g.add(strip);
        const rows: Array<{ n: number; depth: [number, number]; h: [number, number]; gap: [number, number]; look: typeof near; trees: number }> = [
          { n: rng.int(2, 3), depth: south ? [8, 13] : [10, 20], h: south ? [1.2, 2.6] : [2.5, 6], gap: [0, 0], look: near, trees: 12 },
        ];
        if (!south) rows.push({ n: rng.int(1, 2), depth: [16, 28], h: [5, 10], gap: [6, 14], look: far, trees: 8 });
        for (const row of rows) {
          for (let k = 0; k < row.n; k++) {
            const wA = pl * rng.range(0.6, 1);
            const c = s0 + rng.range(wA / 2, pl - wA / 2);
            const dO = rng.range(...row.depth);
            const off = inner + out * (rng.range(...row.gap) + dO / 2);
            const mound = forestedMound(alongX ? wA : dO, alongX ? dO : wA, rng.range(...row.h), rng.int(1, 1e9), row.look, row.trees, 0.9);
            mound.position.set(alongX ? c : off, 0, alongX ? off : c);
            g.add(mound);
          }
        }
        g.name = `ridge:${wall.id}:${p}`;
        this.addStatic(g);
      }
    }
  }

  /**
   * Neighborhood exit to the city, the city's highway on-ramp and the Region's motorway west: two
   * striped boom barriers across the road opening with a "road closed" sign between them (sized by
   * GATE_SCALE). Once the exit opens the booms swing up, the sign sinks and a light shaft marks the
   * way (updateRoadGate).
   */
  private buildRoadGate(): void {
    const exit = this.layout.exit;
    if (!exit) return;
    const k = GATE_SCALE[this.layout.area] ?? 1;
    const r = exit.rect;
    const alongZ = exit.dir.x !== 0;
    const width = alongZ ? r.maxZ - r.minZ : r.maxX - r.minX;
    const cx = (r.minX + r.maxX) / 2;
    const cz = (r.minZ + r.maxZ) / 2;
    const red = new MeshStandardMaterial({ color: '#d0342c', roughness: 0.6 });
    const white = new MeshStandardMaterial({ color: '#f4f1ea', roughness: 0.6 });
    const post = new MeshStandardMaterial({ color: '#5b5f66', roughness: 0.5, metalness: 0.4 });
    const armLen = width / 2 - 20 * k;
    const armH = 110 * k;
    for (const end of [-1, 1]) {
      // Post at each end of the opening; the arm reaches towards the middle.
      const g = new Group();
      const p = new Mesh(new BoxGeometry(30 * k, armH + 30 * k, 30 * k), post);
      p.position.y = (armH + 30 * k) / 2;
      g.add(p);
      const arm = new Group();
      arm.position.y = armH;
      const n = 8;
      for (let i = 0; i < n; i++) {
        const seg = new Mesh(new BoxGeometry(alongZ ? 14 * k : armLen / n, 14 * k, alongZ ? armLen / n : 14 * k), i % 2 ? white : red);
        const t = (armLen / n) * (i + 0.5);
        if (alongZ) seg.position.z = -end * t;
        else seg.position.x = -end * t;
        arm.add(seg);
      }
      g.add(arm);
      g.position.set(alongZ ? cx : cx + end * (width / 2 - 10 * k), 0, alongZ ? cz + end * (width / 2 - 10 * k) : cz);
      g.traverse((o) => {
        o.castShadow = true;
        o.receiveShadow = true;
      });
      g.name = 'roadGateBoom';
      this.root.add(g);
      this.booms.push({ arm, sign: end });
    }
    // "Road closed" sign on a frame in the middle.
    const sign = new Group();
    const board = new Mesh(new BoxGeometry(alongZ ? 8 * k : 260 * k, 90 * k, alongZ ? 260 * k : 8 * k), new MeshStandardMaterial({ color: '#f08a24', roughness: 0.6 }));
    board.position.y = 120 * k;
    const band = new Mesh(new BoxGeometry(alongZ ? 10 * k : 230 * k, 26 * k, alongZ ? 230 * k : 10 * k), white);
    band.position.y = 120 * k;
    sign.add(board, band);
    for (const s of [-1, 1]) {
      const leg = new Mesh(new BoxGeometry(10 * k, 120 * k, 10 * k), post);
      leg.position.set(alongZ ? 0 : s * 110 * k, 60 * k, alongZ ? s * 110 * k : 0);
      sign.add(leg);
    }
    sign.position.set(cx - exit.dir.x * 160 * k, 0, cz - exit.dir.z * 160 * k);
    sign.traverse((o) => {
      o.castShadow = true;
    });
    sign.name = 'roadGateSign';
    this.root.add(sign);
    this.gateSign = sign;

    const beam = new Mesh(
      new CylinderGeometry(width * 0.3, width * 0.5, 600 * k, 24, 1, true),
      new MeshBasicMaterial({ color: '#fff1c4', transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, fog: false }),
    );
    beam.position.set(cx - exit.dir.x * width * 0.3, 300 * k, cz - exit.dir.z * width * 0.3);
    beam.visible = false;
    beam.name = 'exitBeacon';
    this.root.add(beam);
    this.beacon = beam;
  }

  private updateRoadGate(frameDt: number): void {
    const exit = this.layout.exit;
    if (!exit || this.booms.length === 0 || !exit.open) return;
    this.time += frameDt;
    this.doorOpen = Math.min(1, this.doorOpen + frameDt / 1.4);
    const ease = 1 - (1 - this.doorOpen) ** 3;
    const alongZ = exit.dir.x !== 0;
    for (const { arm, sign } of this.booms) {
      // Lift each arm about the axis through its post, perpendicular to the arm.
      if (alongZ) arm.rotation.x = -sign * ease * Math.PI * 0.45;
      else arm.rotation.z = sign * ease * Math.PI * 0.45;
    }
    if (this.gateSign) {
      this.gateSign.position.y = -ease * 220 * (GATE_SCALE[this.layout.area] ?? 1);
      this.gateSign.visible = ease < 1;
    }
    const beam = this.beacon!;
    beam.visible = true;
    (beam.material as MeshBasicMaterial).opacity = ease * (0.14 + 0.06 * Math.sin(this.time * 3));
  }

  /** The front door: a wooden leaf hinged on one side of the opening, swung open by update(). */
  private buildFrontDoor(): void {
    const exit = this.layout.exit;
    if (!exit) return;
    const r = exit.rect;
    const alongZ = exit.dir.x !== 0;
    const width = alongZ ? r.maxZ - r.minZ : r.maxX - r.minX;
    const h = Math.min(HOUSE.wallHeight - 4, 86);
    const hinge = new Group();
    const leaf = new Mesh(new BoxGeometry(alongZ ? 6 : width, h, alongZ ? width : 6), new MeshStandardMaterial({ color: DOOR_WOOD, roughness: 0.7 }));
    leaf.position.set(alongZ ? 0 : width / 2, h / 2, alongZ ? width / 2 : 0);
    const knob = new Mesh(new BoxGeometry(alongZ ? 10 : 5, 5, alongZ ? 5 : 10), new MeshStandardMaterial({ color: '#d4af37', roughness: 0.3, metalness: 0.8 }));
    knob.position.set(alongZ ? 0 : width - 10, h * 0.48, alongZ ? width - 10 : 0);
    for (const m of [leaf, knob]) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
    hinge.add(leaf, knob);
    hinge.position.set(alongZ ? (r.minX + r.maxX) / 2 : r.minX, 0, alongZ ? r.minZ : (r.minZ + r.maxZ) / 2);
    hinge.name = 'frontDoor';
    this.root.add(hinge);
    this.door = hinge;

    // Daylight shaft through the open door: shown once the door opens.
    const beam = new Mesh(
      new CylinderGeometry(width * 0.35, width * 0.6, 200, 20, 1, true),
      new MeshBasicMaterial({ color: '#fff1c4', transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, fog: false }),
    );
    beam.position.set((r.minX + r.maxX) / 2 - exit.dir.x * width * 0.5, 100, (r.minZ + r.maxZ) / 2 - exit.dir.z * width * 0.5);
    beam.visible = false;
    beam.name = 'exitBeacon';
    this.root.add(beam);
    this.beacon = beam;
  }

  private updateFrontDoor(frameDt: number): void {
    const exit = this.layout.exit;
    if (!exit || !this.door || !exit.open) return;
    this.time += frameDt;
    this.doorOpen = Math.min(1, this.doorOpen + frameDt / 0.9);
    const ease = 1 - (1 - this.doorOpen) ** 3;
    // Swing outwards, away from the house.
    const sign = exit.dir.x !== 0 ? exit.dir.x : -exit.dir.z;
    this.door.rotation.y = sign * ease * Math.PI * 0.55;
    const beam = this.beacon!;
    beam.visible = true;
    (beam.material as MeshBasicMaterial).opacity = ease * (0.16 + 0.07 * Math.sin(this.time * 3));
  }

  private buildFurniture(): void {
    for (const f of this.layout.furniture) {
      const obj = createModel(f.defId, { w: f.w, d: f.d, h: f.height, seed: hashId(f.id) });
      obj.position.set(f.x, 0, f.z);
      obj.rotation.y = (f.quarterTurns * Math.PI) / 2;
      obj.userData.furniture = f;
      obj.userData.def = FURNITURE[f.defId];
      this.furnitureObjects.set(f.id, obj);
      this.addStatic(obj);
    }
  }

  private buildContactShadows(): void {
    const cs = new ContactShadows();
    if (fromAltitude(this.layout.area)) {
      // From altitude (Region units, 10 m): a few metres of soft shade at the foot of the edge and of each landmark.
      // (The Continent's walls are the sea: no shade on the water.)
      if (EDGE[this.layout.area] !== 'coast') for (const wall of this.layout.walls) cs.addRect(wall.rect, 0.8, 0.3, 0, 0.3, 0.015);
      for (const f of this.layout.furniture) cs.addRect(f.rect, 1.2, 0.45, -0.2, 0.6, 0.015);
      const mesh = cs.build();
      mesh.name = 'contactShadows';
      this.root.add(mesh);
      return;
    }
    // Soft darkening along the foot of every wall (fake ambient occlusion).
    for (const wall of this.layout.walls) cs.addRect(wall.rect, 7, 0.32);
    for (const f of this.layout.furniture) {
      const def = FURNITURE[f.defId];
      const raised = (def?.clearance ?? 0) > 0;
      // Furniture on legs gets a lighter, wider shadow; solid pieces a tight dark one.
      cs.addRect(f.rect, raised ? Math.min(30, 6 + (def!.clearance ?? 0) * 0.35) : 5, raised ? 0.3 : 0.5, raised ? -4 : -1);
    }
    const mesh = cs.build();
    mesh.name = 'contactShadows';
    this.root.add(mesh);
  }

  /** Bakes the object into the static batch and keeps the original for fading. */
  private addStatic(object: Object3D): void {
    this.root.add(object);
    object.updateMatrixWorld(true);
    const batchId = this.batch.add(object);
    const materials: MeshStandardMaterial[] = [];
    object.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const clone = (m: Material) => {
        const c = (m as MeshStandardMaterial).clone();
        c.transparent = true;
        materials.push(c);
        return c;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(clone) : clone(mesh.material);
    });
    object.visible = false;
    this.fadeables.push({ object, box: new Box3().setFromObject(object), materials, opacity: 1, batchId });
  }

  /** Fade anything blocking the line from the camera to the Bunny. */
  update(frameDt: number, camera: Vector3, bunnyX: number, bunnyY: number, bunnyZ: number, radius: number): void {
    if (this.lap) this.lap.position.x = wrapCopies(this.layout, camera.x)[1]!;
    this.updateFrontDoor(frameDt);
    this.updateRoadGate(frameDt);
    // Sight lines: to the centre and to the lower part of the ball (so a table top that hides
    // the bottom half still fades); in the city and from altitude also to its left and right edges, since a tower
    // can hide half of a giant Bunny without covering its centre.
    const sides = this.layout.area === 'city' || fromAltitude(this.layout.area) ? [0, -0.75, 0.75] : [0];
    let n = 0;
    for (const sx of sides) {
      for (const yk of sx === 0 ? [1, 0.35] : [0.6]) {
        const ray = (_rays[n] ??= { ray: new Ray(), dist: 0 });
        _v.set(bunnyX + sx * radius, bunnyY * yk, bunnyZ);
        _dir.subVectors(_v, camera);
        ray.dist = _dir.length();
        ray.ray.set(camera, _dir.normalize());
        n++;
      }
    }
    for (const f of this.fadeables) {
      let blocking = false;
      for (let i = 0; i < n && !blocking; i++) {
        const hit = _rays[i]!.ray.intersectBox(f.box, _v);
        blocking = hit !== null && hit.distanceTo(camera) < _rays[i]!.dist - radius * 0.5;
      }
      const target = blocking ? 0.22 : 1;
      if (Math.abs(f.opacity - target) < 0.005) continue;
      f.opacity = damp(f.opacity, target, 10, frameDt);
      if (Math.abs(f.opacity - target) < 0.01) f.opacity = target;
      const solid = f.opacity >= 1;
      this.batch.setVisible(f.batchId, solid);
      f.object.visible = !solid;
      for (const m of f.materials) {
        m.opacity = f.opacity;
        m.depthWrite = f.opacity > 0.98;
      }
      const cast = f.opacity > 0.5;
      f.object.traverse((o) => {
        o.castShadow = cast;
      });
    }
  }

  dispose(): void {
    this.batch.dispose();
    this.root.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
    });
    this.root.removeFromParent();
  }
}

function hashId(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h >>> 0;
}
