import { describe, expect, it } from 'vitest';
import { EventBus } from '../../core/events';
import type { Game } from '../../game/game';
import type { AreaStats, RunStats } from '../../game/runStats';
import type { AccountClient, AccountState } from '../../net/account';
import { createLeaderboardClient, LeaderboardError, type LeaderboardClient } from '../../net/leaderboard';
import type { RunSnapshot } from '../../game/snapshot';
import { installLeaderboardPosting, isRankedRun, RunPosts } from './posting';

const house: AreaStats = { area: 'house', startSec: 0, timeSec: 400, radiusIn: 1, maxRadius: 52, debrisAbsorbed: 900, cleared: true };
const stats = (areas: AreaStats[]): RunStats => ({
  seed: 's', characterId: 'lint', difficulty: 'casual', timeSec: 600, maxRadius: 80, finalRadius: 80, debrisAbsorbed: 1400,
  hazardsAbsorbed: 0, tierReached: 5, tierTimes: {}, perks: [], area: 'neighborhood', houseCleared: true, areas,
});
const neighborhood: AreaStats = { area: 'neighborhood', startSec: 400, timeSec: 200, radiusIn: 52, maxRadius: 80, debrisAbsorbed: 500, cleared: false };

function memoryStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

/** A client whose API is missing, so everything lands on the local board; records what was posted. */
function offlineClient() {
  const client = createLeaderboardClient({ storage: memoryStorage(), fetch: async () => new Response('', { status: 404 }) });
  const posted: string[] = [];
  const wrap: LeaderboardClient = {
    ...client,
    submitScore: (s) => (posted.push(`run:${s.name}:${s.runId}`), client.submitScore(s)),
    submitAreaScore: (s) => (posted.push(`${s.area}:${s.name}:${s.runId}`), client.submitAreaScore(s)),
  };
  return { client: wrap, posted };
}

function fakeAccount(status: AccountState['status'], name = 'Ada') {
  let state: AccountState = { status, user: status === 'signedIn' ? { id: 'u1', name, image: null } : null, providers: [], pending: false, error: null };
  const listeners = new Set<(s: AccountState) => void>();
  const account = {
    get state() {
      return state;
    },
    subscribe(fn: (s: AccountState) => void) {
      listeners.add(fn);
      fn(state);
      return () => listeners.delete(fn);
    },
  } as unknown as AccountClient;
  const signIn = () => {
    state = { ...state, status: 'signedIn', user: { id: 'u1', name, image: null } };
    for (const l of listeners) l(state);
  };
  return { account, signIn };
}

function fakeGame(area?: 'city', debug = false) {
  const events = new EventBus();
  const toasts: string[] = [];
  const game = {
    events,
    debug,
    run: { config: { characterId: 'lint', area }, difficulty: { id: 'casual' } },
    hud: { toast: (t: string) => toasts.push(t) },
  } as unknown as Game;
  return { game, events, toasts };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('RunPosts', () => {
  it('has an entry per cleared Area plus the Run, and posts them all', async () => {
    const { client, posted } = offlineClient();
    const posts = new RunPosts(client, 'lint', 'casual');
    posts.finish({ reason: 'died', stats: stats([house, neighborhood]) });
    expect(posts.list().map((p) => [p.board, p.state])).toEqual([['run', 'unsent'], ['house', 'unsent']]);
    await posts.post('Bea');
    expect(posts.list().map((p) => p.state)).toEqual(['posted', 'posted']);
    expect(posted).toEqual([`house:Bea:${posts.runId}`, `run:Bea:${posts.runId}`]); // in the order they were added
    expect(posts.pending).toBe(false);
  });

  it('sends the Run’s Loadout with every entry, and the local board keeps it', async () => {
    const { client } = offlineClient();
    const loadout = [{ type: 'reclaim', rarity: 2 } as const, { type: 'reclaim', rarity: 2 } as const];
    const posts = new RunPosts(client, 'lint', 'casual', true, loadout);
    posts.finish({ reason: 'died', stats: { ...stats([house, neighborhood]), loadout } });
    await posts.post('Bea');
    expect(posts.get('run')?.result?.entry.loadout).toEqual(loadout);
    expect(posts.get('house')?.result?.entry.loadout).toEqual(loadout);
    expect((await client.getTop()).entries[0]?.loadout).toEqual(loadout);
  });

  it('an Area entry keeps the Loadout it was cleared with; a Keepsake tucked in later goes on the Run entry', async () => {
    const { client } = offlineClient();
    const loadout: { type: 'reclaim'; rarity: number }[] = [];
    const posts = new RunPosts(client, 'lint', 'casual', true, loadout);
    posts.addArea(house);
    // Tucked in mid-Run, after the house (the live `run.loadout` grows).
    loadout.push({ type: 'reclaim', rarity: 2 });
    posts.finish({ reason: 'died', stats: { ...stats([house, neighborhood]), loadout: [...loadout] } });
    await posts.post('Bea');
    expect(posts.get('house')?.state).toBe('posted');
    expect(posts.get('house')?.result?.entry.loadout ?? []).toEqual([]);
    expect(posts.get('run')?.result?.entry.loadout).toEqual(loadout);
  });

  it('an Area entry rebuilt after Save & quit sends the Loadout the Area was left with', async () => {
    const { client } = offlineClient();
    // Resumed with a Keepsake tucked in after the house: the house's stats still say it had none.
    const loadout = [{ type: 'reclaim', rarity: 2 } as const];
    const posts = new RunPosts(client, 'lint', 'casual', true, loadout);
    posts.finish({ reason: 'died', stats: { ...stats([{ ...house, loadout: [] }, neighborhood]), loadout } });
    await posts.post('Bea');
    expect(posts.get('house')?.result?.entry.loadout ?? []).toEqual([]);
    expect(posts.get('run')?.result?.entry.loadout).toEqual(loadout);
  });

  it('sends the Universes count with the Run board entry only', async () => {
    const { client } = offlineClient();
    const seen: unknown[] = [];
    const posts = new RunPosts(client, 'lint', 'casual', true, [], (e) => (seen.push(e), 4));
    const e = { reason: 'died' as const, stats: stats([house, neighborhood]) };
    posts.finish(e);
    expect(seen).toEqual([e]);
    await posts.post('Bea');
    expect(posts.get('run')?.result?.entry).toMatchObject({ universes: 4 });
    expect(posts.get('house')?.result?.entry).not.toHaveProperty('universes');
  });

  it('ranks only Runs without debug tools that start in the house', () => {
    expect(isRankedRun(false, { area: undefined })).toBe(true);
    expect(isRankedRun(false, { area: 'house' })).toBe(true);
    expect(isRankedRun(true, { area: undefined })).toBe(false);
    expect(isRankedRun(false, { area: 'city' })).toBe(false);
    // A resumed Run keeps the verdict it was saved with.
    expect(isRankedRun(false, { area: undefined, resume: { unranked: true } as RunSnapshot })).toBe(false);
    expect(isRankedRun(false, { area: undefined, resume: {} as RunSnapshot })).toBe(true);
  });

  it('a resumed Run posts under the id it was saved with', () => {
    const { client } = offlineClient();
    expect(new RunPosts(client, 'lint', 'casual', true, [], undefined, 'saved-run-id').runId).toBe('saved-run-id');
    expect(new RunPosts(client, 'lint', 'casual').runId).not.toBe(new RunPosts(client, 'lint', 'casual').runId);
  });

  it('marks entries the server refuses as invalid and network trouble as failed', async () => {
    const { client } = offlineClient();
    let fail: Error = new LeaderboardError('too short', 'invalid');
    const posts = new RunPosts({ ...client, submitScore: async () => Promise.reject(fail) }, 'lint', 'casual');
    posts.finish({ reason: 'quit', stats: stats([]) });
    await posts.post('Bea');
    expect(posts.get('run')).toMatchObject({ state: 'invalid', error: 'too short' });
    expect(posts.pending).toBe(false);

    fail = new LeaderboardError('slow down', 'rate_limited');
    const again = new RunPosts({ ...client, submitScore: async () => Promise.reject(fail) }, 'lint', 'casual');
    again.finish({ reason: 'quit', stats: stats([]) });
    await again.post('Bea');
    expect(again.get('run')?.state).toBe('failed');
    expect(again.pending).toBe(true);
  });
});

describe('installLeaderboardPosting', () => {
  it('auto-posts each cleared Area and the Run for a signed-in player', async () => {
    const { client, posted } = offlineClient();
    const { account } = fakeAccount('signedIn', 'Ada Lovelace');
    const { game, events, toasts } = fakeGame();
    const posting = installLeaderboardPosting(game, { client, account });
    events.emit('runStarted', { seed: 's', characterId: 'lint' });
    const runId = posting.current!.runId;
    events.emit('areaCompleted', { stats: house, characterId: 'lint', difficulty: 'casual' });
    await settle();
    expect(posted).toEqual([`house:Ada Lovelace:${runId}`]);
    expect(toasts).toEqual(['🏆 House board: #1']);

    const e = { reason: 'died' as const, stats: stats([house, neighborhood]) };
    events.emit('runEnded', e);
    await settle();
    expect(posted).toEqual([`house:Ada Lovelace:${runId}`, `run:Ada Lovelace:${runId}`]);
    expect(posting.forResult(e).list().map((p) => p.state)).toEqual(['posted', 'posted']);
  });

  it('holds an anonymous player\'s entries until they submit or sign in', async () => {
    const { client, posted } = offlineClient();
    const { account, signIn } = fakeAccount('signedOut');
    const { game, events } = fakeGame();
    const posting = installLeaderboardPosting(game, { client, account });
    events.emit('runStarted', { seed: 's', characterId: 'lint' });
    events.emit('areaCompleted', { stats: house, characterId: 'lint', difficulty: 'casual' });
    const e = { reason: 'died' as const, stats: stats([house, neighborhood]) };
    events.emit('runEnded', e);
    await settle();
    expect(posted).toEqual([]);
    expect(posting.forResult(e).pending).toBe(true);

    signIn();
    await settle();
    expect(posted.map((p) => p.split(':')[0])).toEqual(['house', 'run']);
    expect(posting.forResult(e).pending).toBe(false);
  });

  it('hands the results screen the tracked Run even before its own runEnded handler ran', async () => {
    const { client, posted } = offlineClient();
    const { account } = fakeAccount('signedIn');
    const { game, events } = fakeGame();
    const e = { reason: 'died' as const, stats: stats([house]) };
    let seen: ReturnType<ReturnType<typeof installLeaderboardPosting>['forResult']> | null = null;
    events.on('runEnded', (p) => (seen = posting.forResult(p))); // subscribed first, like the results screen
    const posting = installLeaderboardPosting(game, { client, account });
    events.emit('runStarted', { seed: 's', characterId: 'lint' });
    events.emit('runEnded', e);
    await settle();
    expect(seen).toBe(posting.current);
    expect(posted).toHaveLength(2);
  });

  it('never auto-posts a Run started in a later Area', async () => {
    const { client, posted } = offlineClient();
    const { account } = fakeAccount('signedIn');
    const { game, events } = fakeGame('city');
    const posting = installLeaderboardPosting(game, { client, account });
    events.emit('runStarted', { seed: 's', characterId: 'lint' });
    events.emit('runEnded', { reason: 'died', stats: stats([]) });
    await settle();
    expect(posted).toEqual([]);
    expect(posting.auto).toBe(false);
  });

  it('does not rank a Run played with debug tools, even on submit', async () => {
    const { client, posted } = offlineClient();
    const { account } = fakeAccount('signedOut');
    const { game, events } = fakeGame(undefined, true);
    const posting = installLeaderboardPosting(game, { client, account });
    events.emit('runStarted', { seed: 's', characterId: 'lint' });
    const e = { reason: 'died' as const, stats: stats([house]) };
    events.emit('runEnded', e);
    const posts = posting.forResult(e);
    await posts.post('Bea');
    expect(posted).toEqual([]);
    expect(posts.list().map((p) => p.state)).toEqual(['invalid', 'invalid']);
    expect(posts.pending).toBe(false);
  });
});
