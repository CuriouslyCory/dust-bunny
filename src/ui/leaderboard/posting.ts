/**
 * Which leaderboard entries a Run has, and posting them. A Run has one entry per Area it cleared
 * (Area boards) plus, once it ends, one for the Run board.
 *
 * Signed-in players post automatically: each Area as soon as it is cleared (with a HUD toast),
 * the Run board when the Run ends, and anything left unsent when they sign in later (e.g. from
 * the results screen). Anonymous players' entries wait as `unsent` until they submit them from
 * the results screen. Runs played with debug tools (`?debug`) or started in a later Area (`?area=`)
 * are not ranked: their entries are listed as `invalid` and never posted.
 *
 *   const posting = installLeaderboardPosting(game);
 *   const posts = posting.forResult(runEndedPayload);   // the results screen's view of the Run
 *   posts.subscribe(() => render(posts.list()));
 *   await posts.post(name);                             // anonymous "Submit scores"
 */
import type { GameEvents } from '../../core/events';
import type { Loadout } from '../../data/keepsakes';
import type { Game } from '../../game/game';
import type { RunConfig } from '../../game/run';
import type { AreaStats } from '../../game/runStats';
import { getMeta } from '../../meta/meta';
import { account as defaultAccount, type AccountClient } from '../../net/account';
import {
  areaSubmission,
  leaderboard as defaultClient,
  LeaderboardError,
  submissionFromRun,
  type LeaderboardClient,
  type SubmitOptions,
  type SubmitResult,
} from '../../net/leaderboard';
import type { DifficultyId } from '../../shared/difficulty';
import { cleanName, type AnyLeaderboardEntry, type BoardId } from '../../shared/leaderboard';
import { SCORE_AREAS } from '../../shared/score';

export type PostState = 'unsent' | 'posting' | 'posted' | 'failed' | 'invalid';

export interface BoardPost {
  board: BoardId;
  state: PostState;
  result?: SubmitResult<AnyLeaderboardEntry>;
  /** Why the last attempt failed (failed / invalid). */
  error?: string;
}

const BOARD_NAMES: Record<BoardId, string> = { run: 'Full run', house: 'House', neighborhood: 'Neighborhood', city: 'City', region: 'Region', continent: 'Continent', globe: 'Globe', solar_system: 'Solar System', galaxy: 'Galaxy', universe: 'Universe' };

/** Short display name of a board (tab labels, toasts). */
export function boardName(board: BoardId): string {
  return BOARD_NAMES[board];
}

/** Fallback when neither a saved name nor the account's name is usable. */
const DEFAULT_NAME = 'Dust Bunny';

function newRunId(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** One Run's entries. */
export class RunPosts {
  readonly runId: string;
  /** The runEnded payload, once the Run is over. */
  result: GameEvents['runEnded'] | null = null;
  private posts = new Map<BoardId, BoardPost & { build: (name: string) => unknown }>();
  private listeners = new Set<() => void>();

  constructor(
    private readonly client: LeaderboardClient,
    readonly characterId: string,
    readonly difficulty: DifficultyId | undefined,
    /** False for debug / later-Area starts (or once cheats are on, `unrank`): entries are shown but never posted. */
    public ranked = true,
    /** Keepsakes tucked in for the Run (`run.loadout`, which can grow mid-Run). An Area entry sends the Loadout it was left with (`AreaStats.loadout`), else a copy of this as it is when the entry is added. */
    readonly loadout: Loadout = [],
    /** The player's Universes count after the Run (sent with the Run board entry; omitted when absent). */
    private readonly universesFor?: (e: GameEvents['runEnded']) => number,
    /** The Run's id (a resumed Run keeps the one it was saved with, so its reposts are idempotent). */
    runId: string = newRunId(),
  ) {
    this.runId = runId;
  }

  private unrankedWhy = 'runs played with debug tools or started past the house are not ranked.';

  /** Initial state of a new entry. */
  private fresh(): Pick<BoardPost, 'state' | 'error'> {
    return this.ranked ? { state: 'unsent' } : { state: 'invalid', error: this.unrankedWhy };
  }

  /** Cheats came on mid-Run: entries still waiting become `invalid` (posted ones stay), and so does every later one. */
  unrank(why: string): void {
    if (!this.ranked) return;
    this.ranked = false;
    this.unrankedWhy = why;
    for (const p of this.posts.values()) {
      if (p.state !== 'unsent' && p.state !== 'failed') continue;
      p.state = 'invalid';
      p.error = why;
    }
    this.changed();
  }

  /** In board order: Run board first, then Areas in Run order. */
  list(): BoardPost[] {
    const order: BoardId[] = ['run', ...SCORE_AREAS];
    return order.flatMap((b) => {
      const p = this.posts.get(b);
      return p ? [{ board: p.board, state: p.state, result: p.result, error: p.error }] : [];
    });
  }

  get(board: BoardId): BoardPost | undefined {
    return this.list().find((p) => p.board === board);
  }

  /** True while some entry still needs a submit (unsent or failed). */
  get pending(): boolean {
    return [...this.posts.values()].some((p) => p.state === 'unsent' || p.state === 'failed');
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed(): void {
    for (const fn of this.listeners) fn();
  }

  /** Adds a cleared Area's entry (ignored if the Area already has one or wasn't cleared). */
  addArea(stats: AreaStats): void {
    if (!stats.cleared || this.posts.has(stats.area)) return;
    const loadout = (stats.loadout ?? this.loadout).map((k) => ({ ...k }));
    this.posts.set(stats.area, {
      board: stats.area,
      ...this.fresh(),
      build: (name) => areaSubmission(stats, this.characterId, this.difficulty, name, this.runId, loadout),
    });
    this.changed();
  }

  /** The Run ended: adds the Run board entry and an entry for the last Area if it was cleared. */
  finish(e: GameEvents['runEnded']): void {
    this.result = e;
    for (const a of e.stats.areas ?? []) this.addArea(a);
    if (!this.posts.has('run')) {
      const universes = this.universesFor?.(e);
      this.posts.set('run', { board: 'run', ...this.fresh(), build: (name) => submissionFromRun(e.stats, e.reason, name, this.runId, universes) });
    }
    this.changed();
  }

  /**
   * Posts every unsent or failed entry (or just `boards`) under `name`. Never throws. `local: false`
   * (signed-in auto-posts) leaves an entry `failed` instead of saving it on this device when the API
   * can't be reached.
   */
  async post(name: string, boards?: BoardId[], opts: SubmitOptions = {}): Promise<void> {
    const todo = [...this.posts.values()].filter((p) => (p.state === 'unsent' || p.state === 'failed') && (!boards || boards.includes(p.board)));
    for (const p of todo) {
      p.state = 'posting';
      p.error = undefined;
    }
    if (todo.length) this.changed();
    // One at a time keeps the order stable and stays well inside the API's burst limit.
    for (const p of todo) {
      try {
        const sub = p.build(name);
        p.result = p.board === 'run'
          ? await this.client.submitScore(sub as Parameters<LeaderboardClient['submitScore']>[0], opts)
          : await this.client.submitAreaScore(sub as Parameters<LeaderboardClient['submitAreaScore']>[0], opts);
        p.state = 'posted';
      } catch (err) {
        // A Run the server can never accept (e.g. under a second long) is not worth retrying.
        const invalid = err instanceof LeaderboardError && err.code === 'invalid';
        p.state = invalid ? 'invalid' : 'failed';
        p.error = err instanceof LeaderboardError ? err.message : 'Could not reach the leaderboard.';
      }
      this.changed();
    }
  }
}

export interface LeaderboardPosting {
  /** The Run being played or just ended (null before the first Run). */
  readonly current: RunPosts | null;
  /** The entries of an ended Run: the tracked one, or (for a payload it never saw) a fresh unsent set. */
  forResult(e: GameEvents['runEnded']): RunPosts;
  /** Name used for posts: the saved leaderboard name, else the account's, else a default. */
  playerName(): string;
  /** True when entries post without asking (signed in). */
  readonly auto: boolean;
}

/**
 * Whether a Run counts for the leaderboards (and drops Keepsakes): not with debug tools (`?debug`)
 * and not started past the house (`?area=`, checkpoint starts). A resumed Run (Save & quit) keeps
 * the verdict it was saved with.
 */
export function isRankedRun(debug: boolean, config: Pick<RunConfig, 'area' | 'resume'> | undefined): boolean {
  return !debug && !config?.resume?.unranked && (!config?.area || config.area === 'house');
}

let installed: LeaderboardPosting | null = null;

/** The installed tracker, if `installLeaderboardPosting` ran (browser builds). */
export function getLeaderboardPosting(): LeaderboardPosting | null {
  return installed;
}

export function installLeaderboardPosting(
  game: Game,
  opts: { client?: LeaderboardClient; account?: AccountClient; universes?: (e: GameEvents['runEnded']) => number } = {},
): LeaderboardPosting {
  const client = opts.client ?? defaultClient;
  const account = opts.account ?? defaultAccount;
  // awardRun is idempotent per Run and counts a Universe victory, so the count is current whichever runEnded listener runs first.
  const universes = opts.universes ?? ((e: GameEvents['runEnded']) => getMeta().awardRun(e).universes);
  let current: RunPosts | null = null;
  /** Whether the current Run counts (see RunPosts.ranked). */
  let ranked = true;

  const playerName = (): string =>
    cleanName(client.getPlayerName()).name || cleanName(account.state.user?.name ?? '').name || DEFAULT_NAME;
  const isAuto = () => account.state.status === 'signedIn';

  /** Posts and, mid-Run, toasts each result. */
  async function autoPost(posts: RunPosts, boards?: BoardId[]): Promise<void> {
    if (!posts.ranked || !isAuto()) return;
    // Signed-in posts never fall back to this device: a failure stays retryable.
    await posts.post(playerName(), boards, { local: false });
    if (posts.result || !boards) return;
    for (const b of boards) {
      const p = posts.get(b);
      if (p?.state !== 'posted') continue;
      const rank = p.result?.rank;
      game.hud.toast(`🏆 ${boardName(b)} board${rank ? `: #${rank}` : ''}${p.result?.entry.verified ? ' ✓' : ''}`, { key: `lb-${b}`, tone: 'good' });
    }
  }

  game.events.on('runStarted', () => {
    const run = game.run;
    ranked = isRankedRun(game.debug, run?.config);
    current = new RunPosts(client, run?.config.characterId ?? 'lint', run?.difficulty.id, ranked, run?.loadout ?? [], universes, run?.config.resume?.leaderboardRunId);
  });
  // Save & quit: the resumed Run posts under the same id and keeps its ranking.
  game.events.on('runSuspended', (e) => {
    if (!current) return;
    e.snapshot.leaderboardRunId = current.runId;
    if (!current.ranked) e.snapshot.unranked = true;
  });
  game.events.on('cheatsUnlocked', () => {
    ranked = false;
    current?.unrank('runs played with cheats are not ranked.');
  });
  game.events.on('areaCompleted', (e) => {
    if (!current) return;
    current.addArea(e.stats);
    void autoPost(current, [e.stats.area]);
  });
  game.events.on('runEnded', (e) => {
    if (!current) return;
    current.finish(e);
    void autoPost(current);
  });
  // Signing in (say from the results screen's inline buttons) posts what is still waiting.
  account.subscribe((s) => {
    if (s.status === 'signedIn' && current?.pending) void autoPost(current);
  });

  installed = {
    get current() {
      return current;
    },
    forResult(e) {
      if (current?.result === e) return current;
      // The results screen can see runEnded before this tracker's own handler does.
      if (current && !current.result) {
        current.finish(e);
        return current;
      }
      const posts = new RunPosts(client, e.stats.characterId, e.stats.difficulty, true, e.stats.loadout ?? [], universes);
      posts.finish(e);
      return posts;
    },
    playerName,
    get auto() {
      return ranked && isAuto();
    },
  };
  return installed;
}
