import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/events';
import { createRun } from '../game/assembly';
import { parseRunSnapshot } from '../game/snapshot';
import { isNewerSnapshot, MAX_SAVED_RUN_BYTES, migrateRunSnapshot, SNAPSHOT_VERSION, validateSavedRunClaim, validateSavedRunUpload } from './savedRun';

const real = () => {
  const run = createRun(new EventBus(), { seed: 'shared', characterId: 'lint' });
  for (let i = 0; i < 30; i++) run.update(1 / 60);
  return run.toSnapshot();
};

describe('saved Run checks shared with the API (src/shared/savedRun.ts)', () => {
  it('accepts a real snapshot, well under the size cap', () => {
    const s = real();
    const v = validateSavedRunUpload({ runKey: s.runKey, lease: 'l', snapshot: s });
    expect(v.ok).toBe(true);
    expect(JSON.stringify(s).length).toBeLessThan(MAX_SAVED_RUN_BYTES / 8);
  });

  it('keeps a newer version as it is and reads it as unavailable on the client', () => {
    const newer = { ...real(), version: SNAPSHOT_VERSION + 1, characterId: { renamed: true } };
    expect(isNewerSnapshot(newer)).toBe(true);
    expect(migrateRunSnapshot(newer)).toBe(newer);
    const v = validateSavedRunUpload({ runKey: newer.runKey, lease: 'l', snapshot: newer });
    expect(v.ok && v.value.version).toBe(SNAPSHOT_VERSION + 1);
    expect(parseRunSnapshot(newer)).toBeNull();
  });

  it('rejects what is not a snapshot of this Run, or not a valid Loadout', () => {
    const s = real();
    expect(validateSavedRunUpload({ runKey: s.runKey, lease: 'l', snapshot: { ...s, version: 0 } }).ok).toBe(false); // no migration from version 0
    expect(validateSavedRunUpload({ runKey: 'other', lease: 'l', snapshot: s }).ok).toBe(false);
    expect(validateSavedRunUpload({ runKey: s.runKey, lease: '', snapshot: s }).ok).toBe(false);
    expect(validateSavedRunUpload({ runKey: s.runKey, lease: 'l', snapshot: { ...s, loadout: [{ type: 'arc', rarity: 1 }] } }).ok).toBe(false);
    expect(validateSavedRunClaim({ runKey: 'r', lease: 'l' }, true).ok).toBe(false);
    expect(validateSavedRunClaim({ runKey: 'r', lease: 'l' }, false).ok).toBe(true);
  });
});
