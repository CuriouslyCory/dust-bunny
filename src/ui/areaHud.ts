/**
 * Area HUD: the "area cleared" banner and an exit compass while the area's exit is open (the
 * house's front door, the neighborhood's road to the city), with a skip button that moves on
 * without rolling to the exit (Enter on a keyboard), then a fade-in and an arrival banner when
 * the Bunny arrives in the next area.
 */
import { AREAS } from '../data/areas';
import { AREA_BOSSES } from '../data/hazards';
import { getTier } from '../data/tiers';
import type { Game } from '../game/game';
import { hazardRegistry } from '../hazards';
import type { AreaId } from '../world/types';
import { button } from './components';
import { h } from './screens';
import './area.css';

/** Per area with an exit: compass icon / label and the banner when it opens. */
const EXITS: Partial<Record<AreaId, { icon: string; label: string; go: string; skip: string; cleared: string; sub: string }>> = {
  house: { icon: '🚪', label: 'Front door', go: 'roll out!', skip: 'Go outside', cleared: 'House cleared!', sub: 'The front door is open · roll outside' },
  neighborhood: { icon: '🏙️', label: 'Road to the city', go: 'roll on!', skip: 'Go to the city', cleared: 'Neighborhood cleared!', sub: 'The road barrier is up · head for the city' },
};

/** Moves the Run on to the next area from the skip button / Enter, only while actually playing. */
export function skipToNextArea(game: Game): boolean {
  return game.screens.current?.id === 'playing' && !!game.run?.leaveArea();
}

export function installAreaHud(game: Game): void {
  const arrow = h('span', { className: 'door-compass-arrow', textContent: '➜' });
  const label = h('span', { className: 'door-compass-label', textContent: 'Front door' });
  const icon = h('span', { className: 'door-compass-icon', textContent: '🚪' });
  const compass = h('span', { className: 'door-compass-info' }, icon, label, arrow);
  compass.setAttribute('role', 'status');
  const skip = button(
    'Go outside',
    () => {
      skip.blur(); // Space dashes; it must not press this again
      skipToNextArea(game);
    },
    { size: 'sm', variant: 'primary', icon: '⏭', className: 'door-skip' },
  );
  skip.title = 'Skip ahead to the next area (Enter)';
  const skipLabel = skip.querySelector('.btn-label')!;
  const el = h('div', { className: 'hud-card door-compass' }, compass, skip);
  el.hidden = true;
  game.hud.addWidget({
    id: 'door-compass',
    slot: 'status',
    el,
    update(g) {
      const run = g.run;
      const exit = run?.house.exit;
      const info = run && EXITS[run.area];
      el.hidden = !exit?.open || !info;
      if (!run || !exit?.open || !info) return;
      if (icon.textContent !== info.icon) icon.textContent = info.icon;
      if (skipLabel.textContent !== info.skip) skipLabel.textContent = info.skip;
      const dx = (exit.rect.minX + exit.rect.maxX) / 2 - run.bunny.x;
      const dz = (exit.rect.minZ + exit.rect.maxZ) / 2 - run.bunny.z;
      // Fixed camera yaw: world +X is screen right, −Z is screen up. The glyph points right.
      const deg = (Math.atan2(dz, dx) * 180) / Math.PI;
      arrow.style.transform = `rotate(${deg.toFixed(1)}deg)`;
      const m = Math.max(0, Math.hypot(dx, dz) - run.bunny.radius) / 100;
      const text = m < 1.5 ? `${info.label} · ${info.go}` : `${info.label} · ${m.toFixed(0)} m`;
      if (label.textContent !== text) label.textContent = text;
    },
  });

  game.events.on('exitOpened', (e) => {
    const info = EXITS[e.area];
    if (!info) return;
    game.hud.banner(info.cleared, { subtitle: info.sub, variant: 'good', duration: 3.6 });
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
