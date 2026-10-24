/** The Run credit ledger's claim queue (src/meta/runCredits.ts, docs/adr/0003): durable, per Account, replayed. */
import { describe, expect, it } from 'vitest';
import type { RunCredit } from '../shared/runCredit';
import { SavedRunAuthError, SavedRunNetError } from './accountHttp';
import { MetaProgress } from './meta';
import { SAVE_KEY } from './save';
import { RUN_CREDITS_KEY, RUN_CREDITS_VERSION, RunCreditQueue, type ClaimResult, type CreditOutcome, type PendingClaim, type RunCreditApi } from './runCredits';

const memStorage = () => {
  const map = new Map<string, string>();
  return { map, getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
};

const stats = { maxRadius: 10, debrisAbsorbed: 100, tierReached: 2 };
const claimFor = (userId: string, runKey: string, at = 1): PendingClaim => ({ userId, runKey, lease: `l-${runKey}`, reason: 'died', stats, at });
const stored = (claims: PendingClaim[], version = RUN_CREDITS_VERSION) => JSON.stringify({ version, claims });

/** A ledger with the server's rule (one row per key); `fail` makes requests fail; `refuse` refuses claims. */
function fakeApi() {
  const ledger: RunCredit[] = [];
  const calls: string[] = [];
  const state = { fail: null as 'net' | 'auth' | null, refuse: false, reject: false, loseAnswer: false };
  const api: RunCreditApi = {
    async claim(b, keepalive = false): Promise<ClaimResult> {
      calls.push(`claim:${b.runKey}${keepalive ? ':keepalive' : ''}`);
      if (state.fail === 'net') throw new SavedRunNetError('offline');
      if (state.fail === 'auth') throw new SavedRunAuthError('signed out');
      if (state.refuse) return { ok: false, reason: 'carriedOn' };
      if (state.reject) return { ok: false, reason: 'rejected' };
      let credit = ledger.find((c) => c.runKey === b.runKey);
      const created = !credit;
      if (!credit) ledger.push((credit = { id: ledger.length + 1, runKey: b.runKey, reason: b.reason, stats: b.stats, creditedAt: '' }));
      if (state.loseAnswer) {
        state.loseAnswer = false;
        throw new SavedRunNetError('answer lost');
      }
      return { ok: true, credit, created };
    },
    async list() {
      calls.push('list');
      if (state.fail) throw new SavedRunNetError('offline');
      return [...ledger].reverse();
    },
  };
  return { api, ledger, calls, state };
}

function queue(storage: ReturnType<typeof memStorage> | null, api: RunCreditApi, meta = new MetaProgress(null)) {
  const q = new RunCreditQueue({ api, storage, meta, retryMs: 1, maxRetryMs: 4 });
  const outcomes: CreditOutcome[] = [];
  q.onCredit((o) => void outcomes.push(o));
  return { q, meta, outcomes };
}

const claimsIn = (storage: ReturnType<typeof memStorage>): PendingClaim[] => (JSON.parse(storage.map.get(RUN_CREDITS_KEY) ?? '{"claims":[]}') as { claims: PendingClaim[] }).claims;

describe('RunCreditQueue', () => {
  it('writes a claim before sending it, removes it on the answer, and credits the row once', async () => {
    const storage = memStorage();
    const { api, ledger, state } = fakeApi();
    state.fail = 'net';
    const { q, meta, outcomes } = queue(storage, api);
    q.setUser('u1');
    q.claim({ userId: 'u1', runKey: 'r1', lease: 'l1', reason: 'victory', stats });
    expect(claimsIn(storage).map((c) => c.runKey)).toEqual(['r1']); // durable before any answer
    await q.idle();
    expect(q.pending).toBe(1);
    state.fail = null;
    q.replay();
    await q.idle();
    expect(claimsIn(storage)).toEqual([]);
    expect(ledger.map((c) => c.runKey)).toEqual(['r1']);
    expect(meta.data.creditedRuns).toEqual(['r1']);
    expect(outcomes.map((o) => [o.runKey, o.reason, o.award?.fluff])).toEqual([['r1', 'victory', expect.any(Number)]]);
    expect(meta.data.stats.wins).toBe(1);
  });

  it('replays stored claims on load for the signed-in Account; another Account’s wait for it', async () => {
    const storage = memStorage();
    storage.setItem(RUN_CREDITS_KEY, stored([claimFor('u1', 'a', 1), claimFor('u2', 'b', 2), claimFor('u1', 'c', 3)]));
    const { api, calls } = fakeApi();
    const { q, meta } = queue(storage, api);
    expect(calls).toEqual([]); // nothing until an Account is known
    q.setUser('u1');
    await q.idle();
    expect(calls).toEqual(['claim:a', 'claim:c']); // oldest first
    expect(meta.data.creditedRuns).toEqual(['a', 'c']);
    expect(claimsIn(storage).map((c) => c.runKey)).toEqual(['b']); // u2's waits
    expect(q.pending).toBe(0);
    q.setUser('u2');
    await q.idle();
    expect(calls.at(-1)).toBe('claim:b');
    expect(claimsIn(storage)).toEqual([]);
  });

  it('leaves a stored file from a newer build untouched, and keeps this build’s claims in memory', async () => {
    const storage = memStorage();
    const raw = stored([claimFor('u1', 'future')], RUN_CREDITS_VERSION + 1);
    storage.setItem(RUN_CREDITS_KEY, raw);
    const { api, calls, ledger } = fakeApi();
    const { q } = queue(storage, api);
    q.setUser('u1');
    await q.idle();
    expect(calls).toEqual([]); // not read
    q.claim({ userId: 'u1', runKey: 'now', lease: 'l', reason: 'quit', stats });
    await q.idle();
    expect(ledger.map((c) => c.runKey)).toEqual(['now']); // sent all the same
    expect(storage.map.get(RUN_CREDITS_KEY)).toBe(raw); // never written
  });

  it('a lost answer is retried and credits once; a refusal removes the claim and tells listeners', async () => {
    const storage = memStorage();
    const { api, ledger, state, calls } = fakeApi();
    const { q, meta, outcomes } = queue(storage, api);
    q.setUser('u1');
    state.loseAnswer = true;
    q.claim({ userId: 'u1', runKey: 'r1', lease: 'l1', reason: 'died', stats });
    await q.idle();
    await new Promise((r) => setTimeout(r, 20));
    await q.idle();
    expect(calls.filter((c) => c === 'claim:r1')).toHaveLength(2);
    expect(ledger).toHaveLength(1);
    expect(meta.data.stats.runs).toBe(1);
    expect(claimsIn(storage)).toEqual([]);

    state.refuse = true;
    q.claim({ userId: 'u1', runKey: 'r2', lease: 'l2', reason: 'died', stats });
    await q.idle();
    expect(claimsIn(storage)).toEqual([]);
    expect(meta.data.creditedRuns).toEqual(['r1']);
    expect(outcomes.map((o) => [o.runKey, o.award === null])).toEqual([['r1', false], ['r2', true]]);
  });

  it('a claim the server rejects (400) is dropped, not retried', async () => {
    const storage = memStorage();
    const { api, state, calls } = fakeApi();
    state.reject = true;
    const { q, outcomes } = queue(storage, api);
    q.setUser('u1');
    q.claim({ userId: 'u1', runKey: 'bad', lease: 'l', reason: 'died', stats });
    await q.idle();
    await new Promise((r) => setTimeout(r, 10));
    expect(calls.filter((c) => c.startsWith('claim'))).toHaveLength(1);
    expect(claimsIn(storage)).toEqual([]);
    expect(outcomes).toEqual([{ runKey: 'bad', reason: 'died', fluff: 0, award: null, refused: 'rejected' }]); // a definite answer: the results screen settles
  });

  it('stops on a lost session until the Account signs in again', async () => {
    const storage = memStorage();
    const { api, state, calls } = fakeApi();
    state.fail = 'auth';
    const { q } = queue(storage, api);
    q.setUser('u1');
    q.claim({ userId: 'u1', runKey: 'r1', lease: 'l', reason: 'died', stats });
    await q.idle();
    await new Promise((r) => setTimeout(r, 10));
    expect(calls).toHaveLength(1); // no retry
    expect(q.pending).toBe(1);
    state.fail = null;
    q.setUser(null);
    q.setUser('u1');
    await q.idle();
    expect(q.pending).toBe(0);
  });

  it('sweeps once the queue drains after a network error, applying only rows the copy lacks', async () => {
    const storage = memStorage();
    const { api, ledger, state, calls } = fakeApi();
    ledger.push({ id: 1, runKey: 'missed', reason: 'quit', stats, creditedAt: '' });
    const { q, meta } = queue(storage, api);
    q.setUser('u1');
    meta.awardRun({ runKey: 'have', reason: 'died', stats });
    ledger.push({ id: 2, runKey: 'have', reason: 'died', stats, creditedAt: '' });
    state.fail = 'net';
    q.claim({ userId: 'u1', runKey: 'r1', lease: 'l', reason: 'died', stats });
    await q.idle();
    expect(calls).not.toContain('list');
    state.fail = null;
    q.replay();
    await q.idle();
    expect(calls.at(-1)).toBe('list');
    expect(meta.data.creditedRuns).toEqual(['have', 'r1', 'missed']);
    expect(meta.data.stats.runs).toBe(3);
    // A second sweep adds nothing.
    await q.sweep();
    expect(meta.data.stats.runs).toBe(3);
  });

  it('flush sends waiting claims with keepalive and leaves them stored for the next load', async () => {
    const storage = memStorage();
    const { api, state, calls } = fakeApi();
    state.fail = 'net';
    const { q } = queue(storage, api);
    q.setUser('u1');
    q.claim({ userId: 'u1', runKey: 'r1', lease: 'l', reason: 'died', stats });
    await q.idle();
    state.fail = null;
    q.flush();
    expect(calls.at(-1)).toBe('claim:r1:keepalive');
    expect(claimsIn(storage).map((c) => c.runKey)).toEqual(['r1']); // still stored: replayed next load if the answer is lost
  });

  it('drops unreadable claims and a corrupt file without throwing', async () => {
    const storage = memStorage();
    storage.setItem(RUN_CREDITS_KEY, '{nope');
    const { api, calls } = fakeApi();
    const { q } = queue(storage, api);
    q.setUser('u1');
    await q.idle();
    expect(calls).toEqual([]);
    storage.setItem(RUN_CREDITS_KEY, stored([{ ...claimFor('u1', 'ok') }, { userId: 'u1', runKey: 'bad' } as PendingClaim, { ...claimFor('u1', 'nostats'), stats: {} as never }]));
    q.replay();
    await q.idle();
    expect(calls).toEqual(['claim:ok']);
  });
});

describe('RunCreditQueue: answers across an Account switch, and the server contract (docs/adr/0003)', () => {
  it('after an Account switch, the new Account’s claim goes out once the old one’s request settles; the old answer stays queued for its Account', async () => {
    const storage = memStorage();
    const { api, ledger, calls } = fakeApi();
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    let slow = true;
    const gated: RunCreditApi = { ...api, claim: async (b, k) => (slow ? gate.then(() => api.claim(b, k)) : api.claim(b, k)) };
    const { q, meta } = queue(storage, gated);
    q.setUser('u1');
    q.claim({ userId: 'u1', runKey: 'a', lease: 'l', reason: 'died', stats }); // on its way (slowly)...
    q.setUser('u2'); // ...when u2 signs in
    slow = false;
    q.claim({ userId: 'u2', runKey: 'b', lease: 'l', reason: 'died', stats });
    await new Promise((r) => setTimeout(r, 5));
    expect(calls).toEqual([]); // a hasn't reached the fake yet; b waits: one request at a time
    open();
    await q.idle();
    expect(calls).toEqual(['claim:a', 'claim:b']); // b went out once a settled
    expect(ledger.map((c) => c.runKey)).toEqual(['a', 'b']);
    expect(meta.data.creditedRuns).toEqual(['b']); // a's answer was nobody's to apply...
    expect(claimsIn(storage).map((c) => [c.userId, c.runKey])).toEqual([['u1', 'a']]); // ...so a is still queued for u1
    q.setUser('u1');
    await q.idle();
    expect(calls).toEqual(['claim:a', 'claim:b', 'claim:a']); // sent again: the server returns the same row
    expect(meta.data.creditedRuns).toEqual(['b', 'a']);
    expect(ledger).toHaveLength(2);
  });

  it('a 200 whose row this build can’t read credits the Run from the claim’s own stats, and doesn’t block the queue', async () => {
    const storage = memStorage();
    const { api, calls } = fakeApi();
    const odd: RunCreditApi = { ...api, claim: async (b, k) => (b.runKey === 'odd' ? { ok: true, credit: null, created: true } : api.claim(b, k)) };
    const { q, meta, outcomes } = queue(storage, odd);
    q.setUser('u1');
    q.claim({ userId: 'u1', runKey: 'odd', lease: 'l', reason: 'victory', stats, at: 1 });
    q.claim({ userId: 'u1', runKey: 'next', lease: 'l', reason: 'died', stats, at: 2 });
    await q.idle();
    expect(claimsIn(storage)).toEqual([]);
    expect(calls).toEqual(['claim:next']); // (the odd one never reached the fake)
    expect(meta.data.creditedRuns).toEqual(['odd', 'next']);
    expect(meta.data.stats.wins).toBe(1);
    expect(outcomes.map((o) => [o.runKey, !!o.award])).toEqual([['odd', true], ['next', true]]);
  });

  it('409 run_ended: already credited by a client from before the ledger; the claim is dropped, nothing applied, never retried', async () => {
    const storage = memStorage();
    const { api } = fakeApi();
    const calls: string[] = [];
    const ended: RunCreditApi = { ...api, claim: async (b) => (calls.push(`claim:${b.runKey}`), { ok: false, reason: 'runEnded' }) };
    const { q, meta, outcomes } = queue(storage, ended);
    q.setUser('u1');
    q.claim({ userId: 'u1', runKey: 'old', lease: 'l', reason: 'died', stats });
    await q.idle();
    q.replay();
    await q.idle();
    expect(calls).toEqual(['claim:old']);
    expect(claimsIn(storage)).toEqual([]);
    expect(outcomes).toEqual([{ runKey: 'old', reason: 'died', fluff: 0, award: null, refused: 'elsewhere' }]);
    expect(meta.data).toMatchObject({ fluff: 0, creditedRuns: [], stats: { runs: 0 } });
  });

  it('409 carried_on: another device holds the Run; the claim is dropped, nothing is lost, and the sweep brings the row once the holder ends it', async () => {
    const storage = memStorage();
    const { api, ledger, state, calls } = fakeApi();
    state.refuse = true;
    const { q, meta, outcomes } = queue(storage, api);
    q.setUser('u1');
    q.claim({ userId: 'u1', runKey: 'r', lease: 'stale', reason: 'died', stats });
    await q.idle();
    expect(claimsIn(storage)).toEqual([]);
    expect(outcomes).toEqual([{ runKey: 'r', reason: 'died', fluff: 0, award: null, refused: 'carriedOn' }]);
    expect(meta.data.creditedRuns).toEqual([]);
    // The holder ends it: the ledger has the row, and the sweep applies it here, once.
    state.refuse = false;
    ledger.push({ id: 1, runKey: 'r', reason: 'victory', stats, creditedAt: '' });
    await q.sweep();
    await q.sweep();
    expect(meta.data.creditedRuns).toEqual(['r']);
    expect(meta.data.stats).toMatchObject({ runs: 1, wins: 1 });
    expect(calls.filter((c) => c.startsWith('claim'))).toHaveLength(1);
  });

  it('a 400 is a bug on this side: surfaced, dropped, and never a 0-Fluff credit', async () => {
    const storage = memStorage();
    const { api, state } = fakeApi();
    state.reject = true;
    const errors: unknown[] = [];
    const orig = console.error;
    console.error = (...args: unknown[]) => void errors.push(args[0]);
    try {
      const { q, meta, outcomes } = queue(storage, api);
      q.setUser('u1');
      q.claim({ userId: 'u1', runKey: 'bad', lease: 'l', reason: 'died', stats });
      await q.idle();
      expect(errors).toHaveLength(1);
      expect(String(errors[0])).toContain('bad');
      expect(outcomes).toEqual([{ runKey: 'bad', reason: 'died', fluff: 0, award: null, refused: 'rejected' }]); // settled, so the results screen and the leaderboard post don't wait forever
      expect(meta.data).toMatchObject({ fluff: 0, creditedRuns: [], stats: { runs: 0 } });
    } finally {
      console.error = orig;
    }
  });

  it('the sweep leaves a row for a Run this device’s own claim is out for to that claim, which is the one that counts a Universe', async () => {
    const storage = memStorage();
    const { api, ledger, calls } = fakeApi();
    const win = { maxRadius: 10, debrisAbsorbed: 100, tierReached: 9, area: 'universe' };
    let down = true;
    const flaky: RunCreditApi = {
      ...api,
      claim: async (b, k) => {
        if (down) throw new SavedRunNetError('offline');
        return api.claim(b, k);
      },
    };
    const { q, meta } = queue(storage, flaky);
    q.setUser('u1');
    // The Run's row is already in the ledger (the answer to this claim was lost, say): the claim is still waiting.
    ledger.push({ id: 1, runKey: 'v', reason: 'victory', stats: win, creditedAt: '' });
    q.claim({ userId: 'u1', runKey: 'v', lease: 'l', reason: 'victory', stats: win });
    await q.idle();
    await q.sweep();
    expect(calls).toContain('list');
    expect(meta.data.creditedRuns).toEqual([]); // skipped: the claim's answer is coming
    down = false;
    q.replay();
    await q.idle();
    expect(meta.data).toMatchObject({ creditedRuns: ['v'], universes: 1 });
    await q.sweep();
    expect(meta.data.universes).toBe(1);
  });
});

describe('RunCreditQueue: the second review round (docs/adr/0003)', () => {
  const events = () => {
    const listeners = new Set<(e: { key: string | null }) => void>();
    return {
      addEventListener: (_t: 'storage', fn: (e: { key: string | null }) => void) => void listeners.add(fn),
      removeEventListener: (_t: 'storage', fn: (e: { key: string | null }) => void) => void listeners.delete(fn),
      fire: (key: string | null = RUN_CREDITS_KEY) => listeners.forEach((fn) => fn({ key })),
    };
  };
  /** Two tabs of one device: one storage, one progress copy, one event bus; `a` can't reach the server. */
  const tabs = (api: RunCreditApi) => {
    const storage = memStorage();
    const bus = events();
    const metaA = new MetaProgress(storage);
    const metaB = new MetaProgress(storage);
    const offline: RunCreditApi = { ...api, claim: async () => Promise.reject(new SavedRunNetError('offline')) };
    const a = new RunCreditQueue({ api: offline, storage, events: bus, meta: metaA, retryMs: 1000, maxRetryMs: 1000 });
    const b = new RunCreditQueue({ api, storage, events: bus, meta: metaB, retryMs: 1, maxRetryMs: 4 });
    const heardA: CreditOutcome[] = [];
    a.onCredit((o) => void heardA.push(o));
    return { storage, bus, a, b, metaA, metaB, heardA };
  };

  it('a claim settled in another tab is announced here as already credited, once, with the Fluff it was worth', async () => {
    const { api } = fakeApi();
    const { bus, a, b, metaA, metaB, heardA } = tabs(api);
    a.setUser('u1');
    a.claim({ userId: 'u1', runKey: 'r', lease: 'l', reason: 'victory', stats });
    await a.idle();
    expect(a.has('r')).toBe(true); // waiting, with a backoff
    expect(heardA).toEqual([]);
    b.setUser('u1'); // the other tab replays it and applies the answer to the shared copy
    await b.idle();
    expect(metaB.data.creditedRuns).toEqual(['r']);
    bus.fire();
    expect(a.has('r')).toBe(false);
    expect(heardA).toEqual([{ runKey: 'r', reason: 'victory', fluff: expect.any(Number), award: null, already: true }]);
    expect(heardA[0]!.fluff).toBeGreaterThan(0);
    metaA.store.refresh(); // (the browser's `storage` event for the save does this)
    expect(metaA.data.creditedRuns).toEqual(['r']); // the shared copy holds it once
    bus.fire();
    bus.fire(null);
    expect(heardA).toHaveLength(1); // announced once
  });

  it('a refusal in another tab reaches here too; a key alone (no record) is read from the copy', async () => {
    const { api } = fakeApi();
    const refusing: RunCreditApi = { ...api, claim: async () => ({ ok: false, reason: 'carriedOn' }) };
    const { bus, a, b, heardA, storage, metaA, metaB } = tabs(refusing);
    a.setUser('u1');
    a.claim({ userId: 'u1', runKey: 'gone', lease: 'l', reason: 'died', stats });
    a.claim({ userId: 'u1', runKey: 'applied', lease: 'l', reason: 'quit', stats });
    await a.idle();
    b.setUser('u1');
    await b.idle();
    bus.fire();
    expect(heardA).toEqual([
      { runKey: 'gone', reason: 'died', fluff: 0, award: null, refused: 'carriedOn' },
      { runKey: 'applied', reason: 'quit', fluff: 0, award: null, refused: 'carriedOn' },
    ]);
    // A tab of another build settled a claim without leaving a record: the claim is gone and the copy holds the key, so it landed.
    a.claim({ userId: 'u1', runKey: 'silent', lease: 'l', reason: 'died', stats });
    await a.idle();
    metaB.awardRun({ runKey: 'silent', reason: 'died', stats });
    const file = JSON.parse(storage.map.get(RUN_CREDITS_KEY)!) as { claims: PendingClaim[]; settled: unknown[] };
    storage.setItem(RUN_CREDITS_KEY, JSON.stringify({ ...file, claims: file.claims.filter((c) => c.runKey !== 'silent') }));
    metaA.store.refresh(); // the save's own `storage` event lands first in the browser
    bus.fire();
    expect(heardA.at(-1)).toEqual({ runKey: 'silent', reason: 'died', fluff: 0, award: null, already: true });
  });

  it('a claim marked local (credited before it went out) counts no second Universe from its answer', async () => {
    const storage = memStorage();
    const { api } = fakeApi();
    const { q, meta } = queue(storage, api);
    q.setUser('u1');
    const win = { runKey: 'w', reason: 'victory' as const, stats: { ...stats, area: 'universe' } };
    expect(meta.awardRun(win)).toMatchObject({ universes: 1 });
    meta.store.update((d) => meta.adoptCreditedRuns(d, [], false)); // an adopt dropped the key; the count was max-merged
    q.claim({ userId: 'u1', ...win, lease: 'l', local: true });
    await q.idle();
    expect(meta.data.creditedRuns).toEqual(['w']);
    expect(meta.data.stats.wins).toBe(2); // the row's stats and Fluff are applied again (the adopted copy lacked them)...
    expect(meta.universes).toBe(1); // ...the Universe is not
  });

  it('while the copy’s set is unknown (an old build rewrote the save) the sweep holds off, and only a row created by this claim is applied', async () => {
    const storage = memStorage();
    const { api, ledger, calls } = fakeApi();
    const first = new MetaProgress(storage);
    first.awardRun({ runKey: 'mine', reason: 'died', stats }); // this device's own credit (the mirror knows it)
    ledger.push({ id: 1, runKey: 'mine', reason: 'died', stats, creditedAt: '' }, { id: 2, runKey: 'K2', reason: 'died', stats, creditedAt: '' });
    // An old-build tab adopted a cloud copy holding K2's Fluff and rewrote the save without `creditedRuns`.
    const raw = JSON.parse(storage.map.get(SAVE_KEY)!) as Record<string, unknown>;
    delete raw.creditedRuns;
    raw.fluff = 66;
    storage.setItem(SAVE_KEY, JSON.stringify(raw));
    const { q, meta } = queue(storage, api, new MetaProgress(storage));
    q.setUser('u1');
    expect(meta.creditedRunsKnown()).toBe(false);
    expect(meta.data.creditedRuns).toEqual(['mine']); // repaired from the mirror; K2 is what it can't know
    await q.sweep();
    expect(calls).toEqual([]); // not even fetched
    expect(meta.data.fluff).toBe(66);
    // A claim for a Run already in the ledger is answered from its row: not applied while the set is unknown, but settled.
    const outcomes: CreditOutcome[] = [];
    q.onCredit((o) => void outcomes.push(o));
    q.claim({ userId: 'u1', runKey: 'K2', lease: 'l', reason: 'died', stats });
    await q.idle();
    expect(meta.data.fluff).toBe(66);
    expect(outcomes).toEqual([expect.objectContaining({ runKey: 'K2', award: null, already: true })]);
    // One the server creates for this claim is this copy's to apply.
    q.claim({ userId: 'u1', runKey: 'fresh', lease: 'l', reason: 'died', stats });
    await q.idle();
    expect(meta.data.creditedRuns).toEqual(['mine', 'fresh']);
    expect(meta.data.fluff).toBeGreaterThan(66);
    // A cloud adopt of a copy that carries the set restores a known one: the sweep runs again and applies what the copy lacks.
    meta.store.update((d) => meta.adoptCreditedRuns(d, ['mine', 'fresh'], false));
    expect(meta.creditedRunsKnown()).toBe(true);
    const before = meta.data.fluff;
    await q.sweep();
    expect(calls.filter((c) => c === 'list')).toEqual(['list']);
    expect(meta.data.creditedRuns).toEqual(['mine', 'fresh', 'K2']);
    expect(meta.data.fluff).toBeGreaterThan(before);
  });
});
