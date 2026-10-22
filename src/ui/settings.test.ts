import { describe, expect, it } from 'vitest';
import { defaultSettings, sanitizeSettings, SettingsStore, type Settings } from './settings';

describe('settings', () => {
  it('sanitizes malformed blobs onto defaults', () => {
    const d = defaultSettings();
    const s = sanitizeSettings({ masterVolume: 3, musicVolume: 'loud', quality: 'ultra', showFps: true, touchControls: 'on' }, d);
    expect(s.masterVolume).toBe(1);
    expect(s.musicVolume).toBe(d.musicVolume);
    expect(s.quality).toBe(d.quality);
    expect(s.showFps).toBe(true);
    expect(s.touchControls).toBe('on');
    expect(s.storyCaptions).toBe(true);
    expect(sanitizeSettings({ storyCaptions: false }, d).storyCaptions).toBe(false);
    expect(sanitizeSettings({ storyCaptions: 'no' }, d).storyCaptions).toBe(true);
    expect(sanitizeSettings(null, d)).toEqual(d);
    expect(sanitizeSettings('garbage', d)).toEqual(d);
  });

  it('loads, persists updates and notifies subscribers', () => {
    let saved: Settings | null = null;
    const store = new SettingsStore(
      () => ({ sfxVolume: 0.25 }),
      (s) => (saved = s),
    );
    expect(store.value.sfxVolume).toBe(0.25);
    const seen: Array<[number, boolean]> = [];
    store.subscribe((s, prev) => seen.push([s.musicVolume, prev === null]));
    store.update({ musicVolume: 0.1 });
    expect(seen).toEqual([
      [defaultSettings().musicVolume, true],
      [0.1, false],
    ]);
    expect(saved!.musicVolume).toBe(0.1);
    expect(saved!.sfxVolume).toBe(0.25);
  });

  it('keeps story settings and a seen intro through a reset', () => {
    const d = defaultSettings();
    expect(d.storyCaptions).toBe(true);
    expect(d.introSeen).toBe(false);
    expect(sanitizeSettings({ storyCaptions: 'no', introSeen: 1 }, d)).toMatchObject({ storyCaptions: true, introSeen: false });
    const store = new SettingsStore(
      () => ({ storyCaptions: false, introSeen: true }),
      () => {},
    );
    expect(store.value).toMatchObject({ storyCaptions: false, introSeen: true });
    store.reset();
    expect(store.value).toMatchObject({ storyCaptions: true, introSeen: true });
  });
});
