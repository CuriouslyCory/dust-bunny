/**
 * The narrator, headless: which line a story beat gets in a Run, how long a caption holds and
 * which chapter an Area is. Pure functions over src/data/story.ts, so it runs under Vitest.
 * The variant is seeded by the Run seed and the beat, so it doesn't depend on what else was said.
 */
import { Rng } from '../core/rng';
import { STORY, type Story, type StoryLine } from '../data/story';
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

/** Seconds a caption stays up: long enough to read twice at a calm pace. */
export function captionHold(text: string): number {
  return Math.min(7, Math.max(2.5, 1.5 + text.length * 0.04));
}

/** Chapter number (1-based position in AREA_ORDER) and title of an Area. */
export function chapterOf(area: AreaId, story: Story = STORY): { number: number; title: string } {
  return { number: AREA_ORDER.indexOf(area) + 1, title: story.areas[area].title };
}
