/**
 * Gamma-ray burst (universe turret, GAMMA_RAY_BURST in src/data/hazards.ts): the turret behaviour
 * (stationary, aim, telegraph, attack; see sprayBottle.ts) with one long, narrow, very fast beam
 * instead of droplets, drawn like the Pulsar's (pulsar.ts) but locked rather than sweeping.
 *
 * Its `head` (the collapsing star and its nozzle) tracks the target (`aimTarget`: the Bunny or
 * Lint's Decoy) and sweeps slowly (`idleSpin`) while nothing is in range. When the target is in
 * range, lined up and the burst is on screen, the aim locks: a thin violet lane runs from the
 * muzzle to the end of its range and blinks faster through the `telegraph` while the star swells.
 * Then the beam's front shoots along the lane at `beamSpeed` and the beam stays lit for `fire` s:
 * a Bunny it touches takes one hit per burst (damage, knocked sideways off the lane, sheds
 * `shedFraction`; `hitBunny`, so i-frames, Amass's guard and the Dust Cloud apply) and a Decoy in it
 * pops. Then `cooldown`. Step off the lane during the telegraph to dodge it.
 */
import { AdditiveBlending, BoxGeometry, Mesh, MeshBasicMaterial, type Object3D } from 'three';
import type { Rng } from '../core/rng';
import { GAMMA_RAY_BURST, tierValue, type BurstTuning } from '../data/hazards';
import type { Run } from '../game/run';
import { onScreen } from '../systems/camera';
import { BaseHazard } from './base';
import { activeLure, aimTarget, bunnySheltered, hitBunny, pushBunnyOut, turnTowards, wrapAngle, yawOf } from './common';
import { laneDecal } from './decals';
import { hazardRegistry, tuningFootprint, type HazardDef } from './index';
import { shedMass } from './shed';

export type BurstState = 'idle' | 'telegraph' | 'firing' | 'cooldown';

/**
 * True if a disc of `radius` at (dx, dz) from the burst's centre touches a beam of `width` that
 * leaves along `yaw` from `start` to `end` (distances from the centre).
 */
export function inBurst(dx: number, dz: number, radius: number, yaw: number, start: number, end: number, width: number): boolean {
  const ux = Math.sin(yaw);
  const uz = Math.cos(yaw);
  const along = dx * ux + dz * uz;
  const side = Math.abs(dx * uz - dz * ux);
  return along > start - radius && along < end + radius && side < width / 2 + radius * 0.8;
}

export class GammaRayBurst extends BaseHazard {
  readonly ranged = true;
  state: BurstState = 'idle';
  private timer = 0;
  /** Aim (yaw about +Y); locked from the telegraph until the beam goes out. */
  aimYaw: number;
  /** Distance of the beam's front from the centre while firing. */
  front = 0;
  /** Hits landed so far, and whether this burst has landed one. */
  hits = 0;
  private hitThisBurst = false;
  private readonly head: Object3D | null;
  private readonly lane;
  private readonly beam: Mesh;
  private readonly beamMat: MeshBasicMaterial;

  constructor(
    id: number,
    def: HazardDef,
    x: number,
    z: number,
    rng: Rng,
    readonly cfg: BurstTuning = GAMMA_RAY_BURST,
  ) {
    super(id, def, x, z, cfg.size, cfg.modelId);
    this.model.scale.setScalar(cfg.size / cfg.modelSize);
    this.yaw = rng.range(-Math.PI, Math.PI);
    this.aimYaw = this.yaw;
    this.head = this.model.getObjectByName(cfg.aimNode) ?? null;
    this.lane = this.addDecal(laneDecal(1, cfg.beamWidth * 1.4, cfg.laneColor, 0.8));
    this.lane.visible = false;
    this.beamMat = new MeshBasicMaterial({ color: cfg.beamColor, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, toneMapped: false });
    const geom = new BoxGeometry(cfg.beamWidth * 0.55, cfg.beamWidth * 0.55, 1);
    geom.translate(0, 0, 0.5);
    this.beam = new Mesh(geom, this.beamMat);
    this.beam.visible = false;
    this.object3d.add(this.beam);
  }

  /** Telegraph length (s) at this Tier and Difficulty. */
  telegraphTime(run: Run): number {
    return this.attackTime(run, tierValue(this.cfg.telegraph, run.tier));
  }

  protected tick(dt: number, run: Run): void {
    const c = this.cfg;
    const range = tierValue(c.range, run.tier);
    const reach = c.muzzle + range;
    const t = aimTarget(run, this.x, this.z, reach, this);
    this.timer -= dt;
    switch (this.state) {
      case 'idle': {
        const dist = t ? Math.hypot(t.x - this.x, t.z - this.z) : Infinity;
        const inRange = !!t && dist < reach + t.radius && (t.lure || !bunnySheltered(run, c.beamHeight)) && onScreen(run, this.x, this.z);
        if (!inRange) {
          this.aimYaw = wrapAngle(this.aimYaw + c.idleSpin * dt);
          break;
        }
        const want = yawOf(t.x - this.x, t.z - this.z);
        this.aimYaw = turnTowards(this.aimYaw, want, c.turnRate * dt);
        if (Math.abs(wrapAngle(want - this.aimYaw)) < 0.12) {
          // The lane locks exactly on the target: what it shows is where the beam goes.
          this.aimYaw = want;
          this.state = 'telegraph';
          this.timer = this.telegraphTime(run);
          this.emitTelegraph(run, 'burst', this.timer);
        }
        break;
      }
      case 'telegraph':
        if (this.timer <= 0) {
          this.state = 'firing';
          this.front = c.muzzle;
          this.timer = range / c.beamSpeed + c.fire;
          this.hitThisBurst = false;
        }
        break;
      case 'firing':
        this.front = Math.min(reach, this.front + c.beamSpeed * dt);
        this.burn(run);
        if (this.timer <= 0) {
          this.state = 'cooldown';
          this.timer = this.attackTime(run, tierValue(c.cooldown, run.tier));
        }
        break;
      case 'cooldown':
        if (this.timer <= 0) this.state = 'idle';
        break;
    }
    this.updateVisuals(run, reach);
  }

  /** The lit beam: one hit per burst on a Bunny in it; a Decoy in it pops. */
  private burn(run: Run): void {
    const c = this.cfg;
    const lure = activeLure(run);
    if (lure && inBurst(lure.x - this.x, lure.z - this.z, lure.radius, this.aimYaw, c.muzzle, this.front, c.beamWidth)) lure.shot(this);
    const b = run.bunny;
    if (this.hitThisBurst || !b.alive || bunnySheltered(run, c.beamHeight)) return;
    const dx = b.x - this.x;
    const dz = b.z - this.z;
    if (!inBurst(dx, dz, b.radius, this.aimYaw, c.muzzle, this.front, c.beamWidth)) return;
    // Sideways off the lane (the side the Bunny is on), and a little onward.
    const ux = Math.sin(this.aimYaw);
    const uz = Math.cos(this.aimYaw);
    const side = dx * uz - dz * ux >= 0 ? 1 : -1;
    if (hitBunny(run, this.x, this.z, { damage: c.damage, source: this.def.id, knockbackCm: c.knockbackCm, knockbackRadii: c.knockbackRadii, dirX: uz * side + ux * 0.4, dirZ: -ux * side + uz * 0.4 })) {
      this.hitThisBurst = true;
      this.hits++;
      if (c.shedFraction > 0) shedMass(run, run.hazards.rng, c.shedFraction, this.def.id);
    }
  }

  private updateVisuals(run: Run, reach: number): void {
    const c = this.cfg;
    const lit = this.state === 'telegraph' || this.state === 'firing';
    this.lane.visible = lit;
    const ux = Math.sin(this.aimYaw);
    const uz = Math.cos(this.aimYaw);
    if (lit) {
      this.lane.place(this.x + ux * c.muzzle, this.z + uz * c.muzzle, this.aimYaw);
      this.lane.root.scale.set(1, 1, reach - c.muzzle);
      if (this.state === 'telegraph') this.lane.pulse(this.time, 1 - this.timer / this.telegraphTime(run));
      else this.lane.setOpacity(0.25);
    }
    const firing = this.state === 'firing';
    this.beam.visible = firing;
    if (firing) {
      this.beam.position.set(this.x + ux * c.muzzle, c.beamHeight, this.z + uz * c.muzzle);
      this.beam.rotation.y = this.aimYaw;
      this.beam.scale.set(1, 1, Math.max(0.01, this.front - c.muzzle));
      this.beamMat.opacity = 0.8 + 0.2 * Math.sin(this.time * 50);
    }
    // The star swells through the telegraph and flares while the beam is lit.
    const star = this.head;
    if (star) {
      const k = this.state === 'telegraph' ? 1 - this.timer / this.telegraphTime(run) : firing ? 1 : 0;
      star.scale.setScalar(1 + 0.18 * k + (this.state === 'telegraph' ? 0.05 * Math.sin(this.time * 30) : 0));
    }
  }

  protected override sync(run: Run): void {
    super.sync(run);
    // The ejecta disc stays put; only the head (the star and its nozzle) turns.
    if (this.head) this.head.rotation.y = wrapAngle(this.aimYaw - this.yaw);
    if (this.stunned) this.beam.visible = false;
  }

  onContact(run: Run): void {
    pushBunnyOut(run, this.x, this.z, this.size);
  }

  override dispose(): void {
    this.beam.removeFromParent();
    this.beam.geometry.dispose();
    this.beamMat.dispose();
    super.dispose();
  }
}

/** Universe turret: a gamma-ray burst firing one long, narrow, very fast beam (GAMMA_RAY_BURST). */
export const gammaRayBurstDef = hazardRegistry.register({
  id: 'gamma_ray_burst',
  name: 'Gamma-Ray Burst',
  footprint: tuningFootprint(GAMMA_RAY_BURST),
  mass: GAMMA_RAY_BURST.mass,
  modelId: GAMMA_RAY_BURST.modelId,
  create(_run, x, z, id, rng) {
    return new GammaRayBurst(id, this, x, z, rng, GAMMA_RAY_BURST);
  },
});
