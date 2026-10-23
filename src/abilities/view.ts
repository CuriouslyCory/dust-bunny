/**
 * Ability visuals: the Decoy lint ball, Tumble's Amass well (accretion disc, core ring, inward
 * ripples, Collapse burst), the Discharge spark marker and zap bolt. Plain three.js objects parented under run.entityRoot (like Hazard models), updated
 * from the Ability System in sim time. No DOM, so they are harmless headless.
 */
import {
  CatmullRomCurve3,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  TubeGeometry,
  Vector3,
  type BufferGeometry,
  type Material,
} from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Rng } from '../core/rng';
import { ringDecal, sectorDecal, type Decal } from '../hazards/decals';

export const ABILITY_COLORS = {
  decoy: '#c9ccd1',
  lure: '#ffd166',
  amass: '#b48cff',
  accretion: '#f3c27a',
  spark: '#9ad8ff',
  bolt: '#e6f4ff',
} as const;

/**
 * A lumpy lint ball: an icosphere displaced by a smooth function of position (seeded phases), so
 * the duplicated vertices of the non-indexed geometry move together and the surface stays closed.
 */
function lintGeometry(rng: Rng): BufferGeometry {
  const g = mergeVertices(new IcosahedronGeometry(1, 3));
  const pos = g.getAttribute('position');
  const v = new Vector3();
  const [a, b, c] = [rng.range(0, 6.28), rng.range(0, 6.28), rng.range(0, 6.28)];
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const lump = 0.07 * Math.sin(v.x * 4.1 + a) * Math.cos(v.y * 3.7 + b) + 0.05 * Math.sin(v.z * 5.3 + c + v.x * 2);
    v.multiplyScalar(0.95 + lump);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

/** Lint's Decoy on the floor: a grey lint ball with a pulsing lure ring. */
export class DecoyView {
  readonly root = new Group();
  private readonly ball: Mesh;
  private readonly ring: Decal;
  private popT = -1;
  private popScale = 1;

  constructor(rng: Rng) {
    const mat = new MeshStandardMaterial({ color: ABILITY_COLORS.decoy, roughness: 1, emissive: '#3a3328', emissiveIntensity: 0.25 });
    this.ball = new Mesh(lintGeometry(rng), mat);
    this.ball.castShadow = true;
    this.root.add(this.ball);
    // A few loose wisps on the surface.
    for (let i = 0; i < 6; i++) {
      const w = new Mesh(new IcosahedronGeometry(0.22, 0), mat);
      const a = rng.range(0, Math.PI * 2);
      const y = rng.range(-0.3, 0.8);
      const rr = Math.sqrt(1 - y * y);
      w.position.set(Math.cos(a) * rr, y, Math.sin(a) * rr);
      this.ball.add(w);
    }
    this.ring = ringDecal(1.15, 1.35, ABILITY_COLORS.lure, 0.55);
    this.root.add(this.ring.root);
  }

  /** `life` 0..1 of the Decoy's duration used; blinks faster near the end. */
  update(time: number, x: number, z: number, radius: number, life: number): void {
    this.root.position.set(x, 0, z);
    const wobble = 1 + Math.sin(time * 7) * 0.03;
    this.ball.scale.set(radius * wobble, radius / wobble, radius * wobble);
    this.ball.position.y = radius * 0.95;
    this.ball.rotation.y = time * 0.6;
    this.ring.root.scale.set(radius, 1, radius);
    this.ring.pulse(time, life);
    this.ball.visible = life <= 0.75 || Math.floor(time * (6 + life * 10)) % 2 === 0;
  }

  /** Starts the pop puff; returns true while it is still playing. */
  pop(dt: number): boolean {
    if (this.popT < 0) {
      this.popT = 0;
      this.popScale = this.ball.scale.x;
    }
    this.popT += dt;
    const k = Math.min(1, this.popT / 0.25);
    this.ball.visible = true;
    this.ball.scale.setScalar(this.popScale * (1 + k * 0.5));
    (this.ball.material as MeshStandardMaterial).transparent = true;
    (this.ball.material as MeshStandardMaterial).opacity = 1 - k;
    this.ring.setOpacity(0.5 * (1 - k));
    return k < 1;
  }

  dispose(): void {
    this.root.removeFromParent();
    this.ring.dispose();
    this.ball.traverse((o) => {
      if (o instanceof Mesh) o.geometry.dispose();
    });
    (this.ball.material as Material).dispose();
  }
}

/** Spiral arms of the accretion disc. */
const ARMS = 3;
/** Inward ripples (each shrinks from the core ring to the fur, staggered). */
const RIPPLES = 2;
/** Seconds a Collapse burst takes to expand and fade. */
const BURST_TIME = 0.45;

/**
 * Tumble's Amass well: a pulsing ring at the full-strength core, an accretion disc of spiral arms
 * turning faster as the channel runs on, ripples sliding inward, and a Collapse burst.
 */
export class AmassView {
  readonly root = new Group();
  private readonly well = new Group();
  private readonly core: Decal;
  private readonly arms: Decal[] = [];
  private readonly ripples: Decal[] = [];
  private readonly burst: Decal;
  private spin = 0;
  private burstT = -1;
  private burstR = 1;

  constructor() {
    this.core = ringDecal(0.97, 1, ABILITY_COLORS.amass, 0.55, 64);
    this.well.add(this.core.root);
    for (let i = 0; i < ARMS; i++) {
      const arm = sectorDecal(1.15, 2.1, Math.PI * 0.42, ABILITY_COLORS.accretion, 0.4);
      this.arms.push(arm);
      this.well.add(arm.root);
    }
    for (let i = 0; i < RIPPLES; i++) {
      const ripple = ringDecal(0.94, 1, ABILITY_COLORS.amass, 0.4, 48);
      this.ripples.push(ripple);
      this.well.add(ripple.root);
    }
    this.burst = ringDecal(0.9, 1, '#fff3e0', 0.8, 64);
    this.burst.root.visible = false;
    this.well.visible = false;
    this.root.add(this.well, this.burst.root);
  }

  /** `hold` 0..1 of the max channel used; `coreRadius` in Bunny radii. */
  update(dt: number, time: number, visible: boolean, x: number, z: number, radius: number, hold: number, coreRadius: number): void {
    this.well.visible = visible;
    if (visible) {
      this.well.position.set(x, 0, z);
      const core = Math.max(1.3, coreRadius) * radius;
      this.core.root.scale.set(core, 1, core);
      this.core.setOpacity(0.35 + 0.2 * Math.sin(time * 9));
      this.spin += dt * (2.5 + 5 * hold);
      for (let i = 0; i < ARMS; i++) {
        const arm = this.arms[i]!;
        arm.root.scale.set(radius, 1, radius);
        arm.root.rotation.y = this.spin + (i * Math.PI * 2) / ARMS;
        arm.setOpacity(0.25 + 0.25 * hold);
      }
      for (let i = 0; i < RIPPLES; i++) {
        const k = (time * 1.6 + i / RIPPLES) % 1;
        const r = radius + (core - radius) * (1 - k);
        const ripple = this.ripples[i]!;
        ripple.root.scale.set(r, 1, r);
        ripple.setOpacity(0.45 * k);
      }
    }
    if (this.burstT >= 0) {
      this.burstT += dt;
      const k = Math.min(1, this.burstT / BURST_TIME);
      const r = this.burstR * (0.3 + 0.7 * (1 - (1 - k) ** 3));
      this.burst.root.scale.set(r, 1, r);
      this.burst.setOpacity(0.8 * (1 - k));
      if (k >= 1) {
        this.burstT = -1;
        this.burst.root.visible = false;
      }
    }
  }

  /** The Collapse implosion's shockwave at (x, z), reaching `radius` world units. */
  collapse(x: number, z: number, radius: number): void {
    this.burst.root.position.set(x, 0, z);
    this.burst.root.visible = true;
    this.burstR = radius;
    this.burstT = 0;
  }

  dispose(): void {
    this.root.removeFromParent();
    this.core.dispose();
    for (const d of [...this.arms, ...this.ripples]) d.dispose();
    this.burst.dispose();
  }
}

/** Spark marker over the Discharge target: a crackling ring plus a floating spark. */
export class SparkMarkerView {
  readonly root = new Group();
  private readonly ring: Decal;
  private readonly spark: Mesh;

  constructor() {
    this.ring = ringDecal(1.08, 1.22, ABILITY_COLORS.spark, 0.8);
    this.spark = new Mesh(new OctahedronGeometry(1, 0), new MeshBasicMaterial({ color: ABILITY_COLORS.spark, toneMapped: false }));
    this.root.add(this.ring.root, this.spark);
    this.root.visible = false;
  }

  update(time: number, target: { x: number; z: number; radius: number; height: number } | null, bunnyRadius: number): void {
    this.root.visible = !!target;
    if (!target) return;
    this.root.position.set(target.x, 0, target.z);
    const r = target.radius;
    const flicker = 1 + 0.06 * Math.sin(time * 37) + 0.04 * Math.sin(time * 23);
    this.ring.root.scale.set(r * flicker, 1, r * flicker);
    this.ring.root.rotation.y = time * 2;
    this.ring.setOpacity(0.6 + 0.35 * Math.abs(Math.sin(time * 11)));
    const s = Math.max(bunnyRadius * 0.35, r * 0.18);
    this.spark.scale.set(s * 0.6, s, s * 0.6);
    this.spark.position.y = target.height + s * (1.6 + 0.3 * Math.sin(time * 6));
    this.spark.rotation.y = time * 4;
  }

  dispose(): void {
    this.root.removeFromParent();
    this.ring.dispose();
    this.spark.geometry.dispose();
    (this.spark.material as Material).dispose();
  }
}

/** A short-lived jagged lightning bolt from (ax, az) to (bx, bz). */
export class BoltView {
  readonly root = new Group();
  private t = 0;
  private readonly material: MeshBasicMaterial;
  private readonly mesh: Mesh;

  constructor(rng: Rng, ax: number, az: number, ay: number, bx: number, bz: number, by: number, thickness: number) {
    const pts: Vector3[] = [];
    const n = 9;
    const len = Math.hypot(bx - ax, bz - az) || 1;
    const px = -(bz - az) / len;
    const pz = (bx - ax) / len;
    for (let i = 0; i <= n; i++) {
      const k = i / n;
      const j = i === 0 || i === n ? 0 : rng.range(-1, 1) * len * 0.08;
      pts.push(new Vector3(ax + (bx - ax) * k + px * j, ay + (by - ay) * k + Math.sin(k * Math.PI) * len * 0.08, az + (bz - az) * k + pz * j));
    }
    const curve = new CatmullRomCurve3(pts, false, 'catmullrom', 0.1);
    this.material = new MeshBasicMaterial({ color: ABILITY_COLORS.bolt, transparent: true, opacity: 1, toneMapped: false, depthWrite: false });
    this.mesh = new Mesh(new TubeGeometry(curve, 36, thickness, 5, false), this.material);
    this.root.add(this.mesh);
  }

  /** Returns false once faded out (then dispose). */
  update(dt: number): boolean {
    this.t += dt;
    const k = this.t / 0.4;
    this.material.opacity = Math.max(0, 1 - k) * (0.6 + 0.4 * Math.abs(Math.sin(this.t * 60)));
    return k < 1;
  }

  dispose(): void {
    this.root.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
