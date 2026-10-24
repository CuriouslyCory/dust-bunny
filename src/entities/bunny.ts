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

/**
 * What the Bunny is made of, for its look (BunnyView): `dust` until it absorbs Sagittarius A*,
 * then `black_hole` (a dark core, an accretion disc of lint, a lensing shimmer; the eyes stay) for
 * the rest of the Run, whatever Area comes next.
 */
export type BunnyForm = 'dust' | 'black_hole';

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
  /** Radius in world units (the current Area's unit, see `unit`). */
  radius: number;
  prevRadius: number;
  /** Centimetres per world unit in the current Area (1 up to the City; re-based by `rebase`). */
  unit = 1;
  /** Lateral squeeze while passing a doorway (wall collision radius / radius; 1 = none). */
  squeeze = 1;
  /** Largest radius this Run, in world units of the current Area (re-based with the radius). */
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
  /**
   * While true, damage() lands nothing and runs no filters: set by the HazardManager around the
   * contact of a Hazard that ignores the Bunny (Unnoticed), so its body still pushes the Bunny out.
   */
  harmless = false;
  /** Second Wind charges; a lethal hit restores full health instead (combat damage filter). */
  revives = 0;
  /** Spiky Dash: while `dashing`, Hazard contact stuns the Hazard instead of hurting the Bunny. */
  spikyDash = false;

  // Ability hooks (set by src/abilities; see docs/architecture.md "Hooks").
  /**
   * Amass (Tumble): channelling its gravity well. Slowed (a timed speed modifier), no Dash,
   * immune to knockback and pushes (Hazards it touches are moved instead), takes reduced damage
   * (combat filter, `amassGuard`); suction pulls harder (a timed suctionMultiplier modifier).
   */
  amassing = false;
  /** Fraction of Hazard damage taken off while `amassing` (set by Amass). */
  amassGuard = 0;
  /** Largest non-boss Hazard size Amass swallows on contact right now (0 when not amassing). */
  amassSwallowSize = 0;
  /** Zap's Static meter, 0..1 (null for Characters without one). Drives Zap's glow. */
  staticCharge: number | null = null;
  /** Its look's form (set by the Run when the Galaxy is cleared; it never goes back). */
  form: BunnyForm = 'dust';

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

  /** Moves the Bunny without interpolation and stops it (area change). */
  teleport(x: number, z: number): void {
    this.x = this.prevX = x;
    this.z = this.prevZ = z;
    this.vx = this.vz = this.impulseX = this.impulseZ = 0;
    this.dashTime = 0;
    this.rooted = 0;
    this.squeeze = 1;
  }

  /** Real radius in cm (Tiers, readouts and scores use this). */
  get realRadius(): number {
    return this.radius * this.unit;
  }

  /**
   * Switches to a world unit of `unit` cm (an Area change): radius, the Run's max radius and
   * speeds are converted so the real size is unchanged. Emits bunnyRebased, not bunnyGrew.
   */
  rebase(unit: number): void {
    if (unit === this.unit) return;
    const f = this.unit / unit;
    this.unit = unit;
    this.radius *= f;
    this.prevRadius *= f;
    this.maxRadius *= f;
    this.x *= f;
    this.z *= f;
    this.prevX *= f;
    this.prevZ *= f;
    this.vx *= f;
    this.vz *= f;
    this.impulseX *= f;
    this.impulseZ *= f;
    this.events.emit('bunnyRebased', { factor: f, unit });
  }

  /**
   * The size leap between Areas (`AREAS[area].arrivalRadius`): scales the Bunny up to `radius`
   * world units without growth (no bunnyGrew); radius, the interpolated radius and the Run's max
   * radius follow. Emits bunnyLeapt. No-op if the Bunny is already that big.
   */
  leapTo(radius: number): void {
    if (radius <= this.radius) return;
    const previousRadius = this.radius;
    this.radius = this.prevRadius = radius;
    this.maxRadius = Math.max(this.maxRadius, radius);
    this.events.emit('bunnyLeapt', { radius, previousRadius });
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
    if (!this.alive || this.harmless || this.invulnerable > 0 || amount <= 0) return false;
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
    if (this.amassing) return;
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
