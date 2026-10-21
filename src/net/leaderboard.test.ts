import { describe, expect, it } from 'vitest';
import type { RunStats } from '../game/runStats';
import { areaSubmission, createLeaderboardClient, LeaderboardError, submissionFromRun } from './leaderboard';

function memoryStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

const stats: RunStats = {
  seed: 's', characterId: 'lint', timeSec: 200, maxRadius: 9.4, finalRadius: 9, debrisAbsorbed: 250,
  hazardsAbsorbed: 0, tierReached: 3, tierTimes: {}, perks: [], area: 'house', houseCleared: false,
};

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('leaderboard client', () => {
  it('falls back to local scores on 404 and remembers being offline', async () => {
    let calls = 0;
    const client = createLeaderboardClient({
      storage: memoryStorage(),
      fetch: async () => {
        calls++;
        return new Response('not found', { status: 404 });
      },
    });
    const a = await client.submitScore(submissionFromRun(stats, 'died', 'Alice'));
    const b = await client.submitScore(submissionFromRun({ ...stats, maxRadius: 9.9 }, 'died', 'Bob'));
    expect(a.online).toBe(false);
    expect(b.rank).toBe(1);
    const top = await client.getTop();
    expect(top.online).toBe(false);
    expect(top.entries.map((e) => e.name)).toEqual(['Bob', 'Alice']);
    expect(client.isOnline()).toBe(false);
    expect(calls).toBe(1); // later calls skip the API during the retry window
  });

  it('treats HTML (SPA fallback) and network errors as offline', async () => {
    const html = createLeaderboardClient({ storage: memoryStorage(), fetch: async () => new Response('<html>', { headers: { 'content-type': 'text/html' } }) });
    expect((await html.getTop()).online).toBe(false);
    const down = createLeaderboardClient({ storage: memoryStorage(), fetch: async () => Promise.reject(new TypeError('network')) });
    expect((await down.getTop()).online).toBe(false);
  });

  it('uses the API when available', async () => {
    const entry = { id: '1', name: 'Alice', character: 'lint', score: 5 };
    const client = createLeaderboardClient({
      storage: memoryStorage(),
      fetch: async (_url, init) => (init?.method === 'POST' ? jsonResponse(201, { entry, rank: 3 }) : jsonResponse(200, { entries: [entry] })),
    });
    expect((await client.submitScore(submissionFromRun(stats, 'died', 'Alice'))).rank).toBe(3);
    expect((await client.getTop()).entries).toHaveLength(1);
    expect(client.isOnline()).toBe(true);
  });

  it('throws on validation and rate-limit errors instead of falling back', async () => {
    const client = createLeaderboardClient({ storage: memoryStorage(), fetch: async () => jsonResponse(429, { error: 'rate_limited', message: 'slow down' }) });
    await expect(client.submitScore(submissionFromRun(stats, 'died', 'Alice'))).rejects.toThrow('slow down');
    await expect(client.submitScore(submissionFromRun(stats, 'died', '   '))).rejects.toBeInstanceOf(LeaderboardError);
  });

  it('carries the Run difficulty into the submission and score', () => {
    const casual = submissionFromRun(stats, 'died', 'Alice');
    expect(casual.difficulty).toBe('casual');
    const hard = submissionFromRun({ ...stats, difficulty: 'hardcore' }, 'died', 'Alice');
    expect(hard.difficulty).toBe('hardcore');
    expect(hard.score).toBe(Math.round(casual.score * 1.6));
  });

  it('stores the difficulty locally and reads old local entries as casual', async () => {
    const storage = memoryStorage();
    const old = { id: 'old', name: 'Oldie', character: 'zap', score: 10, maxRadius: 1, debrisAbsorbed: 1, tierReached: 1, durationMs: 5000, victory: false, createdAt: '2025-01-01T00:00:00.000Z' };
    storage.setItem('dustbunny.leaderboard.local.v1', JSON.stringify([old]));
    const client = createLeaderboardClient({ storage, fetch: async () => new Response('not found', { status: 404 }) });
    const res = await client.submitScore(submissionFromRun({ ...stats, difficulty: 'arcade' }, 'died', 'Alice'));
    expect(res.entry.difficulty).toBe('arcade');
    const top = await client.getTop();
    expect(top.entries.map((e) => [e.name, e.difficulty])).toEqual([['Alice', 'arcade'], ['Oldie', 'casual']]);
  });

  it('remembers a sanitised player name', () => {
    const client = createLeaderboardClient({ storage: memoryStorage() });
    client.setPlayerName('  Dusty   ');
    expect(client.getPlayerName()).toBe('Dusty');
  });

  it('keeps Area boards apart in the local fallback', async () => {
    const client = createLeaderboardClient({ storage: memoryStorage(), fetch: async () => new Response('not found', { status: 404 }) });
    const house = { area: 'house' as const, startSec: 0, timeSec: 400, radiusIn: 1, maxRadius: 52, debrisAbsorbed: 900, cleared: true };
    const a = await client.submitAreaScore(areaSubmission(house, 'lint', 'casual', 'Alice', 'run-aaaaaaaa'));
    const b = await client.submitAreaScore(areaSubmission({ ...house, timeSec: 300 }, 'zap', 'casual', 'Bob'));
    await client.submitAreaScore(areaSubmission({ ...house, area: 'neighborhood', radiusIn: 52, maxRadius: 180, timeSec: 500 }, 'lint', 'casual', 'Cleo'));
    expect([a.online, a.rank, b.rank]).toEqual([false, 1, 1]);
    expect('runId' in a.entry).toBe(false);
    expect((await client.getAreaTop({ area: 'house' })).entries.map((e) => e.name)).toEqual(['Bob', 'Alice']);
    expect((await client.getAreaTop({ area: 'house', character: 'lint' })).entries.map((e) => e.name)).toEqual(['Alice']);
    expect((await client.getAreaTop({ area: 'neighborhood' })).entries.map((e) => [e.name, e.area])).toEqual([['Cleo', 'neighborhood']]);
    expect((await client.getAreaTop({ area: 'city' })).entries).toEqual([]);
  });

  it('asks the API for an Area board', async () => {
    const urls: string[] = [];
    const client = createLeaderboardClient({
      storage: memoryStorage(),
      fetch: async (url, init) => {
        urls.push(`${init?.method ?? 'GET'} ${String(url)}`);
        return init?.method === 'POST' ? jsonResponse(201, { entry: { id: '9' }, rank: 2 }) : jsonResponse(200, { entries: [] });
      },
    });
    await client.getAreaTop({ area: 'city', character: 'zap' });
    const house = { area: 'house' as const, startSec: 0, timeSec: 400, radiusIn: 1, maxRadius: 52, debrisAbsorbed: 900, cleared: true };
    expect((await client.submitAreaScore(areaSubmission(house, 'lint', 'casual', 'Alice'))).rank).toBe(2);
    expect(urls).toEqual(['GET /api/leaderboard?board=city&character=zap', 'POST /api/leaderboard?board=house']);
  });

  it('keeps a POST that timed out retryable instead of saving it locally', async () => {
    const storage = memoryStorage();
    const client = createLeaderboardClient({
      storage,
      postTimeoutMs: 5,
      fetch: (_url, init) => new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))),
    });
    await expect(client.submitScore(submissionFromRun(stats, 'died', 'Alice'))).rejects.toMatchObject({ code: 'timeout' });
    expect(storage.getItem('dustbunny.leaderboard.local.v1')).toBeNull();
  });

  it('throws instead of falling back when asked not to save locally', async () => {
    const client = createLeaderboardClient({ storage: memoryStorage(), fetch: async () => new Response('', { status: 503 }) });
    await expect(client.submitScore(submissionFromRun(stats, 'died', 'Alice'), { local: false })).rejects.toMatchObject({ code: 'unavailable' });
  });
});
