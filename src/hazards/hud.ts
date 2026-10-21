/**
 * Boss HUD: a centre announcement (arrival, stunned, chipped) and a top-right status line
 * with the Bunny radius needed to absorb the Robo-Vac 9000. Uses existing HUD classes;
 * the UI layer may restyle `.hud-widget-boss-banner` / `.hud-widget-boss-status`.
 */
import type { Game } from '../game/game';
import { h } from '../ui/screens';
import { absorbRadiusFor } from './common';

export function installHazardHud(game: Game): void {
  const banner = h('div', { className: 'tier-banner' });
  let bannerTime = 0;
  const announce = (text: string, seconds: number) => {
    banner.textContent = text;
    bannerTime = seconds;
  };

  let bossId: number | null = null;
  game.events.on('runStarted', () => {
    bossId = null;
    bannerTime = 0;
  });
  game.events.on('bossSpawned', (e) => {
    bossId = e.hazardId;
    announce('The Robo-Vac 9000 has arrived!', 3.5);
  });
  game.events.on('bossStunned', () => announce('Stunned! Ram it!', 1.6));
  game.events.on('bossHit', (e) => announce(`Chipped! Absorb at ${e.absorbRadius.toFixed(0)} cm`, 2));
  game.events.on('hazardRemoved', (e) => {
    if (e.hazardId === bossId) bossId = null;
  });

  game.hud.addWidget({
    id: 'boss-banner',
    slot: 'center',
    el: banner,
    update(_g, dt) {
      bannerTime = Math.max(0, bannerTime - dt);
      banner.style.opacity = String(Math.min(1, bannerTime * 2));
    },
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
      status.hidden = !boss;
      if (!boss || !run) return;
      const need = absorbRadiusFor(boss.size, run.bunny.stats.get('absorbRatio'));
      const text = run.bunny.radius >= need ? 'Robo-Vac 9000 · absorb it now!' : `Robo-Vac 9000 · absorb at ${need.toFixed(1)} cm`;
      if (status.textContent !== text) status.textContent = text;
    },
  });
}
