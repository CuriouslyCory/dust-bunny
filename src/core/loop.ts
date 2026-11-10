/**
 * Fixed-timestep simulation (default 60 Hz) with variable-rate rendering.
 * `update(dt)` always receives the fixed step; `render(alpha, frameDt)` receives the
 * interpolation factor between the last two simulation states.
 */
export interface LoopCallbacks {
  update(dt: number): void;
  render(alpha: number, frameDt: number): void;
}

export class FixedLoop {
  readonly step: number;
  /** Max simulation steps per frame, to avoid the spiral of death after a long stall. */
  maxSteps = 5;
  /** Simulation speed multiplier (debug). */
  timeScale = 1;
  fps = 0;
  /**
   * Debug frame recorder (src/debug/perf.ts): called after each frame's render with the raw rAF
   * interval (before the 250 ms clamp) and the CPU time of that frame's update + render, in ms.
   */
  frameObserver: ((intervalMs: number, cpuMs: number) => void) | null = null;

  private acc = 0;
  private last = 0;
  private raf = 0;
  private running = false;
  private fpsFrames = 0;
  private fpsTime = 0;

  constructor(
    private readonly cb: LoopCallbacks,
    hz = 60,
  ) {
    this.step = 1 / hz;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private frame = (now: number): void => {
    if (!this.running) return;
    const t0 = this.frameObserver ? performance.now() : 0;
    const intervalMs = now - this.last;
    const frameDt = Math.min(0.25, intervalMs / 1000);
    this.last = now;
    this.acc += frameDt * this.timeScale;
    let steps = 0;
    while (this.acc >= this.step && steps < this.maxSteps) {
      this.cb.update(this.step);
      this.acc -= this.step;
      steps++;
    }
    if (steps === this.maxSteps) this.acc = 0;

    this.fpsFrames++;
    this.fpsTime += frameDt;
    if (this.fpsTime >= 0.5) {
      this.fps = this.fpsFrames / this.fpsTime;
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }

    this.cb.render(this.acc / this.step, frameDt);
    this.frameObserver?.(intervalMs, performance.now() - t0);
    this.raf = requestAnimationFrame(this.frame);
  };
}
