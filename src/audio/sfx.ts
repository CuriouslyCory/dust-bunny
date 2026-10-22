/** Synthesized sound effects. Each is a short recipe over AudioEngine.tone / noise. */
import type { AudioEngine } from './engine';
import { absorbTone, midiToFreq } from './voices';

const N = (m: number) => midiToFreq(m);

export class Sfx {
  constructor(private readonly a: AudioEngine) {}

  private gate(group: string, duration: number, max: number, gap = 0): boolean {
    return this.a.ready && this.a.voices.tryAcquire(group, this.a.now, duration, max, gap);
  }

  /** Absorb: pitch and timbre from Debris size, louder when big for the Bunny. `pan` -1..1. */
  absorb(size: number, radius: number, kind: 'debris' | 'hazard' = 'debris', pan = 0): void {
    const t = absorbTone(size, radius, Math.random(), kind);
    if (!this.gate('absorb', t.duration, kind === 'hazard' ? 8 : 6, kind === 'hazard' ? 0 : 0.022)) return;
    const a = this.a;
    // Pip / pluck.
    a.tone({ type: t.body > 0.5 ? 'triangle' : 'sine', freq: t.freq * 1.5, freqEnd: t.freq * t.slide, decay: t.duration, gain: t.gain * 0.35, pan });
    a.tone({ type: 'sine', freq: t.freq * 3, decay: t.duration * 0.4, gain: t.gain * 0.08 * (1 - t.body), pan });
    // Body thump for bigger things.
    if (t.body > 0.15) {
      a.tone({ type: 'sine', freq: Math.max(60, t.freq * 0.5), freqEnd: Math.max(40, t.freq * 0.25), attack: 0.004, decay: t.duration * 1.2, gain: t.gain * 0.45 * t.body, pan });
      a.noise({ filter: 'lowpass', freq: 900, freqEnd: 200, decay: 0.08 + t.body * 0.1, gain: t.gain * 0.12 * t.body, pan });
    }
    if (kind === 'hazard') {
      // Satisfying "gulp" sweep plus sparkle.
      a.tone({ type: 'square', freq: 220, freqEnd: 70, decay: 0.35, gain: 0.08, lowpass: 900 });
      [0, 4, 7, 12].forEach((s, i) => a.tone({ type: 'triangle', freq: N(76 + s), delay: 0.08 + i * 0.05, decay: 0.22, gain: 0.08 }));
    }
  }

  tierUp(tier: number): void {
    if (!this.gate('fanfare', 1.2, 2)) return;
    const a = this.a;
    const root = 60 + Math.min(6, tier - 1) * 2;
    const steps = [0, 4, 7, 12, 16];
    steps.forEach((s, i) => {
      a.tone({ type: 'triangle', freq: N(root + s), delay: i * 0.085, decay: 0.45, gain: 0.16 });
      a.tone({ type: 'sine', freq: N(root + s + 12), delay: i * 0.085, decay: 0.3, gain: 0.05 });
    });
    for (const s of [0, 4, 7, 11]) a.tone({ type: 'sawtooth', freq: N(root + s), delay: 0.42, attack: 0.04, hold: 0.25, decay: 0.8, gain: 0.035, lowpass: 2200 });
    a.noise({ filter: 'highpass', freq: 6000, delay: 0.42, attack: 0.02, decay: 0.7, gain: 0.04 });
  }

  damage(): void {
    if (!this.gate('damage', 0.4, 2, 0.08)) return;
    const a = this.a;
    a.tone({ type: 'square', freq: 260, freqEnd: 90, decay: 0.28, gain: 0.12, lowpass: 1600 });
    a.tone({ type: 'sawtooth', freq: 140, freqEnd: 55, decay: 0.32, gain: 0.08, lowpass: 900 });
    a.noise({ filter: 'bandpass', freq: 1800, freqEnd: 400, q: 1.5, decay: 0.2, gain: 0.18 });
  }

  death(): void {
    if (!this.gate('death', 2, 1)) return;
    const a = this.a;
    [67, 66, 65, 63].forEach((m, i) => a.tone({ type: 'triangle', freq: N(m), freqEnd: i === 3 ? N(m - 12) : undefined, delay: i * 0.28, hold: i === 3 ? 0.3 : 0.12, decay: i === 3 ? 0.9 : 0.2, gain: 0.16, lowpass: 2400 }));
    a.noise({ filter: 'lowpass', freq: 1200, freqEnd: 120, delay: 0.1, attack: 0.3, decay: 1.4, gain: 0.08 });
  }

  dash(): void {
    if (!this.gate('dash', 0.3, 2, 0.05)) return;
    const a = this.a;
    a.noise({ filter: 'bandpass', freq: 500, freqEnd: 3200, q: 1.2, attack: 0.03, decay: 0.24, gain: 0.32 });
    a.tone({ type: 'sine', freq: 300, freqEnd: 700, attack: 0.02, decay: 0.16, gain: 0.05 });
  }

  pickup(): void {
    if (!this.gate('pickup', 0.5, 3, 0.05)) return;
    const a = this.a;
    [79, 84, 88].forEach((m, i) => {
      a.tone({ type: 'sine', freq: N(m), delay: i * 0.06, decay: 0.35, gain: 0.13 });
      a.tone({ type: 'triangle', freq: N(m + 12), delay: i * 0.06, decay: 0.12, gain: 0.04 });
    });
  }

  heal(): void {
    if (!this.gate('heal', 0.5, 2, 0.1)) return;
    [72, 76, 79].forEach((m, i) => this.a.tone({ type: 'sine', freq: N(m), delay: i * 0.07, attack: 0.02, decay: 0.3, gain: 0.1 }));
  }

  perk(): void {
    if (!this.gate('perk', 0.8, 2, 0.1)) return;
    const a = this.a;
    [72, 79, 84, 88, 91].forEach((m, i) => a.tone({ type: 'triangle', freq: N(m), delay: i * 0.05, decay: 0.4, gain: 0.09, pan: (i - 2) * 0.25 }));
    a.noise({ filter: 'highpass', freq: 7000, attack: 0.05, decay: 0.5, gain: 0.03 });
  }

  uiHover(): void {
    if (!this.gate('ui', 0.05, 2, 0.04)) return;
    this.a.tone({ type: 'sine', freq: 1320, decay: 0.045, gain: 0.035 });
  }

  uiClick(): void {
    if (!this.gate('ui', 0.1, 3, 0.02)) return;
    this.a.tone({ type: 'sine', freq: 520, freqEnd: 880, decay: 0.08, gain: 0.12 });
    this.a.tone({ type: 'triangle', freq: 1040, decay: 0.05, gain: 0.03 });
  }

  /** Decoy shed: a soft fluffy "fwump" with a little rising pip. */
  decoyShed(): void {
    if (!this.gate('ability', 0.4, 2, 0.05)) return;
    const a = this.a;
    a.noise({ filter: 'lowpass', freq: 1400, freqEnd: 500, attack: 0.01, decay: 0.22, gain: 0.22 });
    a.tone({ type: 'sine', freq: 330, freqEnd: 520, attack: 0.01, decay: 0.18, gain: 0.08 });
  }

  /** Decoy popped (expired or shot): a dry puff. */
  decoyPop(): void {
    if (!this.gate('ability', 0.3, 2, 0.05)) return;
    const a = this.a;
    a.noise({ filter: 'bandpass', freq: 2200, freqEnd: 900, q: 1.4, decay: 0.12, gain: 0.2 });
    a.tone({ type: 'triangle', freq: 880, freqEnd: 440, decay: 0.08, gain: 0.05 });
  }

  /** A Hazard clogged on the Decoy: a choked motor sputtering out. */
  clog(boss = false): void {
    if (!this.gate('clog', 0.7, 2, 0.1)) return;
    const a = this.a;
    const f = boss ? 110 : 180;
    a.tone({ type: 'sawtooth', freq: f, freqEnd: f * 0.45, decay: 0.5, gain: 0.09, lowpass: 900 });
    for (let i = 0; i < 4; i++) a.noise({ filter: 'lowpass', freq: 700, delay: i * 0.08, decay: 0.05, gain: 0.12 * (1 - i * 0.2) });
    a.tone({ type: 'sine', freq: N(76), delay: 0.12, decay: 0.2, gain: 0.05 });
  }

  /** Hunker plant: a heavy low thud as Tumble digs in. */
  hunkerPlant(): void {
    if (!this.gate('ability', 0.4, 2, 0.05)) return;
    const a = this.a;
    a.tone({ type: 'sine', freq: 120, freqEnd: 55, attack: 0.005, decay: 0.3, gain: 0.22 });
    a.noise({ filter: 'lowpass', freq: 600, freqEnd: 150, decay: 0.18, gain: 0.16 });
  }

  /** Hunker release: a light upward shake-off. */
  hunkerRelease(): void {
    if (!this.gate('ability', 0.3, 2, 0.05)) return;
    const a = this.a;
    a.noise({ filter: 'bandpass', freq: 600, freqEnd: 1800, q: 1, attack: 0.02, decay: 0.16, gain: 0.12 });
    a.tone({ type: 'triangle', freq: 220, freqEnd: 330, decay: 0.12, gain: 0.05 });
  }

  /** Something crashed into a planted Tumble. */
  hunkerBlock(boss = false): void {
    if (!this.gate('block', 0.3, 2, 0.08)) return;
    const a = this.a;
    a.tone({ type: 'square', freq: boss ? 90 : 160, freqEnd: boss ? 50 : 90, decay: boss ? 0.35 : 0.15, gain: boss ? 0.12 : 0.07, lowpass: 700 });
    a.noise({ filter: 'lowpass', freq: 900, decay: 0.1, gain: boss ? 0.18 : 0.1 });
  }

  /** Static meter full: a quick bright crackle. */
  staticFull(): void {
    if (!this.gate('static', 0.4, 1, 0.3)) return;
    const a = this.a;
    a.noise({ filter: 'highpass', freq: 5000, decay: 0.15, gain: 0.07 });
    [84, 91].forEach((m, i) => a.tone({ type: 'sine', freq: N(m), delay: i * 0.05, decay: 0.15, gain: 0.05 }));
  }

  /** Discharge: an electric zap and crackle. */
  discharge(): void {
    if (!this.gate('zap', 0.5, 2, 0.05)) return;
    const a = this.a;
    a.tone({ type: 'sawtooth', freq: 1800, freqEnd: 120, decay: 0.28, gain: 0.1, lowpass: 5000 });
    a.tone({ type: 'square', freq: 60, freqEnd: 40, decay: 0.3, gain: 0.07, lowpass: 400 });
    for (let i = 0; i < 5; i++) a.noise({ filter: 'highpass', freq: 3000 + i * 600, delay: i * 0.035, decay: 0.04, gain: 0.12 });
  }

  /** Weather warm-up (the Hurricane's wind cone): a rising, roaring gust. */
  windRoar(): void {
    if (!this.gate('weather', 1.2, 2, 0.4)) return;
    const a = this.a;
    a.noise({ filter: 'bandpass', freq: 300, freqEnd: 1400, q: 0.8, attack: 0.5, hold: 0.3, decay: 0.7, gain: 0.12 });
    a.noise({ filter: 'lowpass', freq: 500, freqEnd: 250, attack: 0.3, hold: 0.4, decay: 0.6, gain: 0.08 });
  }

  /** Low ground rumble (a Volcano about to lob, the Ice Sheet's charge or its crash into a mountain). `big` is longer and deeper. */
  rumble(big = false): void {
    if (!this.gate('rumble', big ? 1.6 : 0.9, 2, 0.3)) return;
    const a = this.a;
    a.tone({ type: 'sawtooth', freq: big ? 48 : 62, freqEnd: big ? 32 : 44, attack: 0.08, hold: big ? 0.5 : 0.2, decay: big ? 0.9 : 0.5, gain: 0.12, lowpass: 220 });
    a.noise({ filter: 'lowpass', freq: big ? 260 : 380, freqEnd: 90, attack: 0.05, hold: big ? 0.4 : 0.15, decay: big ? 1 : 0.5, gain: big ? 0.16 : 0.1 });
  }

  bossWarning(): void {
    if (!this.gate('boss', 2.5, 1)) return;
    const a = this.a;
    for (let i = 0; i < 4; i++) {
      a.tone({ type: 'square', freq: i % 2 ? 392 : 523, delay: i * 0.36, hold: 0.24, decay: 0.1, gain: 0.07, lowpass: 1800 });
    }
    a.tone({ type: 'sawtooth', freq: 55, freqEnd: 41, delay: 0, attack: 0.2, hold: 1, decay: 0.6, gain: 0.1, lowpass: 300 });
  }

  victory(): void {
    if (!this.gate('fanfare', 3, 2)) return;
    const a = this.a;
    const seq: Array<[number, number, number]> = [
      [60, 0, 0.15],
      [64, 0.15, 0.15],
      [67, 0.3, 0.15],
      [72, 0.45, 0.5],
      [69, 0.95, 0.15],
      [72, 1.1, 0.15],
      [76, 1.25, 1.1],
    ];
    for (const [m, d, len] of seq) {
      a.tone({ type: 'triangle', freq: N(m), delay: d, hold: len * 0.6, decay: len, gain: 0.15 });
      a.tone({ type: 'square', freq: N(m), delay: d, hold: len * 0.4, decay: len * 0.8, gain: 0.025, lowpass: 2500 });
    }
    for (const m of [48, 60, 64, 67, 72]) a.tone({ type: 'sawtooth', freq: N(m), delay: 1.25, attack: 0.1, hold: 0.6, decay: 1.4, gain: 0.03, lowpass: 2000 });
    a.noise({ filter: 'highpass', freq: 5000, delay: 1.25, attack: 0.05, decay: 1.5, gain: 0.05 });
  }

  /** Footsteps walking away on sand, `delay` s from now (docs/story.md: intro shot 3 and ending shot 6). */
  footstepsReceding(delay = 0, dest?: AudioNode): void {
    if (!this.a.ready) return;
    const a = this.a;
    for (let i = 0; i < 9; i++) {
      const fade = 0.78 ** i;
      const at = a.now + delay + i * 0.38 + (i % 2) * 0.03;
      const pan = -0.1 - i * 0.06;
      a.tone({ type: 'sine', freq: 130, freqEnd: 70, at, attack: 0.004, decay: 0.1, gain: 0.22 * fade, pan, dest });
      a.noise({ filter: 'bandpass', freq: 1300 - i * 70, q: 1.2, at, attack: 0.004, decay: 0.07, gain: 0.1 * fade, pan, dest });
    }
  }

  /**
   * The Expansion's drone: one long, low, slowly falling swell (about 2.6 s; replayed while it is
   * alive, the swells overlap into a stretching drone). Lower and louder the more the expansion is
   * winning (`gravity` near 0).
   */
  expansionDrone(gravity: number): void {
    if (!this.gate('drone', 2.4, 2)) return;
    const a = this.a;
    const lose = 1 - Math.min(1, Math.max(0, gravity));
    const f = 46 + 18 * (1 - lose);
    a.tone({ type: 'sawtooth', freq: f, freqEnd: f * 0.94, attack: 0.9, hold: 0.8, decay: 1.1, gain: 0.05 + 0.04 * lose, lowpass: 180 + 120 * lose });
    a.tone({ type: 'sine', freq: f * 1.5, freqEnd: f * 1.38, attack: 1, hold: 0.6, decay: 1, gain: 0.025 });
    a.noise({ filter: 'bandpass', freq: 220, freqEnd: 120, q: 2, attack: 0.8, hold: 0.6, decay: 1.2, gain: 0.025 + 0.03 * lose });
  }

  /** The Big Rip: a tearing crack and a sliding groan. */
  rip(): void {
    if (!this.gate('rip', 1.2, 1)) return;
    const a = this.a;
    a.noise({ filter: 'highpass', freq: 1800, freqEnd: 400, decay: 0.35, gain: 0.16 });
    for (let i = 0; i < 4; i++) a.noise({ filter: 'bandpass', freq: 2600 - i * 450, q: 3, delay: i * 0.05, decay: 0.08, gain: 0.1 });
    a.tone({ type: 'sawtooth', freq: 180, freqEnd: 38, attack: 0.02, hold: 0.15, decay: 0.9, gain: 0.1, lowpass: 700 });
  }

  /** The Expansion collapses: everything rushes in (a rising suck), then a deep crunch. */
  crunch(duration: number): void {
    if (!this.gate('crunch', duration + 1, 1)) return;
    const a = this.a;
    a.noise({ filter: 'bandpass', freq: 200, freqEnd: 2400, q: 0.9, attack: duration * 0.85, decay: 0.2, gain: 0.12 });
    a.tone({ type: 'sawtooth', freq: 40, freqEnd: 160, attack: duration * 0.8, decay: 0.25, gain: 0.06, lowpass: 600 });
    a.tone({ type: 'square', freq: 90, freqEnd: 28, delay: duration, decay: 0.9, gain: 0.14, lowpass: 400 });
    a.noise({ filter: 'lowpass', freq: 900, freqEnd: 80, delay: duration, decay: 1.1, gain: 0.2 });
  }

  /** A gamma-ray burst charging: a thin rising whine. */
  burstCharge(duration: number): void {
    if (!this.gate('burst', duration, 2, 0.2)) return;
    const a = this.a;
    a.tone({ type: 'sine', freq: 600, freqEnd: 2400, attack: duration * 0.9, decay: 0.1, gain: 0.04 });
    a.tone({ type: 'square', freq: 1200, freqEnd: 4800, delay: duration * 0.5, attack: duration * 0.45, decay: 0.08, gain: 0.015, lowpass: 6000 });
  }
}
