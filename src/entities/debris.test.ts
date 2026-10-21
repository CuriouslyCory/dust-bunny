import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import { DEBRIS_TYPES } from '../data/debris';
import { DebrisField } from './debris';

const types = DEBRIS_TYPES.slice(0, 3);
const makeField = (cap = 8) => new DebrisField(types, cap);

describe('DebrisField change consumption', () => {
  it('coalesces 10,000 headless moves and preserves the final spatial state', () => {
    const field = makeField();
    const d = field.spawn(0, 0, 0, new Rng('moves'), { size: 2 })!;
    for (let i = 1; i <= 10_000; i++) {
      field.move(d, i, -i);
      expect(field.pendingChanges).toEqual({ slots: 1, types: 1 });
    }
    expect(field.count).toBe(1);
    expect([d.x, d.z]).toEqual([10_000, -10_000]);
    expect(field.query(10_000, -10_000, 0)).toEqual([d]);
    expect(field.query(0, 0, 1)).toEqual([]);
    expect(field.queryOverlapping(10_002, -10_000, 1)).toEqual([d]);
    expect(field.consumeChanges()).toEqual([{ typeIndex: 0, instances: [d], changedSlots: [0] }]);
    expect(field.pendingChanges).toEqual({ slots: 0, types: 0 });
    expect(field.consumeChanges()).toEqual([]);
  });

  it('bounds bookkeeping throughout 10,000 headless spawn/remove cycles', () => {
    const field = makeField(1);
    const rng = new Rng('churn');
    for (let i = 0; i < 10_000; i++) {
      const d = field.spawn(i % types.length, i, 0, rng)!;
      expect(field.pendingChanges.slots).toBe(1);
      field.remove(d);
      expect(field.pendingChanges.slots).toBe(0);
      expect(field.pendingChanges.types).toBeLessThanOrEqual(types.length);
    }
    expect(field.count).toBe(0);
    const changes = field.consumeChanges();
    expect(changes).toHaveLength(types.length);
    for (const change of changes) {
      expect(change.instances).toEqual([]);
      expect(change.changedSlots).toEqual([]);
    }
  });

  it('resolves multiple swaps to unique current slots before consumption', () => {
    const field = makeField();
    const rng = new Rng('swap');
    const [a, b, c, d, e] = Array.from({ length: 5 }, (_, i) => field.spawn(0, i, 0, rng)!);
    field.consumeChanges();
    field.move(e!, 100, 200);
    field.move(c!, 300, 400);
    field.remove(b!); // e -> 1
    field.remove(a!); // d -> 0
    field.remove(c!); // tail removal also deletes its pending slot
    const [change] = field.consumeChanges();
    expect(change!.instances).toEqual([d, e]);
    expect([...change!.changedSlots].sort()).toEqual([0, 1]);
    expect([d!.slot, e!.slot]).toEqual([0, 1]);
    expect(field.query(100, 200, 0)).toEqual([e]);
    expect(field.query(300, 400, 0)).toEqual([]);
    field.remove(e!);
    expect(field.consumeChanges()).toEqual([{ typeIndex: 0, instances: [d], changedSlots: [] }]);
    field.remove(d!);
    expect(field.consumeChanges()).toEqual([{ typeIndex: 0, instances: [], changedSlots: [] }]);
  });

  it('retains empty-type invalidation across repeated clear/reset and repopulation', () => {
    const field = makeField();
    const rng = new Rng('areas');
    const old = field.spawn(0, 1, 2, rng, { size: 9 })!;
    field.consumeChanges();
    field.clear();
    field.clear();
    const discarded = field.spawn(1, 3, 4, rng)!;
    field.reset(500);
    const current = field.spawn(1, 5, 6, rng, { size: 2 })!;
    expect(old.alive).toBe(false);
    expect(discarded.alive).toBe(false);
    expect(field.hash.cellSize).toBe(500);
    expect(field.maxSize).toBe(2);
    expect(field.query(1, 2, 0)).toEqual([]);
    expect(field.query(5, 6, 0)).toEqual([current]);
    expect(field.pendingChanges).toEqual({ slots: 1, types: 2 });
    expect(field.consumeChanges()).toEqual([
      { typeIndex: 0, instances: [], changedSlots: [] },
      { typeIndex: 1, instances: [current], changedSlots: [0] },
    ]);
  });

  it('provides full state even after earlier changes were consumed', () => {
    const field = makeField();
    const d = field.spawn(1, 1, 2, new Rng('snapshot'))!;
    field.consumeChanges();
    expect(field.consumeChanges({ full: true })).toEqual([
      { typeIndex: 0, instances: [], changedSlots: [] },
      { typeIndex: 1, instances: [d], changedSlots: [0] },
      { typeIndex: 2, instances: [], changedSlots: [] },
    ]);
    expect(field.consumeChanges()).toEqual([]);
  });

  it('ignores removed, reset, and foreign handles without resurrecting them', () => {
    const field = makeField();
    const rng = new Rng('handles');
    const dead = field.spawn(0, 1, 2, rng)!;
    field.remove(dead);
    const reset = field.spawn(0, 3, 4, rng)!;
    field.reset(300);
    const foreign = makeField().spawn(0, 5, 6, rng)!;
    const live = field.spawn(0, 7, 8, rng)!;
    field.consumeChanges();
    for (const d of [dead, reset, foreign]) {
      field.move(d, 99, 99);
      field.remove(d);
    }
    expect(field.count).toBe(1);
    expect(field.query(7, 8, 0)).toEqual([live]);
    expect(field.query(99, 99, 0)).toEqual([]);
    expect(foreign.alive).toBe(true);
    expect(field.consumeChanges()).toEqual([]);
  });

  it('preserves the cap and max-size cache through removal and slot reuse', () => {
    const field = makeField(2);
    const rng = new Rng('cap');
    const big = field.spawn(0, 0, 0, rng, { size: 8 })!;
    const small = field.spawn(1, 0, 0, rng, { size: 2 })!;
    expect(field.full).toBe(true);
    expect(field.maxSize).toBe(8);
    expect(field.spawn(2, 0, 0, rng)).toBeNull();
    field.remove(big);
    expect(field.full).toBe(false);
    expect(field.maxSize).toBe(2);
    const replacement = field.spawn(1, 0, 0, rng, { size: 4 })!;
    expect([small.slot, replacement.slot]).toEqual([0, 1]);
    expect(field.maxSize).toBe(4);
    expect(field.pendingChanges.slots).toBe(2);
  });

  it('keeps seeded instance values and RNG continuation independent of consumption', () => {
    const a = makeField();
    const b = makeField();
    const rngA = new Rng('seeded');
    const rngB = new Rng('seeded');
    for (let i = 0; i < 8; i++) {
      expect(a.spawn(i % types.length, i, -i, rngA)).toEqual(b.spawn(i % types.length, i, -i, rngB));
      a.consumeChanges();
    }
    expect(rngA.next()).toBe(rngB.next());
    expect(a.pendingChanges.slots).toBe(0);
    expect(b.pendingChanges.slots).toBe(8);
  });
});
