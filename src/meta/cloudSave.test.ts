import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountClient, AccountState } from '../net/account';
import { compareProgress, validateProgress, type Progress } from '../shared/progress';
import { CLOUD_USER_KEY, createCloudSave, progressOf } from './cloudSave';
import { MetaProgress } from './meta';
import type { KeyValueStorage } from './save';

const memStorage = (init: Record<string, string> = {}): KeyValueStorage & { map: Map<string, string> } => {
  const map = new Map(Object.entries(init));
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
};

const prog = (fluff: number, totalFluffEarned: number, runs: number, upgrades: Record<string, number> = {}): Progress => ({
  fluff,
  upgrades,
  stats: { runs, wins: 0, bestRadius: 5, bestTier: 2, totalFluffEarned },
});

/** In-memory /api/progress with the same accept rule as the real one (per signed-in user). */
function fakeServer() {
  const rows = new Map<string, Progress>();
  let user: string | null = null;
  let down = false;
  const puts: Progress[] = [];
  const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    if (down) return new Response('{}', { status: 503, headers: { 'content-type': 'application/json' } });
    if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
    const stored = rows.get(user) ?? null;
    if (!init?.method || init.method === 'GET') return Response.json({ progress: stored });
    const v = validateProgress(JSON.parse(String(init.body)));
    if (!v.ok) return Response.json({ error: 'invalid' }, { status: 400 });
    puts.push(v.value);
    if (stored && compareProgress(v.value, stored) < 0) return Response.json({ accepted: false, progress: stored });
    rows.set(user, v.value);
    return Response.json({ accepted: true, progress: v.value });
  });
  return {
    rows,
    puts,
    fetch: fetch as unknown as typeof globalThis.fetch,
    signIn: (id: string) => (user = id),
    setDown: (d: boolean) => (down = d),
  };
}

/** Minimal AccountClient: only `subscribe` matters to the cloud save. */
function fakeAccount() {
  const listeners = new Set<(s: AccountState) => void>();
  let state: AccountState = { status: 'signedOut', user: null, providers: ['google', 'discord'], pending: false, error: null };
  const set = (s: Partial<AccountState>) => {
    state = { ...state, ...s };
    for (const l of listeners) l(state);
  };
  const client = {
    get state() {
      return state;
    },
    subscribe(fn: (s: AccountState) => void) {
      listeners.add(fn);
      fn(state);
      return () => listeners.delete(fn);
    },
  } as unknown as AccountClient;
  return {
    client,
    signIn: (id: string) => set({ status: 'signedIn', user: { id, name: id, image: null } }),
    signOut: () => set({ status: 'signedOut', user: null }),
  };
}

function setup(local: Progress | null, storageInit: Record<string, string> = {}) {
  const meta = new MetaProgress(memStorage());
  if (local) meta.store.update((d) => Object.assign(d, { fluff: local.fluff, upgrades: local.upgrades, stats: local.stats }));
  const server = fakeServer();
  const acct = fakeAccount();
  const storage = memStorage(storageInit);
  const cloud = createCloudSave(meta, acct.client, { fetch: server.fetch, storage, debounceMs: 100, retryMs: 1000 });
  const signIn = async (id: string) => {
    server.signIn(id);
    acct.signIn(id);
    await vi.runAllTimersAsync();
  };
  return { meta, server, acct, storage, cloud, signIn };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('cloud save', () => {
  it('uploads guest progress on first sign-in', async () => {
    const s = setup(prog(70, 100, 4, { fast_feet: 1 }));
    await s.signIn('u1');
    expect(s.server.rows.get('u1')).toEqual(prog(70, 100, 4, { fast_feet: 1 }));
    expect(s.storage.map.get(CLOUD_USER_KEY)).toBe('u1');
    expect(s.cloud.status).toBe('synced');
  });

  it('does not upload a fresh save, and adopts the account copy when it has more', async () => {
    const s = setup(null);
    s.server.rows.set('u1', prog(300, 500, 12, { magnetism: 2 }));
    await s.signIn('u1');
    expect(s.server.puts).toEqual([]);
    expect(progressOf(s.meta.data)).toEqual(prog(300, 500, 12, { magnetism: 2 }));
  });

  it('keeps local progress when it is ahead of the account', async () => {
    const s = setup(prog(10, 800, 20), { [CLOUD_USER_KEY]: 'u1' });
    s.server.rows.set('u1', prog(300, 500, 12));
    await s.signIn('u1');
    expect(s.server.rows.get('u1')).toEqual(prog(10, 800, 20));
    expect(s.meta.fluff).toBe(10);
  });

  it("loads the account's own progress when the device last synced another account", async () => {
    const s = setup(prog(900, 900, 30, { extra_heart: 2 }), { [CLOUD_USER_KEY]: 'other' });
    await s.signIn('u2');
    expect(progressOf(s.meta.data)).toEqual(progressOf({ ...s.meta.data, fluff: 0, upgrades: {}, stats: { runs: 0, wins: 0, bestRadius: 0, bestTier: 0, totalFluffEarned: 0 } }));
    expect(s.server.puts).toEqual([]);
    expect(s.storage.map.get(CLOUD_USER_KEY)).toBe('u2');
  });

  it('uploads changes after a short delay, including spending Fluff', async () => {
    const s = setup(prog(200, 200, 5));
    await s.signIn('u1');
    s.server.puts.length = 0;
    s.meta.buy('fast_feet');
    s.meta.buy('magnetism');
    expect(s.server.puts).toEqual([]); // debounced
    await vi.advanceTimersByTimeAsync(150);
    expect(s.server.puts).toHaveLength(1);
    expect(s.server.rows.get('u1')?.upgrades).toEqual({ fast_feet: 1, magnetism: 1 });
  });

  it('adopts the server copy when another device got further', async () => {
    const s = setup(prog(50, 100, 3));
    await s.signIn('u1');
    s.server.rows.set('u1', prog(999, 2000, 40, { reroll: 1 })); // other device
    s.meta.store.update((d) => {
      d.fluff += 5;
      d.stats.totalFluffEarned += 5;
    });
    await vi.advanceTimersByTimeAsync(150);
    expect(progressOf(s.meta.data)).toEqual(prog(999, 2000, 40, { reroll: 1 }));
    expect(s.server.puts).toHaveLength(2); // the guest upload, then the refused one; adopting doesn't re-upload
  });

  it('retries after the server was unreachable', async () => {
    const s = setup(prog(50, 100, 3));
    s.server.setDown(true);
    s.server.signIn('u1');
    s.acct.signIn('u1');
    await vi.advanceTimersByTimeAsync(10);
    expect(s.cloud.status).toBe('error');
    s.server.setDown(false);
    await vi.advanceTimersByTimeAsync(1100);
    // The retry runs the full sign-in reconcile again (download first), not a blind upload.
    expect(s.server.rows.get('u1')).toEqual(prog(50, 100, 3));
    expect(s.cloud.status).toBe('synced');
  });

  it("doesn't hand another account's save over when the first sync failed", async () => {
    const s = setup(prog(900, 900, 30), { [CLOUD_USER_KEY]: 'other' });
    s.server.setDown(true);
    s.server.signIn('u2');
    s.acct.signIn('u2');
    await vi.advanceTimersByTimeAsync(10);
    s.meta.buy('fast_feet'); // a change while disconnected must not trigger a blind upload
    s.server.setDown(false);
    await vi.advanceTimersByTimeAsync(1100);
    expect(s.server.puts).toEqual([]);
    expect(s.meta.fluff).toBe(0);
  });

  it('stops syncing on sign-out', async () => {
    const s = setup(prog(50, 100, 3));
    await s.signIn('u1');
    s.acct.signOut();
    expect(s.cloud.status).toBe('off');
    const before = s.server.puts.length;
    s.meta.buy('fast_feet');
    await vi.runAllTimersAsync();
    expect(s.server.puts.length).toBe(before);
  });
});
