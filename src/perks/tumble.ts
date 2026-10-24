/**
 * Tumble's Character Perks (drafted only by Tumble). Numbers: CHARACTER_PERK_EFFECTS in
 * src/data/perks.ts; ranges and sizes in Bunny radii (r).
 *
 *   Snowballing    a stat Perk: acceleration + snowballingAccel per stack (top speed is `speed`,
 *                  untouched; Tumble has no acceleration cap).
 *   Matted Coat    a one-hit fur shield, separate from Bubble Wrap's `bunny.shield` and asked
 *                  before it (a CombatSystem guard). Charged when first taken. A blocked hit gets
 *                  the usual i-frames and no knockback (hitBunny only knocks back when damage
 *                  lands). It recharges after mattedCoatRecharge s without taking damage: any hit
 *                  that lands (bunnyDamaged) restarts the count.
 *   Shedding       each heart emptied by a hit (bunnyDamaged; fractional hits count when they
 *                  empty a heart) drops sheddingPieces hair clumps around Tumble, each worth
 *                  sheddingVolume × Tumble's volume when re-absorbed. It's free volume: Tumble
 *                  loses nothing. Pieces are sized like shed mass (planShed: growth factor, the
 *                  Area's growth and the type's mass) and stay absorbable (more, smaller pieces if
 *                  needed). Hair where the Area has it, else the shed type closest in size. Not on
 *                  the killing blow.
 *   Heavy Pull     while `bunny.amassing`, magnetRadius + heavyPullMagnet r at priority 150, below
 *                  the cap stage, so Tumble's magnet cap still holds.
 *   Heavy Landing  a Dash ending (dashing last tick, not now; not across an Area change) stuns
 *                  every tangible non-boss Hazard within heavyLandingRadius r of Tumble's surface
 *                  for heavyLandingStun s (the Abilities' stun path). Bosses are unaffected.
 *
 * Every effect reads run.perkStacks(id) live in the `tumblePerks` System (order 120: after
 * movement ends a Dash, before Hazards act), so starting Perks and a Resume's silent re-apply
 * work without perkApplied. The coat's charge isn't saved: a resumed Run starts it charged.
 */
import type { Rng } from '../core/rng';
import { AREAS } from '../data/areas';
import { CHARACTER_PERK_EFFECTS as FX, CHARACTER_PERKS, perStack } from '../data/perks';
import { TUNING } from '../data/tuning';
import type { Run } from '../game/run';
import type { System } from '../game/system';
import { hazardRadius, isBoss } from '../abilities/system';
import { pickShedType, planShed, scatterDebris } from '../hazards/shed';
import { growthFactorAt } from '../systems/absorb';
import { installCombatHooks } from './combat';
import type { PerkDef } from './index';
import { HeavyLandingView } from './tumbleView';

declare module '../core/events' {
  interface GameEvents {
    /** Matted Coat absorbed a hit. */
    furCoatBlocked: { source: string };
    /** Matted Coat is charged again. */
    furCoatRecharged: Record<string, never>;
    /** Shedding dropped hair clumps after a heart was lost. */
    hairShed: { pieces: number; volume: number };
    /** Heavy Landing's shockwave; `radius` is its reach from Tumble's centre (world units). */
    heavyLanding: { x: number; z: number; radius: number; hit: number };
  }
}

export const TUMBLE_PERKS_SYSTEM_ID = 'tumblePerks';
const HEAVY_PULL_SOURCE = 'perk:heavy_pull:amass';
/** Below the cap stage (CAP_PRIORITY 250), so Tumble's magnet cap applies. */
const HEAVY_PULL_PRIORITY = 150;
/** Debris type Shedding drops where the Area has it. */
const HAIR_DEBRIS = 'hair_strand';
/** Clumps land in this ring around Tumble (r), clear of its fur. */
const SHED_INNER = 1.6;
const SHED_OUTER = 3.5;

export const TUMBLE_PERK_DEFS: PerkDef[] = [
  {
    ...CHARACTER_PERKS.snowballing,
    capStats: ['acceleration'],
    apply: (run) => run.bunny.stats.add({ stat: 'acceleration', op: 'add', value: FX.snowballingAccel, source: 'perk:snowballing' }),
  },
  // The rest act from TumblePerks, reading run.perkStacks(id).
  { ...CHARACTER_PERKS.matted_coat, apply: () => {} },
  { ...CHARACTER_PERKS.shedding, apply: () => {} },
  { ...CHARACTER_PERKS.heavy_pull, apply: () => {} },
  { ...CHARACTER_PERKS.heavy_landing, apply: () => {} },
];

/** What the HUD shows for Matted Coat. */
export interface FurCoatState {
  charged: boolean;
  /** Seconds of no damage still needed to recharge (0 when charged). */
  rechargeLeft: number;
}

export class TumblePerks implements System {
  readonly id = TUMBLE_PERKS_SYSTEM_ID;
  readonly order = 120;
  /** Matted Coat: charged right now. */
  coatCharged = false;
  /** Matted Coat: seconds without damage since the coat was last used or Tumble was last hurt. */
  coatTimer = 0;
  private coatOwned = false;
  /** Heavy Pull's magnet bonus applied right now (0 = none). */
  private pull = 0;
  private wasDashing = false;
  private area: string;
  private readonly rng: Rng;
  private readonly view = new HeavyLandingView();

  constructor(private readonly run: Run) {
    this.rng = run.rng.fork('tumble-perks');
    this.area = run.area;
    run.entityRoot.add(this.view.root);
    installCombatHooks(run).guards.push(this.guard);
    run.disposables.add(
      run.events.on('bunnyDamaged', (e) => {
        this.coatTimer = 0;
        this.shed(e.health, e.amount);
      }),
    );
  }

  /** Matted Coat's state, or null without the Perk. */
  get coat(): FurCoatState | null {
    const stacks = this.run.perkStacks('matted_coat');
    if (stacks <= 0) return null;
    this.syncCoat(stacks);
    const need = perStack(FX.mattedCoatRecharge, stacks)!;
    return { charged: this.coatCharged, rechargeLeft: this.coatCharged ? 0 : Math.max(0, need - this.coatTimer) };
  }

  /** The coat comes charged the first time the Perk is seen. */
  private syncCoat(stacks: number): void {
    if (stacks > 0 && !this.coatOwned) {
      this.coatOwned = true;
      this.coatCharged = true;
      this.coatTimer = 0;
    }
  }

  /** CombatSystem guard: Matted Coat blocks the hit if charged. */
  private readonly guard = (_amount: number, source: string): boolean => {
    const run = this.run;
    this.syncCoat(run.perkStacks('matted_coat'));
    if (!this.coatCharged) return false;
    this.coatCharged = false;
    this.coatTimer = 0;
    run.bunny.invulnerable = TUNING.invulnerability;
    run.events.emit('furCoatBlocked', { source });
    return true;
  };

  update(dt: number, run: Run): void {
    const b = run.bunny;

    // Matted Coat recharge.
    const coat = run.perkStacks('matted_coat');
    this.syncCoat(coat);
    if (coat > 0 && !this.coatCharged) {
      this.coatTimer += dt;
      if (this.coatTimer >= perStack(FX.mattedCoatRecharge, coat)!) {
        this.coatCharged = true;
        run.events.emit('furCoatRecharged', {});
      }
    }

    // Heavy Pull.
    const want = b.amassing ? (perStack(FX.heavyPullMagnet, run.perkStacks('heavy_pull')) ?? 0) : 0;
    if (want !== this.pull) {
      b.stats.removeSource(HEAVY_PULL_SOURCE);
      if (want > 0) b.stats.add({ stat: 'magnetRadius', op: 'add', value: want, source: HEAVY_PULL_SOURCE, priority: HEAVY_PULL_PRIORITY });
      this.pull = want;
    }

    // Heavy Landing.
    const areaChanged = run.area !== this.area;
    this.area = run.area;
    const dashing = b.dashing;
    if (this.wasDashing && !dashing && !areaChanged && b.alive) this.land(run);
    this.wasDashing = dashing;
    this.view.update(dt);
  }

  /** Heavy Landing's shockwave (see file header). Returns Hazards stunned. */
  land(run: Run): number {
    const stacks = run.perkStacks('heavy_landing');
    if (stacks <= 0) return 0;
    const b = run.bunny;
    const reach = perStack(FX.heavyLandingRadius, stacks)! * b.radius;
    const seconds = perStack(FX.heavyLandingStun, stacks)!;
    let hit = 0;
    for (const h of run.hazards.hazards) {
      if (h.dead || h.intangible || isBoss(h)) continue;
      if (Math.hypot(h.x - b.x, h.z - b.z) - b.radius - hazardRadius(h) > reach) continue;
      run.hazards.status.stun(h, seconds, 'perk');
      hit++;
    }
    this.view.burst(b.x, b.z, b.radius + reach);
    run.events.emit('heavyLanding', { x: b.x, z: b.z, radius: b.radius + reach, hit });
    return hit;
  }

  /** Shedding: hair clumps for each heart a hit emptied (see file header). Returns pieces placed. */
  private shed(health: number, amount: number): number {
    const run = this.run;
    const stacks = run.perkStacks('shedding');
    if (stacks <= 0 || health <= 0 || run.ended) return 0;
    const hearts = Math.ceil(health + amount - 1e-9) - Math.ceil(health - 1e-9);
    if (hearts <= 0) return 0;
    const b = run.bunny;
    const pieces = perStack(FX.sheddingPieces, stacks)! * hearts;
    const fraction = FX.sheddingVolume * pieces;
    const ratio = b.stats.get('absorbRatio');
    const hair = run.debris.types.find((t) => t.id === HAIR_DEBRIS && (t.area ?? 'house') === run.area);
    const type = hair ?? pickShedType(run.debris.types, planShed(b.radius, fraction, ratio, TUNING.growthFactor, 1, pieces).pieceSize, run.tier, run.area);
    // Sized like shed mass, but nothing is taken off Tumble (planShed's smaller radius only makes the absorb check stricter).
    const plan = planShed(b.radius, fraction, ratio, growthFactorAt(b.realRadius) * AREAS[run.area].growth, type?.mass ?? 1, pieces);
    const placed = scatterDebris(run, this.rng, b.x, b.z, plan.pieces, plan.pieceSize, b.radius * SHED_INNER, b.radius * SHED_OUTER, type);
    if (placed > 0) run.events.emit('hairShed', { pieces: placed, volume: plan.volume });
    return placed;
  }

  dispose(): void {
    this.run.bunny.stats.removeSource(HEAVY_PULL_SOURCE);
    this.pull = 0;
    this.view.dispose();
  }
}

/** The Run's Tumble Perk System, if installed (Tumble Runs only). */
export function getTumblePerks(run: Run | null | undefined): TumblePerks | undefined {
  return run?.getSystem<TumblePerks>(TUMBLE_PERKS_SYSTEM_ID);
}

/** Installs Tumble's Perk effects on a Tumble Run (once). */
export function installTumblePerks(run: Run): TumblePerks {
  const existing = getTumblePerks(run);
  if (existing) return existing;
  const sys = new TumblePerks(run);
  run.addSystem(sys);
  return sys;
}
