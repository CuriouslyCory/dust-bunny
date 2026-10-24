/** The Run credit ledger's claim queue (src/meta/runCredits.ts, docs/adr/0003): durable, per Account, replayed. */
import { describe, expect, it } from 'vitest';
import type { RunCredit } from '../shared/runCredit';
import { SavedRunAuthError, SavedRunNetError } from './accountHttp';
import { MetaProgress } from './meta';
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
    expect(outcomes).toEqual([]);
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
