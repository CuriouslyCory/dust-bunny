/**
 * Results "Kept" section: the Keepsakes this Run left in the played Character's fur and a button to
 * Under the Couch. A first kill is chosen in the in-Run Keepsake reveal; only a drop whose reveal
 * never showed (the Run ended first) gets the choose-1-of-3 card here. The first offered type is
 * already in the Hoard; picking another swaps it. Leaving without choosing keeps the highlighted one.
 */
import { getCharacter } from '../../data/characters';
import { bossNameFor, describeKeepsake, getRarity, getKeepsakeType } from '../../data/keepsakes';
import type { Game } from '../../game/game';
import { getKeepsakeTracker, type KeepsakeDrop, type RunKeepsakes } from '../../meta/keepsakes';
import { button } from '../components';
import { keepsakeChip } from '../keepsakeUi';
import { h, screenRegistry } from '../screens';
import { registerResultsSection } from './results';

/** Leaves results for Under the Couch (the Run is over; back goes to Character select). */
export function openUnderTheCouch(game: Game, characterId?: string): void {
  if (!screenRegistry.has('underTheCouch')) return;
  game.disposeRun();
  game.go('underTheCouch', { back: 'characterSelect', characterId });
}

/** The line under the options: whether a pick was made and until when it can change. */
export type ChoiceNote = (chosen: boolean) => string;

const resultsNote: ChoiceNote = (chosen) => (chosen ? 'Kept. You can still change it until you leave.' : 'Leaving keeps the highlighted one.');

/**
 * A first-kill choose-1-of-3 card for `run.drops[index]`: clicking an option swaps the credited
 * Keepsake (tracker.choose) and calls `rerender`. Also shown by the in-Run reveal.
 */
export function choiceCard(run: RunKeepsakes, index: number, drop: KeepsakeDrop, rerender: () => void, note: ChoiceNote = resultsNote): HTMLElement {
  const tracker = getKeepsakeTracker();
  const rarity = getRarity(drop.ref.rarity);
  const options = drop.offer!.map((type) => {
    const t = getKeepsakeType(type)!;
    const ref = { type, rarity: drop.ref.rarity };
    const b = h(
      'button',
      { className: 'kept-option', type: 'button' },
      h('span', { className: 'kept-option-icon', textContent: t.icon }),
      h('span', { className: 'kept-option-name', textContent: t.name }),
      h('span', { className: 'kept-option-desc', textContent: describeKeepsake(ref) }),
    );
    const on = drop.ref.type === type;
    b.classList.toggle('selected', on);
    b.setAttribute('aria-pressed', String(on));
    b.onclick = () => {
      if (tracker?.choose(run, index, type)) rerender();
    };
    return b;
  });
  const card = h(
    'div',
    { className: 'kept-choice' },
    h('p', { className: 'kept-choice-head', textContent: `First ${bossNameFor(drop.bossId)} for ${getCharacter(run.characterId).name}: choose what it left (${rarity.name}).` }),
    h('div', { className: 'kept-options' }, ...options),
    h('p', { className: 'kept-choice-note', textContent: note(!!drop.chosen) }),
  );
  card.style.setProperty('--rarity', rarity.color);
  return card;
}

export function registerKeptSection(): void {
  registerResultsSection({
    id: 'kept',
    slot: 'fluff',
    order: 10,
    render(el, result, game) {
      const tracker = getKeepsakeTracker();
      const run = tracker?.forResult(result) ?? null;
      const render = () => {
        // Unranked: only worth a note when a boss was absorbed.
        if (!run || (!run.drops.length && (run.ranked || !result.stats.houseCleared))) {
          el.hidden = true;
          return;
        }
        el.hidden = false;
        const name = getCharacter(run.characterId).name;
        if (!run.ranked) {
          el.replaceChildren(h('p', { className: 'kept-none', textContent: 'No Keepsakes: Runs with debug tools or started past the house drop none.' }));
          return;
        }
        const items = run.drops.map((d, i) =>
          d.offer && !d.locked && !run.settled ? choiceCard(run, i, d, render) : h('div', { className: 'kept-item' }, keepsakeChip(d.ref, { describe: true }), ...(d.bonus ? [h('span', { className: 'kept-bonus', textContent: 'Hardcore' })] : [])),
        );
        el.replaceChildren(
          h('h3', { className: 'kept-head', textContent: `Kept · tangled into ${name}'s fur` }),
          ...items,
          button('Under the Couch', () => openUnderTheCouch(game, run.characterId), { size: 'sm', icon: '🛋' }),
        );
      };
      render();
      return () => {
        if (run) tracker?.settle(run);
      };
    },
  });
}
