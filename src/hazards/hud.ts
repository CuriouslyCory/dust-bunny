/**
 * Boss HUD: stunned/chipped announcements (and Sagittarius A*'s star-cluster gulps, the
 * Expansion's Big Rip and collapse) via the shared HUD banner (the arrival banner is shown by the
 * UI layer on bossSpawned) and a top-right status line with the Bunny radius needed to absorb the
 * current area boss. The Expansion has no absorb size: instead a tug-of-war bar sits under the
 * Tier card (top centre), Gravity on the left and Expansion on the right, the gravity fill and its
 * marker at the boss's `gravity`, a pale ghost fill ahead of it for the gravity still flowing in
 * (`pending`; hud.css). The UI layer may restyle `.hud-widget-boss-status`
 * and `.hud-widget-boss-tug`.
 */
import type { Game } from '../game/game';
import { h } from '../ui/screens';
import { AREAS } from '../data/areas';
import { formatLength } from '../data/units';
import { absorbRadiusFor } from './common';
import { TheExpansion } from './theExpansion';
import './hud.css';

export function installHazardHud(game: Game): void {
  // Fight news is stale a few seconds late: while a narrator caption holds the banner, it is a toast.
  const announce = (title: string, subtitle: string, duration: number) => {
    // Keyed by the whole text, so a new Chipped! threshold doesn't merge into an older one.
    if (game.hud.bannerBusy) game.hud.toast(`${title} ${subtitle}`, { key: `boss:${title} ${subtitle}`, tone: 'hazard', short: title });
    else game.hud.banner(title, { subtitle, variant: 'boss', duration });
  };

  let bossId: number | null = null;
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
    // absorbRadius is in the Area's unit (10 km in the Continent): show it in real units.
    const run = game.run;
    announce('Chipped!', `Absorb at ${run ? formatLength(e.absorbRadius * run.unit, AREAS[run.area].readout) : `${e.absorbRadius.toFixed(0)} cm`}`, 2);
  });
  // The Expansion: the bar bottomed out, or it collapses.
  game.events.on('bossRip', () => announce('Big Rip!', 'Space tore. Absorb to pull it back!', 1.8));
  game.events.on('bossCollapse', () => announce('Collapse!', 'Everything falls into one place.', 2.2));
  game.events.on('hazardRemoved', (e) => {
    if (e.hazardId === bossId) bossId = null;
  });

  const status = h('div', { className: 'debris-count' });
  status.hidden = true;
  game.hud.addWidget({
    id: 'boss-status',
    slot: 'top-right',
    el: status,
    update(g) {
      const run = g.run;
      const boss = bossId !== null ? run?.hazards.hazards.find((hz) => hz.id === bossId && !hz.dead) : undefined;
      // The Expansion is never absorbed: its tug-of-war bar replaces this line.
      status.hidden = !boss || boss instanceof TheExpansion;
      if (!boss || !run) return;
      const need = absorbRadiusFor(boss.size, run.bunny.stats.get('absorbRatio'));
      const name = boss.def.name;
      const text = run.bunny.radius >= need ? `${name} · absorb it now!` : `${name} · absorb at ${formatLength(need * run.unit, AREAS[run.area].readout)}`;
      if (status.textContent !== text) status.textContent = text;
    },
  });

  installTugBar(game, () => bossId);
}

/** The Expansion's tug-of-war bar (top centre, under the Tier card). */
function installTugBar(game: Game, bossId: () => number | null): void {
  const ghost = h('div', { className: 'boss-tug-pending' });
  const fill = h('div', { className: 'boss-tug-fill' });
  const marker = h('div', { className: 'boss-tug-marker' });
  const bar = h('div', { className: 'boss-tug-bar' }, ghost, fill, marker);
  const el = h(
    'div',
    { className: 'boss-tug' },
    h('div', { className: 'boss-tug-title' }, 'The Expansion'),
    h('div', { className: 'boss-tug-row' }, h('span', { className: 'boss-tug-end boss-tug-gravity' }, 'Gravity'), bar, h('span', { className: 'boss-tug-end boss-tug-expansion' }, 'Expansion')),
  );
  el.setAttribute('role', 'meter');
  el.setAttribute('aria-label', 'Gravity against the Expansion');
  el.setAttribute('aria-valuemin', '0');
  el.setAttribute('aria-valuemax', '100');
  el.hidden = true;
  let shown = -1;
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
      const pct = Math.round(tug.gravity * 1000) / 10;
      ghost.style.width = `${Math.min(100, Math.round((tug.gravity + tug.pending) * 1000) / 10)}%`;
      if (pct === shown) return;
      // Falling: the expansion side pulses; low: the whole bar warns of the Big Rip.
      el.classList.toggle('losing', pct < shown);
      el.classList.toggle('danger', tug.gravity < 0.15 && tug.state === 'expanding');
      shown = pct;
      fill.style.width = `${pct}%`;
      marker.style.left = `${pct}%`;
      el.setAttribute('aria-valuenow', String(Math.round(pct)));
    },
  });
}
