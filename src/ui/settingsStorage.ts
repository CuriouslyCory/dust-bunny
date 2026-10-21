/**
 * Where Settings are persisted. Kept in one module so it can be repointed at the shared
 * save file (src/meta) later: replace these two functions and nothing else changes.
 */
export const SETTINGS_KEY = 'dust-bunny:settings:v1';

export function readSettingsBlob(): unknown {
  try {
    const raw = globalThis.localStorage?.getItem(SETTINGS_KEY);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

export function writeSettingsBlob(value: unknown): void {
  try {
    globalThis.localStorage?.setItem(SETTINGS_KEY, JSON.stringify(value));
  } catch {
    // Private mode / quota exceeded: settings just don't persist.
  }
}
