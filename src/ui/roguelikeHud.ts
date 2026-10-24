/**
 * HUD additions for the roguelike layer, built on the shared HUD (src/ui/hud.ts):
 * Bubble Wrap / Second Wind / Matted Coat charge chips in the status row (the coat dims and
 * counts down while recharging), and toasts for blocked hits,
 * dodges and revives. Active Pickup timers and Perk icons are rendered by the core HUD
 * widgets from PickupDef.icon / PerkDef.icon.
 */
import type { Game } from '../game/game';
import { perkRegistry } from '../perks';
import { getTumblePerks } from '../perks/tumble';
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
  const coat = chargeChip(perkRegistry.get('matted_coat')?.icon ?? '🧥', 'Matted Coat: blocks one hit, recharges while unhurt', '#e8c9a0');
  const el = h('div', { className: 'hud-row hud-charges' }, shield.el, revive.el, coat.el);
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
      const fur = getTumblePerks(g.run)?.coat ?? null;
      coat.el.hidden = !fur;
      coat.el.style.opacity = fur && !fur.charged ? '0.45' : '';
      coat.count.textContent = fur && !fur.charged ? `${Math.ceil(fur.rechargeLeft)}s` : '';
    },
  });

  game.events.on('shieldBlocked', () => game.hud.toast('🫧 Pop! Hit blocked', { tone: 'good' }));
  game.events.on('furCoatBlocked', () => game.hud.toast('🧥 Matted Coat took the hit', { tone: 'good' }));
  game.events.on('damageDodged', () => game.hud.toast('🧼 Dodged!', { tone: 'good' }));
  game.events.on('bunnyRevived', () => game.hud.banner('Second Wind!', { subtitle: 'Back on your fluff', variant: 'good', duration: 2 }));
}
