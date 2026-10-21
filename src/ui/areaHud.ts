/**
 * Area HUD: the "house cleared" banner and a door compass while the front door is open, then a
 * fade-in from black and an arrival banner when the Bunny rolls out into the neighborhood.
 */
import { AREAS } from '../data/areas';
import { AREA_BOSSES } from '../data/hazards';
import { getTier } from '../data/tiers';
import type { Game } from '../game/game';
import { hazardRegistry } from '../hazards';
import { h } from './screens';
import './area.css';

export function installAreaHud(game: Game): void {
  const arrow = h('span', { className: 'door-compass-arrow', textContent: '➜' });
  const label = h('span', { className: 'door-compass-label', textContent: 'Front door' });
  const el = h('div', { className: 'hud-card door-compass' }, h('span', { className: 'door-compass-icon', textContent: '🚪' }), label, arrow);
  el.setAttribute('role', 'status');
  el.hidden = true;
  game.hud.addWidget({
    id: 'door-compass',
    slot: 'status',
    el,
    update(g) {
      const run = g.run;
      const exit = run?.area === 'house' ? run.house.exit : undefined;
      el.hidden = !exit?.open;
      if (!run || !exit?.open) return;
      const dx = (exit.rect.minX + exit.rect.maxX) / 2 - run.bunny.x;
      const dz = (exit.rect.minZ + exit.rect.maxZ) / 2 - run.bunny.z;
      // Fixed camera yaw: world +X is screen right, −Z is screen up. The glyph points right.
      const deg = (Math.atan2(dz, dx) * 180) / Math.PI;
      arrow.style.transform = `rotate(${deg.toFixed(1)}deg)`;
      const m = Math.hypot(dx, dz) / 100;
      const text = m < 1.5 ? 'Front door · roll out!' : `Front door · ${m.toFixed(0)} m`;
      if (label.textContent !== text) label.textContent = text;
    },
  });

  game.events.on('exitOpened', () => {
    game.hud.banner('House cleared!', { subtitle: 'The front door is open · roll outside', variant: 'good', duration: 3.6 });
    game.hud.flash('door-compass');
  });

  const fade = h('div', { className: 'area-fade' });
  game.uiLayer.append(fade);
  game.events.on('areaEntered', (e) => {
    fade.classList.remove('play');
    void fade.offsetWidth;
    fade.classList.add('play');
    const boss = AREA_BOSSES[e.area];
    const bossName = hazardRegistry.get(boss.id)?.name;
    const sub = bossName ? `Keep growing · the ${bossName} comes at ${getTier(boss.tier).name}` : 'Keep growing';
    setTimeout(() => game.hud.banner(AREAS[e.area].name, { subtitle: sub, variant: 'tier', duration: 3.4 }), 450);
  });
}
