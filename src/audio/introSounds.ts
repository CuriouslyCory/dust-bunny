/**
 * The diegetic intro's sounds (docs/story.md "Intro sequence"): room tone and a clock, things
 * landing on the floor (tick · tink · thud), slippers, the hum under the couch and the bass note
 * on "Grow.". Recipes over AudioEngine; src/story/intro.ts cues them. All no-ops before unlock.
 */
import type { AudioEngine, Drone } from './engine';

export type DropSound = 'tick' | 'tink' | 'coin' | 'thud';

export class IntroSounds {
  constructor(private readonly a: AudioEngine) {}

  /** Low, steady room noise. Starts silent: returns the voice to raise and stop. */
  roomTone(): Drone | null {
    return this.a.drone({ type: 'noise', filter: 'lowpass', cutoff: 320, q: 0.5 });
  }

  /** One clock tick (`tock` a little lower), `gain` 0..1. */
  clockTick(tock: boolean, gain = 1): void {
    if (gain <= 0.01) return;
    this.a.tone({ type: 'sine', freq: tock ? 1900 : 2300, decay: 0.035, gain: 0.035 * gain });
    this.a.noise({ filter: 'highpass', freq: 4200, decay: 0.018, gain: 0.03 * gain });
  }

  /** Something small landing, dry and close. `pan` -1..1. */
  drop(kind: DropSound, pan = 0): void {
    const a = this.a;
    if (kind === 'tick') {
      a.noise({ filter: 'highpass', freq: 3000, decay: 0.022, gain: 0.09, pan });
      a.tone({ type: 'sine', freq: 3300, decay: 0.03, gain: 0.04, pan });
    } else if (kind === 'tink' || kind === 'coin') {
      const base = kind === 'coin' ? 2150 : 3150;
      const decay = kind === 'coin' ? 0.4 : 0.2;
      // Metal: inharmonic partials, then a smaller second bounce.
      [1, 1.66, 2.35].forEach((m, i) => {
        a.tone({ type: 'sine', freq: base * m, decay: decay / (1 + i * 0.6), gain: 0.05 / (1 + i * 0.5), pan });
        a.tone({ type: 'sine', freq: base * m * 1.01, delay: 0.11, decay: decay * 0.5, gain: 0.018 / (1 + i * 0.5), pan });
      });
      a.noise({ filter: 'highpass', freq: 5000, decay: 0.02, gain: 0.04, pan });
    } else {
      // A sock: soft, low, no ring.
      a.noise({ filter: 'lowpass', freq: 420, freqEnd: 150, decay: 0.14, gain: 0.14, pan });
      a.tone({ type: 'sine', freq: 95, freqEnd: 60, decay: 0.16, gain: 0.1, pan });
    }
  }

  /** A coin rolling for `seconds`, then wobbling flat (the rattle speeds up as it settles). */
  coinRoll(seconds: number, pan = 0): void {
    const a = this.a;
    a.noise({ filter: 'bandpass', freq: 2600, q: 4, attack: 0.04, hold: Math.max(0, seconds - 0.2), decay: 0.2, gain: 0.025, pan });
    let t = seconds;
    let gap = 0.09;
    for (let i = 0; i < 11; i++) {
      a.tone({ type: 'sine', freq: 2500 + i * 40, delay: t, decay: 0.025, gain: 0.035 * (1 - i / 14), pan });
      t += gap;
      gap *= 0.8;
    }
    a.tone({ type: 'sine', freq: 2150, delay: t + 0.02, decay: 0.25, gain: 0.03, pan });
  }

  /** One slipper step; `gain` falls as they walk away. */
  footstep(gain: number, pan = 0): void {
    const a = this.a;
    a.noise({ filter: 'bandpass', freq: 650, q: 0.8, attack: 0.01, decay: 0.11, gain: 0.11 * gain, pan });
    a.tone({ type: 'sine', freq: 85, freqEnd: 55, decay: 0.12, gain: 0.13 * gain, pan });
  }

  /** The hum under the couch: starts silent; raise it, then cut it on the blink. */
  hum(): Drone | null {
    const low = this.a.drone({ type: 'sawtooth', freq: 55, filter: 'lowpass', cutoff: 200, q: 1.2 });
    const high = this.a.drone({ type: 'sine', freq: 110.6 });
    if (!low || !high) return null;
    return {
      set(gain, seconds) {
        low.set(gain, seconds);
        high.set(gain * 0.35, seconds);
      },
      stop(seconds = 0) {
        low.stop(seconds);
        high.stop(seconds);
      },
    };
  }

  /** A single soft bass note (shot 6). */
  bass(): void {
    this.a.tone({ type: 'sine', freq: 55, attack: 0.08, hold: 0.5, decay: 3.2, gain: 0.24 });
    this.a.tone({ type: 'sine', freq: 110, attack: 0.08, hold: 0.3, decay: 2.2, gain: 0.06 });
    this.a.tone({ type: 'triangle', freq: 220, attack: 0.1, decay: 1.4, gain: 0.02, lowpass: 900 });
  }
}
