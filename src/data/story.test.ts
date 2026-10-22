import { describe, expect, it } from 'vitest';
import { CAPTION_FADE_OUT, captionHold, panelTiming, readingSeconds } from '../story/narrator';
import { AREA_ORDER } from '../world/types';
import { getDebrisType } from './debris';
import { STORY, STORY_CAPTION_MAX, type StoryLine } from './story';
import { TIERS } from './tiers';

const parts = (line: StoryLine): readonly string[] => (typeof line === 'string' ? [line] : line);

/** Every caption in the story, with where it comes from. */
function allCaptions(): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const p of STORY.intro) {
    out.push(['intro', p.caption]);
    if (p.caption2) out.push(['intro', p.caption2]);
  }
  for (const p of STORY.ending) if (p.caption) out.push([`ending ${p.shot}`, p.caption]);
  for (const [id, lines] of Object.entries(STORY.tiers)) for (const l of lines) for (const c of parts(l)) out.push([`tier ${id}`, c]);
  for (const [area, a] of Object.entries(STORY.areas)) {
    out.push([`${area} title`, a.title]);
    for (const beat of ['entered', 'cleared', 'boss'] as const) for (const l of a[beat]) for (const c of parts(l)) out.push([`${area} ${beat}`, c]);
  }
  for (const [id, lines] of Object.entries(STORY.debris)) for (const l of lines) for (const c of parts(l)) out.push([`debris ${id}`, c]);
  return out;
}

describe('story data', () => {
  it('has a line for every Tier-up and no lines for unknown Tiers', () => {
    for (const tier of TIERS.slice(1)) expect(STORY.tiers[tier.id]?.length ?? 0, tier.id).toBeGreaterThan(0);
    const ids = new Set(TIERS.map((t) => t.id));
    for (const id of Object.keys(STORY.tiers)) expect(ids.has(id), id).toBe(true);
  });

  it('has a chapter for every Area: title, boss and cleared lines, and an arrival line after the first', () => {
    for (const [i, area] of AREA_ORDER.entries()) {
      const a = STORY.areas[area];
      expect(a.title.length, area).toBeGreaterThan(0);
      expect(a.boss.length, area).toBeGreaterThan(0);
      expect(a.cleared.length, area).toBeGreaterThan(0);
      if (i > 0) expect(a.entered.length, area).toBeGreaterThan(0);
    }
  });

  it('keeps every caption within two lines and in the narrator voice', () => {
    for (const [where, text] of allCaptions()) {
      expect(text.trim().length, where).toBeGreaterThan(0);
      expect(text.length, `${where}: ${text}`).toBeLessThanOrEqual(STORY_CAPTION_MAX);
      expect(text, `${where}: no exclamation marks`).not.toContain('!');
    }
  });

  it('only names real Debris types for one-off lines', () => {
    for (const id of Object.keys(STORY.debris)) expect(getDebrisType(id), id).toBeDefined();
  });

  it('gives every intro panel time on screen', () => {
    expect(STORY.intro.length).toBeGreaterThan(0);
    for (const p of STORY.intro) expect(p.hold).toBeGreaterThan(1);
  });

  it('leaves every caption up long enough to read at 100 WPM', () => {
    for (const [where, text] of allCaptions()) expect(captionHold(text), `${where}: ${text}`).toBeGreaterThanOrEqual(readingSeconds(text));
    for (const p of STORY.intro) {
      const { reveal, hold } = panelTiming(p);
      const readable = p.caption2 ? reveal : hold - CAPTION_FADE_OUT;
      expect(readable, p.caption).toBeGreaterThanOrEqual(readingSeconds(p.caption));
      if (p.caption2) expect(hold - CAPTION_FADE_OUT - reveal, p.caption2).toBeGreaterThanOrEqual(readingSeconds(p.caption2));
    }
  });
});
