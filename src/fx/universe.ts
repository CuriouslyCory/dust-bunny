/**
 * The Universe's sky (browser only): galaxies as instanced points over the painted cosmic web,
 * warm glows on the nodes near the camera, the light from the nearest heavy node, and the CMB
 * tint at the screen's edges. One instance per Game (`Game.universeSky`), shown only while the Run
 * is in the Universe.
 *
 * - Galaxies (`starLayer` from fx/galaxy.ts, one draw call each, a few pixels wide, twinkling):
 *   `web` galaxies lie on the floor along the filaments (`universeWeb`), packed round the nodes,
 *   thin in the sheets and a few strays in the voids; blue-white on the filaments, warm gold in the
 *   nodes. `deep` galaxies lie far below the web (0.9 × the camera distance, drawn over the floor
 *   and under everything else, tiled round the camera target), faint and tinted, so they slide by
 *   slower than the floor: the web floats over the rest of the universe. Both thin out as the
 *   camera pulls back (a point shows while its rank is under (`ref` / camera distance)²).
 * - Node glows: a small pool of additive sprites on the nodes nearest the camera target (warm gold
 *   cores in a violet halo), the warm accents over the dim, cool fill (`AREA_LIGHT.universe`).
 * - Light: `Lighting.setSolar` aims the shadow light from the heaviest node near the camera target.
 * - The CMB: a CSS overlay (`installCmb`, like fx/horizon.ts) above the canvas: a faint orange
 *   tint at the screen's edges, mottled like the microwave background, drifting slowly unless
 *   reduced motion is on.
 */
import { AdditiveBlending, Color, Group, Sprite, SpriteMaterial, type CanvasTexture, type Scene, type ShaderMaterial, type Vector3 } from 'three';
import { Rng } from '../core/rng';
import type { Run } from '../game/run';
import type { HouseLayout } from '../world/types';
import { universeWeb, type UniverseWeb } from '../world/universe';
import { radialTexture, starLayer, type StarLayer } from './galaxy';
import type { Lighting } from './lighting';

/** Galaxies on the web and in the deep field, the camera distance at which every point shows, the deep tile (units), and node glows. */
const SKY = { web: 38000, deep: 24000, ref: 30, deepTile: 640, deepDepth: 0.9, glows: 10, glowReach: 160 };

function gauss(rng: Rng): number {
  return Math.sqrt(-2 * Math.log(1 - rng.next())) * Math.cos(2 * Math.PI * rng.next());
}

/** Web galaxies: along the filaments, packed in the nodes, thin in the sheets, a few in the voids. */
function webGalaxies(layout: HouseLayout, web: UniverseWeb): StarLayer {
  const rng = new Rng(layout.seed).fork('universe:galaxies');
  const b = layout.bounds;
  const lw = web.links.map((l) => Math.hypot(web.nodes[l.b]!.x - web.nodes[l.a]!.x, web.nodes[l.b]!.z - web.nodes[l.a]!.z) * (0.3 + l.strength));
  const nw = web.nodes.map((n) => 0.3 + n.mass);
  const pick = (w: number[]) => {
    let t = rng.next() * w.reduce((s, v) => s + v, 0);
    for (let i = 0; i < w.length; i++) if ((t -= w[i]!) <= 0) return i;
    return w.length - 1;
  };
  const blue = new Color('#b8ccff');
  const white = new Color('#f2f4ff');
  const warm = new Color('#ffd49a');
  const pink = new Color('#ff9ad0');
  const ember = new Color('#ff9a6a');
  const c = new Color();
  return starLayer(
    SKY.web,
    (i, pos, col, size) => {
      const k = rng.next();
      let x: number;
      let z: number;
      let bright = rng.next();
      if (k < 0.74) {
        // Along a filament (most), or out in its sheet.
        const l = web.links[pick(lw)]!;
        const a = web.nodes[l.a]!;
        const e = web.nodes[l.b]!;
        const t = rng.next();
        const len = Math.hypot(e.x - a.x, e.z - a.z) || 1;
        const nx = -(e.z - a.z) / len;
        const nz = (e.x - a.x) / len;
        const sheet = k > 0.56;
        const off = sheet ? Math.sign(gauss(rng)) * (l.w + Math.abs(gauss(rng)) * 5) : gauss(rng) * l.w * 0.45;
        x = a.x + (e.x - a.x) * t + nx * off;
        z = a.z + (e.z - a.z) * t + nz * off;
        if (sheet) {
          bright *= 0.6;
          c.copy(blue).multiplyScalar(0.8);
        } else if (rng.next() < 0.04) c.copy(pink);
        else c.copy(blue).lerp(white, rng.next());
      } else if (k < 0.95) {
        // In a node: packed, warm.
        const n = web.nodes[pick(nw)]!;
        x = n.x + gauss(rng) * n.r * 0.45;
        z = n.z + gauss(rng) * n.r * 0.45;
        c.copy(warm).lerp(white, rng.next() * 0.5);
        bright = Math.max(bright, rng.next());
      } else {
        // A stray in a void.
        x = rng.range(b.minX - 60, b.maxX + 60);
        z = rng.range(b.minZ - 60, b.maxZ + 60);
        bright *= 0.5;
        c.copy(ember).lerp(blue, rng.next());
      }
      pos.set([x, 0.04, z], i * 3);
      const s = 0.5 + 0.9 * bright * bright;
      col.set([c.r * s, c.g * s, c.b * s], i * 3);
      size[i] = bright > 0.985 ? 5.5 : 1.5 + 2.6 * bright * bright;
    },
    false,
  );
}

/** Deep galaxies: faint, small, tinted (blue, violet, a little CMB orange), scattered over one tile. */
function deepGalaxies(seed: number): StarLayer {
  const rng = new Rng(seed).fork('universe:deep');
  const tints = ['#9ab0ff', '#c8a8ff', '#ffb890', '#e8ecff'].map((h) => new Color(h));
  return starLayer(
    SKY.deep,
    (i, pos, col, size) => {
      pos.set([rng.range(0, SKY.deepTile), 0, rng.range(0, SKY.deepTile)], i * 3);
      const c = tints[Math.floor(rng.next() * tints.length)]!;
      const b = 0.25 + 0.45 * rng.next() ** 2;
      col.set([c.r * b, c.g * b, c.b * b], i * 3);
      size[i] = 1.2 + 1.8 * rng.next() ** 3;
    },
    true,
    SKY.deepTile,
  );
}

/** Seeded mottle like the microwave background (warm and cool blotches) as a tileable PNG data URL. */
function cmbMottle(): string {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  if (!ctx) return '';
  const rng = new Rng('universe-cmb');
  for (let i = 0; i < 220; i++) {
    const warm = rng.next() < 0.6;
    const r = rng.range(8, 30);
    const a = rng.range(0.05, 0.16);
    const x = rng.range(0, S);
    const y = rng.range(0, S);
    for (const dx of [-S, 0, S]) {
      for (const dy of [-S, 0, S]) {
        const g = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
        g.addColorStop(0, warm ? `rgba(255,140,60,${a})` : `rgba(120,140,255,${a * 0.6})`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
      }
    }
  }
  return c.toDataURL('image/png');
}

/**
 * The CMB at the screen's edges: a CSS overlay above the canvas, below the UI (no GPU cost). A soft
 * orange tint deepening towards the corners, over a faint warm-and-cool mottle masked to the edges.
 * Hidden until `showCmb`.
 */
export function installCmb(container: HTMLElement): HTMLElement {
  let el = container.querySelector<HTMLElement>(':scope > .fx-cmb');
  if (!el) {
    el = document.createElement('div');
    el.className = 'fx-cmb';
    el.setAttribute('aria-hidden', 'true');
    const canvas = container.querySelector('canvas');
    if (canvas?.nextSibling) container.insertBefore(el, canvas.nextSibling);
    else container.append(el);
  }
  el.replaceChildren();
  const tint = document.createElement('div');
  Object.assign(tint.style, {
    position: 'absolute',
    inset: '0',
    background: 'radial-gradient(ellipse 80% 75% at 50% 50%, rgba(0,0,0,0) 52%, rgba(255,120,50,0.07) 72%, rgba(255,110,40,0.17) 90%, rgba(230,90,30,0.26) 100%)',
  } satisfies Partial<CSSStyleDeclaration>);
  const mottle = document.createElement('div');
  mottle.className = 'fx-cmb-mottle';
  const mask = 'radial-gradient(ellipse 80% 75% at 50% 50%, transparent 58%, #000 100%)';
  Object.assign(mottle.style, {
    position: 'absolute',
    inset: '0',
    backgroundImage: `url(${cmbMottle()})`,
    backgroundSize: '320px 320px',
    maskImage: mask,
    webkitMaskImage: mask,
  } satisfies Partial<CSSStyleDeclaration>);
  el.append(tint, mottle);
  Object.assign(el.style, { position: 'absolute', inset: '0', pointerEvents: 'none', display: 'none' } satisfies Partial<CSSStyleDeclaration>);
  return el;
}

/** Shows or hides the CMB overlay; its mottle drifts slowly unless `reducedMotion`. */
export function showCmb(el: HTMLElement, on: boolean, reducedMotion: boolean): void {
  el.style.display = on ? 'block' : 'none';
  const mottle = el.querySelector<HTMLElement>('.fx-cmb-mottle');
  if (!mottle || typeof mottle.animate !== 'function') return;
  for (const a of mottle.getAnimations()) a.cancel();
  if (on && !reducedMotion) mottle.animate([{ backgroundPosition: '0px 0px' }, { backgroundPosition: '320px 160px' }], { duration: 90000, iterations: Infinity });
}

export class UniverseSky {
  readonly root = new Group();
  private web: StarLayer | null = null;
  private deep: StarLayer | null = null;
  private readonly glows: Sprite[] = [];
  private readonly glowTex: CanvasTexture;
  private run: Run | null = null;
  private time = 0;

  constructor(
    scene: Scene,
    private readonly lighting: Lighting,
  ) {
    this.root.name = 'universeSky';
    this.root.visible = false;
    // A warm gold core in a violet halo (a supercluster's hot gas).
    this.glowTex = radialTexture([[0, 'rgba(255,236,200,0.65)'], [0.12, 'rgba(255,206,140,0.4)'], [0.35, 'rgba(230,120,170,0.12)'], [0.7, 'rgba(140,90,200,0.04)'], [1, 'rgba(80,60,140,0)']]);
    for (let i = 0; i < SKY.glows; i++) {
      const s = new Sprite(new SpriteMaterial({ map: this.glowTex, transparent: true, opacity: 0.6, blending: AdditiveBlending, depthWrite: false, fog: false }));
      s.renderOrder = 2;
      s.visible = false;
      this.glows.push(s);
      this.root.add(s);
    }
    scene.add(this.root);
  }

  /** The Run (or its Area) changed: show or hide, and rebuild the galaxies. */
  attach(run: Run | null): void {
    this.run = run;
    const on = run?.area === 'universe';
    this.root.visible = on;
    for (const layer of [this.web, this.deep]) {
      if (!layer) continue;
      layer.points.removeFromParent();
      layer.points.geometry.dispose();
      (layer.points.material as ShaderMaterial).dispose();
    }
    this.web = this.deep = null;
    if (!on || !run) return;
    const web = universeWeb(run.house.seed);
    this.web = webGalaxies(run.house, web);
    this.deep = deepGalaxies(run.house.seed);
    this.root.add(this.web.points, this.deep.points);
    this.lighting.setSolar(null);
  }

  /** Per rendered frame (after the view): `camDistance` is the camera rig's distance, `target` its target. */
  update(dt: number, camDistance: number, target: { x: number; z: number }, pixelRatio: number): void {
    const run = this.run;
    if (!run || !this.root.visible) return;
    this.time += dt;
    const web = universeWeb(run.house.seed);
    // The node glows on the nodes nearest the camera target; the light from the heaviest one near it.
    const reach = Math.max(SKY.glowReach, camDistance * 3);
    const near = web.nodes
      .map((n) => ({ n, d: Math.hypot(n.x - target.x, n.z - target.z) }))
      .filter((e) => e.d < reach)
      .sort((p, q) => p.d - q.d)
      .slice(0, SKY.glows);
    for (let i = 0; i < this.glows.length; i++) {
      const s = this.glows[i]!;
      const e = near[i];
      s.visible = !!e;
      if (!e) continue;
      const flicker = 1 + Math.sin(this.time * 1.7 + i * 2.1) * 0.04;
      s.position.set(e.n.x, 0.6, e.n.z);
      s.scale.setScalar(e.n.r * (3.2 + 2 * e.n.mass) * flicker);
      (s.material as SpriteMaterial).opacity = 0.35 + 0.4 * e.n.mass;
    }
    let key: { x: number; z: number } | null = null;
    let best = -Infinity;
    for (const e of near) {
      const score = e.n.mass * 2 - e.d / Math.max(40, camDistance * 2);
      if (score > best) {
        best = score;
        key = e.n;
      }
    }
    this.lighting.setSolar(key);
    const keep = Math.min(1, Math.max(0.012, (SKY.ref / Math.max(camDistance, 1)) ** 2));
    for (const layer of [this.web, this.deep]) {
      if (!layer) continue;
      layer.uniforms.uKeep!.value = keep;
      layer.uniforms.uPixelRatio!.value = pixelRatio;
      layer.uniforms.uTime!.value = this.time;
    }
    if (this.deep) {
      this.deep.points.position.y = -camDistance * SKY.deepDepth;
      (this.deep.uniforms.uCenter!.value as Vector3).set(target.x, 0, target.z);
    }
  }
}
