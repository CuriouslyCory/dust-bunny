/**
 * Hazard extension point. No Hazards are implemented yet; register HazardDefs here.
 *
 * The HazardManager (a System) owns live Hazards: it calls update(), adds/removes their
 * object3d under run.entityRoot, and resolves Bunny contact generically:
 *   - hazard.size <= Bunny radius × absorbRatio → absorbed (growth via run.absorbMass,
 *     hazard.onAbsorbed, hazardRemoved {absorbed: true})
 *   - otherwise → hazard.onContact(run) (deal damage, knockback, suction... your call)
 * Spawning policy is pluggable via `manager.director`.
 */
import type { Object3D } from 'three';
import { circleVsCircle, circleVsRect } from '../core/math';
import { Registry } from '../core/registry';
import type { Rng } from '../core/rng';
import type { Run } from '../game/run';
import { SYSTEM_ORDER, type System } from '../game/system';
import { canAbsorb } from '../systems/absorb';

export type HazardShape =
  | { kind: 'circle'; radius: number }
  /** Axis-aligned box centred on the Hazard position. */
  | { kind: 'rect'; halfW: number; halfD: number };

export interface Hazard {
  readonly id: number;
  readonly def: HazardDef;
  x: number;
  z: number;
  /** Radius (cm) compared against the absorb rule. */
  size: number;
  /** Collision shape for Bunny contact. */
  shape: HazardShape;
  /** Visual; the manager parents it under run.entityRoot. */
  object3d?: Object3D;
  /** Set true to have the manager remove it. */
  dead?: boolean;
  update(dt: number, run: Run): void;
  /** Bunny touches the Hazard and is too small to absorb it. */
  onContact?(run: Run): void;
  onAbsorbed?(run: Run): void;
  dispose?(): void;
}

export interface HazardDef {
  id: string;
  name: string;
  /** First Tier in which the director may spawn it. */
  minTier: number;
  /** Relative spawn weight among eligible Hazards. */
  spawnWeight: number;
  maxAlive?: number;
  /** Growth multiplier when absorbed (like Debris mass). */
  mass: number;
  /** Model id for createModel() (procedural fallback + optional GLB). */
  modelId?: string;
  create(run: Run, x: number, z: number, id: number, rng: Rng): Hazard;
}

export const hazardRegistry = new Registry<HazardDef>('hazard');

/** Pluggable spawn policy, called every tick before Hazards update. */
export type HazardDirector = (dt: number, run: Run, manager: HazardManager) => void;

export class HazardManager implements System {
  readonly id = 'hazards';
  readonly order = SYSTEM_ORDER.hazards;
  readonly hazards: Hazard[] = [];
  director: HazardDirector | null = null;
  private nextId = 1;

  constructor(
    private readonly run: Run,
    readonly rng: Rng,
  ) {}

  spawn(defId: string, x: number, z: number): Hazard {
    const def = hazardRegistry.require(defId);
    const h = def.create(this.run, x, z, this.nextId++, this.rng);
    this.hazards.push(h);
    if (h.object3d) this.run.entityRoot.add(h.object3d);
    this.run.events.emit('hazardSpawned', { hazardId: h.id, defId });
    return h;
  }

  count(defId?: string): number {
    return defId ? this.hazards.filter((h) => h.def.id === defId && !h.dead).length : this.hazards.length;
  }

  /** Overlap between the Bunny and a Hazard shape. */
  static touches(run: Run, h: Hazard): boolean {
    const b = run.bunny;
    return h.shape.kind === 'circle'
      ? circleVsCircle(b.x, b.z, b.radius, h.x, h.z, h.shape.radius) !== null
      : circleVsRect(b.x, b.z, b.radius, { minX: h.x - h.shape.halfW, maxX: h.x + h.shape.halfW, minZ: h.z - h.shape.halfD, maxZ: h.z + h.shape.halfD }) !== null;
  }

  update(dt: number, run: Run): void {
    this.director?.(dt, run, this);
    const b = run.bunny;
    for (const h of this.hazards) {
      if (h.dead) continue;
      h.update(dt, run);
      if (h.dead || !HazardManager.touches(run, h)) continue;
      if (canAbsorb(b.radius, b.stats.get('absorbRatio'), h.size)) {
        run.hazardsAbsorbed++;
        run.absorbMass(h.size, h.def.mass, h.def.id, { x: h.x, y: 0, z: h.z }, 'hazard');
        h.dead = true;
        h.onAbsorbed?.(run);
        this.removeHazard(h, true);
      } else {
        h.onContact?.(run);
      }
    }
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const h = this.hazards[i]!;
      if (h.dead) this.removeHazard(h, false);
    }
  }

  private removeHazard(h: Hazard, absorbed: boolean): void {
    const i = this.hazards.indexOf(h);
    if (i < 0) return;
    this.hazards.splice(i, 1);
    h.object3d?.removeFromParent();
    h.dispose?.();
    this.run.events.emit('hazardRemoved', { hazardId: h.id, defId: h.def.id, absorbed });
  }

  dispose(): void {
    for (const h of [...this.hazards]) {
      h.object3d?.removeFromParent();
      h.dispose?.();
    }
    this.hazards.length = 0;
  }
}
