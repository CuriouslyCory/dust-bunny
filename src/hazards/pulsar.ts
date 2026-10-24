/**
 * Pulsar (galaxy turret, PULSAR in src/data/hazards.ts): the turret behaviour (stationary, aim
 * telegraph, then an attack; see sprayBottle.ts) reskinned as a lighthouse. Its `head` turns one
 * way round all the time at `sweepRate`, and its twin beams leave both ways along it.
 *
 * When the Bunny (or Lint's Decoy) is in range, the Pulsar is on screen, and a beam will reach the
 * target's bearing soon after the telegraph (`aheadWindow`), it telegraphs: both beams show as red
 * lanes and an amber wedge ahead of each marks the arc they will sweep while they burn. Then the
 * beams burn for `fire` s, still turning: a Bunny in either beam takes one hit per burn, knocked
 * onward and outward (`hitBunny`, so i-frames, Amass's guard and the Dust Cloud apply), and a Decoy in a
 * beam pops. Then `cooldown`. Dodge by leaving its range, or by slipping behind a beam.
 */
import { AdditiveBlending, BoxGeometry, Group, Mesh, MeshBasicMaterial, type Object3D } from 'three';
import type { Rng } from '../core/rng';
import { PULSAR, tierValue, type PulsarTuning } from '../data/hazards';
import type { Run } from '../game/run';
import { onScreen } from '../systems/camera';
import { BaseHazard } from './base';
import { activeLure, aimTarget, bunnySheltered, hitBunny, pushBunnyOut, wrapAngle, yawOf } from './common';
import { DECAL_COLORS, laneDecal, sectorDecal, type Decal } from './decals';
import { hazardRegistry, tuningFootprint, type HazardDef } from './index';

export type PulsarState = 'idle' | 'telegraph' | 'firing' | 'cooldown';

/** How far ahead of the beam (radians, in its turning direction, either beam) the target's bearing is, in [0, π). */
export function beamLead(beamYaw: number, dir: 1 | -1, bearing: number): number {
  const a = (dir * (bearing - beamYaw)) % Math.PI;
  return a < 0 ? a + Math.PI : a;
}

/** True if a disc of `radius` at (dx, dz) from the pulsar's centre touches a beam of `width` and `range` leaving along `yaw` or the opposite way. */
export function inBeam(dx: number, dz: number, radius: number, yaw: number, range: number, width: number): boolean {
  const ux = Math.sin(yaw);
  const uz = Math.cos(yaw);
  const along = Math.abs(dx * ux + dz * uz);
  const side = Math.abs(dx * uz - dz * ux);
  return along < range + radius && side < width / 2 + radius * 0.8;
}

export class Pulsar extends BaseHazard {
  readonly ranged = true;
  state: PulsarState = 'idle';
  private timer = 0;
  /** Beam bearing (yaw about +Y; the twin beam leaves the opposite way). */
  beamYaw: number;
  /** Turning direction: +1 or −1. */
  readonly dir: 1 | -1;
  /** Hits landed so far, and whether this burn has landed one. */
  hits = 0;
  private hitThisBurn = false;
  private readonly head: Object3D | null;
  private readonly lanes: [Decal, Decal];
  private wedges: [Decal, Decal] | null = null;
  private wedgeArc = 0;
  private readonly beams = new Group();
  private readonly beamMat: MeshBasicMaterial;

  constructor(
    id: number,
    def: HazardDef,
    x: number,
    z: number,
    rng: Rng,
    readonly cfg: PulsarTuning = PULSAR,
  ) {
    super(id, def, x, z, cfg.size, cfg.modelId);
    this.model.scale.setScalar(cfg.size / cfg.modelSize);
    this.yaw = rng.range(-Math.PI, Math.PI);
    this.beamYaw = rng.range(-Math.PI, Math.PI);
    this.dir = rng.sign();
    this.head = this.model.getObjectByName(cfg.aimNode) ?? null;
    this.lanes = [this.addDecal(laneDecal(1, cfg.beamWidth, DECAL_COLORS.danger, 0.5)), this.addDecal(laneDecal(1, cfg.beamWidth, DECAL_COLORS.danger, 0.5))];
    for (const l of this.lanes) l.visible = false;
    this.beamMat = new MeshBasicMaterial({ color: cfg.beamColor, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, toneMapped: false });
    const geom = new BoxGeometry(cfg.beamWidth * 0.6, cfg.beamWidth * 0.6, 1);
    geom.translate(0, 0, 0.5);
    for (const s of [0, Math.PI]) {
      const m = new Mesh(geom, this.beamMat);
      m.rotation.y = s;
      this.beams.add(m);
    }
    this.beams.visible = false;
    this.object3d.add(this.beams);
  }

  /** Arc (radians) a beam sweeps while it burns at this Tier. */
  sweepArc(run: Run): number {
    return tierValue(this.cfg.sweepRate, run.tier) * this.cfg.fire;
  }

  /** Lead window [min, max] (radians ahead of a beam) in which the target's bearing starts a telegraph. */
  aheadWindow(run: Run): [number, number] {
    const rate = tierValue(this.cfg.sweepRate, run.tier);
    const lead = rate * this.attackTime(run, tierValue(this.cfg.telegraph, run.tier));
    return [lead, lead + this.sweepArc(run) * 0.6];
  }

  protected tick(dt: number, run: Run): void {
    const c = this.cfg;
    const range = tierValue(c.range, run.tier);
    const rate = tierValue(c.sweepRate, run.tier);
    this.beamYaw = wrapAngle(this.beamYaw + this.dir * rate * dt);
    this.timer -= dt;
    const t = aimTarget(run, this.x, this.z, range, this);
    switch (this.state) {
      case 'idle': {
        if (!t) break;
        const dist = Math.hypot(t.x - this.x, t.z - this.z);
        const inRange = dist < range + t.radius && (t.lure || !bunnySheltered(run, c.beamHeight)) && onScreen(run, this.x, this.z);
        if (!inRange) break;
        const [lo, hi] = this.aheadWindow(run);
        const lead = beamLead(this.beamYaw, this.dir, yawOf(t.x - this.x, t.z - this.z));
        if (lead >= lo && lead <= hi) {
          this.state = 'telegraph';
          this.timer = this.attackTime(run, tierValue(c.telegraph, run.tier));
          this.emitTelegraph(run, 'beam', this.timer);
        }
        break;
      }
      case 'telegraph':
        if (this.timer <= 0) {
          this.state = 'firing';
          this.timer = c.fire;
          this.hitThisBurn = false;
        }
        break;
      case 'firing':
        this.burn(run, range);
        if (this.timer <= 0) {
          this.state = 'cooldown';
          this.timer = this.attackTime(run, tierValue(c.cooldown, run.tier));
        }
        break;
      case 'cooldown':
        if (this.timer <= 0) this.state = 'idle';
        break;
    }
    this.updateVisuals(run, range, rate);
  }

  /** The beams burn: one hit per burn on a Bunny in either beam; a Decoy in a beam pops. */
  private burn(run: Run, range: number): void {
    const c = this.cfg;
    const lure = activeLure(run);
    if (lure && inBeam(lure.x - this.x, lure.z - this.z, lure.radius, this.beamYaw, range, c.beamWidth)) lure.shot(this);
    const b = run.bunny;
    if (this.hitThisBurn || !b.alive || bunnySheltered(run, c.beamHeight)) return;
    const dx = b.x - this.x;
    const dz = b.z - this.z;
    if (!inBeam(dx, dz, b.radius, this.beamYaw, range, c.beamWidth)) return;
    // Onward (the way the beam turns) and outward.
    const d = Math.hypot(dx, dz) || 1;
    const tx = (dz / d) * this.dir;
    const tz = (-dx / d) * this.dir;
    if (hitBunny(run, this.x, this.z, { damage: c.damage, source: this.def.id, knockbackCm: c.knockbackCm, knockbackRadii: c.knockbackRadii, dirX: tx + (dx / d) * 0.8, dirZ: tz + (dz / d) * 0.8 })) {
      this.hitThisBurn = true;
      this.hits++;
    }
  }

  private updateVisuals(run: Run, range: number, rate: number): void {
    const lit = this.state === 'telegraph' || this.state === 'firing';
    for (let i = 0; i < 2; i++) {
      const lane = this.lanes[i]!;
      lane.visible = lit;
      if (!lit) continue;
      lane.place(this.x, this.z, this.beamYaw + i * Math.PI);
      lane.root.scale.set(1, 1, range);
      if (this.state === 'telegraph') lane.pulse(this.time, 1 - this.timer / this.attackTime(run, tierValue(this.cfg.telegraph, run.tier)));
      else lane.setOpacity(0.7);
    }
    // The wedges ahead of the beams: the arc they will sweep while they burn.
    const arc = this.sweepArc(run);
    if (this.state === 'telegraph' && (!this.wedges || Math.abs(arc - this.wedgeArc) > 0.01)) this.buildWedges(arc);
    if (this.wedges) {
      const show = this.state === 'telegraph';
      for (let i = 0; i < 2; i++) {
        const w = this.wedges[i]!;
        w.visible = show;
        if (!show) continue;
        const start = this.beamYaw + this.dir * rate * Math.max(0, this.timer);
        w.place(this.x, this.z, start + this.dir * (arc / 2) + i * Math.PI);
        w.root.scale.set(range, 1, range);
        w.setOpacity(0.16 + 0.08 * Math.sin(this.time * 12));
      }
    }
    this.beams.visible = lit;
    if (lit) {
      this.beams.position.set(this.x, this.cfg.beamHeight, this.z);
      this.beams.rotation.y = this.beamYaw;
      this.beams.scale.set(1, 1, range);
      this.beamMat.opacity = this.state === 'firing' ? 0.75 + 0.2 * Math.sin(this.time * 40) : 0.08 + 0.06 * Math.sin(this.time * 25);
    }
  }

  private buildWedges(arc: number): void {
    if (this.wedges) for (const w of this.wedges) this.removeDecal(w);
    this.wedges = [this.addDecal(sectorDecal(0, 1, arc, DECAL_COLORS.warn, 0.2)), this.addDecal(sectorDecal(0, 1, arc, DECAL_COLORS.warn, 0.2))];
    this.wedgeArc = arc;
  }

  private removeDecal(d: Decal): void {
    const i = this.decals.indexOf(d);
    if (i >= 0) this.decals.splice(i, 1);
    d.dispose();
  }

  protected override sync(run: Run): void {
    super.sync(run);
    // The disc stays put; only the head (the beams) turns.
    if (this.head) this.head.rotation.y = wrapAngle(this.beamYaw - this.yaw);
    if (this.stunned) this.beams.visible = false;
  }

  onContact(run: Run): void {
    pushBunnyOut(run, this.x, this.z, this.size);
  }

  override dispose(): void {
    this.beams.removeFromParent();
    (this.beams.children[0] as Mesh | undefined)?.geometry.dispose();
    this.beamMat.dispose();
    super.dispose();
  }
}

/** Galaxy turret: a pulsar sweeping twin lighthouse beams (PULSAR). */
export const pulsarDef = hazardRegistry.register({
  id: 'pulsar',
  name: 'Pulsar',
  footprint: tuningFootprint(PULSAR),
  mass: PULSAR.mass,
  modelId: PULSAR.modelId,
  create(_run, x, z, id, rng) {
    return new Pulsar(id, this, x, z, rng, PULSAR);
  },
});
