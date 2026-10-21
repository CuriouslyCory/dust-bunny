/**
 * Floor Pickup visual: a glowing orb with the Pickup's icon, an additive halo and a floor ring.
 * No real lights (adding lights forces shader recompiles); the "light pulse" is emissive + halo.
 * Built at unit size inside a Group whose scale is the Pickup radius, so it can track growth.
 * animatePickupObject() bobs and pulses it (called by the director each tick).
 */
import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Object3D,
  RingGeometry,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  type Texture,
} from 'three';

const hasDom = typeof document !== 'undefined';
let orbGeo: SphereGeometry | null = null;
let ringGeo: RingGeometry | null = null;
let haloTex: Texture | null = null;
const iconTex = new Map<string, Texture>();

function canvasTexture(size: number, draw: (ctx: CanvasRenderingContext2D) => void): Texture | null {
  if (!hasDom) return null;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  draw(ctx);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

function halo(): Texture | null {
  haloTex ??= canvasTexture(64, (ctx) => {
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  });
  return haloTex;
}

function icon(glyph: string): Texture | null {
  let t = iconTex.get(glyph);
  if (!t) {
    const made = canvasTexture(128, (ctx) => {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '96px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
      ctx.fillText(glyph, 64, 70);
    });
    if (!made) return null;
    t = made;
    iconTex.set(glyph, t);
  }
  return t;
}

interface PickupParts {
  orb: MeshStandardMaterial;
  halo?: SpriteMaterial;
  ring: MeshBasicMaterial;
  inner: Group;
}

export function createPickupObject(color: string, glyph: string | undefined, radius: number): Object3D {
  orbGeo ??= new SphereGeometry(1, 20, 14);
  ringGeo ??= new RingGeometry(1.25, 1.6, 32);
  const c = new Color(color);
  const root = new Group();
  root.name = 'pickup';
  const inner = new Group();
  root.add(inner);

  const orb = new MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.9, roughness: 0.35, transparent: true, opacity: 0.85 });
  const orbMesh = new Mesh(orbGeo, orb);
  orbMesh.castShadow = true;
  inner.add(orbMesh);

  const parts: PickupParts = { orb, ring: new MeshBasicMaterial({ color: c, transparent: true, opacity: 0.5, blending: AdditiveBlending, depthWrite: false, side: DoubleSide }), inner };

  const h = halo();
  if (h) {
    parts.halo = new SpriteMaterial({ map: h, color: c, blending: AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.7 });
    const s = new Sprite(parts.halo);
    s.scale.setScalar(3.6);
    inner.add(s);
  }
  const it = glyph ? icon(glyph) : null;
  if (it) {
    const s = new Sprite(new SpriteMaterial({ map: it, depthTest: false, transparent: true }));
    s.scale.setScalar(1.5);
    s.renderOrder = 10;
    inner.add(s);
  }

  const ring = new Mesh(ringGeo, parts.ring);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  root.add(ring);

  root.userData.pickupParts = parts;
  root.scale.setScalar(radius);
  return root;
}

/** Bob + pulse. `t` is seconds; the root's y is set by the caller (floor = 0 at scale 1). */
export function animatePickupObject(obj: Object3D, radius: number, t: number, phase: number): void {
  const parts = obj.userData.pickupParts as PickupParts | undefined;
  obj.scale.setScalar(radius);
  obj.position.y = 0;
  if (!parts) {
    obj.position.y = radius * (1.2 + 0.25 * Math.sin(t * 3 + phase));
    return;
  }
  const pulse = 0.5 + 0.5 * Math.sin(t * 4 + phase);
  parts.inner.position.y = 1.3 + 0.3 * Math.sin(t * 2.6 + phase);
  parts.inner.rotation.y = t * 1.5 + phase;
  parts.orb.emissiveIntensity = 0.6 + 0.8 * pulse;
  if (parts.halo) parts.halo.opacity = 0.4 + 0.5 * pulse;
  parts.ring.opacity = 0.25 + 0.4 * (1 - pulse);
}
