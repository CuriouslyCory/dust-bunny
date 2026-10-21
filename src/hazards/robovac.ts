/**
 * Robo-Vac 9000 (boss, Tier 5). Arrives with an intro, hunts the Bunny with mild suction,
 * telegraphs charges with a red lane on the floor, and summons mini Roombas. A charge that
 * ends in a wall stuns it: ramming it while stunned chips it smaller (and knocks absorbable
 * parts loose). Once size ≤ Bunny radius × absorbRatio it can be absorbed, which wins the Run.
 */
import type { Rng } from '../core/rng';
import { ROBOVAC_9000 } from '../data/hazards';
import type { Run } from '../game/run';
import { BaseHazard } from './base';
import { absorbRadiusFor, applySuction, bunnySheltered, canTarget, hazardFloorFree, hitBunny, knockbackCm, moveCircle, pushBunnyOut, randomIn, suctionFalloff, suctionReachFor, turnTowards, yawOf } from './common';
import { DECAL_COLORS, laneDecal, ringDecal } from './decals';
import { hazardRegistry, type HazardDef } from './index';
import { scatterDebris, shedMass } from './shed';

export type BossState = 'intro' | 'hunt' | 'telegraph' | 'charge' | 'stunned' | 'recover';

/** Size after `hits` chips. */
export function bossSizeAfterHits(hits: number, size = ROBOVAC_9000.size, chipFactor = ROBOVAC_9000.chipFactor): number {
  return size * chipFactor ** hits;
}

export class RoboVac9000 extends BaseHazard {
  state: BossState = 'intro';
  private timer = ROBOVAC_9000.introTime;
  private chargeDirX = 0;
  private chargeDirZ = 1;
  private charged = 0;
  private summonTimer = ROBOVAC_9000.summonInterval * 0.6;
  /** Chip already taken during the current stun. */
  private hitThisStun = false;
  hits = 0;
  readonly minis = new Set<number>();
  private readonly lane;
  private readonly stunRing;

  constructor(
    id: number,
    def: HazardDef,
    x: number,
    z: number,
    private readonly rng: Rng,
  ) {
    super(id, def, x, z, ROBOVAC_9000.size, 'robovac_9000');
    this.shape = { kind: 'circle', radius: ROBOVAC_9000.contactRadius };
    this.lane = this.addDecal(laneDecal(ROBOVAC_9000.chargeDistance, ROBOVAC_9000.contactRadius * 2, DECAL_COLORS.danger, 0.4));
    this.lane.visible = false;
    this.stunRing = this.addDecal(ringDecal(1, 1.18, DECAL_COLORS.warn, 0.7));
    this.stunRing.visible = false;
  }

  /** Visual + contact scale relative to full size. */
  get scale(): number {
    return this.size / ROBOVAC_9000.size;
  }

  absorbRadius(run: Run): number {
    return absorbRadiusFor(this.size, run.bunny.stats.get('absorbRatio'));
  }

  protected tick(dt: number, run: Run): void {
    const c = ROBOVAC_9000;
    const b = run.bunny;
    const radius = c.contactRadius * this.scale;
    const dx = b.x - this.x;
    const dz = b.z - this.z;
    const dist = Math.hypot(dx, dz);
    this.timer -= dt;
    this.spin('brush_l', dt * 16);
    this.spin('brush_r', -dt * 16);

    switch (this.state) {
      case 'intro':
        if (canTarget(run)) this.yaw = turnTowards(this.yaw, yawOf(dx, dz), c.turnRate * dt);
        if (this.timer <= 0) this.enter('hunt', randomIn(this.rng, c.huntTime));
        break;
      case 'hunt': {
        // Hidden Bunny (Dust Cloud): wander instead of chasing.
        if (canTarget(run)) this.yaw = turnTowards(this.yaw, yawOf(dx, dz), c.turnRate * dt);
        else this.yaw += Math.sin(this.time * 0.7) * dt;
        this.drive(run, c.huntSpeed * dt, radius);
        if (!bunnySheltered(run, c.height)) {
          const reach = radius + suctionReachFor(c.suctionReach, b.stats.get('suctionMultiplier'));
          applySuction(run, this.x, this.z, c.suctionStrength, suctionFalloff(dist - b.radius, radius, reach), dt);
        }
        this.summonTimer -= dt;
        if (this.summonTimer <= 0) {
          this.summonTimer = c.summonInterval;
          this.summon(run);
        }
        if (this.timer <= 0 && dist < c.chargeTrigger && canTarget(run)) {
          this.enter('telegraph', c.telegraph);
          this.yaw = yawOf(dx, dz);
          this.chargeDirX = Math.sin(this.yaw);
          this.chargeDirZ = Math.cos(this.yaw);
          this.lane.visible = true;
          this.emitTelegraph(run, 'charge', c.telegraph);
        }
        break;
      }
      case 'telegraph':
        this.lane.place(this.x, this.z, this.yaw);
        this.lane.root.scale.set(this.scale, 1, 1);
        this.lane.pulse(this.time, 1 - this.timer / c.telegraph);
        if (this.timer <= 0) {
          this.enter('charge', 99);
          this.charged = 0;
        }
        break;
      case 'charge': {
        const step = c.chargeSpeed * dt;
        const m = this.drive(run, step, radius, this.chargeDirX, this.chargeDirZ);
        this.charged += step;
        this.lane.setOpacity(0.25);
        if (m.hit) {
          this.lane.visible = false;
          this.hitThisStun = false;
          this.enter('stunned', c.stunTime);
          run.events.emit('bossStunned', { hazardId: this.id });
        } else if (this.charged >= c.chargeDistance) {
          this.lane.visible = false;
          this.enter('recover', c.recover);
        }
        break;
      }
      case 'stunned':
        this.yaw += Math.sin(this.time * 40) * 0.02;
        if (this.timer <= 0) this.enter('recover', c.recover);
        break;
      case 'recover':
        if (this.timer <= 0) this.enter('hunt', randomIn(this.rng, c.huntTime));
        break;
    }

    this.stunRing.visible = this.state === 'stunned';
    if (this.stunRing.visible) {
      this.stunRing.place(this.x, this.z);
      this.stunRing.root.scale.set(radius * 1.1, 1, radius * 1.1);
      this.stunRing.pulse(this.time, 0.5);
    }
  }

  /** Spiky Dash stun: it can be chipped once during it, like a wall crash. */
  override stun(_seconds: number): void {
    this.hitThisStun = false;
  }

  private enter(state: BossState, time: number): void {
    this.state = state;
    this.timer = time;
  }

  private drive(run: Run, step: number, radius: number, dirX = Math.sin(this.yaw), dirZ = Math.cos(this.yaw)) {
    const m = moveCircle(run.house, this.x, this.z, radius, ROBOVAC_9000.height, dirX * step, dirZ * step);
    this.x = m.x;
    this.z = m.z;
    return m;
  }

  private summon(run: Run): void {
    const c = ROBOVAC_9000;
    for (const id of [...this.minis]) if (!run.hazards.hazards.some((h) => h.id === id && !h.dead)) this.minis.delete(id);
    for (let n = 0; n < c.summonCount && this.minis.size < c.maxMinis; n++) {
      for (let tries = 0; tries < 8; tries++) {
        const a = this.rng.range(0, Math.PI * 2);
        const d = c.contactRadius * this.scale + 20;
        const x = this.x + Math.cos(a) * d;
        const z = this.z + Math.sin(a) * d;
        if (!hazardFloorFree(run.house, x, z, 11, 7)) continue;
        this.minis.add(run.hazards.spawn('mini_roomba', x, z).id);
        break;
      }
    }
  }

  protected override sync(run: Run): void {
    this.shape = { kind: 'circle', radius: ROBOVAC_9000.contactRadius * this.scale };
    this.body.scale.setScalar(this.scale);
    super.sync(run);
  }

  onContact(run: Run): void {
    const c = ROBOVAC_9000;
    const b = run.bunny;
    if (bunnySheltered(run, c.height)) return;
    const radius = c.contactRadius * this.scale;
    if (this.state === 'stunned' || this.stunned) {
      if (!this.hitThisStun) {
        this.hitThisStun = true;
        this.hits++;
        this.size = bossSizeAfterHits(this.hits);
        // Parts knocked loose: absorbable Debris around the boss.
        scatterDebris(run, this.rng, this.x, this.z, c.chipPieces, b.radius * 0.45, radius + b.radius, radius + b.radius * 4);
        run.events.emit('bossHit', { hazardId: this.id, size: this.size, absorbRadius: this.absorbRadius(run) });
        if (this.state === 'stunned') this.timer = Math.min(this.timer, 0.6);
      }
      knockbackCm(b, b.x - this.x, b.z - this.z, b.radius * 2);
      pushBunnyOut(run, this.x, this.z, radius);
      return;
    }
    const knock = this.state === 'charge' ? 1.5 : 1;
    if (hitBunny(run, this.x, this.z, { damage: c.damage, source: this.def.id, knockbackCm: c.knockbackCm * knock, knockbackRadii: c.knockbackRadii * knock }) && b.alive) {
      shedMass(run, this.rng, c.shedFraction, this.def.id);
    }
    pushBunnyOut(run, this.x, this.z, radius);
  }

  override onAbsorbed(run: Run): void {
    super.onAbsorbed(run);
    for (const h of run.hazards.hazards) if (this.minis.has(h.id)) h.dead = true;
    run.events.emit('bossDefeated', { hazardId: this.id, timeSec: run.time });
    run.events.emit('victory', { timeSec: run.time, radius: run.bunny.radius });
    run.end('victory');
  }
}

export const robovacDef = hazardRegistry.register({
  id: 'robovac_9000',
  name: 'Robo-Vac 9000',
  minTier: 5,
  spawnWeight: 0,
  maxAlive: 1,
  mass: ROBOVAC_9000.mass,
  modelId: 'robovac_9000',
  create(_run, x, z, id, rng: Rng) {
    return new RoboVac9000(id, this, x, z, rng);
  },
});
