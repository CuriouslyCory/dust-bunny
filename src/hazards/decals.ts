/**
 * Floor decals for Hazards: telegraph rings, sectors, lanes, puddles. Flat meshes a little
 * above the floor (rugs sit at y = 0.12), unlit, transparent, never writing depth.
 * Each decal owns its geometry and material; call dispose() when the Hazard goes away.
 */
import { CircleGeometry, Group, Mesh, MeshBasicMaterial, PlaneGeometry, RingGeometry, type BufferGeometry } from 'three';

const DECAL_Y = 0.25;

export const DECAL_COLORS = {
  danger: '#ff3b30',
  warn: '#ffb020',
  suction: '#6fd3ff',
  wet: '#4aa3ff',
  absorbable: '#5cff8a',
} as const;

function decalMaterial(color: string, opacity: number): MeshBasicMaterial {
  return new MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
}

/**
 * A flat decal in a Group: `root.position` is its anchor on the floor and `root.rotation.y`
 * its yaw (local +Z = forward). Geometry is built lying on the XZ plane.
 */
export class Decal {
  readonly root = new Group();
  readonly mesh: Mesh;
  readonly material: MeshBasicMaterial;
  baseOpacity: number;

  constructor(geometry: BufferGeometry, color: string, opacity: number, y = DECAL_Y) {
    this.material = decalMaterial(color, opacity);
    this.baseOpacity = opacity;
    geometry.rotateX(-Math.PI / 2);
    this.mesh = new Mesh(geometry, this.material);
    this.mesh.position.y = y;
    this.mesh.renderOrder = 2;
    this.root.add(this.mesh);
  }

  set visible(v: boolean) {
    this.root.visible = v;
  }

  get visible(): boolean {
    return this.root.visible;
  }

  setColor(color: string): void {
    this.material.color.set(color);
  }

  setOpacity(o: number): void {
    this.material.opacity = o;
  }

  /** Telegraph pulse: blinks faster as `progress` (0..1) approaches 1. */
  pulse(time: number, progress: number): void {
    const freq = 3 + progress * 9;
    const wave = 0.5 + 0.5 * Math.sin(time * freq * Math.PI * 2);
    this.material.opacity = this.baseOpacity * (0.45 + 0.55 * wave) * (0.6 + 0.4 * progress);
  }

  place(x: number, z: number, yaw = 0): void {
    this.root.position.set(x, 0, z);
    this.root.rotation.y = yaw;
  }

  dispose(): void {
    this.root.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

export function ringDecal(inner: number, outer: number, color: string, opacity = 0.45, segments = 48): Decal {
  return new Decal(new RingGeometry(inner, outer, segments), color, opacity);
}

export function discDecal(radius: number, color: string, opacity = 0.35, segments = 32): Decal {
  return new Decal(new CircleGeometry(radius, segments), color, opacity);
}

/** Ring sector centred on local +Z, spanning `arc` radians. */
export function sectorDecal(inner: number, outer: number, arc: number, color: string, opacity = 0.4): Decal {
  // RingGeometry angles are measured from +X towards +Y; after rotateX(-π/2), +Y maps to −Z,
  // so +Z corresponds to θ = −π/2.
  const g = new RingGeometry(inner, outer, 40, 1, -Math.PI / 2 - arc / 2, arc);
  return new Decal(g, color, opacity);
}

/** Rectangle starting at the anchor and extending `length` along local +Z. */
export function laneDecal(length: number, width: number, color: string, opacity = 0.35): Decal {
  const g = new PlaneGeometry(width, length);
  // Spans local y ∈ [0, length]; after rotateX(-π/2) that is z ∈ [−length, 0], so flip it.
  g.translate(0, length / 2, 0);
  const d = new Decal(g, color, opacity);
  d.mesh.rotation.y = Math.PI;
  return d;
}
