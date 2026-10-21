import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../data/characters';
import {
  cleanName,
  containsProfanity,
  FALLBACK_NAME,
  LEADERBOARD_CHARACTERS,
  sanitizeName,
  validateSubmission,
  type ScoreSubmission,
} from './leaderboard';
import { computeScore } from './score';

function submission(over: Partial<ScoreSubmission> = {}): ScoreSubmission {
  const s = { name: 'Fluffy', character: 'lint', maxRadius: 12.5, debrisAbsorbed: 340, tierReached: 3, durationMs: 240_000, victory: false, score: 0, ...over };
  return { ...s, score: over.score ?? computeScore(s) };
}

/** Field that failed validation, or null if it passed. */
const err = (body: unknown) => {
  const r = validateSubmission(body);
  return r.ok ? null : r.field;
};

describe('characters', () => {
  it('mirror src/data/characters.ts', () => {
    expect([...LEADERBOARD_CHARACTERS].sort()).toEqual(CHARACTERS.map((c) => c.id).sort());
  });
});

describe('sanitizeName', () => {
  it('trims, collapses whitespace and caps at 16 characters', () => {
    expect(sanitizeName('  Dust   Bunny  ')).toBe('Dust Bunny');
    expect(sanitizeName('abcdefghijklmnopqrstuvwxyz')).toBe('abcdefghijklmnop');
  });

  it('strips markup, control and invisible characters but keeps letters from any script', () => {
    expect(sanitizeName('<b>Bob</b>')).toBe('bBobb');
    expect(sanitizeName('a\u0000b​c\nd')).toBe('abc d');
    expect(sanitizeName('Zoë 日本')).toBe('Zoë 日本');
    expect(sanitizeName("O'Neil-2!")).toBe("O'Neil-2!");
  });

  it('returns empty for unusable names', () => {
    expect(sanitizeName('   ')).toBe('');
    expect(sanitizeName('<<>>')).toBe('');
  });
});

describe('profanity filter', () => {
  it('catches common words, leetspeak and padding', () => {
    for (const n of ['fuck', 'FuUuCk you', 'sh1t', 'b!tch', 's.h.i.t', 'big ass']) expect(containsProfanity(n), n).toBe(true);
  });

  it('leaves innocent names alone', () => {
    for (const n of ['Glass Cannon', 'Assassin', 'Dickens', 'Cocktail', 'Tumbleweed', 'Grape', 'Spicy']) expect(containsProfanity(n), n).toBe(false);
  });

  it('cleanName replaces profane names', () => {
    expect(cleanName('fuckface')).toEqual({ name: FALLBACK_NAME, censored: true });
    expect(cleanName(' Lint ')).toEqual({ name: 'Lint', censored: false });
  });
});

describe('validateSubmission', () => {
  it('accepts a plausible run and normalises the name', () => {
    const r = validateSubmission(submission({ name: '  Speedy   Lint ' }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.name).toBe('Speedy Lint');
  });

  it('accepts a victory', () => {
    expect(err(submission({ maxRadius: 220, tierReached: 7, debrisAbsorbed: 4000, durationMs: 1_100_000, victory: true }))).toBeNull();
  });

  it('rejects malformed bodies', () => {
    expect(err(null)).toBe('body');
    expect(err([])).toBe('body');
    expect(err('hi')).toBe('body');
  });

  it('rejects bad names', () => {
    expect(err(submission({ name: '' }))).toBe('name');
    expect(err(submission({ name: '   ' }))).toBe('name');
    expect(err({ ...submission(), name: 42 })).toBe('name');
    expect(err(submission({ name: 'x'.repeat(100) }))).toBe('name');
  });

  it('rejects unknown characters', () => {
    expect(err(submission({ character: 'roomba' }))).toBe('character');
  });

  it('rejects wrong types and out-of-range numbers', () => {
    expect(err({ ...submission(), maxRadius: '12' })).toBe('maxRadius');
    expect(err(submission({ maxRadius: Number.NaN }))).toBe('maxRadius');
    expect(err(submission({ maxRadius: 9999 }))).toBe('maxRadius');
    expect(err(submission({ debrisAbsorbed: 1.5 }))).toBe('debrisAbsorbed');
    expect(err(submission({ debrisAbsorbed: -1 }))).toBe('debrisAbsorbed');
    expect(err(submission({ tierReached: 6 }))).toBe('tierReached');
    expect(err(submission({ durationMs: 10 }))).toBe('durationMs');
    expect(err({ ...submission(), victory: 'yes' })).toBe('victory');
  });

  it('rejects impossible combinations', () => {
    // Tier inconsistent with radius.
    expect(err(submission({ maxRadius: 2, tierReached: 4 }))).toBe('tierReached');
    expect(err(submission({ maxRadius: 50, tierReached: 2 }))).toBe('tierReached');
    // Victory before the last Tier.
    expect(err(submission({ victory: true }))).toBe('victory');
    // Growth without Debris.
    expect(err(submission({ maxRadius: 10, debrisAbsorbed: 0 }))).toBe('maxRadius');
    // Growth too fast for the duration.
    expect(err(submission({ maxRadius: 50, tierReached: 5, durationMs: 20_000 }))).toBe('maxRadius');
    // Absorbing too fast.
    expect(err(submission({ debrisAbsorbed: 100_000, durationMs: 60_000 }))).toBe('debrisAbsorbed');
  });

  it('allows the Tier to lag the radius by one tick', () => {
    expect(err(submission({ maxRadius: 45.2, tierReached: 4, debrisAbsorbed: 3000, durationMs: 500_000 }))).toBeNull();
  });

  it('rejects a score that does not match the stats', () => {
    const s = submission();
    expect(err({ ...s, score: s.score + 1000 })).toBe('score');
    expect(err({ ...s, score: s.score + 1 })).toBeNull();
  });
});
