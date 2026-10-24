/**
 * Core screens: title, playing, paused, plus results/settings/howToPlay (see results.ts, menus.ts).
 * The pause menu has a secret code field that opens the cheats panel (src/cheats).
 * With a Run saved (pause → Save & quit) the title leads with Resume run and Play becomes New run,
 * which asks once before abandoning the saved Run.
 * Replace one by re-registering the same id before it is first shown. The title menu shows
 * Shop / Leaderboard buttons and the account chip (top right), and Play routes through
 * 'characterSelect' when that screen is registered. (A first Run opens on the story's 'intro'
 * screen instead of 'playing': Game.runOpening, src/story/install.ts.)
 */
import { cheatCodeEntry } from '../../cheats/screen';
import type { Game } from '../../game/game';
import { getMeta } from '../../meta/meta';
import { accountChip } from '../account/screen';
import { AREAS } from '../../data/areas';
import { getCharacter } from '../../data/characters';
import { getTier } from '../../data/tiers';
import type { RunSnapshot } from '../../game/snapshot';
import { abandonSuspendedRun, getSuspendedRuns, resumeSuspendedRun } from '../../meta/suspendedRun';
import { button, fmtTime, focusFirst, focusOnControl, handleMenuKeys, isKey, menu, panel } from '../components';
import { h, registerScreen, screenRegistry } from '../screens';
import { settings } from '../settings';
import { registerBossIntroScreen } from './bossIntro';
import { registerMenuScreens } from './menus';
import { registerResultsScreen } from './results';
import '../screens.css';

const TAGLINE = 'Roll. Absorb. Grow. Avoid the cleaning crew.';

/** Title tagline: after the first ending it counts the Universe being played (Universes + 1). */
function universeTagline(universes: number): string {
  return universes >= 1 ? `Universe ${universes + 1} · Roll. Absorb. Grow.` : TAGLINE;
}

/** Starts a Run, via character select when that screen exists. */
export function playFromMenu(game: Game): void {
  if (screenRegistry.has('characterSelect')) game.go('characterSelect');
  else game.startRun();
}

/** Floating dust motes behind the title. */
export function dustMotes(count: number): HTMLElement {
  const layer = h('div', { className: 'motes' });
  layer.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < count; i++) {
    const m = h('span', { className: 'mote' });
    const size = 3 + Math.random() * 9;
    m.style.cssText = `--x:${(Math.random() * 100).toFixed(1)}%;--y:${(Math.random() * 100).toFixed(1)}%;--s:${size.toFixed(1)}px;--d:${(9 + Math.random() * 14).toFixed(1)}s;--delay:${(-Math.random() * 20).toFixed(1)}s;--drift:${((Math.random() * 2 - 1) * 60).toFixed(0)}px;--o:${(0.25 + Math.random() * 0.5).toFixed(2)}`;
    layer.append(m);
  }
  return layer;
}

/** The fuzzy mascot used on the title (and anywhere else that wants it). */
export function mascot(className = ''): HTMLElement {
  const el = h(
    'div',
    { className: `mascot ${className}`.trim() },
    h('div', { className: 'mascot-fur' }),
    h('div', { className: 'mascot-face' }, h('span', { className: 'mascot-eye' }), h('span', { className: 'mascot-eye' }), h('span', { className: 'mascot-blush' }), h('span', { className: 'mascot-blush' })),
  );
  el.setAttribute('aria-hidden', 'true');
  return el;
}

function logo(): HTMLElement {
  const word = (text: string, cls: string, offset: number): HTMLElement =>
    h(
      'span',
      { className: `logo-word ${cls}` },
      ...[...text].map((c, i) => {
        const s = h('span', { className: 'logo-letter', textContent: c });
        s.style.setProperty('--i', String(i + offset));
        return s;
      }),
    );
  const el = h('h1', { className: 'logo' }, word('Dust', 'logo-dust', 0), word('Bunny', 'logo-bunny', 4));
  el.setAttribute('aria-label', 'Dust Bunny');
  return el;
}

/** One line about a saved Run: Character · Area · Tier · time played. */
export function savedRunSummary(s: RunSnapshot): string {
  return [getCharacter(s.characterId).name, AREAS[s.area].name, getTier(s.tier).name, fmtTime(s.time)].join(' · ');
}

export function registerBuiltinScreens(): void {
  registerScreen({
    id: 'title',
    create(game) {
      const saved = getSuspendedRuns();
      /** "New run" was pressed once while a Run is saved: the next press abandons it. */
      let confirmNew = false;
      const resume = button('Resume run', () => resumeSuspendedRun(game, saved, getMeta()), { variant: 'primary', size: 'lg', icon: '▶' });
      const resumeInfo = h('p', { className: 'saved-run-info' });
      const startNew = (): void => {
        if (saved.has && !confirmNew) {
          confirmNew = true;
          refresh();
          return;
        }
        // Confirmed: the saved Run is gone now (a quit), even if Character select is left with Back.
        abandonSuspendedRun(saved, getMeta());
        playFromMenu(game);
      };
      const play = button('Play', startNew, { variant: 'primary', size: 'lg', icon: '▶' });
      const playLabel = play.querySelector('.btn-label') as HTMLElement;
      const savedRun = h('div', { className: 'saved-run' }, resume, resumeInfo);
      /** Resume first while a Run is saved; Play becomes "New run" (asking before it abandons the saved one). */
      const refresh = (): void => {
        const s = saved.peek();
        savedRun.hidden = !s;
        resumeInfo.textContent = s ? savedRunSummary(s) : '';
        if (!s) confirmNew = false;
        playLabel.textContent = !s ? 'Play' : confirmNew ? 'Abandon saved run?' : 'New run';
        play.classList.toggle('btn-primary', !s);
        play.classList.toggle('primary', !s);
        play.classList.toggle('btn-secondary', !!s);
        play.classList.toggle('btn-danger', confirmNew);
        play.classList.toggle('btn-lg', !s);
        play.classList.toggle('btn-md', !!s);
        hint.textContent = !s ? 'Enter to play · WASD / arrows to roll · Space to dash' : confirmNew ? 'Press New run again to give up the saved run (it counts as quit)' : 'Enter to resume · WASD / arrows to roll · Space to dash';
      };
      saved.onChange(() => {
        if (game.screens.current?.id === 'title') refresh();
      });
      const shop = button('Shop', () => game.go('shop', { back: 'title' }), { icon: '🛍' });
      const board = button('Leaderboard', () => game.go('leaderboard'), { icon: '🏆' });
      const howTo = button('How to play', () => game.go('howToPlay', { back: 'title' }), { icon: '?' });
      const set = button('Settings', () => game.go('settings', { back: 'title' }), { icon: '⚙' });
      const secondary = h('div', { className: 'menu-grid' }, shop, board, howTo, set);
      const chip = accountChip(game);
      const chipSlot = h('div', {}, chip);
      const tagline = h('p', { className: 'tagline', textContent: TAGLINE });
      const hint = h('p', { className: 'hint title-hint' });
      const el = h(
        'div',
        { className: 'title-screen' },
        dustMotes(28),
        chipSlot,
        h(
          'div',
          { className: 'title-card' },
          mascot('title-mascot'),
          logo(),
          tagline,
          menu(savedRun, play, secondary),
          hint,
        ),
      );
      return {
        el,
        enter() {
          shop.hidden = !screenRegistry.has('shop');
          board.hidden = !screenRegistry.has('leaderboard');
          chipSlot.hidden = !screenRegistry.has('account');
          tagline.textContent = universeTagline(getMeta().universes);
          confirmNew = false;
          refresh();
          focusFirst(el, saved.has ? resume : play);
        },
        onKey(e) {
          if (handleMenuKeys(e, el)) return true;
          if (isKey(e, 'Enter', 'Space') && !focusOnControl()) {
            if (!resumeSuspendedRun(game, saved, getMeta())) playFromMenu(game);
            return true;
          }
          return false;
        },
      };
    },
  });

  registerScreen({
    id: 'playing',
    simulate: true,
    hud: true,
    create(game) {
      return {
        el: h('div', { className: 'screen-empty' }),
        onKey(e) {
          if (!e.repeat && isKey(e, 'Escape', 'KeyP')) {
            game.go('paused');
            return true;
          }
          if (!e.repeat && isKey(e, 'Enter', 'NumpadEnter')) {
            // Area cleared: skip the walk to the exit (same as the HUD's skip button).
            if (game.run?.leaveArea()) return true;
            // Otherwise dismiss the banner on screen (same as its ✕ button), unless Enter is pressing
            // a focused control (the pause button).
            if (!focusOnControl() && game.hud.skipBanner()) return true;
          }
          return false;
        },
      };
    },
  });

  registerScreen({
    id: 'paused',
    hud: true,
    create(game) {
      const resume = button('Resume', () => game.go('playing'), { variant: 'primary', size: 'lg', icon: '▶' });
      const set = button('Settings', () => game.go('settings', { back: 'paused' }), { icon: '⚙' });
      const howTo = button('How to play', () => game.go('howToPlay', { back: 'paused' }), { icon: '?' });
      const mute = button('', () => settings.update({ muted: !settings.value.muted }), { icon: '🔊' });
      const end = button('End run', () => game.quitRun(), { variant: 'ghost' });
      // Keeps the Run on this device to resume from the title (src/meta/suspendedRun.ts).
      const save = button('Save & quit', () => game.saveAndQuit(), { icon: '💾' });
      const quit = button(
        'Quit to title',
        () => {
          game.quitRun(); // emits runEnded so meta progress still records the Run
          game.disposeRun();
          game.go('title');
        },
        { variant: 'ghost' },
      );
      settings.subscribe((s) => {
        (mute.querySelector('.btn-label') as HTMLElement).textContent = s.muted ? 'Unmute' : 'Mute';
        (mute.querySelector('.btn-icon') as HTMLElement).textContent = s.muted ? '🔇' : '🔊';
      });
      // The secret code field: the right code opens the cheats panel (src/cheats).
      const code = cheatCodeEntry(game);
      const el = panel({ title: 'Paused', className: 'pause-panel' }, menu(resume, save, h('div', { className: 'menu-grid' }, set, howTo, mute, end), quit), code.el);
      return {
        el,
        enter: () => {
          save.hidden = !game.canSaveRun;
          code.reset();
          focusFirst(el, resume);
        },
        onKey(e) {
          if (!e.repeat && isKey(e, 'Escape', 'KeyP')) {
            game.go('playing');
            return true;
          }
          return handleMenuKeys(e, el);
        },
      };
    },
  });

  registerResultsScreen();
  registerMenuScreens();
  registerBossIntroScreen();
}
