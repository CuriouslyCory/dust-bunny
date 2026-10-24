/**
 * Tumble's Perk visuals: the Heavy Landing shockwave, a floor ring that expands to the
 * shockwave's reach and fades (like Amass's Collapse burst). A plain three.js decal parented under
 * run.entityRoot and stepped in sim time, so it is harmless headless.
 */
import { ringDecal, type Decal } from '../hazards/decals';

/** Seconds a Heavy Landing ring takes to expand and fade. */
const LANDING_TIME = 0.4;
const LANDING_COLOR = '#ffc58a';

export class HeavyLandingView {
  private readonly ring: Decal = ringDecal(0.88, 1, LANDING_COLOR, 0.75, 64);
  private t = -1;
  private reach = 1;

  get root() {
    return this.ring.root;
  }

  constructor() {
    this.ring.root.visible = false;
  }

  /** Starts a ring at (x, z) reaching `radius` world units. */
  burst(x: number, z: number, radius: number): void {
    this.ring.place(x, z);
    this.ring.root.visible = true;
    this.reach = radius;
    this.t = 0;
  }

  update(dt: number): void {
    if (this.t < 0) return;
    this.t += dt;
    const k = Math.min(1, this.t / LANDING_TIME);
    const r = this.reach * (0.25 + 0.75 * (1 - (1 - k) ** 3));
    this.ring.root.scale.set(r, 1, r);
    this.ring.setOpacity(0.75 * (1 - k));
    if (k >= 1) {
      this.t = -1;
      this.ring.root.visible = false;
    }
  }

  dispose(): void {
    this.ring.dispose();
  }
}
