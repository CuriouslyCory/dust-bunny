/**
 * Renders a HouseLayout: floors, rugs, walls with baseboards, furniture and soft contact
 * shadows. Anything between the camera and the Bunny (walls, the couch above a Speck) fades out
 * so the Bunny stays visible.
 *
 * Draw-call budget: walls + furniture are baked into one StaticBatch (1 call + shadow), floors
 * are one mesh per floor material with world-space UVs, contact shadows are one mesh. While an
 * object fades it is hidden in the batch and its original (unbatched) meshes are drawn with
 * real transparency instead.
 */
import {
  Box3,
  BoxGeometry,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
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
const _v = new Vector3();
const _dir = new Vector3();

const WALL_PAINT = '#f1e6d6';
const WALL_CAP = '#8a7a6a';
const BASEBOARD = '#fbf6ee';
const BASEBOARD_H = 9;

export class HouseView {
  readonly root = new Group();
  private fadeables: Fadeable[] = [];
  private readonly batch: StaticBatch;
  /** Furniture objects by FurnitureInstance id (unbatched originals, hidden unless fading). */
  readonly furnitureObjects = new Map<string, Object3D>();

  constructor(readonly layout: HouseLayout) {
    this.root.name = 'house';
    this.batch = new StaticBatch('house:static', 2048);
    this.buildFloors();
    this.buildWalls();
    this.buildFurniture();
    this.root.add(this.batch.build());
    this.buildContactShadows();
  }

  private buildFloors(): void {
    const b = this.layout.bounds;
    const ground = new Mesh(new PlaneGeometry(8000, 8000), new MeshStandardMaterial({ color: '#2d2520', roughness: 1 }));
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
    _v.set(bunnyX, bunnyY, bunnyZ);
    _dir.subVectors(_v, camera);
    const dist = _dir.length();
    _ray.set(camera, _dir.normalize());
    for (const f of this.fadeables) {
      const hit = _ray.intersectBox(f.box, _v);
      const blocking = hit !== null && hit.distanceTo(camera) < dist - radius * 0.5;
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
