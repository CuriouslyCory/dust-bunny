/** Mirrors a DebrisField into one InstancedMesh per Debris type (instance index = slot). */
import { DynamicDrawUsage, Euler, Group, InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three';
import type { DebrisField, Debris } from './debris';
import { debrisColors, debrisGeometry, debrisMaterial } from './debrisGeometry';

const _m = new Matrix4();
const _q = new Quaternion();
const _e = new Euler();
const _p = new Vector3();
const _s = new Vector3();

export function debrisMatrix(d: Debris, out: Matrix4): Matrix4 {
  _e.set(0, d.rotY, 0);
  _q.setFromEuler(_e);
  _p.set(d.x, 0, d.z);
  _s.setScalar(d.size);
  return out.compose(_p, _q, _s);
}

export class DebrisRenderer {
  readonly root = new Group();
  private meshes: Array<InstancedMesh | null>;

  constructor(private readonly field: DebrisField) {
    this.root.name = 'debris';
    this.meshes = field.types.map(() => null);
    // Write everything once.
    field.drainDirty();
    field.types.forEach((_, i) => this.rebuild(i));
  }

  private rebuild(typeIndex: number): void {
    const bucket = this.field.buckets[typeIndex]!;
    const old = this.meshes[typeIndex];
    const needed = bucket.length;
    if (old && old.instanceMatrix.count >= needed) return;
    let cap = 32;
    while (cap < needed) cap *= 2;
    if (old) {
      old.removeFromParent();
      old.dispose();
    }
    if (needed === 0 && !old) return;
    const type = this.field.types[typeIndex]!;
    const mesh = new InstancedMesh(debrisGeometry(type), debrisMaterial(type), cap);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.frustumCulled = false; // instances span the whole house
    mesh.receiveShadow = true;
    mesh.castShadow = type.size >= 3;
    mesh.name = `debris:${type.id}`;
    const colors = debrisColors(type);
    for (const d of bucket) {
      mesh.setMatrixAt(d.slot, debrisMatrix(d, _m));
      mesh.setColorAt(d.slot, colors[d.colorIndex]!);
    }
    if (bucket.length === 0) mesh.setColorAt(0, colors[0]!); // allocate instanceColor
    mesh.count = bucket.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.meshes[typeIndex] = mesh;
    this.root.add(mesh);
  }

  /** Apply changes since last frame. */
  sync(): void {
    const dirty = this.field.drainDirty();
    const touched = new Set<number>();
    for (const d of dirty) {
      if (!d.alive) continue;
      const bucket = this.field.buckets[d.typeIndex]!;
      if (bucket[d.slot] !== d) continue;
      let mesh = this.meshes[d.typeIndex];
      if (!mesh || mesh.instanceMatrix.count <= d.slot) {
        this.rebuild(d.typeIndex);
        continue;
      }
      mesh.setMatrixAt(d.slot, debrisMatrix(d, _m));
      mesh.setColorAt(d.slot, debrisColors(d.type)[d.colorIndex]!);
      touched.add(d.typeIndex);
    }
    for (let i = 0; i < this.meshes.length; i++) {
      const mesh = this.meshes[i];
      if (!mesh) continue;
      const n = this.field.buckets[i]!.length;
      if (mesh.count !== n) mesh.count = n;
      mesh.visible = n > 0;
      if (touched.has(i)) {
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
    }
  }

  dispose(): void {
    for (const m of this.meshes) m?.dispose();
    this.root.removeFromParent();
  }
}
