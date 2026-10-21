/**
 * Renders a HouseLayout: floors, rugs, walls, furniture. Anything between the camera and the
 * Bunny (walls, the couch above a Speck) fades out so the Bunny stays visible.
 */
import {
  Box3,
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Ray,
  Vector3,
  type Material,
  type Object3D,
} from 'three';
import { damp } from '../core/math';
import { FURNITURE } from './furniture';
import { HOUSE } from './house';
import { floorTexture, rugTexture } from './materials';
import { createModel } from './models';
import type { HouseLayout } from './types';

interface Fadeable {
  object: Object3D;
  box: Box3;
  materials: MeshStandardMaterial[];
  opacity: number;
}

const _ray = new Ray();
const _v = new Vector3();
const _dir = new Vector3();

export class HouseView {
  readonly root = new Group();
  private fadeables: Fadeable[] = [];
  /** Furniture objects by FurnitureInstance id. */
  readonly furnitureObjects = new Map<string, Object3D>();

  constructor(readonly layout: HouseLayout) {
    this.root.name = 'house';
    this.buildFloors();
    this.buildWalls();
    this.buildFurniture();
  }

  private buildFloors(): void {
    const b = this.layout.bounds;
    const ground = new Mesh(new PlaneGeometry(8000, 8000), new MeshStandardMaterial({ color: '#2d2520', roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set((b.minX + b.maxX) / 2, -0.5, (b.minZ + b.maxZ) / 2);
    this.root.add(ground);

    for (const room of this.layout.rooms) {
      const w = room.rect.maxX - room.rect.minX;
      const d = room.rect.maxZ - room.rect.minZ;
      const info = floorTexture(room.floor);
      const tex = info.texture.clone();
      tex.repeat.set(w / info.worldSize, d / info.worldSize);
      tex.offset.set(room.rect.minX / info.worldSize, room.rect.minZ / info.worldSize);
      tex.needsUpdate = true;
      const mesh = new Mesh(new PlaneGeometry(w, d), new MeshStandardMaterial({ map: tex, roughness: room.floor.startsWith('tile') ? 0.35 : 0.75 }));
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(room.rect.minX + w / 2, 0, room.rect.minZ + d / 2);
      mesh.receiveShadow = true;
      mesh.name = `floor:${room.id}`;
      this.root.add(mesh);
    }

    for (const rug of this.layout.rugs) {
      const w = rug.rect.maxX - rug.rect.minX;
      const d = rug.rect.maxZ - rug.rect.minZ;
      const mesh = new Mesh(new PlaneGeometry(w, d), new MeshStandardMaterial({ map: rugTexture(rug.seed, w, d), roughness: 1 }));
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(rug.rect.minX + w / 2, 0.12, rug.rect.minZ + d / 2);
      mesh.receiveShadow = true;
      this.root.add(mesh);
    }
  }

  private buildWalls(): void {
    const h = HOUSE.wallHeight;
    for (const wall of this.layout.walls) {
      const w = wall.rect.maxX - wall.rect.minX;
      const d = wall.rect.maxZ - wall.rect.minZ;
      const g = new Group();
      const paint = new MeshStandardMaterial({ color: '#efe6d8', roughness: 0.9 });
      const body = new Mesh(new BoxGeometry(w, h, d), paint);
      body.position.y = h / 2;
      body.castShadow = true;
      body.receiveShadow = true;
      const cap = new Mesh(new BoxGeometry(w, 1, d), new MeshStandardMaterial({ color: '#8a7f72', roughness: 0.9 }));
      cap.position.y = h + 0.5;
      const base = new Mesh(new BoxGeometry(w + 1.2, 8, d + 1.2), new MeshStandardMaterial({ color: '#fbf8f2', roughness: 0.6 }));
      base.position.y = 4;
      base.receiveShadow = true;
      g.add(body, cap, base);
      g.position.set(wall.rect.minX + w / 2, 0, wall.rect.minZ + d / 2);
      this.root.add(g);
      this.addFadeable(g);
    }
  }

  private buildFurniture(): void {
    for (const f of this.layout.furniture) {
      const obj = createModel(f.defId, { w: f.w, d: f.d, h: f.height, seed: hashId(f.id) });
      obj.position.set(f.x, 0, f.z);
      obj.rotation.y = (f.quarterTurns * Math.PI) / 2;
      obj.traverse((o) => {
        if ((o as Mesh).isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      obj.userData.furniture = f;
      obj.userData.def = FURNITURE[f.defId];
      this.root.add(obj);
      this.furnitureObjects.set(f.id, obj);
      this.addFadeable(obj);
    }
  }

  /** Clones materials so the object can fade independently. */
  private addFadeable(object: Object3D): void {
    object.updateMatrixWorld(true);
    const materials: MeshStandardMaterial[] = [];
    object.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      const clone = (m: Material) => {
        const c = (m as MeshStandardMaterial).clone();
        c.transparent = true;
        materials.push(c);
        return c;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(clone) : clone(mesh.material);
    });
    this.fadeables.push({ object, box: new Box3().setFromObject(object), materials, opacity: 1 });
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
      for (const m of f.materials) {
        m.opacity = f.opacity;
        m.depthWrite = f.opacity > 0.98;
      }
      f.object.traverse((o) => {
        o.castShadow = f.opacity > 0.5;
      });
    }
  }

  dispose(): void {
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
