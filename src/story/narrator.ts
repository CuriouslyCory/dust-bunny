/**
 * The narrator, headless: which line a story beat gets in a Run, how long a caption holds and
 * which chapter an Area is. Pure functions over src/data/story.ts, so it runs under Vitest.
 * The variant is seeded by the Run seed and the beat, so it doesn't depend on what else was said.
 */
import { Rng } from '../core/rng';
import { STORY, type Story, type StoryLine, type StoryPanel } from '../data/story';
import { getTier } from '../data/tiers';
import { AREA_ORDER, type AreaId } from '../world/types';

export type StoryBeat =
  | { kind: 'tier'; tier: number }
  | { kind: 'entered' | 'cleared' | 'boss'; area: AreaId }
  | { kind: 'debris'; typeId: string };

/** Every variant a beat can be told with (empty when the story has nothing to say there). */
export function beatLines(beat: StoryBeat, story: Story = STORY): readonly StoryLine[] {
  switch (beat.kind) {
    case 'tier':
      return story.tiers[getTier(beat.tier).id] ?? [];
    case 'debris':
      return story.debris[beat.typeId] ?? [];
    default:
      return story.areas[beat.area][beat.kind];
  }
}

function beatKey(beat: StoryBeat): string {
  if (beat.kind === 'tier') return `tier:${beat.tier}`;
  if (beat.kind === 'debris') return `debris:${beat.typeId}`;
  return `${beat.kind}:${beat.area}`;
}

/** The variant of `beat` told in the Run with this seed, or null when there is none. */
export function pickLine(seed: string | number, beat: StoryBeat, story: Story = STORY): StoryLine | null {
  const lines = beatLines(beat, story);
  if (lines.length === 0) return null;
  return new Rng(seed).fork('story').fork(beatKey(beat)).pick(lines);
}

/** The captions of a line, in the order they are shown. */
export function captions(line: StoryLine): string[] {
  return typeof line === 'string' ? [line] : [...line];
}

/**
 * Narration that leaves the screen on its own is paced for a reader at this many words per
 * minute (about the reading speed of a 10-year-old). It does not apply to status text such as
 * absorb toasts, and nothing caps it: a long line simply stays up longer.
 */
export const READING_WPM = 100;
/** Seconds added to every caption for its fade-in and for finding it on screen. */
export const CAPTION_LEAD = 0.5;
/** Seconds a caption takes to fade out (CSS: 300 ms); it is no longer readable meanwhile. */
export const CAPTION_FADE_OUT = 0.3;
/** No caption is up for less than this, however few its words. */
const CAPTION_MIN = 2.5;

/** Words in `text` (tokens with a letter or digit, so "·" and "—" don't count). */
export function wordCount(text: string): number {
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/** Seconds to read `text` at READING_WPM. */
export function readingSeconds(text: string): number {
  return (wordCount(text) * 60) / READING_WPM;
}

/**
 * Seconds a caption stays up: its reading time at READING_WPM plus CAPTION_LEAD. `heading` is
 * other text shown with it for the first time (a chapter title), read before the caption.
 */
export function captionHold(text: string, heading = ''): number {
  return Math.max(CAPTION_MIN, readingSeconds(`${heading} ${text}`) + CAPTION_LEAD);
}

/**
 * When a scripted panel's second caption appears and how long the panel holds: the second caption
 * waits until the first has been read, and the panel stays until both have (plus the fade out).
 * The authored `hold` is a minimum for pacing.
 */
export function panelTiming(panel: StoryPanel): { reveal: number; hold: number } {
  const first = captionHold(panel.caption);
  if (!panel.caption2) return { reveal: first, hold: Math.max(panel.hold, first + CAPTION_FADE_OUT) };
  const reveal = readingSeconds(panel.caption) + CAPTION_LEAD;
  return { reveal, hold: Math.max(panel.hold, reveal + captionHold(panel.caption2) + CAPTION_FADE_OUT) };
}

/** Chapter number (1-based position in AREA_ORDER) and title of an Area. */
export function chapterOf(area: AreaId, story: Story = STORY): { number: number; title: string } {
  return { number: AREA_ORDER.indexOf(area) + 1, title: story.areas[area].title };
}
