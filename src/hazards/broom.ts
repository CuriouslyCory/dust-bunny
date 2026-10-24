/**
 * Broom: stands at a fixed spot. It telegraphs a sweep with a red arc on the floor (aimed at
 * the Bunny when it is near), then sweeps the bristle head through the arc. Getting hit
 * during the sweep: 1 damage + a big knockback along the sweep. The head is solid otherwise.
 * It aims at Lint's Decoy instead while the Decoy is within its aggro range.
 */
import { Box3, Vector3 } from 'three';
import type { Rng } from '../core/rng';
import { BROOM, tierValue } from '../data/hazards';
import type { Run } from '../game/run';
import { BaseHazard } from './base';
import { aimTarget, bunnySheltered, hitBunny, randomIn, separateFromBunny, wrapAngle, yawOf } from './common';
import { DECAL_COLORS, sectorDecal } from './decals';
import { hazardRegistry, type HazardDef } from './index';

type BroomState = 'idle' | 'telegraph' | 'sweep';

const HEAD_HEIGHT = 10;

export class Broom extends BaseHazard {
  readonly pivotX: number;
  readonly pivotZ: number;
  /** Current head angle (yaw about the pivot). */
  angle: number;
  state: BroomState = 'idle';
  private timer: number;
  private from = 0;
  private to = 0;
  private side: 1 | -1 = 1;
  private readonly arcDecal;

  constructor(
    id: number,
    def: HazardDef,
    x: number,
    z: number,
    private readonly rng: Rng,
  ) {
    super(id, def, x, z, BROOM.size, 'broom');
    this.pivotX = x;
    this.pivotZ = z;
    this.shape = { kind: 'circle', radius: BROOM.headRadius };
    this.angle = rng.range(-Math.PI, Math.PI);
    this.timer = randomIn(rng, BROOM.idle);
    this.alignModel();
    this.arcDecal = this.addDecal(sectorDecal(BROOM.sweepRadius - BROOM.headRadius, BROOM.sweepRadius + BROOM.headRadius, BROOM.arc, DECAL_COLORS.danger, 0.5));
    this.arcDecal.visible = false;
    this.placeHead();
  }

  /**
   * Puts the model's pivot at the body origin whichever way the model is authored: the floor
   * at y = 0 and the bristle head (its most +Z part) at the sweep radius.
   */
  private alignModel(): void {
    const box = new Box3().setFromObject(this.model);
    const c = box.getCenter(new Vector3());
    this.model.position.set(-c.x, -box.min.y, BROOM.sweepRadius + 5 - box.max.z);
  }

  /** Seconds a sweep takes (quicker when the Difficulty speeds Hazards up). */
  private sweepTime(run: Run): number {
    return BROOM.sweepTime / run.difficulty.hazardSpeed;
  }

  private placeHead(): void {
    this.x = this.pivotX + Math.sin(this.angle) * BROOM.sweepRadius;
    this.z = this.pivotZ + Math.cos(this.angle) * BROOM.sweepRadius;
  }

  protected tick(dt: number, run: Run): void {
    this.timer -= dt;
    const b = run.bunny;
    if (this.state === 'idle' && this.timer <= 0) {
      // Aim the arc centre at the Bunny (or the Decoy) when it is in range, otherwise sweep somewhere nearby.
      const t = aimTarget(run, this.pivotX, this.pivotZ, BROOM.aggroRange + b.radius, this);
      const dx = (t?.x ?? b.x) - this.pivotX;
      const dz = (t?.z ?? b.z) - this.pivotZ;
      const near = !!t && Math.hypot(dx, dz) < BROOM.aggroRange + t.radius;
      const centre = near ? yawOf(dx, dz) : this.angle + this.side * (BROOM.arc / 2);
      this.side = this.rng.chance(0.5) ? 1 : -1;
      this.from = centre - (this.side * BROOM.arc) / 2;
      this.to = centre + (this.side * BROOM.arc) / 2;
      this.state = 'telegraph';
      this.timer = this.attackTime(run, tierValue(BROOM.telegraph, run.tier));
      this.arcDecal.place(this.pivotX, this.pivotZ, centre);
      this.arcDecal.visible = true;
      this.emitTelegraph(run, 'sweep', this.timer);
    }
    if (this.state === 'telegraph') {
      const total = this.attackTime(run, tierValue(BROOM.telegraph, run.tier));
      // Swing the head back to the start of the arc while telegraphing.
      const k = Math.min(1, 1 - this.timer / total);
      this.angle = this.angle + wrapAngle(this.from - this.angle) * Math.min(1, dt * 8);
      this.arcDecal.pulse(this.time, k);
      if (this.timer <= 0) {
        this.state = 'sweep';
        this.timer = this.sweepTime(run);
        this.angle = this.from;
      }
    } else if (this.state === 'sweep') {
      const k = 1 - Math.max(0, this.timer) / this.sweepTime(run);
      const e = k * k * (3 - 2 * k);
      this.angle = this.from + (this.to - this.from) * e;
      this.arcDecal.setOpacity(0.55 * (1 - k * 0.6));
      if (this.timer <= 0) {
        this.state = 'idle';
        this.timer = randomIn(this.rng, BROOM.idle);
        this.angle = this.to;
        this.arcDecal.visible = false;
      }
    }
    this.placeHead();
  }

  protected override sync(run: Run): void {
    super.sync(run);
    this.body.position.set(this.pivotX, 0, this.pivotZ);
    this.body.rotation.y = this.angle;
  }

  onContact(run: Run): void {
    if (bunnySheltered(run, HEAD_HEIGHT)) return;
    if (this.state === 'sweep' && !this.stunned) {
      const b = run.bunny;
      const s = Math.sign(this.to - this.from) || 1;
      // Tangent of the sweep plus a little outward push.
      const tx = Math.cos(this.angle) * s;
      const tz = -Math.sin(this.angle) * s;
      const rx = b.x - this.pivotX;
      const rz = b.z - this.pivotZ;
      const rn = Math.hypot(rx, rz) || 1;
      hitBunny(run, this.x, this.z, {
        damage: BROOM.damage,
        source: this.def.id,
        knockbackCm: BROOM.knockbackCm,
        knockbackRadii: BROOM.knockbackRadii,
        dirX: tx + (rx / rn) * 0.5,
        dirZ: tz + (rz / rn) * 0.5,
      });
    }
    separateFromBunny(run, this, BROOM.headRadius, HEAD_HEIGHT);
  }
}

export const broomDef = hazardRegistry.register({
  id: 'broom',
  name: 'Broom',
  // Deliberate envelope: half the sweep around the pivot (not the bristle head), at head height.
  footprint: { radius: BROOM.sweepRadius * 0.5, height: HEAD_HEIGHT },
  mass: BROOM.mass,
  modelId: 'broom',
  create(_run, x, z, id, rng) {
    return new Broom(id, this, x, z, rng);
  },
});
