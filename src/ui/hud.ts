/**
 * HUD built from widgets over the canvas (styles in hud.css).
 *
 * Extension API (all on `game.hud`):
 *   addWidget({ id, el, slot, update(game, dt) }) / removeWidget(id)
 *     slots: top-left | top-right | bottom-left | bottom-right | center | top-center | bottom-center
 *            | status (row under the Tier card: active Pickup timers live here)
 *            | perks  (icon row under the top-right counters: taken Perks live here)
 *   toast(text, { key, tone })          small batched toast near the Bunny ("+ Sock!")
 *   banner(title, { subtitle, variant, duration })   big centred banner (tier | boss | good | info)
 *   flash(widgetId)                     plays the highlight animation on a widget
 *
 * Built-in widgets already render active Pickups (`run.pickups.active`) and taken Perks
 * (`perkApplied`) generically. To give them proper icons call
 *   registerHudIcon('pickup', 'sugar_rush', { glyph: '🍬', color: '#ff8fb1' })
 */
import { AREA_BOSSES } from '../data/hazards';
import { getTier, MAX_TIER, tierProgress } from '../data/tiers';
import { hazardRegistry } from '../hazards';
import type { Game } from '../game/game';
import { perkRegistry } from '../perks';
import { pickupRegistry } from '../pickups';
import { absorbedName, isBossHazard, onLoose } from './looseEvents';
import { h } from './screens';
import { settings } from './settings';
import { ToastBatcher } from './toasts';
import './hud.css';

export type HudSlot = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center' | 'top-center' | 'bottom-center' | 'status' | 'perks';

export interface HudWidget {
  id: string;
  el: HTMLElement;
  /** Where the widget sits (default top-left). */
  slot?: HudSlot;
  update?(game: Game, frameDt: number): void;
}

export interface HudIcon {
  /** Short text or emoji shown in the chip. */
  glyph?: string;
  /** Inline SVG markup (overrides glyph). */
  svg?: string;
  /** Accent colour of the chip. */
  color?: string;
  /** Accessible / tooltip label (defaults to the def name). */
  label?: string;
}

export type BannerVariant = 'tier' | 'boss' | 'good' | 'info';

export interface BannerOptions {
  subtitle?: string;
  variant?: BannerVariant;
  /** Seconds on screen (default 2.4). */
  duration?: number;
}

export interface ToastOptions {
  /** Toasts with the same key merge into "text ×N". Defaults to the text. */
  key?: string;
  tone?: 'absorb' | 'good' | 'bad' | 'info' | 'hazard';
}

const icons = { pickup: new Map<string, HudIcon>(), perk: new Map<string, HudIcon>() };

/** Registers chip art for a Pickup or Perk id (used by the built-in timer and Perk rows). */
export function registerHudIcon(kind: 'pickup' | 'perk', id: string, icon: HudIcon): void {
  icons[kind].set(id, icon);
}

export function getHudIcon(kind: 'pickup' | 'perk', id: string): HudIcon | undefined {
  return icons[kind].get(id);
}

// Defaults for the design-doc ids, so chips look right even before content registers icons.
for (const [id, glyph, color] of [
  ['static_charge', '⚡', '#ffd23f'],
  ['sugar_rush', '🍬', '#ff8fb1'],
  ['bubble_wrap', '🫧', '#8fd3ff'],
  ['glue_dab', '💧', '#b9e3a0'],
  ['crumb_cake', '🍰', '#f6c177'],
  ['dust_cloud', '☁️', '#c9c2d8'],
] as const)
  registerHudIcon('pickup', id, { glyph, color });
for (const [id, glyph] of [
  ['thick_fur', '🧶'],
  ['aerodynamic', '🪶'],
  ['sticky_fibers', '🕸️'],
  ['static_field', '🧲'],
  ['second_wind', '💨'],
  ['quick_dash', '⏩'],
  ['hoarder', '🎒'],
  ['slippery', '🧼'],
  ['glutton', '🍪'],
  ['lucky_find', '🍀'],
  ['regrowth', '🌱'],
  ['spiky_dash', '🦔'],
] as const)
  registerHudIcon('perk', id, { glyph });

const HEART_SVG =
  '<svg viewBox="0 0 32 29" aria-hidden="true"><path d="M16 28.5S1.5 19.6 1.5 9.6C1.5 4.9 5.2 1.5 9.4 1.5c2.8 0 5.2 1.5 6.6 3.8 1.4-2.3 3.8-3.8 6.6-3.8 4.2 0 7.9 3.4 7.9 8.1 0 10-14.5 18.9-14.5 18.9z"/></svg>';

function chip(kind: 'pickup' | 'perk', id: string, name: string, fallbackColor?: string, defIcon?: string, description?: string): { el: HTMLElement; ring?: SVGCircleElement } {
  const registered = getHudIcon(kind, id);
  // The def's own icon replaces the default glyph; registered svg / colour / label still apply.
  const icon: HudIcon = { ...registered, glyph: defIcon ?? registered?.glyph };
  const el = h('div', { className: `hud-chip hud-chip-${kind}`, title: icon?.label ?? (description ? `${name}: ${description}` : name) });
  el.style.setProperty('--chip', icon?.color ?? fallbackColor ?? 'var(--honey)');
  el.setAttribute('aria-label', icon.label ?? name);
  const art = h('span', { className: 'hud-chip-art' });
  if (icon?.svg) art.innerHTML = icon.svg;
  else art.textContent = icon?.glyph ?? name.slice(0, 1).toUpperCase();
  let ring: SVGCircleElement | undefined;
  if (kind === 'pickup') {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 40 40');
    svg.classList.add('hud-chip-ring');
    svg.innerHTML = '<circle class="track" cx="20" cy="20" r="17"/><circle class="fill" cx="20" cy="20" r="17" pathLength="100"/>';
    ring = svg.querySelector('.fill') as SVGCircleElement;
    el.append(svg);
  }
  el.append(art);
  return { el, ring };
}

export class Hud {
  readonly el = h('div', { className: 'hud' });
  private slots = new Map<string, HTMLElement>();
  private widgets: HudWidget[] = [];
  private bannerEl = h('div', { className: 'hud-banner' });
  private bannerTimer: number | undefined;
  private toastLayer = h('div', { className: 'hud-toasts' });
  private toastEls = new Map<number, HTMLElement>();
  private clock = 0;
  private toasts: ToastBatcher;

  constructor(private readonly game: Game) {
    for (const s of ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center', 'top-center', 'bottom-center']) {
      const slot = h('div', { className: `hud-slot hud-${s}` });
      this.slots.set(s, slot);
      this.el.append(slot);
    }
    // Sub-rows that live inside corner slots.
    const status = h('div', { className: 'hud-row hud-status' });
    const perks = h('div', { className: 'hud-row hud-perks' });
    this.slots.set('status', status);
    this.slots.set('perks', perks);
    this.bannerEl.setAttribute('role', 'status');
    this.bannerEl.setAttribute('aria-live', 'polite');
    this.slots.get('center')!.append(this.bannerEl);
    this.el.append(this.toastLayer);
    this.toasts = new ToastBatcher({
      show: (t) => {
        const el = h('div', { className: `hud-toast tone-${t.tone}` }, h('span', { className: 'hud-toast-text', textContent: t.text }), h('span', { className: 'hud-toast-count' }));
        el.style.setProperty('--x', `${(Math.random() * 2 - 1) * 28}px`);
        this.toastEls.set(t.id, el);
        this.toastLayer.prepend(el);
      },
      update: (t) => {
        const el = this.toastEls.get(t.id);
        if (!el) return;
        (el.querySelector('.hud-toast-count') as HTMLElement).textContent = `×${t.count}`;
        el.classList.remove('bump');
        void el.offsetWidth;
        el.classList.add('bump');
      },
      hide: (t) => {
        const el = this.toastEls.get(t.id);
        this.toastEls.delete(t.id);
        if (!el) return;
        el.classList.add('out');
        setTimeout(() => el.remove(), 300);
      },
    });
  }

  /** The container element of a slot (for advanced layouts). */
  slot(name: HudSlot): HTMLElement {
    return this.slots.get(name)!;
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

  getWidget(id: string): HudWidget | undefined {
    return this.widgets.find((w) => w.id === id);
  }

  set visible(v: boolean) {
    this.el.hidden = !v;
  }

  get visible(): boolean {
    return !this.el.hidden;
  }

  toast(text: string, opts: ToastOptions = {}): void {
    this.toasts.push(opts.key ?? text, text, this.clock, opts.tone ?? 'absorb');
  }

  clearToasts(): void {
    this.toasts.clear();
  }

  clearBanner(): void {
    clearTimeout(this.bannerTimer);
    this.bannerEl.classList.remove('show');
  }

  banner(title: string, opts: BannerOptions = {}): void {
    const b = this.bannerEl;
    b.className = `hud-banner variant-${opts.variant ?? 'info'}`;
    b.replaceChildren(
      h('div', { className: 'hud-banner-title', textContent: title }),
      ...(opts.subtitle ? [h('div', { className: 'hud-banner-sub', textContent: opts.subtitle })] : []),
    );
    void b.offsetWidth;
    b.classList.add('show');
    clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => b.classList.remove('show'), (opts.duration ?? 2.4) * 1000);
  }

  /** Replays the highlight animation on a widget (e.g. 'tier' on Tier-up). */
  flash(widgetId: string, className = 'flash'): void {
    const el = this.getWidget(widgetId)?.el;
    if (!el) return;
    el.classList.remove(className);
    void el.offsetWidth;
    el.classList.add(className);
  }

  update(frameDt: number): void {
    this.clock += frameDt;
    this.toasts.tick(this.clock);
    if (this.el.hidden) return;
    for (const w of this.widgets) w.update?.(this.game, frameDt);
  }
}

function heartsWidget(hud: Hud, game: Game): void {
  const el = h('div', { className: 'hearts' });
  el.setAttribute('role', 'img');
  let shown = -1;
  let shownMax = -1;
  const render = (health: number, max: number): void => {
    if (el.children.length !== max) {
      el.replaceChildren(
        ...Array.from({ length: max }, () => {
          const s = h('span', { className: 'heart' });
          s.innerHTML = HEART_SVG;
          return s;
        }),
      );
    }
    [...el.children].forEach((c, i) => c.classList.toggle('empty', i >= Math.ceil(health)));
    el.setAttribute('aria-label', `Health ${Math.ceil(health)} of ${max}`);
  };
  game.events.on('bunnyDamaged', (e) => {
    hud.flash('health', 'shake');
    const lost = el.children[Math.ceil(e.health)] as HTMLElement | undefined;
    lost?.classList.remove('lost');
    void lost?.offsetWidth;
    lost?.classList.add('lost');
    const v = hud.el.querySelector('.hud-vignette');
    v?.classList.remove('hit');
    void (v as HTMLElement | null)?.offsetWidth;
    v?.classList.add('hit');
  });
  game.events.on('bunnyHealed', () => hud.flash('health', 'heal'));
  hud.addWidget({
    id: 'health',
    el,
    update(g) {
      const b = g.run?.bunny;
      if (!b) return;
      if (b.health !== shown || b.maxHealth !== shownMax) {
        shown = b.health;
        shownMax = b.maxHealth;
        render(b.health, b.maxHealth);
      }
      el.classList.toggle('invulnerable', b.invulnerable > 0);
      el.classList.toggle('low', b.health <= 1 && b.maxHealth > 1);
    },
  });
}

function tierWidget(hud: Hud, game: Game): void {
  const badge = h('span', { className: 'tier-badge' });
  const name = h('span', { className: 'tier-name' });
  const fill = h('div', { className: 'tier-fill' });
  const bar = h('div', { className: 'tier-bar' }, fill);
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', '100');
  const radius = h('span', { className: 'radius' });
  const next = h('span', { className: 'tier-next' });
  const el = h('div', { className: 'hud-card tier-card' }, h('div', { className: 'tier-head' }, badge, name), bar, h('div', { className: 'tier-foot' }, radius, next));
  let lastTier = -1;
  let lastPct = -1;
  hud.addWidget({
    id: 'tier',
    el,
    update(g) {
      const run = g.run;
      if (!run) return;
      const r = run.bunny.radius;
      const t = getTier(run.tier);
      if (t.index !== lastTier) {
        lastTier = t.index;
        badge.textContent = `Tier ${t.index}`;
        name.textContent = t.name;
        el.dataset.tier = String(t.index);
        const n = t.index < MAX_TIER ? getTier(t.index + 1) : null;
        next.textContent = n ? `${n.name} at ${n.minRadius} cm` : 'Max size!';
      }
      const pct = Math.round(tierProgress(r) * 1000) / 10;
      if (pct !== lastPct) {
        lastPct = pct;
        fill.style.width = `${pct}%`;
        bar.setAttribute('aria-valuenow', String(Math.round(pct)));
      }
      radius.textContent = `${r.toFixed(r < 10 ? 2 : 1)} cm`;
    },
  });
  game.events.on('tierUp', (e) => {
    hud.flash('tier');
    const t = getTier(e.tier);
    const area = game.run?.area ?? 'house';
    const boss = AREA_BOSSES[area];
    const cleared = area === 'house' ? game.run?.houseCleared : area === 'neighborhood' ? game.run?.neighborhoodCleared : false;
    const bossDue = e.tier >= boss.tier && !cleared;
    const hunt = bossDue ? ` · hunt the ${hazardRegistry.get(boss.id)?.name ?? 'boss'}` : '';
    hud.banner('Tier up!', { subtitle: `${t.name}${hunt}`, variant: 'tier', duration: 2.6 });
  });
}

function pickupTimersWidget(hud: Hud): void {
  const chips = new Map<string, { el: HTMLElement; ring?: SVGCircleElement }>();
  const el = h('div', { className: 'hud-pickups' });
  hud.addWidget({
    id: 'pickups',
    slot: 'status',
    el,
    update(g) {
      const active = g.run?.pickups.active ?? [];
      const seen = new Set<string>();
      for (const e of active) {
        const id = e.def.id;
        if (seen.has(id)) continue;
        seen.add(id);
        let c = chips.get(id);
        if (!c) {
          c = chip('pickup', id, e.def.name, e.def.color, e.def.icon, e.def.description);
          chips.set(id, c);
          el.append(c.el);
        }
        const frac = e.duration > 0 ? Math.max(0, e.remaining / e.duration) : 0;
        c.ring?.style.setProperty('stroke-dashoffset', String(100 - frac * 100));
        c.el.classList.toggle('ending', e.remaining < 2);
      }
      for (const [id, c] of chips) {
        if (!seen.has(id)) {
          c.el.remove();
          chips.delete(id);
        }
      }
    },
  });
}

function perksWidget(hud: Hud, game: Game): void {
  const el = h('div', { className: 'hud-perk-list' });
  const chips = new Map<string, HTMLElement>();
  const set = (perkId: string, stacks: number): void => {
    let c = chips.get(perkId);
    if (!c) {
      const def = perkRegistry.get(perkId);
      c = chip('perk', perkId, def?.name ?? perkId, undefined, def?.icon, def?.description).el;
      c.append(h('span', { className: 'hud-chip-stacks' }));
      chips.set(perkId, c);
      el.append(c);
    }
    (c.querySelector('.hud-chip-stacks') as HTMLElement).textContent = stacks > 1 ? `×${stacks}` : '';
    c.classList.remove('pop');
    void c.offsetWidth;
    c.classList.add('pop');
  };
  game.events.on('runStarted', () => {
    el.replaceChildren();
    chips.clear();
    const counts = new Map<string, number>();
    for (const id of game.run?.getStats().perks ?? []) counts.set(id, (counts.get(id) ?? 0) + 1);
    for (const [id, n] of counts) set(id, n);
  });
  game.events.on('perkApplied', (e) => set(e.perkId, e.stacks));
  hud.addWidget({ id: 'perks', slot: 'perks', el });
}

function counterWidgets(hud: Hud, game: Game): void {
  const pause = h('button', { type: 'button', className: 'hud-icon-btn hud-pause', title: 'Pause (Esc)' });
  pause.setAttribute('aria-label', 'Pause');
  pause.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1.5"/><rect x="14" y="5" width="4" height="14" rx="1.5"/></svg>';
  pause.addEventListener('click', () => {
    if (game.screens.current?.id === 'playing') game.go('paused');
  });
  hud.addWidget({ id: 'pause', slot: 'top-right', el: pause });

  const value = h('span', { className: 'count-value' });
  const count = h('div', { className: 'hud-card hud-counter' }, h('span', { className: 'count-icon', textContent: '✦' }), value);
  count.title = 'Debris absorbed';
  let last = -1;
  hud.addWidget({
    id: 'debris',
    slot: 'top-right',
    el: count,
    update(g) {
      const n = g.run?.debrisAbsorbed ?? 0;
      if (n !== last) {
        last = n;
        value.textContent = n.toLocaleString();
        count.setAttribute('aria-label', `${n} Debris absorbed`);
      }
    },
  });

  const fps = h('div', { className: 'hud-card hud-fps' });
  settings.subscribe((s) => (fps.hidden = !s.showFps || game.debug));
  hud.addWidget({
    id: 'fps',
    slot: 'top-right',
    el: fps,
    update(g) {
      if (!fps.hidden) fps.textContent = `${g.loop.fps.toFixed(0)} fps`;
    },
  });
  // Perk row sits below the counters.
  hud.slot('top-right').append(hud.slot('perks'));
}

function dashWidget(hud: Hud): void {
  const el = h('div', { className: 'hud-dash' });
  el.innerHTML =
    '<svg viewBox="0 0 64 64" aria-hidden="true"><circle class="track" cx="32" cy="32" r="28"/><circle class="fill" cx="32" cy="32" r="28" pathLength="100"/></svg>' +
    '<span class="hud-dash-icon" aria-hidden="true">💨</span><span class="hud-dash-key">Space</span>';
  el.setAttribute('aria-label', 'Dash');
  const ring = el.querySelector('.fill') as SVGCircleElement;
  let wasReady = true;
  hud.addWidget({
    id: 'dash',
    slot: 'bottom-right',
    el,
    update(g) {
      const b = g.run?.bunny;
      if (!b) return;
      const cd = b.stats.get('dashCooldown');
      const frac = cd > 0 ? 1 - b.dashCooldownLeft / cd : 1;
      ring.style.strokeDashoffset = String(100 - frac * 100);
      const ready = b.dashCooldownLeft <= 0;
      el.classList.toggle('ready', ready);
      if (ready && !wasReady) hud.flash('dash', 'pop');
      wasReady = ready;
    },
  });
}

function absorbToasts(hud: Hud, game: Game): void {
  const seenTypes = new Set<string>();
  game.events.on('runStarted', () => {
    seenTypes.clear();
    hud.clearToasts();
    hud.clearBanner();
  });
  game.events.on('debrisAbsorbed', (e) => {
    const first = !seenTypes.has(e.typeId);
    seenTypes.add(e.typeId);
    // Big-ish things, Hazards and first-of-a-kind get a toast; dust specks don't.
    const big = e.size >= e.radius * 0.22;
    if (e.kind !== 'hazard' && !big && !(first && e.size >= e.radius * 0.08)) return;
    const name = absorbedName(e.typeId);
    hud.toast(`+ ${name}!`, { key: e.typeId, tone: e.kind === 'hazard' ? 'hazard' : first ? 'good' : 'absorb' });
  });
  game.events.on('pickupCollected', (e) => {
    const def = pickupRegistry.get(e.defId);
    hud.toast(`${def?.icon ? `${def.icon} ` : ''}${def?.name ?? absorbedName(e.defId)}!`, { key: `pickup:${e.defId}`, tone: 'good' });
  });
}

function bossBanner(hud: Hud, game: Game): void {
  let shownFor = -1;
  const warn = (name?: unknown): void => {
    hud.banner('⚠ Boss incoming!', { subtitle: typeof name === 'string' ? name : 'Area boss', variant: 'boss', duration: 3.2 });
    hud.el.classList.add('boss-alert');
    setTimeout(() => hud.el.classList.remove('boss-alert'), 3200);
  };
  onLoose(game.events, 'bossSpawned', (p) => {
    shownFor = typeof p.hazardId === 'number' ? p.hazardId : -2;
    warn(p.name);
  });
  game.events.on('hazardSpawned', (e) => {
    if (isBossHazard(e.defId) && shownFor !== e.hazardId && shownFor !== -2) {
      shownFor = e.hazardId;
      warn();
    }
  });
  game.events.on('runStarted', () => (shownFor = -1));
}

export function addDefaultHudWidgets(hud: Hud, game: Game): void {
  hud.el.prepend(h('div', { className: 'hud-vignette' }));
  heartsWidget(hud, game);
  tierWidget(hud, game);
  hud.slot('top-left').append(hud.slot('status'));
  pickupTimersWidget(hud);
  counterWidgets(hud, game);
  perksWidget(hud, game);
  dashWidget(hud);
  absorbToasts(hud, game);
  bossBanner(hud, game);
}
