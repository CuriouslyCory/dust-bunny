/**
 * The Galaxy's sky (browser only): Sagittarius A* waiting at the centre, the core's glow, the
 * light from the core, and the instanced starfield. One instance per Game (`Game.galaxySky`),
 * shown only while the Run is in the Galaxy.
 *
 * - Sagittarius A*: the `sagittarius_a` model (its Blender mesh when loaded, else a dark ball in a
 *   hot ring) sits at `galacticCentre(layout)` with its `disk` turning, until the boss arrives;
 *   while the boss (a Hazard with `def.id === 'sagittarius_a'`) is alive the centre one is gone and
 *   the glow and the light follow the boss; once it is absorbed the centre stays empty.
 * - Glow: two additive sprites over the centre, a hot core and a wide soft bloom that grows with
 *   the camera distance so the core reads from anywhere on the map. No post-processing.
 * - Light: `Lighting.setSolar` aims the shadow-casting light from the core (warm, dim) at the
 *   camera target; the Area's fill is a dim cool blue-magenta (lighting.ts).
 * - Stars as instanced points (one draw call each), a few pixels wide at any zoom, twinkling:
 *   `disc` stars lie on the floor, crowded in the arms, the bulge and the bar (the same spiral as
 *   the painted floor), blue-white in the arms and warm in the core; `deep` stars lie far below the
 *   disc (at 0.9 × the camera distance, drawn over the floor and under everything else, tiled round
 *   the camera), so they slide by slower than the floor when the Bunny moves: the disc floats over
 *   deep space. Both thin out as the camera pulls back (a point shows while its rank is under
 *   (`REF` / camera distance)²), so the count on screen stays about the same at every Tier.
 */
import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  Color,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  Points,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  TorusGeometry,
  Vector3,
  type Object3D,
  type Scene,
} from 'three';
import { Rng } from '../core/rng';
import type { Run } from '../game/run';
import type { RunView } from '../game/runView';
import { GALAXY, armDensity, barAngleFor, galacticCentre } from '../world/galaxy';
import type { HouseLayout } from '../world/types';
import { createModel, hasModelOverride } from '../world/models';
import type { Lighting } from './lighting';

/** Sagittarius A* at the centre (units): footprint radius and height of the model (its disc's reach). */
const HOLE = { footprint: 3.2, height: 5.4 };
/** Starfield: points on the disc and in the deep field, the camera distance at which every point shows, and the deep field's tile (units). */
const STARS = { disc: 42000, deep: 26000, ref: 30, deepTile: 640, deepDepth: 0.9 };

export function radialTexture(stops: ReadonlyArray<readonly [number, string]>): CanvasTexture {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  for (const [t, col] of stops) g.addColorStop(t, col);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** The procedural Sagittarius A* (no GLB): a black ball in a hot ring. */
function proceduralHole(): Group {
  const g = new Group();
  const ball = new Mesh(new SphereGeometry(1, 32, 16), new MeshBasicMaterial({ color: '#000000' }));
  ball.position.y = 1.5;
  const disk = new Mesh(new TorusGeometry(2.2, 0.6, 8, 64), new MeshBasicMaterial({ color: '#ffb066', transparent: true, opacity: 0.7, blending: AdditiveBlending, depthWrite: false }));
  disk.rotation.x = Math.PI / 2;
  disk.scale.z = 0.15;
  disk.position.y = 1.5;
  disk.name = 'disk';
  g.add(ball, disk);
  return g;
}

const STAR_VERT = /* glsl */ `
attribute float aRank;
attribute float aSize;
attribute vec3 aColor;
uniform float uKeep;
uniform float uPixelRatio;
uniform float uTime;
uniform vec3 uCenter;
uniform float uTile;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec3 p = position;
  if (uTile > 0.0) {
    // Tiled round the camera target: always within half a tile of it.
    p.xz = uCenter.xz + mod(p.xz - uCenter.xz + 0.5 * uTile, uTile) - 0.5 * uTile;
  }
  float fade = clamp((uKeep - aRank) / max(uKeep * 0.3, 1e-4), 0.0, 1.0);
  vAlpha = fade * (0.72 + 0.28 * sin(uTime * (1.3 + aRank * 4.0) + aRank * 731.0));
  vColor = aColor;
  gl_PointSize = fade > 0.0 ? aSize * uPixelRatio : 0.0;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

const STAR_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float d = dot(q, q);
  if (d > 1.0) discard;
  float core = exp(-d * 9.0);
  float halo = (1.0 - d) * 0.35;
  gl_FragColor = vec4(vColor * (core + halo) * vAlpha, 1.0);
}`;

export interface StarLayer {
  points: Points;
  uniforms: Record<string, { value: unknown }>;
}

/** Instanced points (the Galaxy's stars, the Universe's galaxies): `deep` layers are tiled round the camera target every `tile` units. */
export function starLayer(n: number, fill: (i: number, pos: Float32Array, col: Float32Array, size: Float32Array) => void, deep: boolean, tile = STARS.deepTile): StarLayer {
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const size = new Float32Array(n);
  const rank = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    fill(i, pos, col, size);
    rank[i] = ((i * 0.6180339887) % 1) * 0.999;
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('aColor', new Float32BufferAttribute(col, 3));
  geo.setAttribute('aSize', new Float32BufferAttribute(size, 1));
  geo.setAttribute('aRank', new Float32BufferAttribute(rank, 1));
  const uniforms = {
    uKeep: { value: 1 },
    uPixelRatio: { value: 1 },
    uTime: { value: 0 },
    uCenter: { value: new Vector3() },
    uTile: { value: deep ? tile : 0 },
  };
  const mat = new ShaderMaterial({
    uniforms,
    vertexShader: STAR_VERT,
    fragmentShader: STAR_FRAG,
    blending: AdditiveBlending,
    depthWrite: false,
    // The deep field is drawn straight after the floor (renderOrder −2) and under everything else.
    depthTest: !deep,
    transparent: !deep,
  });
  const points = new Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = deep ? -1 : 1;
  points.name = deep ? 'deepStars' : 'discStars';
  return { points, uniforms };
}

/** Disc stars: crowded in the arms, the bulge and the bar; blue-white in the arms, warm in the core. */
function discStars(layout: HouseLayout): StarLayer {
  const rng = new Rng(layout.seed).fork('galaxy:stars');
  const c0 = galacticCentre(layout);
  const barAngle = barAngleFor(layout.seed);
  const bc = Math.cos(barAngle);
  const bs = Math.sin(barAngle);
  const G = GALAXY;
  const R = G.disc + 30;
  const warm = new Color('#ffd49a');
  const blue = new Color('#b8ccff');
  const white = new Color('#f2f4ff');
  const red = new Color('#ff9a7a');
  const c = new Color();
  return starLayer(
    STARS.disc,
    (i, pos, col, size) => {
      let x = 0;
      let z = 0;
      let bulge = 0;
      let arm = 0;
      for (let t = 0; t < 60; t++) {
        const d = R * Math.sqrt(rng.next());
        const a = rng.range(-Math.PI, Math.PI);
        x = Math.cos(a) * d;
        z = Math.sin(a) * d;
        const along = x * bc + z * bs;
        const across = -x * bs + z * bc;
        bulge = Math.exp(-((d / 20) ** 2)) + 0.6 * Math.exp(-((along / G.barLength) ** 2) - (across / G.barWidth) ** 2);
        arm = d > G.core * 0.7 && d < G.disc + 10 ? armDensity(d, a, barAngle) * Math.exp(-d / 160) : 0;
        const w = 0.1 + 0.25 * Math.exp(-d / 90) + 0.85 * arm + 1.6 * bulge;
        if (rng.next() * 2.2 < w) break;
      }
      pos.set([c0.x + x, 0.04, c0.z + z], i * 3);
      const k = rng.next();
      if (bulge > 0.3 && k < 0.8) c.copy(warm);
      else if (k < 0.06) c.copy(red);
      else c.copy(blue).lerp(white, rng.next());
      const bright = rng.next();
      const b = 0.55 + 0.9 * bright * bright;
      col.set([c.r * b, c.g * b, c.b * b], i * 3);
      size[i] = bright > 0.985 ? 5.5 : 1.6 + 2.4 * bright * bright;
    },
    false,
  );
}

/** Deep stars: faint, small, a few nebula tints, scattered evenly over one tile. */
function deepStars(seed: number): StarLayer {
  const rng = new Rng(seed).fork('galaxy:deep');
  const tints = ['#9ab0ff', '#c8a8ff', '#ffb8e8', '#e8ecff'].map((h) => new Color(h));
  return starLayer(
    STARS.deep,
    (i, pos, col, size) => {
      pos.set([rng.range(0, STARS.deepTile), 0, rng.range(0, STARS.deepTile)], i * 3);
      const c = tints[Math.floor(rng.next() * tints.length)]!;
      const b = 0.3 + 0.5 * rng.next() ** 2;
      col.set([c.r * b, c.g * b, c.b * b], i * 3);
      size[i] = 1.2 + 1.8 * rng.next() ** 3;
    },
    true,
  );
}

export class GalaxySky {
  readonly root = new Group();
  private hole: Object3D | null = null;
  private holeDisk: Object3D | null = null;
  private readonly core: Sprite;
  private readonly bloom: Sprite;
  private disc: StarLayer | null = null;
  private deep: StarLayer | null = null;
  private run: Run | null = null;
  private time = 0;

  constructor(
    scene: Scene,
    private readonly lighting: Lighting,
  ) {
    this.root.name = 'galaxySky';
    this.root.visible = false;
    const sprite = (tex: CanvasTexture, opacity: number) => {
      const s = new Sprite(new SpriteMaterial({ map: tex, transparent: true, opacity, blending: AdditiveBlending, depthWrite: false, depthTest: false, fog: false }));
      s.renderOrder = 10;
      return s;
    };
    // The core: a hot halo round the hole (its middle stays dark), and a wide warm bloom over the bulge.
    this.core = sprite(radialTexture([[0, 'rgba(255,240,220,0)'], [0.22, 'rgba(255,226,180,0.05)'], [0.32, 'rgba(255,214,150,0.55)'], [0.45, 'rgba(255,150,90,0.22)'], [0.7, 'rgba(200,90,160,0.06)'], [1, 'rgba(120,60,140,0)']]), 0.85);
    this.bloom = sprite(radialTexture([[0, 'rgba(255,214,160,0.3)'], [0.2, 'rgba(255,180,130,0.16)'], [0.5, 'rgba(190,110,170,0.06)'], [1, 'rgba(90,60,140,0)']]), 0.7);
    this.root.add(this.core, this.bloom);
    scene.add(this.root);
  }

  /** The Run (or its Area) changed: show or hide, and rebuild the centre and the stars. */
  attach(run: Run | null): void {
    this.run = run;
    const on = run?.area === 'galaxy';
    this.root.visible = on;
    for (const layer of [this.disc, this.deep]) {
      if (!layer) continue;
      layer.points.removeFromParent();
      layer.points.geometry.dispose();
      (layer.points.material as ShaderMaterial).dispose();
    }
    this.disc = this.deep = null;
    if (this.hole) {
      this.root.remove(this.hole);
      this.hole = this.holeDisk = null;
    }
    if (!on || !run) return;
    const c = galacticCentre(run.house);
    const hole = hasModelOverride('sagittarius_a') ? createModel('sagittarius_a', { w: HOLE.footprint * 2, d: HOLE.footprint * 2, h: HOLE.height }) : proceduralHole();
    hole.position.set(c.x, 0, c.z);
    hole.traverse((o) => {
      o.castShadow = false;
      o.receiveShadow = false;
    });
    this.hole = hole;
    this.holeDisk = hole.getObjectByName('disk') ?? null;
    this.root.add(hole);
    this.disc = discStars(run.house);
    this.deep = deepStars(run.house.seed);
    this.root.add(this.disc.points, this.deep.points);
    this.lighting.setSolar(c);
  }

  /** Per rendered frame (after the view): `camDistance` is the camera rig's distance, `target` its target. */
  update(dt: number, _view: RunView | null, camDistance: number, target: { x: number; z: number }, pixelRatio: number): void {
    const run = this.run;
    if (!run || !this.root.visible) return;
    this.time += dt;
    const boss = run.hazards.hazards.find((h) => h.def.id === 'sagittarius_a' && !h.dead);
    const c = galacticCentre(run.house);
    const at = boss ? { x: boss.x, z: boss.z } : c;
    const gone = run.isAreaCleared('galaxy') && !boss;
    const size = boss ? Math.max(1, boss.size) : HOLE.footprint * 0.6;
    if (this.hole) this.hole.visible = !boss && !run.isAreaCleared('galaxy');
    if (this.holeDisk) this.holeDisk.rotation.y += dt * 0.35;
    this.lighting.setSolar(at);
    const flicker = 1 + Math.sin(this.time * 2.3) * 0.03 + Math.sin(this.time * 5.9) * 0.015;
    this.core.position.set(at.x, size * 0.9, at.z);
    this.core.scale.setScalar(size * 6 * flicker);
    this.bloom.position.set(c.x, 2, c.z);
    this.bloom.scale.setScalar(Math.max(GALAXY.core * 7, camDistance * 1.1));
    (this.core.material as SpriteMaterial).opacity = gone ? 0 : 0.85;
    (this.bloom.material as SpriteMaterial).opacity = 0.55;
    const keep = Math.min(1, Math.max(0.012, (STARS.ref / Math.max(camDistance, 1)) ** 2));
    for (const layer of [this.disc, this.deep]) {
      if (!layer) continue;
      layer.uniforms.uKeep!.value = keep;
      layer.uniforms.uPixelRatio!.value = pixelRatio;
      layer.uniforms.uTime!.value = this.time;
    }
    if (this.deep) {
      this.deep.points.position.y = -camDistance * STARS.deepDepth;
      // The tile is centred on the camera target (in the layer's own frame: it only moves in y).
      (this.deep.uniforms.uCenter!.value as Vector3).set(target.x, 0, target.z);
    }
  }
}
