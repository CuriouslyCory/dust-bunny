/** Pause hand-off rules (src/meta/suspendedRun.ts): two tabs, two `SuspendedRunStore`s, one storage. */
import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/events';
import { createRun } from '../game/assembly';
import type { Game } from '../game/game';
import { RunHandoff, type HandoffLoss } from '../game/handoff';
import { parseRunSnapshot, type RunSnapshot } from '../game/snapshot';
import { MetaProgress } from './meta';
import {
  abandonSuspendedRun,
  pausedRunState,
  resumeSuspendedRun,
  SAVED_RUN_LOCK,
  saveSuspendedRun,
  storePausedRun,
  SUSPENDED_RUN_KEY,
  SuspendedRunStore,
  takeBackPausedRun,
  withSavedRunLock,
  type LockManagerLike,
} from './suspendedRun';

const memStorage = () => {
  const map = new Map<string, string>();
  return { map, getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) };
};

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
/** A meta stand-in that records what it was credited. */
const awards = () => {
  const calls: Award[] = [];
  return { calls, awardRun: (e: Award) => void calls.push(e) } as unknown as Pick<MetaProgress, 'awardRun'> & { calls: Award[] };
};

const fakeGame = () => {
  const resumed: RunSnapshot[] = [];
  return { resumed, game: { resumeRun: (r: RunSnapshot) => void resumed.push(r) } as unknown as Game };
};

describe('Pause hand-off rules (two tabs, one storage)', () => {
  it('pause then unpause in one tab leaves the slot empty and credits nothing', () => {
    const storage = memStorage();
    const tabA = new SuspendedRunStore(storage);
    const meta = awards();
    const s = snapshot();
    expect(storePausedRun(tabA, s, 'h1', meta)).toBe(true);
    expect(new SuspendedRunStore(storage).peek()?.handoffId).toBe('h1');
    expect(pausedRunState(tabA, 'h1', s.runKey)).toBe('mine');
    expect(takeBackPausedRun(tabA, 'h1', s.runKey)).toBe('mine');
    expect(storage.map.has(SUSPENDED_RUN_KEY)).toBe(false);
    expect(meta.calls).toEqual([]);
  });

  it('a Run picked up in tab B is not tab A’s to take back (or end and credit)', () => {
    const storage = memStorage();
    const tabA = new SuspendedRunStore(storage);
    const tabB = new SuspendedRunStore(storage);
    const meta = awards();
    const s = snapshot();
    storePausedRun(tabA, s, 'h1', meta);
    const { game, resumed } = fakeGame();
    expect(resumeSuspendedRun(game, tabB, new MetaProgress(null), s.runKey)).toBe(true);
    expect(resumed[0]?.runKey).toBe(s.runKey);
    expect(pausedRunState(tabA, 'h1', s.runKey)).toBe('carriedOn');
    expect(takeBackPausedRun(tabA, 'h1', s.runKey)).toBe('carriedOn');
    // B pauses it in turn: the same Run under B's hand-off is still not A's.
    storePausedRun(tabB, structuredClone(s), 'h2', meta);
    expect(takeBackPausedRun(tabA, 'h1', s.runKey)).toBe('carriedOn');
    expect(tabB.peek()?.handoffId).toBe('h2');
    expect(meta.calls).toEqual([]);
  });

  it('New run in tab B credits the paused Run once; tab A finds it gone', () => {
    const storage = memStorage();
    const tabA = new SuspendedRunStore(storage);
    const tabB = new SuspendedRunStore(storage);
    const meta = awards();
    const s = snapshot();
    storePausedRun(tabA, s, 'h1', meta);
    expect(abandonSuspendedRun(tabB, meta, s.runKey)).toBe(true);
    expect(meta.calls).toHaveLength(1);
    expect(takeBackPausedRun(tabA, 'h1', s.runKey)).toBe('carriedOn');
    expect(meta.calls).toHaveLength(1);
  });

  it('another Run stored over a paused one credits it once; the pausing tab reads it as replaced', () => {
    const storage = memStorage();
    const tabA = new SuspendedRunStore(storage);
    const tabB = new SuspendedRunStore(storage);
    const meta = awards();
    const a = snapshot();
    storePausedRun(tabA, a, 'h1', meta);
    const b = snapshot();
    expect(b.runKey).not.toBe(a.runKey);
    storePausedRun(tabB, b, 'h2', meta);
    expect(meta.calls.map((c) => c.reason)).toEqual(['quit']);
    expect(takeBackPausedRun(tabA, 'h1', a.runKey)).toBe('replaced');
    expect(tabB.peek()?.runKey).toBe(b.runKey);
  });

  it('pausing the same Run again credits nothing, and only the newest hand-off owns it', () => {
    const store = new SuspendedRunStore(memStorage());
    const meta = awards();
    const s = snapshot();
    storePausedRun(store, s, 'h1', meta);
    storePausedRun(store, structuredClone(s), 'h2', meta);
    expect(meta.calls).toEqual([]);
    expect(pausedRunState(store, 'h1', s.runKey)).toBe('carriedOn');
    expect(pausedRunState(store, 'h2', s.runKey)).toBe('mine');
  });

  it('a slot this build can’t read is left alone and is not the pausing tab’s', () => {
    const storage = memStorage();
    const store = new SuspendedRunStore(storage);
    const s = snapshot();
    storePausedRun(store, s, 'h1', awards());
    const newer = JSON.stringify({ ...s, version: 99 });
    storage.setItem(SUSPENDED_RUN_KEY, newer);
    expect(takeBackPausedRun(store, 'h1', s.runKey)).toBe('carriedOn');
    expect(storage.getItem(SUSPENDED_RUN_KEY)).toBe(newer);
  });

  it('a write that fails is reported, and the Run stays this page’s to take back', () => {
    const storage = memStorage();
    const store = new SuspendedRunStore(storage);
    const meta = awards();
    const other = snapshot();
    store.save(other);
    const s = snapshot();
    const setItem = storage.setItem;
    storage.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    expect(storePausedRun(store, s, 'h1', meta)).toBe(false);
    // The Run already in storage is still there: not credited.
    expect(meta.calls).toEqual([]);
    expect(takeBackPausedRun(store, 'h1', s.runKey)).toBe('mine');
    // Taking it back drops only this page's copy: the other Run, never replaced, is still stored
    // (removeItem would have worked even though setItem didn't) and this page sees it again.
    expect(parseRunSnapshot(JSON.parse(storage.getItem(SUSPENDED_RUN_KEY)!))?.runKey).toBe(other.runKey);
    expect(store.unsaved).toBe(false);
    expect(store.peek()?.runKey).toBe(other.runKey);
    expect(new SuspendedRunStore(storage).peek()?.runKey).toBe(other.runKey);
    // A pause write that sticks is taken back from storage as before.
    storage.setItem = setItem;
    expect(storePausedRun(store, structuredClone(s), 'h2', meta)).toBe(true);
    expect(takeBackPausedRun(store, 'h2', s.runKey)).toBe('mine');
    expect(storage.map.has(SUSPENDED_RUN_KEY)).toBe(false);
  });

  it('a Perk draft pending when the Run was stored opens again where it is picked up', () => {
    const storage = memStorage();
    const tabA = new SuspendedRunStore(storage);
    const tabB = new SuspendedRunStore(storage);
    const run = createRun(new EventBus(), { seed: 'handoff', characterId: 'zap' });
    run.perkDraft.queue();
    storePausedRun(tabA, run.toSnapshot(), 'h1', awards());
    const { game, resumed } = fakeGame();
    expect(resumeSuspendedRun(game, tabB, new MetaProgress(null))).toBe(true);
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

describe('withSavedRunLock', () => {
  it('runs takes one at a time under dust-bunny:saved-run: of two racing tabs, one gets the Run', async () => {
    const storage = memStorage();
    const tabA = new SuspendedRunStore(storage);
    const tabB = new SuspendedRunStore(storage);
    const locks = fifoLocks();
    const s = snapshot();
    storePausedRun(tabA, s, 'h1', awards());
    const { game, resumed } = fakeGame();
    const [b, a] = await Promise.all([
      withSavedRunLock(() => resumeSuspendedRun(game, tabB, new MetaProgress(null), s.runKey), locks),
      withSavedRunLock(() => takeBackPausedRun(tabA, 'h1', s.runKey), locks),
    ]);
    expect(b).toBe(true);
    expect(a).toBe('carriedOn');
    expect(resumed).toHaveLength(1);
    expect(locks.requests).toEqual([SAVED_RUN_LOCK, SAVED_RUN_LOCK]);
  });

  it('two tabs saving over the same Run at once credit it only once', async () => {
    const storage = memStorage();
    const tabB = new SuspendedRunStore(storage);
    const tabC = new SuspendedRunStore(storage);
    const locks = fifoLocks();
    const meta = awards();
    const old = snapshot();
    new SuspendedRunStore(storage).save(old);
    const b = snapshot();
    const c = snapshot();
    await Promise.all([withSavedRunLock(() => saveSuspendedRun(tabB, b, meta), locks), withSavedRunLock(() => saveSuspendedRun(tabC, c, meta), locks)]);
    // The old Run once, then B's (replaced by C's): never the old one twice.
    expect(meta.calls.map((e) => e.stats)).toEqual([old.stats, b.stats]);
    expect(tabB.peek()?.runKey).toBe(c.runKey);
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
  /** A page: its store, its hand-off and what it was told about losing the Run. */
  const page = (storage: ReturnType<typeof memStorage>, locks: LockManagerLike | null, meta = awards()) => {
    const store = new SuspendedRunStore(storage);
    const lost: HandoffLoss[] = [];
    const handoff = new RunHandoff({ store, meta, onLost: (why) => void lost.push(why), locks });
    return { store, handoff, lost, meta };
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
        const { game, resumed } = fakeGame();
        expect(await withSavedRunLock(() => resumeSuspendedRun(game, b.store, new MetaProgress(null)), locks)).toBe(true);
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
        a.handoff.store(snapshot(), 'pause');
        await withSavedRunLock(() => b.store.take(), locks);
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
        a.handoff.flush();
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
    a.handoff.flush();
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
