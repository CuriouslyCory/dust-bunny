/** The Bunny: simulation state only (rendering lives in BunnyView). */
import { Quaternion, Vector3 } from 'three';
import type { EventBus } from '../core/events';
import { TUNING } from '../data/tuning';
import type { StatBlock } from './stats';

/**
 * Damage filters run before damage is applied (Bubble Wrap, Slippery...).
 * Return the (possibly reduced) amount; 0 cancels the hit.
 */
export type DamageFilter = (amount: number, source: string) => number;

const _axis = new Vector3();
const _q = new Quaternion();

export class Bunny {
  x: number;
  z: number;
  /** Previous simulation step position, for render interpolation. */
  prevX: number;
  prevZ: number;
  vx = 0;
  vz = 0;
  /** External velocity (knockback, suction); decays every step. */
  impulseX = 0;
  impulseZ = 0;
  radius: number;
  prevRadius: number;
  /** Lateral squeeze while passing a doorway (wall collision radius / radius; 1 = none). */
  squeeze = 1;
  maxRadius: number;
  health: number;
  /** Seconds of remaining invulnerability. */
  invulnerable = 0;
  /** Seconds the Bunny cannot move (Lint Roller stick). */
  rooted = 0;
  /** Remaining dash burst (s) and cooldown (s). */
  dashTime = 0;
  dashCooldownLeft = 0;
  dashDirX = 0;
  dashDirZ = 1;
  /** Facing (yaw, radians) used for eyes; 0 faces +Z. */
  heading = Math.PI;
  /** Accumulated rolling orientation of the fur ball. */
  readonly rollQuat = new Quaternion();
  readonly damageFilters: DamageFilter[] = [];

  // Roguelike hooks (Pickups/Perks set these; see docs/architecture.md "Roguelike hooks").
  /** Bubble Wrap charges; each blocks one hit (handled by the combat damage filter). */
  shield = 0;
  /** Dust Cloud: while true, Hazards must not target, chase, pull or damage the Bunny. */
  hiddenFromHazards = false;
  /** Second Wind charges; a lethal hit restores full health instead (combat damage filter). */
  revives = 0;
  /** Spiky Dash: while `dashing`, Hazard contact stuns the Hazard instead of hurting the Bunny. */
  spikyDash = false;

  constructor(
    private readonly events: EventBus,
    readonly stats: StatBlock,
    x: number,
    z: number,
  ) {
    this.x = this.prevX = x;
    this.z = this.prevZ = z;
    this.radius = this.prevRadius = this.maxRadius = stats.get('startRadius');
    this.health = stats.get('maxHealth');
  }

  get maxHealth(): number {
    return Math.round(this.stats.get('maxHealth'));
  }

  get alive(): boolean {
    return this.health > 0;
  }

  get speed(): number {
    return Math.hypot(this.vx, this.vz);
  }

  get dashing(): boolean {
    return this.dashTime > 0;
  }

  snapshot(): void {
    this.prevX = this.x;
    this.prevZ = this.z;
    this.prevRadius = this.radius;
  }

  setRadius(r: number): void {
    const next = Math.max(TUNING.minRadius, r);
    if (next === this.radius) return;
    const previousRadius = this.radius;
    this.radius = next;
    this.maxRadius = Math.max(this.maxRadius, next);
    this.events.emit('bunnyGrew', { radius: next, previousRadius });
  }

  /** Adds (or removes, if negative) volume in cm³-equivalent units (r³). */
  addVolume(dv: number): void {
    this.setRadius(Math.cbrt(Math.max(TUNING.minRadius ** 3, this.radius ** 3 + dv)));
  }

  /** Returns true if damage was applied. Grants TUNING.invulnerability seconds of i-frames. */
  damage(amount: number, source: string): boolean {
    if (!this.alive || this.invulnerable > 0 || amount <= 0) return false;
    for (const f of this.damageFilters) {
      amount = f(amount, source);
      if (amount <= 0) return false;
    }
    this.health = Math.max(0, this.health - amount);
    this.invulnerable = TUNING.invulnerability;
    this.events.emit('bunnyDamaged', { amount, source, health: this.health, maxHealth: this.maxHealth });
    if (this.health <= 0) this.events.emit('bunnyDied', { source });
    return true;
  }

  heal(amount: number): void {
    if (!this.alive) return;
    const before = this.health;
    this.health = Math.min(this.maxHealth, this.health + amount);
    if (this.health > before) {
      this.events.emit('bunnyHealed', { amount: this.health - before, health: this.health, maxHealth: this.maxHealth });
    }
  }

  /** Knockback away from a point/direction; `strength` is in Bunny radii per second. */
  knockback(dirX: number, dirZ: number, strength: number): void {
    const d = Math.hypot(dirX, dirZ) || 1;
    const k = strength * this.radius * (1 - this.stats.get('knockbackResistance'));
    this.impulseX += (dirX / d) * k;
    this.impulseZ += (dirZ / d) * k;
  }

  /** Rolls the fur ball for a planar displacement. */
  roll(dx: number, dz: number): void {
    const dist = Math.hypot(dx, dz);
    if (dist < 1e-6) return;
    _axis.set(dz / dist, 0, -dx / dist);
    _q.setFromAxisAngle(_axis, dist / this.radius);
    this.rollQuat.premultiply(_q).normalize();
  }
}
