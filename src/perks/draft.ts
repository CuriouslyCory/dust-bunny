/**
 * Perk draft: the weighted sampler plus the per-Run draft workflow (`run.perkDraft`). The modal
 * that renders it is src/ui/screens/perkDraft.ts; the balance bot (scripts/sim.ts) picks headless.
 *
 * One pending draft per Tier crossed (growthSystem calls queue() before emitting tierUp). An offer
 * is `perkChoices` (3, 4 with Wide Choice) distinct Perks, weighted, never a unique or maxed Perk
 * the Run already has, and never a Perk whose stats are all at the Character's cap (`perkCapped`;
 * Thick Fur stays because it also heals). Choosing applies the Perk, consumes one pending draft and prepares the next
 * offer; an exhausted pool drops the remaining drafts. Rerolls per Run come from the perkRerolls stat.
 */
import type { Rng } from '../core/rng';
import type { Run } from '../game/run';
import { availablePerks, type PerkDef } from './index';

/** True if every stat the Perk raises is already at the Character's cap (taking it would do nothing). */
export function perkCapped(run: Run, perk: PerkDef): boolean {
  const keys = perk.capStats;
  return !!keys && keys.length > 0 && keys.every((k) => run.bunny.stats.atCap(k));
}

/** Perks the draft may offer: available (not unique-owned or maxed) and not capped out. */
export function draftablePerks(run: Run): PerkDef[] {
  return availablePerks(run).filter((p) => !perkCapped(run, p));
}

/** Weighted sample of up to `count` distinct Perks from `pool`. */
export function draftPerks(pool: readonly PerkDef[], count: number, rng: Rng, exclude: readonly string[] = []): PerkDef[] {
  let left = pool.filter((p) => !exclude.includes(p.id));
  // If excluding (reroll) leaves too few, fall back to the full pool.
  if (left.length < Math.min(count, pool.length)) left = [...pool];
  const out: PerkDef[] = [];
  while (out.length < count && left.length > 0) {
    const pick = rng.weighted(left, (p) => p.weight ?? 1) ?? left[0]!;
    out.push(pick);
    left = left.filter((p) => p !== pick);
  }
  return out;
}

/** The Perks currently on offer. `serial` changes with every new offer (pick, reroll). */
export interface PerkOffer {
  readonly serial: number;
  readonly perks: readonly PerkDef[];
}

const NO_OFFER: PerkOffer = { serial: 0, perks: [] };

/** A Run's Perk draft workflow: pending drafts, the current offer and reroll progression. */
export class PerkDraft {
  /** Drafts still to pick (the current offer included). */
  pending = 0;
  rerollsUsed = 0;
  private current: PerkOffer = NO_OFFER;
  private serial = 0;
  private readonly rng: Rng;

  constructor(private readonly run: Run) {
    this.rng = run.rng.fork('perk-draft');
  }

  /** The offer to pick from; no Perks when nothing is pending. */
  get offer(): PerkOffer {
    return this.current;
  }

  /** A draft is waiting for a pick. */
  get active(): boolean {
    return !this.run.ended && this.pending > 0 && this.current.perks.length > 0;
  }

  /** Rerolls this Run gets in total (the Reroll Upgrade). */
  get rerolls(): number {
    return Math.max(0, Math.round(this.run.bunny.stats.get('perkRerolls')));
  }

  get rerollsLeft(): number {
    return Math.max(0, this.rerolls - this.rerollsUsed);
  }

  /** Adds `count` pending drafts (one per Tier crossed) and prepares an offer if none is up. */
  queue(count = 1): void {
    if (this.run.ended || count <= 0) return;
    this.pending += count;
    if (this.current.perks.length === 0) this.prepare();
  }

  /**
   * Picks `perkId` from the current offer: applies it once, consumes one pending draft and
   * prepares the next offer (or completes). Returns false, changing nothing, for a Perk not on
   * the offer, a stale `serial`, an ended Run or when nothing is pending.
   */
  choose(perkId: string, serial = this.current.serial): boolean {
    if (!this.active || serial !== this.current.serial) return false;
    if (!this.current.perks.some((p) => p.id === perkId)) return false;
    this.pending--;
    this.current = NO_OFFER;
    this.run.applyPerk(perkId);
    if (this.pending > 0) this.prepare();
    return true;
  }

  /** Spends a reroll on a new offer that avoids the current one. False when none are left. */
  reroll(): boolean {
    if (!this.active || this.rerollsLeft <= 0) return false;
    this.rerollsUsed++;
    this.prepare(this.current.perks.map((p) => p.id));
    return true;
  }

  private prepare(exclude: readonly string[] = []): void {
    const count = Math.round(this.run.bunny.stats.get('perkChoices'));
    const perks = draftPerks(draftablePerks(this.run), count, this.rng, exclude);
    if (perks.length === 0) {
      // Everything is owned or maxed: no later draft could offer anything either.
      this.pending = 0;
      this.current = NO_OFFER;
      return;
    }
    this.current = { serial: ++this.serial, perks };
  }
}
