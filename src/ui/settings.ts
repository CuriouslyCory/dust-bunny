/**
 * Player Settings (volumes, graphics quality, reduced motion, FPS readout, touch controls, story captions).
 * `settings` is a process-wide store: read `settings.value`, change with `settings.update({ … })`,
 * react with `settings.subscribe(fn)` (called immediately, then on every change).
 * Persistence lives in settingsStorage.ts.
 */
import { readSettingsBlob, writeSettingsBlob } from './settingsStorage';

export type GraphicsQuality = 'low' | 'high';
export type TouchControlsMode = 'auto' | 'on' | 'off';

export interface Settings {
  /** Volumes are 0..1. */
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  muted: boolean;
  /** low = pixel ratio 1, no shadows; high = up to 2× pixel ratio with shadows. */
  quality: GraphicsQuality;
  reducedMotion: boolean;
  showFps: boolean;
  /** 'auto' shows the joystick on touch devices. */
  touchControls: TouchControlsMode;
  /** Narrator captions (e.g. when a boss leaves a Keepsake). */
  storyCaptions: boolean;
}

const prefersReducedMotion = (): boolean => {
  try {
    return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  } catch {
    return false;
  }
};

const isLowEndDevice = (): boolean => {
  const nav = globalThis.navigator as (Navigator & { deviceMemory?: number }) | undefined;
  if (!nav) return false;
  return (nav.deviceMemory !== undefined && nav.deviceMemory <= 4) || /Android|iPhone|iPad/i.test(nav.userAgent ?? '');
};

export function defaultSettings(): Settings {
  return {
    masterVolume: 0.8,
    musicVolume: 0.6,
    sfxVolume: 0.8,
    muted: false,
    quality: isLowEndDevice() ? 'low' : 'high',
    reducedMotion: prefersReducedMotion(),
    showFps: false,
    touchControls: 'auto',
    storyCaptions: true,
  };
}

const clamp01 = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : d);
const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d);
const oneOf = <T extends string>(v: unknown, options: readonly T[], d: T): T => (options.includes(v as T) ? (v as T) : d);

/** Merges an untrusted blob over defaults, dropping anything malformed. */
export function sanitizeSettings(raw: unknown, defaults: Settings = defaultSettings()): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    masterVolume: clamp01(r.masterVolume, defaults.masterVolume),
    musicVolume: clamp01(r.musicVolume, defaults.musicVolume),
    sfxVolume: clamp01(r.sfxVolume, defaults.sfxVolume),
    muted: bool(r.muted, defaults.muted),
    quality: oneOf(r.quality, ['low', 'high'] as const, defaults.quality),
    reducedMotion: bool(r.reducedMotion, defaults.reducedMotion),
    showFps: bool(r.showFps, defaults.showFps),
    touchControls: oneOf(r.touchControls, ['auto', 'on', 'off'] as const, defaults.touchControls),
    storyCaptions: bool(r.storyCaptions, defaults.storyCaptions),
  };
}

export type SettingsListener = (s: Readonly<Settings>, prev: Readonly<Settings> | null) => void;

export class SettingsStore {
  private current: Settings;
  private listeners = new Set<SettingsListener>();

  constructor(
    load: () => unknown = readSettingsBlob,
    private readonly save: (s: Settings) => void = writeSettingsBlob,
  ) {
    this.current = sanitizeSettings(load());
  }

  get value(): Readonly<Settings> {
    return this.current;
  }

  update(patch: Partial<Settings>): void {
    const prev = this.current;
    this.current = sanitizeSettings({ ...prev, ...patch }, prev);
    this.save(this.current);
    for (const fn of [...this.listeners]) fn(this.current, prev);
  }

  reset(): void {
    this.update(defaultSettings());
  }

  /** Calls `fn` now (prev = null) and on every change. Returns an unsubscribe. */
  subscribe(fn: SettingsListener): () => void {
    this.listeners.add(fn);
    fn(this.current, null);
    return () => this.listeners.delete(fn);
  }
}

export const settings = new SettingsStore();
