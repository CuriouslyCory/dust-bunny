/**
 * Procedural lo-fi loop. A look-ahead scheduler places 16th-note events slightly ahead of
 * the audio clock. Layers fade in with `intensity` (0..1): pad + plucks always, bass from
 * ~0.25, kick/rim from ~0.35, hats from ~0.5, busier hats/melody near 1. Boss mode switches
 * to a minor progression at a faster tempo.
 */
import { mulberry32 } from '../core/rng';
import type { AudioEngine } from './engine';
import { midiToFreq } from './voices';

interface Progression {
  bpm: number;
  /** Chords as MIDI notes (root first). */
  chords: number[][];
  /** Melody scale (MIDI) for plucks. */
  scale: number[];
}

const CALM: Progression = {
  bpm: 76,
  chords: [
    [53, 57, 60, 64], // Fmaj7
    [52, 55, 59, 62], // Em7
    [50, 53, 57, 60], // Dm7
    [48, 52, 55, 59], // Cmaj7
  ],
  scale: [72, 74, 76, 79, 81, 84, 86, 88],
};

const BOSS: Progression = {
  bpm: 96,
  chords: [
    [50, 53, 57, 60], // Dm7
    [46, 50, 53, 57], // Bbmaj7
    [43, 46, 50, 53], // Gm7
    [45, 49, 52, 55], // A7
  ],
  scale: [74, 76, 77, 79, 81, 84, 86, 89],
};

const LOOKAHEAD = 0.25;
const TICK_MS = 60;

export class Music {
  intensity = 0.15;
  private boss = false;
  private playing = false;
  /** Held silent (the intro, until "Grow."): start() does nothing. */
  private held = false;
  private timer: number | undefined;
  private nextTime = 0;
  private step = 0;
  private bar = 0;
  /** Melody pattern for the current 2-bar phrase (index = 16th step, value = scale idx or -1). */
  private phrase: number[] = [];
  private rng = mulberry32(1234);

  constructor(private readonly a: AudioEngine) {}

  get prog(): Progression {
    return this.boss ? BOSS : CALM;
  }

  setBoss(on: boolean): void {
    this.boss = on;
  }

  start(): void {
    if (this.playing || this.held) return;
    this.playing = true;
    this.a.onReady(() => {
      if (!this.playing || this.timer !== undefined) return;
      this.nextTime = this.a.now + 0.1;
      this.step = 0;
      this.timer = window.setInterval(() => this.schedule(), TICK_MS);
    });
  }

  /** Holds the loop silent (stopping it) or lets it start again. */
  hold(on: boolean): void {
    this.held = on;
    if (on) this.stop();
    else this.start();
  }

  stop(): void {
    this.playing = false;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  private schedule(): void {
    if (!this.a.ready) return;
    // After a long stall (tab hidden), skip ahead instead of bursting notes.
    if (this.nextTime < this.a.now - 0.5) this.nextTime = this.a.now + 0.05;
    while (this.nextTime < this.a.now + LOOKAHEAD) {
      this.playStep(this.step, this.nextTime);
      const sixteenth = 60 / this.prog.bpm / 4;
      // Lazy swing on off-16ths.
      this.nextTime += sixteenth * (this.step % 2 === 0 ? 1.12 : 0.88);
      this.step = (this.step + 1) % 16;
      if (this.step === 0) this.bar++;
    }
  }

  private newPhrase(density: number): void {
    const p: number[] = [];
    for (let i = 0; i < 32; i++) {
      const strong = i % 4 === 0 ? 0.5 : i % 2 === 0 ? 0.25 : 0.1;
      p.push(this.rng() < strong * density ? Math.floor(this.rng() * this.prog.scale.length) : -1);
    }
    this.phrase = p;
  }

  private playStep(step: number, t: number): void {
    const a = this.a;
    const dest = a.music;
    const I = this.intensity;
    const prog = this.prog;
    const chord = prog.chords[this.bar % prog.chords.length]!;
    const beat = 60 / prog.bpm;

    if (step === 0) {
      if (this.bar % 2 === 0) this.newPhrase(0.6 + I * 1.2);
      // Pad: detuned soft saws through a lowpass, whole bar.
      for (const m of chord) {
        for (const det of [-7, 7]) {
          a.tone({ type: 'sawtooth', freq: midiToFreq(m), detune: det, at: t, attack: 0.6, hold: beat * 2.6, decay: beat * 1.6, gain: 0.022, lowpass: 700 + I * 900, dest });
        }
      }
    }

    // Electric-piano-ish chord stabs on beat 2 and the "and" of 3.
    if (step === 4 || step === 10) {
      for (const m of chord.slice(1)) a.tone({ type: 'triangle', freq: midiToFreq(m + 12), at: t, decay: 0.45, gain: 0.018 + I * 0.01, lowpass: 2400, dest });
    }

    // Pluck melody.
    const idx = this.phrase[(this.bar % 2) * 16 + step] ?? -1;
    if (idx >= 0) {
      const m = prog.scale[idx]!;
      a.tone({ type: 'sine', freq: midiToFreq(m), at: t, attack: 0.003, decay: 0.38, gain: 0.05, dest, pan: (idx / prog.scale.length - 0.5) * 0.6 });
      a.tone({ type: 'triangle', freq: midiToFreq(m + 12), at: t, attack: 0.002, decay: 0.08, gain: 0.012, dest });
    }

    // Bass.
    if (I >= 0.25 && (step === 0 || step === 7 || (step === 10 && I > 0.6))) {
      const root = chord[0]! - 12;
      a.tone({ type: 'sine', freq: midiToFreq(step === 7 ? root + 7 : root), at: t, attack: 0.01, hold: beat * 0.3, decay: beat * 0.6, gain: 0.12, dest });
      a.tone({ type: 'triangle', freq: midiToFreq(root + 12), at: t, decay: beat * 0.3, gain: 0.02, lowpass: 600, dest });
    }

    // Kick: 1 and the "and" of 2 (lo-fi boom-bap), plus 3 when intense.
    if (I >= 0.35 && (step === 0 || step === 6 || (step === 8 && I > 0.7))) {
      a.tone({ type: 'sine', freq: 115, freqEnd: 42, at: t, attack: 0.002, decay: 0.28, gain: 0.22, dest });
    }
    // Rim / snare on 2 and 4.
    if (I >= 0.45 && (step === 4 || step === 12)) {
      a.noise({ at: t, filter: 'bandpass', freq: 1800, q: 0.8, decay: 0.14, gain: 0.08, dest });
      a.tone({ type: 'triangle', freq: 330, at: t, decay: 0.05, gain: 0.03, dest });
    }
    // Hats.
    const hat = I >= 0.8 ? true : I >= 0.5 ? step % 2 === 0 : false;
    if (hat) a.noise({ at: t, filter: 'highpass', freq: 7500, decay: step % 4 === 2 ? 0.06 : 0.03, gain: step % 4 === 2 ? 0.035 : 0.02, dest, pan: 0.2 });

    // Vinyl crackle.
    if (this.rng() < 0.35) a.noise({ at: t + this.rng() * beat * 0.25, filter: 'highpass', freq: 3000, attack: 0.001, decay: 0.008, gain: 0.015 + this.rng() * 0.02, dest, pan: this.rng() * 2 - 1 });
  }
}
