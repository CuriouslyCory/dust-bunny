/**
 * Keepsake drops (pure, no DOM): what a boss leaves in the fur of the Character that absorbed it,
 * and the per-Run record the results screen reads.
 *
 * Rules (DROP_RULES in src/data/keepsakes.ts):
 * - Every boss kill credits 1 Keepsake with a random type and a rarity rolled from the boss's drop
 *   table (`BOSS_DROP_TABLES`). The type is seeded from the Run seed and the boss, so a seed always
 *   offers the same types; the rarity roll also mixes in a salt drawn fresh for every Run, so
 *   replaying a `?seed=` that once rolled Mythic doesn't roll it again. Hardcore adds 1, with its
 *   own rarity roll.
 * - The Character's first kill of a boss offers 3 types (of one rarity) instead of the random one. The first offer
 *   is credited at once (so nothing is lost if the tab closes); the in-Run Keepsake reveal swaps it
 *   for another offered type, and leaving the reveal locks the choice (`lock`). A drop whose reveal
 *   never showed (the Run ended first) stays open on the results screen until the player leaves it.
 *   Leaving without choosing keeps the first offer.
 * - Credited on `bossDefeated`, so a Run that later ends in death or a quit keeps them.
 * - Unranked Runs (`?debug`, `?area=` starts) drop nothing and don't count the boss as beaten.
 * - Chips don't matter: how a boss is beaten never changes the reward.
 *
 *   const tracker = new KeepsakeTracker(meta, (e) => events.emit('keepsakesDropped', e));
 *   tracker.start({ seed, characterId, difficulty, ranked });   // runStarted
 *   tracker.bossDefeated(defId);                                 // bossDefeated
 *   tracker.lock(drop)                                           // the Keepsake reveal closes
 *   tracker.forResult(runEndedPayload)                           // results "Kept" section
 */
import type { GameEvents } from '../core/events';
import { Rng } from '../core/rng';
import { bestRarity, DROP_RULES, dropTableFor, keepsakeTypesFor, rollRarity, type KeepsakeRef, type KeepsakeTypeId } from '../data/keepsakes';
import type { DifficultyId } from '../shared/difficulty';
import type { MetaProgress } from './meta';

/** One Keepsake a boss left. */
export interface KeepsakeDrop {
  /** What is in the Hoard now (for a first kill: the current pick among `offer`). */
  ref: KeepsakeRef;
  bossId: string;
  /** First kill: the three types offered (ref.type is one of them). */
  offer?: KeepsakeTypeId[];
  /** True once the player picked from the offer. */
  chosen?: boolean;
  /** The offer is closed: the player left the in-Run reveal with this type. */
  locked?: boolean;
  /** The extra Hardcore Keepsake. */
  bonus?: boolean;
}

declare module '../core/events' {
  interface GameEvents {
    /** Keepsakes credited to the played Character for a boss (after the save is written). */
    /** `rarity`: the best among the drops (each drop has its own). */
    keepsakesDropped: { characterId: string; bossId: string; rarity: number; drops: KeepsakeDrop[]; firstKill: boolean };
  }
}

export interface DropRoll {
  seed: string;
  characterId: string;
  bossId: string;
  difficulty?: DifficultyId;
  /** The Character has not beaten this boss before. */
  firstKill: boolean;
  /** Mixed into the rarity rolls (the tracker draws one per Run); without it they follow the seed alone. */
  salt?: string;
}

/** The Keepsakes a boss kill drops (empty for a boss with no drop table or a Character without types). */
export function rollBossDrops(o: DropRoll): KeepsakeDrop[] {
  const table = dropTableFor(o.bossId);
  const types = keepsakeTypesFor(o.characterId).map((t) => t.id);
  if (!table || types.length === 0) return [];
  const rng = new Rng(o.seed).fork(`keepsake:${o.characterId}:${o.bossId}`);
  const rarityRng = new Rng(o.seed).fork(`keepsake-rarity:${o.characterId}:${o.bossId}:${o.salt ?? ''}`);
  const drops: KeepsakeDrop[] = [];
  for (let i = 0; i < DROP_RULES.perKill; i++) {
    const rarity = rollRarity(table, rarityRng.next());
    if (o.firstKill && i === 0) {
      const offer = rng.shuffle([...types]).slice(0, DROP_RULES.firstKillChoices);
      drops.push({ ref: { type: offer[0]!, rarity }, bossId: o.bossId, offer });
    } else {
      drops.push({ ref: { type: rng.pick(types), rarity }, bossId: o.bossId });
    }
  }
  if (o.difficulty === 'hardcore') {
    for (let i = 0; i < DROP_RULES.hardcoreBonus; i++) {
      const rarity = rollRarity(table, rarityRng.next());
      drops.push({ ref: { type: rng.pick(types), rarity }, bossId: o.bossId, bonus: true });
    }
  }
  return drops;
}

/** One Run's Keepsakes. */
export interface RunKeepsakes {
  seed: string;
  characterId: string;
  difficulty?: DifficultyId;
  /** False for debug / later-Area starts: nothing drops. */
  ranked: boolean;
  drops: KeepsakeDrop[];
  /** The runEnded payload once the Run is over. */
  result: GameEvents['runEnded'] | null;
  /** The player left the results screen: first-kill offers are closed. */
  settled: boolean;
  /** This Run's rarity salt (`DropRoll.salt`). */
  salt: string;
}

export type RunStartInfo = Pick<RunKeepsakes, 'seed' | 'characterId' | 'difficulty' | 'ranked'>;

const randomSalt = (): string => Math.random().toString(36).slice(2, 10);

export class KeepsakeTracker {
  current: RunKeepsakes | null = null;

  constructor(
    private readonly meta: MetaProgress,
    private readonly emit: (e: GameEvents['keepsakesDropped']) => void = () => undefined,
    /** Draws each Run's rarity salt (tests pass a fixed one). */
    private readonly newSalt: () => string = randomSalt,
  ) {}

  start(info: RunStartInfo): RunKeepsakes {
    // A Run left on the results screen without choosing keeps its first offers.
    if (this.current) this.current.settled = true;
    this.current = { ...info, drops: [], result: null, settled: false, salt: this.newSalt() };
    return this.current;
  }

  /** Credits the current Run's Character for a boss. Returns the drops (empty when unranked or ended). */
  bossDefeated(bossId: string): KeepsakeDrop[] {
    const run = this.current;
    if (!run || !run.ranked || run.result) return [];
    const firstKill = !this.meta.hasBeaten(run.characterId, bossId);
    const drops = rollBossDrops({ seed: run.seed, characterId: run.characterId, bossId, difficulty: run.difficulty, firstKill, salt: run.salt });
    if (!drops.length) return [];
    this.meta.creditKeepsakes(run.characterId, drops.map((d) => d.ref), bossId);
    run.drops.push(...drops);
    this.emit({ characterId: run.characterId, bossId, rarity: bestRarity(drops.map((d) => d.ref)), drops, firstKill });
    return drops;
  }

  /** The Run ended. */
  finish(e: GameEvents['runEnded']): RunKeepsakes | null {
    if (this.current && !this.current.result) this.current.result = e;
    return this.current;
  }

  /** This Run's Keepsakes for a results payload (null for a payload from a Run it never tracked). */
  forResult(e: GameEvents['runEnded']): RunKeepsakes | null {
    const run = this.current;
    if (!run) return null;
    if (run.result === e) return run;
    // The results screen can see runEnded before this tracker's own handler does.
    if (!run.result && run.seed === e.stats.seed && run.characterId === e.stats.characterId) {
      run.result = e;
      return run;
    }
    return null;
  }

  /**
   * Picks a type from a first-kill offer (swapping the credited Keepsake). Allowed until the player
   * leaves the Keepsake reveal (or, if it never showed, the results screen); false for a closed
   * offer, a type not offered, or when the Keepsake to swap is no longer in the Hoard (felted or
   * shed in the meantime).
   */
  choose(run: RunKeepsakes, dropIndex: number, type: KeepsakeTypeId): boolean {
    const drop = run.drops[dropIndex];
    if (!drop?.offer || drop.locked || run.settled || !drop.offer.includes(type)) return false;
    const to = { type, rarity: drop.ref.rarity };
    if (!this.meta.swapKeepsake(run.characterId, drop.ref, to)) return false;
    drop.ref = to;
    drop.chosen = true;
    return true;
  }

  /** Closes a drop's offer: the player left the Keepsake reveal, so its type (already in the Hoard) is final. */
  lock(drop: KeepsakeDrop): void {
    drop.locked = true;
  }

  /** Closes the Run's offers (the player left the results screen). */
  settle(run: RunKeepsakes): void {
    run.settled = true;
  }
}

let installed: KeepsakeTracker | null = null;

/** The browser's tracker (set by installRoguelike), or null in headless code. */
export function getKeepsakeTracker(): KeepsakeTracker | null {
  return installed;
}

export function setKeepsakeTracker(t: KeepsakeTracker | null): void {
  installed = t;
}

/** Narrator line for a boss's Keepsake drop (docs/design.md, deadpan). */
export function dropCaption(bossId: string, bossName: string): string {
  switch (bossId) {
    case 'robovac_9000':
      return 'Inside the Robo-Vac 9000 is a tangle of hair from several previous owners. It keeps some.';
    case 'street_sweeper':
      return "The Street Sweeper's bristles hold grit from every gutter in the neighbourhood. It keeps some.";
    case 'garbage_truck':
      return 'The hopper contains things nobody should keep. It keeps some.';
    case 'ice_sheet':
      return 'The Ice Sheet carries the silt of a continent it scraped clean. It keeps some.';
    case 'orbital_sweeper':
      return "The Orbital Sweeper's net is full of flecks of everything humanity ever launched. It keeps some.";
    case 'the_sun':
      return 'The Sun is made of the same stuff as everything else, only hotter. It keeps some.';
    case 'sagittarius_a':
      return 'Caught at the edge of Sagittarius A* is lint that has been falling in for thirteen billion years. It keeps some.';
    case 'the_expansion':
      return 'The Expansion was holding everything apart, including some very old dust. It keeps some.';
    default:
      return `${bossName} was full of things somebody dropped. It keeps some.`;
  }
}

/** Narrator line for the first Felting. */
export const FIRST_FELT_CAPTION = 'Three become one. This is also how felt is made.';
