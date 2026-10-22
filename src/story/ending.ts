/**
 * The ending, headless (docs/story.md "Ending sequence"): when it plays, when it can be skipped
 * and the moments inside a shot that the picture (src/fx/ending.ts) and the sound
 * (src/audio/ending.ts) share. The shots, captions, holds and cues are `STORY.ending`.
 */
import { STORY, type EndingCue, type EndingPanel } from '../data/story';
import { panelTiming } from './narrator';

declare module '../core/events' {
  interface GameEvents {
    /** The ending's shot `index` started (the `ending` screen); audio plays its `cue`. */
    storyCue: { cue: EndingCue; index: number };
  }
}

/** The Area whose victory plays the ending: the last one. A string so this compiles before the Area exists. */
export const ENDING_AREA: string = 'universe';

/** The first shot that Space / Enter / tap can skip: the one after the Bang, which should land once. */
export const ENDING_SKIPPABLE_FROM = STORY.ending.findIndex((p) => p.shot === 'bang') + 1;

/** True when the ending, showing shot `index`, may be skipped. */
export function canSkipEnding(index: number, from = ENDING_SKIPPABLE_FROM): boolean {
  return index >= from;
}

/**
 * Where a Run goes when it ends: the ending after a victory in the last Area while the story is
 * available on this page (not `?autostart`), the results otherwise. The Story captions setting
 * only hides the ending's captions.
 */
export function afterRunEnded(reason: 'died' | 'victory' | 'quit', area: string, storyAvailable: boolean): 'ending' | 'results' {
  return reason === 'victory' && area === ENDING_AREA && storyAvailable ? 'ending' : 'results';
}

/** Seconds a shot is on screen when nothing is skipped. */
export function shotSeconds(panel: EndingPanel): number {
  return panelTiming(panel).hold;
}

/** Seconds the whole ending runs when nothing is skipped. */
export function endingSeconds(panels: readonly EndingPanel[] = STORY.ending): number {
  return panels.reduce((sum, p) => sum + shotSeconds(p), 0);
}

/** Moments inside a shot (seconds from its start) that the picture and the sound both keep to. */
export const ENDING_BEATS = {
  /** The white frame, then the burst and the thump (later with reduced motion: a soft fade in). */
  bang: { at: 0.12, atReduced: 0.35 },
  /** The biped strikes the rocks (clacks) and the kindling catches. */
  fire: { strikes: [1.05, 1.5, 1.95], lit: 2.0 },
  /** It eats, drops the stick and walks off (footsteps). */
  stick: { eat: 1.7, drop: 2.5, walk: 2.9 },
  /** "?" lands after the period (the staple), then "…". */
  question: { mark: 0.5, dots: 1.7 },
} as const;
