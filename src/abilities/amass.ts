/**
 * Tumble · Amass (hold). Press to compact the core, hold up to maxHold seconds, release at any
 * time. Cooldown after release: cooldownBase + cooldownPerSecondHeld × seconds channelled. Can't
 * start while stuck to a Lint Roller (bunny.rooted). The Area changing ends it.
 *
 * While channelling, `bunny.amassing` is true and:
 *   - Tumble moves at moveSpeedMul of its max speed and can't Dash; it can't be knocked back or
 *     pushed (Bunny.knockback, applyPush), and Hazard bodies are moved instead (separateFromBunny);
 *     it takes damageReduction less damage (the combat filter reads `bunny.amassGuard`); suction
 *     pulls suctionMul harder. The slow and the suction are timed modifiers, above the caps.
 *   - Gravity: every Debris on the map up to pullRatio × r (not locked) and every non-boss,
 *     tangible Hazard up to pullRatio × r is pulled in at pullSpeed × forceMul r/s, full strength
 *     within coreRadius r and falling off linearly to edgeFalloff at the map's farthest corner,
 *     leaning swirlDeg off straight inward. Bigger Debris and Hazards near Tumble only shake.
 *     Debris it can't absorb stops at Tumble's fur. Far Debris is moved in three interleaved
 *     slices (one per tick, three ticks' worth each) to keep the cost flat.
 *   - Contact (HazardManager.contactOverride): a non-boss Hazard up to absorbRatio × r is
 *     swallowed (absorbed as usual, plus scrap and a shockwave that stuns small Hazards nearby);
 *     a charging boss crashes as into a wall: stunned for its stunTime if the 6 s limit allows,
 *     and the chip that follows sheds bossChipParts more parts. Everything else is a normal hit.
 *
 * Keepsakes act through the params (Dense Core, Lingering Mass, Unmoved's guard) and here:
 * Collapse (release or max hold: Hazards within collapseRadius r of Tumble's surface are stunned,
 * non-bosses knocked back; bosses get collapseBossStun of the stun, within the limit) and Feast
 * (growthMultiplier × (1 + feastBonus) during the channel and feastLinger s after).
 */
import type { InputState } from '../core/input';
import type { Debris } from '../entities/debris';
import { TIMED_PRIORITY } from '../entities/stats';
import type { Run } from '../game/run';
import type { Hazard } from '../hazards';
import { BaseHazard } from '../hazards/base';
import { bunnySheltered, moveCircle } from '../hazards/common';
import { scatterDebris } from '../hazards/shed';
import { canAbsorb, debrisLocked } from '../systems/absorb';
import type { AbilityEndReason } from './events';
import { AbilitySystem, hazardRadius, isBoss, registerAbilityController, type AbilityController } from './system';
import { AmassView } from './view';

const AMASS_SOURCE = 'ability:amass';
const FEAST_SOURCE = 'ability:amass:feast';
/** Debris within this many r beyond the core is pulled every tick; farther Debris in slices. */
const NEAR_BAND = 6;
/** Oversized Debris and Hazards within this many r of Tumble's surface shake. */
const SHAKE_RANGE = 8;
/** At most this many Debris shake at once (the nearest are kept). */
const SHAKE_MAX = 32;
/** Shake amplitude: this fraction of the shaking thing's size, at most SHAKE_MAX_R × r. */
const SHAKE_AMP = 0.03;
const SHAKE_MAX_R = 0.06;
/** Seconds a Collapse knockback takes. */
const KNOCKBACK_TIME = 0.2;

interface Knock {
  h: BaseHazard;
  dirX: number;
  dirZ: number;
  /** World units still to travel. */
  left: number;
  speed: number;
}

interface Shake {
  d: Debris;
  ox: number;
  oz: number;
}

export class AmassAbility implements AbilityController {
  readonly id = 'amass';
  /** Seconds channelled in the current Amass (or the last one, after release). */
  held = 0;
  cooldownLeft = 0;
  /** Length of the cooldown that is running. */
  cooldownTotal = 0;
  private readonly view = new AmassView();
  private time = 0;
  private tick = 0;
  private readonly knocks: Knock[] = [];
  private readonly shakes = new Map<number, Shake>();
  private readonly shakingHazards = new Set<BaseHazard>();
  private readonly scratch: { d: Debris; dist: number }[] = [];

  constructor(private readonly system: AbilitySystem) {
    const run = system.run;
    run.entityRoot.add(this.view.root);
    run.hazards.contactOverride = (r, h) => this.contact(r, h);
  }

  private get p() {
    return this.system.params.amass;
  }

  get active(): boolean {
    return this.system.run.bunny.amassing;
  }

  get ready(): boolean {
    return !this.active && this.cooldownLeft <= 0;
  }

  /** True if an Amass could start now (off cooldown, not stuck, alive). */
  get canStart(): boolean {
    const b = this.system.run.bunny;
    return this.ready && b.rooted <= 0 && b.alive;
  }

  /** Hazards being knocked back by a Collapse right now (tests). */
  get knocking(): number {
    return this.knocks.length;
  }

  update(dt: number, input: InputState): void {
    const b = this.system.run.bunny;
    this.time += dt;
    this.tick++;
    this.stepKnocks(dt);
    if (this.active) {
      this.held = Math.min(this.p.maxHold, this.held + dt);
      if (!b.alive || !input.abilityHeld) this.release('released');
      else if (this.held >= this.p.maxHold) this.release('maxHold');
      else this.pull(dt);
    } else {
      this.cooldownLeft = Math.max(0, this.cooldownLeft - dt);
      if (input.ability && this.canStart) this.start();
    }
    const p = this.p;
    this.view.update(dt, this.time, this.active, b.x, b.z, b.radius, Math.min(1, this.held / p.maxHold), p.coreRadius);
  }

  start(): void {
    const run = this.system.run;
    const b = run.bunny;
    const p = this.p;
    b.amassing = true;
    b.amassGuard = p.damageReduction;
    b.amassSwallowSize = b.radius * p.absorbRatio;
    b.dashTime = 0;
    b.impulseX = b.impulseZ = 0;
    this.held = 0;
    b.stats.add({ stat: 'speed', op: 'mul', value: p.moveSpeedMul, source: AMASS_SOURCE, priority: TIMED_PRIORITY });
    b.stats.add({ stat: 'suctionMultiplier', op: 'mul', value: p.suctionMul, source: AMASS_SOURCE, priority: TIMED_PRIORITY });
    if (p.feastBonus > 0) {
      b.stats.removeSource(FEAST_SOURCE);
      b.stats.add({ stat: 'growthMultiplier', op: 'mul', value: 1 + p.feastBonus, source: FEAST_SOURCE, priority: TIMED_PRIORITY });
    }
    run.events.emit('abilityUsed', { ability: 'amass', x: b.x, z: b.z });
  }

  release(reason: AbilityEndReason): void {
    const run = this.system.run;
    const b = run.bunny;
    if (!b.amassing) return;
    const p = this.p;
    b.amassing = false;
    b.amassGuard = 0;
    b.amassSwallowSize = 0;
    b.stats.removeSource(AMASS_SOURCE);
    if (p.feastBonus > 0) {
      b.stats.removeSource(FEAST_SOURCE);
      if (reason !== 'area' && p.feastLinger > 0) b.stats.add({ stat: 'growthMultiplier', op: 'mul', value: 1 + p.feastBonus, source: FEAST_SOURCE, priority: TIMED_PRIORITY, duration: p.feastLinger });
    }
    this.stopShaking();
    this.cooldownTotal = p.cooldownBase + p.cooldownPerSecondHeld * this.held;
    this.cooldownLeft = this.cooldownTotal;
    if (reason !== 'area' && b.alive && p.collapseRadius > 0) this.collapse(run);
    run.events.emit('abilityEnded', { ability: 'amass', reason, x: b.x, z: b.z, heldFor: this.held, cooldown: this.cooldownTotal });
  }

  /** Pull strength (0..1) at `dist` from the Bunny's centre: 1 in the core, edgeFalloff at `edge`. */
  falloff(dist: number, core: number, edge: number): number {
    if (dist <= core) return 1;
    const t = Math.min(1, (dist - core) / Math.max(1e-6, edge - core));
    return 1 - (1 - this.p.edgeFalloff) * t;
  }

  /** Distance from the Bunny to the farthest corner of the map (the pull's edge). */
  private mapEdge(run: Run): number {
    const b = run.bunny;
    const r = run.house.bounds;
    const fx = Math.max(Math.abs(b.x - r.minX), Math.abs(r.maxX - b.x));
    const fz = Math.max(Math.abs(b.z - r.minZ), Math.abs(r.maxZ - b.z));
    return Math.hypot(fx, fz);
  }

  /** One tick of gravity on Debris and Hazards (see file header). */
  private pull(dt: number): void {
    const run = this.system.run;
    const b = run.bunny;
    const p = this.p;
    const r = b.radius;
    const ramp = p.rampTime > 0 ? Math.min(1, this.held / p.rampTime) : 1;
    const speed = p.pullSpeed * p.forceMul * r * ramp;
    const core = p.coreRadius * r;
    const edge = Math.max(core + r, this.mapEdge(run));
    const near = core + NEAR_BAND * r;
    const limit = r * p.pullRatio;
    const ratio = b.stats.get('absorbRatio');
    const swirl = (p.swirlDeg * Math.PI) / 180;
    const cos = Math.cos(swirl);
    const sin = Math.sin(swirl);
    const slice = this.tick % 3;
    const shakeReach = r + SHAKE_RANGE * r;
    const shakeCandidates = this.scratch;
    shakeCandidates.length = 0;

    const step = (x: number, z: number, dist: number, k: number, stop: number): { x: number; z: number } | null => {
      const s = Math.min(speed * this.falloff(dist, core, edge) * dt * k, dist - stop);
      if (s <= 1e-6) return null;
      // Inward, leaning `swirl` towards the tangent (counter-clockwise seen from above).
      const ux = (b.x - x) / dist;
      const uz = (b.z - z) / dist;
      return { x: x + (ux * cos - uz * sin) * s, z: z + (uz * cos + ux * sin) * s };
    };

    run.debris.forEach((d) => {
      const dx = b.x - d.x;
      const dz = b.z - d.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 1e-6) return;
      if (d.size > limit || debrisLocked(b, d)) {
        if (dist - d.size < shakeReach) shakeCandidates.push({ d, dist });
        return;
      }
      const isNear = dist <= near;
      if (!isNear && d.id % 3 !== slice) return;
      const stop = canAbsorb(r, ratio, d.size) ? 0 : r + d.size;
      const to = step(d.x, d.z, dist, isNear ? 1 : 3, stop);
      if (to) run.debris.move(d, to.x, to.z);
    });
    this.shakeDebris(shakeCandidates);

    for (const h of run.hazards.hazards) {
      if (h.dead || h.intangible || !(h instanceof BaseHazard)) continue;
      const dist = Math.hypot(b.x - h.x, b.z - h.z);
      if (dist < 1e-6) continue;
      const hr = hazardRadius(h);
      if (isBoss(h) || h.size > limit) {
        const shake = dist - hr < shakeReach;
        h.tension = shake ? Math.min(SHAKE_AMP * hr, SHAKE_MAX_R * r) : 0;
        if (shake) this.shakingHazards.add(h);
        continue;
      }
      const to = step(h.x, h.z, dist, 1, r + hr);
      if (!to) continue;
      const m = moveCircle(run.house, h.x, h.z, hr, h.collisionHeight, to.x - h.x, to.z - h.z);
      h.x = m.x;
      h.z = m.z;
    }
  }

  /** Shakes the nearest oversized Debris in place (offsets undone each tick and on release). */
  private shakeDebris(candidates: { d: Debris; dist: number }[]): void {
    const run = this.system.run;
    const r = run.bunny.radius;
    if (candidates.length > SHAKE_MAX) {
      candidates.sort((a, c) => a.dist - c.dist);
      candidates.length = SHAKE_MAX;
    }
    const keep = new Set<number>();
    for (const { d } of candidates) {
      keep.add(d.id);
      const prev = this.shakes.get(d.id);
      const amp = Math.min(SHAKE_AMP * d.size, SHAKE_MAX_R * r);
      const ox = amp * Math.sin(this.time * 53 + d.id * 1.7);
      const oz = amp * Math.cos(this.time * 61 + d.id * 2.3);
      run.debris.move(d, d.x - (prev?.ox ?? 0) + ox, d.z - (prev?.oz ?? 0) + oz);
      if (prev) {
        prev.ox = ox;
        prev.oz = oz;
      } else this.shakes.set(d.id, { d, ox, oz });
    }
    for (const [id, s] of this.shakes) {
      if (keep.has(id)) continue;
      if (s.d.alive) run.debris.move(s.d, s.d.x - s.ox, s.d.z - s.oz);
      this.shakes.delete(id);
    }
  }

  private stopShaking(): void {
    const run = this.system.run;
    for (const s of this.shakes.values()) if (s.d.alive) run.debris.move(s.d, s.d.x - s.ox, s.d.z - s.oz);
    this.shakes.clear();
    for (const h of this.shakingHazards) h.tension = 0;
    this.shakingHazards.clear();
  }

  /** HazardManager.contactOverride: true if Amass handled the contact (see file header). */
  contact(run: Run, h: Hazard): boolean {
    const b = run.bunny;
    if (!b.amassing || h.intangible) return false;
    if (isBoss(h)) {
      if (!h.charging || h.stunned || bunnySheltered(run, h.cfg.height)) return false;
      // Inside the 6 s Ability-stun limit it hits Tumble as usual.
      if (!this.system.stunBoss(h, h.cfg.stunTime, 'amass')) return false;
      run.events.emit('bossCrashedIntoAmass', { hazardId: h.id });
      h.chipBonus = { hold: 0, pieces: this.p.bossChipParts };
      // Stunned now, so this contact lands the chip.
      h.onContact(run);
      return true;
    }
    if (h.size > b.radius * this.p.absorbRatio) return false;
    this.swallow(run, h);
    return true;
  }

  /** Swallows a non-boss Hazard: absorbed as usual, plus scrap and the micro-shockwave. */
  private swallow(run: Run, h: Hazard): void {
    const b = run.bunny;
    const p = this.p;
    const x = h.x;
    const z = h.z;
    const hr = hazardRadius(h);
    run.hazards.absorb(h);
    if (run.ended) return;
    scatterDebris(run, this.system.rng, x, z, p.scrapPieces, p.scrapSize * b.radius, b.radius * 0.3, hr + b.radius * 1.2);
    const reach = p.shockwaveRadius * b.radius;
    let stunned = 0;
    for (const o of run.hazards.hazards) {
      if (o.dead || o.intangible || isBoss(o) || o.size > b.radius * p.pullRatio) continue;
      if (Math.hypot(o.x - b.x, o.z - b.z) - b.radius - hazardRadius(o) > reach) continue;
      this.system.stunHazard(o, p.shockwaveStun);
      stunned++;
    }
    run.events.emit('hazardSwallowed', { hazardId: h.id, defId: h.def.id, x, z, stunned });
  }

  /** Collapse: stuns (and knocks back) every Hazard within collapseRadius r of Tumble's surface. */
  private collapse(run: Run): void {
    const b = run.bunny;
    const p = this.p;
    const reach = p.collapseRadius * b.radius;
    let hit = 0;
    for (const h of run.hazards.hazards) {
      if (h.dead || h.intangible) continue;
      const dx = h.x - b.x;
      const dz = h.z - b.z;
      const d = Math.hypot(dx, dz);
      if (d - b.radius - hazardRadius(h) > reach) continue;
      if (isBoss(h)) {
        if (this.system.stunBoss(h, p.collapseStun * p.collapseBossStun, 'amass')) hit++;
        continue;
      }
      this.system.stunHazard(h, p.collapseStun);
      hit++;
      if (h.ranged || !(h instanceof BaseHazard) || p.collapseKnockback <= 0) continue;
      const dist = p.collapseKnockback * b.radius;
      this.knocks.push({ h, dirX: d > 1e-6 ? dx / d : 1, dirZ: d > 1e-6 ? dz / d : 0, left: dist, speed: dist / KNOCKBACK_TIME });
    }
    this.view.collapse(b.x, b.z, b.radius + reach);
    run.events.emit('amassCollapsed', { x: b.x, z: b.z, radius: b.radius + reach, hit });
  }

  private stepKnocks(dt: number): void {
    const run = this.system.run;
    for (let i = this.knocks.length - 1; i >= 0; i--) {
      const n = this.knocks[i]!;
      const step = Math.min(n.left, n.speed * dt);
      const m = n.h.dead ? null : moveCircle(run.house, n.h.x, n.h.z, hazardRadius(n.h), n.h.collisionHeight, n.dirX * step, n.dirZ * step);
      if (m) {
        n.h.x = m.x;
        n.h.z = m.z;
      }
      n.left -= step;
      if (!m || m.hit || n.left <= 1e-6) this.knocks.splice(i, 1);
    }
  }

  hud() {
    if (this.active) {
      const left = Math.max(0, this.p.maxHold - this.held);
      return { ready: false, active: true, ring: left / this.p.maxHold, label: left.toFixed(1) };
    }
    const cd = this.cooldownTotal;
    return { ready: this.ready, active: false, ring: cd > 0 ? 1 - this.cooldownLeft / cd : 1, label: this.cooldownLeft > 0 ? String(Math.ceil(this.cooldownLeft)) : null };
  }

  areaChanged(): void {
    // The old Area's Debris and Hazards are gone: forget them before releasing.
    this.shakes.clear();
    this.shakingHazards.clear();
    this.knocks.length = 0;
    this.release('area');
  }

  dispose(): void {
    const run = this.system.run;
    const b = run.bunny;
    this.stopShaking();
    b.amassing = false;
    b.amassGuard = 0;
    b.amassSwallowSize = 0;
    b.stats.removeSource(AMASS_SOURCE);
    b.stats.removeSource(FEAST_SOURCE);
    if (run.hazards.contactOverride) run.hazards.contactOverride = null;
    this.knocks.length = 0;
    this.view.dispose();
  }
}

registerAbilityController('amass', (system) => new AmassAbility(system));
