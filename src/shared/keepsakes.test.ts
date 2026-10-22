import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../data/characters';
import { HOARD_STACK_MAX, KEEPSAKE_TYPE_IDS, keepsakeTypesFor, LOADOUT_SLOTS, MAX_RARITY, RARITIES } from '../data/keepsakes';
import { KEEPSAKE_LOADOUT_SLOTS, KEEPSAKE_MAX_RARITY, KEEPSAKE_RARITY_IDS, KEEPSAKE_STACK_MAX, parseLoadout, parseSharedHoardKey, SHARED_KEEPSAKE_TYPES, sharedHoardKey } from './keepsakes';

describe('shared Keepsake mirror', () => {
  it('matches src/data/keepsakes.ts', () => {
    expect(Object.values(SHARED_KEEPSAKE_TYPES).flat()).toEqual([...KEEPSAKE_TYPE_IDS]);
    expect(Object.keys(SHARED_KEEPSAKE_TYPES)).toEqual(CHARACTERS.map((c) => c.id));
    for (const c of CHARACTERS) expect(SHARED_KEEPSAKE_TYPES[c.id]).toEqual(keepsakeTypesFor(c.id).map((t) => t.id));
    expect(KEEPSAKE_MAX_RARITY).toBe(MAX_RARITY);
    expect(KEEPSAKE_RARITY_IDS).toEqual(RARITIES.map((r) => r.id));
    expect(KEEPSAKE_STACK_MAX).toBe(HOARD_STACK_MAX);
    expect(KEEPSAKE_LOADOUT_SLOTS).toBe(LOADOUT_SLOTS);
  });

  it('parses Loadouts: 0–2 of the Character’s own types, duplicates allowed', () => {
    expect(parseLoadout('lint', [])).toEqual([]);
    expect(parseLoadout('lint', [{ type: 'reclaim', rarity: 3, extra: 1 }, { type: 'reclaim', rarity: 3 }])).toEqual([
      { type: 'reclaim', rarity: 3 },
      { type: 'reclaim', rarity: 3 },
    ]);
    expect(parseLoadout('lint', [{ type: 'arc', rarity: 1 }])).toBeNull();
    expect(parseLoadout('lint', [{ type: 'reclaim', rarity: 0 }])).toBeNull();
    expect(parseLoadout('lint', [{ type: 'reclaim', rarity: 2.5 }])).toBeNull();
    expect(parseLoadout('lint', [{ type: 'reclaim', rarity: 6 }])).toBeNull();
    // Older clients and leaderboard rows send grades 1–10.
    expect(parseLoadout('lint', [{ type: 'reclaim', grade: 8 }, { type: 'reclaim', grade: 1 }])).toEqual([{ type: 'reclaim', rarity: 4 }, { type: 'reclaim', rarity: 1 }]);
    expect(parseLoadout('lint', [{ type: 'reclaim', grade: 11 }])).toBeNull();
    expect(parseLoadout('lint', [{ type: 'reclaim' }])).toBeNull();
    expect(parseLoadout('lint', [{ type: 'reclaim', rarity: 1 }, { type: 'reclaim', rarity: 1 }, { type: 'reclaim', rarity: 1 }])).toBeNull();
    expect(parseLoadout('constructor', [])).toEqual([]);
    expect(parseLoadout('constructor', [{ type: 'reclaim', rarity: 1 }])).toBeNull();
    expect(parseLoadout('lint', 'x')).toBeNull();
  });

  it('parses Hoard keys', () => {
    expect(parseSharedHoardKey('zap', 'live_wire:mythic')).toEqual({ type: 'live_wire', rarity: 5 });
    expect(sharedHoardKey({ type: 'live_wire', rarity: 3 })).toBe('live_wire:epic');
    // Keys from before rarities: grades 1–10, two to a rarity.
    expect(parseSharedHoardKey('zap', 'live_wire:10')).toEqual({ type: 'live_wire', rarity: 5 });
    expect(parseSharedHoardKey('zap', 'live_wire:3')).toEqual({ type: 'live_wire', rarity: 2 });
    expect(parseSharedHoardKey('zap', 'live_wire:11')).toBeNull();
    expect(parseSharedHoardKey('zap', 'live_wire:01')).toBeNull();
    expect(parseSharedHoardKey('zap', 'live_wire:Epic')).toBeNull();
    expect(parseSharedHoardKey('zap', 'live_wire:1.0')).toBeNull();
    expect(parseSharedHoardKey('lint', 'live_wire:1')).toBeNull();
    expect(parseSharedHoardKey('zap', 'live_wire')).toBeNull();
  });
});
