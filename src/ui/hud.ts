/**
 * Minimal HUD built from widgets. Add more with game.hud.addWidget({ id, el, update }).
 * Widgets read state each frame from the Game (and may subscribe to game.events).
 */
import { getTier, MAX_TIER, tierProgress } from '../data/tiers';
import type { Game } from '../game/game';
import { h } from './screens';

export interface HudWidget {
  id: string;
  el: HTMLElement;
  /** Which HUD corner the widget sits in. */
  slot?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';
  update?(game: Game, frameDt: number): void;
}

export class Hud {
  readonly el = h('div', { className: 'hud' });
  private slots = new Map<string, HTMLElement>();
  private widgets: HudWidget[] = [];

  constructor(private readonly game: Game) {
    for (const s of ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center']) {
      const slot = h('div', { className: `hud-slot hud-${s}` });
      this.slots.set(s, slot);
      this.el.append(slot);
    }
  }

  addWidget(w: HudWidget): void {
    this.widgets.push(w);
    w.el.classList.add('hud-widget', `hud-widget-${w.id}`);
    this.slots.get(w.slot ?? 'top-left')!.append(w.el);
  }

  removeWidget(id: string): void {
    const i = this.widgets.findIndex((w) => w.id === id);
    if (i >= 0) this.widgets.splice(i, 1)[0]!.el.remove();
  }

  set visible(v: boolean) {
    this.el.hidden = !v;
  }

  update(frameDt: number): void {
    if (this.el.hidden) return;
    for (const w of this.widgets) w.update?.(this.game, frameDt);
  }
}

export function addDefaultHudWidgets(hud: Hud, game: Game): void {
  // Tier name + progress bar + radius.
  const tierName = h('div', { className: 'tier-name' });
  const fill = h('div', { className: 'tier-fill' });
  const bar = h('div', { className: 'tier-bar' }, fill);
  const radius = h('div', { className: 'radius' });
  hud.addWidget({
    id: 'tier',
    el: h('div', {}, tierName, bar, radius),
    update(g) {
      const run = g.run;
      if (!run) return;
      const r = run.bunny.radius;
      const t = getTier(run.tier);
      const next = t.index < MAX_TIER ? getTier(t.index + 1) : null;
      tierName.textContent = `Tier ${t.index} · ${t.name}`;
      fill.style.width = `${(tierProgress(r) * 100).toFixed(1)}%`;
      radius.textContent = next ? `${r.toFixed(r < 10 ? 2 : 1)} cm  →  ${next.name} at ${next.minRadius} cm` : `${r.toFixed(1)} cm`;
    },
  });

  const hearts = h('div', { className: 'hearts' });
  hud.addWidget({
    id: 'health',
    el: hearts,
    update(g) {
      const b = g.run?.bunny;
      if (!b) return;
      const text = '♥'.repeat(Math.max(0, Math.ceil(b.health))) + '♡'.repeat(Math.max(0, b.maxHealth - Math.ceil(b.health)));
      if (hearts.textContent !== text) hearts.textContent = text;
    },
  });

  const count = h('div', { className: 'debris-count' });
  hud.addWidget({
    id: 'debris',
    slot: 'top-right',
    el: count,
    update(g) {
      if (g.run) count.textContent = `Debris absorbed: ${g.run.debrisAbsorbed}`;
    },
  });

  // Tier-up banner.
  const banner = h('div', { className: 'tier-banner' });
  let bannerTime = 0;
  game.events.on('tierUp', (e) => {
    banner.textContent = `Tier up! ${e.tierName}`;
    bannerTime = 2.5;
  });
  hud.addWidget({
    id: 'tier-banner',
    slot: 'center',
    el: banner,
    update(_g, dt) {
      bannerTime = Math.max(0, bannerTime - dt);
      banner.style.opacity = String(Math.min(1, bannerTime * 2));
    },
  });
}
