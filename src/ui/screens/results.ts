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
 * those screens are registered. U opens Under the Couch when it is registered.
 */
import type { GameEvents } from '../../core/events';
import { CHARACTERS } from '../../data/characters';
import { getDifficulty } from '../../data/difficulty';
import { getTier } from '../../data/tiers';
import type { Game } from '../../game/game';
import { button, fmtTime, focusFirst, focusOnControl, handleMenuKeys, isKey, panel, scrollArea } from '../components';
import { getMeta } from '../../meta/meta';
import { CITY_CLEARED_FLUFF_MULTIPLIER, HOUSE_CLEARED_FLUFF_MULTIPLIER, NEIGHBORHOOD_CLEARED_FLUFF_MULTIPLIER, REGION_CLEARED_FLUFF_MULTIPLIER, VICTORY_FLUFF_MULTIPLIER } from '../../meta/fluff';
import { formatLength } from '../../data/units';
import { createLeaderboardPanel, type LeaderboardPanel } from '../leaderboard/panel';
import { h, registerScreen, screenRegistry } from '../screens';
import { captions, chapterOf, storyOn } from '../../story';
import { pickLine } from '../../story/narrator';

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

/**
 * Where the story stopped (docs/story.md): "Swept up in Chapter 3 · Title" after a death, the
 * last Area's cleared line after a win. Null when the narrator is off.
 */
export function storyResultLine(e: RunResult): { lead: string; text: string } | null {
  if (!storyOn()) return null;
  const s = e.stats;
  if (e.reason === 'victory') {
    const line = pickLine(s.seed, { kind: 'cleared', area: s.area });
    return line ? { lead: '', text: captions(line).join(' ') } : null;
  }
  const chapter = chapterOf(s.area);
  return { lead: `${e.reason === 'died' ? 'Swept up' : 'Stopped'} in Chapter ${chapter.number} · `, text: chapter.title };
}

/** "Victory ×1.5 · Hardcore ×1.6 · " etc.: the Fluff multipliers the Run earned (see meta/fluff.ts). */
function fluffBonusLabel(e: RunResult): string {
  const difficulty = getDifficulty(e.stats.difficulty);
  const diff = difficulty.fluff !== 1 ? `${difficulty.name} ×${difficulty.fluff} · ` : '';
  if (e.reason === 'victory') return `Victory ×${VICTORY_FLUFF_MULTIPLIER} · ${diff}`;
  if (e.stats.regionCleared) return `Region cleared ×${REGION_CLEARED_FLUFF_MULTIPLIER} · ${diff}`;
  if (e.stats.cityCleared) return `City cleared ×${CITY_CLEARED_FLUFF_MULTIPLIER} · ${diff}`;
  if (e.stats.neighborhoodCleared) return `Neighborhood cleared ×${NEIGHBORHOOD_CLEARED_FLUFF_MULTIPLIER} · ${diff}`;
  if (e.stats.houseCleared) return `House cleared ×${HOUSE_CLEARED_FLUFF_MULTIPLIER} · ${diff}`;
  return diff;
}

export function registerResultsSection(section: ResultsSection): void {
  sections.set(section.id, section);
}

const VARIANTS = {
  victory: { title: 'Victory!', sub: 'The Ice Sheet is part of you now. The whole continent is yours.', badge: '👑' },
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
        h('span', { className: 'fluff-detail', textContent: `${fluffBonusLabel(e)}total ${award.total}` }),
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
      const storyLead = h('span', { className: 'story-line-tier' });
      const storyText = h('span', { className: 'story-line-text' });
      const story = h('p', { className: 'story-line results-story' }, storyLead, storyText);
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
      // "Change " drops out on phones so the three small actions fit on one row.
      charSelect.querySelector('.btn-label')!.replaceChildren(h('span', { className: 'wide-only', textContent: 'Change ' }), 'Bunny');
      const actions = h('div', { className: 'results-actions' }, again, charSelect, shop, toTitle);

      // Header (badge, title, line) · scrolling body (stats + Fluff | leaderboard) · pinned actions.
      const head = h('div', { className: 'results-head' }, badge, h('div', { className: 'results-heading' }, title, sub, story));
      const main = h('div', { className: 'results-main' }, stats, fluffSlot, extraSlot, seed);
      const body = scrollArea('results-body', main, lbSlot);
      const card = panel({ className: 'results-panel' }, head, body, actions);
      card.setAttribute('aria-labelledby', 'results-title');
      const cleanups: Array<() => void> = [];
      let lastResult: RunResult | null = null;

      return {
        el: card,
        enter(params) {
          const e = params as RunResult | undefined;
          if (!e) return;
          lastResult = e;
          const v = VARIANTS[e.reason] ?? VARIANTS.quit;
          const s = e.stats;
          const outside = s.area !== 'house';
          const inCity = s.area === 'city';
          const inRegion = s.area === 'region';
          const inContinent = s.area === 'continent';
          card.dataset.variant = e.reason;
          badge.textContent = v.badge;
          title.textContent = v.title;
          sub.textContent =
            e.reason !== 'died'
              ? v.sub
              : inContinent
                ? 'Frozen out on the ice. The whole region was yours, at least.'
                : s.regionCleared
                  ? 'So close to the continent!'
                  : inRegion
                    ? 'Burnt down at the landfill. The whole city was yours, at least.'
                    : s.cityCleared
                      ? 'So close to the highway!'
                      : inCity
                        ? 'Hosed off the avenue. The whole neighborhood was yours, at least.'
                        : s.neighborhoodCleared
                          ? 'So close to the city!'
                          : outside
                            ? 'Swept off the street. The house was yours, at least.'
                            : s.houseCleared
                              ? 'So close to the front door!'
                              : v.sub;
          const told = storyResultLine(e);
          story.hidden = !told;
          storyLead.textContent = told?.lead ?? '';
          storyText.textContent = told?.text ?? '';
          const tier = getTier(s.tierReached);
          const rows: Array<[string, string, string]> = [
            ['⏱', 'Time', fmtTime(s.timeSec)],
            ['📏', 'Max radius', formatLength(s.maxRadius)],
            ['✦', 'Debris absorbed', s.debrisAbsorbed.toLocaleString()],
            ['⭐', 'Tier reached', `${s.tierReached} · ${tier.name}`],
          ];
          if (s.houseCleared) rows.push(['🏠', 'House', outside ? 'Cleared · made it outside' : 'Cleared']);
          if (s.neighborhoodCleared) rows.push(['🌳', 'Neighborhood', inCity ? 'Cleared · made it downtown' : 'Cleared']);
          if (s.cityCleared) rows.push(['🏙️', 'City', inRegion ? 'Cleared · took the highway' : 'Cleared']);
          if (s.regionCleared) rows.push(['🗺️', 'Region', inContinent ? 'Cleared · rolled west' : 'Cleared']);
          if (s.continentCleared) rows.push(['🌍', 'Continent', 'Cleared']);
          if (s.hazardsAbsorbed > 0) rows.push(['🤖', 'Hazards absorbed', String(s.hazardsAbsorbed)]);
          stats.replaceChildren(
            ...rows.map(([icon, k, val], i) => {
              const c = h('div', { className: 'stat' }, h('span', { className: 'stat-icon', textContent: icon }), h('span', { className: 'stat-value', textContent: val }), h('span', { className: 'stat-label', textContent: k }));
              c.style.setProperty('--i', String(i));
              return c;
            }),
          );
          const character = CHARACTERS.find((c) => c.id === s.characterId)?.name ?? s.characterId;
          seed.textContent = `${character} · ${getDifficulty(s.difficulty).name} · seed ${s.seed}`;

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
          body.scrollTop = 0;

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
          if (!e.repeat && isKey(e, 'KeyU') && screenRegistry.has('underTheCouch')) {
            game.disposeRun();
            game.go('underTheCouch', { back: 'characterSelect', characterId: (lastResult as RunResult | null)?.stats.characterId });
            return true;
          }
          return false;
        },
      };
    },
  });
}
