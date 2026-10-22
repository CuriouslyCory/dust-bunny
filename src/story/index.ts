/**
 * The storyline in the browser (docs/story.md). The lines are data (src/data/story.ts) and the
 * choice of variant is headless (./narrator.ts); this module says whether the narrator speaks
 * at all and hands a Run's line to the UI that hosts it:
 *
 *   narrate(run, { kind: 'boss', area })  → the line, or null (captions off, ?autostart, nothing to say)
 *   storyCaption(line)                    → `caption` for hud.banner (captions shown in turn)
 *
 * Hosts: Tier beats in the Perk draft header or the Tier-up banner (ui/hud.ts,
 * ui/screens/perkDraft.ts), boss beats in the boss banner (ui/hud.ts), cleared beats in the
 * exit-opened banner and the chapter card on areaEntered (ui/areaHud.ts), the chapter line on
 * results (ui/screens/results.ts). installStory (./install.ts) adds the intro and chapter screens.
 */
import type { StoryLine } from '../data/story';
import type { Run } from '../game/run';
import { settings } from '../ui/settings';
import { captionHold, captions, pickLine, type StoryBeat } from './narrator';
import './story.css';

export { captionHold, captions, chapterOf, type StoryBeat } from './narrator';

let available = true;

/** Turns the story off for this page load (`?autostart`: speedrunners see none of it). */
export function setStoryAvailable(on: boolean): void {
  available = on;
}

/** True when the narrator speaks: the page allows it and the Story captions setting is on. */
export function storyOn(): boolean {
  return available && settings.value.storyCaptions;
}

/** The line this Run tells for `beat`, or null when the story is off or has nothing to say. */
export function narrate(run: Run | null | undefined, beat: StoryBeat): StoryLine | null {
  if (!run || !storyOn()) return null;
  return pickLine(run.rng.seed, beat);
}

/** A line as a banner caption: its parts in turn, each held for its own reading time. */
export function storyCaption(line: StoryLine): { parts: string[]; holds: number[] } {
  const parts = captions(line);
  return { parts, holds: parts.map((p) => captionHold(p)) };
}

/** Seconds a banner carrying `caption` should stay up in total. */
export function captionDuration(caption: { holds: readonly number[] }): number {
  return caption.holds.reduce((sum, hold) => sum + hold, 0);
}

/** The intro plays on the first Play of a device while the story is on. */
export function introDue(): boolean {
  return storyOn() && !settings.value.introSeen;
}
