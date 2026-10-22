import { describe, expect, it } from 'vitest';
import { STORY, type Story } from '../data/story';
import { beatLines, CAPTION_FADE_OUT, captionHold, captions, chapterOf, panelTiming, pickLine, readingSeconds, wordCount } from './narrator';

const story: Story = {
  ...STORY,
  tiers: { ...STORY.tiers, fluff: ['a', 'b', 'c', 'd'] },
  debris: { sock: [['First caption.', 'Second caption.']] },
};

describe('narrator', () => {
  it('picks the same variant for the same seed and beat, whatever else was said', () => {
    const first = pickLine('seed-1', { kind: 'tier', tier: 2 }, story);
    pickLine('seed-1', { kind: 'boss', area: 'house' }, story);
    pickLine('seed-1', { kind: 'tier', tier: 3 }, story);
    expect(pickLine('seed-1', { kind: 'tier', tier: 2 }, story)).toBe(first);
  });

  it('matches a string seed and the numeric seed of a Run with that seed', async () => {
    const { Rng } = await import('../core/rng');
    const seed = new Rng('abc').seed;
    expect(pickLine(seed, { kind: 'tier', tier: 2 }, story)).toBe(pickLine('abc', { kind: 'tier', tier: 2 }, story));
  });

  it('varies the line between Runs', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 64; i++) seen.add(pickLine(`run-${i}`, { kind: 'tier', tier: 2 }, story) as string);
    expect(seen).toEqual(new Set(['a', 'b', 'c', 'd']));
  });

  it('finds lines per beat and returns null when there are none', () => {
    expect(beatLines({ kind: 'tier', tier: 2 }, story)).toEqual(['a', 'b', 'c', 'd']);
    expect(beatLines({ kind: 'boss', area: 'city' })).toBe(STORY.areas.city.boss);
    expect(pickLine('x', { kind: 'tier', tier: 1 })).toBeNull();
    expect(pickLine('x', { kind: 'entered', area: 'house' })).toBeNull();
    expect(pickLine('x', { kind: 'debris', typeId: 'staple' }, story)).toBeNull();
    expect(pickLine('x', { kind: 'debris', typeId: 'sock' }, story)).toEqual(['First caption.', 'Second caption.']);
  });

  it('splits lines into captions', () => {
    expect(captions('One.')).toEqual(['One.']);
    expect(captions(['One.', 'Two.'])).toEqual(['One.', 'Two.']);
  });

  it('counts words, not separators', () => {
    expect(wordCount('Chapter 3 · Where People Drop Things')).toBe(6);
    expect(wordCount("  It's 4.6 billion years. ")).toBe(4);
    expect(wordCount('')).toBe(0);
  });

  it('holds a caption for its reading time at 100 WPM, with no upper cap', () => {
    expect(readingSeconds('one two three four five')).toBe(3);
    expect(captionHold('Short.')).toBe(2.5);
    const long = Array.from({ length: 30 }, () => 'word').join(' ');
    expect(captionHold(long)).toBeGreaterThanOrEqual(18);
    expect(captionHold('One two three.', 'Chapter 2 Title')).toBeGreaterThanOrEqual(readingSeconds('Chapter 2 Title One two three.'));
  });

  it('reveals a second caption once the first is read and holds the panel until both are', () => {
    const p = { caption: 'one two three four five six seven eight nine ten', caption2: 'one two three four five', hold: 3 };
    const { reveal, hold } = panelTiming(p);
    expect(reveal).toBeGreaterThanOrEqual(6);
    expect(hold - CAPTION_FADE_OUT - reveal).toBeGreaterThanOrEqual(3);
    // An authored hold longer than the reading time is kept.
    expect(panelTiming({ caption: 'Hi.', hold: 9 }).hold).toBe(9);
  });

  it('numbers chapters by Area order', () => {
    expect(chapterOf('house')).toEqual({ number: 1, title: 'Under the Couch' });
    expect(chapterOf('city').number).toBe(3);
  });
});
