/**
 * Story screens: the intro (static cards over dust motes, docs/story.md "Intro sequence") and the
 * chapter card shown on arriving in an Area. Both are built on `storyCards`, a caption player that
 * the ending will reuse. Captions appear whole (no typewriter): fade in, hold, fade out.
 */
import { STORY, type StoryLine, type StoryPanel } from '../data/story';
import type { Game } from '../game/game';
import { button, isKey } from '../ui/components';
import { h, registerScreen } from '../ui/screens';
import { dustMotes } from '../ui/screens/builtin';
import { settings } from '../ui/settings';
import { captionHold, captions, chapterOf } from './narrator';
import type { AreaId } from '../world/types';

/** Seconds before the end of a panel when its captions start fading out (CSS: 300 ms). */
const FADE_OUT = 0.3;
/** Pointer or key held this long skips the whole sequence. */
const HOLD_TO_SKIP = 0.6;
/** The chapter card ignores input this long after it opens (a tap or Space meant for play). */
const CHAPTER_ARM = 0.4;

export interface StoryCards {
  el: HTMLElement;
  /** Plays `panels` from the first; `done` runs once, when the last ends or on skip. */
  play(panels: readonly StoryPanel[], done: () => void): void;
  /** Next panel now (the last one finishes the sequence). */
  advance(): void;
  /** Ends the sequence now. */
  skip(): void;
  update(dt: number): void;
}

export function storyCards(): StoryCards {
  const first = h('p', { className: 'story-card-caption' });
  const second = h('p', { className: 'story-card-caption story-card-caption-2' });
  const el = h('div', { className: 'story-cards' }, first, second);
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  let panels: readonly StoryPanel[] = [];
  let index = -1;
  let t = 0;
  let finish: (() => void) | null = null;

  const show = (i: number): void => {
    index = i;
    t = 0;
    const p = panels[i]!;
    first.textContent = p.caption;
    second.textContent = p.caption2 ?? '';
    second.hidden = !p.caption2;
    first.classList.remove('show');
    second.classList.remove('show');
    void el.offsetWidth;
    first.classList.add('show');
  };
  const end = (): void => {
    const f = finish;
    finish = null;
    index = -1;
    f?.();
  };
  const advance = (): void => {
    if (!finish) return;
    if (index + 1 < panels.length) show(index + 1);
    else end();
  };
  return {
    el,
    play(next, done) {
      panels = next;
      finish = done;
      if (panels.length) show(0);
      else end();
    },
    advance,
    skip: end,
    update(dt) {
      if (!finish || index < 0) return;
      t += dt;
      const p = panels[index]!;
      // The second caption lands after a beat; both fade out together before the next panel.
      if (p.caption2 && t >= Math.min(1.4, p.hold * 0.4)) second.classList.add('show');
      if (t >= p.hold - FADE_OUT) {
        first.classList.remove('show');
        second.classList.remove('show');
      }
      if (t >= p.hold) advance();
    },
  };
}

/** Panels for a narrator line: one per caption, each held for its reading time. */
export function linePanels(line: StoryLine): StoryPanel[] {
  return captions(line).map((caption) => ({ caption, hold: captionHold(caption) + 0.4 }));
}

export interface IntroParams {
  /** Runs when the intro ends or is skipped (default: back to the title). */
  done?: () => void;
}

export interface ChapterParams {
  area: AreaId;
  line: StoryLine;
  /** Runs when the card ends or is cut short. */
  done: () => void;
}

/**
 * Tap / click: a quick press calls `tap`, a long one `hold`. `tick` runs per frame; `reset`
 * forgets a press still down (call it on enter / exit: its release may land on another screen).
 */
function pressHandler(el: HTMLElement, tap: () => void, hold: () => void): { tick(dt: number): void; reset(): void } {
  let held: number | null = null;
  el.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).closest('button')) return;
    held = 0;
  });
  const up = (): void => {
    if (held === null) return;
    held = null;
    tap();
  };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', () => (held = null));
  return {
    tick(dt) {
      if (held === null) return;
      held += dt;
      if (held >= HOLD_TO_SKIP) {
        held = null;
        hold();
      }
    },
    reset: () => (held = null),
  };
}

export function registerStoryScreens(): void {
  registerScreen({
    id: 'intro',
    simulate: false,
    create(game) {
      const cards = storyCards();
      let done: (() => void) | undefined;
      let active = false;
      const finish = (): void => {
        settings.update({ introSeen: true });
        if (!active) return;
        active = false;
        game.input.sample(); // drop a Dash queued by the Space presses that advanced the cards
        (done ?? (() => game.go('title')))();
      };
      const skip = button('Skip', () => cards.skip(), { variant: 'ghost', size: 'sm', icon: '⏭', className: 'story-skip' });
      const hint = h('p', { className: 'story-hint', textContent: 'Space / tap: next · hold to skip' });
      const el = h('div', { className: 'story-stage story-intro' }, dustMotes(36), cards.el, h('div', { className: 'story-foot' }, hint, skip));
      const press = pressHandler(el, () => cards.advance(), () => cards.skip());
      let keyHeld = 0;
      /** A key went down on this screen (a key still held from the title's Play must not skip). */
      let keyPressedHere = false;
      return {
        el,
        enter(params) {
          done = (params as IntroParams | undefined)?.done;
          active = true;
          keyHeld = 0;
          keyPressedHere = false;
          press.reset();
          cards.play(STORY.intro, finish);
        },
        exit() {
          // Left some other way: still counts as seen, but doesn't navigate.
          active = false;
          press.reset();
          cards.skip();
        },
        update(dt) {
          press.tick(dt);
          cards.update(dt);
        },
        onKey(e) {
          if (isKey(e, 'Escape')) {
            cards.skip();
            return true;
          }
          if (!isKey(e, 'Space', 'Enter', 'NumpadEnter')) return false;
          // Key repeat means it is being held: skip the lot.
          if (!e.repeat) {
            keyPressedHere = true;
            keyHeld = 0;
            cards.advance();
          } else if (keyPressedHere && ++keyHeld >= 3) {
            cards.skip();
          }
          return true;
        },
      };
    },
  });

  registerScreen({
    id: 'chapter',
    simulate: false,
    create() {
      const cards = storyCards();
      const label = h('p', { className: 'chapter-label' });
      const title = h('h2', { className: 'chapter-title' });
      const card = h('div', { className: 'chapter-card' }, label, h('div', { className: 'chapter-rule' }), title, cards.el);
      const el = h('div', { className: 'story-stage story-chapter' }, card);
      let armed = 0;
      const cut = (): void => {
        if (armed <= 0) cards.skip();
      };
      const press = pressHandler(el, cut, cut);
      let done: (() => void) | undefined;
      return {
        el,
        enter(params) {
          const p = params as ChapterParams;
          const chapter = chapterOf(p.area);
          label.textContent = `Chapter ${chapter.number}`;
          title.textContent = chapter.title;
          done = p.done;
          armed = CHAPTER_ARM;
          press.reset();
          cards.play(linePanels(p.line), () => {
            const d = done;
            done = undefined;
            d?.();
          });
        },
        exit() {
          done = undefined;
          press.reset();
          cards.skip();
        },
        update(dt) {
          armed = Math.max(0, armed - dt);
          press.tick(dt);
          cards.update(dt);
        },
        onKey(e) {
          if (!isKey(e, 'Space', 'Enter', 'NumpadEnter', 'Escape')) return false;
          if (!e.repeat) cut();
          return true;
        },
      };
    },
  });
}

/** True when the chapter card can take over: the Run is live and play is on screen (or a Perk draft). */
export function canShowChapter(game: Game, area: AreaId): boolean {
  const run = game.run;
  const screen = game.screens.current?.id;
  return !!run && !run.ended && run.area === area && (screen === 'playing' || screen === 'perkDraft');
}
