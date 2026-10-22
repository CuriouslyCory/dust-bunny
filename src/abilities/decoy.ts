/**
 * Lint · Decoy (tap). Sheds a still lint ball (radius × Bunny radius) for `duration` seconds at
 * no volume cost; the cooldown starts when it ends.
 *
 *   Lure: while it is out it is the Run's Lure (hazards/common.ts setLure), so every Hazard that
 *     aims at the Bunny aims at it instead while it is inside that Hazard's aggro / trigger range
 *     (× lureRangeMul). Suction still pulls the Bunny by distance; vacuums also drag the Decoy in.
 *   Clog: a non-ranged Hazard whose body touches it pops it and is stunned for clogStun (bosses:
 *     bossClogStun via the boss limit, so a chip lands while the boss is clogged).
 *   Ranged Hazards (turrets, Leaf Blower) are never clogged; their spray or blast pops it (shot).
 */
import { circleVsCircle, circleVsRect } from '../core/math';
import type { InputState } from '../core/input';
import { activeLure, setLure, type Lure } from '../hazards/common';
import type { Hazard } from '../hazards';
import type { AbilityEndReason } from './events';
import { AbilitySystem, isBoss, registerAbilityController, type AbilityController } from './system';
import { DecoyView } from './view';

export class Decoy implements Lure {
  x: number;
  z: number;
  readonly radius: number;
  rangeMul: number;
  wanderRange: number;
  age = 0;
  /** Set when a ranged attack reached it; the controller ends it on its next update. */
  shotBy: Hazard | null = null;

  constructor(x: number, z: number, radius: number, rangeMul: number, wanderRange: number) {
    this.x = x;
    this.z = z;
    this.radius = radius;
    this.rangeMul = rangeMul;
    this.wanderRange = wanderRange;
  }

  shot(h: Hazard): void {
    this.shotBy ??= h;
  }
}

function touchesDecoy(h: Hazard, d: Decoy): boolean {
  return h.shape.kind === 'circle'
    ? circleVsCircle(d.x, d.z, d.radius, h.x, h.z, h.shape.radius) !== null
    : circleVsRect(d.x, d.z, d.radius, { minX: h.x - h.shape.halfW, maxX: h.x + h.shape.halfW, minZ: h.z - h.shape.halfD, maxZ: h.z + h.shape.halfD }) !== null;
}

export class DecoyAbility implements AbilityController {
  readonly id = 'decoy';
  decoy: Decoy | null = null;
  cooldownLeft = 0;
  private view: DecoyView | null = null;
  private readonly popping: DecoyView[] = [];
  private time = 0;

  constructor(private readonly system: AbilitySystem) {}

  private get p() {
    return this.system.params.decoy;
  }

  get ready(): boolean {
    return !this.decoy && this.cooldownLeft <= 0;
  }

  update(dt: number, input: InputState): void {
    const run = this.system.run;
    this.time += dt;
    for (let i = this.popping.length - 1; i >= 0; i--) {
      const v = this.popping[i]!;
      if (!v.pop(dt)) {
        v.dispose();
        this.popping.splice(i, 1);
      }
    }
    const d = this.decoy;
    if (d) {
      d.age += dt;
      if (d.shotBy) this.end('shot');
      else if (!this.clogCheck(d) && d.age >= this.p.duration) this.end('expired');
      this.view?.update(this.time, d.x, d.z, d.radius, Math.min(1, d.age / this.p.duration));
    } else {
      this.cooldownLeft = Math.max(0, this.cooldownLeft - dt);
    }
    if (input.ability && this.ready && run.bunny.alive) this.shed();
  }

  /** Sheds a Decoy at the Bunny's position. */
  shed(): void {
    const run = this.system.run;
    const b = run.bunny;
    const d = new Decoy(b.x, b.z, this.p.radius * b.radius, this.p.lureRangeMul, this.p.wandererLureRange * b.radius);
    this.decoy = d;
    setLure(run, d);
    this.view = new DecoyView(this.system.rng);
    run.entityRoot.add(this.view.root);
    this.view.update(this.time, d.x, d.z, d.radius, 0);
    run.events.emit('abilityUsed', { ability: 'decoy', x: b.x, z: b.z });
  }

  /** The first non-ranged Hazard touching the Decoy clogs on it. Returns true if it popped. */
  private clogCheck(d: Decoy): boolean {
    const run = this.system.run;
    for (const h of run.hazards.hazards) {
      if (h.dead || h.ranged || !touchesDecoy(h, d)) continue;
      let seconds = 0;
      if (isBoss(h)) {
        seconds = this.p.bossClogStun;
        if (!this.system.stunBoss(h, seconds, 'decoy')) seconds = 0;
      } else {
        seconds = this.p.clogStun;
        this.system.stunHazard(h, seconds);
      }
      run.events.emit('hazardClogged', { hazardId: h.id, defId: h.def.id, boss: !!h.def.boss, seconds });
      this.end('clogged');
      return true;
    }
    return false;
  }

  end(reason: AbilityEndReason): void {
    const d = this.decoy;
    if (!d) return;
    const run = this.system.run;
    this.decoy = null;
    if (activeLure(run) === d) setLure(run, null);
    if (this.view) {
      if (reason === 'area') this.view.dispose();
      else this.popping.push(this.view);
      this.view = null;
    }
    this.cooldownLeft = this.p.cooldown;
    run.events.emit('abilityEnded', { ability: 'decoy', reason, x: d.x, z: d.z, heldFor: d.age, cooldown: this.cooldownLeft });
    this.system.hooks.decoyEnded?.(run, reason, d.x, d.z);
  }

  hud() {
    const d = this.decoy;
    if (d) return { ready: false, active: true, ring: Math.max(0, 1 - d.age / this.p.duration), label: null };
    const cd = this.p.cooldown;
    return { ready: this.ready, active: false, ring: cd > 0 ? 1 - this.cooldownLeft / cd : 1, label: this.cooldownLeft > 0 ? String(Math.ceil(this.cooldownLeft)) : null };
  }

  areaChanged(): void {
    this.end('area');
  }

  dispose(): void {
    const run = this.system.run;
    if (this.decoy && activeLure(run) === this.decoy) setLure(run, null);
    this.decoy = null;
    this.view?.dispose();
    this.view = null;
    for (const v of this.popping) v.dispose();
    this.popping.length = 0;
  }
}

registerAbilityController('decoy', (system) => new DecoyAbility(system));
