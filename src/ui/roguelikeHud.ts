/**
 * HUD widgets for the roguelike layer: active Pickups (icon + timer bar), Bubble Wrap /
 * Second Wind charges, owned Perks (icon ×stacks), and a short toast on Pickup collect.
 */
import type { Game } from '../game/game';
import { perkRegistry } from '../perks';
import { pickupRegistry } from '../pickups';
import { h } from './screens';
import './roguelike.css';

function chip(icon: string, label: string, title: string): HTMLElement {
  return h('div', { className: 'rl-chip', title }, h('span', { className: 'rl-chip-icon', textContent: icon }), h('span', { className: 'rl-chip-label', textContent: label }));
}

export function installRoguelikeHud(game: Game): void {
  // Active Pickups + charges.
  const effects = h('div', { className: 'rl-effects' });
  let effectsKey = '';
  game.hud.addWidget({
    id: 'pickups',
    slot: 'top-right',
    el: effects,
    update(g) {
      const run = g.run;
      if (!run) return;
      const b = run.bunny;
      const items = run.pickups.active.map((e) => ({ e, secs: Math.ceil(e.remaining) }));
      const key = `${items.map((i) => `${i.e.def.id}:${i.secs}`).join(',')}|${b.shield}|${b.revives}`;
      if (key !== effectsKey) {
        effectsKey = key;
        const chips: HTMLElement[] = [];
        if (b.shield > 0) chips.push(chip(pickupRegistry.get('bubble_wrap')?.icon ?? '🫧', b.shield > 1 ? `×${b.shield}` : '', 'Bubble Wrap: blocks the next hit'));
        if (b.revives > 0) chips.push(chip(perkRegistry.get('second_wind')?.icon ?? '💞', b.revives > 1 ? `×${b.revives}` : '', 'Second Wind: revive once'));
        for (const { e, secs } of items) {
          const c = chip(e.def.icon ?? '✦', `${secs}s`, `${e.def.name}: ${e.def.description}`);
          c.classList.add('timed');
          c.style.setProperty('--c', e.def.color);
          chips.push(c);
        }
        effects.replaceChildren(...chips);
      }
      // Timer bar (cheap per-frame style update).
      let i = effects.children.length - items.length;
      for (const { e } of items) {
        (effects.children[i++] as HTMLElement | undefined)?.style.setProperty('--p', String(Math.max(0, e.remaining / e.duration)));
      }
    },
  });

  // Owned Perks.
  const perks = h('div', { className: 'rl-perks' });
  let perksKey = '';
  game.hud.addWidget({
    id: 'perks',
    slot: 'top-right',
    el: perks,
    update(g) {
      const run = g.run;
      if (!run) return;
      const owned = perkRegistry.all().filter((p) => run.perkStacks(p.id) > 0);
      const key = owned.map((p) => `${p.id}${run.perkStacks(p.id)}`).join(',');
      if (key === perksKey) return;
      perksKey = key;
      perks.replaceChildren(
        ...owned.map((p) => {
          const n = run.perkStacks(p.id);
          return h('span', { className: 'rl-perk', title: `${p.name}: ${p.description}` }, p.icon ?? '✦', n > 1 ? h('sub', { textContent: String(n) }) : '');
        }),
      );
    },
  });

  // Toast.
  const toast = h('div', { className: 'rl-toast' });
  let toastTime = 0;
  const show = (text: string) => {
    toast.textContent = text;
    toastTime = 1.6;
  };
  game.events.on('pickupCollected', (e) => {
    const d = pickupRegistry.get(e.defId);
    if (d) show(`${d.icon ?? ''} ${d.name}!`);
  });
  game.events.on('shieldBlocked', () => show('🫧 Pop! Hit blocked'));
  game.events.on('damageDodged', () => show('🧼 Dodged!'));
  game.events.on('bunnyRevived', () => show('💞 Second Wind!'));
  game.hud.addWidget({
    id: 'pickup-toast',
    slot: 'center',
    el: toast,
    update(_g, dt) {
      toastTime = Math.max(0, toastTime - dt);
      toast.style.opacity = String(Math.min(1, toastTime * 3));
    },
  });
}
