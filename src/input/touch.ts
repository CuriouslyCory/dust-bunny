/**
 * Touch controls: a dynamic virtual joystick (appears where the thumb lands on the left part of
 * the screen and follows it if dragged past its rim) plus a Dash button with a cooldown ring.
 * Tapping the right half also dashes. Feeds the input abstraction as an InputSource.
 *
 * Enabled by Settings.touchControls ('auto' = on touch devices / after the first touch).
 * Also blocks page scroll, pinch and double-tap zoom, and re-fits the canvas on orientation change.
 */
import { screenToWorld, type InputSource, type InputState } from '../core/input';
import { TUNING } from '../data/tuning';
import type { Game } from '../game/game';
import { h } from '../ui/screens';
import { settings } from '../ui/settings';
import './touch.css';

/** Joystick travel (px) for full deflection. */
const STICK_RADIUS = 56;
const DEAD_ZONE = 0.12;

export function isTouchDevice(): boolean {
  try {
    return matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
  } catch {
    return false;
  }
}

export class TouchControls implements InputSource {
  readonly layer = h('div', { className: 'touch-layer' });
  private base = h('div', { className: 'stick-base' });
  private knob = h('div', { className: 'stick-knob' });
  readonly dashButton = h('button', { type: 'button', className: 'touch-dash' });
  private ring: SVGCircleElement;
  private stickId: number | null = null;
  private originX = 0;
  private originY = 0;
  private vx = 0;
  private vy = 0;
  private dashQueued = false;
  private enabled = false;
  private sawTouch = false;

  constructor(private readonly game: Game) {
    this.base.append(this.knob);
    this.layer.append(this.base);
    this.layer.setAttribute('aria-hidden', 'true');
    this.dashButton.innerHTML =
      '<svg viewBox="0 0 64 64" aria-hidden="true"><circle class="track" cx="32" cy="32" r="29"/><circle class="fill" cx="32" cy="32" r="29" pathLength="100"/></svg><span class="touch-dash-label">DASH</span>';
    this.dashButton.setAttribute('aria-label', 'Dash');
    this.dashButton.dataset.sfx = 'off';
    this.ring = this.dashButton.querySelector('.fill') as SVGCircleElement;

    this.dashButton.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.dashQueued = true;
      this.dashButton.classList.add('pressed');
    });
    const release = (): void => this.dashButton.classList.remove('pressed');
    this.dashButton.addEventListener('pointerup', release);
    this.dashButton.addEventListener('pointercancel', release);
    this.dashButton.addEventListener('pointerleave', release);

    const canvas = game.canvas;
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onUp);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    game.events.on('screenChanged', (e) => {
      if (e.to !== 'playing') this.resetStick();
    });
    settings.subscribe((s) => this.setEnabled(s.touchControls === 'on' || (s.touchControls === 'auto' && (isTouchDevice() || this.sawTouch))));
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    document.documentElement.classList.toggle('touch', on);
    if (!on) this.resetStick();
  }

  private onDown = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch' && !(this.enabled && e.pointerType === 'pen')) return;
    if (!this.enabled && !this.sawTouch && settings.value.touchControls === 'auto') {
      this.sawTouch = true;
      this.setEnabled(true);
    }
    if (!this.enabled || this.game.screens.current?.id !== 'playing') return;
    const w = window.innerWidth;
    if (e.clientX > w * 0.55) {
      // Right side: tap to dash.
      this.dashQueued = true;
      return;
    }
    if (this.stickId !== null) return;
    this.stickId = e.pointerId;
    try {
      this.game.canvas.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic or already-released pointer: moves still arrive on the full-screen canvas.
    }
    this.originX = e.clientX;
    this.originY = e.clientY;
    this.vx = 0;
    this.vy = 0;
    this.base.style.transform = `translate(${this.originX}px, ${this.originY}px)`;
    this.knob.style.transform = 'translate(0px, 0px)';
    this.base.classList.add('active');
  };

  private onMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.stickId) return;
    let dx = e.clientX - this.originX;
    let dy = e.clientY - this.originY;
    const d = Math.hypot(dx, dy);
    if (d > STICK_RADIUS) {
      // Drag the base along so reversing direction is instant.
      const over = d - STICK_RADIUS;
      this.originX += (dx / d) * over;
      this.originY += (dy / d) * over;
      dx = (dx / d) * STICK_RADIUS;
      dy = (dy / d) * STICK_RADIUS;
      this.base.style.transform = `translate(${this.originX}px, ${this.originY}px)`;
    }
    this.vx = dx / STICK_RADIUS;
    this.vy = dy / STICK_RADIUS;
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
  };

  private onUp = (e: PointerEvent): void => {
    if (e.pointerId === this.stickId) this.resetStick();
  };

  private resetStick(): void {
    this.stickId = null;
    this.vx = 0;
    this.vy = 0;
    this.base.classList.remove('active');
  }

  sample(): InputState {
    const dash = this.dashQueued;
    this.dashQueued = false;
    const mag = Math.hypot(this.vx, this.vy);
    if (!this.enabled || mag < DEAD_ZONE) return { moveX: 0, moveZ: 0, dash: dash && this.enabled };
    const scaled = Math.min(1, (mag - DEAD_ZONE) / (1 - DEAD_ZONE));
    const w = screenToWorld(this.vx / mag, -this.vy / mag, TUNING.camera.yaw);
    return { moveX: w.x * scaled, moveZ: w.z * scaled, dash };
  }

  /** Per-frame visual update (cooldown ring). */
  update(): void {
    const b = this.game.run?.bunny;
    if (!b) return;
    const cd = b.stats.get('dashCooldown');
    const frac = cd > 0 ? 1 - b.dashCooldownLeft / cd : 1;
    this.ring.style.strokeDashoffset = String(100 - frac * 100);
    this.dashButton.classList.toggle('ready', b.dashCooldownLeft <= 0);
  }
}

/** Blocks browser gestures that fight the game (scroll, pinch, double-tap zoom). */
function blockBrowserGestures(): void {
  const scrollable = (t: EventTarget | null): boolean => !!(t as HTMLElement | null)?.closest?.('.scrollable, .panel');
  document.addEventListener(
    'touchmove',
    (e) => {
      if (e.touches.length > 1 || !scrollable(e.target)) e.preventDefault();
    },
    { passive: false },
  );
  for (const g of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(g, (e) => e.preventDefault());
  let lastTouchEnd = 0;
  document.addEventListener(
    'touchend',
    (e) => {
      const now = performance.now();
      // Double-tap zoom on the canvas only; buttons must keep their fast taps.
      if (now - lastTouchEnd < 320 && e.target instanceof HTMLCanvasElement) e.preventDefault();
      lastTouchEnd = now;
    },
    { passive: false },
  );
  document.addEventListener('dblclick', (e) => e.preventDefault());
}

export function installTouchControls(game: Game): TouchControls {
  const touch = new TouchControls(game);
  game.input.add(touch);
  game.hud.el.append(touch.layer);
  game.hud.addWidget({ id: 'touch-dash', slot: 'bottom-right', el: touch.dashButton, update: () => touch.update() });
  blockBrowserGestures();

  // Orientation / mobile URL-bar resizes: re-fit the canvas.
  const refit = (): void => {
    game.resize();
    setTimeout(() => game.resize(), 250);
  };
  window.addEventListener('orientationchange', refit);
  window.visualViewport?.addEventListener('resize', () => game.resize());

  game.events.on('bunnyDamaged', () => {
    if (document.documentElement.classList.contains('touch')) navigator.vibrate?.(35);
  });
  return touch;
}
