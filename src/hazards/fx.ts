/**
 * Absorb effect: an absorbed Hazard's model shrinks and flies into the Bunny over a short
 * time instead of vanishing. Runs as a System (sim time), installed per Run by installRunHazards.
 */
import type { Object3D } from 'three';
import { lerp } from '../core/math';
import type { Run } from '../game/run';
import type { System } from '../game/system';
import { SYSTEM_ORDER } from '../game/system';

const ABSORB_FX_TIME = 0.4;

interface FxItem {
  obj: Object3D;
  t: number;
  x: number;
  z: number;
  scale: number;
}

export class HazardFx implements System {
  readonly id = 'hazardFx';
  readonly order = SYSTEM_ORDER.hazards + 5;
  private items: FxItem[] = [];

  absorb(run: Run, obj: Object3D): void {
    obj.removeFromParent();
    run.entityRoot.add(obj);
    this.items.push({ obj, t: 0, x: obj.position.x, z: obj.position.z, scale: obj.scale.x });
  }

  update(dt: number, run: Run): void {
    const b = run.bunny;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i]!;
      it.t += dt;
      const k = Math.min(1, it.t / ABSORB_FX_TIME);
      const e = k * k;
      it.obj.position.set(lerp(it.x, b.x, e), b.radius * Math.sin(k * Math.PI) * 0.8, lerp(it.z, b.z, e));
      it.obj.scale.setScalar(it.scale * (1 - e) + 1e-3);
      it.obj.rotation.y += dt * 10;
      if (k >= 1) {
        it.obj.removeFromParent();
        this.items.splice(i, 1);
      }
    }
  }

  dispose(): void {
    for (const it of this.items) it.obj.removeFromParent();
    this.items = [];
  }
}

/** Plays the absorb effect if the Run has the fx system (headless Runs simply skip it). */
export function playAbsorbFx(run: Run, obj: Object3D): void {
  run.getSystem<HazardFx>('hazardFx')?.absorb(run, obj);
}
