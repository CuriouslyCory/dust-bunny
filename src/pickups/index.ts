/**
 * Pickup extension point. No Pickups are defined yet; register PickupDefs here.
 *
 * PickupManager (a System) holds Pickups lying on the floor and active timed effects.
 * Touching a floor Pickup calls def.apply(run); if the def has a duration and apply returns
 * an undo function, it is called when the effect expires. Typical apply: add a timed stat
 * modifier with source `pickup:<id>` (then no undo is needed), or push a Bunny damage filter.
 */
import { Mesh, MeshStandardMaterial, SphereGeometry, type Object3D } from 'three';
import { Registry } from '../core/registry';
import type { Rng } from '../core/rng';
import type { Run } from '../game/run';
import { SYSTEM_ORDER, type System } from '../game/system';

export interface PickupDef {
  id: string;
  name: string;
  description: string;
  color: string;
  /** Seconds the effect lasts (omit for instant effects). Scaled by manager.durationScale. */
  duration?: number;
  spawnWeight: number;
  /** Applies the effect; may return an undo callback run on expiry. */
  apply(run: Run, duration: number): (() => void) | void;
  /** Custom floor visual; defaults to a glowing sphere. Size is in Bunny-radius-independent cm. */
  createObject?(radius: number): Object3D;
}

export const pickupRegistry = new Registry<PickupDef>('pickup');

export interface FloorPickup {
  id: number;
  def: PickupDef;
  x: number;
  z: number;
  radius: number;
  object3d: Object3D;
}

export interface ActiveEffect {
  def: PickupDef;
  remaining: number;
  duration: number;
  undo?: () => void;
}

export class PickupManager implements System {
  readonly id = 'pickups';
  readonly order = SYSTEM_ORDER.pickups;
  readonly floor: FloorPickup[] = [];
  readonly active: ActiveEffect[] = [];
  /** Multiplies effect durations (Hoarder Perk). */
  durationScale = 1;
  /** Pluggable spawn policy (Pickup spawning is not implemented in core). */
  director: ((dt: number, run: Run, manager: PickupManager) => void) | null = null;
  private nextId = 1;

  constructor(
    private readonly run: Run,
    readonly rng: Rng,
  ) {}

  spawn(defId: string, x: number, z: number, radius?: number): FloorPickup {
    const def = pickupRegistry.require(defId);
    const r = radius ?? Math.max(0.5, this.run.bunny.radius * 0.6);
    const object3d =
      def.createObject?.(r) ??
      new Mesh(new SphereGeometry(r, 16, 12), new MeshStandardMaterial({ color: def.color, emissive: def.color, emissiveIntensity: 0.8 }));
    object3d.position.set(x, r, z);
    this.run.entityRoot.add(object3d);
    const p: FloorPickup = { id: this.nextId++, def, x, z, radius: r, object3d };
    this.floor.push(p);
    this.run.events.emit('pickupSpawned', { pickupId: p.id, defId });
    return p;
  }

  /** Applies a Pickup effect directly (also used when collecting). */
  activate(def: PickupDef): void {
    const duration = (def.duration ?? 0) * this.durationScale;
    const undo = def.apply(this.run, duration) ?? undefined;
    if (duration > 0) this.active.push({ def, remaining: duration, duration, undo });
  }

  update(dt: number, run: Run): void {
    this.director?.(dt, run, this);
    const b = run.bunny;
    for (let i = this.floor.length - 1; i >= 0; i--) {
      const p = this.floor[i]!;
      const rr = b.radius + p.radius;
      if ((p.x - b.x) ** 2 + (p.z - b.z) ** 2 > rr * rr) continue;
      this.floor.splice(i, 1);
      p.object3d.removeFromParent();
      run.events.emit('pickupCollected', { pickupId: p.id, defId: p.def.id });
      this.activate(p.def);
    }
    for (let i = this.active.length - 1; i >= 0; i--) {
      const e = this.active[i]!;
      e.remaining -= dt;
      if (e.remaining <= 0) {
        this.active.splice(i, 1);
        e.undo?.();
        run.events.emit('pickupExpired', { defId: e.def.id });
      }
    }
  }

  dispose(): void {
    for (const p of this.floor) p.object3d.removeFromParent();
    this.floor.length = 0;
    this.active.length = 0;
  }
}
