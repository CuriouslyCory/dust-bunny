/**
 * Area HUD: the "area cleared" banner and an exit compass while the area's exit is open (the
 * house's front door, the neighborhood's road to the city, the city's highway on-ramp to the
 * region, the region's motorway west to the continent, the continent's launch corridor, the
 * globe's escape trajectory, the solar system's heliopause), with a skip button that moves on
 * without rolling to the exit (Enter on a keyboard), then a fade-in and an arrival banner when
 * the Bunny arrives in the next area. With the narrator on (src/story/), the cleared banner carries
 * the Area's cleared line and arriving plays the chapter card before the arrival banner.
 */
import { AREAS } from '../data/areas';
import { AREA_BOSSES } from '../data/hazards';
import { getTier } from '../data/tiers';
import { formatLength } from '../data/units';
import { wrapDeltaX } from '../world/wrap';
import type { Game } from '../game/game';
import { hazardRegistry } from '../hazards';
import { captionDuration, narrate, storyCaption } from '../story';
import { showChapterCard } from '../story/install';
import type { AreaId } from '../world/types';
import { button } from './components';
import { h } from './screens';
import './area.css';

/** Per area with an exit: compass icon / label and the banner when it opens. */
const EXITS: Partial<Record<AreaId, { icon: string; label: string; go: string; skip: string; cleared: string; sub: string }>> = {
  house: { icon: '🚪', label: 'Front door', go: 'roll out!', skip: 'Go outside', cleared: 'House cleared!', sub: 'The front door is open · roll outside' },
  neighborhood: { icon: '🏙️', label: 'Road to the city', go: 'roll on!', skip: 'Go to the city', cleared: 'Neighborhood cleared!', sub: 'The road barrier is up · head for the city' },
  city: { icon: '🛣️', label: 'Highway on-ramp', go: 'roll on!', skip: 'Take the highway', cleared: 'City cleared!', sub: 'The on-ramp is open · take the highway out' },
  region: { icon: '🌍', label: 'West to the continent', go: 'roll on!', skip: 'Head west', cleared: 'Region cleared!', sub: 'The motorway west is open · roll out to the continent' },
  continent: { icon: '🚀', label: 'Up to orbit', go: 'lift off!', skip: 'Leave the atmosphere', cleared: 'Continent cleared!', sub: 'The launch corridor is open · head north and up' },
  globe: { icon: '☀️', label: 'Escape orbit', go: 'break free!', skip: 'Leave Earth behind', cleared: 'Globe cleared!', sub: 'The escape trajectory is open · head over the North Pole' },
  solar_system: { icon: '🌌', label: 'Heliopause', go: 'cross it!', skip: 'Follow Voyager out', cleared: 'The Sun is yours', sub: 'The heliopause is open · head north, the way Voyager went' },
  // The Galaxy is the last built Area: Sagittarius A* wins the Run (an exit to the Universe comes with Act 9).
};

/** "37 m", "1.2 km", "240 km", "0.31 Earths", "0.012 AU": a compass distance (real cm) without the readout's decimals. */
function formatDistance(cm: number): string {
  if (cm < 1e5) return `${(cm / 100).toFixed(0)} m`;
  return formatLength(cm, 'km');
}

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
      // On a map that wraps east–west, the way to the exit's nearest copy.
      const dx = wrapDeltaX(run.house, run.bunny.x, (exit.rect.minX + exit.rect.maxX) / 2);
      const dz = (exit.rect.minZ + exit.rect.maxZ) / 2 - run.bunny.z;
      // Fixed camera yaw: world +X is screen right, −Z is screen up. The glyph points right.
      const deg = (Math.atan2(dz, dx) * 180) / Math.PI;
      arrow.style.transform = `rotate(${deg.toFixed(1)}deg)`;
      // Real distance in m, then km; "roll on" within 1.5 m (1.5 world units per metre of unit: 15 m in the Region).
      const cm = Math.max(0, Math.hypot(dx, dz) - run.bunny.radius) * run.unit;
      const text = cm < 150 * Math.max(1, run.unit / 100) ? `${info.label} · ${info.go}` : `${info.label} · ${formatDistance(cm)}`;
      if (label.textContent !== text) label.textContent = text;
    },
  });

  game.events.on('exitOpened', (e) => {
    const info = EXITS[e.area];
    if (!info) return;
    const line = narrate(game.run, { kind: 'cleared', area: e.area });
    if (line) {
      // The narrator's line replaces the directions; the compass still shows the way.
      const caption = storyCaption(line);
      game.hud.banner(info.cleared, { variant: 'good', duration: Math.max(3.6, captionDuration(caption)), caption });
    } else {
      game.hud.banner(info.cleared, { subtitle: info.sub, variant: 'good', duration: 3.6 });
    }
    game.hud.flash('door-compass');
  });

  const fade = h('div', { className: 'area-fade' });
  game.uiLayer.append(fade);
  const playFade = (dark: boolean) => {
    fade.classList.remove('play', 'dark');
    void fade.offsetWidth;
    fade.classList.add('play');
    fade.classList.toggle('dark', dark);
  };
  game.events.on('areaEntered', (e) => {
    const boss = AREA_BOSSES[e.area];
    const bossName = hazardRegistry.get(boss.id)?.name;
    const sub = bossName ? `Keep growing · the ${bossName} comes at ${getTier(boss.tier).name}` : 'Keep growing';
    const arrive = (delay: number) => setTimeout(() => game.hud.banner(AREAS[e.area].name, { subtitle: sub, variant: 'tier', duration: 3.4 }), delay);
    // Chapter card first (the Run waits behind it), then the dark card lifts off the new Area.
    const card = showChapterCard(game, e.area, () => {
      playFade(true);
      arrive(250);
    });
    if (card) return;
    playFade(false);
    arrive(450);
  });
}
