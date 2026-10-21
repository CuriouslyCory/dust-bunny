/**
 * Boss HUD: stunned/chipped announcements via the shared HUD banner (the arrival banner is
 * shown by the UI layer on bossSpawned) and a top-right status line with the Bunny radius
 * needed to absorb the current area boss. The UI layer may restyle `.hud-widget-boss-status`.
 */
import type { Game } from '../game/game';
import { h } from '../ui/screens';
import { absorbRadiusFor } from './common';

export function installHazardHud(game: Game): void {
  const announce = (title: string, subtitle: string, duration: number) =>
    game.hud.banner(title, { subtitle, variant: 'boss', duration });

  let bossId: number | null = null;
  game.events.on('runStarted', () => {
    bossId = null;
  });
  game.events.on('bossSpawned', (e) => {
    bossId = e.hazardId;
  });
  game.events.on('bossStunned', () => announce('Stunned!', 'Ram it!', 1.6));
  game.events.on('bossHit', (e) => announce('Chipped!', `Absorb at ${e.absorbRadius.toFixed(0)} cm`, 2));
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
      status.hidden = !boss;
      if (!boss || !run) return;
      const need = absorbRadiusFor(boss.size, run.bunny.stats.get('absorbRatio'));
      const name = boss.def.name;
      const text = run.bunny.radius >= need ? `${name} · absorb it now!` : `${name} · absorb at ${need.toFixed(1)} cm`;
      if (status.textContent !== text) status.textContent = text;
    },
  });
}
