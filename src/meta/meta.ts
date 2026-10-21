/**
 * Meta-progression on top of SaveStore: Fluff wallet, Upgrade purchases, Run awards,
 * last Character and Difficulty, and settings. `getMeta()` returns the browser singleton (localStorage).
 */
import type { GameEvents } from '../core/events';
import type { DifficultyId } from '../data/difficulty';
import { getUpgrade } from '../data/upgrades';
import type { StatModifier } from '../entities/stats';
import { fluffForRun } from './fluff';
import { browserStorage, type KeyValueStorage, type SaveSettings, SaveStore } from './save';
import { levelOf, upgradeCost, upgradeModifiers } from './upgrades';

declare module '../core/events' {
  interface GameEvents {
    /** Fluff credited for a finished Run (after the save is written). */
    fluffAwarded: { amount: number; total: number; reason: GameEvents['runEnded']['reason'] };
    upgradePurchased: { upgradeId: string; level: number; cost: number; fluffLeft: number };
  }
}

export interface RunAward {
  fluff: number;
  total: number;
  newBestRadius: boolean;
}

export type BuyResult = { ok: true; level: number; cost: number } | { ok: false; reason: 'maxed' | 'unknown' | 'poor' };

export class MetaProgress {
  readonly store: SaveStore;
  private awarded = new WeakMap<object, RunAward>();

  constructor(storage: KeyValueStorage | null) {
    this.store = new SaveStore(storage);
  }

  get data() {
    return this.store.data;
  }

  get fluff(): number {
    return this.store.data.fluff;
  }

  level(upgradeId: string): number {
    return levelOf(this.store.data.upgrades, upgradeId);
  }

  /** Cost of the next level, or null when maxed/unknown. */
  nextCost(upgradeId: string): number | null {
    const u = getUpgrade(upgradeId);
    return u ? upgradeCost(u, this.level(upgradeId)) : null;
  }

  buy(upgradeId: string): BuyResult {
    const u = getUpgrade(upgradeId);
    if (!u) return { ok: false, reason: 'unknown' };
    const cost = upgradeCost(u, this.level(upgradeId));
    if (cost === null) return { ok: false, reason: 'maxed' };
    if (this.fluff < cost) return { ok: false, reason: 'poor' };
    const level = this.level(upgradeId) + 1;
    this.store.update((d) => {
      d.fluff -= cost;
      d.upgrades[upgradeId] = level;
    });
    return { ok: true, level, cost };
  }

  /** Stat modifiers from owned Upgrades, for game.nextRunConfig.modifiers. */
  runModifiers(): StatModifier[] {
    return upgradeModifiers(this.store.data.upgrades);
  }

  /**
   * Credits Fluff and records stats for a finished Run. Idempotent per runEnded payload, so
   * both the results screen and the event listener may call it.
   */
  awardRun(e: GameEvents['runEnded']): RunAward {
    const prev = this.awarded.get(e);
    if (prev) return prev;
    const fluff = fluffForRun(e.reason, e.stats);
    const newBestRadius = e.stats.maxRadius > this.store.data.stats.bestRadius;
    this.store.update((d) => {
      d.fluff += fluff;
      d.stats.runs++;
      if (e.reason === 'victory') d.stats.wins++;
      d.stats.bestRadius = Math.max(d.stats.bestRadius, e.stats.maxRadius);
      d.stats.bestTier = Math.max(d.stats.bestTier, e.stats.tierReached);
      d.stats.totalFluffEarned += fluff;
    });
    const award = { fluff, total: this.store.data.fluff, newBestRadius };
    this.awarded.set(e, award);
    return award;
  }

  setLastCharacter(id: string): void {
    if (this.store.data.lastCharacterId === id) return;
    this.store.update((d) => {
      d.lastCharacterId = id;
    });
  }

  setLastDifficulty(id: DifficultyId): void {
    if (this.store.data.lastDifficulty === id) return;
    this.store.update((d) => {
      d.lastDifficulty = id;
    });
  }

  get settings(): Readonly<SaveSettings> {
    return this.store.data.settings;
  }

  updateSettings(patch: SaveSettings): void {
    this.store.update((d) => {
      d.settings = { ...d.settings, ...patch };
    });
  }
}

let singleton: MetaProgress | null = null;

/** Browser singleton backed by localStorage (in-memory only if storage is unavailable). */
export function getMeta(): MetaProgress {
  singleton ??= new MetaProgress(browserStorage());
  return singleton;
}
