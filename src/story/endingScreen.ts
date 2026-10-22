/**
 * The `ending` screen (docs/story.md "Ending sequence"): between the Universe's victory and the
 * results. `storyCards` plays `STORY.ending` (captions at the bottom, each shot's hold); as each
 * shot starts the screen emits `storyCue` (audio plays it) and points the ending scene
 * (src/fx/ending.ts, which Game renders instead of the Run while `game.ending` is set) at it.
 * "The End", its "?" and its "…" are DOM text on the black veil.
 *
 * Space / Enter / tap skip to the results, but only from the shot after the Bang. With Story
 * captions off the sequence still plays, without its captions.
 */
import { STORY, type EndingPanel } from '../data/story';
import { EndingScene } from '../fx/ending';
import { getQuality } from '../fx/quality';
import type { Game } from '../game/game';
import { getCharacter } from '../data/characters';
import type { GameEvents } from '../core/events';
import { isKey } from '../ui/components';
import { h, registerScreen } from '../ui/screens';
import { settings } from '../ui/settings';
import { canSkipEnding, ENDING_BEATS } from './ending';
import { pressHandler, storyCards } from './screens';

export interface EndingParams {
  /** The Run's end, handed to the results afterwards. */
  result: GameEvents['runEnded'];
  /** Start at this shot (debug only). */
  from?: number;
}

const smooth = (a: number, b: number, v: number): number => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function registerEndingScreen(): void {
  registerScreen({
    id: 'ending',
    simulate: false,
    create(game: Game) {
      const cards = storyCards();
      const veil = h('div', { className: 'ending-veil' });
      const period = h('span', { textContent: '.' });
      const mark = h('span', { className: 'ending-mark', textContent: '?' });
      const dots = h('span', { className: 'ending-mark', textContent: '…' });
      // "?…" hangs after the period so "The End." stays centred on its own.
      const words = h('span', { className: 'ending-words' }, 'The End', period, h('span', { className: 'ending-after' }, mark, dots));
      const title = h('h2', { className: 'ending-title' }, words);
      const hint = h('p', { className: 'story-hint ending-hint', textContent: 'Space / tap: skip' });
      const el = h('div', { className: 'story-stage story-ending' }, veil, title, h('div', { className: 'ending-captions' }, cards.el), hint);
      el.setAttribute('aria-label', 'The ending');
      let scene: EndingScene | null = null;
      let result: GameEvents['runEnded'] | null = null;
      let shots: readonly EndingPanel[] = STORY.ending;
      /** Index into STORY.ending of the first panel played (debug can start later). */
      let offset = 0;

      const close = (): void => {
        scene?.dispose();
        scene = null;
        game.ending = null;
      };
      const finish = (): void => {
        const r = result;
        result = null;
        close();
        game.input.sample(); // drop a Dash queued by the Space that skipped
        if (r) game.go('results', r);
      };
      const skippable = (): boolean => cards.index >= 0 && canSkipEnding(cards.index + offset);
      const trySkip = (): void => {
        if (skippable()) cards.skip();
      };
      const press = pressHandler(el, trySkip, trySkip);

      return {
        el,
        enter(params) {
          const p = params as EndingParams;
          result = p.result;
          offset = Math.max(0, Math.min(STORY.ending.length - 1, p.from ?? 0));
          shots = STORY.ending.slice(offset);
          const run = game.run;
          const look = run ? getCharacter(run.config.characterId).look : undefined;
          close();
          scene = new EndingScene({ look, reducedMotion: settings.value.reducedMotion, low: getQuality() === 'low' });
          game.ending = scene;
          cards.el.style.visibility = settings.value.storyCaptions ? '' : 'hidden';
          hint.hidden = true;
          title.style.opacity = '0';
          press.reset();
          cards.play(shots, finish, (panel, i) => {
            if (panel.cue) game.events.emit('storyCue', { cue: panel.cue, index: i + offset });
          });
        },
        exit() {
          // Left some other way (a new Run, the title): no results, just tidy up.
          result = null;
          press.reset();
          cards.skip();
          close();
        },
        update(dt) {
          press.tick(dt);
          cards.update(dt);
          const i = cards.index;
          if (i < 0 || !scene) return;
          const panel = shots[i]!;
          const t = cards.elapsed;
          el.dataset.shot = panel.shot; // for browser tests: which shot, how far in
          el.dataset.t = t.toFixed(2);
          const v = scene.update(Math.min(dt, 0.1), panel.shot, t, cards.hold);
          veil.style.background = v.color === 'white' ? '#fffaf0' : '#000';
          veil.style.opacity = v.opacity.toFixed(3);
          // The title card: "The End." fades in; the "?" lands after the period, then "…"; all fade out.
          const Q = ENDING_BEATS.question;
          const shown = panel.shot === 'the_end' ? smooth(0, 0.7, t) : panel.shot === 'question' ? 1 : panel.shot === 'fade' ? 1 - smooth(0, cards.hold * 0.85, t) : 0;
          title.style.opacity = shown.toFixed(3);
          const afterQ = panel.shot === 'fade' || (panel.shot === 'question' && t >= Q.mark);
          const afterDots = panel.shot === 'fade' || (panel.shot === 'question' && t >= Q.dots);
          mark.style.opacity = panel.shot === 'question' ? smooth(Q.mark, Q.mark + 0.4, t).toFixed(3) : afterQ ? '1' : '0';
          dots.style.opacity = panel.shot === 'question' ? smooth(Q.dots, Q.dots + 0.6, t).toFixed(3) : afterDots ? '1' : '0';
          hint.hidden = !skippable() || panel.shot === 'fade';
        },
        onKey(e) {
          if (!isKey(e, 'Space', 'Enter', 'NumpadEnter', 'Escape')) return false;
          if (!e.repeat) trySkip();
          return true;
        },
      };
    },
  });
}
