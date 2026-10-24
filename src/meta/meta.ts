/**
 * Meta-progression on top of SaveStore: Fluff wallet, Upgrade purchases, Run awards,
 * last Character and Difficulty, settings, and each Character's Keepsake Hoard (credit, Felting,
 * shedding, the remembered Loadout). `getMeta()` returns the browser singleton (localStorage).
 *
 * Every check that decides a write (can this be afforded? is the Keepsake still there?) runs inside
 * the store's update callback, on the freshly read save, so another tab's spend is never undone.
 */
import type { DifficultyId } from '../data/difficulty';
import { FELT_INPUT, feltCeiling, feltCost, getKeepsakeType, HOARD_STACK_MAX, MAX_RARITY, shedValue, type KeepsakeRef, type Loadout } from '../data/keepsakes';
import { getUpgrade } from '../data/upgrades';
import type { StatModifier } from '../entities/stats';
import type { RunEndReason } from '../game/runStats';
import { CREDITED_RUNS_MAX, type CreditStats } from '../shared/runCredit';
import { AREA_ORDER } from '../world/types';
import { CreditedRunsMirrorStore } from './creditedRuns';
import { fluffForRun } from './fluff';
import { addToHoard, countOf, emptyCharacterHoard, hasKeepsakes, repairLoadout, sameLoadout, type CharacterHoard } from './hoard';
import { browserStorage, browserStorageEvents, type KeyValueStorage, type SaveData, type SaveSettings, SaveStore, type StorageEventSource } from './save';
import { levelOf, upgradeCost, upgradeModifiers } from './upgrades';

declare module '../core/events' {
  interface GameEvents {
    /**
     * Fluff for a finished Run. `pending`: the Run is credited by the Account's answer, not yet
     * (`amount` is what it will be; `total` the wallet without it): it fires again with `pending:
     * false` once the credit lands, `amount: 0` if the server refused it (src/meta/accountRun.ts).
     */
    fluffAwarded: { runKey: string; amount: number; total: number; reason: RunEndReason; pending: boolean };
    upgradePurchased: { upgradeId: string; level: number; cost: number; fluffLeft: number };
  }
}

/** What crediting a Run reads: the `runEnded` payload, or a ledger row (docs/adr/0003). */
export interface RunCreditInput {
  runKey: string;
  reason: RunEndReason;
  stats: CreditStats;
}

export interface RunAward {
  fluff: number;
  total: number;
  newBestRadius: boolean;
  /** The player's Universes count after this Run (one more than before after a Universe victory). */
  universes: number;
}

/** How a credit reached this copy (docs/adr/0003, "Implementation notes"). */
export interface AwardOptions {
  /**
   * The Account's ledger has, or will get, a row for this key (default): it is remembered in the
   * synced `creditedRuns`. False for a Run credited with no Account: no row will ever exist for it,
   * so it is remembered on this device only and takes no slot from keys the sweep can bring back.
   */
  ledger?: boolean;
  /**
   * Count a Universe victory in `universes` (default). False for a ledger row that reached this
   * copy by the sweep or an upload's answer: another device's Run (its copy counted it, and the
   * cloud save's merge keeps the larger count), or this copy's own Run whose key a merge dropped
   * while the larger count survived. Only the device that ended the Run counts it.
   */
  countUniverse?: boolean;
}

/** The Area whose `victory` ends the story (the Universe; the only Area that emits one). */
const LAST_AREA = AREA_ORDER[AREA_ORDER.length - 1]!;

/** True for a Run that won the last Area: it counts one more Universe. */
export function endsUniverse(e: Pick<RunCreditInput, 'reason' | 'stats'>): boolean {
  return e.reason === 'victory' && e.stats.area === LAST_AREA;
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

/** Whether `d` allows Felting three of `ref` (see FeltCheck). */
function feltCheckOn(d: SaveData, characterId: string, ref: KeepsakeRef): FeltCheck {
  const h = d.characters[characterId];
  const ceiling = feltCeiling(h?.bossesBeaten ?? []);
  if (getKeepsakeType(ref.type)?.characterId !== characterId) return { ok: false, reason: 'unknown', ceiling };
  if (ref.rarity >= MAX_RARITY) return { ok: false, reason: 'max', ceiling };
  const result = { type: ref.type, rarity: ref.rarity + 1 };
  const cost = feltCost(result.rarity);
  if (countOf(h, ref) < FELT_INPUT) return { ok: false, reason: 'count', result, cost, ceiling };
  if (result.rarity > ceiling) return { ok: false, reason: 'ceiling', result, cost, ceiling };
  if (countOf(h, result) >= 99) return { ok: false, reason: 'full', result, cost, ceiling };
  if (d.fluff < cost) return { ok: false, reason: 'poor', result, cost, ceiling };
  return { ok: true, result, cost, ceiling };
}

export class MetaProgress {
  readonly store: SaveStore;
  /** The device's own record of `creditedRuns` (./creditedRuns.ts): repairs a save another build rewrote without it. */
  private readonly mirror: CreditedRunsMirrorStore;

  /** `events`: where other tabs' `storage` events arrive (see SaveStore). */
  constructor(storage: KeyValueStorage | null, events: StorageEventSource | null = null) {
    this.mirror = new CreditedRunsMirrorStore(storage);
    this.store = new SaveStore(storage, undefined, events, (d, read) => this.repairCreditedRuns(d, read));
  }

  /**
   * A save read from storage that lacks keys the mirror says this copy's set held (a tab from before
   * the ledger rewrote it) gets them back, oldest first. Its Fluff is left as it is: a key without
   * its Fluff can only under-credit, never double credit. A save with no `creditedRuns` field at all
   * on a device that has used the ledger (its mirror exists) may also have lost keys the mirror
   * never knew (another device's, adopted from the cloud): the set is marked unknown until a cloud
   * adopt restores one (`creditedRunsKnown`).
   */
  private repairCreditedRuns(d: SaveData, read: { lostCreditedRuns: boolean }): void {
    const mirror = this.mirror.read();
    if (read.lostCreditedRuns && !mirror.unknown && this.mirror.exists()) this.mirror.write({ ...mirror, unknown: true });
    const missing = mirror.keys.filter((k) => !d.creditedRuns.includes(k));
    if (missing.length) d.creditedRuns = [...missing, ...d.creditedRuns].slice(-CREDITED_RUNS_MAX);
  }

  /**
   * Whether `creditedRuns` is known to be the whole set this copy's Fluff accounts for. False after a
   * build from before the ledger rewrote the save (above): the sweep holds off, uploads omit the
   * field (the server keeps its stored set) and a claim's answer for a row that already existed is
   * not applied, since losing the field must never create Fluff (docs/adr/0003).
   */
  creditedRunsKnown(): boolean {
    return !this.mirror.read().unknown;
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
    let result: BuyResult = { ok: false, reason: 'poor' };
    this.store.updateIf((d) => {
      const owned = levelOf(d.upgrades, upgradeId);
      const cost = upgradeCost(u, owned);
      if (cost === null) result = { ok: false, reason: 'maxed' };
      else if (d.fluff >= cost) {
        d.fluff -= cost;
        d.upgrades[upgradeId] = owned + 1;
        result = { ok: true, level: owned + 1, cost };
      }
      return result.ok;
    });
    return result;
  }

  /** Stat modifiers from owned Upgrades, for game.nextRunConfig.modifiers. */
  runModifiers(): StatModifier[] {
    return upgradeModifiers(this.store.data.upgrades);
  }

  /** Universe victories so far (the title shows "Universe N" with N = universes + 1). */
  get universes(): number {
    return this.store.data.universes;
  }

  /**
   * Credits Fluff and records stats for a finished Run, and counts a Universe victory in
   * `universes`. Once per Run key: null when `creditedRuns` already lists it. The check and the
   * write share one update, so two tabs applying the same credit can't both add it, and the key
   * is remembered in the same write as the Fluff (docs/adr/0003).
   */
  awardRun(e: RunCreditInput, opts: AwardOptions = {}): RunAward | null {
    const fluff = fluffForRun(e.reason, e.stats);
    let newBestRadius = false;
    const added = this.store.updateIf((d) => {
      const mirror = this.mirror.read();
      if (d.creditedRuns.includes(e.runKey) || mirror.local.includes(e.runKey)) return false;
      newBestRadius = e.stats.maxRadius > d.stats.bestRadius;
      d.fluff += fluff;
      d.stats.runs++;
      if (e.reason === 'victory') d.stats.wins++;
      d.stats.bestRadius = Math.max(d.stats.bestRadius, e.stats.maxRadius);
      d.stats.bestTier = Math.max(d.stats.bestTier, e.stats.tierReached);
      d.stats.totalFluffEarned += fluff;
      if ((opts.countUniverse ?? true) && endsUniverse(e)) d.universes++;
      if (opts.ledger ?? true) {
        d.creditedRuns = [...d.creditedRuns, e.runKey].slice(-CREDITED_RUNS_MAX);
        this.mirror.write({ ...mirror, keys: [...d.creditedRuns] });
      } else this.mirror.write({ ...mirror, local: [...mirror.local, e.runKey] });
      return true;
    });
    if (!added) return null;
    return { fluff, total: this.store.data.fluff, newBestRadius, universes: this.store.data.universes };
  }

  /** Whether this copy holds the credit for the Run (in the synced set, or credited on this device without an Account). */
  credited(runKey: string): boolean {
    return this.store.data.creditedRuns.includes(runKey) || this.mirror.read().local.includes(runKey);
  }

  /**
   * Inside the cloud save's adopt (`d` is the save being written): the adopted copy's set replaces
   * this one's, in the same write as its Fluff. Unknown on a row from before the ledger: this
   * copy's set stays (missing means unknown), or starts empty when another Account's save is being
   * loaded (`replace`). The device's mirror follows, so the keys the adopted copy lacks are what
   * the sweep may bring back; an adopted set (or another Account's fresh start) is known again.
   */
  adoptCreditedRuns(d: SaveData, keys: readonly string[] | undefined, replace: boolean): void {
    if (keys) d.creditedRuns = [...keys];
    else if (replace) d.creditedRuns = [];
    const mirror = this.mirror.read();
    this.mirror.write({ ...mirror, keys: [...d.creditedRuns], unknown: keys || replace ? false : mirror.unknown });
  }

  /** The Universes count once `e` is credited: as it is now, plus one for a Universe victory still to land. */
  universesAfter(e: RunCreditInput): number {
    return this.store.data.universes + (endsUniverse(e) && !this.credited(e.runKey) ? 1 : 0);
  }

  /** Credits a saved Run the device lets go of (replaced in its slot, or abandoned) as a quit, with no Account (`QuitCreditor`, src/meta/suspendedRun.ts). */
  creditQuit(s: { runKey: string; stats: CreditStats }): void {
    this.awardRun({ runKey: s.runKey, reason: 'quit', stats: s.stats }, { ledger: false });
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
    if (getKeepsakeType(to.type)?.characterId !== characterId) return false;
    const same = from.type === to.type && from.rarity === to.rarity;
    let ok = false;
    this.store.updateIf((d) => {
      const h = d.characters[characterId];
      // A full destination cell would swallow the source Keepsake.
      ok = countOf(h, from) >= 1 && (same || countOf(h, to) < HOARD_STACK_MAX);
      if (!ok || same) return false;
      addToHoard(h!, from, -1);
      addToHoard(h!, to, 1);
      repairStoredLoadout(d, characterId);
      return true;
    });
    return ok;
  }

  feltCheck(characterId: string, ref: KeepsakeRef): FeltCheck {
    return feltCheckOn(this.store.data, characterId, ref);
  }

  /** Felts three of `ref` into one of the next rarity for its Fluff cost. */
  felt(characterId: string, ref: KeepsakeRef): FeltResult {
    let out!: FeltResult;
    this.store.updateIf((d) => {
      const check = feltCheckOn(d, characterId, ref);
      if (!check.ok) {
        out = check;
        return false;
      }
      out = { ...check, first: d.stats.feltings === 0 };
      const h = d.characters[characterId]!;
      addToHoard(h, ref, -FELT_INPUT);
      addToHoard(h, check.result, 1);
      d.fluff -= check.cost;
      d.stats.feltings++;
      repairStoredLoadout(d, characterId);
      return true;
    });
    return out;
  }

  /**
   * Discards one Keepsake for `shedValue(rarity)` Fluff. Like spending, this doesn't count toward
   * `totalFluffEarned`, so shedding can't win a cloud-save comparison.
   */
  shed(characterId: string, ref: KeepsakeRef): ShedResult {
    if (getKeepsakeType(ref.type)?.characterId !== characterId) return { ok: false, reason: 'unknown' };
    const fluff = shedValue(ref.rarity);
    const shed = this.store.updateIf((d) => {
      if (countOf(d.characters[characterId], ref) < 1) return false;
      addToHoard(d.characters[characterId]!, ref, -1);
      d.fluff += fluff;
      repairStoredLoadout(d, characterId);
      return true;
    });
    return shed ? { ok: true, fluff } : { ok: false, reason: 'none' };
  }

  /** The Loadout last tucked in for a Character, minus anything the Hoard no longer holds. */
  lastLoadout(characterId: string): KeepsakeRef[] {
    return repairLoadout(characterId, this.store.data.lastLoadout[characterId], this.store.data.characters[characterId]);
  }

  /** Remembers a Loadout (repaired against the Hoard) for the Character (synced by the cloud save). */
  setLastLoadout(characterId: string, loadout: Loadout): KeepsakeRef[] {
    let repaired: KeepsakeRef[] = [];
    this.store.updateIf((d) => {
      repaired = repairLoadout(characterId, loadout, d.characters[characterId]);
      if (sameLoadout(repaired, d.lastLoadout[characterId])) return false;
      if (repaired.length) d.lastLoadout[characterId] = repaired;
      else delete d.lastLoadout[characterId];
      return true;
    });
    return repaired;
  }

  setLastCharacter(id: string): void {
    this.store.updateIf((d) => {
      if (d.lastCharacterId === id) return false;
      d.lastCharacterId = id;
      return true;
    });
  }

  setLastDifficulty(id: DifficultyId): void {
    this.store.updateIf((d) => {
      if (d.lastDifficulty === id) return false;
      d.lastDifficulty = id;
      return true;
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

/** Browser singleton backed by localStorage (in-memory only if storage is unavailable), following other tabs. */
export function getMeta(): MetaProgress {
  singleton ??= new MetaProgress(browserStorage(), browserStorageEvents());
  return singleton;
}
