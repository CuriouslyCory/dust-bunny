/**
 * Screen registry. A screen is a DOM overlay plus game-state semantics: whether the Run
 * simulates while it is shown and whether the HUD is visible. Game.go(id, params) switches
 * screens; there is no central switch statement, so new screens (character select, shop,
 * Perk draft, settings) just register themselves.
 */
import { Registry } from '../core/registry';
import type { Game } from '../game/game';

export interface Screen {
  /** Root element; the manager wraps it in a full-screen centred `.screen.screen-<id>` div. */
  el: HTMLElement;
  enter?(params?: unknown): void;
  exit?(): void;
  /** Called every rendered frame while active. */
  update?(frameDt: number): void;
  /** Return true if the key was handled. */
  onKey?(e: KeyboardEvent): boolean;
}

export interface ScreenDef {
  id: string;
  /** Run simulation ticks while this screen is active (only 'playing' by default). */
  simulate?: boolean;
  /** Show the HUD while active. */
  hud?: boolean;
  create(game: Game): Screen;
}

export const screenRegistry = new Registry<ScreenDef>('screen');

export function registerScreen(def: ScreenDef): void {
  screenRegistry.register(def);
}

export class ScreenManager {
  private instances = new Map<string, { screen: Screen; wrapper: HTMLElement }>();
  current: ScreenDef | null = null;
  currentScreen: Screen | null = null;
  private currentWrapper: HTMLElement | null = null;

  constructor(
    private readonly game: Game,
    private readonly layer: HTMLElement,
  ) {}

  private instance(def: ScreenDef): { screen: Screen; wrapper: HTMLElement } {
    let inst = this.instances.get(def.id);
    if (!inst) {
      const screen = def.create(this.game);
      // Full-viewport wrapper (centres content, holds per-screen backdrop via .screen-<id>).
      const wrapper = h('div', { className: `screen screen-${def.id}` }, screen.el);
      wrapper.hidden = true;
      this.layer.appendChild(wrapper);
      inst = { screen, wrapper };
      this.instances.set(def.id, inst);
    }
    return inst;
  }

  /**
   * Exits and hides the current screen now, ahead of the next `go` (which then reports it as the
   * previous one). For tearing down what its `exit()` still uses right after (`Game.stepAside`).
   */
  leave(): void {
    if (!this.currentScreen) return;
    this.currentScreen.exit?.();
    this.currentWrapper!.hidden = true;
    this.currentScreen = null;
    this.currentWrapper = null;
  }

  /** Switches screen; returns the previous def. */
  go(id: string, params?: unknown): ScreenDef | null {
    const def = screenRegistry.require(id);
    const prev = this.current;
    if (this.currentScreen) {
      this.currentScreen.exit?.();
      this.currentWrapper!.hidden = true;
    }
    const { screen, wrapper } = this.instance(def);
    this.current = def;
    this.currentScreen = screen;
    this.currentWrapper = wrapper;
    wrapper.hidden = false;
    screen.enter?.(params);
    return prev;
  }

  update(frameDt: number): void {
    this.currentScreen?.update?.(frameDt);
  }

  handleKey(e: KeyboardEvent): boolean {
    return this.currentScreen?.onKey?.(e) ?? false;
  }
}

/** Tiny DOM helper for screens. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { className?: string } = {},
  ...children: Array<Node | string>
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  Object.assign(el, props);
  for (const c of children) el.append(c);
  return el;
}
