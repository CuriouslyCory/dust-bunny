/**
 * Pure audio helpers (no WebAudio), unit tested: voice limiting and the absorb tone mapping.
 */

/** Caps concurrent voices per group and enforces a minimum gap between triggers. */
export class VoiceLimiter {
  private groups = new Map<string, { ends: number[]; last: number }>();

  /**
   * Returns true if a voice in `group` may start at `now` and lasts `duration` seconds.
   * When full, the request is refused (new sounds yield to ringing ones: avoids clicks).
   */
  tryAcquire(group: string, now: number, duration: number, maxVoices: number, minGap = 0): boolean {
    let g = this.groups.get(group);
    if (!g) {
      g = { ends: [], last: -Infinity };
      this.groups.set(group, g);
    }
    g.ends = g.ends.filter((t) => t > now);
    if (g.ends.length >= maxVoices || now - g.last < minGap) return false;
    g.ends.push(now + duration);
    g.last = now;
    return true;
  }

  active(group: string, now: number): number {
    return this.groups.get(group)?.ends.filter((t) => t > now).length ?? 0;
  }
}

/** C major pentatonic degrees (semitones from C). */
const PENTATONIC = [0, 2, 4, 7, 9];

export function midiToFreq(m: number): number {
  return 440 * 2 ** ((m - 69) / 12);
}

/** Nearest pentatonic MIDI note to a frequency, so rapid absorbs sound melodic. */
export function quantizeToPentatonic(freq: number): number {
  const m = 69 + 12 * Math.log2(freq / 440);
  const base = Math.floor(m / 12) * 12;
  let best = m;
  let bestD = Infinity;
  for (const oct of [base - 12, base, base + 12]) {
    for (const d of PENTATONIC) {
      const n = oct + d;
      const dist = Math.abs(n - m);
      if (dist < bestD) {
        bestD = dist;
        best = n;
      }
    }
  }
  return best;
}

export interface AbsorbTone {
  /** Fundamental frequency (Hz). */
  freq: number;
  /** Seconds. */
  duration: number;
  /** 0..1 loudness before the SFX bus. */
  gain: number;
  /** 0 = pure "pip", 1 = round "bloop" with a body thump. */
  body: number;
  /** Pitch slide multiplier over the note (<1 drops). */
  slide: number;
}

/**
 * Absorb sound by Debris size (cm). Small things are high pips, big things low bloops;
 * relative size (size / Bunny radius) makes satisfying "big for you" absorbs louder.
 * `rand` in [0, 1) adds slight variation.
 */
export function absorbTone(size: number, radius: number, rand: number, kind: 'debris' | 'hazard' = 'debris'): AbsorbTone {
  const s = Math.max(0.05, size);
  const rel = Math.min(1, s / Math.max(0.01, radius) / 0.7);
  // Log mapping: 0.2 cm → ~1500 Hz, 50 cm → ~150 Hz.
  const raw = 1500 * (s / 0.2) ** -0.42;
  const jitter = 1 + (rand - 0.5) * 0.08;
  const freq = midiToFreq(quantizeToPentatonic(Math.min(1800, Math.max(110, raw * jitter))));
  const body = Math.min(1, Math.max(0, Math.log10(s / 0.3) / 2));
  return {
    freq,
    duration: 0.08 + body * 0.22 + (kind === 'hazard' ? 0.25 : 0),
    gain: 0.25 + rel * 0.45 + (kind === 'hazard' ? 0.2 : 0),
    body: kind === 'hazard' ? 1 : body,
    slide: 0.6 + rand * 0.15 + (1 - body) * 0.6,
  };
}

/** Music intensity 0..1 for a Tier (1–5); bosses push it to 1. */
export function musicIntensity(tier: number, boss: boolean): number {
  if (boss) return 1;
  return Math.min(0.9, 0.12 + (Math.max(1, tier) - 1) * 0.19);
}
