/**
 * Input is abstracted to a world-space move vector (|move| <= 1 on XZ) plus Dash and Ability
 * flags. Any device (keyboard, mouse steer, touch joystick, gamepad, bot) implements InputSource;
 * CompositeInput merges them (largest move wins, dash / ability / abilityHeld are OR-ed).
 */
import type { Vec2 } from './math';

export interface InputState {
  moveX: number;
  moveZ: number;
  /** True for one read after a dash press (edge-triggered). */
  dash: boolean;
  /** True for one read after an Ability press (edge-triggered): E, right mouse button, touch button. */
  ability?: boolean;
  /** True while the Ability input is held down (Amass). */
  abilityHeld?: boolean;
}

export interface InputSource {
  sample(): InputState;
  dispose?(): void;
}

export const NO_INPUT: Readonly<InputState> = Object.freeze({ moveX: 0, moveZ: 0, dash: false });

export class CompositeInput implements InputSource {
  private sources: InputSource[] = [];

  add(source: InputSource): () => void {
    this.sources.push(source);
    return () => this.remove(source);
  }

  remove(source: InputSource): void {
    const i = this.sources.indexOf(source);
    if (i >= 0) this.sources.splice(i, 1);
  }

  sample(): InputState {
    let best: InputState = { moveX: 0, moveZ: 0, dash: false };
    let bestMag = 0;
    let dash = false;
    let ability = false;
    let abilityHeld = false;
    for (const s of this.sources) {
      const st = s.sample();
      dash ||= st.dash;
      ability ||= !!st.ability;
      abilityHeld ||= !!st.abilityHeld;
      const mag = st.moveX * st.moveX + st.moveZ * st.moveZ;
      if (mag > bestMag) {
        bestMag = mag;
        best = st;
      }
    }
    return { moveX: best.moveX, moveZ: best.moveZ, dash, ability, abilityHeld };
  }

  dispose(): void {
    for (const s of this.sources) s.dispose?.();
    this.sources = [];
  }
}

/** Converts a screen-relative vector (right, up) to world XZ for a camera with the given yaw. */
export function screenToWorld(right: number, up: number, cameraYaw: number): Vec2 {
  // Camera sits at target + (sin(yaw), cos(yaw)) * dist, looking back at the target.
  const fx = -Math.sin(cameraYaw);
  const fz = -Math.cos(cameraYaw);
  const rx = Math.cos(cameraYaw);
  const rz = -Math.sin(cameraYaw);
  return { x: rx * right + fx * up, z: rz * right + fz * up };
}

const isTyping = (e: Event): boolean => {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
};

/** WASD / arrows, screen-relative to the fixed camera yaw. Space / Shift dash, E uses the Ability. */
export class KeyboardInput implements InputSource {
  private down = new Set<string>();
  private dashQueued = false;
  private abilityQueued = false;

  constructor(
    private readonly target: Window,
    private readonly getCameraYaw: () => number,
  ) {
    target.addEventListener('keydown', this.onDown);
    target.addEventListener('keyup', this.onUp);
    target.addEventListener('blur', this.onBlur);
  }

  private onDown = (e: KeyboardEvent): void => {
    if (isTyping(e)) return;
    if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    if (!e.repeat && (e.code === 'Space' || e.code === 'ShiftLeft' || e.code === 'ShiftRight')) this.dashQueued = true;
    if (!e.repeat && e.code === 'KeyE') this.abilityQueued = true;
    this.down.add(e.code);
  };

  private onUp = (e: KeyboardEvent): void => {
    this.down.delete(e.code);
  };

  private onBlur = (): void => {
    this.down.clear();
  };

  sample(): InputState {
    const k = this.down;
    const right = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const up = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const dash = this.dashQueued;
    const ability = this.abilityQueued;
    const abilityHeld = k.has('KeyE');
    this.dashQueued = false;
    this.abilityQueued = false;
    if (right === 0 && up === 0) return { moveX: 0, moveZ: 0, dash, ability, abilityHeld };
    const w = screenToWorld(right, up, this.getCameraYaw());
    const m = Math.hypot(w.x, w.z);
    return { moveX: w.x / m, moveZ: w.z / m, dash, ability, abilityHeld };
  }

  dispose(): void {
    this.target.removeEventListener('keydown', this.onDown);
    this.target.removeEventListener('keyup', this.onUp);
    this.target.removeEventListener('blur', this.onBlur);
  }
}

export interface SteerOrigin {
  x: number;
  z: number;
  radius: number;
}

/**
 * Click-and-hold steering: the Bunny rolls towards the floor point under the cursor.
 * `pickFloor` maps client coordinates to a world floor point (raycast), `getOrigin` returns the Bunny.
 * The right button uses the Ability (its context menu is suppressed on the element).
 */
export class PointerSteerInput implements InputSource {
  private held = false;
  private rightHeld = false;
  private abilityQueued = false;
  private clientX = 0;
  private clientY = 0;

  constructor(
    private readonly element: HTMLElement,
    private readonly pickFloor: (clientX: number, clientY: number) => Vec2 | null,
    private readonly getOrigin: () => SteerOrigin | null,
  ) {
    element.addEventListener('pointerdown', this.onDown);
    element.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('blur', this.onBlur);
  }

  private onContextMenu = (e: Event): void => {
    e.preventDefault();
  };

  /** Right button (bit 2 of `buttons`): edge-triggered Ability plus a held flag. Chorded presses arrive as moves. */
  private setRight(down: boolean): void {
    if (down && !this.rightHeld) this.abilityQueued = true;
    this.rightHeld = down;
  }

  private onDown = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') return; // touch gets its own joystick source
    if (e.button === 2) {
      e.preventDefault();
      this.setRight(true);
      return;
    }
    if (e.button !== 0) return;
    this.held = true;
    this.clientX = e.clientX;
    this.clientY = e.clientY;
  };

  private onMove = (e: PointerEvent): void => {
    this.clientX = e.clientX;
    this.clientY = e.clientY;
    if (e.pointerType !== 'touch' && (this.rightHeld || e.target === this.element)) this.setRight((e.buttons & 2) !== 0);
  };

  private onUp = (e: PointerEvent): void => {
    if (e.button === 2) this.setRight(false);
    else if (e.button === 0) this.held = false;
  };

  private onBlur = (): void => {
    this.held = false;
    this.rightHeld = false;
  };

  sample(): InputState {
    const ability = this.abilityQueued;
    const abilityHeld = this.rightHeld;
    this.abilityQueued = false;
    const none = { moveX: 0, moveZ: 0, dash: false, ability, abilityHeld };
    if (!this.held) return none;
    const o = this.getOrigin();
    const p = this.pickFloor(this.clientX, this.clientY);
    if (!o || !p) return none;
    const dx = p.x - o.x;
    const dz = p.z - o.z;
    const d = Math.hypot(dx, dz);
    const dead = o.radius * 0.5;
    if (d < dead) return none;
    // Full speed beyond ~3 radii from the Bunny, proportional inside.
    const mag = Math.min(1, (d - dead) / (o.radius * 2.5));
    return { moveX: (dx / d) * mag, moveZ: (dz / d) * mag, dash: false, ability, abilityHeld };
  }

  dispose(): void {
    this.element.removeEventListener('pointerdown', this.onDown);
    this.element.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('blur', this.onBlur);
  }
}
