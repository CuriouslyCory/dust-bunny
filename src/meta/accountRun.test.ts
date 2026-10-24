/**
 * The Account's saved Run (src/meta/accountRun.ts) and its credit (src/meta/runCredits.ts,
 * docs/adr/0003): two devices (each its own storage, slot and progress copy), one fake server that
 * follows api/saved-run.ts's and api/run-credit.ts's rules (server/api.test.ts checks the real ones).
 */
import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/events';
import { createRun } from '../game/assembly';
import type { Game } from '../game/game';
import { RunHandoff, type HandoffLoss } from '../game/handoff';
import { SNAPSHOT_VERSION, type RunSnapshot } from '../game/snapshot';
import { pickCreditStats, RUN_CREDIT_LIST_LIMIT, type CreditStats, type RunCredit, type RunCreditReason } from '../shared/runCredit';
import type { ServerSavedRun } from '../shared/savedRun';
import { AccountRuns, creditStatsOf, KNOWN_RUNS_KEY, KNOWN_RUNS_VERSION, SavedRunNetError, type PutResult, type SavedRunApi, type TakeResult } from './accountRun';
import { MetaProgress, type RunCreditInput } from './meta';
import { RunCreditQueue, type ClaimResult, type CreditOutcome, type RunCreditApi } from './runCredits';
import { abandonSuspendedRun, resumeSuspendedRun, SUSPENDED_RUN_KEY, SuspendedRunStore } from './suspendedRun';

const memStorage = () => {
  const map = new Map<string, string>();
  return { map, getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) };
};

const snapshot = (seed = 'acct'): RunSnapshot => {
  const run = createRun(new EventBus(), { seed, characterId: 'zap' });
  for (let i = 0; i < 30; i++) run.update(1 / 60);
  return run.toSnapshot();
};

interface Row {
  runKey: string;
  lease: string;
  snapshot: Record<string, unknown> | null;
  version: number | null;
  /** The Run ended (or was abandoned): the row stays so a late upload of it is refused. */
  ended?: boolean;
}

/**
 * One Account's saved Run row and credit ledger, with the server's rules. `offline`: every request
 * fails. `loseAnswer[what]`: the next such request is carried out but its answer is lost (a
 * network error after the server wrote). `calls`: what was asked.
 */
class FakeServer {
  row: Row | null = null;
  ledger: RunCredit[] = [];
  offline = false;
  /** While set, every answer waits for it (a slow network). */
  gate: Promise<void> | null = null;
  /** Answers to one kind of request (`put`, `take`, `claim`, …) wait for its promise (that request is slow). */
  hold: Partial<Record<string, Promise<void>>> = {};
  loseAnswer: Partial<Record<string, boolean>> = {};
  calls: string[] = [];

  /** The ledger's rule: one row per Run key; a second writer gets the first row back. */
  record(runKey: string, reason: RunCreditReason, stats: CreditStats): { credit: RunCredit; created: boolean } {
    const existing = this.ledger.find((c) => c.runKey === runKey);
    if (existing) return { credit: existing, created: false };
    const credit: RunCredit = { id: this.ledger.length + 1, runKey, reason, stats, creditedAt: new Date(0).toISOString() };
    this.ledger.push(credit);
    return { credit, created: true };
  }

  private async net(what: string, link: { offline: boolean }): Promise<void> {
    this.calls.push(what);
    if (this.gate) await this.gate;
    if (this.hold[what]) await this.hold[what];
    if (this.offline || link.offline) throw new SavedRunNetError('offline');
  }

  private answer<T>(what: string, value: T): T {
    if (this.loseAnswer[what]) {
      this.loseAnswer[what] = false;
      throw new SavedRunNetError('answer lost');
    }
    return value;
  }

  /** `link.offline`: this device alone can't reach the server. */
  api(link: { offline: boolean } = { offline: false }): SavedRunApi {
    const view = ({ ended: _ended, ...r }: Row): ServerSavedRun => ({ ...structuredClone(r), updatedAt: new Date(0).toISOString() });
    return {
      get: async () => {
        // Read as the request arrives; a slow answer (`gate`, `hold`) reports the row as it was then.
        const row = this.row && !this.row.ended ? view(this.row) : null;
        await this.net('get', link);
        return row;
      },
      put: async (b): Promise<PutResult> => {
        await this.net('put', link);
        const snap = structuredClone(b.snapshot) as Record<string, unknown>;
        const version = snap.version as number;
        const old = this.row;
        if (this.ledger.some((c) => c.runKey === b.runKey)) return { ok: false, reason: 'carriedOn' }; // 409 run_ended, whatever the row holds
        if (old?.ended && old.runKey === b.runKey) return { ok: false, reason: 'carriedOn' }; // 409 run_ended
        if (old && old.runKey === b.runKey && old.lease !== b.lease && old.lease !== b.prevLease) return { ok: false, reason: 'carriedOn' };
        if (old && old.runKey !== b.runKey && old.snapshot && (old.version ?? 0) > version) return { ok: false, reason: 'newer' };
        this.row = { runKey: b.runKey, lease: b.lease, snapshot: snap, version };
        const credits: RunCredit[] = [];
        if (b.ledger && old && old.runKey !== b.runKey && old.snapshot) {
          credits.push(this.record(old.runKey, 'quit', pickCreditStats((old.snapshot as { stats?: unknown }).stats) ?? { maxRadius: 0, debrisAbsorbed: 0, tierReached: 0 }).credit);
        }
        return this.answer('put', { ok: true, credits });
      },
      take: async (b): Promise<TakeResult> => {
        await this.net('take', link);
        const r = this.row;
        if (!r || r.ended || r.runKey !== b.runKey || (r.lease !== b.lease && r.lease !== b.newLease)) return { taken: false, savedRun: r ? view(r) : null };
        const snap = r.snapshot;
        this.row = { ...r, lease: b.newLease, snapshot: null, version: null };
        return { taken: true, snapshot: snap };
      },
    };
  }

  creditApi(link: { offline: boolean } = { offline: false }): RunCreditApi {
    return {
      claim: async (b): Promise<ClaimResult> => {
        await this.net('claim', link);
        const existing = this.ledger.find((c) => c.runKey === b.runKey);
        if (existing) return this.answer('claim', { ok: true, credit: existing, created: false });
        const r = this.row;
        if (r && r.runKey === b.runKey) {
          if (r.ended) return { ok: false, reason: 'runEnded' };
          if (r.lease !== b.lease && r.lease !== b.prevLease) return { ok: false, reason: 'carriedOn' };
          this.row = { ...r, snapshot: null, version: null, ended: true };
        } else if (!r || (r.ended && r.runKey !== b.runKey)) {
          this.row = { runKey: b.runKey, lease: b.lease, snapshot: null, version: null, ended: true };
        }
        return this.answer('claim', { ok: true, ...this.record(b.runKey, b.reason, b.stats) });
      },
      list: async (limit = RUN_CREDIT_LIST_LIMIT) => {
        await this.net('list', link);
        return [...this.ledger].reverse().slice(0, limit);
      },
    };
  }
}

/** A device: its own storage, slot and progress copy, signed in as `user`. */
const device = (server: FakeServer, user: string | null = 'u1') => {
  const storage = memStorage();
  const store = new SuspendedRunStore(storage);
  const meta = new MetaProgress(storage);
  const link = { offline: false };
  const credits = new RunCreditQueue({ api: server.creditApi(link), storage, meta, retryMs: 1, maxRetryMs: 4 });
  const runs = new AccountRuns({ api: server.api(link), store, meta, credits, storage, retryMs: 1, maxRetryMs: 4, hidden: () => false });
  const outcomes: CreditOutcome[] = [];
  credits.onCredit((o) => void outcomes.push(o));
  runs.setUser(user);
  const lostRuns: string[] = [];
  runs.onLost((k) => void lostRuns.push(k));
  const lost: HandoffLoss[] = [];
  const handoff = new RunHandoff({ store, credit: runs, onLost: (why) => void lost.push(why), locks: null, cloud: runs });
  /** The Run keys this device's progress copy holds the credit for. */
  const credited = () => meta.data.creditedRuns;
  /** `runEnded` on this device, as src/meta/install.ts routes it. */
  const end = (s: RunSnapshot, reason: RunCreditInput['reason'] = 'died') => runs.ended({ runKey: s.runKey, reason, stats: s.stats });
  return { storage, store, meta, runs, credits, handoff, lost, lostRuns, link, outcomes, credited, end };
};

/** Lets queued server work (uploads, takes, claims, the sweep) and its retries run. */
async function settle(...runs: AccountRuns[]): Promise<void> {
  for (let i = 0; i < 200 && runs.some((r) => r.pending > 0 || r.credits.pending > 0); i++) await new Promise((r) => setTimeout(r, 2));
  await Promise.all(runs.map((r) => r.credits.idle()));
  await new Promise((r) => setTimeout(r, 0));
}

const fakeGame = () => {
  const resumed: RunSnapshot[] = [];
  return { resumed, game: { resumeRun: (r: RunSnapshot) => void resumed.push(r) } as unknown as Game };
};

/** Device `d`'s title: sync with the Account, then Resume run on what it shows. */
async function resumeOn(d: ReturnType<typeof device>) {
  await d.runs.syncTitle();
  const shown = d.store.peek();
  if (!shown) return { res: 'none' as const, resumed: [] as RunSnapshot[] };
  const { game, resumed } = fakeGame();
  const res = await d.runs.resume(shown, () => resumeSuspendedRun(game, d.store, new MetaProgress(null), shown.runKey));
  return { res, resumed };
}

describe('Account saved Run (two devices, one server)', () => {
  it('pause on A uploads it; B offers it from another device and takes it', async () => {
    const server = new FakeServer();
    const a = device(server);
    const b = device(server);
    const s = snapshot();
    a.handoff.store(s, 'pause');
    await settle(a.runs);
    expect(server.row).toMatchObject({ runKey: s.runKey, version: SNAPSHOT_VERSION });
    expect(server.row?.snapshot).not.toHaveProperty('account'); // the device-only tag stays on the device
    expect(a.store.peek()?.account).toMatchObject({ userId: 'u1', synced: true });

    expect((await b.runs.syncTitle()).fromAccount).toBe(s.runKey);
    expect(b.store.peek()?.runKey).toBe(s.runKey);
    const { res, resumed } = await resumeOn(b);
    expect(res).toBe('mine');
    expect(resumed[0]?.runKey).toBe(s.runKey);
    expect(b.store.peek()).toBeNull();
    expect(server.row).toMatchObject({ runKey: s.runKey, snapshot: null });
  });

  it('unpausing on A is not delayed by the server; told B has the Run, A steps aside uncredited', async () => {
    const server = new FakeServer();
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
    const server = new FakeServer();
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
    const server = new FakeServer();
    const a = device(server);
    const s = snapshot();
    a.handoff.store(s, 'pause');
    await settle(a.runs);
    server.offline = true;
    expect(await a.handoff.takeBack()).toBe(true);
    server.offline = false;
    // B takes it before A's take gets through; A's take was superseded by its next pause's upload.
    server.row = { ...server.row!, lease: 'b-lease', snapshot: null, version: null };
    a.handoff.store(structuredClone(s), 'pause');
    await settle(a.runs);
    expect(a.lostRuns).toEqual([s.runKey]);
    expect(a.store.peek()).toBeNull(); // A's stale copy is gone from its device
  });

  it('two devices racing to resume the same Run: exactly one gets it', async () => {
    const server = new FakeServer();
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
    const server = new FakeServer();
    const a = device(server);
    const newer = { ...snapshot(), version: SNAPSHOT_VERSION + 1, somethingNew: true };
    server.row = { runKey: newer.runKey, lease: 'other', snapshot: newer as unknown as Record<string, unknown>, version: SNAPSHOT_VERSION + 1 };
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
    const server = new FakeServer();
    const a = device(server);
    const remote = snapshot('remote');
    server.row = { runKey: remote.runKey, lease: 'l1', snapshot: remote as unknown as Record<string, unknown>, version: SNAPSHOT_VERSION };
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
    const server = new FakeServer();
    const a = device(server);
    const local = snapshot('only-here');
    a.store.save(local);
    await a.runs.syncTitle();
    await settle(a.runs);
    expect(server.row?.runKey).toBe(local.runKey);
    expect(a.store.peek()?.account?.synced).toBe(true);
    server.row = null; // resumed and ended elsewhere
    await a.runs.syncTitle();
    await settle(a.runs);
    expect(a.store.peek()).toBeNull();
    expect(a.credited()).toEqual([]);
  });

  it('a Run that replaces another on the server credits the replaced one once, from the ledger row the upload returns', async () => {
    const server = new FakeServer();
    const a = device(server);
    const first = snapshot('first');
    a.handoff.store(first, 'pause');
    await settle(a.runs);
    a.handoff.forget();
    a.runs.newRun();
    // The device slot still holds `first`, an Account copy: the slot's replace claims it, and the upload
    // of `second` replaces it on the server, which records it as a quit. Two writers, one row, one credit.
    a.handoff.store(snapshot('second'), 'pause');
    await settle(a.runs);
    expect(server.ledger.map((c) => [c.runKey, c.reason])).toEqual([[first.runKey, 'quit']]);
    expect(a.credited()).toEqual([first.runKey]);
    expect(a.meta.data.stats.runs).toBe(1);
    // Another device's Run replaced on the server (not in this device's slot) is credited from the row too.
    const second = server.row!.runKey;
    const c = device(server);
    c.handoff.store(snapshot('third'), 'pause');
    await settle(c.runs);
    expect(c.credited()).toEqual([second]);
    expect(c.meta.data.stats.runs).toBe(1);
  });

  it('another Account’s saved Run is never offered, taken or credited', async () => {
    const server = new FakeServer();
    const a = device(server, 'u1');
    a.handoff.store(snapshot(), 'pause');
    await settle(a.runs);
    a.handoff.forget();
    a.runs.setUser('u2');
    server.row = null; // u2's Account has none
    expect(a.store.peek()).toBeNull();
    await a.runs.syncTitle();
    expect(a.store.peekAny()?.account?.userId).toBe('u1'); // still there for u1
    a.runs.setUser(null);
    expect(a.store.peek()).toBeNull(); // nor signed out
    a.runs.setUser('u1');
    expect(a.store.peek()).not.toBeNull();
    expect(a.credited()).toEqual([]);
  });

  it('not signed in: nothing goes to the server, and the Run is credited on the device at once', async () => {
    const server = new FakeServer();
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
    const server = new FakeServer();
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
    expect(a.outcomes).toEqual([]); // nothing landed later: it was credited up front
    // A late upload of it is refused.
    a.handoff.store(structuredClone(s), 'pause');
    await settle(a.runs);
    expect(a.lostRuns).toEqual([s.runKey]);
  });

  it('a Run the Account knows is credited from the server’s answer: pending until then, then once', async () => {
    const server = new FakeServer();
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
    const server = new FakeServer();
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
    const server = new FakeServer();
    const a = device(server);
    const s = snapshot();
    let open!: () => void;
    server.hold.put = new Promise((r) => (open = r));
    a.handoff.store(s, 'pause');
    a.handoff.forget(); // Save & quit: the title has it now
    const shown = a.store.peek()!;
    const abandoning = a.runs.abandon(shown, () => abandonSuspendedRun(a.store, a.runs));
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
    const server = new FakeServer();
    const a = device(server);
    const s = snapshot();
    let open!: () => void;
    server.hold.put = new Promise((r) => (open = r));
    a.handoff.store(s, 'pause');
    a.handoff.forget(); // Save & quit: the title has it now
    const shown = a.store.peek()!;
    const { game, resumed } = fakeGame();
    const resuming = a.runs.resume(shown, () => resumeSuspendedRun(game, a.store, new MetaProgress(null), shown.runKey));
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
    const server = new FakeServer();
    const a = device(server, 'u1');
    let open!: () => void;
    server.hold.put = new Promise((r) => (open = r));
    a.handoff.store(snapshot('u1-run'), 'pause'); // u1's upload is on its way...
    a.handoff.forget();
    a.runs.setUser('u2'); // ...when u2 signs in and pauses a Run
    a.runs.newRun();
    const mine = snapshot('u2-run');
    a.handoff.store(mine, 'pause');
    open();
    await settle(a.runs);
    expect(a.runs.pending).toBe(0);
    expect(server.calls).toEqual(['put', 'put']);
    expect(server.row?.runKey).toBe(mine.runKey);
  });

  it('the title syncs after this page’s own upload lands, so a Run it is storing is neither credited nor replaced', async () => {
    const server = new FakeServer();
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
    const server = new FakeServer();
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
    const held = (server: FakeServer, what: string) => {
      let open!: () => void;
      server.hold[what] = new Promise((r) => (open = r));
      return () => open();
    };

    it('an upload: a Run it replaced isn’t credited to the new Account', async () => {
      const server = new FakeServer();
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
      const server = new FakeServer();
      const a = device(server, 'u1');
      const s = snapshot();
      a.handoff.store(s, 'pause');
      await settle(a.runs);
      server.row = { ...server.row!, lease: 'b-lease', snapshot: null, version: null }; // another device took it
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
      const server = new FakeServer();
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
      const server = new FakeServer();
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
      const server = new FakeServer();
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
        const server = new FakeServer();
        const a = device(server, 'u1');
        a.handoff.store(snapshot(), 'pause');
        await settle(a.runs);
        a.handoff.forget();
        const shown = a.store.peek()!;
        const open = held(server, 'take');
        let started = 0;
        const resuming = a.runs.resume(shown, () => ++started > 0);
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
      const server = new FakeServer();
      const a = device(server, 'u1');
      const open = held(server, 'put');
      a.handoff.store(snapshot(), 'pause');
      a.handoff.forget();
      const shown = a.store.peek()!;
      let abandoned = 0;
      const abandoning = a.runs.abandon(shown, () => ++abandoned > 0);
      await new Promise((r) => setTimeout(r, 5));
      a.runs.setUser('u2');
      open();
      expect(await abandoning).toBe('failed');
      expect(abandoned).toBe(0);
      expect(a.credited()).toEqual([]);
    });
  });

  it('a device that fell behind can’t store a Run that ended elsewhere again', async () => {
    const server = new FakeServer();
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
      const server = new FakeServer();
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
      expect(await a.runs.abandon(shown, () => abandonSuspendedRun(a.store, a.runs))).toBe('done');
      await settle(a.runs);
      expect(a.credited()).toEqual([shown.runKey]);
      open();
      await syncing;
      expect(a.store.peek()).toBeNull();
      // The new Run starts: nothing left to abandon (and credit) again.
      a.runs.newRun();
      expect(abandonSuspendedRun(a.store, a.runs)).toBe(false);
      await settle(a.runs);
      expect(a.meta.data.stats.runs).toBe(1);
    });

    it('Resume: the Run this page now plays is not mirrored back into the slot', async () => {
      const server = new FakeServer();
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
      const { game } = fakeGame();
      expect(await a.runs.resume(shown, () => resumeSuspendedRun(game, a.store, new MetaProgress(null), shown.runKey))).toBe('mine');
      open();
      await syncing;
      expect(a.store.peek()).toBeNull();
      expect(a.credited()).toEqual([]);
    });

    it('a title read waits for a Resume still on its way', async () => {
      const server = new FakeServer();
      const a = device(server);
      const s = snapshot();
      a.handoff.store(s, 'pause');
      await settle(a.runs);
      a.handoff.forget();
      let open!: () => void;
      server.hold.take = new Promise((r) => (open = r));
      const shown = a.store.peek()!;
      const { game } = fakeGame();
      const resuming = a.runs.resume(shown, () => resumeSuspendedRun(game, a.store, new MetaProgress(null), shown.runKey));
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
    const server = new FakeServer();
    const a = device(server);
    const b = device(server);
    const r = snapshot('r');
    b.handoff.store(r, 'pause');
    await settle(b.runs);
    // Another tab of A's browser (one slot, one progress copy) mirrors R from the server on its title.
    const titleTab = new AccountRuns({
      api: server.api(),
      store: a.store,
      meta: a.meta,
      credits: new RunCreditQueue({ api: server.creditApi(), storage: a.storage, meta: a.meta, retryMs: 1, maxRetryMs: 4 }),
      retryMs: 1,
      maxRetryMs: 4,
      hidden: () => false,
    });
    titleTab.setUser('u1');
    await titleTab.syncTitle();
    expect(a.store.peek()).toMatchObject({ runKey: r.runKey, account: { synced: true } });
    // B unpauses R: the server take moves R to B's new lease.
    expect(await b.handoff.takeBack()).toBe(true);
    await settle(b.runs);
    // This tab of A plays S and pauses: S replaces the stale copy of R in the slot, and R is claimed...
    a.runs.newRun();
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
    const server = new FakeServer();
    const a = device(server);
    const b = device(server);
    const r = snapshot('r');
    b.handoff.store(r, 'pause');
    await settle(b.runs);
    b.handoff.forget(); // B's Save & quit: R stays on the server
    await a.runs.syncTitle();
    expect(a.store.peek()?.runKey).toBe(r.runKey);
    a.runs.newRun();
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
      const server = new FakeServer();
      const a = device(server);
      const b = device(server);
      const r = snapshot('r');
      b.handoff.store(r, 'pause');
      await settle(b.runs);
      await a.runs.syncTitle(); // A's slot mirrors R from the Account
      expect(a.store.peek()).toMatchObject({ runKey: r.runKey, account: { synced: true } });
      return { server, a, b, r };
    };

    it('taken by another device meanwhile: refused here (the holder credits it when it ends)', async () => {
      const { server, a, b, r } = await mirrored();
      expect(await b.handoff.takeBack()).toBe(true); // B unpauses R
      await settle(b.runs);
      a.runs.newRun();
      expect(abandonSuspendedRun(a.store, a.runs)).toBe(true);
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
      a.runs.newRun();
      expect(abandonSuspendedRun(a.store, a.runs)).toBe(true);
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
      const server = new FakeServer();
      const a = device(server);
      const b = device(server);
      const r = snapshot('r');
      b.handoff.store(r, 'pause');
      await settle(b.runs);
      b.handoff.forget();
      await a.runs.syncTitle(); // A mirrors R
      a.runs.newRun();
      server.loseAnswer.put = true; // the upload of S replaces R and records it, but A never hears the answer
      a.handoff.store(snapshot('s'), 'pause');
      await settle(a.runs);
      expect(server.calls.filter((c) => c === 'put').length).toBeGreaterThanOrEqual(2); // retried: the same Run again, nothing replaced
      expect(server.ledger.map((c) => c.runKey)).toEqual([r.runKey]);
      expect(a.credited()).toEqual([r.runKey]); // from the claim's answer (the same row)
      expect(a.meta.data.stats.runs).toBe(1);
    });

    it('1b. a lost answer with no claim of its own: the sweep from the title brings the row in', async () => {
      const server = new FakeServer();
      const a = device(server);
      const b = device(server);
      const r = snapshot('r');
      b.handoff.store(r, 'pause');
      await settle(b.runs);
      b.handoff.forget(); // R is on the server; A's slot never saw it (no mirror, so no claim of A's)
      a.runs.newRun();
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
      const server = new FakeServer();
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
      const server = new FakeServer();
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
      const server = new FakeServer();
      const a = device(server);
      const r1 = snapshot('r1');
      a.handoff.store(r1, 'pause');
      await settle(a.runs);
      a.handoff.forget();
      a.runs.newRun();
      const r2 = snapshot('r2');
      a.handoff.store(r2, 'pause'); // replaces R1 on the server: R1 is a quit in the ledger
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
      const server = new FakeServer();
      const a = device(server);
      const b = device(server);
      const r = snapshot('r');
      a.handoff.store(r, 'pause');
      await settle(a.runs);
      a.link.offline = true;
      expect(await a.handoff.takeBack()).toBe(true); // A unpauses offline
      await b.runs.syncTitle(); // B's title mirrors R...
      b.runs.newRun();
      b.handoff.store(snapshot('s'), 'pause'); // ...and B starts and pauses S: R is replaced and recorded as a quit
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
    const server = new FakeServer();
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
    const server = new FakeServer();
    const other = device(server);
    const r = snapshot('r');
    other.end(r); // a row in the ledger from elsewhere
    await settle(other.runs);
    // Two tabs of one browser: one storage, so one progress copy, read fresh on every write.
    const storage = memStorage();
    const tab = () => {
      const meta = new MetaProgress(storage);
      const credits = new RunCreditQueue({ api: server.creditApi(), storage, meta, retryMs: 1, maxRetryMs: 4 });
      const runs = new AccountRuns({ api: server.api(), store: new SuspendedRunStore(storage), meta, credits, retryMs: 1, maxRetryMs: 4, hidden: () => false });
      runs.setUser('u1');
      return { meta, runs, credits };
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
    const server = new FakeServer();
    for (let i = 0; i < RUN_CREDIT_LIST_LIMIT + 3; i++) server.record(`old-${i}`, 'died', { maxRadius: 1, debrisAbsorbed: 1, tierReached: 1 });
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

describe('AccountRuns: known Runs, Universes and claim stats (docs/adr/0003 review)', () => {
  it('a known Run stays known through a sign-out and back in mid-Run: its credit waits for the server, which refuses a Run another device took', async () => {
    const server = new FakeServer();
    const a = device(server);
    const b = device(server);
    const r = snapshot('r');
    a.handoff.store(r, 'pause'); // uploaded: the server knows R from A
    await settle(a.runs);
    expect(a.runs.knows(r.runKey)).toBe(true);
    expect(JSON.parse(a.storage.map.get(KNOWN_RUNS_KEY)!)).toEqual({ version: KNOWN_RUNS_VERSION, known: [r.runKey] });
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
    const server = new FakeServer();
    const a = device(server);
    const r = snapshot('r');
    a.handoff.store(r, 'pause');
    await settle(a.runs);
    const again = new AccountRuns({ api: server.api(), store: a.store, meta: a.meta, credits: a.credits, storage: a.storage, retryMs: 1, maxRetryMs: 4, hidden: () => false });
    again.setUser('u1');
    expect(again.knows(r.runKey)).toBe(true);
    const fresh = snapshot('fresh');
    expect(again.knows(fresh.runKey)).toBe(false);
    expect(again.ended({ runKey: fresh.runKey, reason: 'died', stats: fresh.stats })).not.toBeNull();
  });

  it('a Universe victory counts on the device that ended it (from its claim’s answer); another device’s sweep adds its Fluff only', async () => {
    const server = new FakeServer();
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
    const server = new FakeServer();
    const a = device(server);
    const r = snapshot('r');
    a.handoff.store(r, 'pause');
    await settle(a.runs);
    expect(await a.handoff.takeBack()).toBe(true);
    await settle(a.runs);
    server.row = { ...server.row!, snapshot: null, version: null, ended: true }; // an old-build tab ended R and credited it itself
    expect(a.end(r)).toBeNull();
    await settle(a.runs);
    expect(a.runs.creditOf(r.runKey)).toEqual({ state: 'refused', why: 'elsewhere' });
    expect(a.credited()).toEqual([]);
    expect(a.credits.pending).toBe(0);
    expect(server.ledger).toEqual([]);
  });
});
