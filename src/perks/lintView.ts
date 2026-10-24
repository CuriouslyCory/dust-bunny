/**
 * Lint Trail's fluff streak: flat, pale quads along the Dash path, a little above the floor,
 * fading out over the streak's last half second. Plain three.js under run.entityRoot (no DOM or
 * WebGL), so it is harmless headless. One shared quad geometry; each streak owns its material.
 */
import { Group, Mesh, MeshBasicMaterial, PlaneGeometry } from 'three';

const COLOR = '#e9e4da';
const OPACITY = 0.55;
/** Seconds of fade before the streak ends. */
const FADE = 0.5;

const quad = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

export class LintTrailView {
  readonly root = new Group();
  private readonly material = new MeshBasicMaterial({
    color: COLOR,
    transparent: true,
    opacity: OPACITY,
    depthWrite: false,
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  private readonly segments: Mesh[] = [];

  constructor(parent: Group, y: number) {
    this.root.position.y = y;
    parent.add(this.root);
  }

  /** Lays one quad per segment of the path, `width` wide. */
  sync(points: readonly { x: number; z: number }[], width: number): void {
    const n = Math.max(0, points.length - 1);
    while (this.segments.length < n) {
      const m = new Mesh(quad, this.material);
      m.renderOrder = 2;
      this.segments.push(m);
      this.root.add(m);
    }
    for (let i = 0; i < this.segments.length; i++) {
      const m = this.segments[i]!;
      const a = points[i];
      const b = points[i + 1];
      m.visible = i < n && !!a && !!b;
      if (!m.visible) continue;
      const dx = b!.x - a!.x;
      const dz = b!.z - a!.z;
      m.position.set((a!.x + b!.x) / 2, 0, (a!.z + b!.z) / 2);
      m.rotation.y = Math.atan2(dx, dz);
      // Overlap the joints a little so the streak reads as one strip.
      m.scale.set(width, 1, Math.hypot(dx, dz) + width * 0.5);
    }
  }

  /** Fades with the seconds the streak has left (Infinity while it is still being laid). */
  fade(left: number): void {
    this.material.opacity = OPACITY * Math.min(1, Math.max(0, left / FADE));
  }

  dispose(): void {
    this.root.removeFromParent();
    this.material.dispose();
  }
}
