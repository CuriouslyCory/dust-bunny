import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountClient, AccountState } from '../net/account';
import { compareProgress, validateProgress, type Progress } from '../shared/progress';
import { CLOUD_DIRTY_KEY, CLOUD_USER_KEY, createCloudSave, progressOf } from './cloudSave';
import { MetaProgress } from './meta';
import type { KeyValueStorage } from './save';

const memStorage = (init: Record<string, string> = {}): KeyValueStorage & { map: Map<string, string> } => {
  const map = new Map(Object.entries(init));
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
};

const prog = (fluff: number, totalFluffEarned: number, runs: number, upgrades: Record<string, number> = {}, universes = 0): Progress => ({
  fluff,
  upgrades,
  characters: {},
  universes,
  stats: { runs, wins: 0, bestRadius: 5, bestTier: 2, totalFluffEarned, keepsakesEarned: 0 },
});

/** In-memory /api/progress with the same accept rule as the real one (per signed-in user). */
function fakeServer() {
  const rows = new Map<string, Progress>();
  let user: string | null = null;
  let down = false;
  /** While set, PUTs wait for it (simulates a slow request). */
  let gate: Promise<void> | null = null;
  const puts: Progress[] = [];
  const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    if (init?.method === 'PUT' && gate) await gate;
    if (down) return new Response('{}', { status: 503, headers: { 'content-type': 'application/json' } });
    if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
    const stored = rows.get(user) ?? null;
    if (!init?.method || init.method === 'GET') return Response.json({ progress: stored });
    const v = validateProgress(JSON.parse(String(init.body)));
    if (!v.ok) return Response.json({ error: 'invalid' }, { status: 400 });
    puts.push(v.value);
    // Universes only go up, whether or not the upload is stored.
    const universes = Math.max(v.value.universes, stored?.universes ?? 0);
    if (stored && compareProgress(v.value, stored) < 0) {
      rows.set(user, { ...stored, universes });
      return Response.json({ accepted: false, progress: rows.get(user) });
    }
    rows.set(user, { ...v.value, universes });
    return Response.json({ accepted: true, progress: rows.get(user) });
  });
  return {
    rows,
    puts,
    fetch: fetch as unknown as typeof globalThis.fetch,
    signIn: (id: string) => (user = id),
    signOut: () => (user = null),
    setDown: (d: boolean) => (down = d),
    /** Holds PUTs until the returned function is called. */
    hold: () => {
      let release!: () => void;
      gate = new Promise((r) => (release = r));
      return () => {
        gate = null;
        release();
      };
    },
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
  const refresh = vi.fn(async () => state);
  const client = {
    refresh,
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
    refresh,
    signIn: (id: string) => set({ status: 'signedIn', user: { id, name: id, image: null } }),
    signOut: () => set({ status: 'signedOut', user: null }),
  };
}

function setup(local: Progress | null, storageInit: Record<string, string> = {}) {
  const meta = new MetaProgress(memStorage());
  if (local) meta.store.update((d) => Object.assign(d, { fluff: local.fluff, upgrades: local.upgrades, stats: local.stats, universes: local.universes }));
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
    expect(progressOf(s.meta.data)).toEqual(progressOf({ ...s.meta.data, fluff: 0, upgrades: {}, stats: { runs: 0, wins: 0, bestRadius: 0, bestTier: 0, totalFluffEarned: 0, keepsakesEarned: 0, feltings: 0 }, characters: {}, universes: 0 }));
    expect(s.server.puts).toEqual([]);
    expect(s.storage.map.get(CLOUD_USER_KEY)).toBe('u2');
  });

  it('never lowers universes: adopting keeps the larger count and the server keeps it too', async () => {
    const s = setup(prog(10, 100, 4, {}, 2), { [CLOUD_USER_KEY]: 'u1' });
    s.server.rows.set('u1', prog(300, 500, 12, {}, 1));
    await s.signIn('u1');
    expect(s.meta.fluff).toBe(300);
    expect(s.meta.universes).toBe(2);
    expect(s.server.rows.get('u1')!.universes).toBe(2);

    // Local is ahead but the server has more Universes (another device): both end at the max.
    const t = setup(prog(10, 800, 20, {}, 1), { [CLOUD_USER_KEY]: 'u1' });
    t.server.rows.set('u1', prog(300, 500, 12, {}, 4));
    await t.signIn('u1');
    expect(t.server.rows.get('u1')).toEqual(prog(10, 800, 20, {}, 4));
    expect(t.meta.universes).toBe(4);
    expect(t.cloud.status).toBe('synced');
  });

  it("replaces universes when loading another account's save", async () => {
    const s = setup(prog(900, 900, 30, {}, 3), { [CLOUD_USER_KEY]: 'other' });
    s.server.rows.set('u2', prog(5, 50, 2, {}, 1));
    await s.signIn('u2');
    expect(s.meta.universes).toBe(1);
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

  it('syncs Keepsake Hoards, and Felting / shedding upload like spending (marked dirty, no counter change)', async () => {
    const s = setup(prog(1000, 1000, 5));
    await s.signIn('u1');
    s.server.puts.length = 0;
    const k = { type: 'reclaim', rarity: 1 } as const;
    s.meta.creditKeepsakes('lint', [k, k, k, k], 'robovac_9000');
    await vi.advanceTimersByTimeAsync(150);
    expect(s.server.rows.get('u1')?.characters).toEqual({ lint: { hoard: { 'reclaim:common': 4 }, bossesBeaten: ['robovac_9000'] } });
    s.server.setDown(true);
    expect(s.meta.felt('lint', k).ok).toBe(true);
    expect(s.meta.shed('lint', k).ok).toBe(true);
    expect(s.storage.map.get(CLOUD_DIRTY_KEY)).toBe('u1');
    s.server.setDown(false);
    await vi.advanceTimersByTimeAsync(31_000);
    const row = s.server.rows.get('u1')!;
    expect(row.characters.lint!.hoard).toEqual({ 'reclaim:rare': 1 });
    expect(row.fluff).toBe(1000 - 120 + 40);
    expect(row.stats.totalFluffEarned).toBe(1000);
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

  it('keeps changes made while an upload is in flight', async () => {
    const s = setup(prog(500, 500, 5));
    await s.signIn('u1');
    const release = s.server.hold();
    s.meta.buy('fast_feet');
    await vi.advanceTimersByTimeAsync(150); // upload of "A" starts and waits
    s.meta.buy('magnetism'); // "B" while it is in flight
    release();
    await vi.runAllTimersAsync();
    expect(s.meta.level('fast_feet')).toBe(1);
    expect(s.meta.level('magnetism')).toBe(1);
    expect(s.server.rows.get('u1')?.upgrades).toEqual({ fast_feet: 1, magnetism: 1 });
    expect(s.storage.map.get(CLOUD_DIRTY_KEY)).toBe('');
  });

  it('keeps changes made while connecting', async () => {
    const s = setup(prog(500, 500, 5));
    s.server.rows.set('u1', prog(100, 100, 2));
    const release = s.server.hold();
    s.server.signIn('u1');
    s.acct.signIn('u1');
    await vi.advanceTimersByTimeAsync(10); // guest upload waiting
    s.meta.buy('fast_feet');
    release();
    await vi.runAllTimersAsync();
    expect(s.server.rows.get('u1')?.upgrades).toEqual({ fast_feet: 1 });
  });

  it('on a tie, uploads only if this device has unsynced changes', async () => {
    // Bought offline last session: the device copy wins the tie.
    const offline = setup(prog(10, 300, 6, { reroll: 1 }), { [CLOUD_USER_KEY]: 'u1', [CLOUD_DIRTY_KEY]: 'u1' });
    offline.server.rows.set('u1', prog(150, 300, 6));
    await offline.signIn('u1');
    expect(offline.server.rows.get('u1')).toEqual(prog(10, 300, 6, { reroll: 1 }));

    // A stale device (nothing unsynced): the server copy, with another device's purchase, wins.
    const stale = setup(prog(150, 300, 6), { [CLOUD_USER_KEY]: 'u1' });
    stale.server.rows.set('u1', prog(10, 300, 6, { reroll: 1 }));
    await stale.signIn('u1');
    expect(progressOf(stale.meta.data)).toEqual(prog(10, 300, 6, { reroll: 1 }));
    expect(stale.server.puts).toEqual([]);
  });

  it('marks unsynced changes while the server is down', async () => {
    const s = setup(prog(500, 500, 5));
    await s.signIn('u1');
    s.server.setDown(true);
    s.meta.buy('fast_feet');
    await vi.advanceTimersByTimeAsync(150);
    expect(s.cloud.status).toBe('error');
    expect(s.storage.map.get(CLOUD_DIRTY_KEY)).toBe('u1');
  });

  it('re-checks the session instead of retrying on 401', async () => {
    const s = setup(prog(50, 100, 3));
    await s.signIn('u1');
    s.server.signOut(); // session revoked server-side
    s.meta.buy('fast_feet');
    await vi.advanceTimersByTimeAsync(150);
    expect(s.acct.refresh).toHaveBeenCalled();
    const calls = (s.server.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect((s.server.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(calls);
  });

  it('re-uploads when a Run ended while a refused upload was in flight', async () => {
    const s = setup(prog(50, 100, 3));
    await s.signIn('u1');
    s.server.rows.set('u1', prog(80, 200, 5)); // another device got further
    const release = s.server.hold();
    s.meta.store.update((d) => {
      d.fluff += 1; // a small change: refused against 200
      d.stats.totalFluffEarned += 1;
    });
    await vi.advanceTimersByTimeAsync(150);
    s.meta.store.update((d) => {
      d.fluff += 400; // big Run while the request is in flight: now ahead of 200
      d.stats.totalFluffEarned += 400;
      d.stats.runs += 1;
    });
    release();
    await vi.runAllTimersAsync();
    expect(s.meta.fluff).toBe(451);
    expect(s.server.rows.get('u1')?.stats.totalFluffEarned).toBe(501);
  });

  it('flush reports whether the server has everything', async () => {
    const s = setup(prog(50, 100, 3));
    await s.signIn('u1');
    s.meta.buy('fast_feet');
    expect(await s.cloud.flush()).toBe(true);
    expect(s.server.rows.get('u1')?.upgrades).toEqual({ fast_feet: 1 });
    s.server.setDown(true);
    s.meta.store.update((d) => {
      d.fluff += 5;
      d.stats.totalFluffEarned += 5;
    });
    expect(await s.cloud.flush()).toBe(false);
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
