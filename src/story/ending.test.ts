import { describe, expect, it } from 'vitest';
import { STORY, type EndingShot } from '../data/story';
import { afterRunEnded, canSkipEnding, ENDING_AREA, ENDING_BEATS, ENDING_SKIPPABLE_FROM, endingSeconds, shotSeconds } from './ending';
import { CAPTION_FADE_OUT, readingSeconds } from './narrator';

describe('ending panels', () => {
  it('tells the ten shots in order (docs/story.md "Ending sequence")', () => {
    const shots: EndingShot[] = ['bunny', 'core', 'bang', 'planet', 'fire', 'stick', 'speck', 'the_end', 'question', 'fade'];
    expect(STORY.ending.map((p) => p.shot)).toEqual(shots);
  });

  it('captions the shots the storyboard captions, and no others', () => {
    const captioned = STORY.ending.filter((p) => p.caption).map((p) => p.shot);
    expect(captioned).toEqual(['bunny', 'core', 'planet', 'fire', 'stick']);
  });

  it('gives each shot its sound cue', () => {
    expect(Object.fromEntries(STORY.ending.map((p) => [p.shot, p.cue ?? null]))).toEqual({
      bunny: 'held_note',
      core: 'silence',
      bang: 'bang',
      planet: 'theme',
      fire: 'fire',
      stick: 'footsteps',
      speck: 'room_tone',
      the_end: null,
      question: 'staple',
      fade: null,
    });
  });

  it('holds every shot, long enough to read its caption at 100 WPM, about half a minute in all', () => {
    for (const p of STORY.ending) {
      expect(p.hold, p.shot).toBeGreaterThan(1);
      if (p.caption) expect(shotSeconds(p) - CAPTION_FADE_OUT, p.shot).toBeGreaterThanOrEqual(readingSeconds(p.caption));
      else expect(shotSeconds(p), p.shot).toBe(p.hold);
    }
    expect(endingSeconds()).toBeGreaterThan(28);
    expect(endingSeconds()).toBeLessThan(40);
  });

  it('keeps the shared beats inside their shots', () => {
    const hold = (shot: EndingShot): number => shotSeconds(STORY.ending.find((p) => p.shot === shot)!);
    expect(Math.max(...ENDING_BEATS.fire.strikes, ENDING_BEATS.fire.lit)).toBeLessThan(hold('fire'));
    expect(ENDING_BEATS.stick.walk).toBeLessThan(hold('stick'));
    expect(ENDING_BEATS.question.dots).toBeLessThan(hold('question'));
    expect(ENDING_BEATS.bang.atReduced).toBeLessThan(hold('bang'));
  });
});

describe('skipping the ending', () => {
  it('cannot skip before the Bang has played out', () => {
    const bang = STORY.ending.findIndex((p) => p.shot === 'bang');
    expect(ENDING_SKIPPABLE_FROM).toBe(bang + 1);
    for (let i = 0; i <= bang; i++) expect(canSkipEnding(i), `shot ${i + 1}`).toBe(false);
  });

  it('can skip every shot after it', () => {
    for (let i = ENDING_SKIPPABLE_FROM; i < STORY.ending.length; i++) expect(canSkipEnding(i), `shot ${i + 1}`).toBe(true);
  });
});

describe('routing a Run end', () => {
  it('plays the ending after a victory in the last Area while the story is available', () => {
    expect(ENDING_AREA).toBe('universe');
    expect(afterRunEnded('victory', 'universe', true)).toBe('ending');
  });

  it('goes straight to results with ?autostart (story unavailable)', () => {
    expect(afterRunEnded('victory', 'universe', false)).toBe('results');
  });

  it('goes to results for other Areas and other endings', () => {
    expect(afterRunEnded('victory', 'galaxy', true)).toBe('results');
    expect(afterRunEnded('died', 'universe', true)).toBe('results');
    expect(afterRunEnded('quit', 'universe', true)).toBe('results');
  });
});
