/**
 * WebAudio engine: master → (music, sfx) buses, a soft compressor, lazy AudioContext creation on
 * the first user gesture (browsers block audio before that), and small synth primitives
 * (`tone`, `noise`) that SFX and music are built from. No audio files.
 */
import { VoiceLimiter } from './voices';

export interface ToneOptions {
  type?: OscillatorType;
  freq: number;
  /** Pitch at the end of the note (exponential slide). */
  freqEnd?: number;
  /** Start time offset from now (s) or absolute when `at` is given. */
  delay?: number;
  at?: number;
  attack?: number;
  /** Time from peak to silence (s). */
  decay: number;
  /** Hold at peak before decaying (s). */
  hold?: number;
  gain: number;
  detune?: number;
  /** Optional lowpass cutoff (Hz). */
  lowpass?: number;
  /** Q for the filter. */
  q?: number;
  /** Stereo position -1..1. */
  pan?: number;
  dest?: AudioNode;
}

export interface NoiseOptions {
  delay?: number;
  at?: number;
  attack?: number;
  decay: number;
  hold?: number;
  gain: number;
  filter?: BiquadFilterType;
  freq?: number;
  freqEnd?: number;
  q?: number;
  pan?: number;
  dest?: AudioNode;
}

export class AudioEngine {
  ctx: AudioContext | null = null;
  master!: GainNode;
  music!: GainNode;
  /** Music passes through this lowpass so pause can muffle it. */
  musicFilter!: BiquadFilterNode;
  sfx!: GainNode;
  readonly voices = new VoiceLimiter();
  private noiseBuf: AudioBuffer | null = null;
  private volumes = { master: 0.8, music: 0.6, sfx: 0.8, muted: false };
  private duck = 1;
  private readyFns: Array<() => void> = [];

  get ready(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  get now(): number {
    return this.ctx?.currentTime ?? 0;
  }

  /** Runs `fn` once the context exists (immediately if it already does). */
  onReady(fn: () => void): void {
    if (this.ctx) fn();
    else this.readyFns.push(fn);
  }

  /** Creates/resumes the context. Call from a user gesture handler. */
  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      try {
        this.ctx = new Ctor({ latencyHint: 'interactive' });
      } catch {
        return;
      }
      this.build();
      for (const fn of this.readyFns.splice(0)) fn();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => {});
  }

  suspend(): void {
    if (this.ctx?.state === 'running') void this.ctx.suspend().catch(() => {});
  }

  resume(): void {
    if (this.ctx?.state === 'suspended') void this.ctx.resume().catch(() => {});
  }

  private build(): void {
    const ctx = this.ctx!;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.2;
    this.master = ctx.createGain();
    this.master.connect(comp).connect(ctx.destination);
    this.musicFilter = ctx.createBiquadFilter();
    this.musicFilter.type = 'lowpass';
    this.musicFilter.frequency.value = 18000;
    this.music = ctx.createGain();
    this.music.connect(this.musicFilter).connect(this.master);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    this.applyVolumes(true);
  }

  setVolumes(v: { master: number; music: number; sfx: number; muted: boolean }): void {
    this.volumes = { ...v };
    this.applyVolumes();
  }

  /** Muffles + quiets the music (pause / modal screens). 1 = normal. */
  setDuck(amount: number): void {
    this.duck = amount;
    this.applyVolumes();
    if (this.ctx) this.musicFilter.frequency.setTargetAtTime(amount < 1 ? 900 : 18000, this.ctx.currentTime, 0.12);
  }

  private applyVolumes(immediate = false): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const v = this.volumes;
    // Perceptual curve: squares feel more linear on a slider.
    const set = (p: AudioParam, val: number): void => {
      if (immediate) p.value = val;
      else p.setTargetAtTime(val, t, 0.05);
    };
    set(this.master.gain, v.muted ? 0 : v.master * v.master);
    set(this.music.gain, v.music * v.music * 0.55 * this.duck);
    set(this.sfx.gain, v.sfx * v.sfx);
  }

  private noiseBuffer(): AudioBuffer {
    if (!this.noiseBuf) {
      const ctx = this.ctx!;
      const len = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;
    }
    return this.noiseBuf;
  }

  private envelope(g: GainNode, start: number, attack: number, hold: number, decay: number, peak: number): number {
    const p = g.gain;
    p.setValueAtTime(0.0001, start);
    p.exponentialRampToValueAtTime(Math.max(0.0002, peak), start + attack);
    if (hold > 0) p.setValueAtTime(Math.max(0.0002, peak), start + attack + hold);
    const end = start + attack + hold + decay;
    p.exponentialRampToValueAtTime(0.0001, end);
    return end;
  }

  private output(dest: AudioNode | undefined, pan: number | undefined): AudioNode {
    const out = dest ?? this.sfx;
    if (pan === undefined || pan === 0 || !this.ctx!.createStereoPanner) return out;
    const p = this.ctx!.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    p.connect(out);
    return p;
  }

  /** Plays an oscillator note. Returns its end time (absolute). No-op before unlock. */
  tone(o: ToneOptions): number {
    const ctx = this.ctx;
    if (!ctx) return 0;
    const start = o.at ?? ctx.currentTime + (o.delay ?? 0);
    const osc = ctx.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(o.freq, start);
    if (o.detune) osc.detune.value = o.detune;
    const g = ctx.createGain();
    const end = this.envelope(g, start, o.attack ?? 0.005, o.hold ?? 0, o.decay, o.gain);
    if (o.freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.freqEnd), end);
    let node: AudioNode = osc;
    if (o.lowpass) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = o.lowpass;
      f.Q.value = o.q ?? 0.7;
      osc.connect(f);
      node = f;
    }
    node.connect(g).connect(this.output(o.dest, o.pan));
    osc.start(start);
    osc.stop(end + 0.02);
    return end;
  }

  /** Plays filtered white noise. Returns its end time. */
  noise(o: NoiseOptions): number {
    const ctx = this.ctx;
    if (!ctx) return 0;
    const start = o.at ?? ctx.currentTime + (o.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer();
    src.loop = true;
    const g = ctx.createGain();
    const end = this.envelope(g, start, o.attack ?? 0.005, o.hold ?? 0, o.decay, o.gain);
    let node: AudioNode = src;
    if (o.filter) {
      const f = ctx.createBiquadFilter();
      f.type = o.filter;
      f.frequency.setValueAtTime(o.freq ?? 1000, start);
      if (o.freqEnd) f.frequency.exponentialRampToValueAtTime(o.freqEnd, end);
      f.Q.value = o.q ?? 1;
      src.connect(f);
      node = f;
    }
    node.connect(g).connect(this.output(o.dest, o.pan));
    src.start(start, Math.random() * 1.5);
    src.stop(end + 0.02);
    return end;
  }
}
