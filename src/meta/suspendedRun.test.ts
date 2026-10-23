import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/events';
import { createRun } from '../game/assembly';
import type { RunSnapshot } from '../game/snapshot';
import { KeepsakeTracker } from './keepsakes';
import { MetaProgress } from './meta';
import { abandonSuspendedRun, SUSPENDED_RUN_KEY, SuspendedRunStore } from './suspendedRun';

const memStorage = () => {
  const map = new Map<string, string>();
  return { map, getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) };
};

const snapshot = (): RunSnapshot => {
  const run = createRun(new EventBus(), { seed: 'suspend', characterId: 'zap' });
  for (let i = 0; i < 60; i++) run.update(1 / 60);
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
