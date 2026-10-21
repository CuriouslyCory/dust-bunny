/**
 * Perk draft modal (shown on tierUp, Run paused). Pick 1 of `perkChoices` with keys 1–4,
 * mouse or touch; R or the Reroll button rerolls if the Reroll Upgrade is owned.
 * Several Tier-ups at once queue several drafts.
 */
import type { Game } from '../../game/game';
import type { PerkDef } from '../../perks';
import { draftForRun, rerollDraft, rerollsLeft } from '../../perks/draft';
import { scrollArea } from '../components';
import { h, registerScreen } from '../screens';
import '../roguelike.css';

let pending = 0;

export function resetPerkDrafts(): void {
  pending = 0;
}

/** Called per tierUp: opens the draft (or queues another one if it is already open). */
export function queuePerkDraft(game: Game): void {
  if (!game.run || game.run.ended) return;
  pending++;
  if (game.screens.current?.id !== 'perkDraft') game.go('perkDraft');
}

/** Pointer input is ignored this long after the modal opens (avoids stray clicks while steering). */
const ARM_DELAY = 0.3;

export function registerPerkDraftScreen(): void {
  registerScreen({
    id: 'perkDraft',
    simulate: false,
    hud: true,
    create(game) {
      const title = h('h2', { textContent: 'Tier up! Choose a Perk' });
      const sub = h('p', { className: 'sub' });
      const cards = h('div', { className: 'perk-cards' });
      const reroll = h('button', { className: 'btn', type: 'button' });
      const footer = h('div', { className: 'rl-row' }, reroll);
      let offer: PerkDef[] = [];
      let armed = 0;

      const close = () => {
        pending = 0;
        if (game.run && !game.run.ended) game.go('playing');
      };

      const render = () => {
        const run = game.run;
        if (!run) return;
        cards.replaceChildren(
          ...offer.map((p, i) => {
            const stacks = run.perkStacks(p.id);
            const tag = p.unique ? 'Unique' : stacks > 0 ? `Owned ×${stacks}` : p.maxStacks ? `Stacks ×${p.maxStacks}` : 'Stackable';
            const card = h(
              'button',
              { className: 'perk-card', type: 'button' },
              h('span', { className: 'perk-key', textContent: String(i + 1) }),
              h('span', { className: 'perk-icon', textContent: p.icon ?? '✦' }),
              h('span', { className: 'perk-name', textContent: p.name }),
              h('span', { className: 'perk-desc', textContent: p.description }),
              h('span', { className: 'perk-tag', textContent: tag }),
            );
            card.onclick = () => {
              if (armed <= 0) choose(i);
            };
            return card;
          }),
        );
        const left = rerollsLeft(run);
        reroll.hidden = Math.round(run.bunny.stats.get('perkRerolls')) <= 0;
        reroll.disabled = left <= 0;
        reroll.textContent = `🎲 Reroll (${left}) · R`;
        // No autofocus: Space (Dash) held through the Tier-up would "click" a focused card.
        (document.activeElement as HTMLElement | null)?.blur?.();
      };

      const next = () => {
        const run = game.run;
        if (!run || run.ended || pending <= 0) return close();
        offer = draftForRun(run);
        if (offer.length === 0) return close(); // everything maxed
        render();
      };

      const choose = (i: number) => {
        const run = game.run;
        const p = offer[i];
        if (!run || !p) return;
        run.applyPerk(p.id);
        pending--;
        next();
      };

      const doReroll = () => {
        const run = game.run;
        if (!run) return;
        const fresh = rerollDraft(run, offer);
        if (fresh) {
          offer = fresh;
          render();
        }
      };
      reroll.onclick = () => {
        if (armed <= 0) doReroll();
      };

      return {
        el: h('div', { className: 'panel rl-panel perk-draft' }, title, sub, scrollArea('perk-body', cards), footer),
        enter() {
          armed = ARM_DELAY;
          next();
        },
        update(dt) {
          armed = Math.max(0, armed - dt);
          const text = pending > 1 ? `${pending} picks waiting` : 'Lasts for the rest of this Run';
          if (sub.textContent !== text) sub.textContent = text;
        },
        onKey(e) {
          if (e.repeat) return false;
          const n = /^Digit([1-9])$/.exec(e.code) ?? /^Numpad([1-9])$/.exec(e.code);
          if (n) {
            choose(Number(n[1]) - 1);
            return true;
          }
          if (e.code === 'KeyR') {
            doReroll();
            return true;
          }
          // Swallow Esc/P so they don't skip the draft.
          return e.code === 'Escape' || e.code === 'KeyP';
        },
      };
    },
  });
}
