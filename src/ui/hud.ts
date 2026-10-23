/**
 * HUD built from widgets over the canvas (styles in hud.css).
 *
 * Extension API (all on `game.hud`):
 *   addWidget({ id, el, slot, update(game, dt) }) / removeWidget(id)
 *     slots: top-left | top-right | bottom-left | bottom-right | center | top-center | bottom-center
 *            | status (row under the Tier card: active Pickup timers live here)
 *            | perks  (icon row under the top-right counters: taken Perks live here)
 *   toast(text, { key, tone, swatch, short })   small batched toast near the Bunny ("+ Sock!");
 *                                       on phones a one-line ticker under the Tier pill ("Sock ×3")
 *   banner(title, { subtitle, variant, duration, caption })   big centred banner (tier | boss | good | info),
 *                                       optionally with a narrator caption under it; its ✕ button
 *                                       (or Enter in play) dismisses it early: skipBanner()
 *   flash(widgetId)                     plays the highlight animation on a widget
 *   onCompactChange(fn)                 runs fn(compact) now and whenever the phone layout toggles
 *
 * Built-in widgets already render active Pickups (`run.pickups.active`) and taken Perks
 * (`perkApplied`) generically. To give them proper icons call
 *   registerHudIcon('pickup', 'sugar_rush', { glyph: '🍬', color: '#ff8fb1' })
 */
import { getDebrisType } from '../data/debris';
import { AREA_BOSSES, bossArrivalRadius } from '../data/hazards';
import { getTier, MAX_TIER, tierProgress } from '../data/tiers';
import { AREAS, pastNextArrival } from '../data/areas';
import { EVERYTHING_TIER, formatAmount, lengthUnitFor } from '../data/units';
import { hazardRegistry } from '../hazards';
import type { Game } from '../game/game';
import { perkRegistry } from '../perks';
import { pickupRegistry } from '../pickups';
import { captionDuration, narrate, storyCaption } from '../story';
import { abilityWidget } from './abilityHud';
import { COMPACT_QUERY } from './components';
import { absorbedName, isBossHazard, onLoose } from './looseEvents';
import { showBossIntro } from './screens/bossIntro';
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
  /**
   * Narrator caption under the subtitle (src/story/): its parts show in turn, `holds[i]` seconds
   * each, and the banner stays up until the last one has had its time (or `duration`, if longer).
   * While it plays, later banners wait their turn instead of cutting it off.
   */
  caption?: { parts: readonly string[]; holds: readonly number[] };
}

/** Seconds a banner stays up: `duration`, or its caption's total hold if longer. */
function bannerSeconds(opts: BannerOptions): number {
  const hold = opts.caption?.holds.reduce((sum, h) => sum + h, 0) ?? 0;
  return Math.max(opts.duration ?? 2.4, hold);
}

export interface ToastOptions {
  /** Toasts with the same key merge into "text ×N". Defaults to the text. */
  key?: string;
  tone?: 'absorb' | 'good' | 'bad' | 'info' | 'hazard';
  /** CSS colour of a small dot before the text (e.g. the Debris colour). */
  swatch?: string;
  /** Shorter text for the phone ticker ("Sock" for "+ Sock!"). Defaults to the text. */
  short?: string;
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
  /**
   * Dismisses the banner early (the only part of the banner that takes input). Pointer only: it never
   * takes focus, since Space on a focused button would also Dash; keyboards use Enter in play.
   */
  private bannerSkip = h('button', { type: 'button', className: 'hud-icon-btn hud-banner-skip', title: 'Dismiss (Enter)', tabIndex: -1, disabled: true });
  private bannerTimer: number | undefined;
  /** The banner's next step (next caption part, or hide) and when it is due (performance.now()). */
  private bannerStep: { fn: () => void; due: number } | null = null;
  /** Set while the banner is held (`holdBanner`): when, and how long its step still had to run. */
  private bannerHeld: { at: number; left: number } | null = null;
  /** performance.now() when the current banner is due to hide (0: none showing). */
  private bannerUntil = 0;
  /** True while the current banner is playing a narrator caption (later banners queue). */
  private narrating = false;
  /** Banners waiting for a narrator caption to finish, in order. */
  private bannerQueue: Array<{ title: string; opts: BannerOptions }> = [];
  private toastLayer = h('div', { className: 'hud-toasts' });
  private toastEls = new Map<number, HTMLElement>();
  private clock = 0;
  private toasts: ToastBatcher;
  /** Swatch / short text per toast key (the batcher only carries the text). */
  private toastMeta = new Map<string, Pick<ToastOptions, 'swatch' | 'short'>>();
  private compactQuery = typeof matchMedia === 'function' ? matchMedia(COMPACT_QUERY) : undefined;
  private compactListeners: Array<(compact: boolean) => void> = [];

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
    this.bannerSkip.setAttribute('aria-label', 'Dismiss message');
    this.bannerSkip.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.4 4.3 12 9.9l5.6-5.6 2.1 2.1-5.6 5.6 5.6 5.6-2.1 2.1-5.6-5.6-5.6 5.6-2.1-2.1 5.6-5.6-5.6-5.6z"/></svg>';
    this.bannerSkip.addEventListener('mousedown', (e) => e.preventDefault()); // keeps focus off it
    this.bannerSkip.addEventListener('click', () => this.skipBanner());
    this.el.append(this.toastLayer);
    this.toasts = new ToastBatcher({
      show: (t) => {
        const meta = this.toastMeta.get(t.key);
        const swatch = h('span', { className: 'hud-toast-swatch' });
        if (meta?.swatch) swatch.style.setProperty('--swatch', meta.swatch);
        else swatch.hidden = true;
        const el = h(
          'div',
          { className: `hud-toast tone-${t.tone}` },
          swatch,
          h('span', { className: 'hud-toast-text', textContent: t.text }),
          h('span', { className: 'hud-toast-short', textContent: meta?.short ?? t.text }),
          h('span', { className: 'hud-toast-count', textContent: t.count > 1 ? `×${t.count}` : '' }),
        );
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
    // Phones: the toasts become a one-line ticker under the Tier pill in the top-centre slot.
    this.onCompactChange((compact) => {
      this.el.classList.toggle('hud-compact', compact);
      if (compact) this.slots.get('top-center')!.append(this.toastLayer);
      else this.el.append(this.toastLayer);
    });
    this.compactQuery?.addEventListener('change', (e) => {
      for (const fn of this.compactListeners) fn(e.matches);
    });
  }

  /** True on phone-sized viewports (`COMPACT_QUERY`), where the HUD uses its compact layout. */
  get compact(): boolean {
    return this.compactQuery?.matches ?? false;
  }

  /** Calls `fn(compact)` now and every time the viewport enters or leaves the phone layout. */
  onCompactChange(fn: (compact: boolean) => void): void {
    this.compactListeners.push(fn);
    fn(this.compact);
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

  /** Shows the HUD, fading it in over `seconds` (the intro's last shot). */
  fadeIn(seconds: number): void {
    const el = this.el;
    el.hidden = false;
    el.style.transition = 'none';
    el.style.opacity = '0';
    void el.offsetWidth;
    el.style.transition = `opacity ${seconds}s ease-out`;
    el.style.opacity = '1';
  }

  get visible(): boolean {
    return !this.el.hidden;
  }

  toast(text: string, opts: ToastOptions = {}): void {
    const key = opts.key ?? text;
    if (opts.swatch || opts.short) this.toastMeta.set(key, { swatch: opts.swatch, short: opts.short });
    else this.toastMeta.delete(key);
    this.toasts.push(key, text, this.clock, opts.tone ?? 'absorb');
  }

  clearToasts(): void {
    this.toasts.clear();
  }

  /**
   * Seconds until the current banner and any queued behind it have hidden (0 when none is up),
   * so a later banner can wait its turn.
   */
  get bannerLeft(): number {
    const queued = this.bannerQueue.reduce((sum, q) => sum + bannerSeconds(q.opts), 0);
    // A held banner's clock is stopped.
    const now = this.bannerHeld?.at ?? performance.now();
    return Math.max(0, (this.bannerUntil - now) / 1000) + queued;
  }

  /** Runs the banner's next step after `ms`; one at a time, so clear / skip cancel the rest. */
  private schedule(fn: () => void, ms: number): void {
    clearTimeout(this.bannerTimer);
    this.bannerStep = { fn, due: performance.now() + ms };
    this.bannerTimer = window.setTimeout(() => {
      this.bannerStep = null;
      fn();
    }, ms);
  }

  /**
   * Holds the banner on screen, caption and all, and hides it until `releaseBanner` (the Keepsake
   * reveal holds the area-cleared line so it can open at once; the line resumes where it was).
   */
  holdBanner(): void {
    if (this.bannerHeld || !this.bannerStep) return;
    clearTimeout(this.bannerTimer);
    const now = performance.now();
    this.bannerHeld = { at: now, left: Math.max(0, this.bannerStep.due - now) };
    this.bannerEl.classList.add('held');
  }

  /** Resumes a held banner (no-op when none is held). */
  releaseBanner(): void {
    const held = this.bannerHeld;
    const step = this.bannerStep;
    this.unhold();
    if (!held || !step) return;
    this.bannerUntil += performance.now() - held.at;
    this.schedule(step.fn, held.left);
  }

  private unhold(): void {
    this.bannerHeld = null;
    this.bannerEl.classList.remove('held');
  }

  /** True while a narrator caption is on the banner or a banner is queued behind one. */
  get bannerBusy(): boolean {
    return this.narrating || this.bannerQueue.length > 0;
  }

  clearBanner(): void {
    this.unhold();
    this.bannerStep = null;
    this.bannerUntil = 0;
    this.narrating = false;
    this.bannerQueue = [];
    clearTimeout(this.bannerTimer);
    this.hideBannerEl();
  }

  /** Shows a banner, replacing the current one, or queues it while a narrator caption plays. */
  banner(title: string, opts: BannerOptions = {}): void {
    if (this.bannerBusy) this.bannerQueue.push({ title, opts });
    else this.showBanner(title, opts);
  }

  /**
   * Dismisses the banner on screen, caption and all, before its time (the ✕ button, Enter in play);
   * the next queued banner, if any, takes its place. False when no banner is up.
   */
  skipBanner(): boolean {
    if (!this.bannerEl.classList.contains('show')) return false;
    clearTimeout(this.bannerTimer);
    this.unhold();
    this.bannerStep = null;
    this.nextBanner();
    return true;
  }

  /** The current banner is done: shows the next queued one, or hides. */
  private nextBanner(): void {
    this.narrating = false;
    const queued = this.bannerQueue.shift();
    if (queued) {
      this.showBanner(queued.title, queued.opts);
      return;
    }
    this.bannerUntil = 0;
    this.hideBannerEl();
  }

  /** Fades the banner out; its dismiss button is disabled until the next one shows. */
  private hideBannerEl(): void {
    this.bannerEl.classList.remove('show');
    this.bannerSkip.disabled = true;
  }

  private showBanner(title: string, opts: BannerOptions): void {
    this.unhold();
    const b = this.bannerEl;
    const parts = opts.caption?.parts ?? [];
    const holds = opts.caption?.holds ?? [];
    const caption = h('div', { className: 'hud-banner-caption', textContent: parts[0] ?? '' });
    b.className = `hud-banner variant-${opts.variant ?? 'info'}`;
    b.replaceChildren(
      h('div', { className: 'hud-banner-title', textContent: title }),
      ...(opts.subtitle ? [h('div', { className: 'hud-banner-sub', textContent: opts.subtitle })] : []),
      ...(parts.length ? [caption] : []),
      this.bannerSkip,
    );
    void b.offsetWidth;
    b.classList.add('show');
    this.bannerSkip.disabled = false;
    clearTimeout(this.bannerTimer);
    const total = bannerSeconds(opts);
    this.bannerUntil = performance.now() + total * 1000;
    this.narrating = parts.length > 0;
    const hide = (): void => this.nextBanner();
    let shown = 0;
    let elapsed = 0;
    // One timer at a time, so clearBanner / skipBanner cancel the rest of the caption.
    const next = (): void => {
      elapsed += holds[shown] ?? 0;
      shown++;
      const left = total - elapsed;
      // A timer that fired late (throttled tab) pushes the deadline out, so bannerLeft still covers the rest.
      this.bannerUntil = Math.max(this.bannerUntil, performance.now() + left * 1000);
      if (shown >= parts.length) {
        if (left > 0.05) this.schedule(hide, left * 1000);
        else hide();
        return;
      }
      caption.textContent = parts[shown]!;
      caption.classList.remove('next');
      void caption.offsetWidth;
      caption.classList.add('next');
      this.schedule(next, (holds[shown] ?? 0) * 1000);
    };
    if (parts.length) this.schedule(next, (holds[0] ?? 0) * 1000);
    else this.schedule(hide, total * 1000);
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
  // Phone pill only: "1.47 / 3 cm → Fluff" instead of "1.47 cm … Fluff at 3 cm".
  const goal = h('span', { className: 'tier-goal' });
  const next = h('span', { className: 'tier-next' });
  const nextShort = h('span', { className: 'tier-next-short' });
  const el = h(
    'div',
    { className: 'hud-card tier-card' },
    h('div', { className: 'tier-head' }, badge, name),
    bar,
    h('div', { className: 'tier-foot' }, h('span', { className: 'tier-size' }, radius, goal), next, nextShort),
  );
  let lastKey = '';
  let lastPct = -1;
  // The readout unit (cm, m, km…: the Area's ladder, see data/units.ts) is picked from the next
  // threshold, so the radius and its goal share one unit: `1.47 / 3 cm`, `14.7 / 30 m`.
  let unit = lengthUnitFor(1);
  /** No further Tier to grow into in this Area (the bar stays full). */
  let top = false;
  hud.addWidget({
    id: 'tier',
    el,
    update(g) {
      const run = g.run;
      if (!run) return;
      const r = run.bunny.realRadius;
      const t = getTier(run.tier);
      const key = `${t.index}:${run.area}`;
      if (key !== lastKey) {
        lastKey = key;
        badge.textContent = `Tier ${t.index}`;
        name.textContent = t.name;
        el.dataset.tier = String(t.index);
        // No goal past the next Area's arrival leap (the Region's Tier 11 tops out at the boss, not Tier 12).
        const after = t.index < MAX_TIER ? getTier(t.index + 1) : null;
        const n = after && !pastNextArrival(run.area, after.minRadius) ? after : null;
        top = !n;
        const from = AREAS[run.area].readout;
        unit = lengthUnitFor(n ? n.minRadius : Math.max(r, t.minRadius), from);
        const goalText = n ? `${Number((n.minRadius / unit.cm).toPrecision(3))} ${unit.id}` : '';
        next.textContent = n ? `${n.name} at ${goalText}` : after ? 'Absorb the boss' : 'Max size!';
        goal.textContent = n ? ` / ${goalText}` : t.index >= EVERYTHING_TIER ? '' : ` ${unit.id}`;
        nextShort.textContent = n ? `→ ${n.name}` : after ? 'Boss next' : 'Max size!';
      }
      const pct = top ? 100 : Math.round(tierProgress(r) * 1000) / 10;
      if (pct !== lastPct) {
        lastPct = pct;
        fill.style.width = `${pct}%`;
        bar.setAttribute('aria-valuenow', String(Math.round(pct)));
      }
      // Tier 21 (Everything): the readout is the word, not a length.
      const size = t.index >= EVERYTHING_TIER ? 'everything' : formatAmount(r / unit.cm);
      radius.textContent = hud.compact || t.index >= EVERYTHING_TIER ? size : `${size} ${unit.id}`;
    },
  });
  // Phones: a one-line pill at the top centre instead of the card under the hearts.
  hud.onCompactChange((compact) => {
    if (compact) {
      hud.slot('top-center').prepend(el);
      return;
    }
    const topLeft = hud.slot('top-left');
    const status = hud.slot('status');
    if (status.parentElement === topLeft) topLeft.insertBefore(el, status);
    else topLeft.append(el);
  });
  game.events.on('tierUp', (e) => {
    hud.flash('tier');
    const t = getTier(e.tier);
    const area = game.run?.area ?? 'house';
    const boss = AREA_BOSSES[area];
    const cleared = game.run?.isAreaCleared(area) ?? false;
    const b = game.run?.bunny;
    const bossDue = !!b && b.radius >= bossArrivalRadius(area, b.stats.get('absorbRatio')) && !cleared;
    const hunt = bossDue ? ` · hunt the ${hazardRegistry.get(boss.id)?.name ?? 'boss'}` : '';
    // The narrator's Tier beat goes in the Perk draft header; with no draft waiting, here.
    const line = game.run && !game.run.perkDraft.active ? narrate(game.run, { kind: 'tier', tier: e.tier }) : null;
    const caption = line ? storyCaption(line) : undefined;
    hud.banner('Tier up!', { subtitle: `${t.name}${hunt}`, variant: 'tier', duration: caption ? captionDuration(caption) : 2.6, caption });
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
  fullscreenWidget(hud);

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

const ENTER_FULLSCREEN_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V5a1 1 0 0 1 1-1h4v2.2H6.2V9zm11-5h4a1 1 0 0 1 1 1v4h-2.2V6.2H15zm5 11v4a1 1 0 0 1-1 1h-4v-2.2h2.8V15zM9 20H5a1 1 0 0 1-1-1v-4h2.2v2.8H9z"/></svg>';
const EXIT_FULLSCREEN_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.8 4H10v5a1 1 0 0 1-1 1H4V7.8h3.8zM14 4h2.2v3.8H20V10h-5a1 1 0 0 1-1-1zm1 10h5v2.2h-3.8V20H14v-5a1 1 0 0 1 1-1zM4 14h5a1 1 0 0 1 1 1v5H7.8v-3.8H4z"/></svg>';

type FullscreenDocument = Document & { webkitFullscreenEnabled?: boolean; webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => void };
type FullscreenElement = HTMLElement & { webkitRequestFullscreen?: () => void };

/** Touch HUD: enters / leaves browser fullscreen (hidden where the Fullscreen API is missing, e.g. iPhone Safari). */
function fullscreenWidget(hud: Hud): void {
  const doc = document as FullscreenDocument;
  const btn = h('button', { type: 'button', className: 'hud-icon-btn hud-fullscreen' });
  btn.hidden = !(doc.fullscreenEnabled || doc.webkitFullscreenEnabled);
  const active = (): boolean => !!(doc.fullscreenElement ?? doc.webkitFullscreenElement);
  const sync = (): void => {
    const on = active();
    btn.innerHTML = on ? EXIT_FULLSCREEN_SVG : ENTER_FULLSCREEN_SVG;
    btn.title = on ? 'Exit full screen' : 'Full screen';
    btn.setAttribute('aria-label', btn.title);
  };
  btn.addEventListener('click', () => {
    btn.blur(); // Space dashes; it must not press this again
    const root = document.documentElement as FullscreenElement;
    try {
      if (active()) {
        if (doc.exitFullscreen) void doc.exitFullscreen().catch(() => undefined);
        else doc.webkitExitFullscreen?.();
      } else if (root.requestFullscreen) void root.requestFullscreen({ navigationUI: 'hide' }).catch(() => undefined);
      else root.webkitRequestFullscreen?.();
    } catch {
      // Refused (not a user gesture, iframe without allowfullscreen): stay windowed.
    }
  });
  document.addEventListener('fullscreenchange', sync);
  document.addEventListener('webkitfullscreenchange', sync);
  sync();
  hud.addWidget({ id: 'fullscreen', slot: 'top-right', el: btn });
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
    const swatch = e.kind === 'hazard' ? undefined : getDebrisType(e.typeId)?.colors[0];
    hud.toast(`+ ${name}!`, { key: e.typeId, tone: e.kind === 'hazard' ? 'hazard' : first ? 'good' : 'absorb', swatch, short: name });
  });
  game.events.on('pickupCollected', (e) => {
    const def = pickupRegistry.get(e.defId);
    const name = def?.name ?? absorbedName(e.defId);
    hud.toast(`${def?.icon ? `${def.icon} ` : ''}${name}!`, { key: `pickup:${e.defId}`, tone: 'good', short: `${def?.icon ? `${def.icon} ` : ''}${name}` });
  });
}

/**
 * The boss's arrival opens the boss intro card (src/ui/screens/bossIntro.ts: model, name,
 * description, the narrator's boss line, hits; the Run pauses while it is up, and the boss-alert
 * vignette pulses once it closes).
 */
function bossIntroCard(game: Game): void {
  let shownFor = -1;
  onLoose(game.events, 'bossSpawned', (p) => {
    shownFor = typeof p.hazardId === 'number' ? p.hazardId : -2;
    showBossIntro(game, { hazardId: typeof p.hazardId === 'number' ? p.hazardId : undefined, name: typeof p.name === 'string' ? p.name : undefined });
  });
  // A boss spawned without bossSpawned. The director emits hazardSpawned first and bossSpawned
  // right after, so check once that event chain is done.
  game.events.on('hazardSpawned', (e) => {
    if (!isBossHazard(e.defId)) return;
    queueMicrotask(() => {
      if (shownFor === e.hazardId || shownFor === -2) return;
      shownFor = e.hazardId;
      showBossIntro(game, { hazardId: e.hazardId, defId: e.defId });
    });
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
  // The Ability widget sits up and to the left of Dash (src/ui/abilityHud.ts).
  abilityWidget(hud, game);
  dashWidget(hud);
  absorbToasts(hud, game);
  bossIntroCard(game);
}
