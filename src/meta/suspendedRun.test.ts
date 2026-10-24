import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/events';
import { createRun } from '../game/assembly';
import { legacyRunKey, parseRunSnapshot, type RunSnapshot } from '../game/snapshot';
import { KeepsakeTracker } from './keepsakes';
import { MetaProgress } from './meta';
import { abandonSuspendedRun, saveSuspendedRun, SUSPENDED_RUN_KEY, SuspendedRunStore } from './suspendedRun';
import { fluffForRun } from './fluff';

const memStorage = () => {
  const map = new Map<string, string>();
  return { map, getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) };
};

const snapshot = (seconds = 1): RunSnapshot => {
  const run = createRun(new EventBus(), { seed: 'suspend', characterId: 'zap' });
  for (let i = 0; i < 60 * seconds; i++) run.update(1 / 60);
  return run.toSnapshot();
};

describe('SuspendedRunStore', () => {
  it('keeps one saved Run that Resume takes exactly once', () => {
    const storage = memStorage();
    const store = new SuspendedRunStore(storage);
    expect(store.has).toBe(false);
    const s = snapshot();
    let changes = 0;
    store.onChange(() => changes++);
    store.save(s);
    expect(storage.map.has(SUSPENDED_RUN_KEY)).toBe(true);
    // Another page load reads the same slot.
    expect(new SuspendedRunStore(storage).peek()).toEqual(s);
    expect(store.take()).toEqual(s);
    expect(store.has).toBe(false);
    expect(storage.map.has(SUSPENDED_RUN_KEY)).toBe(false);
    expect(store.take()).toBeNull();
    expect(changes).toBe(2);
  });

  it('reads a corrupt or outdated slot as empty', () => {
    const storage = memStorage();
    storage.setItem(SUSPENDED_RUN_KEY, '{not json');
    expect(new SuspendedRunStore(storage).peek()).toBeNull();
    storage.setItem(SUSPENDED_RUN_KEY, JSON.stringify({ ...snapshot(), version: 0 }));
    expect(new SuspendedRunStore(storage).peek()).toBeNull();
  });

  it('keeps working from memory when storage writes fail', () => {
    const storage = memStorage();
    const store = new SuspendedRunStore(storage);
    const s = snapshot();
    store.save(s);
    // Storage fills up (or is locked): writes throw, reads still work.
    storage.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    storage.removeItem = () => {
      throw new Error('QuotaExceededError');
    };
    expect(store.take()).toEqual(s);
    // The stale copy left in storage can't be taken (or credited) again on this page.
    expect(storage.map.has(SUSPENDED_RUN_KEY)).toBe(true);
    expect(store.take()).toBeNull();
    const next = { ...snapshot(), time: 42 };
    store.save(next);
    expect(store.peek()?.time).toBe(42);
  });

  it('works in memory without storage', () => {
    const store = new SuspendedRunStore(null);
    store.save(snapshot());
    expect(store.has).toBe(true);
    store.clear();
    expect(store.has).toBe(false);
  });

  it('abandoning the saved Run credits it as a quit', () => {
    const store = new SuspendedRunStore(memStorage());
    const meta = new MetaProgress(null);
    store.save(snapshot());
    expect(abandonSuspendedRun(store, meta)).toBe(true);
    expect(meta.data.stats.runs).toBe(1);
    expect(store.has).toBe(false);
    expect(abandonSuspendedRun(store, meta)).toBe(false);
    expect(meta.data.stats.runs).toBe(1);
  });
});

describe('Save & quit from two tabs', () => {
  it('saving Run B over Run A credits Run A once as a quit and keeps Run B', () => {
    // Two tabs: two stores over one localStorage.
    const storage = memStorage();
    const tabA = new SuspendedRunStore(storage);
    const tabB = new SuspendedRunStore(storage);
    const meta = new MetaProgress(null);
    const runA = snapshot(2);
    const runB = snapshot();
    // Same seed and Character, still two Runs.
    expect(runA.runKey).not.toBe(runB.runKey);

    expect(saveSuspendedRun(tabA, runA, meta)).toBe(false);
    expect(meta.data.stats.runs).toBe(0);
    expect(saveSuspendedRun(tabB, runB, meta)).toBe(true);
    expect(meta.data.stats.runs).toBe(1);
    expect(meta.data.fluff).toBe(fluffForRun('quit', runA.stats));
    expect(tabA.peek()).toEqual(runB);
    // Run A is gone from the slot: it can't be credited again.
    expect(abandonSuspendedRun(tabA, meta)).toBe(true);
    expect(meta.data.stats.runs).toBe(2);
    expect(meta.data.fluff).toBe(fluffForRun('quit', runA.stats) + fluffForRun('quit', runB.stats));
  });

  it('saving the same Run again credits nothing', () => {
    const storage = memStorage();
    const tabA = new SuspendedRunStore(storage);
    const tabB = new SuspendedRunStore(storage);
    const meta = new MetaProgress(null);
    const run = createRun(new EventBus(), { seed: 'suspend', characterId: 'zap' });
    const first = run.toSnapshot();
    for (let i = 0; i < 60; i++) run.update(1 / 60);
    const later = run.toSnapshot();
    expect(later.runKey).toBe(first.runKey);
    expect(saveSuspendedRun(tabA, first, meta)).toBe(false);
    expect(saveSuspendedRun(tabB, later, meta)).toBe(false);
    expect(saveSuspendedRun(tabB, later, meta)).toBe(false);
    expect(meta.data.stats.runs).toBe(0);
    expect(tabA.peek()?.time).toBe(later.time);
  });

  it('a resumed Run keeps its key, so saving it again credits nothing', () => {
    const storage = memStorage();
    const tabA = new SuspendedRunStore(storage);
    const tabB = new SuspendedRunStore(storage);
    const meta = new MetaProgress(null);
    const s = snapshot();
    saveSuspendedRun(tabA, s, meta);
    // Tab B's title still shows the Run: it resumes it from a copy (the slot is left as it was).
    const resumed = createRun(new EventBus(), { seed: s.seed, characterId: s.characterId, resume: tabB.peek()! });
    expect(resumed.runKey).toBe(s.runKey);
    expect(saveSuspendedRun(tabB, resumed.toSnapshot(), meta)).toBe(false);
    expect(meta.data.stats.runs).toBe(0);
  });

  it('a snapshot saved before runKey existed still parses, keyed by its leaderboard run id or seed and Character', () => {
    const { runKey: _, ...old } = snapshot();
    const parsed = parseRunSnapshot(JSON.parse(JSON.stringify(old)));
    expect(parsed?.runKey).toBe(legacyRunKey(old));
    expect(parsed?.runKey).toBe(`seed:${old.seed}:${old.characterId}`);
    const withId = parseRunSnapshot(JSON.parse(JSON.stringify({ ...old, leaderboardRunId: 'lb-1' })));
    expect(withId?.runKey).toBe('lb:lb-1');
    // Resuming it keeps that key, so a re-save is the same Run.
    const run = createRun(new EventBus(), { seed: old.seed, characterId: old.characterId, resume: withId! });
    expect(run.toSnapshot().runKey).toBe('lb:lb-1');
    expect(parseRunSnapshot({ ...old, runKey: 7 })).toBeNull();

    // A different Run saved over the legacy one credits it.
    const storage = memStorage();
    storage.setItem(SUSPENDED_RUN_KEY, JSON.stringify(old));
    const meta = new MetaProgress(null);
    expect(saveSuspendedRun(new SuspendedRunStore(storage), snapshot(), meta)).toBe(true);
    expect(meta.data.stats.runs).toBe(1);
  });
});

describe('KeepsakeTracker across Save & quit', () => {
  it('a resumed Run keeps its salt and the drops it had, their offers closed', () => {
    const meta = new MetaProgress(null);
    const tracker = new KeepsakeTracker(meta, undefined, () => 'salt-1');
    tracker.start({ seed: 's', characterId: 'lint', ranked: true });
    const drops = tracker.bossDefeated('robovac_9000');
    expect(drops.length).toBeGreaterThan(0);
    const kept = tracker.suspend()!;
    expect(kept.salt).toBe('salt-1');

    const later = new KeepsakeTracker(meta, undefined, () => 'salt-2');
    const run = later.start({ seed: 's', characterId: 'lint', ranked: true }, JSON.parse(JSON.stringify(kept)));
    expect(run.salt).toBe('salt-1');
    expect(run.drops.map((d) => d.ref)).toEqual(drops.map((d) => d.ref));
    expect(run.drops.every((d) => d.locked)).toBe(true);
    // A closed offer can't be swapped any more.
    const first = run.drops[0]!;
    if (first.offer) expect(later.choose(run, 0, first.offer.find((t) => t !== first.ref.type)!)).toBe(false);
  });
});
