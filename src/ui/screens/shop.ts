/**
 * Shop: spend Fluff on permanent Upgrades. Reachable from title, character select and results.
 * Params: `{ back?: screenId }` (default 'title'). Purchases save immediately and feed
 * game.nextRunConfig.modifiers via the meta store's onChange (src/meta/install.ts).
 */
import { UPGRADES } from '../../data/upgrades';
import type { Game } from '../../game/game';
import { getMeta } from '../../meta/meta';
import { h, registerScreen } from '../screens';
import '../roguelike.css';

export interface ShopParams {
  back?: string;
}

export function registerShopScreen(): void {
  registerScreen({
    id: 'shop',
    create(game: Game) {
      const meta = getMeta();
      const wallet = h('div', { className: 'rl-wallet' });
      const list = h('div', { className: 'shop-list' });
      const done = h('button', { className: 'btn primary', type: 'button' });
      let back = 'title';

      const render = () => {
        wallet.textContent = `☁ ${meta.fluff} Fluff`;
        list.replaceChildren(
          ...UPGRADES.map((u) => {
            const lvl = meta.level(u.id);
            const cost = meta.nextCost(u.id);
            const pips = h('span', { className: 'shop-pips' }, ...Array.from({ length: u.maxLevel }, (_, i) => h('i', { className: i < lvl ? 'on' : '' })));
            const buy = h('button', { className: 'btn shop-buy', type: 'button' });
            if (cost === null) {
              buy.textContent = 'Maxed';
              buy.disabled = true;
            } else {
              buy.textContent = `Buy · ${cost}`;
              buy.disabled = meta.fluff < cost;
              if (!buy.disabled) buy.classList.add('primary');
            }
            buy.onclick = () => {
              const r = meta.buy(u.id);
              if (r.ok) game.events.emit('upgradePurchased', { upgradeId: u.id, level: r.level, cost: r.cost, fluffLeft: meta.fluff });
              render();
            };
            return h(
              'div',
              { className: 'shop-item' },
              h('span', { className: 'shop-icon', textContent: u.icon }),
              h('div', { className: 'shop-text' }, h('strong', { textContent: u.name }), h('span', { textContent: u.description })),
              pips,
              buy,
            );
          }),
        );
      };

      done.onclick = () => game.go(back);

      return {
        el: h('div', { className: 'panel rl-panel shop' }, h('h2', { textContent: 'Shop' }), wallet, list, done),
        enter(params) {
          back = (params as ShopParams | undefined)?.back ?? 'title';
          done.textContent = back === 'characterSelect' ? 'Continue' : 'Back';
          render();
          done.focus();
        },
        onKey(e) {
          if (!e.repeat && e.code === 'Escape') {
            game.go(back);
            return true;
          }
          return false;
        },
      };
    },
  });
}
