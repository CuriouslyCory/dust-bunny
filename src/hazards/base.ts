/**
 * BaseHazard: shared plumbing for the Hazard implementations.
 *
 * `object3d` is a Group at the world origin (the manager parents it under run.entityRoot);
 * `body` holds the model at (x, z) with yaw `yaw`; decals are added in world coordinates.
 * A green ring under the Hazard shows when it is small enough to absorb.
 */
import { Group, type Object3D } from 'three';
import { DIRECTOR, tierValue, type PerTier } from '../data/hazards';
import { tierProgress } from '../data/tiers';
import type { Run } from '../game/run';
import { createModel } from '../world/models';
import { bunnyCanAbsorb, moveCircle } from './common';
import { DECAL_COLORS, ringDecal, type Decal } from './decals';
import { playAbsorbFx } from './fx';
import type { Hazard, HazardDef, HazardShape } from './index';
import { HAZARD_MODEL_SIZES, type HazardModelId } from './models';

export abstract class BaseHazard implements Hazard {
  readonly object3d = new Group();
  readonly body = new Group();
  readonly model: Object3D;
  shape: HazardShape;
  dead = false;
  /** Facing (radians about +Y); 0 faces +Z. */
  yaw = 0;
  /** Seconds alive. */
  time = 0;
  /** Spiky Dash stun (set and counted down by the combat System): no movement or attacks. */
  stunnedFor = 0;

  /** Seconds the Hazard backs off after landing a hit, so it can't pin the Bunny against a wall. */
  recoilFor = 0;
  /** Height used for collision while backing off (furniture it can drive under). */
  protected recoilHeight = 20;

  get stunned(): boolean {
    return this.stunnedFor > 0;
  }

  /** Height this Hazard collides at when pushed back (by an Amassing Tumble, or while recoiling). */
  get collisionHeight(): number {
    return this.recoilHeight;
  }

  /** Shake amplitude (world units) while Amass strains at it without moving it (0 = still). */
  tension = 0;

  /** Called by the combat System when stunned; the wobble is driven by `stunnedFor` in sync(). */
  stun(_seconds: number): void {}
  protected readonly decals: Decal[] = [];
  private readonly absorbMarker: Decal;

  constructor(
    readonly id: number,
    readonly def: HazardDef,
    public x: number,
    public z: number,
    public size: number,
    modelId: HazardModelId,
  ) {
    this.shape = { kind: 'circle', radius: size };
    this.model = createModel(modelId, { ...HAZARD_MODEL_SIZES[modelId] });
    this.body.add(this.model);
    this.object3d.add(this.body);
    this.absorbMarker = this.addDecal(ringDecal(1, 1.12, DECAL_COLORS.absorbable, 0.8));
    this.absorbMarker.visible = false;
  }

  /** Per-tick behaviour. */
  protected abstract tick(dt: number, run: Run): void;

  update(dt: number, run: Run): void {
    this.time += dt;
    if (this.recoilFor > 0) {
      this.recoilFor -= dt;
      this.backOff(dt, run);
    } else if (!this.stunned) this.tick(dt, run);
    this.sync(run);
  }

  /** Drives straight away from the Bunny (used while recoiling after a hit). */
  protected backOff(dt: number, run: Run): void {
    const b = run.bunny;
    const dx = this.x - b.x;
    const dz = this.z - b.z;
    const d = Math.hypot(dx, dz) || 1;
    // At least 30 cm/s (in the Area's unit), else two Hazard sizes per second.
    const step = Math.max(30 / run.unit, this.size * 2) * dt;
    const m = moveCircle(run.house, this.x, this.z, this.size, this.recoilHeight, (dx / d) * step, (dz / d) * step);
    this.x = m.x;
    this.z = m.z;
  }

  /** Called after tick: syncs the model transform and the absorbable marker. */
  protected sync(run: Run): void {
    const t = this.tension;
    this.body.position.set(this.x + (t > 0 ? t * Math.sin(this.time * 53 + this.id) : 0), 0, this.z + (t > 0 ? t * Math.cos(this.time * 61 + this.id) : 0));
    this.body.rotation.y = this.yaw;
    this.body.rotation.z = this.stunned ? Math.sin(this.time * 30) * 0.08 : 0;
    // Green ring: absorbable, or small enough for an Amass in progress to swallow on contact.
    const absorbable = bunnyCanAbsorb(run, this.size) || (!this.def.boss && this.size <= run.bunny.amassSwallowSize);
    this.absorbMarker.visible = absorbable;
    if (absorbable) {
      const r = this.markerRadius();
      this.absorbMarker.root.scale.set(r, 1, r);
      this.absorbMarker.place(this.x, this.z);
      this.absorbMarker.pulse(this.time, 0.2);
    }
  }

  protected markerRadius(): number {
    return this.shape.kind === 'circle' ? this.shape.radius * 1.15 : Math.max(this.shape.halfW, this.shape.halfD) * 1.15;
  }

  protected addDecal<T extends Decal>(d: T): T {
    this.decals.push(d);
    this.object3d.add(d.root);
    return d;
  }

  /** Spins a named model node (GLB or procedural) about a local axis (Y by default). */
  protected spin(name: string, radians: number, axis: 'x' | 'y' | 'z' = 'y'): void {
    const node = this.model.getObjectByName(name);
    if (node) node.rotation[axis] += radians;
  }

  /** Speed for the current Tier, ramped up within the Tier and scaled by the Difficulty. */
  protected tierSpeed(run: Run, speeds: PerTier): number {
    const [a, b] = DIRECTOR.speedRamp;
    return this.speed(run, tierValue(speeds, run.tier) * (a + (b - a) * tierProgress(run.bunny.realRadius)));
  }

  /** A movement speed (world units/s: cm/s up to the City) scaled by the Run's Difficulty (faster on Arcade and Hardcore). */
  protected speed(run: Run, cmPerSec: number): number {
    return cmPerSec * run.difficulty.hazardSpeed;
  }

  /** An attack wind-up or cooldown (s) scaled by the Run's Difficulty (shorter on Arcade and Hardcore). */
  protected attackTime(run: Run, seconds: number): number {
    return seconds * run.difficulty.attackTiming;
  }

  protected emitTelegraph(run: Run, attack: string, duration: number): void {
    run.events.emit('hazardTelegraph', { hazardId: this.id, defId: this.def.id, attack, duration });
  }

  onAbsorbed(run: Run): void {
    playAbsorbFx(run, this.body);
  }

  dispose(): void {
    for (const d of this.decals) d.dispose();
    this.decals.length = 0;
  }
}
