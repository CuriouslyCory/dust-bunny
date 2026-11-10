/**
 * Frame recorder controls (issue #79), loaded with `import()` by installDebug (`?debug`) and the
 * apps' E2E builds (src/e2e/index.ts), so a release session never loads it:
 *   - `debugTools.perf`: start(), stop() (returns the report and sends it), report() (works
 *     mid-recording), send(), download(), copy(), toggle(), isRecording
 *   - `L` toggles recording (installDebug)
 *   - a widget, left edge at mid height (clear of the hearts, Tier card and debug readout): ● Rec / ■ Stop 03:12; after Stop, the summary line with Send · Download ·
 *     Copy (Send: `pnpm dev` and E2E builds; Download: the web only)
 * Feeds ./perfRecorder.ts from `FixedLoop.frameObserver` (after render, so the draw calls cover the
 * whole frame, lensing pass included), quality changes and runStarted. See docs/architecture.md,
 * "Debug hooks" and "Perf reports from a device".
 */
import { getQuality, onQualityChange } from '../fx/quality';
import type { Game } from '../game/game';
import { NATIVE_APP } from '../platform';
import { h } from '../ui/screens';
import { CAN_DOWNLOAD, CAN_SEND, copyText, downloadReport, sendReport, type SendResult } from './perfExport';
import { clock, PerfRecorder, type FrameSample, type PerfMeta, type PerfReport } from './perfRecorder';

export interface PerfTools {
  readonly isRecording: boolean;
  /** Starts a new recording (dropping the last one). */
  start(): void;
  /** Stops, sends the report where there's a dev server, and returns it. */
  stop(): PerfReport;
  toggle(): void;
  /** The recording so far, or the last one once stopped. */
  report(): PerfReport;
  send(): Promise<SendResult>;
  download(): void;
  copy(): Promise<void>;
}

export interface PerfOptions {
  /** Show the on-screen widget (default true). */
  widget?: boolean;
  /** After each send, with its result (the E2E build marks it). */
  onSent?: (r: SendResult) => void;
}

function platform(): string {
  const cap = (window as Window & { Capacitor?: { getPlatform?: () => string } }).Capacitor;
  return cap?.getPlatform?.() ?? 'web';
}

function gpuName(game: Game): string | null {
  try {
    const gl = game.renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
  } catch {
    return null;
  }
}

export function installPerf(game: Game, opts: PerfOptions = {}): PerfTools {
  const rec = new PerfRecorder();
  const gpu = gpuName(game);
  const meta = (): PerfMeta => {
    const nav = navigator as Navigator & { deviceMemory?: number };
    const canvas = game.renderer.domElement;
    return {
      platform: platform(),
      build: { mode: import.meta.env.MODE, native: NATIVE_APP, e2e: import.meta.env.VITE_E2E ?? '', sha: import.meta.env.VITE_BUILD_SHA ?? '' },
      device: {
        userAgent: nav.userAgent,
        pixelRatio: game.renderer.getPixelRatio(),
        canvasPx: [canvas.width, canvas.height],
        gpu,
        hardwareConcurrency: nav.hardwareConcurrency ?? null,
        deviceMemoryGb: nav.deviceMemory ?? null,
      },
    };
  };

  // One sample object, refilled each frame: recording allocates nothing per frame.
  let quality = getQuality();
  const s: FrameSample = { simulating: false, hidden: false, timeScale: 1, area: '', tier: 0, quality, drawCalls: 0, debris: 0 };
  game.loop.frameObserver = (intervalMs, cpuMs) => {
    if (!rec.recording) return;
    const run = game.run;
    s.simulating = game.simulating;
    s.hidden = document.hidden;
    s.timeScale = game.loop.timeScale;
    s.area = run?.area ?? '';
    s.tier = run?.tier ?? 0;
    s.quality = quality;
    s.drawCalls = game.renderer.info.render.calls;
    s.debris = run?.debris.count ?? 0;
    rec.frame(intervalMs, cpuMs, s);
  };
  // Game applied the new pixel ratio first (it subscribed at construction).
  onQualityChange((q) => {
    const run = game.run;
    rec.qualityChanged(quality, q, run?.area ?? '', run?.tier ?? 0, game.renderer.getPixelRatio());
    quality = q;
  });
  game.events.on('runStarted', (e) => rec.runStarted({ seed: e.seed, characterId: e.characterId, difficulty: game.run?.difficulty.id, resumed: e.resumed }));
  // No frames come while hidden: the first one after spans the gap.
  document.addEventListener('visibilitychange', () => rec.markGap());

  let last: PerfReport | null = null;
  const report = () => (rec.recording || !last ? rec.report(meta()) : last);
  const widget = opts.widget === false ? null : perfWidget();

  const tools: PerfTools = {
    get isRecording() {
      return rec.recording;
    },
    start() {
      rec.start();
      last = null;
      const run = game.run;
      if (run && !run.ended) rec.runStarted({ seed: run.config.seed, characterId: run.config.characterId, difficulty: run.difficulty.id, midRun: true });
      widget?.recording(() => rec.elapsedS);
    },
    stop() {
      rec.stop();
      last = rec.report(meta());
      widget?.stopped(last.summary);
      if (CAN_SEND) void tools.send();
      return last;
    },
    toggle() {
      if (rec.recording) tools.stop();
      else tools.start();
    },
    report,
    async send() {
      widget?.sendState('sending');
      const r = await sendReport(report());
      widget?.sendState(r);
      opts.onSent?.(r);
      return r;
    },
    download() {
      downloadReport(report());
    },
    async copy() {
      const how = await copyText(JSON.stringify(report()));
      widget?.note(how === 'clipboard' ? 'Copied ✓' : 'Select all and copy');
    },
  };
  widget?.bind(tools);
  return tools;
}

/**
 * The on-screen controls: fixed at the left edge, mid height (the corners hold the hearts, Tier
 * card, debug readout and touch buttons), above the HUD and every screen so they outlast a Run.
 */
function perfWidget() {
  const button = (label: string) => h('button', { type: 'button', textContent: label });
  const rec = button('● Rec');
  const send = button('Send');
  const download = button('Download');
  const copy = button('Copy');
  const summary = h('div', { className: 'perf-summary' });
  const status = h('span', { className: 'perf-status' });
  const actions = h('div', { className: 'perf-actions' }, send, download, copy, status);
  const el = h('div', { className: 'perf-widget' }, rec, summary, actions);
  el.setAttribute('role', 'group');
  el.setAttribute('aria-label', 'Frame recorder');
  el.style.cssText =
    'position:fixed;top:50%;transform:translateY(-50%);left:calc(env(safe-area-inset-left) + 4px);z-index:99998;max-width:min(92vw,520px);' +
    'display:flex;flex-direction:column;align-items:flex-start;gap:4px;font:12px/1.3 ui-monospace,monospace;color:#fff';
  for (const b of [rec, send, download, copy]) {
    b.style.cssText = 'min-height:32px;padding:4px 10px;border:0;border-radius:6px;background:rgba(0,0,0,.65);color:#fff;font:inherit;cursor:pointer';
  }
  rec.style.color = '#ff6b6b';
  summary.style.cssText = 'display:none;background:rgba(0,0,0,.65);padding:4px 6px;border-radius:6px;user-select:text;-webkit-user-select:text';
  actions.style.cssText = 'display:none;flex-wrap:wrap;gap:4px;align-items:center';
  status.style.cssText = 'background:rgba(0,0,0,.65);padding:2px 6px;border-radius:6px';
  if (!CAN_SEND) send.hidden = true;
  if (!CAN_DOWNLOAD) download.hidden = true;
  document.body.append(el);

  let timer = 0;
  const show = (on: boolean) => {
    summary.style.display = on ? 'block' : 'none';
    actions.style.display = on ? 'flex' : 'none';
  };
  // Buttons let go of focus, so Space and Enter go back to the game.
  const onClick = (b: HTMLButtonElement, fn: () => void) =>
    b.addEventListener('click', () => {
      b.blur();
      fn();
    });
  return {
    bind(tools: PerfTools) {
      onClick(rec, () => tools.toggle());
      onClick(send, () => void tools.send());
      onClick(download, () => tools.download());
      onClick(copy, () => void tools.copy());
    },
    recording(elapsedS: () => number) {
      show(false);
      const tick = () => (rec.textContent = `■ Stop ${clock(elapsedS())}`);
      tick();
      window.clearInterval(timer);
      timer = window.setInterval(tick, 1000);
    },
    stopped(line: string) {
      window.clearInterval(timer);
      rec.textContent = '● Rec';
      summary.textContent = line;
      status.textContent = CAN_SEND ? '' : 'no dev server, use Download / Copy';
      show(true);
    },
    sendState(r: 'sending' | SendResult) {
      if (r === 'sending') status.textContent = 'Sending…';
      else status.textContent = r.ok ? `Sent ✓ ${r.file}` : `Send failed (${r.error ?? '?'})`;
      send.textContent = r !== 'sending' && !r.ok ? 'Retry' : 'Send';
    },
    note(text: string) {
      status.textContent = text;
    },
  };
}
