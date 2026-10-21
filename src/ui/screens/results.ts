/**
 * Results screen (death / victory / quit variants) with pluggable sections.
 *
 * Other modules add content without touching this file:
 *
 *   registerResultsSection({
 *     id: 'fluff', slot: 'fluff',
 *     render(el, result, game) { el.append(…); return () => cleanup(); },
 *   });
 *
 * Slots: 'fluff' (Fluff earned, under the stats), 'leaderboard' (name entry + table),
 * 'extra' (anything else, last). Buttons for 'characterSelect' and 'shop' appear when
 * those screens are registered.
 */
import type { GameEvents } from '../../core/events';
import { CHARACTERS } from '../../data/characters';
import { getTier } from '../../data/tiers';
import type { Game } from '../../game/game';
import { button, fmtTime, focusFirst, focusOnControl, handleMenuKeys, isKey, panel } from '../components';
import { getMeta } from '../../meta/meta';
import { createLeaderboardPanel, type LeaderboardPanel } from '../leaderboard/panel';
import { h, registerScreen, screenRegistry } from '../screens';

export type RunResult = GameEvents['runEnded'];
export type ResultsSlot = 'fluff' | 'leaderboard' | 'extra';

export interface ResultsSection {
  id: string;
  slot: ResultsSlot;
  /** Lower first within a slot. */
  order?: number;
  /** Fill `el` (an empty container). May return a cleanup called when the screen exits. */
  render(el: HTMLElement, result: RunResult, game: Game): void | (() => void);
}

const sections = new Map<string, ResultsSection>();

export function registerResultsSection(section: ResultsSection): void {
  sections.set(section.id, section);
}

const VARIANTS = {
  victory: { title: 'Victory!', sub: 'The Street Sweeper is part of you now. The whole neighborhood is yours.', badge: '👑' },
  died: { title: 'Swept up!', sub: 'The cleaning crew got you this time.', badge: '🧹' },
  quit: { title: 'Run over', sub: 'Every dust bunny needs a nap.', badge: '💤' },
} as const;

/** Built-in sections: Fluff earned (meta save) and the leaderboard panel. */
function registerDefaultSections(): void {
  registerResultsSection({
    id: 'fluff',
    slot: 'fluff',
    render(el, e) {
      const award = getMeta().awardRun(e); // idempotent per Run
      el.append(
        h('span', { className: 'fluff-earned' }, h('span', { className: 'fluff-icon', textContent: '☁️' }), `+${award.fluff} Fluff`),
        h('span', { className: 'fluff-detail', textContent: `${e.reason === 'victory' ? 'Victory ×1.5 · ' : e.stats.houseCleared ? 'House cleared ×1.25 · ' : ''}total ${award.total}` }),
        ...(award.newBestRadius ? [h('span', { className: 'fluff-best', textContent: 'New best size!' })] : []),
      );
    },
  });
  let board: LeaderboardPanel | null = null;
  registerResultsSection({
    id: 'leaderboard',
    slot: 'leaderboard',
    render(el, e) {
      board ??= createLeaderboardPanel({ submit: true });
      el.append(board.el);
      board.showRun(e);
    },
  });
}

export function registerResultsScreen(): void {
  registerDefaultSections();
  registerScreen({
    id: 'results',
    create(game) {
      const badge = h('div', { className: 'results-badge' });
      badge.setAttribute('aria-hidden', 'true');
      const title = h('h2', { className: 'panel-title results-title', id: 'results-title' });
      const sub = h('p', { className: 'panel-sub' });
      const stats = h('div', { className: 'results-stats' });
      const fluffSlot = h('div', { className: 'results-slot' });
      fluffSlot.dataset.slot = 'fluff';
      const lbSlot = h('div', { className: 'results-slot' });
      lbSlot.dataset.slot = 'leaderboard';
      const extraSlot = h('div', { className: 'results-slot' });
      extraSlot.dataset.slot = 'extra';
      const seed = h('p', { className: 'results-seed' });

      const again = button('Play again', () => game.startRun(), { variant: 'primary', size: 'lg', icon: '↻' });
      const charSelect = button('Change Bunny', () => {
        game.disposeRun();
        game.go('characterSelect');
      });
      const shop = button('Shop', () => {
        game.disposeRun();
        game.go('shop', { back: 'characterSelect' });
      }, { icon: '🛍' });
      const toTitle = button('Title', () => {
        game.disposeRun();
        game.go('title');
      }, { variant: 'ghost' });
      const actions = h('div', { className: 'results-actions' }, again, charSelect, shop, toTitle);

      const card = panel({ className: 'results-panel' }, badge, title, sub, stats, fluffSlot, lbSlot, extraSlot, actions, seed);
      card.setAttribute('aria-labelledby', 'results-title');
      const cleanups: Array<() => void> = [];

      return {
        el: card,
        enter(params) {
          const e = params as RunResult | undefined;
          if (!e) return;
          const v = VARIANTS[e.reason] ?? VARIANTS.quit;
          const s = e.stats;
          const outside = s.area === 'neighborhood';
          card.dataset.variant = e.reason;
          badge.textContent = v.badge;
          title.textContent = v.title;
          sub.textContent =
            e.reason === 'died' && outside ? 'Swept off the street. The house was yours, at least.' : e.reason === 'died' && s.houseCleared ? 'So close to the front door!' : v.sub;
          const tier = getTier(s.tierReached);
          const rows: Array<[string, string, string]> = [
            ['⏱', 'Time', fmtTime(s.timeSec)],
            ['📏', 'Max radius', `${s.maxRadius.toFixed(1)} cm`],
            ['✦', 'Debris absorbed', s.debrisAbsorbed.toLocaleString()],
            ['⭐', 'Tier reached', `${s.tierReached} · ${tier.name}`],
          ];
          if (s.houseCleared) rows.push(['🏠', 'House', outside ? 'Cleared · made it outside' : 'Cleared']);
          if (s.hazardsAbsorbed > 0) rows.push(['🤖', 'Hazards absorbed', String(s.hazardsAbsorbed)]);
          stats.replaceChildren(
            ...rows.map(([icon, k, val], i) => {
              const c = h('div', { className: 'stat' }, h('span', { className: 'stat-icon', textContent: icon }), h('span', { className: 'stat-value', textContent: val }), h('span', { className: 'stat-label', textContent: k }));
              c.style.setProperty('--i', String(i));
              return c;
            }),
          );
          const character = CHARACTERS.find((c) => c.id === s.characterId)?.name ?? s.characterId;
          seed.textContent = `${character} · seed ${s.seed}`;

          for (const slot of [fluffSlot, lbSlot, extraSlot]) slot.replaceChildren();
          const sorted = [...sections.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
          for (const sec of sorted) {
            const host = { fluff: fluffSlot, leaderboard: lbSlot, extra: extraSlot }[sec.slot];
            const el = h('div', { className: `results-section results-section-${sec.id}` });
            host.append(el);
            try {
              const c = sec.render(el, e, game);
              if (c) cleanups.push(c);
            } catch (err) {
              console.error(`[results] section "${sec.id}" failed`, err);
            }
          }
          for (const slot of [fluffSlot, lbSlot, extraSlot]) slot.hidden = slot.childElementCount === 0;

          charSelect.hidden = !screenRegistry.has('characterSelect');
          shop.hidden = !screenRegistry.has('shop');
          focusFirst(card, again);
        },
        exit() {
          for (const c of cleanups.splice(0)) c();
        },
        onKey(e) {
          if (handleMenuKeys(e, card)) return true;
          if (isKey(e, 'Enter') && !focusOnControl()) {
            game.startRun();
            return true;
          }
          return false;
        },
      };
    },
  });
}
