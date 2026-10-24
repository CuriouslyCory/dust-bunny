/**
 * The Account's Run rules (server/accountRuns.ts, docs/adr/0002, docs/adr/0003) over the in-memory
 * store: no database needed. server/api.test.ts runs the same rules through the handlers against
 * Postgres (with TEST_DATABASE_URL).
 */
import { describe, expect, it } from 'vitest';
import type { CreditStats } from '../src/shared/runCredit';
import { SNAPSHOT_VERSION } from '../src/shared/savedRun';
import { CREDIT_KEEP, CREDIT_RATE_LIMIT, createAccountRuns, HOLDER_KEEP, HOLDER_RETENTION_DAYS } from './accountRuns';
import { MemoryAccountRunStore } from './accountRunsMemory';

const U = 'user-1';
const STATS: CreditStats = { maxRadius: 12, debrisAbsorbed: 30, tierReached: 2 };

const snap = (runKey: string, extra: Record<string, unknown> = {}) => ({ version: SNAPSHOT_VERSION, runKey, stats: { ...STATS, characterId: 'zap' }, ...extra });

function setup() {
  const clock = { now: Date.UTC(2026, 0, 1) };
  const store = new MemoryAccountRunStore({ now: () => clock.now });
  const runs = createAccountRuns(store, { now: () => clock.now });
  const put = (runKey: string, lease: string, more: { prevLease?: string; ledger?: boolean; version?: number; snapshot?: Record<string, unknown> } = {}) =>
    runs.store(U, { runKey, lease, snapshot: more.snapshot ?? snap(runKey), version: more.version ?? SNAPSHOT_VERSION, ledger: more.ledger ?? true, ...(more.prevLease ? { prevLease: more.prevLease } : {}) });
  const claim = (runKey: string, lease: string, prevLease?: string) => runs.claim(U, { runKey, lease, ...(prevLease ? { prevLease } : {}), reason: 'died', stats: STATS });
  /** Everything the store holds for the Account, to check a refusal wrote nothing. */
  const state = () => ({ slot: store.slotOf(U), holders: store.holdersOf(U), credits: store.creditsOf(U) });
  return { clock, store, runs, put, claim, state };
}

describe('store (PUT /api/saved-run)', () => {
  it('stores a Run, which the Account then shows; the same Run again under its lease or prevLease', async () => {
    const { runs, put } = setup();
    expect(await put('r', 'a1')).toEqual({ ok: true, replaced: null, credits: [] });
    expect(await runs.savedRun(U)).toMatchObject({ runKey: 'r', lease: 'a1', version: SNAPSHOT_VERSION, snapshot: { runKey: 'r' } });
    expect(await put('r', 'a2', { prevLease: 'a1' })).toMatchObject({ ok: true, replaced: null });
    expect(await runs.savedRun(U)).toMatchObject({ lease: 'a2' });
  });

  it('refuses the same Run under another lease (carried_on) and writes nothing', async () => {
    const { put, state } = setup();
    await put('r', 'a1');
    const before = state();
    expect(await put('r', 'b1')).toEqual({ ok: false, reason: 'carried_on' });
    expect(state()).toEqual(before);
  });

  it('replaces a different Run: returned, recorded in the ledger as a quit with its stats (ledger clients), its holder record ended', async () => {
    const { put, store, claim } = setup();
    await put('old', 'x');
    const res = await put('new', 'y');
    expect(res).toMatchObject({ ok: true, replaced: { runKey: 'old', snapshot: { runKey: 'old' } }, credits: [{ runKey: 'old', reason: 'quit', stats: STATS }] });
    expect(store.holdersOf(U).old).toEqual({ lease: 'x', ended: true });
    // A claim for it is answered from that row.
    expect(await claim('old', 'x')).toMatchObject({ ok: true, created: false, credit: { runKey: 'old', reason: 'quit' } });
  });

  it('salvages a replaced copy’s stats that don’t read whole', async () => {
    const { put } = setup();
    await put('old', 'x', { snapshot: snap('old', { stats: { maxRadius: 'big', debrisAbsorbed: 4, tierReached: 1 } }) });
    expect(await put('new', 'y')).toMatchObject({ credits: [{ runKey: 'old', stats: { maxRadius: 0, debrisAbsorbed: 4, tierReached: 1 } }] });
  });

  it('without ledger: the caller credits `replaced`, so the ledger gets no row, and a later claim for it is run_ended', async () => {
    const { put, store, claim } = setup();
    await put('old', 'x', { ledger: false });
    expect(await put('new', 'y', { ledger: false })).toMatchObject({ ok: true, replaced: { runKey: 'old' }, credits: [] });
    expect(store.creditsOf(U)).toEqual([]);
    expect(await claim('old', 'x')).toEqual({ ok: false, reason: 'run_ended' });
  });

  it('never replaces a newer build’s Run (newer_saved_run), and stores one as it is', async () => {
    const { put, runs, state } = setup();
    const newer = snap('newer', { version: SNAPSHOT_VERSION + 1, somethingNew: { a: 1 } });
    expect(await put('newer', 'z', { snapshot: newer, version: SNAPSHOT_VERSION + 1 })).toMatchObject({ ok: true });
    const before = state();
    expect(await put('other', 'w')).toEqual({ ok: false, reason: 'newer_saved_run' });
    expect(state()).toEqual(before);
    expect((await runs.savedRun(U))?.snapshot).toEqual(newer);
  });

  it('refuses a Run in the ledger (run_ended), whatever the slot holds now', async () => {
    const { put, claim } = setup();
    await put('r', 'a1');
    expect(await claim('r', 'a1')).toMatchObject({ ok: true, created: true });
    await put('s', 'b1'); // another Run since
    expect(await put('r', 'a1')).toEqual({ ok: false, reason: 'run_ended' });
  });

  it('checks the Run’s own holder record: another device took it, then a new Run replaced it in the slot', async () => {
    const { put, runs } = setup();
    await put('r', 'a1');
    expect(await runs.take(U, { runKey: 'r', lease: 'a1', newLease: 'b1' })).toMatchObject({ ok: true });
    await put('s', 'c1'); // the slot no longer shows R
    expect(await put('r', 'a1')).toEqual({ ok: false, reason: 'carried_on' }); // B holds R
    expect(await put('r', 'b1')).toMatchObject({ ok: true }); // B stores it again
  });

  it('refuses a late upload of a Run that ended (its slot row, from before holder records)', async () => {
    const { put, runs } = setup();
    await put('r', 'a1');
    expect(await runs.end(U, { runKey: 'r', lease: 'a1' })).toMatchObject({ deleted: true });
    expect(await runs.savedRun(U)).toBeNull();
    expect(await put('r', 'a1')).toEqual({ ok: false, reason: 'run_ended' });
  });
});

describe('take (POST /api/saved-run)', () => {
  it('hands the snapshot to one taker; a retry of the winning take succeeds; the other is refused with the slot', async () => {
    const { put, runs, store } = setup();
    await put('r', 'a1');
    expect(await runs.take(U, { runKey: 'r', lease: 'a1', newLease: 'b1' })).toEqual({ ok: true, snapshot: snap('r'), version: SNAPSHOT_VERSION });
    expect(store.holdersOf(U).r).toEqual({ lease: 'b1', ended: false });
    expect(await runs.take(U, { runKey: 'r', lease: 'a1', newLease: 'b1' })).toEqual({ ok: true, snapshot: null, version: null });
    const refused = await runs.take(U, { runKey: 'r', lease: 'a1', newLease: 'c1' });
    expect(refused).toMatchObject({ ok: false, reason: 'carried_on', savedRun: { runKey: 'r', lease: 'b1', snapshot: null, version: null } });
    expect(await runs.savedRun(U)).toMatchObject({ runKey: 'r', lease: 'b1', snapshot: null });
  });

  it('refuses an ended Run (with its key and no snapshot), a Run in the ledger, and an empty Account', async () => {
    const { put, runs, claim, state } = setup();
    expect(await runs.take(U, { runKey: 'r', lease: 'a1', newLease: 'b1' })).toEqual({ ok: false, reason: 'carried_on', savedRun: null });
    await put('r', 'a1');
    await claim('r', 'a1');
    const before = state();
    expect(await runs.take(U, { runKey: 'r', lease: 'a1', newLease: 'b1' })).toMatchObject({ ok: false, reason: 'carried_on', savedRun: { runKey: 'r', snapshot: null } });
    expect(state()).toEqual(before);
  });
});

describe('end (DELETE /api/saved-run)', () => {
  it('ends the Run held under the caller’s lease (or prevLease): the snapshot comes back, the row stays ended', async () => {
    const { put, runs, store } = setup();
    await put('r', 'a1');
    expect(await runs.end(U, { runKey: 'r', lease: 'a2', prevLease: 'a1' })).toEqual({ ok: true, deleted: true, snapshot: snap('r') });
    expect(store.slotOf(U)).toMatchObject({ runKey: 'r', ended: true, snapshot: null });
    expect(store.holdersOf(U).r).toEqual({ lease: 'a2', ended: true });
  });

  it('a Run the caller holds by its record is theirs to end after another Run replaced it in the slot', async () => {
    const { put, runs, store } = setup();
    await put('r', 'a1');
    await runs.take(U, { runKey: 'r', lease: 'a1', newLease: 'a2' });
    await put('s', 'c1');
    expect(await runs.end(U, { runKey: 'r', lease: 'a2' })).toEqual({ ok: true, deleted: true, snapshot: null });
    expect(store.slotOf(U)).toMatchObject({ runKey: 's', ended: false }); // the slot's Run is left alone
  });

  it('records a Run abandoned before its upload arrived as ended, without touching a Run still going', async () => {
    const { put, runs } = setup();
    expect(await runs.end(U, { runKey: 'early', lease: 'a1' })).toEqual({ ok: true, deleted: false, snapshot: null });
    expect(await runs.savedRun(U)).toBeNull();
    expect(await put('early', 'a1')).toEqual({ ok: false, reason: 'run_ended' });
    await put('kept', 'b1');
    expect(await runs.end(U, { runKey: 'other', lease: 'a1' })).toMatchObject({ deleted: false });
    expect(await runs.savedRun(U)).toMatchObject({ runKey: 'kept', lease: 'b1' });
  });
});

describe('claim (POST /api/run-credit)', () => {
  it('credits the holder once, marks the slot ended, and gives every later claim the same row', async () => {
    const { put, claim, runs, store } = setup();
    await put('r', 'a1');
    const first = await claim('r', 'a1');
    expect(first).toMatchObject({ ok: true, created: true, credit: { runKey: 'r', reason: 'died', stats: STATS } });
    expect(store.slotOf(U)).toMatchObject({ runKey: 'r', ended: true, snapshot: null });
    expect(store.holdersOf(U).r).toEqual({ lease: 'a1', ended: true });
    expect(await claim('r', 'a1')).toEqual({ ...first, created: false });
    expect(await claim('r', 'someone-else')).toEqual({ ...first, created: false });
    expect(await runs.credits(U, 20)).toHaveLength(1);
  });

  it('credits a Run the server never saw, and remembers it as ended without touching a Run still going', async () => {
    const { put, claim, store } = setup();
    expect(await claim('fresh', 'f1')).toMatchObject({ ok: true, created: true });
    expect(store.slotOf(U)).toMatchObject({ runKey: 'fresh', ended: true });
    expect(await put('fresh', 'f1')).toEqual({ ok: false, reason: 'run_ended' });
    await put('going', 'g1');
    expect(await claim('another', 'x1')).toMatchObject({ ok: true, created: true });
    expect(store.slotOf(U)).toMatchObject({ runKey: 'going', ended: false, snapshot: { runKey: 'going' } });
  });

  it('refuses a claim for a Run another device holds (carried_on): in the slot, or by its holder record after a replace', async () => {
    const { put, claim, runs, state } = setup();
    await put('r', 'a1');
    expect(await claim('r', 'b1')).toEqual({ ok: false, reason: 'carried_on' });
    await runs.take(U, { runKey: 'r', lease: 'a1', newLease: 'b1' }); // B plays R...
    await put('y', 'c1'); // ...when C's new Run replaces it in the slot
    const before = state();
    expect(await claim('r', 'a2', 'a1')).toEqual({ ok: false, reason: 'carried_on' }); // A's stale claim
    expect(state()).toEqual(before);
    expect(await claim('r', 'b1')).toMatchObject({ ok: true, created: true }); // B's is credited
  });

  it('refuses a Run a client from before the ledger ended and credited itself (run_ended), for good', async () => {
    const { put, claim, runs } = setup();
    await put('r', 'a1');
    await runs.end(U, { runKey: 'r', lease: 'a1' });
    expect(await claim('r', 'a1')).toEqual({ ok: false, reason: 'run_ended' });
    for (let i = 0; i < 3; i++) await put(`next-${i}`, 'n');
    expect(await claim('r', 'a1')).toEqual({ ok: false, reason: 'run_ended' });
  });

  it('accepts the lease before a take the device never heard back from (prevLease)', async () => {
    const { put, claim } = setup();
    await put('r', 'a1');
    expect(await claim('r', 'a2', 'a1')).toMatchObject({ ok: true, created: true });
  });

  it('rate-limits new rows per Account (with the wait), writes nothing when it does, and still answers a Run already in the ledger', async () => {
    const { clock, claim, state } = setup();
    for (let i = 0; i < CREDIT_RATE_LIMIT.max; i++) {
      expect(await claim(`r${i}`, 'l')).toMatchObject({ ok: true, created: true });
      clock.now += 1000;
    }
    const before = state();
    expect(await claim('one-more', 'l')).toEqual({ ok: false, reason: 'rate_limited', retryAfterSec: CREDIT_RATE_LIMIT.windowSec - CREDIT_RATE_LIMIT.max });
    expect(state()).toEqual(before);
    expect(await claim('r0', 'l')).toMatchObject({ ok: true, created: false });
    clock.now += (CREDIT_RATE_LIMIT.windowSec - CREDIT_RATE_LIMIT.max) * 1000;
    expect(await claim('one-more', 'l')).toMatchObject({ ok: true, created: true });
  });

  it('keeps the newest CREDIT_KEEP ledger rows per Account', async () => {
    const { clock, claim, runs, store } = setup();
    for (let i = 0; i <= CREDIT_KEEP; i++) {
      await claim(`k${i}`, 'l');
      clock.now += CREDIT_RATE_LIMIT.windowSec * 1000; // past the rate limit
    }
    const keys = store.creditsOf(U).map((c) => c.runKey);
    expect(keys).toHaveLength(CREDIT_KEEP);
    expect(keys[0]).toBe('k1');
    expect((await runs.credits(U, 2)).map((c) => c.runKey)).toEqual([`k${CREDIT_KEEP}`, `k${CREDIT_KEEP - 1}`]);
  });

  it('prunes holder records past HOLDER_RETENTION_DAYS, and past the newest HOLDER_KEEP', async () => {
    const { clock, claim, store } = setup();
    await claim('stale', 's');
    clock.now += (HOLDER_RETENTION_DAYS + 1) * 86_400_000;
    await claim('h1', 'l1');
    expect(Object.keys(store.holdersOf(U))).toEqual(['h1']);
    for (let i = 0; i < HOLDER_KEEP; i++) {
      clock.now += CREDIT_RATE_LIMIT.windowSec * 1000;
      await claim(`h-${i}`, 'l');
    }
    const holders = Object.keys(store.holdersOf(U));
    expect(holders).toHaveLength(HOLDER_KEEP);
    expect(holders).not.toContain('h1');
  });
});

describe('the Account lock', () => {
  it('a store and a claim for the same Run sent together decide one after the other: never both credited and resumable', async () => {
    for (const order of ['store-first', 'claim-first'] as const) {
      const { runs, put, claim } = setup();
      const [a, b] = order === 'store-first' ? await Promise.all([put('r', 'a1'), claim('r', 'a1')]) : (await Promise.all([claim('r', 'a1'), put('r', 'a1')])).reverse();
      expect(b).toMatchObject({ ok: true, created: true });
      expect(a.ok).toBe(order === 'store-first');
      expect(await runs.savedRun(U)).toBeNull();
    }
  });

  it('Accounts are separate', async () => {
    const { runs, put } = setup();
    await put('r', 'a1');
    expect(await runs.savedRun('user-2')).toBeNull();
    expect(await runs.claim('user-2', { runKey: 'r', lease: 'x', reason: 'quit', stats: STATS })).toMatchObject({ ok: true, created: true });
    expect(await runs.savedRun(U)).toMatchObject({ runKey: 'r' });
  });

  it('a write that throws leaves nothing behind (the in-memory store’s transaction)', async () => {
    const { store, runs, put } = setup();
    await put('r', 'a1');
    const before = store.slotOf(U);
    await expect(
      store.write(U, async (rows) => {
        await rows.writeSlot({ runKey: 'x', lease: 'x', snapshot: null, version: null, ended: true });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(store.slotOf(U)).toEqual(before);
    expect(await runs.savedRun(U)).toMatchObject({ runKey: 'r' });
  });
});
