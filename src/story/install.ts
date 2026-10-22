/**
 * Browser wiring for the story (called once from main.ts): registers the intro and chapter
 * screens and tells one-off Debris lines. The other beats are hosted by the UI that already
 * shows that moment (see ./index.ts).
 */
import { STORY, type StoryLine } from '../data/story';
import type { Game } from '../game/game';
import { absorbedName } from '../ui/looseEvents';
import type { AreaId } from '../world/types';
import { captionDuration, narrate, setStoryAvailable, storyCaption } from './index';
import { canShowChapter, registerStoryScreens, type ChapterParams } from './screens';

export interface StoryOptions {
  /** False turns the narrator off for this page load (`?autostart`). */
  available?: boolean;
}

export function installStory(game: Game, opts: StoryOptions = {}): void {
  setStoryAvailable(opts.available ?? true);
  registerStoryScreens();

  // One-off Debris (docs/story.md: Voyager 1, the Moon…): a line the first time per Run.
  const told = new Set<string>();
  game.events.on('runStarted', () => told.clear());
  game.events.on('debrisAbsorbed', (e) => {
    if (!STORY.debris[e.typeId] || told.has(e.typeId)) return;
    told.add(e.typeId);
    const line = narrate(game.run, { kind: 'debris', typeId: e.typeId });
    if (!line) return;
    const caption = storyCaption(line);
    game.hud.banner(`+ ${absorbedName(e.typeId)}`, { variant: 'good', caption, duration: captionDuration(caption) });
  });
}

/**
 * Plays the chapter card for `area` when the narrator has a line for it and play is on screen:
 * the Run pauses behind a dark card (Space / Enter / tap cuts it short), then play resumes (or
 * the waiting Perk draft) and `done` runs. Returns false, doing nothing, otherwise.
 */
export function showChapterCard(game: Game, area: AreaId, done: () => void): boolean {
  const line: StoryLine | null = canShowChapter(game, area) ? narrate(game.run, { kind: 'entered', area }) : null;
  if (!line) return false;
  const params: ChapterParams = {
    area,
    line,
    done: () => {
      game.input.sample(); // drop a Dash queued by the Space that closed the card
      const run = game.run;
      if (run && !run.ended) game.go(run.perkDraft.active ? 'perkDraft' : 'playing');
      done();
    },
  };
  game.go('chapter', params);
  return true;
}
