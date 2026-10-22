/**
 * Ability HUD: a ring widget next to Dash for the Character's Ability, drawn from
 * abilityHud(run) (src/abilities). Decoy and Hunker show a cooldown ring (Hunker a hold timer
 * while planted, Decoy its time left while out); Discharge shows the Static meter as a charge ring.
 * The touch button (src/input/touch.ts) reuses `AbilityRing` with its own ring.
 */
import { abilityHud, type AbilityHudState } from '../abilities';
import type { Game } from '../game/game';
import type { Hud } from './hud';
import { h } from './screens';

const RING_SVG = (r: number) =>
  `<svg viewBox="0 0 64 64" aria-hidden="true"><circle class="track" cx="32" cy="32" r="${r}"/><circle class="fill" cx="32" cy="32" r="${r}" pathLength="100"/></svg>`;

/** Ring, icon and label inside an element; `sync` updates them from the Run's Ability. */
export class AbilityRing {
  private readonly ring: SVGCircleElement;
  private readonly icon: HTMLElement;
  private readonly label: HTMLElement;
  private shownFor = '';
  private wasReady = true;

  constructor(
    readonly el: HTMLElement,
    radius: number,
    iconClass: string,
    labelClass: string,
  ) {
    el.insertAdjacentHTML('afterbegin', RING_SVG(radius));
    this.ring = el.querySelector('.fill') as SVGCircleElement;
    this.icon = h('span', { className: iconClass });
    this.icon.setAttribute('aria-hidden', 'true');
    this.label = h('span', { className: labelClass });
    el.append(this.icon, this.label);
  }

  /** Returns true when the Ability just became ready (for a pop animation). */
  sync(state: AbilityHudState | null): boolean {
    this.el.hidden = !state;
    if (!state) return false;
    if (this.shownFor !== state.id) {
      this.shownFor = state.id;
      this.icon.textContent = state.icon;
      this.el.dataset.ability = state.id;
      this.el.setAttribute('aria-label', state.name);
      this.el.title = state.name;
    }
    this.ring.style.strokeDashoffset = String(100 - Math.max(0, Math.min(1, state.ring)) * 100);
    this.el.classList.toggle('ready', state.ready);
    this.el.classList.toggle('active', state.active);
    this.label.textContent = state.label ?? '';
    this.label.hidden = !state.label;
    const popped = state.ready && !this.wasReady;
    this.wasReady = state.ready;
    return popped;
  }
}

/** Toasts for Ability moments (clogs, crashes into a planted Tumble, short-outs). */
function abilityToasts(hud: Hud, game: Game): void {
  const ev = game.events;
  ev.on('hazardClogged', (e) => hud.toast(e.boss ? (e.seconds > 0 ? '🧶 Boss clogged! Ram it!' : '🧶 Pop!') : '🧶 Clogged!', { key: 'ability:clog', tone: 'good' }));
  ev.on('hazardHitPlanted', (e) => {
    if (e.boss && e.stunned) hud.toast('🪨 Boss crashed into you!', { key: 'ability:planted', tone: 'good' });
  });
  ev.on('hazardShorted', (e) => hud.toast(e.boss ? '⚡ Boss shorted out! Ram it!' : '⚡ Shorted out!', { key: 'ability:short', tone: 'good' }));
}

/** The desktop widget (hidden on touch layouts, where the touch button takes over), plus Ability toasts. */
export function abilityWidget(hud: Hud, game: Game): void {
  abilityToasts(hud, game);
  const el = h('div', { className: 'hud-ability' });
  const ring = new AbilityRing(el, 28, 'hud-ability-icon', 'hud-ability-label');
  el.append(h('span', { className: 'hud-ability-key', textContent: 'E' }));
  hud.addWidget({
    id: 'ability',
    slot: 'bottom-right',
    el,
    update(g: Game) {
      if (ring.sync(abilityHud(g.run))) hud.flash('ability', 'pop');
    },
  });
}
