/**
 * Shared UI building blocks for screens. Styling comes from the design tokens in theme.css:
 * use these helpers (or the same class names) so new screens inherit the look.
 *
 *   button('Play', onClick, { variant: 'primary', size: 'lg' })   → .btn .btn-primary .btn-lg
 *   panel({ title: 'Shop', className: 'shop' }, …children)         → .panel with a .panel-title
 *   slider / toggle / segmented                                     → settings-style rows
 *   handleMenuKeys(e, root)                                         → arrow-key focus movement
 */
import { h } from './screens';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonOptions {
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  /** Leading icon (text/emoji or an element). Hidden from screen readers. */
  icon?: string | Node;
  className?: string;
  ariaLabel?: string;
}

export function button(label: string, onClick: (e: MouseEvent) => void, opts: ButtonOptions = {}): HTMLButtonElement {
  const variant = opts.variant ?? 'secondary';
  const el = h('button', { type: 'button', className: `btn btn-${variant} btn-${opts.size ?? 'md'}${variant === 'primary' ? ' primary' : ''} ${opts.className ?? ''}`.trim() });
  if (opts.icon) {
    const icon = h('span', { className: 'btn-icon' }, opts.icon);
    icon.setAttribute('aria-hidden', 'true');
    el.append(icon);
  }
  el.append(h('span', { className: 'btn-label', textContent: label }));
  if (opts.ariaLabel) el.setAttribute('aria-label', opts.ariaLabel);
  el.addEventListener('click', onClick);
  return el;
}

export interface PanelOptions {
  title?: string;
  subtitle?: string;
  className?: string;
  /** Accessible name when there is no visible title. */
  label?: string;
}

export function panel(opts: PanelOptions, ...children: Array<Node | string>): HTMLElement {
  const el = h('section', { className: `panel ${opts.className ?? ''}`.trim() });
  el.setAttribute('role', 'dialog');
  if (opts.title) {
    const id = `panel-${Math.random().toString(36).slice(2, 8)}`;
    el.append(h('h2', { className: 'panel-title', id, textContent: opts.title }));
    el.setAttribute('aria-labelledby', id);
  } else if (opts.label) el.setAttribute('aria-label', opts.label);
  if (opts.subtitle) el.append(h('p', { className: 'panel-sub', textContent: opts.subtitle }));
  el.append(...children);
  return el;
}

/**
 * The scrolling middle of a panel: header above and actions below stay put while this scrolls
 * (when it has to). Edges fade while there is more content that way (`data-more="up|down|both"`).
 */
export function scrollArea(className: string, ...children: Array<Node | string>): HTMLElement {
  const el = h('div', { className: `panel-body ${className}`.trim() }, ...children);
  const sync = (): void => {
    const up = el.scrollTop > 2;
    const down = el.scrollTop + el.clientHeight < el.scrollHeight - 2;
    const more = up && down ? 'both' : up ? 'up' : down ? 'down' : '';
    if ((el.dataset.more ?? '') !== more) {
      if (more) el.dataset.more = more;
      else delete el.dataset.more;
    }
  };
  el.addEventListener('scroll', sync, { passive: true });
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    // Content changes (screen re-renders) resize the children, not the scroller.
    new MutationObserver(() => {
      for (const c of el.children) ro.observe(c);
      sync();
    }).observe(el, { childList: true, subtree: true });
    for (const c of el.children) ro.observe(c);
  }
  return el;
}

/** Media query for phone-sized viewports, where menus switch to their compact layouts. */
export const COMPACT_QUERY = '(max-width: 720px), (max-height: 560px)';

export const isCompact = (): boolean => typeof matchMedia === 'function' && matchMedia(COMPACT_QUERY).matches;

/** A vertical stack of buttons. */
export function menu(...buttons: HTMLElement[]): HTMLElement {
  return h('nav', { className: 'menu' }, ...buttons);
}

export interface SliderOptions {
  label: string;
  value: number;
  onInput(v: number): void;
  /** Formats the value readout (default: percent). */
  format?(v: number): string;
}

export function slider(opts: SliderOptions): { el: HTMLElement; set(v: number): void } {
  const id = `sl-${Math.random().toString(36).slice(2, 8)}`;
  const fmt = opts.format ?? ((v: number) => `${Math.round(v * 100)}%`);
  const input = h('input', { type: 'range', id, min: '0', max: '100', step: '1', className: 'slider' });
  const out = h('output', { className: 'field-value' });
  out.htmlFor.add(id);
  const set = (v: number): void => {
    input.value = String(Math.round(v * 100));
    input.style.setProperty('--fill', `${Math.round(v * 100)}%`);
    out.textContent = fmt(v);
  };
  set(opts.value);
  input.addEventListener('input', () => {
    const v = Number(input.value) / 100;
    set(v);
    opts.onInput(v);
  });
  const el = h('div', { className: 'field field-slider' }, h('label', { htmlFor: id, className: 'field-label', textContent: opts.label }), input, out);
  return { el, set };
}

export interface ToggleOptions {
  label: string;
  value: boolean;
  onChange(v: boolean): void;
  hint?: string;
}

export function toggle(opts: ToggleOptions): { el: HTMLElement; set(v: boolean): void } {
  const btn = h('button', { type: 'button', className: 'toggle' }, h('span', { className: 'toggle-knob' }));
  btn.setAttribute('role', 'switch');
  const set = (v: boolean): void => btn.setAttribute('aria-checked', String(v));
  set(opts.value);
  btn.addEventListener('click', () => {
    const v = btn.getAttribute('aria-checked') !== 'true';
    set(v);
    opts.onChange(v);
  });
  const id = `tg-${Math.random().toString(36).slice(2, 8)}`;
  const label = h('span', { className: 'field-label', id, textContent: opts.label });
  btn.setAttribute('aria-labelledby', id);
  const el = h('div', { className: 'field field-toggle' }, h('div', {}, label, ...(opts.hint ? [h('span', { className: 'field-hint', textContent: opts.hint })] : [])), btn);
  return { el, set };
}

export interface SegmentedOptions<T extends string> {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange(v: T): void;
}

export function segmented<T extends string>(opts: SegmentedOptions<T>): { el: HTMLElement; set(v: T): void } {
  const id = `sg-${Math.random().toString(36).slice(2, 8)}`;
  const group = h('div', { className: 'segmented' });
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-labelledby', id);
  const buttons = opts.options.map((o) => {
    const b = h('button', { type: 'button', className: 'segment', textContent: o.label });
    b.setAttribute('role', 'radio');
    b.dataset.value = o.value;
    b.addEventListener('click', () => {
      set(o.value);
      opts.onChange(o.value);
    });
    return b;
  });
  const set = (v: T): void => {
    for (const b of buttons) b.setAttribute('aria-checked', String(b.dataset.value === v));
  };
  set(opts.value);
  group.append(...buttons);
  const el = h('div', { className: 'field field-segmented' }, h('span', { className: 'field-label', id, textContent: opts.label }), group);
  return { el, set };
}

const FOCUSABLE = 'button:not([disabled]):not([hidden]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Visible focusable elements inside `root`, in DOM order. */
export function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
}

/** Focuses the first focusable element (or `preferred`) after the screen becomes visible. */
export function focusFirst(root: HTMLElement, preferred?: HTMLElement | null): void {
  requestAnimationFrame(() => (preferred && !preferred.hidden ? preferred : focusables(root)[0])?.focus({ preventScroll: true }));
}

/**
 * Arrow-key navigation between focusable controls of a menu screen. Up/Down move focus;
 * Left/Right do too unless a slider has focus. Returns true if handled.
 */
export function handleMenuKeys(e: KeyboardEvent, root: HTMLElement): boolean {
  const vertical = e.code === 'ArrowDown' || e.code === 'ArrowUp';
  const horizontal = e.code === 'ArrowLeft' || e.code === 'ArrowRight';
  if (!vertical && !horizontal) return false;
  const active = document.activeElement as HTMLElement | null;
  if (active instanceof HTMLInputElement && (horizontal || active.type !== 'range')) return false;
  const items = focusables(root);
  if (items.length === 0) return false;
  const i = active ? items.indexOf(active) : -1;
  const dir = e.code === 'ArrowDown' || e.code === 'ArrowRight' ? 1 : -1;
  const next = items[i < 0 ? 0 : (i + dir + items.length) % items.length]!;
  next.focus();
  return true;
}

export const isKey = (e: KeyboardEvent, ...codes: string[]): boolean => codes.includes(e.code);

/** True if focus is on an interactive control (so Enter/Space should activate it, not a global shortcut). */
export function focusOnControl(): boolean {
  const a = document.activeElement;
  return !!a && a !== document.body && (a instanceof HTMLButtonElement || a instanceof HTMLInputElement || a instanceof HTMLAnchorElement);
}

export const fmtTime = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
