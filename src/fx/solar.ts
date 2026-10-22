/**
 * The Solar System's sky (browser only): the Sun at the centre of the map, its glare, where the
 * light comes from, Jupiter's lock ring and the light going out. One instance per Game
 * (`Game.solarSky`), shown only while the Run is in the Solar System.
 *
 * - The Sun: the `the_sun` model (its Blender mesh when loaded, else a procedural ball) sits at
 *   `sunCentre(layout)` with its `corona` spinning, until the boss arrives; while the boss (a
 *   Hazard with `def.id === 'the_sun'`) is alive the centre Sun is gone and the glare and the light
 *   follow the boss.
 * - Glare ("lens bloom"): two additive sprites over the Sun, a hot core and a wide soft bloom that
 *   grows with the camera distance so it reads at every zoom. No post-processing.
 * - Light: `Lighting.setSolar` aims the shadow-casting light from the Sun at the camera target.
 * - Jupiter (`lockedUntilTier: 17`): a dashed amber ring turns slowly round it while it is an
 *   Obstacle (before Tier 17, or still too big), and turns green and pulses once the Bunny can
 *   absorb it; toasts say when it stops being an Obstacle and when it can be absorbed.
 * - The light goes out (`run.solarSystemCleared`): over `OUT_SECONDS` the Sun's glare, every light,
 *   the painted floor and the orbit lanes fade to near black and the Bunny's plasma flares
 *   (`BunnyView.plasmaBoost`), so only the Bunny's own glow is left, under the narrator's cleared
 *   line. Game holds the results screen back for `VICTORY_HOLD_SECONDS` so the moment is seen.
 */
import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  SphereGeometry,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  TorusGeometry,
  type Object3D,
  type Scene,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Debris } from '../entities/debris';
import type { Run } from '../game/run';
import type { RunView } from '../game/runView';
import type { Hud } from '../ui/hud';
import { captionDuration, narrate, storyCaption } from '../story';
import { canAbsorbDebris, debrisLocked } from '../systems/absorb';
import { createModel, hasModelOverride } from '../world/models';
import { sunCentre } from '../world/solarSystem';
import type { Lighting } from './lighting';

/** The centre Sun's size (units): the boss model's (sphere radius 2.7, squashed to 0.7 in Y). */
const SUN = { radius: 2.7, squash: 0.7, footprint: 2.94, height: 3.79 };
/** Seconds for the light to go out, and how long the results screen waits after the Sun is absorbed. */
export const OUT_SECONDS = 1.8;
export const VICTORY_HOLD_SECONDS = 3.2;
const LOCKED = new Color('#ffb347');
const OPEN = new Color('#5cff8a');

function radialTexture(stops: ReadonlyArray<readonly [number, string]>): CanvasTexture {
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

/** Granulated photosphere for the procedural Sun. */
function granuleTexture(): CanvasTexture {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffc24a';
  ctx.fillRect(0, 0, S, S);
  let s = 0x50f1;
  const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (let i = 0; i < 900; i++) {
    const r = 3 + rnd() * 7;
    ctx.fillStyle = rnd() > 0.5 ? `rgba(255,236,150,${0.25 + rnd() * 0.4})` : `rgba(226,120,30,${0.2 + rnd() * 0.35})`;
    ctx.beginPath();
    ctx.arc(rnd() * S, rnd() * S, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** The procedural Sun (no GLB): a squashed glowing ball with a flame ring. */
function proceduralSun(): Group {
  const g = new Group();
  const ball = new Mesh(new SphereGeometry(SUN.radius, 48, 24), new MeshBasicMaterial({ map: granuleTexture(), color: '#ffe0a0' }));
  ball.scale.y = SUN.squash;
  ball.position.y = SUN.radius * SUN.squash;
  const corona = new Mesh(new TorusGeometry(SUN.radius * 1.02, 0.28, 8, 48), new MeshBasicMaterial({ color: '#ff9a2e', transparent: true, opacity: 0.8, blending: AdditiveBlending, depthWrite: false }));
  corona.rotation.x = Math.PI / 2;
  corona.position.y = SUN.radius * SUN.squash;
  corona.name = 'corona';
  g.add(ball, corona);
  return g;
}

/** A dashed ring on the floor (unit radius), one mesh. */
function dashedRing(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const n = 18;
  for (let i = 0; i < n; i++) parts.push(new RingGeometry(1.12, 1.24, 6, 1, (i / n) * Math.PI * 2, (Math.PI * 2 * 0.6) / n));
  const g = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  g.rotateX(-Math.PI / 2);
  return g;
}

export class SolarSky {
  readonly root = new Group();
  private sun: Object3D | null = null;
  private sunCorona: Object3D | null = null;
  private readonly core: Sprite;
  private readonly bloom: Sprite;
  private readonly ring: Mesh;
  private readonly ringMat: MeshBasicMaterial;
  private run: Run | null = null;
  private jupiter: Debris | null = null;
  private jupiterState: 'locked' | 'unlocked' | 'open' | null = null;
  private outT = 0;
  private time = 0;

  constructor(
    scene: Scene,
    private readonly lighting: Lighting,
    private readonly hud: Hud,
  ) {
    this.root.name = 'solarSky';
    this.root.visible = false;
    const sprite = (tex: CanvasTexture, opacity: number) => {
      const s = new Sprite(new SpriteMaterial({ map: tex, transparent: true, opacity, blending: AdditiveBlending, depthWrite: false, depthTest: false, fog: false }));
      s.renderOrder = 10;
      return s;
    };
    // The core glare is a halo round the limb (the ball is 0.38 of its radius), so the Sun's face still shows.
    this.core = sprite(radialTexture([[0, 'rgba(255,250,230,0.12)'], [0.28, 'rgba(255,236,190,0.22)'], [0.38, 'rgba(255,214,140,0.75)'], [0.5, 'rgba(255,160,70,0.3)'], [0.75, 'rgba(255,120,40,0.08)'], [1, 'rgba(255,100,30,0)']]), 0.9);
    this.bloom = sprite(radialTexture([[0, 'rgba(255,220,150,0.35)'], [0.25, 'rgba(255,170,90,0.2)'], [0.6, 'rgba(200,110,60,0.06)'], [1, 'rgba(120,60,40,0)']]), 0.8);
    this.ringMat = new MeshBasicMaterial({ color: LOCKED, transparent: true, opacity: 0.55, blending: AdditiveBlending, depthWrite: false, fog: false });
    this.ring = new Mesh(dashedRing(), this.ringMat);
    this.ring.renderOrder = 2;
    this.root.add(this.core, this.bloom, this.ring);
    scene.add(this.root);
  }

  /** The Run (or its Area) changed: show or hide, and rebuild the centre Sun. */
  attach(run: Run | null): void {
    this.run = run;
    const on = run?.area === 'solar_system';
    this.root.visible = on;
    this.outT = 0;
    this.jupiter = null;
    this.jupiterState = null;
    if (this.sun) {
      this.root.remove(this.sun);
      this.sun = null;
      this.sunCorona = null;
    }
    if (!on || !run) {
      this.lighting.setSolar(null);
      return;
    }
    const c = sunCentre(run.house);
    const sun = hasModelOverride('the_sun') ? createModel('the_sun', { w: SUN.footprint * 2, d: SUN.footprint * 2, h: SUN.height }) : proceduralSun();
    sun.position.set(c.x, 0, c.z);
    sun.traverse((o) => {
      o.castShadow = false;
      o.receiveShadow = false;
    });
    this.sun = sun;
    this.sunCorona = sun.getObjectByName('corona') ?? null;
    this.root.add(sun);
    run.debris.forEach((d) => {
      if (d.type.id === 'jupiter') this.jupiter = d;
    });
    this.lighting.setSolar(c);
  }

  /** Per rendered frame (after the view): `camDistance` is the camera rig's distance. */
  update(dt: number, view: RunView | null, camDistance: number): void {
    const run = this.run;
    if (!run || !this.root.visible || !this.sun) return;
    this.time += dt;
    // The light goes out once the Sun is absorbed.
    if (run.solarSystemCleared) {
      if (this.outT === 0) {
        // The narrator's cleared line over the dark (the results screen repeats it).
        const line = narrate(run, { kind: 'cleared', area: 'solar_system' });
        const caption = line ? storyCaption(line) : undefined;
        this.hud.banner('The Sun is yours', { variant: 'good', duration: Math.min(VICTORY_HOLD_SECONDS, caption ? captionDuration(caption) : 3), caption });
      }
      this.outT = Math.min(1, this.outT + Math.max(dt, 1e-4) / OUT_SECONDS);
    }
    const out = this.outT * this.outT * (3 - 2 * this.outT);
    const lit = 1 - out;

    // Where the light is: the boss while it is alive, else the centre Sun (gone once absorbed).
    const boss = run.hazards.hazards.find((h) => h.def.id === 'the_sun' && !h.dead);
    const c = sunCentre(run.house);
    const at = boss ? { x: boss.x, z: boss.z } : c;
    const size = boss ? Math.max(1, boss.size) : SUN.radius;
    this.sun.visible = !boss && !run.solarSystemCleared;
    if (this.sunCorona) this.sunCorona.rotation.y += dt * 0.25;
    this.lighting.setSolar(at);
    this.lighting.setLit(lit);
    const flicker = 1 + Math.sin(this.time * 3.1) * 0.04 + Math.sin(this.time * 7.7) * 0.02;
    const y = size * SUN.squash;
    this.core.position.set(at.x, y, at.z);
    this.core.scale.setScalar(size * 5.2 * flicker);
    this.bloom.position.set(at.x, y, at.z);
    this.bloom.scale.setScalar(Math.max(size * 16, camDistance * 1.3));
    (this.core.material as SpriteMaterial).opacity = 0.9 * lit;
    (this.bloom.material as SpriteMaterial).opacity = 0.8 * lit;
    view?.house.solar?.setDim(lit);
    if (view) view.bunny.plasmaBoost = out;

    this.updateJupiter(run);
  }

  private updateJupiter(run: Run): void {
    const j = this.jupiter;
    if (!j || !j.alive) {
      this.ring.visible = false;
      return;
    }
    const b = run.bunny;
    const state = debrisLocked(b, j) ? 'locked' : canAbsorbDebris(b, j) ? 'open' : 'unlocked';
    if (state !== this.jupiterState) {
      if (this.jupiterState === 'locked' && state === 'unlocked') this.hud.toast('Jupiter is no longer an Obstacle: grow a little more', { key: 'jupiter-unlocked', tone: 'info' });
      if (this.jupiterState !== null && state === 'open') this.hud.toast('Jupiter can be absorbed now', { key: 'jupiter-open', tone: 'good' });
      this.jupiterState = state;
      this.ringMat.color.copy(state === 'open' ? OPEN : LOCKED);
    }
    const pulse = state === 'open' ? 1 + Math.sin(this.time * 6) * 0.06 : 1;
    this.ring.visible = true;
    this.ring.position.set(j.x, 0.05, j.z);
    this.ring.scale.setScalar(j.size * pulse);
    this.ring.rotation.y = this.time * (state === 'open' ? 0.6 : 0.15);
    this.ringMat.opacity = state === 'locked' ? 0.45 : state === 'unlocked' ? 0.6 : 0.85;
  }
}
