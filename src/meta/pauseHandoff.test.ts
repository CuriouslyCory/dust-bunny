/**
 * Pause hand-off rules (src/meta/savedRuns.ts over the slot in src/meta/suspendedRun.ts, and
 * src/game/handoff.ts): two tabs, two `SavedRuns`, one storage. Signed out unless a test says so.
 */
import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/events';
import { createRun } from '../game/assembly';
import { RunHandoff, type HandoffLoss } from '../game/handoff';
import { parseRunSnapshot, SNAPSHOT_VERSION, type RunSnapshot } from '../game/snapshot';
import { MetaProgress } from './meta';
import { SavedRuns, type SavedRunsMeta } from './savedRuns';
import { memStorage, TestServer, USER } from './savedRunsTestServer';
import { SAVED_RUN_LOCK, SUSPENDED_RUN_KEY, SuspendedRunStore, withSavedRunLock, type LockManagerLike } from './suspendedRun';

const snapshot = (seconds = 1): RunSnapshot => {
  const run = createRun(new EventBus(), { seed: 'handoff', characterId: 'zap' });
  for (let i = 0; i < 60 * seconds; i++) run.update(1 / 60);
  return run.toSnapshot();
};

/** Web Locks stand-in: one lock, granted in request order, as `navigator.locks` is across tabs. */
const fifoLocks = (): LockManagerLike & { requests: string[] } => {
  let tail: Promise<unknown> = Promise.resolve();
  const requests: string[] = [];
  return {
    requests,
    request<T>(name: string, cb: () => T | Promise<T>): Promise<T> {
      requests.push(name);
      const r = tail.then(cb);
      tail = r.catch(() => {});
      return r;
    },
  };
};

type Award = Parameters<MetaProgress['awardRun']>[0];
/** A progress stand-in that records what it was credited. */
const awards = () => {
  const calls: Award[] = [];
  const awardRun = (e: Award) => void calls.push(e);
  return { calls, awardRun, credited: () => false, creditedRunsKnown: () => true, data: new MetaProgress(null).data } as unknown as SavedRunsMeta & { calls: Award[] };
};

/** A tab: its saved Run over `storage` (shared with the other tabs), signed out. */
const tab = (storage: ReturnType<typeof memStorage>, meta = awards(), locks: LockManagerLike | null = null) => new SavedRuns({ storage, meta, ...new TestServer().client(), locks });

/** Resume run in `t` for the Run keyed `runKey`; what it started. */
async function resumeIn(t: SavedRuns, runKey: string) {
  const resumed: RunSnapshot[] = [];
  const res = await t.resume(runKey, (s) => void resumed.push(s));
  return { res, resumed };
}

describe('Pause hand-off rules (two tabs, one storage)', () => {
  it('pause then unpause in one tab leaves the slot empty and credits nothing', async () => {
    const storage = memStorage();
    const meta = awards();
    const tabA = tab(storage, meta);
    const s = snapshot();
    tabA.pause(s, 'h1');
    expect(new SuspendedRunStore(storage).peek()?.handoffId).toBe('h1');
    expect(tabA.pausedState('h1', s.runKey)).toBe('mine');
    expect(await tabA.takeBack('h1', s.runKey)).toBe('mine');
    expect(storage.map.has(SUSPENDED_RUN_KEY)).toBe(false);
    expect(meta.calls).toEqual([]);
  });

  it('a Run picked up in tab B is not tab A’s to take back (or end and credit)', async () => {
    const storage = memStorage();
    const meta = awards();
    const tabA = tab(storage, meta);
    const tabB = tab(storage, meta);
    const s = snapshot();
    tabA.pause(s, 'h1');
    const { res, resumed } = await resumeIn(tabB, s.runKey);
    expect(res).toBe('mine');
    expect(resumed[0]?.runKey).toBe(s.runKey);
    expect(tabA.pausedState('h1', s.runKey)).toBe('carriedOn');
    expect(await tabA.takeBack('h1', s.runKey)).toBe('carriedOn');
    // B pauses it in turn: the same Run under B's hand-off is still not A's.
    tabB.pause(structuredClone(s), 'h2');
    expect(await tabA.takeBack('h1', s.runKey)).toBe('carriedOn');
    expect(tabB.slot.peek()?.handoffId).toBe('h2');
    expect(meta.calls).toEqual([]);
  });

  it('New run in tab B credits the paused Run once; tab A finds it gone', async () => {
    const storage = memStorage();
    const meta = awards();
    const tabA = tab(storage, meta);
    const tabB = tab(storage, meta);
    const s = snapshot();
    tabA.pause(s, 'h1');
    expect(await tabB.abandon(s.runKey)).toBe('done');
    expect(meta.calls).toHaveLength(1);
    expect(await tabA.takeBack('h1', s.runKey)).toBe('carriedOn');
    expect(meta.calls).toHaveLength(1);
  });

  it('another Run stored over a paused one credits it once; the pausing tab reads it as replaced', async () => {
    const storage = memStorage();
    const meta = awards();
    const tabA = tab(storage, meta);
    const tabB = tab(storage, meta);
    const a = snapshot();
    tabA.pause(a, 'h1');
    const b = snapshot();
    expect(b.runKey).not.toBe(a.runKey);
    tabB.pause(b, 'h2');
    expect(meta.calls.map((c) => c.reason)).toEqual(['quit']);
    expect(await tabA.takeBack('h1', a.runKey)).toBe('replaced');
    expect(tabB.slot.peek()?.runKey).toBe(b.runKey);
  });

  it('a replaced Account copy is claimed from the server under its holder’s lease (Save & quit and pause)', async () => {
    for (const replace of [(t: SavedRuns, s: RunSnapshot) => void t.save(s), (t: SavedRuns, s: RunSnapshot) => t.pause(s, 'h2')]) {
      const server = new TestServer();
      // Another device stored `prev` with the Account; this device's title mirrors it.
      const prev = snapshot();
      expect(await server.runs.store(USER, { runKey: prev.runKey, lease: 'l-prev', snapshot: prev as unknown as Record<string, unknown>, version: SNAPSHOT_VERSION, ledger: true })).toMatchObject({ ok: true });
      const storage = memStorage();
      const t = new SavedRuns({ storage, meta: new MetaProgress(storage), ...server.client(), locks: null, retryMs: 1, maxRetryMs: 4, hidden: () => false });
      t.setUser(USER);
      await t.syncTitle();
      expect(t.slot.peek()?.runKey).toBe(prev.runKey);
      // The replacing upload is slow: the claim lands first, so only the mirrored copy's lease can win it.
      let open!: () => void;
      server.hold.put = new Promise((r) => (open = r));
      replace(t, snapshot(2));
      await t.credits.idle();
      expect(server.ledger.map((c) => [c.runKey, c.reason])).toEqual([[prev.runKey, 'quit']]);
      expect(t.creditOf(prev.runKey)).toMatchObject({ state: 'credited' });
      open();
    }
  });

  it('pausing the same Run again credits nothing, and only the newest hand-off owns it', () => {
    const meta = awards();
    const t = tab(memStorage(), meta);
    const s = snapshot();
    t.pause(s, 'h1');
    t.pause(structuredClone(s), 'h2');
    expect(meta.calls).toEqual([]);
    expect(t.pausedState('h1', s.runKey)).toBe('carriedOn');
    expect(t.pausedState('h2', s.runKey)).toBe('mine');
  });

  it('a slot this build can’t read is left alone and is not the pausing tab’s', async () => {
    const storage = memStorage();
    const t = tab(storage);
    const s = snapshot();
    t.pause(s, 'h1');
    const newer = JSON.stringify({ ...s, version: 99 });
    storage.setItem(SUSPENDED_RUN_KEY, newer);
    expect(await t.takeBack('h1', s.runKey)).toBe('carriedOn');
    expect(storage.getItem(SUSPENDED_RUN_KEY)).toBe(newer);
  });

  it('a write that fails is reported, and the Run stays this page’s to take back', async () => {
    const storage = memStorage();
    const meta = awards();
    const t = tab(storage, meta);
    const store = t.slot;
    const other = snapshot();
    store.save(other); // another tab's Run, already stored
    const s = snapshot();
    const setItem = storage.setItem;
    storage.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    t.pause(s, 'h1');
    expect(store.unsaved).toBe(true); // only this page's memory holds it
    // The Run already in storage is still there: not credited.
    expect(meta.calls).toEqual([]);
    expect(await t.takeBack('h1', s.runKey)).toBe('mine');
    // Taking it back drops only this page's copy: the other Run, never replaced, is still stored
    // (removeItem would have worked even though setItem didn't) and this page sees it again.
    expect(parseRunSnapshot(JSON.parse(storage.getItem(SUSPENDED_RUN_KEY)!))?.runKey).toBe(other.runKey);
    expect(store.unsaved).toBe(false);
    expect(store.peek()?.runKey).toBe(other.runKey);
    expect(new SuspendedRunStore(storage).peek()?.runKey).toBe(other.runKey);
    // A pause write that sticks is taken back from storage as before.
    storage.setItem = setItem;
    t.pause(structuredClone(s), 'h2');
    expect(store.unsaved).toBe(false);
    expect(await t.takeBack('h2', s.runKey)).toBe('mine');
    expect(storage.map.has(SUSPENDED_RUN_KEY)).toBe(false);
  });

  it('a Perk draft pending when the Run was stored opens again where it is picked up', async () => {
    const storage = memStorage();
    const tabA = tab(storage);
    const tabB = tab(storage);
    const run = createRun(new EventBus(), { seed: 'handoff', characterId: 'zap' });
    run.perkDraft.queue();
    tabA.pause(run.toSnapshot(), 'h1');
    const { res, resumed } = await resumeIn(tabB, run.runKey);
    expect(res).toBe('mine');
    const s = resumed[0]!;
    const back = createRun(new EventBus(), { seed: s.seed, characterId: s.characterId, modifiers: s.modifiers, loadout: s.loadout, resume: s });
    expect(back.perkDraft.active).toBe(true);
    expect(back.perkDraft.pending).toBe(1);
  });

  it('snapshots without a handoffId still parse; a malformed one is rejected', () => {
    const raw = JSON.parse(JSON.stringify(snapshot()));
    expect(parseRunSnapshot(raw)?.handoffId).toBeUndefined();
    expect(parseRunSnapshot({ ...raw, handoffId: 'x' })?.handoffId).toBe('x');
    expect(parseRunSnapshot({ ...raw, handoffId: 3 })).toBeNull();
    expect(parseRunSnapshot({ ...raw, handoffId: '' })).toBeNull();
  });
});

describe('the saved Run lock', () => {
  it('runs takes one at a time under dust-bunny:saved-run: of two racing tabs, one gets the Run', async () => {
    const storage = memStorage();
    const locks = fifoLocks();
    const tabA = tab(storage, awards(), locks);
    const tabB = tab(storage, awards(), locks);
    const s = snapshot();
    tabA.pause(s, 'h1');
    await withSavedRunLock(() => undefined, locks); // A's store is written
    const [b, a] = await Promise.all([resumeIn(tabB, s.runKey), tabA.takeBack('h1', s.runKey)]);
    expect(b.res).toBe('mine');
    expect(a).toBe('carriedOn');
    expect(b.resumed).toHaveLength(1);
    expect(locks.requests).toEqual([SAVED_RUN_LOCK, SAVED_RUN_LOCK, SAVED_RUN_LOCK, SAVED_RUN_LOCK]);
  });

  it('two tabs saving over the same Run at once credit it only once', async () => {
    const storage = memStorage();
    const locks = fifoLocks();
    const meta = awards();
    const tabB = tab(storage, meta, locks);
    const tabC = tab(storage, meta, locks);
    const old = snapshot();
    new SuspendedRunStore(storage).save(old);
    const b = snapshot();
    const c = snapshot();
    await Promise.all([tabB.save(b), tabC.save(c)]);
    // The old Run once, then B's (replaced by C's): never the old one twice.
    expect(meta.calls.map((e) => e.stats)).toEqual([old.stats, b.stats]);
    expect(tabB.slot.peek()?.runKey).toBe(c.runKey);
  });

  it('without Web Locks it runs at once, synchronously (and a failing lock request rejects)', async () => {
    const failing: LockManagerLike = { request: () => Promise.reject(new Error('SecurityError')) };
    await expect(withSavedRunLock(() => 1, failing)).rejects.toThrow('SecurityError');
    let ran = false;
    const p = withSavedRunLock(() => (ran = true), null);
    expect(ran).toBe(true);
    await expect(p).resolves.toBe(true);
  });
});

describe('RunHandoff (src/game/handoff.ts): two pages, one storage', () => {
  /** A page: its saved Run, its hand-off and what it was told about losing the Run. */
  const page = (storage: ReturnType<typeof memStorage>, locks: LockManagerLike | null, meta = awards()) => {
    const runs = tab(storage, meta, locks);
    const lost: HandoffLoss[] = [];
    const handoff = new RunHandoff({ runs, onLost: (why) => void lost.push(why) });
    return { runs, store: runs.slot, handoff, lost, meta };
  };

  for (const [name, mkLocks] of [
    ['with Web Locks', fifoLocks],
    ['without Web Locks', () => null],
  ] as const) {
    describe(name, () => {
      it('pause then unpause: the slot is empty again and the page plays on', async () => {
        const storage = memStorage();
        const a = page(storage, mkLocks());
        const s = snapshot();
        a.handoff.store(s, 'pause');
        expect(a.handoff.holding).toBe('pause');
        const ok = a.handoff.takeBack();
        expect(a.handoff.busy).toBe(true);
        expect(await ok).toBe(true);
        expect(a.handoff.busy).toBe(false);
        expect(a.handoff.holding).toBeNull();
        expect(storage.map.has(SUSPENDED_RUN_KEY)).toBe(false);
        expect(a.lost).toEqual([]);
      });

      it('pause in A, Resume run in B: A learns at once (storage event), and its unpause is refused', async () => {
        const storage = memStorage();
        const locks = mkLocks();
        const a = page(storage, locks);
        const b = page(storage, locks);
        const s = snapshot();
        a.handoff.store(s, 'pause');
        await withSavedRunLock(() => undefined, locks); // A's store is written
        expect(b.store.peek()?.handoffId).toBe(a.handoff.handoffId);
        const { res, resumed } = await resumeIn(b.runs, s.runKey);
        expect(res).toBe('mine');
        expect(resumed).toHaveLength(1);
        // The browser's storage event in A:
        a.store.storageChanged();
        expect(a.lost).toEqual(['carriedOn']);
        expect(a.handoff.holding).toBeNull();
        // Nothing left for A to take back or end; nothing credited by either page.
        expect(await a.handoff.takeBack()).toBe(true);
        expect(a.meta.calls).toEqual([]);
        expect(b.meta.calls).toEqual([]);
      });

      it('without the storage event, unpausing (or Quit to title) finds the Run taken and steps aside', async () => {
        const storage = memStorage();
        const locks = mkLocks();
        const a = page(storage, locks);
        const b = page(storage, locks);
        const s = snapshot();
        a.handoff.store(s, 'pause');
        await withSavedRunLock(() => undefined, locks); // A's store is written
        expect((await resumeIn(b.runs, s.runKey)).res).toBe('mine');
        expect(await a.handoff.takeBack()).toBe(false);
        expect(a.lost).toEqual(['carriedOn']);
        expect(a.meta.calls).toEqual([]);
      });

      it('another page saving a different Run over it: A is told it was replaced', async () => {
        const storage = memStorage();
        const locks = mkLocks();
        const a = page(storage, locks);
        const b = page(storage, locks, a.meta);
        a.handoff.store(snapshot(), 'pause');
        b.handoff.store(snapshot(), 'pause');
        await withSavedRunLock(() => undefined, locks);
        a.store.storageChanged();
        expect(a.lost).toEqual(['replaced']);
        expect(a.meta.calls).toHaveLength(1);
        expect(await b.handoff.takeBack()).toBe(true);
      });

      it('its own writes and unrelated changes do not make it step aside', async () => {
        const storage = memStorage();
        const a = page(storage, mkLocks());
        a.handoff.store(snapshot(), 'hidden');
        a.store.storageChanged();
        await Promise.resolve();
        a.store.storageChanged();
        expect(a.lost).toEqual([]);
        expect(a.handoff.holding).toBe('hidden');
      });

      it('storing while holding does nothing; Save & quit lets go and leaves the Run in the slot', async () => {
        const storage = memStorage();
        const locks = mkLocks();
        const a = page(storage, locks);
        const s = snapshot();
        a.handoff.store(s, 'pause');
        const id = a.handoff.handoffId;
        a.handoff.store(snapshot(), 'pause');
        expect(a.handoff.handoffId).toBe(id);
        expect(a.handoff.leaveStored()).toBeNull();
        expect(a.handoff.holding).toBeNull();
        a.handoff.forget(); // disposeRun
        await withSavedRunLock(() => undefined, locks);
        expect(a.store.peek()?.runKey).toBe(s.runKey);
      });

      it('flush writes a store still waiting for the lock (the tab closing)', () => {
        const storage = memStorage();
        const a = page(storage, mkLocks());
        const s = snapshot();
        a.handoff.store(s, 'pause');
        a.runs.flush();
        expect(new SuspendedRunStore(storage).peek()?.runKey).toBe(s.runKey);
      });
    });
  }

  it('Save & quit with the store still waiting for the lock writes it under the lock, not outside it', async () => {
    const storage = memStorage();
    const locks = fifoLocks();
    const a = page(storage, locks);
    const b = page(storage, locks);
    const s = snapshot();
    let release!: () => void;
    // Another tab holds the lock: A's store waits behind it.
    const other = withSavedRunLock(() => new Promise<void>((res) => (release = res)), locks);
    a.handoff.store(s, 'pause');
    await Promise.resolve();
    expect(a.handoff.leaveStored()).toBeNull();
    a.handoff.forget(); // disposeRun
    expect(storage.map.has(SUSPENDED_RUN_KEY)).toBe(false);
    release();
    await other;
    await withSavedRunLock(() => undefined, locks);
    expect(b.store.peek()?.runKey).toBe(s.runKey);
    expect(b.store.peek()?.handoffId).toBeTruthy();
  });

  it('flush still writes a store Save & quit let go of while it waited (the tab closing)', () => {
    const storage = memStorage();
    const locks = fifoLocks();
    const a = page(storage, locks);
    void withSavedRunLock(() => new Promise<void>(() => {}), locks); // never released
    const s = snapshot();
    a.handoff.store(s, 'pause');
    a.handoff.leaveStored();
    a.handoff.forget();
    a.runs.flush();
    expect(new SuspendedRunStore(storage).peek()?.runKey).toBe(s.runKey);
  });

  it('a take back in flight is shared, and a forgotten one resolves false without onLost', async () => {
    const storage = memStorage();
    const a = page(storage, fifoLocks());
    a.handoff.store(snapshot(), 'pause');
    const one = a.handoff.takeBack();
    expect(a.handoff.takeBack()).toBe(one);
    expect(await one).toBe(true);
    a.handoff.store(snapshot(), 'pause');
    const two = a.handoff.takeBack();
    a.handoff.forget();
    expect(await two).toBe(false);
    expect(a.lost).toEqual([]);
  });

  it('a failing lock request falls back to taking at once', async () => {
    const storage = memStorage();
    const a = page(storage, { request: () => Promise.reject(new Error('SecurityError')) });
    const s = snapshot();
    a.handoff.store(s, 'pause');
    await Promise.resolve();
    await Promise.resolve();
    expect(a.store.peek()?.runKey).toBe(s.runKey);
    expect(await a.handoff.takeBack()).toBe(true);
    expect(a.store.has).toBe(false);
  });
});
