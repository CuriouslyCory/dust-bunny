/**
 * Keepsake reveal (Run paused): shows what a boss left in the Bunny's fur. Opened by the HUD's
 * reward moment (src/ui/keepsakeHud.ts) once the area-cleared banner has had its time. Each drop
 * gets a chip with its effect; a first kill gets the choose-1-of-3 card (keys 1–3). The highlighted
 * type is already in the Hoard; Enter / Space / Esc or the button lock it in (tracker.lock) and
 * resume play (or the waiting Perk draft).
 */
import { getAudio } from '../../audio';
import { getCharacter } from '../../data/characters';
import { getGrade } from '../../data/keepsakes';
import type { Game } from '../../game/game';
import { getKeepsakeTracker, type KeepsakeDrop, type RunKeepsakes } from '../../meta/keepsakes';
import { storyOn } from '../../story';
import { button, handleMenuKeys, isKey, scrollArea } from '../components';
import { keepsakeChip } from '../keepsakeUi';
import { h, registerScreen } from '../screens';
import { choiceCard, type ChoiceNote } from './kept';
import '../roguelike.css';

export interface KeepsakeRevealParams {
  /** The Run's Keepsake record (the drops below are in `run.drops`). */
  run: RunKeepsakes;
  /** The drops of one boss kill (`keepsakesDropped.drops`). */
  drops: KeepsakeDrop[];
  firstKill: boolean;
  /** Narrator line for the drop (shown when story captions are on). */
  caption: string;
}

/** Input is ignored this long after the reveal opens (a Dash or click meant for play). */
const ARM_DELAY = 0.6;

const revealNote: ChoiceNote = () => 'Pick one. Keep rolling keeps the highlighted one.';

/** Pauses the Run and shows the drops. False, doing nothing, unless play is on screen. */
export function openKeepsakeReveal(game: Game, params: KeepsakeRevealParams): boolean {
  const run = game.run;
  if (!run || run.ended || game.screens.current?.id !== 'playing') return false;
  game.go('keepsakeReveal', params);
  return true;
}

export function registerKeepsakeRevealScreen(): void {
  registerScreen({
    id: 'keepsakeReveal',
    simulate: false,
    hud: true,
    create(game) {
      const label = h('p', { className: 'kr-label' });
      const title = h('h2');
      const story = h('p', { className: 'story-line' }, h('span', { className: 'story-line-text' }));
      const items = h('div', { className: 'kr-items' });
      const sub = h('p', { className: 'sub kr-sub' });
      const resume = button('Keep rolling', () => close(), { variant: 'primary', size: 'lg', icon: '▶' });
      const el = h('div', { className: 'panel rl-panel keepsake-reveal' }, label, title, story, scrollArea('kr-body', items), sub, h('div', { className: 'rl-row' }, resume));
      let params: KeepsakeRevealParams | null = null;
      let armed = 0;

      const render = (): void => {
        const p = params;
        if (!p) return;
        items.replaceChildren(
          ...p.drops.map((d) => {
            const index = p.run.drops.indexOf(d);
            if (d.offer && !d.locked && !p.run.settled && index >= 0) return choiceCard(p.run, index, d, render, revealNote);
            const item = h('div', { className: 'kept-item' }, keepsakeChip(d.ref, { describe: true }));
            if (d.bonus) item.append(h('span', { className: 'kept-bonus', textContent: 'Hardcore' }));
            return item;
          }),
        );
      };

      const close = (): void => {
        if (armed > 0 || !params) return;
        // The loot is final once the player rolls on: the highlighted type stays in the Hoard.
        const tracker = getKeepsakeTracker();
        for (const d of params.drops) tracker?.lock(d);
        params = null;
        game.input.sample(); // drop a Dash queued by the Space that closed the reveal
        const run = game.run;
        if (run && !run.ended) game.go(run.perkDraft.active ? 'perkDraft' : 'playing');
      };

      /** Picks offered type `i` of the first choice card on screen. */
      const chooseAt = (i: number): boolean => {
        const options = items.querySelector('.kept-choice')?.querySelectorAll<HTMLButtonElement>('.kept-option');
        const option = options?.[i];
        if (!option) return false;
        option.click();
        return true;
      };

      return {
        el,
        enter(raw) {
          const p = raw as KeepsakeRevealParams;
          params = p;
          armed = ARM_DELAY;
          el.classList.add('arming');
          const grade = getGrade(p.drops[0]?.ref.grade ?? 1);
          el.style.setProperty('--grade', grade.color);
          label.textContent = `${grade.bossName} absorbed`;
          title.textContent = p.firstKill ? `New Keepsake · ${grade.material}` : p.drops.length > 1 ? `${p.drops.length} Keepsakes!` : 'Keepsake!';
          story.hidden = !storyOn();
          story.firstElementChild!.textContent = p.caption;
          sub.textContent = `Tangled into ${getCharacter(p.run.characterId).name}'s fur · put it in a Loadout on Character select`;
          render();
          getAudio()?.sfx.perk();
          // No autofocus: Space (Dash) held through the kill would "click" a focused button.
          (document.activeElement as HTMLElement | null)?.blur?.();
        },
        exit() {
          params = null;
        },
        update(dt) {
          if (armed <= 0) return;
          armed = Math.max(0, armed - dt);
          if (armed <= 0) el.classList.remove('arming');
        },
        onKey(e) {
          if (e.repeat) return isKey(e, 'Space', 'Enter', 'NumpadEnter', 'Escape', 'KeyP');
          const n = /^Digit([1-9])$/.exec(e.code) ?? /^Numpad([1-9])$/.exec(e.code);
          if (n) return armed <= 0 && chooseAt(Number(n[1]) - 1);
          if (isKey(e, 'Space', 'Enter', 'NumpadEnter', 'Escape', 'KeyP')) {
            // Still arming: swallow the key so it can't click a focused option either.
            if (armed > 0) return true;
            // Enter on a focused option picks it (the browser's click); otherwise any of these resume.
            const focused = document.activeElement as HTMLElement | null;
            if (isKey(e, 'Enter', 'NumpadEnter', 'Space') && focused && focused !== resume && el.contains(focused)) return false;
            close();
            return true;
          }
          return handleMenuKeys(e, el);
        },
      };
    },
  });
}
