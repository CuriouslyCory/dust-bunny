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
import { creditStatsOf } from '../../meta/savedRuns';
import { endsUniverse, getMeta } from '../../meta/meta';
import { clearedFluffBonus, fluffForRun, VICTORY_FLUFF_MULTIPLIER } from '../../meta/fluff';
import { AREAS } from '../../data/areas';
import { AreaProgress } from '../../game/areaProgress';
import { AREA_ORDER, type AreaId } from '../../world/types';
import { formatSize } from '../../data/units';
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

/** "Galaxy", "Solar System", …: an Area's name without its article (`AREAS[area].name`). */
function areaLabel(area: AreaId): string {
  return AREAS[area].name.replace(/^The /, '');
}

/**
 * Results copy per Area. `movedOn`: the note on its "Cleared" row when the Run ended in the next
 * Area (`anyLater`: in any later one). `diedHere`: the subtitle for a death in it. `soClose`: the
 * subtitle for a death after clearing it, still in it.
 */
const AREA_RESULTS: Readonly<Record<AreaId, { icon: string; movedOn?: { note: string; anyLater?: true }; diedHere?: string; soClose?: string }>> = {
  house: { icon: '🏠', movedOn: { note: 'made it outside', anyLater: true }, soClose: 'So close to the front door!' },
  neighborhood: { icon: '🌳', movedOn: { note: 'made it downtown' }, diedHere: 'Swept off the street. The house was yours, at least.', soClose: 'So close to the city!' },
  city: { icon: '🏙️', movedOn: { note: 'took the highway' }, diedHere: 'Hosed off the avenue. The whole neighborhood was yours, at least.', soClose: 'So close to the highway!' },
  region: { icon: '🗺️', movedOn: { note: 'rolled west' }, diedHere: 'Burnt down at the landfill. The whole city was yours, at least.', soClose: 'So close to the continent!' },
  continent: { icon: '🌍', movedOn: { note: 'reached orbit' }, diedHere: 'Frozen out on the ice. The whole region was yours, at least.', soClose: 'So close to orbit!' },
  globe: { icon: '🌐', movedOn: { note: 'escaped orbit' }, diedHere: 'Netted in orbit. The whole continent was yours, at least.', soClose: 'So close to the Solar System!' },
  solar_system: { icon: '☀️', movedOn: { note: 'crossed the heliopause' }, diedHere: 'Blown out of the ecliptic. The whole planet was yours, at least.', soClose: 'So close to the Galaxy!' },
  galaxy: { icon: '🌌', movedOn: { note: 'left the Milky Way' }, diedHere: 'Lost in the galactic dark. The whole solar system was yours, at least.', soClose: 'So close to the Universe!' },
  universe: { icon: '✨', diedHere: 'Spread out thin across the void. The whole galaxy was yours, at least.' },
};

/** "Victory ×1.5 · Hardcore ×1.6 · " etc.: the Fluff multipliers the Run earned (see meta/fluff.ts). */
function fluffBonusLabel(e: RunResult): string {
  const difficulty = getDifficulty(e.stats.difficulty);
  const diff = difficulty.fluff !== 1 ? `${difficulty.name} ×${difficulty.fluff} · ` : '';
  if (e.reason === 'victory') return `Victory ×${VICTORY_FLUFF_MULTIPLIER} · ${diff}`;
  const bonus = clearedFluffBonus(e.stats);
  if (bonus) return `${areaLabel(bonus.area)} cleared ×${bonus.multiplier} · ${diff}`;
  return diff;
}

export function registerResultsSection(section: ResultsSection): void {
  sections.set(section.id, section);
}

/**
 * Results subtitle for a Run that died: where it was swept up, or, once it had cleared that Area,
 * how close it came to the next one.
 */
function diedLine(s: RunResult['stats']): string | null {
  const progress = AreaProgress.fromFlags(s);
  for (let i = AREA_ORDER.length - 1; i > 0; i--) {
    const here = AREA_ORDER[i]!;
    const before = AREA_ORDER[i - 1]!;
    if (s.area === here) return AREA_RESULTS[here].diedHere ?? null;
    if (progress.isCleared(before)) return AREA_RESULTS[before].soClose ?? null;
  }
  return null;
}

/** A stats row ([icon, label, value]) for each Area the Run cleared, in `AREA_ORDER`. */
function clearedRows(s: RunResult['stats']): Array<[string, string, string]> {
  const progress = AreaProgress.fromFlags(s);
  const at = AREA_ORDER.indexOf(s.area);
  return AREA_ORDER.flatMap((area, i): Array<[string, string, string]> => {
    if (!progress.isCleared(area)) return [];
    const { icon, movedOn } = AREA_RESULTS[area];
    const shown = movedOn && (movedOn.anyLater ? at > i : at === i + 1);
    return [[icon, areaLabel(area), shown ? `Cleared · ${movedOn.note}` : 'Cleared']];
  });
}

const VARIANTS = {
  victory: { title: 'Victory!', sub: 'The Expansion collapsed. Everything that was ever dropped is yours.', badge: '👑' },
  died: { title: 'Swept up!', sub: 'The cleaning crew got you this time.', badge: '🧹' },
  quit: { title: 'Run over', sub: 'Every dust bunny needs a nap.', badge: '💤' },
} as const;

/**
 * Built-in sections: Fluff earned and the leaderboard panel. The Fluff section never waits: it
 * shows `+X` from `fluffForRun` at once. Signed in, a Run the Account knows is credited from the
 * server's answer (docs/adr/0003), so until then the section reads pending ("added when you're
 * back online" offline) and settles when `fluffAwarded` fires again for the Run.
 */
function registerDefaultSections(): void {
  registerResultsSection({
    id: 'fluff',
    slot: 'fluff',
    render(el, e, game) {
      // Pending: the Fluff the claim's stats come to (the same bounded subset the server stores).
      const fluff = fluffForRun(e.reason, creditStatsOf(e.stats));
      const meta = getMeta();
      const paint = (): void => {
        const credit = game.savedRuns.creditOf(e.runKey);
        const award = credit.state === 'credited' ? credit.award : null;
        const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
        const note =
          credit.state === 'refused'
            ? credit.why === 'elsewhere'
              ? 'Already added on another device.'
              : credit.why === 'rejected'
                ? 'Not added: something went wrong on this side.'
                : 'Not added: this Run carried on on another device.'
            : credit.state === 'pending'
              ? offline
                ? 'Added when you’re back online'
                : 'Adding to your Account…'
              : null;
        el.dataset.credit = credit.state;
        el.replaceChildren(
          h('span', { className: 'fluff-earned' }, h('span', { className: 'fluff-icon', textContent: '☁️' }), `+${award?.fluff ?? fluff} Fluff`),
          h('span', { className: 'fluff-detail', textContent: `${fluffBonusLabel(e)}total ${award?.total ?? meta.fluff}` }),
          ...(note ? [h('span', { className: 'fluff-pending', textContent: note })] : []),
          ...(award?.newBestRadius ? [h('span', { className: 'fluff-best', textContent: 'New best size!' })] : []),
        );
      };
      paint();
      return game.events.on('fluffAwarded', (a) => {
        if (a.runKey === e.runKey) paint();
      });
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
          card.dataset.variant = e.reason;
          badge.textContent = v.badge;
          title.textContent = v.title;
          sub.textContent = e.reason !== 'died' ? v.sub : (diedLine(s) ?? v.sub);
          const told = storyResultLine(e);
          story.hidden = !told;
          storyLead.textContent = told?.lead ?? '';
          storyText.textContent = told?.text ?? '';
          const tier = getTier(s.tierReached);
          const rows: Array<[string, string, string]> = [
            ['⏱', 'Time', fmtTime(s.timeSec)],
            ['📏', 'Max radius', formatSize(s.maxRadius, s.tierReached, AREAS[s.area]?.readout)],
            ['✦', 'Debris absorbed', s.debrisAbsorbed.toLocaleString()],
            ['⭐', 'Tier reached', `${s.tierReached} · ${tier.name}`],
            ...clearedRows(s),
          ];
          if (s.hazardsAbsorbed > 0) rows.push(['🤖', 'Hazards absorbed', String(s.hazardsAbsorbed)]);
          // The player's count once this Run is credited (it may still be pending with the Account).
          const universes = getMeta().universesAfter(e);
          if (universes > 0) rows.push(['🌀', 'Universes', endsUniverse(e) ? `${universes} · +1` : String(universes)]);
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
