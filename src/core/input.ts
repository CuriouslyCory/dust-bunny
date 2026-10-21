/**
 * Input is abstracted to a world-space move vector (|move| <= 1 on XZ) plus a dash flag.
 * Any device (keyboard, mouse steer, touch joystick, gamepad, bot) implements InputSource;
 * CompositeInput merges them (largest move wins, dash is OR-ed).
 */
import type { Vec2 } from './math';

export interface InputState {
  moveX: number;
  moveZ: number;
  /** True for one read after a dash press (edge-triggered). */
  dash: boolean;
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
    let best = { moveX: 0, moveZ: 0, dash: false };
    let bestMag = 0;
    let dash = false;
    for (const s of this.sources) {
      const st = s.sample();
      dash ||= st.dash;
      const mag = st.moveX * st.moveX + st.moveZ * st.moveZ;
      if (mag > bestMag) {
        bestMag = mag;
        best = st;
      }
    }
    return { moveX: best.moveX, moveZ: best.moveZ, dash };
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

/** WASD / arrows, screen-relative to the fixed camera yaw. Space / Shift dash. */
export class KeyboardInput implements InputSource {
  private down = new Set<string>();
  private dashQueued = false;

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
    this.dashQueued = false;
    if (right === 0 && up === 0) return { moveX: 0, moveZ: 0, dash };
    const w = screenToWorld(right, up, this.getCameraYaw());
    const m = Math.hypot(w.x, w.z);
    return { moveX: w.x / m, moveZ: w.z / m, dash };
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
 */
export class PointerSteerInput implements InputSource {
  private held = false;
  private clientX = 0;
  private clientY = 0;

  constructor(
    private readonly element: HTMLElement,
    private readonly pickFloor: (clientX: number, clientY: number) => Vec2 | null,
    private readonly getOrigin: () => SteerOrigin | null,
  ) {
    element.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('blur', this.onUp);
  }

  private onDown = (e: PointerEvent): void => {
    if (e.button !== 0 || e.pointerType === 'touch') return; // touch gets its own joystick source
    this.held = true;
    this.clientX = e.clientX;
    this.clientY = e.clientY;
  };

  private onMove = (e: PointerEvent): void => {
    this.clientX = e.clientX;
    this.clientY = e.clientY;
  };

  private onUp = (): void => {
    this.held = false;
  };

  sample(): InputState {
    if (!this.held) return { moveX: 0, moveZ: 0, dash: false };
    const o = this.getOrigin();
    const p = this.pickFloor(this.clientX, this.clientY);
    if (!o || !p) return { moveX: 0, moveZ: 0, dash: false };
    const dx = p.x - o.x;
    const dz = p.z - o.z;
    const d = Math.hypot(dx, dz);
    const dead = o.radius * 0.5;
    if (d < dead) return { moveX: 0, moveZ: 0, dash: false };
    // Full speed beyond ~3 radii from the Bunny, proportional inside.
    const mag = Math.min(1, (d - dead) / (o.radius * 2.5));
    return { moveX: (dx / d) * mag, moveZ: (dz / d) * mag, dash: false };
  }

  dispose(): void {
    this.element.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('blur', this.onUp);
  }
}
