/** Mirrors a DebrisField into one InstancedMesh per Debris type (instance index = slot). */
import { DynamicDrawUsage, Euler, Group, InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three';
import type { DebrisField, Debris } from './debris';
import { debrisColors, debrisGeometry, debrisMaterial } from './debrisGeometry';

const _m = new Matrix4();
const _q = new Quaternion();
const _e = new Euler();
const _p = new Vector3();
const _s = new Vector3();

export function debrisMatrix(d: Readonly<Debris>, out: Matrix4): Matrix4 {
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
    this.applyChanges(true);
  }

  /** Apply current changes from the field's single-consumer stream. */
  sync(): void {
    this.applyChanges(false);
  }

  private applyChanges(full: boolean): void {
    for (const { typeIndex, instances, changedSlots } of this.field.consumeChanges({ full })) {
      let mesh = this.meshes[typeIndex];
      const needed = instances.length;
      let rebuilt = false;
      if (needed > 0 && (!mesh || mesh.instanceMatrix.count < needed)) {
        let cap = 32;
        while (cap < needed) cap *= 2;
        if (mesh) {
          mesh.removeFromParent();
          mesh.dispose();
        }
        const type = this.field.types[typeIndex]!;
        mesh = new InstancedMesh(debrisGeometry(type), debrisMaterial(type), cap);
        mesh.instanceMatrix.setUsage(DynamicDrawUsage);
        mesh.frustumCulled = false; // instances span the whole Area
        mesh.receiveShadow = true;
        mesh.castShadow = type.size >= 3;
        mesh.name = `debris:${type.id}`;
        this.meshes[typeIndex] = mesh;
        this.root.add(mesh);
        rebuilt = true;
      }
      if (!mesh) continue;
      // A new buffer needs every instance, including previously unchanged slots.
      const slots = rebuilt ? instances.keys() : changedSlots;
      const colors = debrisColors(this.field.types[typeIndex]!);
      for (const slot of slots) {
        const d = instances[slot]!;
        mesh.setMatrixAt(slot, debrisMatrix(d, _m));
        mesh.setColorAt(slot, colors[d.colorIndex]!);
      }
      mesh.count = needed;
      mesh.visible = needed > 0;
      if (rebuilt || changedSlots.length > 0) {
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
