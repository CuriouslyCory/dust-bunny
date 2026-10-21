/**
 * HUD additions for the roguelike layer, built on the shared HUD (src/ui/hud.ts):
 * Bubble Wrap / Second Wind charge chips in the status row, and toasts for blocked hits,
 * dodges and revives. Active Pickup timers and Perk icons are rendered by the core HUD
 * widgets from PickupDef.icon / PerkDef.icon.
 */
import type { Game } from '../game/game';
import { perkRegistry } from '../perks';
import { pickupRegistry } from '../pickups';
import { h } from './screens';
import './roguelike.css';

function chargeChip(icon: string, title: string, color: string): { el: HTMLElement; count: HTMLElement } {
  const count = h('span', { className: 'hud-chip-stacks' });
  const el = h('div', { className: 'hud-chip hud-chip-charge', title }, h('span', { className: 'hud-chip-art', textContent: icon }), count);
  el.style.setProperty('--chip', color);
  el.setAttribute('aria-label', title);
  return { el, count };
}

export function installRoguelikeHud(game: Game): void {
  const shield = chargeChip(pickupRegistry.get('bubble_wrap')?.icon ?? '🫧', 'Bubble Wrap: each charge blocks one hit (max 3)', '#c8f0ff');
  const revive = chargeChip(perkRegistry.get('second_wind')?.icon ?? '💞', 'Second Wind: revive once', '#ffb3c4');
  const el = h('div', { className: 'hud-row hud-charges' }, shield.el, revive.el);
  game.hud.addWidget({
    id: 'charges',
    slot: 'status',
    el,
    update(g) {
      const b = g.run?.bunny;
      if (!b) return;
      shield.el.hidden = b.shield <= 0;
      shield.count.textContent = b.shield > 1 ? `×${b.shield}` : '';
      revive.el.hidden = b.revives <= 0;
      revive.count.textContent = b.revives > 1 ? `×${b.revives}` : '';
    },
  });

  game.events.on('shieldBlocked', () => game.hud.toast('🫧 Pop! Hit blocked', { tone: 'good' }));
  game.events.on('damageDodged', () => game.hud.toast('🧼 Dodged!', { tone: 'good' }));
  game.events.on('bunnyRevived', () => game.hud.banner('Second Wind!', { subtitle: 'Back on your fluff', variant: 'good', duration: 2 }));
}
