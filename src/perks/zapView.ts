/**
 * Visuals for Zap's Character Perks: Thunderstruck's crackling static patch and Emergency
 * Discharge's burst ring. Floor decals under run.entityRoot, updated in sim time, no DOM, so they
 * are harmless headless (like src/abilities/view.ts).
 */
import { Group } from 'three';
import { ABILITY_COLORS } from '../abilities/view';
import { discDecal, ringDecal, type Decal } from '../hazards/decals';

/** Seconds the Emergency Discharge ring takes to expand and fade. */
const BURST_TIME = 0.4;

/** A static patch: a faint disc with a flickering rim, fading over its last half second. */
export class StaticPatchView {
  readonly root = new Group();
  private readonly disc: Decal;
  private readonly rim: Decal;

  constructor(x: number, z: number, radius: number) {
    this.disc = discDecal(1, ABILITY_COLORS.spark, 0.18, 40);
    this.rim = ringDecal(0.9, 1, ABILITY_COLORS.bolt, 0.6, 48);
    this.root.add(this.disc.root, this.rim.root);
    this.root.position.set(x, 0, z);
    this.root.scale.set(radius, 1, radius);
  }

  /** `time` in seconds, `left` the seconds the patch has left. */
  update(time: number, left: number): void {
    const fade = Math.min(1, left / 0.5);
    const crackle = 0.55 + 0.45 * Math.abs(Math.sin(time * 37) * Math.sin(time * 23 + 1.3));
    this.rim.setOpacity(0.6 * crackle * fade);
    this.disc.setOpacity(0.18 * (0.7 + 0.3 * crackle) * fade);
    this.root.rotation.y = time * 2;
  }

  dispose(): void {
    this.root.removeFromParent();
    this.disc.dispose();
    this.rim.dispose();
  }
}

/** Emergency Discharge: a bright ring expanding from Zap to the stun reach. */
export class EmergencyBurstView {
  readonly root = new Group();
  private readonly ring: Decal;
  private t = 0;

  constructor(
    x: number,
    z: number,
    private readonly radius: number,
  ) {
    this.ring = ringDecal(0.85, 1, ABILITY_COLORS.bolt, 0.85, 64);
    this.root.add(this.ring.root);
    this.root.position.set(x, 0, z);
  }

  /** Returns false once faded out (then dispose). */
  update(dt: number): boolean {
    this.t += dt;
    const k = Math.min(1, this.t / BURST_TIME);
    const r = this.radius * (0.3 + 0.7 * (1 - (1 - k) ** 3));
    this.root.scale.set(r, 1, r);
    this.ring.setOpacity(0.85 * (1 - k));
    return k < 1;
  }

  dispose(): void {
    this.root.removeFromParent();
    this.ring.dispose();
  }
}
