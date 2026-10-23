/**
 * Boss intro card (Run paused): the boss arrives. Its model turns slowly on a dark stage above its
 * name, a description saying how to fight it (src/data/bossIntros.ts), the narrator's boss line
 * (story captions on) and how many hits break it. It closes itself after its reading time
 * (`bossIntroHold`, counted in frame time, so a hidden tab never skips it), shown as a draining
 * bar; a click / tap, the button or Enter / Space / Esc close it sooner. Then play (or the waiting
 * Perk draft) resumes and the HUD flashes its boss-alert vignette.
 *
 * `showBossIntro` is called by the HUD on bossSpawned (src/ui/hud.ts). It opens only over play;
 * while another screen is up (Perk draft, chapter card, pause) it checks again every RETRY s.
 *
 * Rendering: one small WebGLRenderer on the card's own canvas, created the first time a card opens
 * and reused (never more than this one extra context). The model is a createModel clone: a GLB's
 * geometry and materials are shared with the game, so only a procedural fallback's (fresh)
 * geometry is disposed when the card closes; materials are always shared caches.
 */
import { ACESFilmicToneMapping, Box3, Color, DirectionalLight, Group, HemisphereLight, type Mesh, type Object3D, PerspectiveCamera, Scene, SRGBColorSpace, Vector3, WebGLRenderer } from 'three';
import { BOSS_INTROS, bossArea, bossHitsLine, bossIntroHold } from '../../data/bossIntros';
import { getQuality } from '../../fx/quality';
import type { Game } from '../../game/game';
import type { Run } from '../../game/run';
import { hazardRegistry } from '../../hazards';
import { HAZARD_MODEL_SIZES, type HazardModelId } from '../../hazards/models';
import { captions, narrate } from '../../story';
import { createModel, hasModelOverride } from '../../world/models';
import { button, isKey } from '../components';
import { h, registerScreen, screenRegistry } from '../screens';
import { settings } from '../settings';
import '../roguelike.css';
import '../bossIntro.css';

const ID = 'bossIntro';
/** Input is ignored this long after the card opens (a Dash or click meant for play). */
const ARM_DELAY = 0.6;
/** Seconds between checks while another screen is up. */
const RETRY = 0.25;
/** Seconds the HUD's boss-alert vignette pulses after the card closes (hud.css: 0.8 s × 4). */
const ALERT_TIME = 3.2;
/** Turn rate of the model (rad/s); reduced motion holds it still at its three-quarter view. */
const SPIN = 0.45;
const START_YAW = -0.6;
const FOV = 30;

export interface BossIntroParams {
  defId: string;
  name: string;
  modelId?: string;
  description: string;
  hits: string;
  /** Narrator captions shown under the description (empty: story off or nothing to say). */
  narrator: string[];
  color: string;
  /** Seconds before the card closes itself. */
  hold: number;
}

/** The card's content for boss `defId` in this Run. */
export function bossIntroParams(run: Run, defId: string, name?: string): BossIntroParams {
  const def = hazardRegistry.get(defId);
  const bossName = name ?? def?.name ?? 'Area boss';
  const intro = BOSS_INTROS[defId];
  const description = intro?.description ?? '';
  const line = narrate(run, { kind: 'boss', area: bossArea(defId) ?? run.area });
  const narrator = line ? captions(line) : [];
  return {
    defId,
    name: bossName,
    modelId: def?.modelId,
    description,
    hits: bossHitsLine(defId),
    narrator,
    color: intro?.color ?? '#e24b3b',
    hold: bossIntroHold(bossName, description, narrator),
  };
}

/**
 * Opens the intro card for the boss that just arrived (`hazardId` from bossSpawned, or `defId`
 * from a bare hazardSpawned), as soon as play is on screen. Gives up if the Run ends or the boss
 * is gone by then.
 */
export function showBossIntro(game: Game, boss: { hazardId?: number; defId?: string; name?: string }): void {
  const run = game.run;
  if (!run || !screenRegistry.has(ID)) return;
  const hazard = boss.hazardId !== undefined ? run.hazards.hazards.find((hz) => hz.id === boss.hazardId) : undefined;
  const defId = hazard?.def.id ?? boss.defId;
  if (!defId) return;
  const params = bossIntroParams(run, defId, boss.name);
  const attempt = (): void => {
    if (game.run !== run || run.ended || hazard?.dead) return;
    if (game.screens.current?.id === 'playing') game.go(ID, params);
    else window.setTimeout(attempt, RETRY * 1000);
  };
  attempt();
}

/** Restarts the HUD's red boss vignette pulse. */
function flashBossAlert(game: Game): void {
  const el = game.hud.el;
  el.classList.remove('boss-alert');
  void el.offsetWidth; // restart the animation
  el.classList.add('boss-alert');
  window.setTimeout(() => el.classList.remove('boss-alert'), ALERT_TIME * 1000);
}

/** The card's 3D stage: one renderer, a lit scene and a turntable for the boss model. */
class BossStage {
  private renderer: WebGLRenderer | null = null;
  private failed = false;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(FOV, 1, 0.01, 100);
  private readonly turntable = new Group();
  private model: Object3D | null = null;
  private disposeGeometry = false;
  /** Model extents for framing: horizontal sweep radius and height. */
  private sweep = 1;
  private height = 1;
  private elevation = 0.35;
  private width = 0;
  private heightPx = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.scene.add(this.turntable);
    this.scene.add(new HemisphereLight(0xdfe8ff, 0x2a1d17, 1.4));
    const key = new DirectionalLight(0xfff1dc, 2.6);
    key.position.set(3, 5, 4);
    const rim = new DirectionalLight(0xff8a6a, 2.2);
    rim.position.set(-4, 2.5, -4);
    const fill = new DirectionalLight(0x9fb8ff, 0.7);
    fill.position.set(-3, 1, 3);
    this.scene.add(key, rim, fill);
  }

  /** False when WebGL is unavailable (the card then shows no model). */
  private ensureRenderer(): boolean {
    if (this.renderer) return true;
    if (this.failed) return false;
    try {
      const r = new WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
      r.outputColorSpace = SRGBColorSpace;
      r.toneMapping = ACESFilmicToneMapping;
      r.toneMappingExposure = 1.15;
      r.setClearColor(new Color(0x000000), 0);
      this.renderer = r;
      return true;
    } catch {
      this.failed = true;
      return false;
    }
  }

  /** Puts boss model `modelId` on the turntable, framed by its bounds. */
  show(modelId: string | undefined): boolean {
    this.clear();
    if (!modelId || !this.ensureRenderer()) return false;
    const sizes = HAZARD_MODEL_SIZES[modelId as HazardModelId];
    const model = createModel(modelId, sizes ? { ...sizes } : { w: 1, d: 1, h: 1 });
    // A procedural fallback builds fresh geometry for each call; a GLB clone shares the game's.
    this.disposeGeometry = !hasModelOverride(modelId);
    model.updateMatrixWorld(true);
    const box = new Box3().setFromObject(model);
    if (box.isEmpty()) box.set(new Vector3(-1, 0, -1), new Vector3(1, 1, 1));
    const centre = box.getCenter(new Vector3());
    const size = box.getSize(new Vector3());
    model.position.sub(centre);
    this.sweep = Math.max(1e-3, Math.hypot(size.x, size.z) / 2);
    this.height = size.y;
    // Flat bosses (the Ice Sheet, the Expansion's lattice) are seen from higher up.
    this.elevation = size.y < 0.35 * Math.max(size.x, size.z) ? 0.62 : 0.3;
    this.model = model;
    this.turntable.rotation.y = START_YAW;
    this.turntable.add(model);
    this.width = 0; // re-frame on the next render
    return true;
  }

  private frame(aspect: number): void {
    const v = (FOV * Math.PI) / 360;
    const hf = Math.atan(Math.tan(v) * aspect);
    const e = this.elevation;
    const r = Math.hypot(this.sweep, this.height / 2);
    const across = this.sweep / Math.sin(hf);
    const up = (this.sweep * Math.sin(e) + (this.height / 2) * Math.cos(e)) / Math.tan(v) + this.sweep * Math.cos(e);
    const d = Math.max(across, up);
    this.camera.aspect = aspect;
    this.camera.near = Math.max(1e-3, d - r * 2);
    this.camera.far = d + r * 2;
    this.camera.position.set(0, d * Math.sin(e), d * Math.cos(e));
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();
  }

  render(dt: number): void {
    const r = this.renderer;
    if (!r || !this.model) return;
    const w = this.canvas.clientWidth;
    const hPx = this.canvas.clientHeight;
    if (w <= 0 || hPx <= 0) return;
    if (w !== this.width || hPx !== this.heightPx) {
      this.width = w;
      this.heightPx = hPx;
      r.setPixelRatio(getQuality() === 'low' ? 1 : Math.min(window.devicePixelRatio || 1, 2));
      r.setSize(w, hPx, false);
      this.frame(w / hPx);
    }
    if (!settings.value.reducedMotion) this.turntable.rotation.y += SPIN * Math.min(dt, 0.1);
    r.render(this.scene, this.camera);
  }

  /** Takes the model off (disposing only geometry this card owns). */
  clear(): void {
    const model = this.model;
    if (!model) return;
    this.turntable.remove(model);
    if (this.disposeGeometry) model.traverse((o) => (o as Mesh).isMesh && (o as Mesh).geometry.dispose());
    this.model = null;
    // Drop the renderer's references to the removed objects.
    this.renderer?.renderLists.dispose();
  }
}

export function registerBossIntroScreen(): void {
  registerScreen({
    id: ID,
    simulate: false,
    hud: true,
    create(game) {
      const canvas = h('canvas', { className: 'bi-canvas' });
      canvas.setAttribute('aria-hidden', 'true');
      const tag = h('span', { className: 'bi-tag', textContent: '⚠ Boss incoming' });
      const stage = h('div', { className: 'bi-stage' }, canvas, tag);
      const name = h('h2', { className: 'bi-name' });
      const desc = h('p', { className: 'bi-desc' });
      const story = h('p', { className: 'story-line bi-story' }, h('span', { className: 'story-line-text' }));
      const hits = h('p', { className: 'bi-hits' });
      const fill = h('span', { className: 'bi-timer-fill' });
      const timer = h('div', { className: 'bi-timer' }, fill);
      timer.setAttribute('aria-hidden', 'true');
      const fight = button('Fight', () => close(), { variant: 'primary', size: 'lg', icon: '▶' });
      const text = h('div', { className: 'bi-text' }, name, desc, story, hits, timer, h('div', { className: 'rl-row' }, fight));
      const el = h('div', { className: 'panel boss-intro' }, stage, text);
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-live', 'assertive');
      const view = new BossStage(canvas);
      let params: BossIntroParams | null = null;
      let armed = 0;
      let elapsed = 0;
      let wired = false;

      const close = (): void => {
        if (armed > 0 || !params) return;
        params = null;
        view.clear();
        game.input.sample(); // drop a Dash queued by the Space that closed the card
        const run = game.run;
        if (run && !run.ended) {
          game.go(run.perkDraft.active ? 'perkDraft' : 'playing');
          flashBossAlert(game);
        }
      };

      return {
        el,
        enter(raw) {
          const p = raw as BossIntroParams;
          params = p;
          armed = ARM_DELAY;
          elapsed = 0;
          if (!wired) {
            // A click or tap anywhere (card or backdrop) closes it.
            el.parentElement?.addEventListener('click', () => close());
            wired = true;
          }
          el.classList.add('arming');
          el.style.setProperty('--boss', p.color);
          el.parentElement?.style.setProperty('--boss', p.color);
          name.textContent = p.name;
          desc.textContent = p.description;
          desc.hidden = !p.description;
          story.hidden = p.narrator.length === 0;
          story.firstElementChild!.textContent = p.narrator.join(' ');
          hits.textContent = p.hits;
          hits.hidden = !p.hits;
          fill.style.transform = 'scaleX(1)';
          stage.classList.toggle('no-model', !view.show(p.modelId));
          // Replay the reveal animation.
          el.classList.remove('reveal');
          void el.offsetWidth;
          el.classList.add('reveal');
          (document.activeElement as HTMLElement | null)?.blur?.();
          view.render(0);
        },
        exit() {
          params = null;
          view.clear();
        },
        update(dt) {
          if (!params) return;
          const step = Math.min(dt, 0.1);
          if (armed > 0) {
            armed = Math.max(0, armed - step);
            if (armed <= 0) el.classList.remove('arming');
          }
          elapsed += step;
          fill.style.transform = `scaleX(${Math.max(0, 1 - elapsed / params.hold)})`;
          view.render(step);
          if (elapsed >= params.hold) close();
        },
        onKey(e) {
          if (isKey(e, 'Space', 'Enter', 'NumpadEnter', 'Escape')) {
            // Still arming (or a held key repeating): swallow it.
            if (armed <= 0 && !e.repeat) close();
            return true;
          }
          // Pause does nothing while the card is up (the Run is already paused).
          return isKey(e, 'KeyP');
        },
      };
    },
  });
}
