import { describe, expect, it } from 'vitest';
import type { RunStats } from '../game/runStats';
import { createLeaderboardClient, LeaderboardError, submissionFromRun } from './leaderboard';

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

  it('remembers a sanitised player name', () => {
    const client = createLeaderboardClient({ storage: memoryStorage() });
    client.setPlayerName('  Dusty   ');
    expect(client.getPlayerName()).toBe('Dusty');
  });
});
