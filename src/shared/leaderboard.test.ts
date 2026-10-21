import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../data/characters';
import { isDifficultyId } from './difficulty';
import {
  cleanName,
  containsProfanity,
  FALLBACK_NAME,
  LEADERBOARD_CHARACTERS,
  sanitizeName,
  validateAreaSubmission,
  validateSubmission,
  type ScoreSubmission,
} from './leaderboard';
import { computeAreaScore, computeScore } from './score';

function submission(over: Partial<ScoreSubmission> = {}): ScoreSubmission {
  const s = { name: 'Fluffy', character: 'lint', maxRadius: 12.5, debrisAbsorbed: 340, tierReached: 3, durationMs: 240_000, victory: false, score: 0, ...over };
  return { ...s, score: over.score ?? computeScore({ ...s, difficulty: isDifficultyId(s.difficulty) ? s.difficulty : undefined }) };
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
    expect(err(submission({ maxRadius: 820, tierReached: 9, debrisAbsorbed: 9000, durationMs: 1_900_000, victory: true }))).toBeNull();
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

  it('defaults a missing difficulty to casual', () => {
    const r = validateSubmission(submission());
    expect(r.ok && r.value.difficulty).toBe('casual');
  });

  it('accepts known difficulties and scores them with the multiplier', () => {
    const r = validateSubmission(submission({ difficulty: 'hardcore' }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.difficulty).toBe('hardcore');
      expect(r.value.score).toBe(Math.round(computeScore({ ...submission(), difficulty: 'casual' }) * 1.6));
    }
    expect(err(submission({ difficulty: 'arcade' }))).toBeNull();
  });

  it('rejects unknown difficulties', () => {
    expect(err(submission({ difficulty: 'nightmare' }))).toBe('difficulty');
    expect(err({ ...submission(), difficulty: 2 })).toBe('difficulty');
    expect(err({ ...submission(), difficulty: null })).toBe('difficulty');
  });

  it('rejects a score computed for a different difficulty', () => {
    const casual = submission();
    expect(err({ ...casual, difficulty: 'hardcore' })).toBe('score');
    const hard = submission({ difficulty: 'hardcore' });
    expect(err({ ...hard, difficulty: 'casual' })).toBe('score');
    expect(err({ ...hard, difficulty: undefined })).toBe('score');
  });

  it('rejects a score that does not match the stats', () => {
    const s = submission();
    expect(err({ ...s, score: s.score + 1000 })).toBe('score');
    expect(err({ ...s, score: s.score + 1 })).toBeNull();
  });
});

describe('validateAreaSubmission', () => {
  const area = (o: Record<string, unknown> = {}) => {
    const f = { area: 'house', radiusIn: 1, maxRadius: 52, debrisAbsorbed: 900, durationMs: 400_000, difficulty: 'casual', ...o } as Parameters<typeof computeAreaScore>[0] & Record<string, unknown>;
    return { name: 'Lint', character: 'lint', ...f, score: computeAreaScore(f), runId: 'run-12345678' };
  };
  const areaErr = (b: unknown) => {
    const r = validateAreaSubmission(b);
    return r.ok ? null : r.field;
  };

  it('accepts a plausible clear of each Area', () => {
    expect(areaErr(area())).toBeNull();
    expect(areaErr(area({ area: 'neighborhood', radiusIn: 56, maxRadius: 190, debrisAbsorbed: 2000, durationMs: 500_000 }))).toBeNull();
    expect(areaErr(area({ area: 'city', radiusIn: 190, maxRadius: 840, debrisAbsorbed: 4000, durationMs: 800_000 }))).toBeNull();
    const r = validateAreaSubmission(area());
    expect(r.ok && r.value.runId).toBe('run-12345678');
  });

  it('rejects unknown Areas and bad Run ids', () => {
    expect(areaErr(area({ area: 'moon' }))).toBe('area');
    expect(areaErr({ ...area(), runId: 'x' })).toBe('runId');
    expect(areaErr({ ...area(), runId: 'a b c d e f g h' })).toBe('runId');
  });

  it('needs the boss Tier and plausible growth', () => {
    expect(areaErr(area({ maxRadius: 30 }))).toBe('maxRadius'); // Tier 4: the Robo-Vac 9000 never came
    expect(areaErr(area({ area: 'neighborhood', radiusIn: 56, maxRadius: 150 }))).toBe('maxRadius');
    expect(areaErr(area({ radiusIn: 30 }))).toBe('radiusIn'); // a Run starts small
    expect(areaErr(area({ maxRadius: 0.5 }))).toBe('maxRadius'); // below radiusIn
    expect(areaErr(area({ durationMs: 10_000 }))).toBe('maxRadius'); // too fast
    expect(areaErr(area({ debrisAbsorbed: 100_000 }))).toBe('debrisAbsorbed');
  });

  it('checks the score', () => {
    const s = area();
    expect(areaErr({ ...s, score: s.score + 50 })).toBe('score');
    expect(areaErr({ ...s, difficulty: 'hardcore' })).toBe('score');
  });
});
