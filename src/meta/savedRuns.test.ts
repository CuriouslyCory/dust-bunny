/**
 * The Account's saved Run (src/meta/savedRuns.ts) and its credit (src/meta/runCredits.ts,
 * docs/adr/0003): two devices (each its own storage, slot and progress copy), one server: the real
 * rules (server/accountRuns.ts) over the in-memory store, behind a simulated network (`TestServer`).
 */
import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/events';
import { createRun } from '../game/assembly';
import { RunHandoff, type HandoffLoss } from '../game/handoff';
import { SNAPSHOT_VERSION, type RunSnapshot } from '../game/snapshot';
import { CREDITED_RUNS_MAX, pickCreditStats, RUN_CREDIT_LIST_LIMIT } from '../shared/runCredit';
import { SavedRuns, creditStatsOf, KNOWN_RUNS_KEY, KNOWN_RUNS_VERSION } from './savedRuns';
import { MetaProgress, type RunCreditInput } from './meta';
import { RUN_CREDITS_KEY, type CreditOutcome } from './runCredits';
import { SUSPENDED_RUN_KEY } from './suspendedRun';
import { fakeEvents, memStorage, TestServer, USER, type Link } from './savedRunsTestServer';

const snapshot = (seed = 'acct'): RunSnapshot => {
  const run = createRun(new EventBus(), { seed, characterId: 'zap' });
  for (let i = 0; i < 30; i++) run.update(1 / 60);
  return run.toSnapshot();
};

/** A device: its own storage, saved Run and progress copy, signed in as `user`. `tab`: another tab of a device (shares its storage and hears its `storage` events). */
const device = (server: TestServer, user: string | null = 'u1', tab?: { storage: ReturnType<typeof memStorage>; events: ReturnType<typeof fakeEvents> }) => {
  const storage = tab?.storage ?? memStorage();
  const meta = new MetaProgress(storage);
  const link: Link = { offline: false, user };
  const runs = new SavedRuns({ storage, meta, ...server.client(link), events: tab?.events ?? null, locks: null, retryMs: 1, maxRetryMs: 4, hidden: () => false });
  const outcomes: CreditOutcome[] = [];
  runs.credits.onCredit((o) => void outcomes.push(o));
  runs.onUser((u) => void (link.user = u)); // the session cookie follows the Account
  runs.setUser(user);
  const lostRuns: string[] = [];
  runs.onLost((k) => void lostRuns.push(k));
  const lost: HandoffLoss[] = [];
  const handoff = new RunHandoff({ runs, onLost: (why) => void lost.push(why) });
  /** The Run keys this device's progress copy holds the credit for. */
  const credited = () => meta.data.creditedRuns;
  /** `runEnded` on this device, as src/meta/install.ts routes it. */
  const end = (s: RunSnapshot, reason: RunCreditInput['reason'] = 'died') => runs.ended({ runKey: s.runKey, reason, stats: s.stats });
  /** Save & quit on this device (the Run in progress, not paused). */
  const saveAndQuit = (s: RunSnapshot) => runs.save(s);
  return { storage, store: runs.slot, meta, runs, credits: runs.credits, handoff, lost, lostRuns, link, outcomes, credited, end, saveAndQuit };
};

/** Lets queued server work (uploads, takes, claims, the sweep) and its retries run. */
async function settle(...runs: SavedRuns[]): Promise<void> {
  for (let i = 0; i < 200 && runs.some((r) => r.pending > 0 || r.credits.pending > 0); i++) await new Promise((r) => setTimeout(r, 2));
  await Promise.all(runs.map((r) => r.credits.idle()));
  await new Promise((r) => setTimeout(r, 0));
}

/** Device `d`'s title: sync with the Account, then Resume run on what it shows. */
async function resumeOn(d: ReturnType<typeof device>) {
  await d.runs.syncTitle();
  const shown = d.store.peek();
  if (!shown) return { res: 'none' as const, resumed: [] as RunSnapshot[] };
  const resumed: RunSnapshot[] = [];
  const res = await d.runs.resume(shown.runKey, (s) => void resumed.push(s));
  return { res, resumed };
}

describe('Account saved Run (two devices, one server)', () => {
  it('pause on A uploads it; B offers it from another device and takes it', async () => {
    const server = new TestServer();
    const a = device(server);
    const b = device(server);
    const s = snapshot();
    a.handoff.store(s, 'pause');
    await settle(a.runs);
    expect(server.row).toMatchObject({ runKey: s.runKey, version: SNAPSHOT_VERSION });
    expect(server.row?.snapshot).not.toHaveProperty('account'); // the device-only tag stays on the device
    expect((await a.runs.syncTitle()).fromAccount).toBeNull(); // A's own copy, confirmed: nothing to mirror or upload
    expect(server.calls.filter((c) => c === 'put')).toHaveLength(1);

    expect((await b.runs.syncTitle()).fromAccount).toBe(s.runKey);
    expect(b.store.peek()?.runKey).toBe(s.runKey);
    const { res, resumed } = await resumeOn(b);
    expect(res).toBe('mine');
    expect(resumed[0]?.runKey).toBe(s.runKey);
    expect(b.store.peek()).toBeNull();
    expect(server.row).toMatchObject({ runKey: s.runKey, snapshot: null });
  });

  it('unpausing on A is not delayed by the server; told B has the Run, A steps aside uncredited', async () => {
    const server = new TestServer();
    const a = device(server);
    const b = device(server);
    const s = snapshot();
    a.handoff.store(s, 'pause');
    await settle(a.runs);
    expect((await resumeOn(b)).res).toBe('mine');

    // A's device slot still holds its copy (B is another device), so the local take back says "mine" at once...
    let open!: () => void;
    server.gate = new Promise((r) => (open = r));
    expect(await a.handoff.takeBack()).toBe(true);
    expect(a.lost).toEqual([]);
    expect(server.calls.at(-1)).toBe('take'); // sent, not waited for
    // ...and only once the server answers does A learn that B has it.
    await new Promise((r) => setTimeout(r, 10));
    expect(a.lostRuns).toEqual([]);
    server.gate = null;
    open();
    await settle(a.runs);
    expect(a.lostRuns).toEqual([s.runKey]);
    expect(a.credited()).toEqual([]);
    expect(b.credited()).toEqual([]);
  });

  it('offline, A plays on and keeps retrying; once back, it learns B took the Run, and only B ends (and credits) it', async () => {
    const server = new TestServer();
    const a = device(server);
    const b = device(server);
    const s = snapshot();
    a.handoff.store(s, 'pause');
    await settle(a.runs);
    a.link.offline = true;
    expect(await a.handoff.takeBack()).toBe(true); // plays on at once
    await new Promise((r) => setTimeout(r, 20));
    expect(a.runs.pending).toBeGreaterThan(0); // still trying, with backoff
    expect(server.calls.filter((c) => c === 'take').length).toBeGreaterThan(1);
    expect((await resumeOn(b)).res).toBe('mine'); // B is online
    b.end(s); // B plays it to the end: the Account knows this Run, so the server's answer credits it there
    await settle(b.runs);
    expect(server.row).toMatchObject({ runKey: s.runKey, snapshot: null, ended: true });
    expect(server.ledger.map((c) => c.runKey)).toEqual([s.runKey]);
    expect(b.credited()).toEqual([s.runKey]);
    a.link.offline = false; // A reconnects
    await settle(a.runs);
    expect(a.lostRuns).toEqual([s.runKey]);
    // A's queue drained after a network error, so it swept: B's row lands in A's copy too (one credit per copy;
    // the cloud save's merge keeps one copy, key and Fluff together). The server credited the Run once.
    expect(a.credited()).toEqual([s.runKey]);
    expect(server.ledger).toHaveLength(1);
  });

  it('a later pause with a 409 (A fell behind) also makes A step aside', async () => {
    const server = new TestServer();
    const a = device(server);
    const s = snapshot();
    a.handoff.store(s, 'pause');
    await settle(a.runs);
    server.offline = true;
    expect(await a.handoff.takeBack()).toBe(true);
    server.offline = false;
    // B takes it before A's take gets through; A's take was superseded by its next pause's upload.
    expect(await server.runs.take(USER, { runKey: s.runKey, lease: server.row!.lease, newLease: 'b-lease' })).toMatchObject({ ok: true });
    a.handoff.store(structuredClone(s), 'pause');
    await settle(a.runs);
    expect(a.lostRuns).toEqual([s.runKey]);
    expect(a.store.peek()).toBeNull(); // A's stale copy is gone from its device
  });

  it('two devices racing to resume the same Run: exactly one gets it', async () => {
    const server = new TestServer();
    const a = device(server);
    a.handoff.store(snapshot(), 'pause');
    await settle(a.runs);
    a.handoff.forget();
    const b = device(server);
    const c = device(server);
    await b.runs.syncTitle();
    await c.runs.syncTitle();
    const results = await Promise.all([resumeOn(b), resumeOn(c)]);
    expect(results.map((r) => r.res).sort()).toEqual(['lost', 'mine']);
  });

  it('a newer build’s saved Run is left on the server and on the device, and the title says so', async () => {
    const server = new TestServer();
    const a = device(server);
    const newer = { ...snapshot(), version: SNAPSHOT_VERSION + 1, somethingNew: true };
    expect(await server.runs.store(USER, { runKey: newer.runKey, lease: 'other', snapshot: newer as unknown as Record<string, unknown>, version: SNAPSHOT_VERSION + 1, ledger: true })).toMatchObject({ ok: true });
    const view = await a.runs.syncTitle();
    expect(view.newerOnAccount).toBe(true);
    await settle(a.runs);
    expect(server.calls.filter((c) => c !== 'list')).toEqual(['get']); // no take, no upload (the ledger sweep is read-only)
    expect(a.store.peek()).toBeNull();

    // On the device: never overwritten or deleted by this build.
    const raw = JSON.stringify(newer);
    a.storage.setItem(SUSPENDED_RUN_KEY, raw);
    expect(a.store.newer).toBe(true);
    expect(a.store.peek()).toBeNull();
    const mine = snapshot('other');
    a.handoff.store(mine, 'pause');
    expect(a.storage.getItem(SUSPENDED_RUN_KEY)).toBe(raw);
    a.store.clear();
    expect(a.storage.getItem(SUSPENDED_RUN_KEY)).toBe(raw);
    // Its upload is refused (the Account's slot holds the newer Run): kept on this device only, not lost.
    await settle(a.runs);
    expect(server.row?.snapshot).toEqual(newer);
    expect(a.lostRuns).toEqual([]);
    expect(a.credited()).toEqual([]);
  });

  it('the server copy wins on the title; a different Run only this device had counts as quit, at once, and the claim records it', async () => {
    const server = new TestServer();
    const a = device(server);
    const remote = snapshot('remote');
    expect(await server.runs.store(USER, { runKey: remote.runKey, lease: 'l1', snapshot: remote as unknown as Record<string, unknown>, version: SNAPSHOT_VERSION, ledger: true })).toMatchObject({ ok: true });
    const local = snapshot('local');
    a.store.save(local); // saved before signing in: untagged, so the Account never saw it
    await a.runs.syncTitle();
    expect(a.credited()).toEqual([local.runKey]); // credited here, not deferred
    expect(a.store.peek()?.runKey).toBe(remote.runKey);
    await settle(a.runs);
    expect(server.ledger.map((c) => c.runKey)).toEqual([local.runKey]);
    expect(server.row?.runKey).toBe(remote.runKey); // the stored Run is left alone
    // Syncing again changes nothing and credits nothing.
    await a.runs.syncTitle();
    await settle(a.runs);
    expect(a.meta.data.stats.runs).toBe(1);
  });

  it('a Run only on this device is uploaded on the title; once confirmed and gone from the server, it is dropped uncredited', async () => {
    const server = new TestServer();
    const a = device(server);
    const local = snapshot('only-here');
    a.store.save(local);
    await a.runs.syncTitle();
    await settle(a.runs);
    expect(server.row?.runKey).toBe(local.runKey);
    await a.runs.syncTitle(); // confirmed now: synced again, it isn't uploaded again
    await settle(a.runs);
    expect(server.calls.filter((c) => c === 'put')).toHaveLength(1);
    // Resumed and ended elsewhere (by a client from before the ledger: no row, so nothing for the sweep).
    expect(await server.runs.take(USER, { runKey: local.runKey, lease: server.row!.lease, newLease: 'b-lease' })).toMatchObject({ ok: true });
    expect(await server.runs.end(USER, { runKey: local.runKey, lease: 'b-lease' })).toMatchObject({ deleted: true });
    await a.runs.syncTitle();
    await settle(a.runs);
    expect(a.store.peek()).toBeNull();
    expect(a.credited()).toEqual([]);
  });

  it('a Run that replaces another on the server credits the replaced one once, from the ledger row the upload returns', async () => {
    const server = new TestServer();
    // Two tabs of A's browser (one slot, one progress copy). Tab 2 started `second` while the slot was empty...
    const shared = { storage: memStorage(), events: fakeEvents() };
    const a = device(server, 'u1', shared);
    const a2 = device(server, 'u1', shared);
    expect(a2.runs.newRun()).toBe(false);
    // ...then tab 1 Save & quits `first`.
    const first = snapshot('first');
    a.handoff.store(first, 'pause');
    await settle(a.runs);
    a.handoff.forget();
    // The device slot holds `first`, an Account copy: tab 2's pause replaces it there (a claim), and its
    // upload of `second` replaces it on the server, which records it as a quit. Two writers, one row, one credit.
    a2.handoff.store(snapshot('second'), 'pause');
    await settle(a.runs, a2.runs);
    expect(server.ledger.map((c) => [c.runKey, c.reason])).toEqual([[first.runKey, 'quit']]);
    expect(a2.credited()).toEqual([first.runKey]);
    expect(a2.meta.data.stats.runs).toBe(1);
    // Another device's Run replaced on the server (not in this device's slot) is credited from the row too.
    const second = server.row!.runKey;
    const c = device(server);
    c.handoff.store(snapshot('third'), 'pause');
    await settle(c.runs);
    expect(c.credited()).toEqual([second]);
    expect(c.meta.data.stats.runs).toBe(1);
  });

  it('another Account’s saved Run is never offered, taken or credited', async () => {
    const server = new TestServer();
    const a = device(server, 'u1');
    a.handoff.store(snapshot(), 'pause');
    await settle(a.runs);
    a.handoff.forget();
    a.runs.setUser('u2');
    expect(a.store.peek()).toBeNull();
    await a.runs.syncTitle();
    expect(a.store.peekAny()).not.toBeNull(); // still there, for u1 (below)
    a.runs.setUser(null);
    expect(a.store.peek()).toBeNull(); // nor signed out
    a.runs.setUser('u1');
    expect(a.store.peek()).not.toBeNull();
    expect(a.credited()).toEqual([]);
  });

  it('not signed in: nothing goes to the server, and the Run is credited on the device at once', async () => {
    const server = new TestServer();
    const a = device(server, null);
    const s = snapshot();
    a.handoff.store(s, 'pause');
    expect(await a.handoff.takeBack()).toBe(true);
    await a.runs.syncTitle();
    expect(a.end(s)?.fluff).toBeGreaterThan(0);
    expect(a.runs.creditOf(s.runKey).state).toBe('credited');
    expect(a.end(s)).toBeNull(); // the results screen and the listener can't credit it twice
    await settle(a.runs);
    expect(server.calls).toEqual([]);
    expect(a.store.peek()).toBeNull();
    expect(a.meta.credited(s.runKey)).toBe(true);
    expect(a.credited()).toEqual([]); // no ledger row will ever exist for it: it takes no slot in the synced set
  });

  it('a Run never uploaded from here is credited at once; the claim records it as ended on the server', async () => {
    const server = new TestServer();
    const a = device(server);
    const s = snapshot();
    const award = a.end(s, 'victory');
    expect(award?.fluff).toBeGreaterThan(0);
    expect(a.credited()).toEqual([s.runKey]);
    expect(a.runs.creditOf(s.runKey)).toMatchObject({ state: 'credited' });
    await settle(a.runs);
    expect(server.ledger.map((c) => [c.runKey, c.reason])).toEqual([[s.runKey, 'victory']]);
    expect(server.row).toMatchObject({ runKey: s.runKey, snapshot: null, ended: true });
    expect(a.meta.data.stats.runs).toBe(1); // the answer (created: false... or true: either way) adds nothing
    // The answer settles the claim without adding anything: it was credited up front (and the results screen keeps that award).
    expect(a.outcomes).toEqual([expect.objectContaining({ runKey: s.runKey, award: null, already: true })]);
    expect(a.runs.creditOf(s.runKey)).toMatchObject({ state: 'credited', award: { fluff: award!.fluff } });
    // A late upload of it is refused.
    a.handoff.store(structuredClone(s), 'pause');
    await settle(a.runs);
    expect(a.lostRuns).toEqual([s.runKey]);
  });

  it('a Run the Account knows is credited from the server’s answer: pending until then, then once', async () => {
    const server = new TestServer();
    const a = device(server);
    const s = snapshot();
    a.handoff.store(s, 'pause');
    await settle(a.runs);
    expect(await a.handoff.takeBack()).toBe(true);
    await settle(a.runs);
    let open!: () => void;
    server.hold.claim = new Promise((r) => (open = r));
    expect(a.end(s)).toBeNull(); // deferred
    expect(a.runs.creditOf(s.runKey)).toEqual({ state: 'pending' });
    expect(a.credited()).toEqual([]);
    open();
    await settle(a.runs);
    expect(a.runs.creditOf(s.runKey)).toMatchObject({ state: 'credited', award: { fluff: expect.any(Number) } });
    expect(a.outcomes.map((o) => [o.runKey, o.reason, !!o.award])).toEqual([[s.runKey, 'died', true]]);
    expect(a.credited()).toEqual([s.runKey]);
    expect(server.row).toMatchObject({ runKey: s.runKey, snapshot: null, ended: true });
    expect(await a.runs.syncTitle()).toMatchObject({ fromAccount: null });
    expect(a.store.peek()).toBeNull();
  });

  it('unpausing while the pause upload is still on its way still takes the Run back on the server', async () => {
    const server = new TestServer();
    const a = device(server);
    const b = device(server);
    const s = snapshot();
    let open!: () => void;
    server.hold.put = new Promise((r) => (open = r));
    a.handoff.store(s, 'pause');
    expect(await a.handoff.takeBack()).toBe(true); // before the upload is heard back from
    open();
    await settle(a.runs);
    expect(server.calls).toEqual(['put', 'take']);
    expect(server.row).toMatchObject({ runKey: s.runKey, snapshot: null }); // A plays it: nothing to resume
    expect((await resumeOn(b)).res).toBe('none');
    expect(a.lostRuns).toEqual([]);
  });

  it('New run on the title waits for the Save & quit upload, so the abandoned Run isn’t stored again; the claim credits it', async () => {
    const server = new TestServer();
    const a = device(server);
    const s = snapshot();
    let open!: () => void;
    server.hold.put = new Promise((r) => (open = r));
    a.handoff.store(s, 'pause');
    a.handoff.forget(); // Save & quit: the title has it now
    const shown = a.store.peek()!;
    const abandoning = a.runs.abandon(shown.runKey);
    await new Promise((r) => setTimeout(r, 10));
    expect(server.calls).toEqual(['put']); // the claim waits for the upload
    open();
    expect(await abandoning).toBe('done');
    await settle(a.runs);
    expect(server.calls).toEqual(['put', 'claim']);
    expect(a.lostRuns).toEqual([]);
    expect(server.row).toMatchObject({ runKey: s.runKey, snapshot: null, ended: true });
    expect(a.credited()).toEqual([s.runKey]);
    expect(a.meta.data.stats.runs).toBe(1); // credited once, here
    const b = device(server);
    expect((await resumeOn(b)).res).toBe('none');
  });

  it('Resume on the title waits for the Save & quit upload, so the Run isn’t left resumable elsewhere', async () => {
    const server = new TestServer();
    const a = device(server);
    const s = snapshot();
    let open!: () => void;
    server.hold.put = new Promise((r) => (open = r));
    a.handoff.store(s, 'pause');
    a.handoff.forget(); // Save & quit: the title has it now
    const shown = a.store.peek()!;
    const resumed: RunSnapshot[] = [];
    const resuming = a.runs.resume(shown.runKey, (s) => void resumed.push(s));
    await new Promise((r) => setTimeout(r, 10));
    expect(server.calls).toEqual(['put']); // the take waits for the upload
    open();
    expect(await resuming).toBe('mine');
    expect(resumed[0]?.runKey).toBe(s.runKey);
    await settle(a.runs);
    expect(server.calls).toEqual(['put', 'take']);
    expect(server.row).toMatchObject({ runKey: s.runKey, snapshot: null }); // A plays it: nothing to resume
    expect((await resumeOn(device(server))).res).toBe('none');
  });

  it('after an Account switch, the new Account’s upload goes out once the old one’s request settles', async () => {
    const server = new TestServer();
    const a = device(server, 'u1');
    let open!: () => void;
    server.hold.put = new Promise((r) => (open = r));
    const theirs = snapshot('u1-run');
    a.handoff.store(theirs, 'pause'); // u1's upload is on its way...
    a.handoff.forget();
    a.runs.setUser('u2'); // ...when u2 signs in and pauses a Run
    expect(a.runs.newRun()).toBe(false); // u1's saved Run isn't u2's to abandon
    const mine = snapshot('u2-run');
    a.handoff.store(mine, 'pause');
    open();
    await settle(a.runs);
    expect(a.runs.pending).toBe(0);
    expect(server.calls).toEqual(['put', 'put']);
    expect(server.row?.runKey).toBe(theirs.runKey); // u1's upload landed in u1's Account...
    expect(server.store.slotOf('u2')?.runKey).toBe(mine.runKey); // ...and u2's in u2's
  });

  it('the title syncs after this page’s own upload lands, so a Run it is storing is neither credited nor replaced', async () => {
    const server = new TestServer();
    const other = device(server);
    const there = snapshot('there');
    other.handoff.store(there, 'pause'); // another device's Run is the Account's saved Run
    await settle(other.runs);
    const a = device(server);
    server.calls = [];
    let open!: () => void;
    server.hold.put = new Promise((r) => (open = r));
    const mine = snapshot('mine');
    a.handoff.store(mine, 'pause');
    a.handoff.forget(); // Save & quit: the title syncs at once
    const syncing = a.runs.syncTitle();
    await new Promise((r) => setTimeout(r, 10));
    expect(server.calls).toEqual(['put']); // the GET waits for the upload
    open();
    expect((await syncing).fromAccount).toBeNull();
    expect(server.calls.slice(0, 2)).toEqual(['put', 'get']);
    expect(server.row?.runKey).toBe(mine.runKey);
    expect(a.store.peek()?.runKey).toBe(mine.runKey);
    await settle(a.runs);
    expect(a.credited()).toEqual([there.runKey]); // the Run it replaced on the server, once; not its own
    expect(a.meta.data.stats.runs).toBe(1);
  });

  it('an upload that can’t settle leaves the title as it is, as offline', async () => {
    const server = new TestServer();
    const a = device(server);
    a.link.offline = true;
    const mine = snapshot('mine');
    a.handoff.store(mine, 'pause');
    a.handoff.forget();
    expect((await a.runs.syncTitle(30)).offline).toBe(true);
    expect(server.calls).not.toContain('get');
    expect(a.store.peek()?.runKey).toBe(mine.runKey);
  });

  describe('an answer that arrives after an Account switch touches nothing', () => {
    const held = (server: TestServer, what: string) => {
      let open!: () => void;
      server.hold[what] = new Promise((r) => (open = r));
      return () => open();
    };

    it('an upload: a Run it replaced isn’t credited to the new Account', async () => {
      const server = new TestServer();
      const other = device(server);
      const there = snapshot('there');
      other.handoff.store(there, 'pause');
      await settle(other.runs);
      const a = device(server, 'u1');
      const open = held(server, 'put');
      a.handoff.store(snapshot('mine'), 'pause');
      a.runs.setUser('u2');
      open();
      await settle(a.runs);
      await new Promise((r) => setTimeout(r, 10));
      expect(server.row?.runKey).not.toBe(there.runKey); // u1's upload did land...
      expect(server.ledger.map((c) => c.runKey)).toEqual([there.runKey]); // ...and the server recorded the Run it replaced...
      expect(a.credited()).toEqual([]); // ...but that row isn't u2's to apply
    });

    it('a background take: a refusal doesn’t make the new Account’s page step aside', async () => {
      const server = new TestServer();
      const a = device(server, 'u1');
      const s = snapshot();
      a.handoff.store(s, 'pause');
      await settle(a.runs);
      expect(await server.runs.take(USER, { runKey: s.runKey, lease: server.row!.lease, newLease: 'b-lease' })).toMatchObject({ ok: true }); // another device took it
      const open = held(server, 'take');
      expect(await a.handoff.takeBack()).toBe(true);
      a.runs.setUser('u2');
      a.runs.setUser('u1'); // even back to the same Account: its state was dropped
      open();
      await settle(a.runs);
      await new Promise((r) => setTimeout(r, 10));
      expect(a.lostRuns).toEqual([]);
    });

    it('a failed request isn’t retried for the Account signed in now', async () => {
      const server = new TestServer();
      const a = device(server, 'u1');
      const open = held(server, 'put');
      a.link.offline = true;
      a.handoff.store(snapshot(), 'pause');
      a.runs.setUser('u2');
      a.runs.setUser('u1');
      open();
      await new Promise((r) => setTimeout(r, 30));
      expect(server.calls.filter((c) => c === 'put')).toHaveLength(1);
      expect(a.runs.pending).toBe(0);
    });

    it('a claim: its answer is applied to its own Account’s copy, not the one signed in now', async () => {
      const server = new TestServer();
      const a = device(server, 'u1');
      const s = snapshot();
      const open = held(server, 'claim');
      a.handoff.store(s, 'pause');
      await settle(a.runs);
      expect(await a.handoff.takeBack()).toBe(true);
      await settle(a.runs);
      expect(a.end(s)).toBeNull(); // deferred: the claim is on its way
      a.runs.setUser('u2');
      open();
      await new Promise((r) => setTimeout(r, 30));
      expect(server.ledger.map((c) => c.runKey)).toEqual([s.runKey]); // the server credited u1's Run...
      expect(a.credited()).toEqual([]); // ...but u2's page applies nothing
      expect(a.credits.pending).toBe(0); // u1's claim is answered: it waits for nobody
      a.runs.setUser('u1'); // u1 again: the title's sweep brings the row in
      await a.runs.syncTitle();
      await settle(a.runs);
      expect(a.credited()).toEqual([s.runKey]);
    });

    it('the title sync: another Account’s row isn’t mirrored into the slot', async () => {
      const server = new TestServer();
      const other = device(server);
      other.handoff.store(snapshot('u1-run'), 'pause');
      await settle(other.runs);
      const a = device(server, 'u1');
      const open = held(server, 'get');
      const syncing = a.runs.syncTitle();
      await new Promise((r) => setTimeout(r, 5));
      a.runs.setUser('u2');
      a.runs.setUser('u1');
      open();
      await syncing;
      expect(a.store.peekAny()).toBeNull();
      expect(a.runs.title.fromAccount).toBeNull();
    });

    it('Resume: not started, online or offline', async () => {
      for (const offline of [false, true]) {
        const server = new TestServer();
        const a = device(server, 'u1');
        a.handoff.store(snapshot(), 'pause');
        await settle(a.runs);
        a.handoff.forget();
        const shown = a.store.peek()!;
        const open = held(server, 'take');
        let started = 0;
        const resuming = a.runs.resume(shown.runKey, () => void ++started);
        await new Promise((r) => setTimeout(r, 5));
        a.link.offline = offline;
        a.runs.setUser('u2');
        a.runs.setUser('u1');
        open();
        expect(await resuming).toBe('failed');
        expect(started).toBe(0);
        expect(a.runs.pending).toBe(0);
      }
    });

    it('New run: not abandoned (nor credited) on the device when the Account changes while its upload is waited out', async () => {
      const server = new TestServer();
      const a = device(server, 'u1');
      const open = held(server, 'put');
      a.handoff.store(snapshot(), 'pause');
      a.handoff.forget();
      const shown = a.store.peek()!;
      let abandoned = 0;
      const abandoning = a.runs.abandon(shown.runKey, () => (++abandoned, true));
      await new Promise((r) => setTimeout(r, 5));
      a.runs.setUser('u2');
      open();
      expect(await abandoning).toBe('failed');
      expect(abandoned).toBe(0);
      expect(a.credited()).toEqual([]);
    });
  });

  it('a device that fell behind can’t store a Run that ended elsewhere again', async () => {
    const server = new TestServer();
    const a = device(server);
    const b = device(server);
    const s = snapshot();
    a.handoff.store(s, 'pause');
    await settle(a.runs);
    a.link.offline = true;
    expect(await a.handoff.takeBack()).toBe(true); // its take back waits...
    a.handoff.store(structuredClone(s), 'pause'); // ...and is superseded by the next pause's upload
    expect((await resumeOn(b)).res).toBe('mine');
    b.end(s); // B ends (and credits) it
    await settle(b.runs);
    a.link.offline = false;
    await settle(a.runs);
    expect(a.lostRuns).toEqual([s.runKey]);
    expect(server.row).toMatchObject({ runKey: s.runKey, snapshot: null, ended: true });
    expect(a.store.peek()).toBeNull();
    expect(b.credited()).toEqual([s.runKey]);
    expect(a.credited()).toEqual([s.runKey]); // by the sweep after its failed requests, not by any crediting of its own
    expect(server.ledger).toHaveLength(1);
  });

  describe('a title read that overlaps Resume or New run is read again, not mirrored', () => {
    it('New run: the abandoned (and credited) Run is not restored into the slot and credited again', async () => {
      const server = new TestServer();
      const a = device(server);
      const b = device(server);
      b.handoff.store(snapshot(), 'pause');
      await settle(b.runs);
      b.handoff.forget(); // Save & quit on B
      await a.runs.syncTitle(); // A's title shows it, from the Account
      let open!: () => void;
      server.hold.get = new Promise((r) => (open = r));
      const syncing = a.runs.syncTitle(); // the title refreshes (an Account event, say)
      await new Promise((r) => setTimeout(r, 5));
      expect(server.calls.at(-1)).toBe('get'); // read before New run, answered after it
      const shown = a.store.peek()!;
      expect(await a.runs.abandon(shown.runKey)).toBe('done');
      await settle(a.runs);
      expect(a.credited()).toEqual([shown.runKey]);
      open();
      await syncing;
      expect(a.store.peek()).toBeNull();
      // The new Run starts: nothing left to abandon (and credit) again.
      expect(a.runs.newRun()).toBe(false);
      await settle(a.runs);
      expect(a.meta.data.stats.runs).toBe(1);
    });

    it('Resume: the Run this page now plays is not mirrored back into the slot', async () => {
      const server = new TestServer();
      const a = device(server);
      const s = snapshot();
      a.handoff.store(s, 'pause');
      await settle(a.runs);
      a.handoff.forget();
      let open!: () => void;
      server.hold.get = new Promise((r) => (open = r));
      const syncing = a.runs.syncTitle();
      await new Promise((r) => setTimeout(r, 5));
      const shown = a.store.peek()!;
      expect(await a.runs.resume(shown.runKey, () => undefined)).toBe('mine');
      open();
      await syncing;
      expect(a.store.peek()).toBeNull();
      expect(a.credited()).toEqual([]);
    });

    it('a title read waits for a Resume still on its way', async () => {
      const server = new TestServer();
      const a = device(server);
      const s = snapshot();
      a.handoff.store(s, 'pause');
      await settle(a.runs);
      a.handoff.forget();
      let open!: () => void;
      server.hold.take = new Promise((r) => (open = r));
      const shown = a.store.peek()!;
      const resuming = a.runs.resume(shown.runKey, () => undefined);
      const syncing = a.runs.syncTitle();
      await new Promise((r) => setTimeout(r, 5));
      expect(server.calls.filter((c) => c === 'get')).toEqual([]);
      open();
      expect(await resuming).toBe('mine');
      await syncing;
      expect(a.store.peek()).toBeNull();
    });
  });

  it('a mirrored Account copy replaced on pause is claimed, so a Run taken elsewhere is refused here and credited once, by its holder', async () => {
    const server = new TestServer();
    const a = device(server);
    const b = device(server);
    const r = snapshot('r');
    b.handoff.store(r, 'pause');
    await settle(b.runs);
    // This tab of A has started S (the slot was empty then)...
    expect(a.runs.newRun()).toBe(false);
    // ...when another tab of A's browser (one slot, one progress copy) mirrors R from the server on its title.
    const titleTab = device(server, 'u1', { storage: a.storage, events: fakeEvents() });
    await titleTab.runs.syncTitle();
    expect(a.store.peek()?.runKey).toBe(r.runKey);
    // B unpauses R: the server take moves R to B's new lease.
    expect(await b.handoff.takeBack()).toBe(true);
    await settle(b.runs);
    // This tab of A pauses S: S replaces the stale copy of R in the slot, and R is claimed...
    a.handoff.store(snapshot('s'), 'pause');
    await settle(a.runs);
    // ...but R is B's Run in progress: the claim is refused, nothing is credited here.
    expect(a.credited()).toEqual([]);
    expect(server.ledger).toEqual([]);
    expect(b.lostRuns).toEqual([]);
    b.end(r);
    await settle(b.runs);
    expect(server.ledger.map((c) => [c.runKey, c.reason])).toEqual([[r.runKey, 'died']]);
    expect(b.credited()).toEqual([r.runKey]);
  });

  it('a mirrored Account copy nobody took is credited once when Save & quit replaces it: the claim and the upload’s row agree', async () => {
    const server = new TestServer();
    const a = device(server);
    const b = device(server);
    const r = snapshot('r');
    b.handoff.store(r, 'pause');
    await settle(b.runs);
    b.handoff.forget(); // B's Save & quit: R stays on the server
    expect(a.runs.newRun()).toBe(false); // A plays S, started before its title mirrored R (another tab's, say)
    await a.runs.syncTitle();
    expect(a.store.peek()?.runKey).toBe(r.runKey);
    a.handoff.store(snapshot('s'), 'pause');
    expect(a.credited()).toEqual([]); // not by the slot's replace (the server decides)...
    await settle(a.runs);
    expect(a.credited()).toEqual([r.runKey]); // ...but from the server, once
    expect(a.meta.data.stats.runs).toBe(1);
    expect(server.ledger).toHaveLength(1);
    expect(b.credited()).toEqual([]);
  });

  describe('a new Run start abandoning a mirrored Account copy claims it: the server credits it unless another device holds it', () => {
    const mirrored = async () => {
      const server = new TestServer();
      const a = device(server);
      const b = device(server);
      const r = snapshot('r');
      b.handoff.store(r, 'pause');
      await settle(b.runs);
      await a.runs.syncTitle(); // A's slot mirrors R from the Account
      expect(a.store.peek()?.runKey).toBe(r.runKey);
      return { server, a, b, r };
    };

    it('taken by another device meanwhile: refused here (the holder credits it when it ends)', async () => {
      const { server, a, b, r } = await mirrored();
      expect(await b.handoff.takeBack()).toBe(true); // B unpauses R
      await settle(b.runs);
      expect(a.runs.newRun()).toBe(true);
      expect(a.store.peek()).toBeNull();
      await settle(a.runs);
      expect(a.credited()).toEqual([]);
      expect(server.ledger).toEqual([]);
      expect(server.row?.runKey).toBe(r.runKey);
      expect(server.row?.ended).toBeFalsy(); // still B's Run in progress
      expect(b.lostRuns).toEqual([]);
    });

    it('nobody took it: credited once, from the server’s answer', async () => {
      const { server, a, b, r } = await mirrored();
      b.handoff.forget(); // B's Save & quit: R stays on the server
      expect(a.runs.newRun()).toBe(true);
      expect(a.credited()).toEqual([]); // not on the device...
      await settle(a.runs);
      expect(a.credited()).toEqual([r.runKey]); // ...but once the server recorded it
      expect(a.outcomes.map((o) => [o.runKey, o.reason])).toEqual([[r.runKey, 'quit']]);
      expect(server.row).toMatchObject({ runKey: r.runKey, ended: true });
      expect(b.credited()).toEqual([]);
    });
  });

  describe('the four races (docs/adr/0003)', () => {
    it('1. a lost answer: the replace wrote the ledger row; the durable claim gets the same row, and the credit lands once', async () => {
      const server = new TestServer();
      const a = device(server);
      const b = device(server);
      const r = snapshot('r');
      b.handoff.store(r, 'pause');
      await settle(b.runs);
      b.handoff.forget();
      expect(a.runs.newRun()).toBe(false); // A plays S...
      await a.runs.syncTitle(); // ...and its title (another tab's, say) mirrors R
      server.loseAnswer.put = true; // the upload of S replaces R and records it, but A never hears the answer
      a.handoff.store(snapshot('s'), 'pause');
      await settle(a.runs);
      expect(server.calls.filter((c) => c === 'put').length).toBeGreaterThanOrEqual(2); // retried: the same Run again, nothing replaced
      expect(server.ledger.map((c) => c.runKey)).toEqual([r.runKey]);
      expect(a.credited()).toEqual([r.runKey]); // from the claim's answer (the same row)
      expect(a.meta.data.stats.runs).toBe(1);
    });

    it('1b. a lost answer with no claim of its own: the sweep from the title brings the row in', async () => {
      const server = new TestServer();
      const a = device(server);
      const b = device(server);
      const r = snapshot('r');
      b.handoff.store(r, 'pause');
      await settle(b.runs);
      b.handoff.forget(); // R is on the server; A's slot never saw it (no mirror, so no claim of A's)
      expect(a.runs.newRun()).toBe(false);
      server.loseAnswer.put = true;
      a.handoff.store(snapshot('s'), 'pause');
      await settle(a.runs);
      expect(server.ledger.map((c) => c.runKey)).toEqual([r.runKey]);
      expect(a.credited()).toEqual([r.runKey]); // the queue drained after a network error: it swept
      expect(a.meta.data.stats.runs).toBe(1);
      await a.runs.syncTitle(); // the title's sweep adds nothing
      await settle(a.runs);
      expect(a.meta.data.stats.runs).toBe(1);
    });

    it('2. an offline End run past any timeout: the claim waits for the server, which refuses a Run another device took', async () => {
      const server = new TestServer();
      const a = device(server);
      const b = device(server);
      const r = snapshot('r');
      a.handoff.store(r, 'pause');
      await settle(a.runs);
      expect((await resumeOn(b)).res).toBe('mine'); // B takes R
      a.link.offline = true;
      expect(await a.handoff.takeBack()).toBe(true); // A, offline, unpauses and plays on...
      await new Promise((r) => setTimeout(r, 20));
      expect(a.end(r)).toBeNull(); // ...and dies: no device's word, no timeout, Fluff pending
      await new Promise((r) => setTimeout(r, 40));
      expect(a.runs.creditOf(r.runKey)).toEqual({ state: 'pending' });
      expect(a.credited()).toEqual([]);
      expect(a.credits.pending).toBe(1);
      a.link.offline = false;
      a.credits.replay(); // back online
      await settle(a.runs);
      expect(a.runs.creditOf(r.runKey)).toEqual({ state: 'refused', why: 'carriedOn' });
      expect(a.outcomes.map((o) => [o.runKey, o.award])).toEqual([[r.runKey, null]]);
      expect(a.credited()).toEqual([]);
      expect(server.ledger).toEqual([]);
      b.end(r, 'victory');
      await settle(b.runs);
      expect(b.credited()).toEqual([r.runKey]);
      expect(server.ledger.map((c) => c.reason)).toEqual(['victory']);
    });

    it('2b. the same, when the holder also credits the Run before the offline device reconnects: refused, not credited twice', async () => {
      const server = new TestServer();
      const a = device(server);
      const b = device(server);
      const r = snapshot('r');
      a.handoff.store(r, 'pause');
      await settle(a.runs);
      expect((await resumeOn(b)).res).toBe('mine');
      a.link.offline = true;
      expect(await a.handoff.takeBack()).toBe(true);
      expect(a.end(r)).toBeNull();
      b.end(r);
      await settle(b.runs);
      expect(b.credited()).toEqual([r.runKey]);
      a.link.offline = false;
      a.credits.replay();
      await settle(a.runs);
      // The ledger already has R: A's claim gets B's row back. A's copy may apply it (the merge settles whose
      // Fluff survives: docs/adr/0003), but the server credited R once, with B's ending.
      expect(server.ledger.map((c) => [c.runKey, c.reason])).toEqual([[r.runKey, 'died']]);
      expect(server.ledger).toHaveLength(1);
    });

    it('3. the ledger remembers every ended Run: a late upload of an older Run is refused, whatever the row holds', async () => {
      const server = new TestServer();
      const a = device(server);
      const r1 = snapshot('r1');
      a.handoff.store(r1, 'pause');
      await settle(a.runs);
      a.handoff.forget();
      expect(a.runs.newRun()).toBe(true); // a new Run abandons R1: a quit in the ledger
      const r2 = snapshot('r2');
      a.handoff.store(r2, 'pause');
      await settle(a.runs);
      expect(await a.handoff.takeBack()).toBe(true);
      await settle(a.runs);
      a.end(r2); // R2 ends: the row remembers R2 only
      await settle(a.runs);
      expect(server.row).toMatchObject({ runKey: r2.runKey, ended: true });
      expect(server.ledger.map((c) => c.runKey)).toEqual([r1.runKey, r2.runKey]);
      // A stale device still holding R1 (its pause never landed) uploads it now.
      const c = device(server);
      c.handoff.store(structuredClone(r1), 'pause');
      await settle(c.runs);
      expect(c.lostRuns).toEqual([r1.runKey]);
      expect(c.store.peek()).toBeNull();
      expect(server.row?.runKey).toBe(r2.runKey);
    });

    it('4. an offline unpause vs another device’s new Run: A’s take is refused, and A’s Run is credited once, by the sweep', async () => {
      const server = new TestServer();
      const a = device(server);
      const b = device(server);
      const r = snapshot('r');
      a.handoff.store(r, 'pause');
      await settle(a.runs);
      a.link.offline = true;
      expect(await a.handoff.takeBack()).toBe(true); // A unpauses offline
      expect(b.runs.newRun()).toBe(false); // B plays S...
      await b.runs.syncTitle(); // ...its title (another tab's, say) mirrors R...
      b.handoff.store(snapshot('s'), 'pause'); // ...and B pauses S: R is replaced and recorded as a quit
      await settle(b.runs);
      expect(server.ledger.map((c) => [c.runKey, c.reason])).toEqual([[r.runKey, 'quit']]);
      expect(b.credited()).toEqual([r.runKey]); // B's copy holds it (the merge decides whose Fluff survives)
      a.link.offline = false;
      await settle(a.runs);
      expect(a.lostRuns).toEqual([r.runKey]); // A steps aside: what it played since unpausing is lost (ADR 2)
      // The sweep (after A's queue drained following its network errors, and again from the title) applies R's
      // row to A's copy rather than dropping the Run.
      expect(a.credited()).toEqual([r.runKey]);
      await a.runs.syncTitle();
      await settle(a.runs);
      expect(a.credited()).toEqual([r.runKey]);
      expect(a.meta.data.stats.runs).toBe(1);
      expect(server.ledger).toHaveLength(1);
    });
  });

  it('retry after a lost claim answer credits once', async () => {
    const server = new TestServer();
    const a = device(server);
    const s = snapshot();
    a.handoff.store(s, 'pause');
    await settle(a.runs);
    expect(await a.handoff.takeBack()).toBe(true);
    await settle(a.runs);
    server.loseAnswer.claim = true;
    expect(a.end(s)).toBeNull();
    await settle(a.runs);
    expect(server.calls.filter((c) => c === 'claim').length).toBeGreaterThanOrEqual(2);
    expect(server.ledger).toHaveLength(1);
    expect(a.credited()).toEqual([s.runKey]);
    expect(a.meta.data.stats.runs).toBe(1);
    expect(a.outcomes).toHaveLength(1);
    expect(a.credits.pending).toBe(0);
  });

  it('two devices sweeping the same row credit one progress copy once (two tabs, one save)', async () => {
    const server = new TestServer();
    const other = device(server);
    const r = snapshot('r');
    other.end(r); // a row in the ledger from elsewhere
    await settle(other.runs);
    // Two tabs of one browser: one storage, so one progress copy, read fresh on every write.
    const storage = memStorage();
    const tab = () => {
      const meta = new MetaProgress(storage);
      const runs = new SavedRuns({ storage, meta, ...server.client(), locks: null, retryMs: 1, maxRetryMs: 4, hidden: () => false });
      runs.setUser('u1');
      return { meta, runs, credits: runs.credits };
    };
    const t1 = tab();
    const t2 = tab();
    await Promise.all([t1.credits.sweep(), t2.credits.sweep()]);
    expect(t1.meta.data.creditedRuns).toEqual([r.runKey]);
    expect(t2.meta.data.creditedRuns).toEqual([r.runKey]);
    expect(new MetaProgress(storage).data.stats.runs).toBe(1);
    // And a claim replayed by both tabs (a reload mid-claim, say) is just as harmless.
    const s = snapshot('s');
    t1.runs.ended({ runKey: s.runKey, reason: 'quit', stats: s.stats });
    t2.credits.replay();
    await settle(t1.runs, t2.runs);
    expect(new MetaProgress(storage).data.stats.runs).toBe(2);
  });

  it('the sweep applies at most the newest rows, which the copy remembers far longer than that', async () => {
    const server = new TestServer();
    for (let i = 0; i < RUN_CREDIT_LIST_LIMIT + 3; i++) await server.runs.claim(USER, { runKey: `old-${i}`, lease: 'l', reason: 'died', stats: { maxRadius: 1, debrisAbsorbed: 1, tierReached: 1 } });
    const a = device(server);
    await a.runs.syncTitle();
    await settle(a.runs);
    expect(a.credited()).toHaveLength(RUN_CREDIT_LIST_LIMIT);
    expect(a.credited().at(-1)).toBe(`old-${RUN_CREDIT_LIST_LIMIT + 2}`); // the newest are the last forgotten
    await a.runs.syncTitle();
    await settle(a.runs);
    expect(a.meta.data.stats.runs).toBe(RUN_CREDIT_LIST_LIMIT); // nothing twice
  });
});

describe('SavedRuns: known Runs, Universes and claim stats (docs/adr/0003 review)', () => {
  it('a known Run stays known through a sign-out and back in mid-Run: its credit waits for the server, which refuses a Run another device took', async () => {
    const server = new TestServer();
    const a = device(server);
    const b = device(server);
    const r = snapshot('r');
    a.handoff.store(r, 'pause'); // uploaded: the server knows R from A
    await settle(a.runs);
    expect(a.runs.knows(r.runKey)).toBe(true);
    expect(JSON.parse(a.storage.map.get(KNOWN_RUNS_KEY)!)).toEqual({ version: KNOWN_RUNS_VERSION, known: [{ runKey: r.runKey, leases: [server.row!.lease] }] });
    expect((await resumeOn(b)).res).toBe('mine'); // B takes R
    a.link.offline = true;
    expect(await a.handoff.takeBack()).toBe(true); // A, offline, unpauses and plays on...
    await new Promise((r) => setTimeout(r, 20));
    a.runs.setUser(null); // ...signs out mid-Run...
    a.runs.setUser('u1'); // ...and back in: `live` is gone, the known set is not
    a.link.offline = false;
    expect(a.end(r)).toBeNull(); // still deferred: no credit on A's word
    await settle(a.runs);
    expect(a.runs.creditOf(r.runKey)).toEqual({ state: 'refused', why: 'carriedOn' });
    expect(a.credited()).toEqual([]);
    expect(server.ledger).toEqual([]);
    b.end(r);
    await settle(b.runs);
    expect(server.ledger).toHaveLength(1);
    expect(b.credited()).toEqual([r.runKey]);
  });

  it('known Runs survive a reload; a Run the server never saw is still credited at once', async () => {
    const server = new TestServer();
    const a = device(server);
    const r = snapshot('r');
    a.handoff.store(r, 'pause');
    await settle(a.runs);
    const again = new SavedRuns({ storage: a.storage, meta: a.meta, ...server.client(), locks: null, retryMs: 1, maxRetryMs: 4, hidden: () => false });
    again.setUser('u1');
    expect(again.knows(r.runKey)).toBe(true);
    const fresh = snapshot('fresh');
    expect(again.knows(fresh.runKey)).toBe(false);
    expect(again.ended({ runKey: fresh.runKey, reason: 'died', stats: fresh.stats })).not.toBeNull();
  });

  it('a Universe victory counts on the device that ended it (from its claim’s answer); another device’s sweep adds its Fluff only', async () => {
    const server = new TestServer();
    const a = device(server);
    const b = device(server);
    const r = snapshot('r');
    a.handoff.store(r, 'pause');
    await settle(a.runs);
    expect(await a.handoff.takeBack()).toBe(true);
    await settle(a.runs);
    expect(a.runs.ended({ runKey: r.runKey, reason: 'victory', stats: { ...r.stats, area: 'universe' } })).toBeNull(); // deferred
    await settle(a.runs);
    expect(a.runs.creditOf(r.runKey)).toMatchObject({ state: 'credited', award: { universes: 1 } });
    expect(a.meta.universes).toBe(1);
    await b.runs.syncTitle();
    await settle(b.runs);
    expect(b.credited()).toEqual([r.runKey]);
    expect(b.meta.data.stats.wins).toBe(1);
    expect(b.meta.universes).toBe(0); // the cloud save's merge carries the count
  });

  it('claims send the Run’s own stats, bounded, never zeros: a Universe-sized Run passes, broken stats are salvaged', () => {
    const run = snapshot('big');
    const huge = { ...run.stats, maxRadius: 2.8e25 };
    expect(creditStatsOf(huge)).toMatchObject({ maxRadius: 2.8e25, debrisAbsorbed: run.stats.debrisAbsorbed, tierReached: run.stats.tierReached });
    expect(creditStatsOf(huge)).toEqual(pickCreditStats(huge));
    const broken = { ...run.stats, maxRadius: Number.NaN, debrisAbsorbed: 42 };
    expect(pickCreditStats(broken)).toBeNull();
    expect(creditStatsOf(broken)).toMatchObject({ maxRadius: 0, debrisAbsorbed: 42, tierReached: run.stats.tierReached });
  });

  it('409 run_ended from a Run an old client ended: nothing applied, the claim dropped, the results screen told it was added elsewhere', async () => {
    const server = new TestServer();
    const a = device(server);
    const r = snapshot('r');
    a.handoff.store(r, 'pause');
    await settle(a.runs);
    expect(await a.handoff.takeBack()).toBe(true);
    await settle(a.runs);
    expect(await server.runs.end(USER, { runKey: r.runKey, lease: server.row!.lease })).toMatchObject({ deleted: true }); // an old-build tab ended R and credited it itself
    expect(a.end(r)).toBeNull();
    await settle(a.runs);
    expect(a.runs.creditOf(r.runKey)).toEqual({ state: 'refused', why: 'elsewhere' });
    expect(a.credited()).toEqual([]);
    expect(a.credits.pending).toBe(0);
    expect(server.ledger).toEqual([]);
  });
});

describe('SavedRuns: the stale claim (docs/adr/0003, run_holders)', () => {
  it('a claim for a Run another device holds is refused with carriedOn after a new Run replaced it in the slot', async () => {
    const server = new TestServer();
    const a = device(server);
    const b = device(server);
    const c = device(server);
    const r = snapshot('r');
    a.handoff.store(r, 'pause');
    await settle(a.runs);
    a.link.offline = true;
    expect(await a.handoff.takeBack()).toBe(true); // A plays on offline: its take hasn't reached the server
    expect((await resumeOn(b)).resumed.map((s) => s.runKey)).toEqual([r.runKey]); // B takes R and plays it
    c.handoff.store(snapshot('y'), 'pause'); // C's new Run replaces R in the Account's slot while B holds R
    await settle(c.runs);
    expect(server.row?.runKey).not.toBe(r.runKey);
    expect(a.end(r)).toBeNull(); // R is known to the server: its credit waits for the claim
    a.link.offline = false;
    await settle(a.runs);
    expect(a.runs.creditOf(r.runKey)).toEqual({ state: 'refused', why: 'carriedOn' });
    expect(server.ledger).toEqual([]); // B credits R when it ends it there
    expect(a.credited()).toEqual([]);
  });
});

describe('SavedRuns: the second review round (docs/adr/0003)', () => {
  it('a known Run ended after a sign-out and back in mid-Run claims under the lease the server holds, so it is credited once', async () => {
    const server = new TestServer();
    const a = device(server);
    const r = snapshot('r');
    a.handoff.store(r, 'pause'); // uploaded under lease L1
    await settle(a.runs);
    expect(await a.handoff.takeBack()).toBe(true); // unpaused: the take moves the server's lease to L2
    await settle(a.runs);
    const held = server.row!.lease;
    expect(JSON.parse(a.storage.map.get(KNOWN_RUNS_KEY)!).known).toEqual([{ runKey: r.runKey, leases: [held] }]); // the durable record follows the lease
    a.runs.setUser(null); // signs out mid-Run...
    a.runs.setUser('u1'); // ...and back in: `live` is gone
    expect(a.end(r)).toBeNull(); // known: deferred to the server
    await settle(a.runs);
    expect(server.calls.filter((c) => c === 'claim')).toHaveLength(1);
    expect(server.ledger.map((c) => c.runKey)).toEqual([r.runKey]); // not 409 carried_on
    expect(a.runs.creditOf(r.runKey)).toMatchObject({ state: 'credited', award: { fluff: expect.any(Number) } });
    expect(a.credited()).toEqual([r.runKey]);
    expect(a.meta.data.stats.runs).toBe(1);
  });

  it('the remembered leases survive a reload; a record without them falls back to the device slot’s tag', async () => {
    const server = new TestServer();
    const a = device(server);
    const r = snapshot('r');
    a.handoff.store(r, 'pause');
    await settle(a.runs);
    expect(await a.handoff.takeBack()).toBe(true);
    await settle(a.runs);
    // A reload: a fresh page over the same storage (its waiting claims included).
    const again = new SavedRuns({ storage: a.storage, meta: a.meta, ...server.client(), locks: null, retryMs: 1, maxRetryMs: 4, hidden: () => false });
    again.setUser('u1');
    expect(again.ended({ runKey: r.runKey, reason: 'died', stats: r.stats })).toBeNull();
    await settle(again);
    expect(server.ledger.map((c) => c.runKey)).toEqual([r.runKey]);
    expect(again.creditOf(r.runKey)).toMatchObject({ state: 'credited' });

    // A paused Run whose known record is a key alone (an earlier shape of the file): the slot's tag names the lease.
    const server2 = new TestServer();
    const b = device(server2);
    const p = snapshot('p');
    b.handoff.store(p, 'pause');
    await settle(b.runs);
    b.storage.setItem(KNOWN_RUNS_KEY, JSON.stringify({ version: KNOWN_RUNS_VERSION, known: [p.runKey] }));
    const page = new SavedRuns({ storage: b.storage, meta: b.meta, ...server2.client(), locks: null, retryMs: 1, maxRetryMs: 4, hidden: () => false });
    page.setUser('u1');
    expect(page.ended({ runKey: p.runKey, reason: 'quit', stats: p.stats })).toBeNull();
    await settle(page);
    expect(server2.ledger.map((c) => c.runKey)).toEqual([p.runKey]);
  });

  it('a never-seen Universe victory counts once: credited locally, and its claim’s answer adds no second Universe even after an adopt dropped the key', async () => {
    const server = new TestServer();
    const a = device(server);
    const r = snapshot('r');
    let release!: () => void;
    server.hold.claim = new Promise<void>((res) => (release = res)); // the claim is slow
    const win = { runKey: r.runKey, reason: 'victory' as const, stats: { ...r.stats, area: 'universe' } };
    expect(a.runs.ended(win)).toMatchObject({ universes: 1 }); // credited at once: the server never saw it
    expect(a.meta.universes).toBe(1);
    // Meanwhile the cloud save adopts a copy that got further: its set lacks the key, the Universes count is max-merged and stays.
    a.meta.store.update((d) => {
      d.fluff = 5000;
      d.stats.totalFluffEarned = 9000;
      a.meta.adoptCreditedRuns(d, [], false);
    });
    expect(a.meta.data.creditedRuns).toEqual([]);
    release();
    await settle(a.runs);
    expect(server.ledger.map((c) => c.runKey)).toEqual([r.runKey]);
    expect(a.credited()).toEqual([r.runKey]); // the row's Fluff is applied again (the adopted copy lacks it)...
    expect(a.meta.universes).toBe(1); // ...but the Universe is not counted twice
  });

  it('more than CREDITED_RUNS_MAX never-seen Runs ended offline are credited once each: a key whose claim is still out is never evicted, so the replay adds nothing', async () => {
    const server = new TestServer();
    const a = device(server);
    const stats = snapshot('s').stats;
    const n = CREDITED_RUNS_MAX + 1;
    a.link.offline = true;
    let fluff = 0;
    for (let i = 0; i < n; i++) {
      const award = a.runs.ended({ runKey: `off-${i}`, reason: 'died', stats });
      expect(award).not.toBeNull(); // the server never saw it: credited at once, its claim queued
      fluff += award!.fluff;
    }
    expect(a.meta.data.stats.runs).toBe(n);
    expect(a.credits.pending).toBe(n);
    expect(a.credited()).toHaveLength(n); // the oldest key is kept beyond the cap: its claim is still out
    expect(new MetaProgress(a.storage).data.creditedRuns).toHaveLength(n); // and so a reload reads it
    a.link.offline = false;
    a.credits.replay();
    await settle(a.runs);
    expect(server.ledger).toHaveLength(n);
    expect(a.credits.pending).toBe(0);
    expect(a.meta.data.stats.runs).toBe(n); // not 2n
    expect(a.meta.fluff).toBe(fluff);
    expect(a.outcomes.filter((o) => o.award)).toHaveLength(0); // every answer found its credit held already
    // With the claims landed, the next credit trims the set back to the cap: the oldest key goes like any other.
    expect(a.runs.ended({ runKey: 'after', reason: 'died', stats })).not.toBeNull();
    await settle(a.runs);
    expect(a.credited()).toHaveLength(CREDITED_RUNS_MAX);
    expect(a.credited()[0]).toBe('off-2');
    expect(a.meta.data.stats.runs).toBe(n + 1);
  });

  it('…and when a cloud adopt replaced the copy with one lacking those Runs’ keys and Fluff, their replayed claims restore each credit once', async () => {
    const server = new TestServer();
    const a = device(server);
    const stats = snapshot('s').stats;
    const n = CREDITED_RUNS_MAX + 1;
    a.link.offline = true;
    for (let i = 0; i < n; i++) expect(a.runs.ended({ runKey: `off-${i}`, reason: 'died', stats })).not.toBeNull();
    const earned = a.meta.data.stats.totalFluffEarned;
    // The cloud save adopts a copy that got further on another device: its Fluff, stats and set replace this one's, none of these Runs among them.
    a.meta.store.update((d) => {
      d.fluff = 5000;
      d.stats = { ...d.stats, runs: 40, totalFluffEarned: 9000 };
      a.meta.adoptCreditedRuns(d, ['other-1'], false);
    });
    expect(a.credited()).toEqual(['other-1']);
    a.link.offline = false;
    a.credits.replay();
    await settle(a.runs);
    expect(a.outcomes.filter((o) => o.award)).toHaveLength(n); // each answer applied its row: the adopted copy lacked it
    expect(a.meta.data.stats.runs).toBe(40 + n);
    expect(a.meta.fluff).toBe(5000 + earned);
    expect(a.meta.data.stats.totalFluffEarned).toBe(9000 + earned);
    expect(a.credited()).toHaveLength(CREDITED_RUNS_MAX); // the last answer's write trimmed the set: 'other-1' and 'off-0' aged out
    expect(a.credited()[0]).toBe('off-1');
  });

  it('a claim answered in another tab settles this one: the results screen reads credited, the leaderboard’s wait ends', async () => {
    const server = new TestServer();
    const shared = { storage: memStorage(), events: fakeEvents() };
    const a = device(server, 'u1', shared);
    const r = snapshot('r');
    a.handoff.store(r, 'pause');
    await settle(a.runs);
    expect(await a.handoff.takeBack()).toBe(true);
    await settle(a.runs);
    a.link.offline = true;
    expect(a.end(r)).toBeNull();
    await settle(a.runs);
    expect(a.runs.deferred(r.runKey)).toBe(true);
    expect(a.runs.creditOf(r.runKey)).toEqual({ state: 'pending' });
    // Another tab of the same device (online) replays the durable claim and applies the answer to the shared copy.
    const b = device(server, 'u1', shared);
    b.credits.replay();
    await settle(b.runs);
    expect(server.ledger.map((c) => c.runKey)).toEqual([r.runKey]);
    expect(b.credited()).toEqual([r.runKey]);
    a.meta.store.refresh(); // the save's own `storage` event lands first in the browser
    shared.events.fire(RUN_CREDITS_KEY);
    expect(a.runs.deferred(r.runKey)).toBe(false);
    expect(a.runs.creditOf(r.runKey)).toEqual({ state: 'credited', award: null });
    expect(a.outcomes).toEqual([expect.objectContaining({ runKey: r.runKey, award: null, already: true, fluff: expect.any(Number) })]);
    expect(a.outcomes[0]!.fluff).toBeGreaterThan(0);
    // A's own answer, when it is back online, is not announced a second time, and the copy still holds the credit once.
    a.link.offline = false;
    a.credits.replay();
    await settle(a.runs);
    expect(a.outcomes).toHaveLength(1);
    expect(a.credited()).toEqual([r.runKey]);
    expect(a.meta.data.stats.runs).toBe(1);
  });
});
