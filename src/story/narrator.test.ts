import { describe, expect, it } from 'vitest';
import { STORY, type Story } from '../data/story';
import { beatLines, captionHold, captions, chapterOf, pickLine } from './narrator';

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

  it('splits lines into captions and holds each long enough to read', () => {
    expect(captions('One.')).toEqual(['One.']);
    expect(captions(['One.', 'Two.'])).toEqual(['One.', 'Two.']);
    expect(captionHold('Short.')).toBe(2.5);
    expect(captionHold('x'.repeat(140))).toBe(7);
    expect(captionHold('x'.repeat(60))).toBeGreaterThan(captionHold('x'.repeat(30)));
  });

  it('numbers chapters by Area order', () => {
    expect(chapterOf('house')).toEqual({ number: 1, title: 'Under the Couch' });
    expect(chapterOf('city').number).toBe(3);
  });
});
