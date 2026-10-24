/**
 * Game: owns the renderer, scene, loop, input, event bus, screens and the current Run.
 * State machine = the active screen (see ui/screens.ts): title → playing ↔ paused → results,
 * or paused → Save & quit → title → Resume → playing (`saveAndQuit` / `resumeRun`).
 * Pausing stores the Run too (`checkpointRun`), so another tab can pick it up; unpausing takes it
 * back, or steps aside to the title if it carried on elsewhere (`handoff`, ./handoff.ts).
 */
import {
  ACESFilmicToneMapping,
  Color,
  Fog,
  PCFShadowMap,
  PerspectiveCamera,
  Plane,
  Raycaster,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
  type DirectionalLight,
} from 'three';
import { bendCamera, findLens, LensingPass } from '../fx/lensing';
import { Lighting } from '../fx/lighting';
import { getQuality, onQualityChange, type Quality } from '../fx/quality';
import { installVignette } from '../fx/vignette';
import { installHorizon, installLimb, showHorizon } from '../fx/horizon';
import { GalaxySky } from '../fx/galaxy';
import { installCmb, showCmb, UniverseSky } from '../fx/universe';
import { SolarSky, VICTORY_HOLD_SECONDS } from '../fx/solar';
import { EventBus } from '../core/events';
import { CompositeInput, KeyboardInput, PointerSteerInput } from '../core/input';
import { FixedLoop } from '../core/loop';
import { randomSeed } from '../core/rng';
import { DEFAULT_CHARACTER_ID } from '../data/characters';
import { TUNING } from '../data/tuning';
import { CameraRig } from '../systems/camera';
import { addDefaultHudWidgets, Hud } from '../ui/hud';
import { settings } from '../ui/settings';
import { ScreenManager } from '../ui/screens';
import { setMaxAnisotropy } from '../world/materials';
import { AREA_ORDER, type AreaId } from '../world/types';
import { afterRunEnded } from '../story/ending';
import type { EndingParams } from '../story/endingScreen';
import { storyAvailable } from '../story/index';
import { createRun } from './assembly';
import type { Run, RunConfig } from './run';
import type { RunSnapshot } from './snapshot';
import { getMeta } from '../meta/meta';
import { getAccountRuns } from '../meta/accountRun';
import { getSuspendedRuns, saveSuspendedRun, withSavedRunLock } from '../meta/suspendedRun';
import { RunHandoff, type HandoffLoss, type HandoffReason } from './handoff';
import { RunView } from './runView';

/** Seconds between the last Area's victory and the ending (the last absorb lands first). */
const ENDING_LEAD_SECONDS = 0.8;

export interface GameOptions {
  debug?: boolean;
}

/** What the title screen is opened with (`Game.go('title', params)`). */
export interface TitleParams {
  /** A short line shown on the title, e.g. why the Run on screen went away. */
  notice?: string;
}

/** The title's notice when this page's paused Run went on elsewhere (`Game.stepAside`). */
export function handoffNotice(why: HandoffLoss): string {
  if (why === 'otherDevice') return 'This Run carried on on another device. What you played here since you last unpaused it is lost.';
  return why === 'replaced' ? 'Another window saved its Run over this one. It counted as quit.' : 'This Run carried on in another window.';
}

const BACKGROUND = '#3b2f2a';
/**
 * Background / fog colour per area: indoor gloom, blue sky haze, golden-hour city haze, overcast
 * altitude haze, blue-violet dusk from the stratosphere (where the horizon overlay curves the
 * fog into the planet's limb, fx/horizon.ts), and the Globe's blue atmospheric haze, which the
 * limb overlay (fx/horizon.ts, installLimb) turns into the glowing edge of the planet against black space,
 * and the Solar System's black (its painted floor carries the stars and the Milky Way, solarTextures.ts),
 * and the Galaxy's violet-black (its painted floor carries the nebula backdrop and the disc, galaxyTextures.ts; the stars are fx/galaxy.ts),
 * and the Universe's near black (its painted floor carries the cosmic web, universeTextures.ts; the galaxies are fx/universe.ts,
 * and the CMB overlay tints the screen's edges orange).
 */
const AREA_SKY: Record<AreaId, string> = { house: BACKGROUND, neighborhood: '#b9d4e6', city: '#e9c9a6', region: '#c8cfd4', continent: '#8d8ac0', globe: '#16467e', solar_system: '#020205', galaxy: '#05030c', universe: '#020204' };

export class Game {
  readonly events = new EventBus();
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly fog = new Fog(BACKGROUND, 100, 300);
  readonly rig: CameraRig;
  readonly loop: FixedLoop;
  readonly input = new CompositeInput();
  readonly screens: ScreenManager;
  readonly hud: Hud;
  readonly lighting: Lighting;
  /** The Solar System's Sun, glare, light and the light going out (fx/solar.ts). */
  readonly solarSky: SolarSky;
  /** The Galaxy's Sagittarius A*, core glow, light and starfield (fx/galaxy.ts). */
  readonly galaxySky: GalaxySky;
  /** The Universe's galaxies, node glows and light (fx/universe.ts). */
  readonly universeSky: UniverseSky;
  /** Pending results screen after a Solar System victory (held so the light can go out). */
  private resultsTimer: number | null = null;
  /** Continent horizon overlay (null without a canvas container). */
  private horizon: HTMLElement | null = null;
  /** The Globe's limb, starfield and sun overlay (null without a canvas container). */
  private limb: HTMLElement | null = null;
  /** The Universe's CMB tint at the screen's edges (null without a canvas container). */
  private cmb: HTMLElement | null = null;
  readonly sun: DirectionalLight;
  readonly debug: boolean;

  run: Run | null = null;
  view: RunView | null = null;
  /** The ending's scene while the `ending` screen is up (src/story/endingScreen.ts): rendered instead of the Run. */
  ending: { render(renderer: WebGLRenderer): void } | null = null;
  /** Default config for the next Run (character select / shop write here). */
  nextRunConfig: Partial<RunConfig> = {};
  /**
   * Screen a new Run opens on instead of `playing` (null: `playing`). The story claims a first
   * Run for the diegetic intro (src/story/install.ts).
   */
  runOpening: ((run: Run) => { screen: string; params?: unknown } | null) | null = null;

  private quality: Quality = 'high';
  private readonly lensing = new LensingPass();
  /** Screen that paused the Run, if it is paused mid-Run. */
  private pausedBy: string | null = null;
  /**
   * Who owns the paused Run (./handoff.ts): pausing stores it in the saved Run slot, playing takes
   * it back. Another tab picking it up meanwhile makes this page step aside.
   */
  /** The Account's copy of the saved Run for a signed-in player (src/meta/accountRun.ts). */
  readonly accountRuns = getAccountRuns({ awardRun: (e) => getMeta().awardRun(e) });
  readonly handoff = new RunHandoff({
    store: getSuspendedRuns(),
    meta: { awardRun: (e) => getMeta().awardRun(e) },
    onLost: (why) => this.stepAside(why),
    cloud: this.accountRuns,
  });
  private readonly raycaster = new Raycaster();
  private readonly floorPlane = new Plane(new Vector3(0, 1, 0), 0);

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly uiLayer: HTMLElement,
    opts: GameOptions = {},
  ) {
    this.debug = !!opts.debug;
    this.renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    setMaxAnisotropy(Math.min(8, this.renderer.capabilities.getMaxAnisotropy()));

    this.scene.background = new Color(BACKGROUND);
    this.scene.fog = this.fog;
    this.camera = new PerspectiveCamera(TUNING.camera.fov, 1, 0.1, 1000);
    this.rig = new CameraRig(this.camera, this.fog, 1, 1);

    this.lighting = new Lighting(this.scene);
    this.sun = this.lighting.sun;
    this.applyQuality(getQuality());
    onQualityChange((q) => this.applyQuality(q));
    if (canvas.parentElement) {
      installVignette(canvas.parentElement);
      this.horizon = installHorizon(canvas.parentElement, AREA_SKY.continent);
      this.limb = installLimb(canvas.parentElement, AREA_SKY.globe);
      this.cmb = installCmb(canvas.parentElement);
      settings.subscribe((v) => {
        if (this.cmb) showCmb(this.cmb, this.run?.area === 'universe', v.reducedMotion);
      });
    }

    this.input.add(new KeyboardInput(window, () => TUNING.camera.yaw));
    this.input.add(
      new PointerSteerInput(canvas, (x, y) => this.pickFloor(x, y), () => (this.run ? { x: this.run.bunny.x, z: this.run.bunny.z, radius: this.run.bunny.radius } : null)),
    );

    this.hud = new Hud(this);
    this.solarSky = new SolarSky(this.scene, this.lighting, this.hud);
    this.galaxySky = new GalaxySky(this.scene, this.lighting);
    this.universeSky = new UniverseSky(this.scene, this.lighting);
    addDefaultHudWidgets(this.hud, this);
    this.hud.visible = false;
    this.uiLayer.append(this.hud.el);
    this.screens = new ScreenManager(this, uiLayer);

    window.addEventListener('keydown', (e) => {
      if (this.screens.handleKey(e)) e.preventDefault();
    });
    // Hidden: playing pauses (which stores the Run); any other in-Run screen (Perk draft, boss
    // intro, Keepsake reveal, story) stores it as it is, and takes it back once the tab is shown.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (this.simulating) this.go('paused');
        else if (this.canSaveRun && !this.handoff.busy) this.checkpointRun('hidden');
      } else if (this.handoff.holding === 'hidden') this.takeBackRun();
    });
    // Closing or reloading the tab keeps a paused Run stored (as Save & quit would).
    window.addEventListener('pagehide', () => this.handoff.flush());
    // The Account says another device has the Run this page has (src/meta/accountRun.ts).
    this.accountRuns.onLost((runKey) => {
      if (this.run && !this.run.ended && this.run.runKey === runKey) this.stepAside('otherDevice');
      else if (!this.run && this.screens.current?.id === 'title') this.go('title', { notice: handoffNotice('otherDevice') } satisfies TitleParams);
    });
    window.addEventListener('resize', () => this.resize());
    this.resize();

    this.events.on('runEnded', (e) => {
      // A victory (the last built Area's boss absorbed) holds the results back so it is seen and the
      // narrator's line is read.
      // A victory in the last Area plays the ending first (then the results); not with ?autostart.
      if (this.run && afterRunEnded(e.reason, this.run.area, storyAvailable()) === 'ending') {
        const run = this.run;
        // The Universe's cleared line plays first (ui/areaHud.ts); the ending waits until it has been read.
        const open = (): void => {
          this.resultsTimer = null;
          if (this.run !== run) return;
          const left = this.hud.bannerLeft;
          if (left > 0.1 || this.hud.bannerBusy) this.resultsTimer = window.setTimeout(open, Math.min(Math.max(left, 0.1), 0.25) * 1000);
          else this.go('ending', { result: e } satisfies EndingParams);
        };
        this.resultsTimer = window.setTimeout(open, ENDING_LEAD_SECONDS * 1000);
        return;
      }
      if (e.reason === 'victory') {
        const run = this.run;
        const show = (): void => {
          this.resultsTimer = null;
          if (this.run !== run) return;
          // A throttled tab can fire the caption timers late: wait while it is still playing too.
          // Checked every 0.25 s at most, so results follow soon after the player dismisses the banner.
          const left = this.hud.bannerLeft;
          if (left > 0.1 || this.hud.bannerBusy) this.resultsTimer = window.setTimeout(show, Math.min(Math.max(left, 0.1), 0.25) * 1000);
          else this.go('results', e);
        };
        this.resultsTimer = window.setTimeout(show, VICTORY_HOLD_SECONDS * 1000);
        return;
      }
      this.go('results', e);
    });
    this.events.on('areaEntered', () => {
      const run = this.run;
      if (!run) return;
      this.applyAtmosphere();
      this.rig.snap(run.bunny.x, run.bunny.z, run.bunny.radius, run.tier);
    });
    this.loop = new FixedLoop({ update: (dt) => this.update(dt), render: (a, fdt) => this.render(a, fdt) });
  }

  /** True if the active screen lets the Run simulate. */
  get simulating(): boolean {
    // Not while the paused Run is being taken back: it may turn out to be another tab's.
    return !!this.run && !this.run.ended && !!this.screens.current?.simulate && !this.handoff.busy;
  }

  start(initialScreen = 'title'): void {
    this.go(initialScreen);
    this.loop.start();
  }

  /** Switch screen. Emits paused/resumed when simulation stops/starts mid-Run. */
  go(id: string, params?: unknown): void {
    const wasSim = this.simulating;
    const prev = this.screens.go(id, params);
    const def = this.screens.current!;
    this.hud.visible = !!def.hud && !!this.run;
    if (this.run && !this.run.ended) {
      // A paused Run is a saved Run: the paused screen stores it, play takes it back (./handoff.ts).
      if (id === 'paused' && !this.handoff.busy) this.checkpointRun('pause');
      else if (def.simulate && this.handoff.holding) this.takeBackRun();
    }
    this.events.emit('screenChanged', { from: prev?.id ?? null, to: id });
    this.syncPaused(wasSim, id);
  }

  /** Emits paused / resumed when simulation stopped or started (`wasSim`: before the change). */
  private syncPaused(wasSim: boolean, id: string): void {
    const nowSim = this.simulating;
    if (this.run && !this.run.ended) {
      if (wasSim && !nowSim) {
        this.pausedBy = id;
        this.events.emit('paused', { reason: id });
      } else if (nowSim && this.pausedBy) {
        this.events.emit('resumed', { reason: this.pausedBy });
        this.pausedBy = null;
      }
    }
  }

  /**
   * Creates a fresh Run (disposing the old one) with its gameplay rules installed (see
   * ./assembly.ts), emits runStarted and switches to the playing screen (or `runOpening`'s).
   */
  startRun(config: Partial<RunConfig> = {}): Run {
    const full: RunConfig = {
      seed: config.seed ?? this.nextRunConfig.seed ?? randomSeed(),
      characterId: config.characterId ?? this.nextRunConfig.characterId ?? DEFAULT_CHARACTER_ID,
      difficulty: config.difficulty ?? this.nextRunConfig.difficulty,
      modifiers: [...(this.nextRunConfig.modifiers ?? []), ...(config.modifiers ?? [])],
      perks: config.perks ?? this.nextRunConfig.perks,
      area: config.area ?? this.nextRunConfig.area,
      loadout: config.loadout ?? this.nextRunConfig.loadout,
    };
    this.nextRunConfig.seed = undefined;
    return this.launch(full);
  }

  /**
   * Starts a saved Run again (Save & quit → Resume) in the Area it was left in, with the config it
   * was saved with: `nextRunConfig` (Character select, Upgrades bought since) doesn't apply, and
   * there is no opening (no intro). `loadout` overrides the saved Loadout (the title repairs it
   * against the Hoard, which may have changed in the meantime).
   */
  resumeRun(snapshot: RunSnapshot, loadout: RunConfig['loadout'] = snapshot.loadout): Run {
    return this.launch({
      seed: snapshot.seed,
      characterId: snapshot.characterId,
      difficulty: snapshot.difficulty,
      modifiers: snapshot.modifiers.map((m) => ({ ...m })),
      area: snapshot.startArea,
      loadout,
      resume: snapshot,
    });
  }

  private launch(full: RunConfig): Run {
    // A Run this page had stored on pause stays in the slot: a new Run abandons it (credited as a
    // quit, src/meta/install.ts) and a resumed one replaced it.
    this.disposeRun();
    this.pausedBy = null;
    const run = createRun(this.events, full);
    run.input = this.input;
    this.run = run;
    this.view = new RunView(run, this.scene);
    this.rig.snap(run.bunny.x, run.bunny.z, run.bunny.radius, run.tier);
    this.applyAtmosphere();
    const resumed = !!full.resume;
    this.events.emit('runStarted', { seed: full.seed, characterId: full.characterId, ...(resumed ? { resumed } : {}) });
    const opening = resumed ? null : (this.runOpening?.(run) ?? null);
    this.go(opening?.screen ?? 'playing', opening?.params);
    return run;
  }

  /** Ends the current Run as quit (→ results). Doesn't check the hand-off: see `endRun` for the pause menu. */
  quitRun(): void {
    this.run?.end('quit');
  }

  /**
   * End run / Quit to title from the pause menu: takes the paused Run back first, and ends it as
   * quit (results, or the title with `toTitle`) only if it is still this page's. If another tab
   * picked it up meanwhile it is not ended or credited here: the page steps aside instead. Resolves
   * true when the Run was ended; false otherwise (also while a take back is already in flight).
   */
  endRun(toTitle = false): Promise<boolean> {
    const run = this.run;
    if (!run || run.ended || this.handoff.busy) return Promise.resolve(false);
    // Ending credits the Run, so for a signed-in player the server take is waited for first.
    return this.handoff
      .takeBack()
      .then((ok) => ok && this.accountRuns.confirmHeld(run.runKey))
      .then((ok) => {
        if (!ok || this.run !== run || run.ended) return false;
        run.end('quit'); // emits runEnded so meta progress still records the Run
        if (toTitle) {
          this.disposeRun();
          this.go('title');
        }
        return true;
      });
  }

  /** True while there is a Run in progress that Save & quit can keep. */
  get canSaveRun(): boolean {
    return !!this.run && !this.run.ended;
  }

  /**
   * Stores the Run in progress in the saved Run slot without disposing it, so another tab can
   * pick it up (`runSuspended` listeners add their fields first). Called on pause, and with
   * `hidden` when the tab is hidden on another in-Run screen. The copy carries a fresh `handoffId`
   * this page remembers (./handoff.ts); already holding one, it does nothing. False without a Run
   * in progress.
   */
  checkpointRun(by: HandoffReason = 'pause'): boolean {
    const run = this.run;
    if (!run || run.ended) return false;
    if (this.handoff.holding) return true;
    const snapshot = run.toSnapshot();
    this.events.emit('runSuspended', { snapshot });
    this.handoff.store(snapshot, by);
    return true;
  }

  /** Takes the stored Run back as play goes on (or the tab is shown again); see `syncPaused`. */
  private takeBackRun(): void {
    const run = this.run;
    void this.handoff.takeBack().then((ok) => {
      if (!ok || !run || this.run !== run || run.ended) return;
      const cur = this.screens.current;
      if (this.simulating) {
        if (document.hidden) this.go('paused');
        else this.syncPaused(false, cur?.id ?? 'playing');
      } else if (cur?.id === 'paused') this.checkpointRun('pause');
      else if (document.hidden) this.checkpointRun('hidden');
    });
  }

  /**
   * This page's paused Run carried on elsewhere (or was replaced): its copy is disposed without
   * `runEnded` (nothing is credited twice) and the title says why.
   */
  private stepAside(why: HandoffLoss): void {
    if (!this.run) return;
    this.handoff.forget();
    // Exit the in-Run screen first, while its Run and view still exist: its exit() may use them
    // (the story intro finishes its shots on game.view). The title then opens with no Run.
    this.screens.leave();
    this.disposeRun();
    this.go('title', { notice: handoffNotice(why) } satisfies TitleParams);
  }

  /**
   * Save & quit: keeps the Run in progress on this device (src/meta/suspendedRun.ts) and returns to
   * the title, disposing it without ending it (no runEnded, no Fluff yet). From pause it is already
   * stored (`checkpointRun`), so it is only let go of; if another tab picked it up meanwhile the
   * title says so. Otherwise it is stored now (`runSuspended` listeners add their own fields first;
   * a different Run already in the slot, saved from another tab, is credited as a quit), under
   * the saved Run lock so two tabs saving at once can't credit it twice. False, changing nothing,
   * without a Run in progress or while a take back is in flight.
   */
  saveAndQuit(): boolean {
    const run = this.run;
    if (!run || run.ended || this.handoff.busy) return false;
    if (this.handoff.holding) {
      const lost = this.handoff.leaveStored();
      this.disposeRun();
      this.go('title', (lost ? { notice: handoffNotice(lost) } : {}) satisfies TitleParams);
      return true;
    }
    const snapshot = run.toSnapshot();
    this.events.emit('runSuspended', { snapshot });
    const store = getSuspendedRuns();
    const meta = getMeta();
    const save = (): boolean => {
      // The device first, then the Account (src/meta/accountRun.ts).
      const prev = store.peek()?.runKey ?? null;
      this.accountRuns.tag(snapshot);
      const replaced = saveSuspendedRun(store, snapshot, meta);
      this.accountRuns.stored(snapshot, prev);
      return replaced;
    };
    void withSavedRunLock(save).catch(save);
    this.disposeRun();
    this.go('title');
    return true;
  }

  disposeRun(): void {
    // A Run stored on pause stays in the slot, as Save & quit leaves it.
    this.handoff.forget();
    if (this.resultsTimer !== null) window.clearTimeout(this.resultsTimer);
    this.resultsTimer = null;
    this.solarSky.attach(null);
    this.galaxySky.attach(null);
    this.universeSky.attach(null);
    this.view?.dispose();
    this.run?.dispose();
    this.view = null;
    this.run = null;
  }

  /** Background, fog colour and lighting for the current Run's area. */
  private applyAtmosphere(): void {
    const area = this.run?.area ?? 'house';
    const c = AREA_SKY[area];
    (this.scene.background as Color).set(c);
    this.fog.color.set(c);
    this.lighting.setArea(area);
    this.solarSky.attach(this.run);
    this.galaxySky.attach(this.run);
    this.universeSky.attach(this.run);
    if (this.horizon) showHorizon(this.horizon, area === 'continent');
    if (this.limb) showHorizon(this.limb, area === 'globe');
    if (this.cmb) showCmb(this.cmb, area === 'universe', settings.value.reducedMotion);
    this.canvas.parentElement?.classList.toggle('outdoor', area !== 'house');
    for (const a of AREA_ORDER) if (a !== 'house') this.canvas.parentElement?.classList.toggle(a, area === a);
  }

  pickFloor(clientX: number, clientY: number): { x: number; z: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const p = new Vector3();
    return this.raycaster.ray.intersectPlane(this.floorPlane, p) ? { x: p.x, z: p.z } : null;
  }

  private update(dt: number): void {
    if (this.simulating) this.run!.update(dt);
  }

  private render(alpha: number, frameDt: number): void {
    this.screens.update(frameDt);
    if (this.ending) {
      this.ending.render(this.renderer);
      return;
    }
    // Sagittarius A*'s pull bends the camera (src/fx/lensing.ts).
    const lens = findLens(this.run);
    if (this.view) {
      bendCamera(this.rig, lens, settings.value.reducedMotion);
      this.view.render(this.simulating ? alpha : 1, frameDt, this.rig, this.renderer.domElement.height);
      this.solarSky.update(frameDt, this.view, this.rig.distance);
      this.galaxySky.update(frameDt, this.view, this.rig.distance, this.rig.target, this.renderer.getPixelRatio());
      this.universeSky.update(frameDt, this.rig.distance, this.rig.target, this.renderer.getPixelRatio());
      this.lighting.update(this.rig.viewTarget, this.rig.viewDistance);
    }
    this.hud.update(frameDt);
    this.renderer.render(this.scene, this.camera);
    if (this.view) this.lensing.render(this.renderer, this.scene, this.camera, lens, this.quality);
  }

  /** Render quality (see fx/quality.ts): shadows and pixel ratio. */
  private applyQuality(q: Quality): void {
    this.quality = q;
    this.lighting.applyQuality(this.renderer, q);
    this.resize();
  }

  /**
   * Device pixel ratio capped per quality and by a pixel budget, so high-DPI phones and large
   * monitors don't render far more pixels than the GPU can fill (fur shells are fill-bound).
   */
  static pixelRatioFor(q: Quality, cssW: number, cssH: number, dpr: number): number {
    const cap = q === 'low' ? 1.5 : 2;
    const budget = q === 'low' ? 1.0e6 : 3.7e6;
    const fit = Math.sqrt(budget / Math.max(1, cssW * cssH));
    return Math.min(dpr || 1, Math.max(1, Math.min(cap, fit)));
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    const pr = Game.pixelRatioFor(this.quality, w, h, window.devicePixelRatio);
    if (this.renderer.getPixelRatio() !== pr) this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.rig.setAspect(w / h);
  }
}
