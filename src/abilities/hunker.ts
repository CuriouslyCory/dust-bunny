/**
 * Tumble · Hunker (hold). Press to plant, hold up to maxHold seconds, release at any time.
 * Cooldown after release: cooldownBase + cooldownPerSecondHeld × seconds held. Can't start while
 * stuck to a Lint Roller (bunny.rooted).
 *
 * While planted, `bunny.hunkered` is true and the shared hooks do the rest: no movement or Dash
 * (movement), no damage (combat filter), no mass shed (shedMass), no knockback (Bunny.knockback),
 * suction or Leaf Blower push (applySuction / applyPush). Debris is still absorbed and magneted.
 *
 * Hazard contact while planted goes to `plantedContact` (HazardManager.plantedContact) instead of
 * onContact:
 *   - a boss hunting or charging into it is stunned for its stunTime (+ bossStunBonus) like a wall
 *     crash, if the boss limit allows, and the hit lands at once (onContact while stunned);
 *     otherwise it bounces off. A boss that is already stunned takes a hit as usual.
 *   - other Hazards run `onPlanted` if they have one (Broom, Lint Roller), else recoil
 *     (HAZARD_RECOIL) and are pushed back out of contact.
 */
import type { InputState } from '../core/input';
import { HAZARD_RECOIL } from '../data/hazards';
import { TIMED_PRIORITY } from '../entities/stats';
import type { Run } from '../game/run';
import type { Hazard } from '../hazards';
import { BaseHazard } from '../hazards/base';
import { bunnySheltered, separateFromBunny } from '../hazards/common';
import type { AbilityEndReason } from './events';
import { AbilitySystem, hazardRadius, isBoss, registerAbilityController, type AbilityController } from './system';
import { PlantedView } from './view';

const MAGNET_SOURCE = 'ability:hunker';

export class HunkerAbility implements AbilityController {
  readonly id = 'hunker';
  /** Seconds held in the current plant (or the last one, after release). */
  held = 0;
  cooldownLeft = 0;
  /** Length of the cooldown that is running. */
  cooldownTotal = 0;
  private readonly view = new PlantedView();
  private time = 0;
  /** Hazards touching the planted Bunny this tick / last tick (hazardHitPlanted fires on first contact). */
  private touching = new Set<number>();
  private touchedBefore = new Set<number>();

  constructor(private readonly system: AbilitySystem) {
    const run = system.run;
    run.entityRoot.add(this.view.root);
    run.hazards.plantedContact = (r, h) => this.plantedContact(r, h);
  }

  private get p() {
    return this.system.params.hunker;
  }

  get active(): boolean {
    return this.system.run.bunny.hunkered;
  }

  get ready(): boolean {
    return !this.active && this.cooldownLeft <= 0;
  }

  /** True if a plant could start now (off cooldown, not stuck, alive). */
  get canPlant(): boolean {
    const b = this.system.run.bunny;
    return this.ready && b.rooted <= 0 && b.alive;
  }

  update(dt: number, input: InputState): void {
    const b = this.system.run.bunny;
    this.time += dt;
    const prev = this.touchedBefore;
    this.touchedBefore = this.touching;
    this.touching = prev;
    this.touching.clear();
    if (this.active) {
      this.held += dt;
      if (!b.alive || !input.abilityHeld) this.release('released');
      else if (this.held >= this.p.maxHold) this.release('maxHold');
    } else {
      this.cooldownLeft = Math.max(0, this.cooldownLeft - dt);
      if (input.ability && this.canPlant) this.plant();
    }
    this.view.update(this.time, this.active, b.x, b.z, b.radius, Math.min(1, this.held / this.p.maxHold));
  }

  plant(): void {
    const run = this.system.run;
    const b = run.bunny;
    b.hunkered = true;
    b.dashTime = 0;
    b.vx = b.vz = b.impulseX = b.impulseZ = 0;
    this.held = 0;
    if (this.p.plantedMagnetBonus > 0) b.stats.add({ stat: 'magnetRadius', op: 'add', value: this.p.plantedMagnetBonus, source: MAGNET_SOURCE, priority: TIMED_PRIORITY });
    run.events.emit('abilityUsed', { ability: 'hunker', x: b.x, z: b.z });
  }

  release(reason: AbilityEndReason): void {
    const run = this.system.run;
    const b = run.bunny;
    if (!b.hunkered) return;
    b.hunkered = false;
    b.stats.removeSource(MAGNET_SOURCE);
    this.cooldownTotal = this.p.cooldownBase + this.p.cooldownPerSecondHeld * this.held;
    this.cooldownLeft = this.cooldownTotal;
    run.events.emit('abilityEnded', { ability: 'hunker', reason, x: b.x, z: b.z, heldFor: this.held, cooldown: this.cooldownTotal });
  }

  /** HazardManager contact while planted (see file header). */
  plantedContact(run: Run, h: Hazard): void {
    const first = !this.touchedBefore.has(h.id) && !this.touching.has(h.id);
    this.touching.add(h.id);
    if (isBoss(h)) {
      if (bunnySheltered(run, h.cfg.height)) return;
      if (h.state === 'stunned' || h.stunned) {
        h.onContact(run);
        return;
      }
      const stunned = h.crashesIntoPlanted && this.system.stunBoss(h, h.cfg.stunTime + this.p.bossStunBonus, 'hunker');
      if (first || stunned) this.touched(run, h, stunned);
      if (stunned) h.onContact(run);
      else h.bounceOff(run);
      return;
    }
    if (h.onPlanted) h.onPlanted(run);
    else if (h instanceof BaseHazard) {
      h.recoilFor = Math.max(h.recoilFor, HAZARD_RECOIL);
      separateFromBunny(run, h, hazardRadius(h), h.collisionHeight);
    }
    if (first) this.touched(run, h, false);
  }

  private touched(run: Run, h: Hazard, stunned: boolean): void {
    run.events.emit('hazardHitPlanted', { hazardId: h.id, defId: h.def.id, boss: !!h.def.boss, stunned });
    this.system.hooks.plantedTouched?.(run, h, stunned);
  }

  hud() {
    if (this.active) {
      const left = Math.max(0, this.p.maxHold - this.held);
      return { ready: false, active: true, ring: left / this.p.maxHold, label: left.toFixed(1) };
    }
    const cd = this.cooldownTotal;
    return { ready: this.ready, active: false, ring: cd > 0 ? 1 - this.cooldownLeft / cd : 1, label: this.cooldownLeft > 0 ? String(Math.ceil(this.cooldownLeft)) : null };
  }

  areaChanged(): void {}

  dispose(): void {
    const run = this.system.run;
    run.bunny.hunkered = false;
    run.bunny.stats.removeSource(MAGNET_SOURCE);
    if (run.hazards.plantedContact) run.hazards.plantedContact = null;
    this.view.dispose();
  }
}

registerAbilityController('hunker', (system) => new HunkerAbility(system));
