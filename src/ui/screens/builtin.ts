/**
 * Core screens: title, playing, paused, plus results/settings/howToPlay (see results.ts, menus.ts).
 * Replace one by re-registering the same id before it is first shown. The title menu shows
 * Shop / Leaderboard buttons and the account chip (top right), and Play routes through
 * 'characterSelect' when that screen is registered. (A first Run opens on the story's 'intro'
 * screen instead of 'playing': Game.runOpening, src/story/install.ts.)
 */
import type { Game } from '../../game/game';
import { accountChip } from '../account/screen';
import { button, focusFirst, focusOnControl, handleMenuKeys, isKey, menu, panel } from '../components';
import { h, registerScreen, screenRegistry } from '../screens';
import { settings } from '../settings';
import { registerMenuScreens } from './menus';
import { registerResultsScreen } from './results';
import '../screens.css';

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

export function registerBuiltinScreens(): void {
  registerScreen({
    id: 'title',
    create(game) {
      const play = button('Play', () => playFromMenu(game), { variant: 'primary', size: 'lg', icon: '▶' });
      const shop = button('Shop', () => game.go('shop', { back: 'title' }), { icon: '🛍' });
      const board = button('Leaderboard', () => game.go('leaderboard'), { icon: '🏆' });
      const howTo = button('How to play', () => game.go('howToPlay', { back: 'title' }), { icon: '?' });
      const set = button('Settings', () => game.go('settings', { back: 'title' }), { icon: '⚙' });
      const secondary = h('div', { className: 'menu-grid' }, shop, board, howTo, set);
      const chip = accountChip(game);
      const chipSlot = h('div', {}, chip);
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
          h('p', { className: 'tagline', textContent: 'Roll. Absorb. Grow. Avoid the cleaning crew.' }),
          menu(play, secondary),
          h('p', { className: 'hint title-hint', textContent: 'Enter to play · WASD / arrows to roll · Space to dash' }),
        ),
      );
      return {
        el,
        enter() {
          shop.hidden = !screenRegistry.has('shop');
          board.hidden = !screenRegistry.has('leaderboard');
          chipSlot.hidden = !screenRegistry.has('account');
          focusFirst(el, play);
        },
        onKey(e) {
          if (handleMenuKeys(e, el)) return true;
          if (isKey(e, 'Enter', 'Space') && !focusOnControl()) {
            playFromMenu(game);
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
      const el = panel({ title: 'Paused', className: 'pause-panel' }, menu(resume, h('div', { className: 'menu-grid' }, set, howTo, mute, end), quit));
      return {
        el,
        enter: () => focusFirst(el, resume),
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
}
