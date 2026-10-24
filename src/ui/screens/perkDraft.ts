/**
 * Perk draft modal (shown on tierUp, Run paused). Renders the Run's draft workflow
 * (run.perkDraft, src/perks/draft.ts) and turns input into choose / reroll: pick 1 of
 * `perkChoices` with keys 1–4, mouse or touch; R or the Reroll button rerolls if the Reroll
 * Upgrade is owned. Several Tier-ups queue several drafts; the modal closes once none are left.
 */
import { getCharacter } from '../../data/characters';
import { getTier } from '../../data/tiers';
import type { Game } from '../../game/game';
import { captions, narrate } from '../../story';
import { scrollArea } from '../components';
import { h, registerScreen } from '../screens';
import '../roguelike.css';

/** Called per tierUp: opens the draft modal if the Run has a pick waiting and it isn't open yet. */
export function openPerkDraft(game: Game): void {
  if (!game.run?.perkDraft.active) return;
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
      /** The narrator's Tier beat (docs/story.md): "Tier 4 · Dust Devil — line". */
      const tierName = h('span', { className: 'story-line-tier' });
      const tierText = h('span', { className: 'story-line-text' });
      const story = h('p', { className: 'story-line' }, tierName, tierText);
      const cards = h('div', { className: 'perk-cards' });
      const reroll = h('button', { className: 'btn', type: 'button' });
      const footer = h('div', { className: 'rl-row' }, reroll);
      /** Serial of the offer on screen (0: none rendered yet). */
      let shown = 0;
      let armed = 0;

      /** Shows the current offer, or resumes play once the workflow is complete. */
      const sync = () => {
        const run = game.run;
        const draft = run?.perkDraft;
        if (!run || !draft?.active) {
          if (run && !run.ended) game.go('playing');
          return;
        }
        const { serial, perks } = draft.offer;
        if (serial === shown) return;
        shown = serial;
        // One draft per Tier crossed: with several waiting, this one is for the earliest of them.
        const tier = Math.max(2, run.tier - draft.pending + 1);
        const line = narrate(run, { kind: 'tier', tier });
        story.hidden = !line;
        if (line) {
          tierName.textContent = `Tier ${tier} · ${getTier(tier).name} — `;
          tierText.textContent = captions(line).join(' ');
        }
        cards.replaceChildren(
          ...perks.map((p, i) => {
            const stacks = run.perkStacks(p.id);
            const tag = p.unique ? 'Unique' : stacks > 0 ? `Owned ×${stacks}` : p.maxStacks ? `Stacks ×${p.maxStacks}` : 'Stackable';
            // A Character Perk names its Character and wears its fur colour.
            const owner = p.character ? getCharacter(p.character) : null;
            const card = h(
              'button',
              { className: owner ? 'perk-card perk-card-character' : 'perk-card', type: 'button' },
              ...(owner ? [h('span', { className: 'perk-owner', textContent: `${owner.name} only` })] : []),
              h('span', { className: 'perk-key', textContent: String(i + 1) }),
              h('span', { className: 'perk-icon', textContent: p.icon ?? '✦' }),
              h('span', { className: 'perk-name', textContent: p.name }),
              h('span', { className: 'perk-desc', textContent: p.description }),
              h('span', { className: 'perk-tag', textContent: tag }),
            );
            if (owner) card.style.setProperty('--perk-owner', owner.color);
            card.onclick = () => {
              // The serial and Run check make a stale card (older offer, replaced Run) a no-op.
              if (armed <= 0 && game.run?.perkDraft === draft && draft.choose(p.id, serial)) sync();
            };
            return card;
          }),
        );
        reroll.hidden = draft.rerolls <= 0;
        reroll.disabled = draft.rerollsLeft <= 0;
        reroll.textContent = `🎲 Reroll (${draft.rerollsLeft}) · R`;
        // No autofocus: Space (Dash) held through the Tier-up would "click" a focused card.
        (document.activeElement as HTMLElement | null)?.blur?.();
      };

      const chooseAt = (i: number) => {
        const draft = game.run?.perkDraft;
        const p = draft?.offer.perks[i];
        if (draft && p && draft.choose(p.id, draft.offer.serial)) sync();
      };

      const doReroll = () => {
        if (game.run?.perkDraft.reroll()) sync();
      };
      reroll.onclick = () => {
        if (armed <= 0) doReroll();
      };

      return {
        el: h('div', { className: 'panel rl-panel perk-draft' }, title, story, sub, scrollArea('perk-body', cards), footer),
        enter() {
          armed = ARM_DELAY;
          shown = 0;
          sync();
        },
        update(dt) {
          armed = Math.max(0, armed - dt);
          const pending = game.run?.perkDraft.pending ?? 0;
          const text = pending > 1 ? `${pending} picks waiting` : 'Lasts for the rest of this Run';
          if (sub.textContent !== text) sub.textContent = text;
        },
        onKey(e) {
          if (e.repeat) return false;
          const n = /^Digit([1-9])$/.exec(e.code) ?? /^Numpad([1-9])$/.exec(e.code);
          if (n) {
            chooseAt(Number(n[1]) - 1);
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
