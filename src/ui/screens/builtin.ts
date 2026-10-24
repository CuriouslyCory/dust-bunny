/**
 * Core screens: title, playing, paused, plus results/settings/howToPlay (see results.ts, menus.ts).
 * With a Run saved (pause → Save & quit) the title leads with Resume run and Play becomes New run,
 * which asks once before abandoning the saved Run. A paused Run is stored too, so another tab's
 * title offers Resume run for it; the pausing tab then steps aside to the title with a notice
 * (`TitleParams.notice`, src/game/handoff.ts). Resume and New run take the slot under the saved
 * Run Web Lock (`withSavedRunLock`). Signed in, the title first syncs the slot with the Account's
 * saved Run (`AccountRuns.syncTitle`, src/meta/accountRun.ts), so a Run paused on another device is
 * offered here ("from another device"); Resume and New run then wait for the server. A saved Run
 * from a newer build is left alone, and the title says an update is needed to resume it.
 * Replace one by re-registering the same id before it is first shown. The title menu shows
 * Shop / Leaderboard buttons and the account chip (top right), and Play routes through
 * 'characterSelect' when that screen is registered. (A first Run opens on the story's 'intro'
 * screen instead of 'playing': Game.runOpening, src/story/install.ts.)
 */
import type { Game, TitleParams } from '../../game/game';
import { getMeta } from '../../meta/meta';
import { accountChip } from '../account/screen';
import { AREAS } from '../../data/areas';
import { getCharacter } from '../../data/characters';
import { getTier } from '../../data/tiers';
import type { RunSnapshot } from '../../game/snapshot';
import { abandonSuspendedRun, getSuspendedRuns, resumeSuspendedRun, withSavedRunLock } from '../../meta/suspendedRun';
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
      /**
       * The `runKey` of the saved Run on screen (null: none shown). Resume and New run only act on
       * that Run: if another tab has changed the slot since, they show the slot as it is instead.
       */
      let shownKey: string | null = null;
      const outOfDate = (): boolean => (saved.peek()?.runKey ?? null) !== shownKey;
      const onTitle = (): boolean => game.screens.current?.id === 'title';
      /** Resumes the Run on screen, under the lock (a paused tab may be taking it back right now). */
      /** Waiting for the server (Resume or New run, signed in): further presses do nothing. */
      let waiting = false;
      const resumeShown = (): void => {
        const key = shownKey;
        const shown = saved.peek();
        if (key === null || waiting || !shown || shown.runKey !== key) return;
        waiting = true;
        // The Account's copy is taken on the server first (src/meta/accountRun.ts): of two devices, one gets it.
        const take = (): Promise<string> => game.accountRuns.resume(shown, () => onTitle() && resumeSuspendedRun(game, saved, getMeta(), key));
        void withSavedRunLock(take)
          .catch(take)
          .then((res) => {
            waiting = false;
            if (res !== 'mine' && onTitle()) {
              refresh();
              sync();
            }
          });
      };
      const resume = button('Resume run', resumeShown, { variant: 'primary', size: 'lg', icon: '▶' });
      const resumeInfo = h('p', { className: 'saved-run-info' });
      const startNew = (): void => {
        if (outOfDate()) {
          refresh();
          return;
        }
        if (shownKey !== null && !confirmNew) {
          confirmNew = true;
          refresh();
          return;
        }
        // Confirmed: the saved Run is gone now (a quit), even if Character select is left with Back.
        const key = shownKey;
        if (key === null) {
          playFromMenu(game);
          return;
        }
        const shown = saved.peek();
        if (waiting || !shown) return;
        waiting = true;
        const abandonLocal = (): boolean => onTitle() && abandonSuspendedRun(saved, getMeta(), key);
        // The Account's copy is deleted first, only if no other device has taken it meanwhile.
        const abandon = (): Promise<string> => game.accountRuns.abandon(shown, abandonLocal);
        void withSavedRunLock(abandon)
          .catch(abandon)
          .then((res) => {
            waiting = false;
            if (!onTitle()) return;
            if (res === 'done') playFromMenu(game);
            else refresh(); // taken back (or replaced) meanwhile: show the slot as it is
          });
      };
      const play = button('Play', startNew, { variant: 'primary', size: 'lg', icon: '▶' });
      const playLabel = play.querySelector('.btn-label') as HTMLElement;
      const savedRun = h('div', { className: 'saved-run' }, resume, resumeInfo);
      /** Resume first while a Run is saved; Play becomes "New run" (asking before it abandons the saved one). */
      const refresh = (): void => {
        const s = saved.peek();
        const key = s?.runKey ?? null;
        // A different Run (or none) now: "Abandon saved run?" was about the one that was shown.
        if (!s || key !== shownKey) confirmNew = false;
        shownKey = key;
        if (!s && savedRun.contains(document.activeElement)) play.focus();
        savedRun.hidden = !s;
        const elsewhere = !!s && game.accountRuns.title.fromAccount === s.runKey;
        resumeInfo.textContent = s ? savedRunSummary(s) + (elsewhere ? ' · from another device' : '') : '';
        // A newer build's saved Run, here or on the Account: kept, but this build can't resume it.
        const newer = saved.newer || game.accountRuns.title.newerOnAccount;
        updateNote.hidden = !newer;
        updateNote.textContent = newer ? 'A saved run from a newer version of the game is waiting. Reload the page to update, then resume it.' : '';
        playLabel.textContent = !s ? 'Play' : confirmNew ? 'Abandon saved run?' : 'New run';
        play.classList.toggle('btn-primary', !s);
        play.classList.toggle('primary', !s);
        play.classList.toggle('btn-secondary', !!s);
        play.classList.toggle('btn-danger', confirmNew);
        play.classList.toggle('btn-lg', !s);
        play.classList.toggle('btn-md', !!s);
        hint.textContent = !s ? 'Enter to play · WASD / arrows to roll · Space to dash' : confirmNew ? 'Press New run again to give up the saved run (it counts as quit)' : 'Enter to resume · WASD / arrows to roll · Space to dash';
      };
      // Also fires for other tabs' Save & quit, Resume and New run (storage events), so the title stays current.
      saved.onChange(() => {
        if (game.screens.current?.id === 'title') refresh();
      });
      /** Signed in: brings the slot in line with the Account's saved Run, then shows it. */
      const sync = (): void => {
        if (!game.accountRuns.signedIn) return;
        void game.accountRuns.syncTitle().then(() => {
          if (onTitle()) refresh();
        });
      };
      // Signing in (or switching Account) on the title shows that Account's saved Run.
      game.accountRuns.onUser(() => {
        if (onTitle()) sync();
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
      /** Why the Run on screen went away (a paused Run picked up in another window). */
      const notice = h('p', { className: 'title-notice' });
      notice.setAttribute('role', 'status');
      const updateNote = h('p', { className: 'title-notice' });
      updateNote.hidden = true;
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
          notice,
          updateNote,
          menu(savedRun, play, secondary),
          hint,
        ),
      );
      return {
        el,
        enter(params?: unknown) {
          const text = (params as TitleParams | undefined)?.notice ?? '';
          notice.textContent = text;
          notice.hidden = !text;
          shop.hidden = !screenRegistry.has('shop');
          board.hidden = !screenRegistry.has('leaderboard');
          chipSlot.hidden = !screenRegistry.has('account');
          tagline.textContent = universeTagline(getMeta().universes);
          confirmNew = false;
          refresh();
          focusFirst(el, saved.has ? resume : play);
          sync();
        },
        onKey(e) {
          if (handleMenuKeys(e, el)) return true;
          if (isKey(e, 'Enter', 'Space') && !focusOnControl()) {
            // Only what the screen shows: a Run saved (or taken) by another tab since is shown first.
            if (outOfDate()) refresh();
            else if (shownKey === null) playFromMenu(game);
            else resumeShown();
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
      // Both end the Run only if it is still this tab's (another may have picked it up: Game.endRun).
      const end = button('End run', () => void game.endRun(), { variant: 'ghost' });
      // Keeps the Run on this device to resume from the title (src/meta/suspendedRun.ts).
      const save = button('Save & quit', () => game.saveAndQuit(), { icon: '💾' });
      const quit = button('Quit to title', () => void game.endRun(true), { variant: 'ghost' });
      settings.subscribe((s) => {
        (mute.querySelector('.btn-label') as HTMLElement).textContent = s.muted ? 'Unmute' : 'Mute';
        (mute.querySelector('.btn-icon') as HTMLElement).textContent = s.muted ? '🔇' : '🔊';
      });
      const el = panel({ title: 'Paused', className: 'pause-panel' }, menu(resume, save, h('div', { className: 'menu-grid' }, set, howTo, mute, end), quit));
      return {
        el,
        enter: () => {
          save.hidden = !game.canSaveRun;
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
