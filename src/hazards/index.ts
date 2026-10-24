/**
 * Hazard extension point: registry, Hazard interface and the HazardManager System.
 * Implementations live next to this file (roomba.ts, lintRoller.ts, ...); install.ts
 * registers them all and wires the spawn director per Run.
 *
 * The HazardManager (a System) owns live Hazards: it calls update(), adds/removes their
 * object3d under run.entityRoot, and resolves Bunny contact generically:
 *   - hazard.size <= Bunny radius × absorbRatio → absorbed (growth via run.absorbMass,
 *     hazard.onAbsorbed, hazardRemoved {absorbed: true})
 *   - otherwise, if `manager.contactOverride` is set and returns true for it, that handled the
 *     contact (src/abilities: Tumble's Amass swallows small Hazards and stops charging bosses)
 *   - otherwise → hazard.onContact(run) (deal damage, knockback, suction... your call), unless
 *     the Hazard ignores the Bunny for now (`ignoresBunnyFor`, counted down here; ignoresBunny)
 *   An `intangible` Hazard (the Expansion) never touches, so none of these apply to it.
 * Spawning policy is pluggable via `manager.director`.
 */
import type { Object3D } from 'three';
import { circleVsCircle, circleVsRect } from '../core/math';
import { Registry } from '../core/registry';
import type { Rng } from '../core/rng';
import type { Run } from '../game/run';
import { SYSTEM_ORDER, type System } from '../game/system';
import { canAbsorb } from '../systems/absorb';
import { ignoresBunny } from './common';
import type { RoomType } from '../world/types';
import './events';

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
  /** Ranged Hazards (turrets, Leaf Blower) aim at Lint's Decoy but are never clogged by touching it. */
  readonly ranged?: boolean;
  /**
   * Not a body (the Expansion): never touches the Bunny or the Decoy (`HazardManager.touches` is
   * false), so it is never absorbed or contacted, and Abilities and Spiky Dash ignore it.
   */
  readonly intangible?: boolean;
  /**
   * Seconds this Hazard ignores the Bunny (Lint's Unnoticed): no aiming at it (aimTarget), no
   * chasing it and no contact damage. Counted down by the manager; read through ignoresBunny.
   */
  ignoresBunnyFor?: number;
  /** Bunny touches the Hazard and is too small to absorb it. */
  onContact?(run: Run): void;
  onAbsorbed?(run: Run): void;
  dispose?(): void;
}

/**
 * Disc (cm) a Hazard needs clear of walls and of furniture no higher than `height` to be placed
 * (`hazardFloorFree`). Every placement path reads it from the def: director spawns, boss arrivals,
 * boss summons and debug spawns. It may be a deliberate envelope rather than the model size
 * (the Broom reserves room for its sweep, bosses their full-size contact radius).
 */
export interface HazardFootprint {
  readonly radius: number;
  readonly height: number;
}

/** The usual footprint: the tuning's absorb `size` as radius and its `height`. */
export function tuningFootprint(cfg: { readonly size: number; readonly height: number }): HazardFootprint {
  return { radius: cfg.size, height: cfg.height };
}

/**
 * A registered Hazard: how to build it and where it fits. Which Hazards spawn when (budgets,
 * intervals, weights, caps, boss / summon exclusions) is not here: that is the per-Area Tier
 * tables in src/data/hazards.ts (AREA_DIRECTORS, AREA_BOSSES, DIRECTOR_EXCLUDE).
 */
export interface HazardDef {
  id: string;
  name: string;
  /** Placement footprint used by every spawn path. */
  footprint: HazardFootprint;
  /**
   * Zone types the director places it in (the River Barge: `river`), when the layout has any of
   * them; otherwise, and for debug spawns, anywhere it fits.
   */
  spawnZones?: readonly RoomType[];
  /** Growth multiplier when absorbed (like Debris mass). */
  mass: number;
  /** Model id for createModel() (procedural fallback + optional GLB). */
  modelId?: string;
  /** An area boss (HUD banner, boss music, `hazardAbsorbed.boss`). */
  boss?: boolean;
  create(run: Run, x: number, z: number, id: number, rng: Rng): Hazard;
}

export const hazardRegistry = new Registry<HazardDef>('hazard');

/** Pluggable spawn policy, called every tick before Hazards update. */
export type HazardDirector = (dt: number, run: Run, manager: HazardManager) => void;

/** Ability contact handler (installed by src/abilities): true if it handled the contact, so onContact is skipped. */
export type ContactOverride = (run: Run, hazard: Hazard) => boolean;

export class HazardManager implements System {
  readonly id = 'hazards';
  readonly order = SYSTEM_ORDER.hazards;
  readonly hazards: Hazard[] = [];
  director: HazardDirector | null = null;
  /** Asked first on every non-absorbing contact (see file header). */
  contactOverride: ContactOverride | null = null;
  private nextId = 1;
  /** Hazards absorbed this tick (removed with hazardRemoved { absorbed: true }). */
  private readonly absorbedNow = new Set<Hazard>();

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

  /** Placement footprint of a registered Hazard (throws for an unknown id). */
  static footprint(defId: string): HazardFootprint {
    return hazardRegistry.require(defId).footprint;
  }

  count(defId?: string): number {
    return defId ? this.hazards.filter((h) => h.def.id === defId && !h.dead).length : this.hazards.length;
  }

  /** Overlap between the Bunny and a Hazard shape (never for an intangible Hazard). */
  static touches(run: Run, h: Hazard): boolean {
    if (h.intangible) return false;
    const b = run.bunny;
    return h.shape.kind === 'circle'
      ? circleVsCircle(b.x, b.z, b.radius, h.x, h.z, h.shape.radius) !== null
      : circleVsRect(b.x, b.z, b.radius, { minX: h.x - h.shape.halfW, maxX: h.x + h.shape.halfW, minZ: h.z - h.shape.halfD, maxZ: h.z + h.shape.halfD }) !== null;
  }

  update(dt: number, run: Run): void {
    this.director?.(dt, run, this);
    const b = run.bunny;
    const absorbed = this.absorbedNow;
    absorbed.clear();
    for (const h of [...this.hazards]) {
      if (h.dead) continue;
      if (h.ignoresBunnyFor) h.ignoresBunnyFor = Math.max(0, h.ignoresBunnyFor - dt);
      h.update(dt, run);
      if (h.dead || !HazardManager.touches(run, h)) continue;
      if (canAbsorb(b.radius, b.stats.get('absorbRatio'), h.size)) {
        this.absorb(h);
        if (run.ended) break;
      } else if (!this.contactOverride?.(run, h) && !ignoresBunny(h)) {
        h.onContact?.(run);
        // A boss's last hit can end the Run (the last Area's boss).
        if (run.ended) break;
      }
    }
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const h = this.hazards[i]!;
      if (h.dead) this.removeHazard(h, absorbed.has(h));
    }
    absorbed.clear();
  }

  /**
   * Absorbs a Hazard into the Bunny now (growth via run.absorbMass, hazardAbsorbed, onAbsorbed);
   * it is removed at the end of this tick with hazardRemoved { absorbed: true }. The manager calls
   * it for Hazards the absorb rule allows; Amass calls it for the bigger ones it swallows, and a
   * boss calls it when its last hit breaks it.
   */
  absorb(h: Hazard): void {
    const run = this.run;
    const b = run.bunny;
    if (h.dead) return;
    run.hazardsAbsorbed++;
    run.absorbMass(h.size, h.def.mass, h.def.id, { x: h.x, y: 0, z: h.z }, 'hazard');
    h.dead = true;
    this.absorbedNow.add(h);
    run.events.emit('hazardAbsorbed', { hazardId: h.id, defId: h.def.id, size: h.size, radius: b.radius, boss: !!h.def.boss });
    h.onAbsorbed?.(run);
  }

  private removeHazard(h: Hazard, absorbed: boolean): void {
    const i = this.hazards.indexOf(h);
    if (i < 0) return;
    this.hazards.splice(i, 1);
    h.object3d?.removeFromParent();
    h.dispose?.();
    this.run.events.emit('hazardRemoved', { hazardId: h.id, defId: h.def.id, absorbed });
  }

  /** Removes every Hazard without absorbing it (area change). */
  clear(): void {
    for (const h of [...this.hazards]) {
      h.dead = true;
      this.removeHazard(h, false);
    }
  }

  dispose(): void {
    for (const h of [...this.hazards]) {
      h.object3d?.removeFromParent();
      h.dispose?.();
    }
    this.hazards.length = 0;
  }
}
