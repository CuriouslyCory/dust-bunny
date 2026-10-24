/**
 * The Account's saved Run (src/meta/accountRun.ts): two devices (each its own storage and slot),
 * one fake server that follows api/saved-run.ts's rules (server/api.test.ts checks the real one).
 */
import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/events';
import { createRun } from '../game/assembly';
import type { Game } from '../game/game';
import { RunHandoff, type HandoffLoss } from '../game/handoff';
import { SNAPSHOT_VERSION, type RunSnapshot } from '../game/snapshot';
import type { ServerSavedRun } from '../shared/savedRun';
import { abandonSavedRun, AccountRuns, gateRunEnding, SavedRunNetError, type PutResult, type SavedRunApi, type TakeResult } from './accountRun';
import { MetaProgress } from './meta';
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

type Award = Parameters<MetaProgress['awardRun']>[0];
const awards = () => {
  const calls: Award[] = [];
  return { calls, awardRun: (e: Award) => void calls.push(e) } as unknown as Pick<MetaProgress, 'awardRun'> & { calls: Award[] };
};

interface Row {
  runKey: string;
  lease: string;
  snapshot: Record<string, unknown> | null;
  version: number | null;
  /** The Run ended (or was abandoned): the row stays so a late upload of it is refused. */
  ended?: boolean;
}

/** One Account's row, with api/saved-run.ts's rules. `offline`: every request fails. `calls`: what was asked. */
class FakeServer {
  row: Row | null = null;
  offline = false;
  /** While set, every answer waits for it (a slow network). */
  gate: Promise<void> | null = null;
  /** Answers to one kind of request (`put`, `take`, …) wait for its promise (that request is slow). */
  hold: Partial<Record<string, Promise<void>>> = {};
  calls: string[] = [];

  /** `link.offline`: this device alone can't reach the server. */
  api(link: { offline: boolean } = { offline: false }): SavedRunApi {
    const net = async (what: string): Promise<void> => {
      this.calls.push(what);
      if (this.gate) await this.gate;
      if (this.hold[what]) await this.hold[what];
      if (this.offline || link.offline) throw new SavedRunNetError('offline');
    };
    const view = ({ ended: _ended, ...r }: Row): ServerSavedRun => ({ ...structuredClone(r), updatedAt: new Date(0).toISOString() });
    return {
      get: async () => {
        // Read as the request arrives; a slow answer (`gate`, `hold`) reports the row as it was then.
        const row = this.row && !this.row.ended ? view(this.row) : null;
        await net('get');
        return row;
      },
      put: async (b): Promise<PutResult> => {
        await net('put');
        const snap = structuredClone(b.snapshot) as Record<string, unknown>;
        const version = snap.version as number;
        const old = this.row;
        if (old?.ended && old.runKey === b.runKey) return { ok: false, reason: 'carriedOn' }; // 409 run_ended
        if (old && old.runKey === b.runKey && old.lease !== b.lease && old.lease !== b.prevLease) return { ok: false, reason: 'carriedOn' };
        if (old && old.runKey !== b.runKey && old.snapshot && (old.version ?? 0) > version) return { ok: false, reason: 'newer' };
        this.row = { runKey: b.runKey, lease: b.lease, snapshot: snap, version };
        return { ok: true, replaced: old && old.runKey !== b.runKey && old.snapshot ? { runKey: old.runKey, snapshot: old.snapshot } : null };
      },
      take: async (b): Promise<TakeResult> => {
        await net('take');
        const r = this.row;
        if (!r || r.ended || r.runKey !== b.runKey || (r.lease !== b.lease && r.lease !== b.newLease)) return { taken: false, savedRun: r ? view(r) : null };
        const snap = r.snapshot;
        this.row = { ...r, lease: b.newLease, snapshot: null, version: null };
        return { taken: true, snapshot: snap };
      },
      end: async (b) => {
        await net('end');
        const r = this.row;
        const deleted = !!r && !r.ended && r.runKey === b.runKey && (r.lease === b.lease || r.lease === b.prevLease);
        if (deleted) this.row = { ...r, snapshot: null, version: null, ended: true };
        else if (!r || (r.ended && r.runKey !== b.runKey)) this.row = { runKey: b.runKey, lease: b.lease, snapshot: null, version: null, ended: true };
        return { deleted };
      },
    };
  }
}

/** A device: its own storage and slot, signed in as `user`. */
const device = (server: FakeServer, user: string | null = 'u1') => {
  const storage = memStorage();
  const store = new SuspendedRunStore(storage);
  const meta = awards();
  const link = { offline: false };
  const runs = new AccountRuns({ api: server.api(link), store, meta, retryMs: 1, maxRetryMs: 4, hidden: () => false });
  runs.setUser(user);
  const lostRuns: string[] = [];
  runs.onLost((k) => void lostRuns.push(k));
  const lost: HandoffLoss[] = [];
  const handoff = new RunHandoff({ store, meta, onLost: (why) => void lost.push(why), locks: null, cloud: runs });
  return { storage, store, meta, runs, handoff, lost, lostRuns, link };
};

/** Lets queued server work (and its retries) run. */
async function settle(...runs: AccountRuns[]): Promise<void> {
  for (let i = 0; i < 200 && runs.some((r) => r.pending > 0); i++) await new Promise((r) => setTimeout(r, 2));
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
    expect(a.meta.calls).toEqual([]);
    expect(b.meta.calls).toEqual([]);
    expect(await a.runs.confirmHeld(s.runKey)).toBe(false);
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
    b.runs.ended(s.runKey); // B plays it to the end (and credits it there)
    await settle(b.runs);
    expect(server.row).toMatchObject({ runKey: s.runKey, snapshot: null, ended: true });
    a.link.offline = false; // A reconnects
    await settle(a.runs);
    expect(a.lostRuns).toEqual([s.runKey]);
    expect(a.meta.calls).toEqual([]);
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
    expect(server.calls).toEqual(['get']); // no take, no delete, no upload
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
    expect(a.meta.calls).toEqual([]);
  });

  it('the server copy wins on the title; a different Run only this device had counts as quit', async () => {
    const server = new FakeServer();
    const a = device(server);
    const remote = snapshot('remote');
    server.row = { runKey: remote.runKey, lease: 'l1', snapshot: remote as unknown as Record<string, unknown>, version: SNAPSHOT_VERSION };
    const local = snapshot('local');
    a.store.save(local); // saved before signing in: untagged
    await a.runs.syncTitle();
    expect(a.meta.calls).toHaveLength(1);
    expect(a.store.peek()?.runKey).toBe(remote.runKey);
    // Syncing again changes nothing and credits nothing.
    await a.runs.syncTitle();
    expect(a.meta.calls).toHaveLength(1);
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
    expect(a.store.peek()).toBeNull();
    expect(a.meta.calls).toEqual([]);
  });

  it('a Run that replaces another on the server credits the replaced one once', async () => {
    const server = new FakeServer();
    const a = device(server);
    const first = snapshot('first');
    a.handoff.store(first, 'pause');
    await settle(a.runs);
    a.handoff.forget();
    a.runs.newRun();
    // The device slot still holds `first`, confirmed by the server: the slot's replace leaves it to the
    // server's answer, which hands it back (nobody took it), and it is credited from that, once.
    a.handoff.store(snapshot('second'), 'pause');
    await settle(a.runs);
    expect(a.meta.calls).toHaveLength(1);
    // Another device's Run replaced on the server (not in this device's slot) is credited from the server's copy.
    const c = device(server);
    c.handoff.store(snapshot('third'), 'pause');
    await settle(c.runs);
    expect(c.meta.calls).toHaveLength(1);
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
  });

  it('not signed in: nothing goes to the server', async () => {
    const server = new FakeServer();
    const a = device(server, null);
    const s = snapshot();
    a.handoff.store(s, 'pause');
    expect(await a.handoff.takeBack()).toBe(true);
    await a.runs.syncTitle();
    a.runs.ended(s.runKey);
    await settle(a.runs);
    expect(server.calls).toEqual([]);
    expect(a.store.peek()).toBeNull();
  });

  it('ending the Run deletes the row only under this page’s lease', async () => {
    const server = new FakeServer();
    const a = device(server);
    const s = snapshot();
    a.handoff.store(s, 'pause');
    await settle(a.runs);
    expect(await a.handoff.takeBack()).toBe(true);
    expect(await a.runs.confirmHeld(s.runKey)).toBe(true);
    a.runs.ended(s.runKey);
    await settle(a.runs);
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
    expect(await a.runs.confirmHeld(s.runKey)).toBe(true);
    expect((await resumeOn(b)).res).toBe('none');
    expect(a.lostRuns).toEqual([]);
  });

  it('New run on the title waits for the Save & quit upload, so the abandoned Run isn’t stored again', async () => {
    const server = new FakeServer();
    const a = device(server);
    const s = snapshot();
    let open!: () => void;
    server.hold.put = new Promise((r) => (open = r));
    a.handoff.store(s, 'pause');
    a.handoff.forget(); // Save & quit: the title has it now
    const shown = a.store.peek()!;
    const abandoning = a.runs.abandon(shown, () => abandonSuspendedRun(a.store, a.meta));
    await new Promise((r) => setTimeout(r, 10));
    expect(server.calls).toEqual(['put']); // the delete waits for the upload
    open();
    expect(await abandoning).toBe('done');
    await settle(a.runs);
    expect(server.calls).toEqual(['put', 'end']);
    expect(a.lostRuns).toEqual([]);
    expect(server.row).toMatchObject({ runKey: s.runKey, snapshot: null, ended: true });
    expect(a.meta.calls).toHaveLength(1); // credited once, here
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
    expect(await a.runs.confirmHeld(s.runKey)).toBe(true);
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
    expect(server.calls).toEqual(['put', 'get']);
    expect(server.row?.runKey).toBe(mine.runKey);
    expect(a.store.peek()?.runKey).toBe(mine.runKey);
    expect(a.meta.calls).toHaveLength(1); // the Run it replaced on the server, once; not its own
    expect(a.meta.calls[0]?.stats.seed).toBe('there');
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
      expect(a.meta.calls).toEqual([]); // ...but its replaced Run isn't u2's to credit
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

    it('New run: not abandoned (nor credited) on the device, online or offline', async () => {
      for (const offline of [false, true]) {
        const server = new FakeServer();
        const a = device(server, 'u1');
        a.handoff.store(snapshot(), 'pause');
        await settle(a.runs);
        a.handoff.forget();
        const shown = a.store.peek()!;
        const open = held(server, 'end');
        let abandoned = 0;
        const abandoning = a.runs.abandon(shown, () => ++abandoned > 0);
        await new Promise((r) => setTimeout(r, 5));
        a.link.offline = offline;
        a.runs.setUser('u2');
        open();
        expect(await abandoning).toBe('failed');
        expect(abandoned).toBe(0);
        expect(a.runs.pending).toBe(0);
      }
    });
  });

  describe('dying or winning while the take back is unconfirmed (as End run, via gateRunEnding)', () => {
    /** A Run in progress on device `d`, paused and stored, with its endings counted (as the meta install credits them). */
    const playing = async (d: ReturnType<typeof device>, timeoutMs?: number) => {
      const bus = new EventBus();
      const run = createRun(bus, { seed: 'ending', characterId: 'zap' });
      for (let i = 0; i < 30; i++) run.update(1 / 60);
      const credited: string[] = [];
      bus.on('runEnded', (e) => {
        credited.push(e.reason);
        d.meta.awardRun(e);
        d.runs.ended(run.runKey);
      });
      let lost = 0;
      let waited = 0;
      gateRunEnding(run, d.runs, { waiting: () => void waited++, lost: () => void lost++, ...(timeoutMs ? { timeoutMs } : {}) });
      d.handoff.store(run.toSnapshot(), 'pause');
      await settle(d.runs);
      return { run, credited, lost: () => lost, waited: () => waited };
    };

    it('refused (another device took it): not credited, and the page steps aside', async () => {
      const server = new FakeServer();
      const a = device(server);
      const p = await playing(a);
      server.row = { ...server.row!, lease: 'b-lease', snapshot: null, version: null }; // B resumed it
      let open!: () => void;
      server.hold.take = new Promise((r) => (open = r));
      expect(await a.handoff.takeBack()).toBe(true);
      p.run.end('died');
      expect(p.credited).toEqual([]); // held while the take is on its way
      expect(p.waited()).toBe(1);
      open();
      await settle(a.runs);
      await new Promise((r) => setTimeout(r, 10));
      expect(p.credited).toEqual([]);
      expect(a.meta.calls).toEqual([]);
      expect(p.lost()).toBe(1);
      expect(server.row).toMatchObject({ lease: 'b-lease' }); // B's Run is left alone
    });

    it('confirmed: credited once, after the take', async () => {
      const server = new FakeServer();
      const a = device(server);
      const p = await playing(a);
      let open!: () => void;
      server.hold.take = new Promise((r) => (open = r));
      expect(await a.handoff.takeBack()).toBe(true);
      p.run.end('victory');
      expect(p.credited).toEqual([]);
      open();
      await settle(a.runs);
      await new Promise((r) => setTimeout(r, 10));
      expect(p.credited).toEqual(['victory']);
      expect(a.meta.calls).toHaveLength(1);
      expect(p.lost()).toBe(0);
      expect(server.row).toMatchObject({ snapshot: null, ended: true });
    });

    it('offline: the device’s word after the timeout, as End run', async () => {
      const server = new FakeServer();
      const a = device(server);
      const p = await playing(a, 30);
      a.link.offline = true;
      expect(await a.handoff.takeBack()).toBe(true);
      p.run.end('died');
      expect(p.credited).toEqual([]);
      await new Promise((r) => setTimeout(r, 60));
      expect(p.credited).toEqual(['died']);
      expect(p.lost()).toBe(0);
    });

    it('take already confirmed, quit, or signed out: credited at once', async () => {
      const server = new FakeServer();
      const a = device(server);
      const p = await playing(a);
      expect(await a.handoff.takeBack()).toBe(true);
      await settle(a.runs);
      p.run.end('died');
      expect(p.credited).toEqual(['died']);
      expect(p.waited()).toBe(0);

      const b = device(server);
      const q = await playing(b);
      b.link.offline = true;
      expect(await b.handoff.takeBack()).toBe(true);
      q.run.end('quit'); // End run confirmed already (Game.endRun)
      expect(q.credited).toEqual(['quit']);

      const c = device(server, null);
      const r = await playing(c);
      expect(await c.handoff.takeBack()).toBe(true);
      r.run.end('died');
      expect(r.credited).toEqual(['died']);
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
    b.runs.ended(s.runKey); // B ends (and credits) it
    await settle(b.runs);
    a.link.offline = false;
    await settle(a.runs);
    expect(a.lostRuns).toEqual([s.runKey]);
    expect(server.row).toMatchObject({ runKey: s.runKey, snapshot: null, ended: true });
    expect(a.store.peek()).toBeNull();
    expect(a.meta.calls).toEqual([]);
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
      expect(await a.runs.abandon(shown, () => abandonSuspendedRun(a.store, a.meta))).toBe('done');
      expect(a.meta.calls).toHaveLength(1);
      open();
      await syncing;
      expect(a.store.peek()).toBeNull();
      // The new Run starts: nothing left to abandon (and credit) again.
      a.runs.newRun();
      expect(abandonSavedRun(a.store, a.meta, a.runs)).toBe(false);
      expect(a.meta.calls).toHaveLength(1);
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
      expect(a.meta.calls).toEqual([]);
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

  it('a mirrored Account copy replaced on pause is credited only by the server, so a Run taken elsewhere isn’t credited twice', async () => {
    const server = new FakeServer();
    const a = device(server);
    const b = device(server);
    const r = snapshot('r');
    b.handoff.store(r, 'pause');
    await settle(b.runs);
    // Another tab of A's browser (one slot) mirrors R from the server on its title.
    const titleTab = new AccountRuns({ api: server.api(), store: a.store, meta: a.meta, retryMs: 1, maxRetryMs: 4, hidden: () => false });
    titleTab.setUser('u1');
    await titleTab.syncTitle();
    expect(a.store.peek()).toMatchObject({ runKey: r.runKey, account: { synced: true } });
    // B unpauses R: the server take is confirmed, so B will credit R when it ends.
    expect(await b.handoff.takeBack()).toBe(true);
    await settle(b.runs);
    expect(await b.runs.confirmHeld(r.runKey)).toBe(true);
    // This tab of A plays S and pauses: S replaces the stale copy of R in the slot...
    a.runs.newRun();
    a.handoff.store(snapshot('s'), 'pause');
    await settle(a.runs);
    // ...but R is B's Run in progress: no stored copy came back from the server, so nothing is credited here.
    expect(a.meta.calls).toEqual([]);
    expect(b.lostRuns).toEqual([]);
  });

  it('a mirrored Account copy nobody took is credited once, from the server’s answer, when Save & quit replaces it', async () => {
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
    expect(a.meta.calls).toEqual([]); // not by the slot's replace...
    await settle(a.runs);
    expect(a.meta.calls).toHaveLength(1); // ...but by the server's, which handed R back
    expect(b.meta.calls).toEqual([]);
  });
});
