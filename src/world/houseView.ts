/**
 * Renders a HouseLayout: floors, rugs, walls with baseboards, furniture and soft contact
 * shadows. The house's front door swings open once `layout.exit.open` is set, with a light
 * shaft marking the way out. Neighborhood layouts render their walls as a hedge, a grass
 * ground plane and painted road markings. Anything between the camera and the Bunny (walls, the couch above a Speck) fades out
 * so the Bunny stays visible.
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
import { ContactShadows } from '../fx/contactShadows';
import { FURNITURE } from './furniture';
import { HOUSE } from './house';
import { addFloorDetail, floorTexture, rugTexture } from './materials';
import { createModel } from './models';
import './outdoorModels';
import './cityModels';
import { StaticBatch } from './staticBatch';
import type { FloorMaterialId, HouseLayout } from './types';

interface Fadeable {
  /** Original meshes, shown only while fading. */
  object: Object3D;
  box: Box3;
  materials: MeshStandardMaterial[];
  opacity: number;
  batchId: number;
}

const _ray = new Ray();
const _ray2 = new Ray();
const _v = new Vector3();
const _dir = new Vector3();
const _dir2 = new Vector3();

const WALL_PAINT = '#f1e6d6';
const WALL_CAP = '#8a7a6a';
const BASEBOARD = '#fbf6ee';
const BASEBOARD_H = 9;
const HEDGE = '#3f6b34';
const HEDGE_TOP = '#4f7f3f';
const DOOR_WOOD = '#8a5a3b';
const BARRIER = '#b9b4aa';
const BARRIER_STRIPE = '#e0a526';
const GROUND: Record<HouseLayout['area'], string> = { house: '#2d2520', neighborhood: '#4d7434', city: '#4f5257' };

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

  constructor(readonly layout: HouseLayout) {
    this.root.name = layout.area;
    this.batch = new StaticBatch(`${layout.area}:static`, 2048);
    this.buildFloors();
    this.buildMarkings();
    if (layout.area === 'neighborhood') this.buildHedges();
    else if (layout.area === 'city') this.buildBarriers();
    else this.buildWalls();
    this.buildFurniture();
    this.root.add(this.batch.build());
    this.buildContactShadows();
    if (layout.area === 'house') this.buildFrontDoor();
    else this.buildRoadGate();
  }

  private buildFloors(): void {
    const b = this.layout.bounds;
    const groundSize = Math.max(8000, (b.maxX - b.minX) * 4);
    const ground = new Mesh(new PlaneGeometry(groundSize, groundSize), new MeshStandardMaterial({ color: GROUND[this.layout.area], roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set((b.minX + b.maxX) / 2, -0.5, (b.minZ + b.maxZ) / 2);
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
      addFloorDetail(mat, info.worldSize / (id === 'carpet' ? 3 : 7), id.startsWith('tile') ? 0.12 : 0.3);
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
    for (const m of marks) {
      const r = m.rect;
      const y = this.layout.area === 'city' ? 2 : 0.25;
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
   * Neighborhood exit to the city: two striped boom barriers across the road opening with a
   * "road closed" sign between them. Once the exit opens the booms swing up, the sign sinks
   * and a light shaft marks the way (updateRoadGate).
   */
  private buildRoadGate(): void {
    const exit = this.layout.exit;
    if (!exit) return;
    const r = exit.rect;
    const alongZ = exit.dir.x !== 0;
    const width = alongZ ? r.maxZ - r.minZ : r.maxX - r.minX;
    const cx = (r.minX + r.maxX) / 2;
    const cz = (r.minZ + r.maxZ) / 2;
    const red = new MeshStandardMaterial({ color: '#d0342c', roughness: 0.6 });
    const white = new MeshStandardMaterial({ color: '#f4f1ea', roughness: 0.6 });
    const post = new MeshStandardMaterial({ color: '#5b5f66', roughness: 0.5, metalness: 0.4 });
    const armLen = width / 2 - 20;
    const armH = 110;
    for (const end of [-1, 1]) {
      // Post at each end of the opening; the arm reaches towards the middle.
      const g = new Group();
      const p = new Mesh(new BoxGeometry(30, armH + 30, 30), post);
      p.position.y = (armH + 30) / 2;
      g.add(p);
      const arm = new Group();
      arm.position.y = armH;
      const n = 8;
      for (let i = 0; i < n; i++) {
        const seg = new Mesh(new BoxGeometry(alongZ ? 14 : armLen / n, 14, alongZ ? armLen / n : 14), i % 2 ? white : red);
        const t = (armLen / n) * (i + 0.5);
        if (alongZ) seg.position.z = -end * t;
        else seg.position.x = -end * t;
        arm.add(seg);
      }
      g.add(arm);
      g.position.set(alongZ ? cx : cx + end * (width / 2 - 10), 0, alongZ ? cz + end * (width / 2 - 10) : cz);
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
    const board = new Mesh(new BoxGeometry(alongZ ? 8 : 260, 90, alongZ ? 260 : 8), new MeshStandardMaterial({ color: '#f08a24', roughness: 0.6 }));
    board.position.y = 120;
    const band = new Mesh(new BoxGeometry(alongZ ? 10 : 230, 26, alongZ ? 230 : 10), white);
    band.position.y = 120;
    sign.add(board, band);
    for (const s of [-1, 1]) {
      const leg = new Mesh(new BoxGeometry(10, 120, 10), post);
      leg.position.set(alongZ ? 0 : s * 110, 60, alongZ ? s * 110 : 0);
      sign.add(leg);
    }
    sign.position.set(cx - exit.dir.x * 160, 0, cz - exit.dir.z * 160);
    sign.traverse((o) => {
      o.castShadow = true;
    });
    sign.name = 'roadGateSign';
    this.root.add(sign);
    this.gateSign = sign;

    const beam = new Mesh(
      new CylinderGeometry(width * 0.3, width * 0.5, 600, 24, 1, true),
      new MeshBasicMaterial({ color: '#fff1c4', transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, fog: false }),
    );
    beam.position.set(cx - exit.dir.x * width * 0.3, 300, cz - exit.dir.z * width * 0.3);
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
      this.gateSign.position.y = -ease * 220;
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
    this.updateFrontDoor(frameDt);
    this.updateRoadGate(frameDt);
    // Two sight lines: to the centre and to the lower part of the ball (so a table top that
    // hides the bottom half still fades).
    _v.set(bunnyX, bunnyY, bunnyZ);
    _dir.subVectors(_v, camera);
    const dist = _dir.length();
    _ray.set(camera, _dir.normalize());
    _v.set(bunnyX, bunnyY * 0.35, bunnyZ);
    _dir2.subVectors(_v, camera);
    const dist2 = _dir2.length();
    _ray2.set(camera, _dir2.normalize());
    for (const f of this.fadeables) {
      let hit = _ray.intersectBox(f.box, _v);
      let blocking = hit !== null && hit.distanceTo(camera) < dist - radius * 0.5;
      if (!blocking) {
        hit = _ray2.intersectBox(f.box, _v);
        blocking = hit !== null && hit.distanceTo(camera) < dist2 - radius * 0.5;
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
