/**
 * Where Settings are persisted: the `settings` slot of the meta save (src/meta/save.ts,
 * key `dust-bunny:save:v1`). Kept in one module so the backing store can change without
 * touching the Settings store or screens.
 */
import { getMeta } from '../meta/meta';
import type { SaveSettings } from '../meta/save';

/** Pre-save-file settings key, read once as a fallback so early players keep their choices. */
const LEGACY_KEY = 'dust-bunny:settings:v1';

export function readSettingsBlob(): unknown {
  const slot = getMeta().settings;
  if (Object.keys(slot).length > 0) return slot;
  try {
    const raw = globalThis.localStorage?.getItem(LEGACY_KEY);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

export function writeSettingsBlob(value: object): void {
  getMeta().updateSettings(value as SaveSettings);
}
