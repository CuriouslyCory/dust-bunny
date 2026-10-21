import { describe, expect, it } from 'vitest';
import { absorbTone, midiToFreq, musicIntensity, quantizeToPentatonic, VoiceLimiter } from './voices';

describe('VoiceLimiter', () => {
  it('caps concurrent voices and frees them when they end', () => {
    const v = new VoiceLimiter();
    expect(v.tryAcquire('absorb', 0, 0.5, 2)).toBe(true);
    expect(v.tryAcquire('absorb', 0.01, 0.5, 2)).toBe(true);
    expect(v.tryAcquire('absorb', 0.02, 0.5, 2)).toBe(false);
    expect(v.active('absorb', 0.02)).toBe(2);
    expect(v.tryAcquire('absorb', 0.6, 0.5, 2)).toBe(true);
    expect(v.tryAcquire('other', 0.02, 0.5, 2)).toBe(true);
  });

  it('enforces a minimum gap', () => {
    const v = new VoiceLimiter();
    expect(v.tryAcquire('ui', 0, 0.05, 8, 0.03)).toBe(true);
    expect(v.tryAcquire('ui', 0.01, 0.05, 8, 0.03)).toBe(false);
    expect(v.tryAcquire('ui', 0.04, 0.05, 8, 0.03)).toBe(true);
  });
});

describe('absorbTone', () => {
  it('drops in pitch and gains body as Debris gets bigger', () => {
    const tiny = absorbTone(0.2, 1, 0.5);
    const sock = absorbTone(6, 12, 0.5);
    const chair = absorbTone(40, 60, 0.5);
    expect(tiny.freq).toBeGreaterThan(sock.freq);
    expect(sock.freq).toBeGreaterThan(chair.freq);
    expect(chair.body).toBeGreaterThan(tiny.body);
    expect(chair.duration).toBeGreaterThan(tiny.duration);
  });

  it('is louder for things that are big relative to the Bunny', () => {
    expect(absorbTone(2, 3, 0.5).gain).toBeGreaterThan(absorbTone(2, 30, 0.5).gain);
  });

  it('quantizes to the pentatonic scale', () => {
    const t = absorbTone(1, 2, 0.3);
    const m = Math.round(69 + 12 * Math.log2(t.freq / 440));
    expect([0, 2, 4, 7, 9]).toContain(((m % 12) + 12) % 12);
    expect(quantizeToPentatonic(midiToFreq(61))).toBeOneOf([60, 62]);
  });
});

describe('musicIntensity', () => {
  it('rises with Tier and peaks for the boss', () => {
    expect(musicIntensity(1, false)).toBeLessThan(musicIntensity(3, false));
    expect(musicIntensity(5, false)).toBeLessThan(1);
    expect(musicIntensity(2, true)).toBe(1);
  });
});
