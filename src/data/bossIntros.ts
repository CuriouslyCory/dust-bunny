/**
 * The boss intro card's copy (src/ui/screens/bossIntro.ts): per Area boss a short description in
 * the narrator's voice (what it is and how to fight it), an accent colour for the card, and the
 * line saying how many hits break it. Headless; the card's timing is `bossIntroHold`.
 */
import { captionHold } from '../story/narrator';
import type { AreaId } from '../world/types';
import { AREA_BOSSES } from './hazards';

export interface BossIntro {
  /** What it is and a hint for the fight (≤ STORY_CAPTION_MAX characters, no exclamation marks). */
  readonly description: string;
  /** Card accent (title glow, stripes, backdrop tint). */
  readonly color: string;
}

/** Keyed by the boss's Hazard def id (AREA_BOSSES[area].id). */
export const BOSS_INTROS: Readonly<Record<string, BossIntro>> = {
  robovac_9000: {
    description: 'The finest robot vacuum money can buy. Its charges stop at walls, and a dazed Robo-Vac can be rammed.',
    color: '#ff5a4a',
  },
  street_sweeper: {
    description: 'The biggest broom the city owns, with mowers in tow. Houses, trees and hedges stop its charges. Ram it while it is dazed.',
    color: '#ff9f2e',
  },
  garbage_truck: {
    description: 'Its compactor pulls in whatever is near. Lead its charge into a building or the barrier, then ram it while it is stunned.',
    color: '#7fd35b',
  },
  incinerator: {
    description: 'It burns what it catches and coughs ash down amber lanes. Bait its charge into a town or the map edge, then ram it.',
    color: '#ff7a2f',
  },
  ice_sheet: {
    description: 'Slow, enormous, and pushing everything ahead of its cliff. Only a mountain range stops it. Ram it while it is wedged there.',
    color: '#8fdcff',
  },
  orbital_sweeper: {
    description: 'A vacuum for low orbit, with a capture net and twin lasers. Only the Moon stops its charge. Keep the Moon in its way.',
    color: '#a4b8ff',
  },
  the_sun: {
    description: 'It blows everything outward and throws flares. Only a giant planet eclipses its charge. Ram it while it sits in the dark.',
    color: '#ffc23a',
  },
  sagittarius_a: {
    description: 'The galaxy’s drain. It pulls hardest of all and eats what drifts in. Feed it star clusters too fast and it chokes. Ram it then.',
    color: '#b57cff',
  },
  the_expansion: {
    description: 'Not a thing but a rule: everything drifts apart. Eat fast to pull it back together. If the bar runs empty, the universe tears.',
    color: '#7f8cff',
  },
};

/** The card is never up for less than this (s), however short its text. */
export const BOSS_INTRO_MIN_HOLD = 4;

/** The Area whose boss is `defId`, or undefined for a Hazard that is no Area's boss. */
export function bossArea(defId: string): AreaId | undefined {
  return (Object.keys(AREA_BOSSES) as AreaId[]).find((a) => AREA_BOSSES[a].id === defId);
}

/**
 * How the boss is beaten: "3 hits to break it · or grow big enough to absorb it" (the Expansion,
 * never absorbed by size: "7 notches of gravity to collapse it"). Empty for an unknown boss.
 */
export function bossHitsLine(defId: string): string {
  const area = bossArea(defId);
  if (!area) return '';
  const boss = AREA_BOSSES[area];
  const hits = boss.hits;
  if (!hits) return '';
  if (!Number.isFinite(boss.size)) return `${hits} ${hits === 1 ? 'notch' : 'notches'} of gravity to collapse it`;
  return `${hits} ${hits === 1 ? 'hit' : 'hits'} to break it · or grow big enough to absorb it`;
}

/**
 * Seconds the card stays up before it closes itself: the description read at READING_WPM with the
 * boss name as its heading, plus each narrator caption shown with it (`captionHold`), at least
 * BOSS_INTRO_MIN_HOLD. The hits line is status text and adds nothing.
 */
export function bossIntroHold(name: string, description: string, narrator: readonly string[] = []): number {
  const desc = description ? captionHold(description, name) : 0;
  return Math.max(BOSS_INTRO_MIN_HOLD, narrator.reduce((sum, part) => sum + captionHold(part), desc));
}
