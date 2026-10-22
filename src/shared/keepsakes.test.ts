import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../data/characters';
import { HOARD_STACK_MAX, KEEPSAKE_TYPE_IDS, keepsakeTypesFor, LOADOUT_SLOTS, MAX_GRADE } from '../data/keepsakes';
import { KEEPSAKE_LOADOUT_SLOTS, KEEPSAKE_MAX_GRADE, KEEPSAKE_STACK_MAX, parseLoadout, parseSharedHoardKey, SHARED_KEEPSAKE_TYPES } from './keepsakes';

describe('shared Keepsake mirror', () => {
  it('matches src/data/keepsakes.ts', () => {
    expect(Object.values(SHARED_KEEPSAKE_TYPES).flat()).toEqual([...KEEPSAKE_TYPE_IDS]);
    expect(Object.keys(SHARED_KEEPSAKE_TYPES)).toEqual(CHARACTERS.map((c) => c.id));
    for (const c of CHARACTERS) expect(SHARED_KEEPSAKE_TYPES[c.id]).toEqual(keepsakeTypesFor(c.id).map((t) => t.id));
    expect(KEEPSAKE_MAX_GRADE).toBe(MAX_GRADE);
    expect(KEEPSAKE_STACK_MAX).toBe(HOARD_STACK_MAX);
    expect(KEEPSAKE_LOADOUT_SLOTS).toBe(LOADOUT_SLOTS);
  });

  it('parses Loadouts: 0–2 of the Character’s own types, duplicates allowed', () => {
    expect(parseLoadout('lint', [])).toEqual([]);
    expect(parseLoadout('lint', [{ type: 'reclaim', grade: 3, extra: 1 }, { type: 'reclaim', grade: 3 }])).toEqual([
      { type: 'reclaim', grade: 3 },
      { type: 'reclaim', grade: 3 },
    ]);
    expect(parseLoadout('lint', [{ type: 'arc', grade: 1 }])).toBeNull();
    expect(parseLoadout('lint', [{ type: 'reclaim', grade: 0 }])).toBeNull();
    expect(parseLoadout('lint', [{ type: 'reclaim', grade: 2.5 }])).toBeNull();
    expect(parseLoadout('lint', [{ type: 'reclaim', grade: 1 }, { type: 'reclaim', grade: 1 }, { type: 'reclaim', grade: 1 }])).toBeNull();
    expect(parseLoadout('constructor', [])).toEqual([]);
    expect(parseLoadout('constructor', [{ type: 'reclaim', grade: 1 }])).toBeNull();
    expect(parseLoadout('lint', 'x')).toBeNull();
  });

  it('parses Hoard keys', () => {
    expect(parseSharedHoardKey('zap', 'live_wire:10')).toEqual({ type: 'live_wire', grade: 10 });
    expect(parseSharedHoardKey('zap', 'live_wire:1.0')).toBeNull();
    expect(parseSharedHoardKey('lint', 'live_wire:1')).toBeNull();
    expect(parseSharedHoardKey('zap', 'live_wire')).toBeNull();
  });
});
