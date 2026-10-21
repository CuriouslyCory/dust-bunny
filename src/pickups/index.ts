/**
 * Pickup extension point. The six design Pickups are registered in ./pickups.ts and spawned
 * by ./director.ts (installed per Run from src/meta/install.ts).
 *
 * PickupManager (a System) holds Pickups lying on the floor and active timed effects.
 * Touching a floor Pickup calls def.apply(run, duration); if the def has a duration and apply
 * returns an undo function, it is called when the effect expires. Collecting a timed Pickup
 * that is already active undoes and re-applies it with a fresh timer (no double stacking).
 * Durations are scaled by `durationScale × bunny.stats.pickupDuration` (Hoarder).
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
  /** Emoji / short glyph for HUD and floor visuals. */
  icon?: string;
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
  /** Run time (s) when spawned. */
  spawnedAt: number;
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
  /** Extra multiplier on effect durations (the Hoarder Perk uses the pickupDuration stat). */
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
    const p: FloorPickup = { id: this.nextId++, def, x, z, radius: r, object3d, spawnedAt: this.run.time };
    this.floor.push(p);
    this.run.events.emit('pickupSpawned', { pickupId: p.id, defId });
    return p;
  }

  /** Removes a floor Pickup without collecting it (despawn). */
  despawn(p: FloorPickup): void {
    const i = this.floor.indexOf(p);
    if (i < 0) return;
    this.floor.splice(i, 1);
    p.object3d.removeFromParent();
  }

  /** Removes every floor Pickup (area change). Active effects keep running. */
  clearFloor(): void {
    for (const p of [...this.floor]) this.despawn(p);
  }

  /** Effective duration for a def after Hoarder / durationScale. */
  durationFor(def: PickupDef): number {
    return (def.duration ?? 0) * this.durationScale * this.run.bunny.stats.get('pickupDuration');
  }

  /** Applies a Pickup effect directly (also used when collecting). Re-activating refreshes the timer. */
  activate(def: PickupDef): void {
    const duration = this.durationFor(def);
    const existing = duration > 0 ? this.active.find((e) => e.def.id === def.id) : undefined;
    existing?.undo?.();
    const undo = def.apply(this.run, duration) ?? undefined;
    if (existing) Object.assign(existing, { remaining: duration, duration, undo });
    else if (duration > 0) this.active.push({ def, remaining: duration, duration, undo });
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
