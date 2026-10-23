/**
 * Boss HUD: stunned / hit announcements (and Sagittarius A*'s star-cluster gulps, the Expansion's
 * notches, Big Rip and collapse) via the shared HUD banner (the boss is introduced by the boss
 * intro card on bossSpawned), and the boss health card (top centre): the boss's name, one pip per
 * hit it can still take (AREA_BOSSES.hits) and the Bunny radius that absorbs it outright. The
 * Expansion has no absorb size: its tug-of-war bar takes the card's place, Gravity on the left and
 * Expansion on the right, the gravity fill and its marker at the boss's `gravity`, a pale ghost
 * fill ahead of it for the gravity still flowing in (`pending`), a tick at each notch and the
 * notch pips in its title (hud.css). The UI layer may restyle `.hud-widget-boss-health` and
 * `.hud-widget-boss-tug`.
 */
import type { Game } from '../game/game';
import { h } from '../ui/screens';
import { AREAS } from '../data/areas';
import { formatLength } from '../data/units';
import { absorbRadiusFor } from './common';
import type { Hazard } from './index';
import { RoboVac9000 } from './robovac';
import { expansionNotch, TheExpansion } from './theExpansion';
import './hud.css';

/** Hits taken and hits that break it, for a boss with health (every area boss). */
function bossHealth(boss: Hazard | undefined): { hits: number; maxHits: number } | null {
  return boss instanceof RoboVac9000 || boss instanceof TheExpansion ? { hits: boss.hits, maxHits: boss.maxHits } : null;
}

/** A row of `max` pips, the first `left` full (the rest knocked out). */
function renderPips(row: HTMLElement, left: number, max: number): void {
  if (row.children.length !== max) row.replaceChildren(...Array.from({ length: max }, () => h('span', { className: 'boss-pip' })));
  [...row.children].forEach((c, i) => c.classList.toggle('empty', i >= left));
  row.setAttribute('aria-label', `${left} of ${max} hits left`);
}

export function installHazardHud(game: Game): void {
  // Fight news is stale a few seconds late: while a narrator caption holds the banner, it is a toast.
  const announce = (title: string, subtitle: string, duration: number) => {
    // Keyed by the whole text, so a new hit count doesn't merge into an older one.
    if (game.hud.bannerBusy) game.hud.toast(`${title} ${subtitle}`, { key: `boss:${title} ${subtitle}`, tone: 'hazard', short: title });
    else game.hud.banner(title, { subtitle, variant: 'boss', duration });
  };

  let bossId: number | null = null;
  const currentBoss = (): Hazard | undefined => (bossId !== null ? game.run?.hazards.hazards.find((hz) => hz.id === bossId && !hz.dead) : undefined);
  game.events.on('runStarted', () => {
    bossId = null;
  });
  game.events.on('bossSpawned', (e) => {
    bossId = e.hazardId;
  });
  game.events.on('bossStunned', (e) => (e.cause === 'indigestion' ? announce('Indigestion!', 'It ate too fast. Ram it!', 1.8) : announce('Stunned!', 'Ram it!', 1.6)));
  // Sagittarius A* swallowed a star cluster: how full it is (two star clusters in a few seconds stun it).
  game.events.on('bossSwallowed', (e) => {
    if (e.fullness < e.threshold) announce('Gulp!', `Indigestion ${+e.fullness.toFixed(1)}/${e.threshold}`, 1.4);
  });
  game.events.on('bossHit', (e) => {
    game.hud.flash('boss-health', 'hit');
    game.hud.flash('boss-tug', 'hit');
    // The last hit breaks it: the cleared banner says so.
    const left = e.maxHits - e.hits;
    if (left <= 0) return;
    if (currentBoss() instanceof TheExpansion) announce(`Notch ${e.hits}/${e.maxHits}`, 'Gravity holds it. Keep absorbing!', 1.8);
    else announce(`Hit! ${e.hits}/${e.maxHits}`, left === 1 ? 'One more breaks it!' : `${left} more to break it`, 1.8);
  });
  // The Expansion: the bar bottomed out, or it collapses.
  game.events.on('bossRip', () => announce('Big Rip!', 'Space tore. Absorb to pull it back!', 1.8));
  game.events.on('bossCollapse', () => announce('Collapse!', 'Everything falls into one place.', 2.2));
  // The boss is gone: drop the fight news and stale captions still queued, so the cleared banner
  // (and the Keepsake reveal behind it) come at once.
  game.events.on('bossDefeated', () => game.hud.clearBanner());
  game.events.on('hazardRemoved', (e) => {
    if (e.hazardId === bossId) bossId = null;
  });

  const name = h('div', { className: 'boss-health-name' });
  const pips = h('div', { className: 'boss-pips', role: 'img' });
  const absorb = h('div', { className: 'boss-health-absorb' });
  const card = h('div', { className: 'boss-health' }, name, pips, absorb);
  card.hidden = true;
  let shownLeft = -1;
  game.hud.addWidget({
    id: 'boss-health',
    slot: 'top-center',
    el: card,
    update(g) {
      const run = g.run;
      const boss = currentBoss();
      const health = bossHealth(boss);
      // The Expansion is never absorbed: its tug-of-war bar replaces this card.
      card.hidden = !boss || !run || !health || boss instanceof TheExpansion;
      if (card.hidden || !boss || !run || !health) return;
      if (name.textContent !== boss.def.name) name.textContent = boss.def.name;
      const left = health.maxHits - health.hits;
      if (left !== shownLeft || pips.children.length !== health.maxHits) {
        renderPips(pips, left, health.maxHits);
        shownLeft = left;
      }
      const need = absorbRadiusFor(boss.size, run.bunny.stats.get('absorbRatio'));
      const can = run.bunny.radius >= need;
      card.classList.toggle('absorbable', can);
      const text = can ? 'Big enough: absorb it now!' : `or grow to ${formatLength(need * run.unit, AREAS[run.area].readout)} and absorb it`;
      if (absorb.textContent !== text) absorb.textContent = text;
    },
  });

  installTugBar(game, () => bossId);
}

/** The Expansion's tug-of-war bar (top centre, under the Tier card). */
function installTugBar(game: Game, bossId: () => number | null): void {
  const ghost = h('div', { className: 'boss-tug-pending' });
  const fill = h('div', { className: 'boss-tug-fill' });
  const marker = h('div', { className: 'boss-tug-marker' });
  const ticks = h('div', { className: 'boss-tug-ticks' });
  const bar = h('div', { className: 'boss-tug-bar' }, ghost, fill, ticks, marker);
  const pips = h('div', { className: 'boss-pips boss-tug-pips', role: 'img' });
  const el = h(
    'div',
    { className: 'boss-tug' },
    h('div', { className: 'boss-tug-title' }, h('span', {}, 'The Expansion'), pips),
    h('div', { className: 'boss-tug-row' }, h('span', { className: 'boss-tug-end boss-tug-gravity' }, 'Gravity'), bar, h('span', { className: 'boss-tug-end boss-tug-expansion' }, 'Expansion')),
  );
  el.setAttribute('role', 'meter');
  el.setAttribute('aria-label', 'Gravity against the Expansion');
  el.setAttribute('aria-valuemin', '0');
  el.setAttribute('aria-valuemax', '100');
  el.hidden = true;
  let shown = -1;
  let notches = -1;
  game.hud.addWidget({
    id: 'boss-tug',
    slot: 'top-center',
    el,
    update(g) {
      const id = bossId();
      const boss = id !== null ? g.run?.hazards.hazards.find((hz) => hz.id === id && !hz.dead) : undefined;
      const tug = boss instanceof TheExpansion ? boss : null;
      el.hidden = !tug;
      if (!tug) return;
      // A tick at each notch but the last (the bar's end), passed ones lit.
      if (ticks.children.length !== tug.maxHits - 1) {
        ticks.replaceChildren(
          ...Array.from({ length: tug.maxHits - 1 }, (_, i) => {
            const t = h('span', { className: 'boss-tug-tick' });
            t.style.left = `${expansionNotch(tug.cfg, i + 1, tug.maxHits) * 100}%`;
            return t;
          }),
        );
        notches = -1;
      }
      if (tug.hits !== notches) {
        notches = tug.hits;
        [...ticks.children].forEach((c, i) => c.classList.toggle('passed', i < tug.hits));
        renderPips(pips, tug.maxHits - tug.hits, tug.maxHits);
      }
      const pct = Math.round(tug.gravity * 1000) / 10;
      ghost.style.width = `${Math.min(100, Math.round((tug.gravity + tug.pending) * 1000) / 10)}%`;
      if (pct === shown) return;
      // Falling: the expansion side pulses; low: the whole bar warns of the Big Rip.
      el.classList.toggle('losing', pct < shown);
      // Close to the Big Rip's floor (it rises with each notch passed).
      el.classList.toggle('danger', tug.gravity < tug.ripFloor + 0.15 && tug.state === 'expanding');
      shown = pct;
      fill.style.width = `${pct}%`;
      marker.style.left = `${pct}%`;
      el.setAttribute('aria-valuenow', String(Math.round(pct)));
    },
  });
}
