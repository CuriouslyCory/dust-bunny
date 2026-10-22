/**
 * The ending's sound (docs/story.md "Ending sequence"), played on `storyCue` (src/audio/index.ts).
 * Everything goes through one bus that `stop` fades out when the ending is left, so skipping it
 * cuts the fire and the shimmer cleanly. Timings inside a shot follow `ENDING_BEATS`.
 */
import type { EndingCue } from '../data/story';
import { ENDING_BEATS } from '../story/ending';
import type { AudioEngine } from './engine';
import type { Music } from './music';
import type { Sfx } from './sfx';
import { midiToFreq } from './voices';

export class EndingAudio {
  private bus: GainNode | null = null;
  private fire: GainNode | null = null;
  private note: { oscs: OscillatorNode[]; gain: GainNode } | null = null;

  constructor(
    private readonly a: AudioEngine,
    private readonly music: Music,
    private readonly sfx: Sfx,
  ) {}

  private out(): GainNode | null {
    const ctx = this.a.ctx;
    if (!ctx) return null;
    if (!this.bus) {
      this.bus = ctx.createGain();
      this.bus.connect(this.a.sfx);
    }
    return this.bus;
  }

  /** Plays shot cue `cue`; `reduced` (reduced motion) moves the Bang to its later, softer start. */
  cue(cue: EndingCue, reduced = false): void {
    const bus = this.out();
    // The music is the one thing that changes without an AudioContext.
    if (cue === 'held_note') this.music.hush(true);
    if (cue === 'theme') {
      this.music.hush(false);
      this.music.setBoss(false);
      this.music.intensity = 0.1;
    }
    if (!bus) return;
    const a = this.a;
    const now = a.now;
    switch (cue) {
      case 'held_note':
        this.holdNote(now);
        break;
      case 'silence':
        this.releaseNote(now, 0.08);
        break;
      case 'bang': {
        this.releaseNote(now, 0.05);
        const at = now + (reduced ? ENDING_BEATS.bang.atReduced : ENDING_BEATS.bang.at);
        // One enormous soft thump…
        a.tone({ type: 'sine', freq: 58, freqEnd: 24, at, attack: 0.02, decay: 3, gain: reduced ? 0.6 : 0.85, dest: bus });
        a.tone({ type: 'sine', freq: 96, freqEnd: 36, at, attack: 0.01, decay: 1.3, gain: 0.35, dest: bus });
        a.noise({ filter: 'lowpass', freq: 420, freqEnd: 50, at, attack: 0.015, decay: 2.4, gain: 0.3, dest: bus });
        // …and a long shimmer tail: high partials of an F major ninth, blooming and fading.
        const notes = [84, 88, 91, 93, 96, 98, 100, 103];
        for (let i = 0; i < 16; i++) {
          a.tone({
            type: 'sine',
            freq: midiToFreq(notes[i % notes.length]! + (i >= 8 ? 12 : 0)),
            detune: (Math.random() - 0.5) * 14,
            at: at + 0.05 + Math.random() * 0.7,
            attack: 0.4 + Math.random() * 0.8,
            decay: 3 + Math.random() * 3.5,
            gain: 0.008 + Math.random() * 0.01,
            pan: Math.random() * 1.6 - 0.8,
            dest: bus,
          });
        }
        a.noise({ filter: 'highpass', freq: 6500, freqEnd: 9500, at: at + 0.1, attack: 0.8, decay: 5, gain: 0.025, dest: bus });
        break;
      }
      case 'fire': {
        const ctx = a.ctx!;
        const fire = ctx.createGain();
        fire.connect(bus);
        this.fire = fire;
        const B = ENDING_BEATS.fire;
        // Rocks clacking: a hard click with a short knock under it.
        for (const s of B.strikes) {
          const at = now + s;
          a.noise({ filter: 'bandpass', freq: 2600, q: 5, at, decay: 0.05, gain: 0.32, dest: fire });
          a.tone({ type: 'triangle', freq: 1900, freqEnd: 1500, at, decay: 0.04, gain: 0.1, dest: fire });
          a.tone({ type: 'sine', freq: 430, freqEnd: 300, at, decay: 0.07, gain: 0.12, dest: fire });
        }
        // Fire: a soft roar with crackles, for the rest of this shot and the next.
        const lit = now + B.lit;
        a.noise({ filter: 'lowpass', freq: 520, at: lit, attack: 1.2, hold: 7.5, decay: 1.5, gain: 0.045, dest: fire });
        let t = lit + 0.1;
        while (t < lit + 9.5) {
          a.noise({ filter: 'highpass', freq: 2200 + Math.random() * 2500, at: t, attack: 0.001, decay: 0.006 + Math.random() * 0.018, gain: 0.03 + Math.random() * 0.09, pan: Math.random() * 0.4 - 0.2, dest: fire });
          t += 0.03 + Math.random() ** 2 * 0.3;
        }
        break;
      }
      case 'footsteps':
        this.sfx.footstepsReceding(ENDING_BEATS.stick.walk + 0.3, bus);
        break;
      case 'room_tone': {
        if (this.fire) this.fire.gain.setTargetAtTime(0.0001, now, 0.35);
        // Room tone and a faint hum.
        a.noise({ filter: 'lowpass', freq: 320, at: now, attack: 0.6, hold: 1.4, decay: 1.4, gain: 0.03, dest: bus });
        a.tone({ type: 'sine', freq: 110, at: now, attack: 0.8, hold: 1.2, decay: 1.4, gain: 0.014, dest: bus });
        a.tone({ type: 'sine', freq: 220, at: now, attack: 0.8, hold: 1.2, decay: 1.4, gain: 0.005, dest: bus });
        break;
      }
      case 'staple': {
        // A single staple landing, very small: a bright tick and a smaller bounce.
        const at = now + ENDING_BEATS.question.mark;
        for (const [d, g] of [[0, 1], [0.07, 0.35]] as const) {
          a.tone({ type: 'triangle', freq: 4300, at: at + d, decay: 0.05, gain: 0.05 * g, dest: bus });
          a.tone({ type: 'sine', freq: 6200, at: at + d, decay: 0.03, gain: 0.03 * g, dest: bus });
          a.noise({ filter: 'highpass', freq: 7000, at: at + d, attack: 0.001, decay: 0.012, gain: 0.05 * g, dest: bus });
        }
        break;
      }
    }
  }

  /** The music thins to one note: F4 with a soft octave under it, swelling in. */
  private holdNote(now: number): void {
    const ctx = this.a.ctx!;
    this.releaseNote(now, 0.05);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.09, now + 1.6);
    gain.connect(this.a.music);
    const oscs: OscillatorNode[] = [];
    for (const [m, type, g] of [[65, 'sine', 1], [53, 'triangle', 0.35]] as const) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = midiToFreq(m);
      const og = ctx.createGain();
      og.gain.value = g;
      osc.connect(og).connect(gain);
      osc.start(now);
      oscs.push(osc);
    }
    this.note = { oscs, gain };
  }

  /** The held note stops (`fade` seconds): what follows is true silence. */
  private releaseNote(now: number, fade: number): void {
    const n = this.note;
    if (!n) return;
    this.note = null;
    n.gain.gain.cancelScheduledValues(now);
    n.gain.gain.setTargetAtTime(0.0001, now, fade);
    for (const o of n.oscs) o.stop(now + fade * 8);
  }

  /** The ending was left (skipped, or the results came): fade whatever still sounds; the music plays again. */
  stop(): void {
    this.music.hush(false);
    const ctx = this.a.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    this.releaseNote(now, 0.1);
    const bus = this.bus;
    this.bus = null;
    this.fire = null;
    if (bus) {
      bus.gain.setTargetAtTime(0.0001, now, 0.25);
      window.setTimeout(() => bus.disconnect(), 2000);
    }
  }
}
