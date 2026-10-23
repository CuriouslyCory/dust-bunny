/**
 * Keepsake reveal (Run paused): shows what a boss left in the Bunny's fur. Opened by the HUD's
 * reward moment (src/ui/keepsakeHud.ts) a few seconds after the kill, holding the area-cleared
 * banner until it closes. Each drop gets a chip with its effect; a first kill gets the choose-1-of-3
 * card (keys 1–3). The highlighted type is already in the Hoard; Enter / Space / Esc or the button lock it in (tracker.lock) and
 * resume play (or the waiting Perk draft).
 *
 * While the Run's Loadout has an open slot each drop also offers Tuck in (T tucks the first one):
 * the Keepsake goes into the slot for the rest of the Run (`run.tuckIn`), so a player with an empty
 * Loadout plays with it at once. Tucking in a first-kill offer locks the highlighted type.
 */
import { getAudio } from '../../audio';
import { getCharacter } from '../../data/characters';
import { bestRarity, bossNameFor, getRarity, keepsakeLabel } from '../../data/keepsakes';
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
      /** Drops of this reveal tucked into the Run's Loadout. */
      const tucked = new Set<KeepsakeDrop>();

      /** Open Loadout slots in the Run this reveal is for (0 without one). */
      const openSlots = (): number => {
        const run = game.run;
        return run && params && run.config.characterId === params.run.characterId ? run.openLoadoutSlots : 0;
      };

      /** Tucks a drop into an open Loadout slot for the rest of the Run (its offer, if any, is final). */
      const tuckIn = (d: KeepsakeDrop): boolean => {
        if (armed > 0 || !params || tucked.has(d) || openSlots() <= 0) return false;
        if (!game.run?.tuckIn(d.ref)) return false;
        getKeepsakeTracker()?.lock(d);
        tucked.add(d);
        render();
        return true;
      };

      const render = (): void => {
        const p = params;
        if (!p) return;
        const canTuck = openSlots() > 0;
        items.replaceChildren(
          ...p.drops.map((d) => {
            const index = p.run.drops.indexOf(d);
            const tuck = canTuck && !tucked.has(d) ? button('Tuck in', () => tuckIn(d), { size: 'sm', icon: '🧶', className: 'kr-tuck', ariaLabel: `Tuck in ${keepsakeLabel(d.ref)} for the rest of this Run` }) : null;
            if (d.offer && !d.locked && !p.run.settled && index >= 0) {
              const card = choiceCard(p.run, index, d, render, revealNote);
              if (tuck) card.append(h('div', { className: 'kr-tuck-row' }, tuck));
              return card;
            }
            const item = h('div', { className: 'kept-item' }, keepsakeChip(d.ref, { describe: true }));
            if (d.bonus) item.append(h('span', { className: 'kept-bonus', textContent: 'Hardcore' }));
            if (tucked.has(d)) item.append(h('span', { className: 'kr-tucked', textContent: 'Tucked in' }));
            else if (tuck) item.append(tuck);
            return item;
          }),
        );
        const name = getCharacter(p.run.characterId).name;
        const slots = openSlots();
        sub.textContent = tucked.size
          ? `Tucked into ${name}'s Loadout for the rest of this Run${slots > 0 ? ` · ${slots} slot open` : ''}`
          : slots > 0
            ? `Tangled into ${name}'s fur · ${slots === 1 ? 'a Loadout slot is' : `${slots} Loadout slots are`} open: tuck it in to use it now`
            : `Tangled into ${name}'s fur · put it in a Loadout on Character select`;
      };

      const close = (): void => {
        if (armed > 0 || !params) return;
        // The loot is final once the player rolls on: the highlighted type stays in the Hoard.
        const tracker = getKeepsakeTracker();
        for (const d of params.drops) tracker?.lock(d);
        params = null;
        tucked.clear();
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
          // A first kill's title names the offer's rarity, not a Hardcore bonus drop's.
          const rarity = getRarity(p.firstKill ? (p.drops[0]?.ref.rarity ?? 1) : bestRarity(p.drops.map((d) => d.ref)));
          el.style.setProperty('--rarity', rarity.color);
          label.textContent = `${bossNameFor(p.drops[0]?.bossId ?? '')} absorbed`;
          title.textContent = p.firstKill ? `New ${rarity.name} Keepsake` : p.drops.length > 1 ? `${p.drops.length} Keepsakes!` : `${rarity.name} Keepsake!`;
          story.hidden = !storyOn();
          story.firstElementChild!.textContent = p.caption;
          tucked.clear();
          render();
          getAudio()?.sfx.perk();
          // No autofocus: Space (Dash) held through the kill would "click" a focused button.
          (document.activeElement as HTMLElement | null)?.blur?.();
        },
        exit() {
          params = null;
          tucked.clear();
          // The area-cleared banner held while the reveal was up picks up where it was.
          game.hud.releaseBanner();
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
          if (isKey(e, 'KeyT')) {
            const next = params?.drops.find((d) => !tucked.has(d));
            if (next) tuckIn(next);
            return true;
          }
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
