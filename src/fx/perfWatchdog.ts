/**
 * Frame-rate watchdog: while `active()` is true, averages frame times over fixed windows and
 * calls `onSlow()` once if `slowWindows` consecutive windows fall below `minFps`. Frames after a
 * long gap (tab switch, GC pause, screen change) are skipped so they don't count as slowness.
 *
 *   installPerfWatchdog({ active: () => game.simulating, onSlow: () => setQuality('low') });
 */
export interface PerfWatchdogOptions {
  active: () => boolean;
  onSlow: (fps: number) => void;
  minFps?: number;
  windowSeconds?: number;
  slowWindows?: number;
}

export function installPerfWatchdog(opts: PerfWatchdogOptions): () => void {
  const minFps = opts.minFps ?? 40;
  const windowSeconds = opts.windowSeconds ?? 4;
  const slowWindows = opts.slowWindows ?? 2;
  let last = 0;
  let elapsed = 0;
  let frames = 0;
  let slow = 0;
  let raf = 0;
  let fired = false;

  const tick = (now: number) => {
    raf = requestAnimationFrame(tick);
    const dt = last ? (now - last) / 1000 : 0;
    last = now;
    if (!opts.active() || dt <= 0 || dt > 0.25) {
      elapsed = 0;
      frames = 0;
      if (!opts.active()) slow = 0;
      return;
    }
    elapsed += dt;
    frames++;
    if (elapsed < windowSeconds) return;
    const fps = frames / elapsed;
    elapsed = 0;
    frames = 0;
    slow = fps < minFps ? slow + 1 : 0;
    if (slow >= slowWindows && !fired) {
      fired = true;
      cancelAnimationFrame(raf);
      opts.onSlow(fps);
    }
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}
