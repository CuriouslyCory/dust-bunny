/**
 * Meta-progression on top of SaveStore: Fluff wallet, Upgrade purchases, Run awards,
 * last Character and Difficulty, settings, and each Character's Keepsake Hoard (credit, Felting,
 * shedding, the remembered Loadout). `getMeta()` returns the browser singleton (localStorage).
 */
import type { GameEvents } from '../core/events';
import type { DifficultyId } from '../data/difficulty';
import { FELT_INPUT, feltCeiling, feltCost, getKeepsakeType, HOARD_STACK_MAX, MAX_RARITY, shedValue, type KeepsakeRef, type Loadout } from '../data/keepsakes';
import { getUpgrade } from '../data/upgrades';
import type { StatModifier } from '../entities/stats';
import { fluffForRun } from './fluff';
import { addToHoard, countOf, emptyCharacterHoard, hasKeepsakes, repairLoadout, sameLoadout, type CharacterHoard } from './hoard';
import { browserStorage, type KeyValueStorage, type SaveData, type SaveSettings, SaveStore } from './save';
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

/**
 * Whether three of a Keepsake can be felted into one of the next rarity. `count`: fewer than 3;
 * `max`: already mythic; `ceiling`: the result would pass the Character's ceiling (one rarity above
 * its best boss's peak); `poor`: not enough Fluff; `full`: the result's cell already holds 99.
 */
export type FeltCheck =
  | { ok: true; result: KeepsakeRef; cost: number; ceiling: number }
  | { ok: false; reason: 'unknown' | 'count' | 'max' | 'ceiling' | 'poor' | 'full'; result?: KeepsakeRef; cost?: number; ceiling: number };

export type FeltResult = (FeltCheck & { ok: false }) | { ok: true; result: KeepsakeRef; cost: number; ceiling: number; first: boolean };

export type ShedResult = { ok: true; fluff: number } | { ok: false; reason: 'unknown' | 'none' };

/** Drops Loadout slots the Hoard can no longer fill (after Felting, shedding or a swap). */
function repairStoredLoadout(d: SaveData, characterId: string): void {
  const l = d.lastLoadout[characterId];
  if (!l) return;
  const repaired = repairLoadout(characterId, l, d.characters[characterId]);
  if (repaired.length) d.lastLoadout[characterId] = repaired;
  else delete d.lastLoadout[characterId];
}

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

  // --- Keepsakes ---

  /** A Character's Hoard and bosses beaten (an empty one if it has none yet). Read-only view. */
  hoardOf(characterId: string): Readonly<CharacterHoard> {
    return this.store.data.characters[characterId] ?? emptyCharacterHoard();
  }

  keepsakeCount(characterId: string, ref: KeepsakeRef): number {
    return countOf(this.store.data.characters[characterId], ref);
  }

  /** True once this Character has absorbed the boss. */
  hasBeaten(characterId: string, bossId: string): boolean {
    return this.hoardOf(characterId).bossesBeaten.includes(bossId);
  }

  /** Highest rarity this Character can felt (0 before its first boss). */
  feltCeiling(characterId: string): number {
    return feltCeiling(this.hoardOf(characterId).bossesBeaten);
  }

  /**
   * Credits boss-kill Keepsakes to a Character (each cell capped at 99) and, with `bossId`, records
   * the boss as beaten. Counts toward `stats.keepsakesEarned`. Returns how many were added.
   */
  creditKeepsakes(characterId: string, refs: readonly KeepsakeRef[], bossId?: string): number {
    if (!hasKeepsakes(characterId)) return 0;
    const own = refs.filter((r) => getKeepsakeType(r.type)?.characterId === characterId && r.rarity >= 1 && r.rarity <= MAX_RARITY);
    let added = 0;
    this.store.update((d) => {
      const h = (d.characters[characterId] ??= emptyCharacterHoard());
      for (const r of own) added += addToHoard(h, r, 1);
      if (bossId && !h.bossesBeaten.includes(bossId)) h.bossesBeaten.push(bossId);
      d.stats.keepsakesEarned += added;
    });
    return added;
  }

  /** Replaces one `from` with one `to` (the first-kill choice). False if `from` isn't in the Hoard or `to`'s cell is full. */
  swapKeepsake(characterId: string, from: KeepsakeRef, to: KeepsakeRef): boolean {
    if (getKeepsakeType(to.type)?.characterId !== characterId || this.keepsakeCount(characterId, from) < 1) return false;
    if (from.type === to.type && from.rarity === to.rarity) return true;
    // A full destination cell would swallow the source Keepsake.
    if (this.keepsakeCount(characterId, to) >= HOARD_STACK_MAX) return false;
    this.store.update((d) => {
      const h = d.characters[characterId]!;
      addToHoard(h, from, -1);
      addToHoard(h, to, 1);
      repairStoredLoadout(d, characterId);
    });
    return true;
  }

  feltCheck(characterId: string, ref: KeepsakeRef): FeltCheck {
    const ceiling = this.feltCeiling(characterId);
    if (getKeepsakeType(ref.type)?.characterId !== characterId) return { ok: false, reason: 'unknown', ceiling };
    if (ref.rarity >= MAX_RARITY) return { ok: false, reason: 'max', ceiling };
    const result = { type: ref.type, rarity: ref.rarity + 1 };
    const cost = feltCost(result.rarity);
    if (this.keepsakeCount(characterId, ref) < FELT_INPUT) return { ok: false, reason: 'count', result, cost, ceiling };
    if (result.rarity > ceiling) return { ok: false, reason: 'ceiling', result, cost, ceiling };
    if (this.keepsakeCount(characterId, result) >= 99) return { ok: false, reason: 'full', result, cost, ceiling };
    if (this.fluff < cost) return { ok: false, reason: 'poor', result, cost, ceiling };
    return { ok: true, result, cost, ceiling };
  }

  /** Felts three of `ref` into one of the next rarity for its Fluff cost. */
  felt(characterId: string, ref: KeepsakeRef): FeltResult {
    const check = this.feltCheck(characterId, ref);
    if (!check.ok) return check;
    const first = this.store.data.stats.feltings === 0;
    this.store.update((d) => {
      const h = d.characters[characterId]!;
      addToHoard(h, ref, -FELT_INPUT);
      addToHoard(h, check.result, 1);
      d.fluff -= check.cost;
      d.stats.feltings++;
      repairStoredLoadout(d, characterId);
    });
    return { ...check, first };
  }

  /**
   * Discards one Keepsake for `shedValue(rarity)` Fluff. Like spending, this doesn't count toward
   * `totalFluffEarned`, so shedding can't win a cloud-save comparison.
   */
  shed(characterId: string, ref: KeepsakeRef): ShedResult {
    if (getKeepsakeType(ref.type)?.characterId !== characterId) return { ok: false, reason: 'unknown' };
    if (this.keepsakeCount(characterId, ref) < 1) return { ok: false, reason: 'none' };
    const fluff = shedValue(ref.rarity);
    this.store.update((d) => {
      addToHoard(d.characters[characterId]!, ref, -1);
      d.fluff += fluff;
      repairStoredLoadout(d, characterId);
    });
    return { ok: true, fluff };
  }

  /** The Loadout last tucked in for a Character, minus anything the Hoard no longer holds. */
  lastLoadout(characterId: string): KeepsakeRef[] {
    return repairLoadout(characterId, this.store.data.lastLoadout[characterId], this.store.data.characters[characterId]);
  }

  /** Remembers a Loadout (repaired against the Hoard) for the Character on this device. */
  setLastLoadout(characterId: string, loadout: Loadout): KeepsakeRef[] {
    const repaired = repairLoadout(characterId, loadout, this.store.data.characters[characterId]);
    if (sameLoadout(repaired, this.store.data.lastLoadout[characterId])) return repaired;
    this.store.update((d) => {
      if (repaired.length) d.lastLoadout[characterId] = repaired;
      else delete d.lastLoadout[characterId];
    });
    return repaired;
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
