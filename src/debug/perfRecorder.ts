/**
 * Frame recorder (issue #79): sorts every frame `FixedLoop.frameObserver` reports into a fixed-size
 * histogram per Area × Tier × render quality, so a 15-minute device session costs the same memory
 * as a short one, and `report()` turns that into JSON (`schema: 1`). Pure: ./perf.ts feeds it from
 * the Game and the page, so the tests drive it with a fake clock.
 *
 * The bucket is picked by comparing the frame's Area, Tier and quality with the current bucket's,
 * not from events: a resumed or new Run (and debug shrinking) changes the Tier without `tierUp`.
 * Frames that don't measure play are counted in `excludedFrames`, not recorded: the Run isn't
 * simulating (paused, Perk draft, boss intro…), the page is hidden, the sim speed isn't ×1, and
 * the first frame after any of those (its interval spans the gap). Real long frames stay in,
 * including shader compiles on entering an Area, which land in the new Area's first bucket.
 */
import { getTier } from '../data/tiers';
import type { Quality } from '../fx/quality';
import { BIN_MS, FrameHistogram, MAX_MS, round3, Stat, type HistogramJson, type StatJson } from './frameHistogram';

/** What the frame looked like, read once per frame by ./perf.ts. */
export interface FrameSample {
  simulating: boolean;
  hidden: boolean;
  timeScale: number;
  area: string;
  tier: number;
  quality: Quality;
  /** Draw calls of the whole frame (read after render, lensing pass included). */
  drawCalls: number;
  debris: number;
}

export interface PerfMeta {
  /** `ios`, `android` or `web`. */
  platform: string;
  build: { mode: string; native: boolean; e2e: string; sha: string };
  device: {
    userAgent: string;
    pixelRatio: number;
    canvasPx: [number, number];
    gpu: string | null;
    hardwareConcurrency: number | null;
    deviceMemoryGb: number | null;
  };
}

export interface RunStart {
  seed: string;
  characterId: string;
  difficulty?: string;
  resumed?: boolean;
  /** Already under way when the recording started. */
  midRun?: boolean;
}

export interface BucketJson {
  area: string;
  tier: number;
  tierName: string;
  quality: Quality;
  /** Sum of the recorded frames' intervals. */
  durationS: number;
  /** Frame interval (rAF to rAF, before the loop's 250 ms clamp): what the player sees. */
  frameMs: HistogramJson;
  /** CPU time of update + render; the GPU's share only shows in `frameMs`. */
  cpuMs: HistogramJson;
  drawCalls: StatJson;
  debris: StatJson;
}

export interface PerfReport {
  schema: 1;
  meta: PerfMeta & {
    startedAt: string;
    durationS: number;
    recording: boolean;
    binMs: number;
    maxMs: number;
    /** p10 of the frame interval, and the display rate it's closest to (null when none is). */
    refresh: { periodMs: number | null; hz: number | null };
    runs: Array<{ seed: string; characterId: string; difficulty: string | null; resumed: boolean; midRun: boolean; atS: number }>;
    notes: string[];
  };
  overall: Omit<BucketJson, 'area' | 'tier' | 'tierName' | 'quality'> & { heapMb: StatJson };
  buckets: BucketJson[];
  excludedFrames: { total: number; notSimulating: number; hidden: number; timeScale: number; afterGap: number };
  qualityChanges: Array<{ atS: number; area: string; tier: number; from: Quality; to: Quality; pixelRatio: number }>;
  /** Heap every ~10 s, `[atS, mb]` (Chromium only), capped at an hour. */
  heapSeries: Array<[number, number]>;
  /** `summaryLine` of this report. */
  summary: string;
}

const MAX_QUALITY_CHANGES = 32;
const MAX_RUNS = 64;
const MAX_HEAP_SERIES = 360;
const HEAP_EVERY_MS = 1000;
const HEAP_SERIES_EVERY = 10;
const DISPLAY_HZ = [30, 48, 50, 60, 72, 90, 120, 144, 165, 240];

class Bucket {
  readonly frame = new FrameHistogram();
  readonly cpu = new FrameHistogram();
  readonly drawCalls = new Stat();
  readonly debris = new Stat();
  durationMs = 0;

  constructor(
    readonly area: string,
    readonly tier: number,
    readonly quality: Quality,
  ) {}

  merge(o: Bucket): void {
    this.frame.merge(o.frame);
    this.cpu.merge(o.cpu);
    this.drawCalls.merge(o.drawCalls);
    this.debris.merge(o.debris);
    this.durationMs += o.durationMs;
  }

  stats() {
    return {
      durationS: round3(this.durationMs / 1000),
      frameMs: this.frame.toJSON(),
      cpuMs: this.cpu.toJSON(),
      drawCalls: this.drawCalls.toJSON(),
      debris: this.debris.toJSON(),
    };
  }
}

export interface PerfRecorderOptions {
  /** Monotonic ms (default `performance.now`). */
  now?: () => number;
  /** JS heap in MB, or null where the browser doesn't say (default: `performance.memory`, Chromium). */
  readHeapMb?: () => number | null;
}

export class PerfRecorder {
  recording = false;
  private readonly now: () => number;
  private readonly readHeapMb: () => number | null;
  private buckets = new Map<string, Bucket>();
  private cur: Bucket | null = null;
  private startMs = 0;
  private stopMs: number | null = null;
  private startedAt = '';
  private gap = false;
  private excluded = { total: 0, notSimulating: 0, hidden: 0, timeScale: 0, afterGap: 0 };
  private heap = new Stat();
  private heapSeries: Array<[number, number]> = [];
  private lastHeapMs = -Infinity;
  private runs: PerfReport['meta']['runs'] = [];
  private qualityChanges: PerfReport['qualityChanges'] = [];

  constructor(opts: PerfRecorderOptions = {}) {
    this.now = opts.now ?? (() => performance.now());
    this.readHeapMb = opts.readHeapMb ?? defaultHeapMb;
  }

  /** Starts a new recording (dropping any earlier one). */
  start(): void {
    this.buckets = new Map();
    this.cur = null;
    this.startMs = this.now();
    this.stopMs = null;
    this.startedAt = new Date().toISOString();
    this.gap = false;
    this.excluded = { total: 0, notSimulating: 0, hidden: 0, timeScale: 0, afterGap: 0 };
    this.heap = new Stat();
    this.heapSeries = [];
    this.lastHeapMs = -Infinity;
    this.runs = [];
    this.qualityChanges = [];
    this.recording = true;
  }

  stop(): void {
    if (!this.recording) return;
    this.recording = false;
    this.stopMs = this.now();
  }

  /** Seconds since start (frozen at stop). */
  get elapsedS(): number {
    return ((this.stopMs ?? this.now()) - this.startMs) / 1000;
  }

  /** The next frame's interval spans a gap (e.g. the page was hidden, so no frames came). */
  markGap(): void {
    this.gap = true;
  }

  frame(intervalMs: number, cpuMs: number, s: FrameSample): void {
    if (!this.recording) return;
    this.sampleHeap();
    const reason = s.hidden ? 'hidden' : !s.simulating ? 'notSimulating' : s.timeScale !== 1 ? 'timeScale' : this.gap ? 'afterGap' : null;
    if (reason) {
      this.excluded[reason]++;
      this.excluded.total++;
      this.gap = reason !== 'afterGap';
      return;
    }
    let b = this.cur;
    if (!b || b.area !== s.area || b.tier !== s.tier || b.quality !== s.quality) {
      const key = `${s.area}:${s.tier}:${s.quality}`;
      b = this.buckets.get(key) ?? null;
      if (!b) this.buckets.set(key, (b = new Bucket(s.area, s.tier, s.quality)));
      this.cur = b;
    }
    b.frame.add(intervalMs);
    b.cpu.add(cpuMs);
    b.drawCalls.add(s.drawCalls);
    b.debris.add(s.debris);
    b.durationMs += intervalMs;
  }

  runStarted(r: RunStart): void {
    if (!this.recording || this.runs.length >= MAX_RUNS) return;
    this.runs.push({ seed: r.seed, characterId: r.characterId, difficulty: r.difficulty ?? null, resumed: !!r.resumed, midRun: !!r.midRun, atS: round3(this.elapsedS) });
  }

  qualityChanged(from: Quality, to: Quality, area: string, tier: number, pixelRatio: number): void {
    if (!this.recording || this.qualityChanges.length >= MAX_QUALITY_CHANGES) return;
    this.qualityChanges.push({ atS: round3(this.elapsedS), area, tier, from, to, pixelRatio });
  }

  /** The recording so far (works mid-recording too). */
  report(meta: PerfMeta): PerfReport {
    const all = new Bucket('', 0, 'high');
    for (const b of this.buckets.values()) all.merge(b);
    const period = all.frame.count ? round3(all.frame.percentile(10)) : null;
    const hz = period ? DISPLAY_HZ.find((h) => Math.abs(1000 / h - period) / (1000 / h) < 0.08) ?? null : null;
    const r: PerfReport = {
      schema: 1,
      meta: {
        ...meta,
        startedAt: this.startedAt,
        durationS: round3(this.elapsedS),
        recording: this.recording,
        binMs: BIN_MS,
        maxMs: MAX_MS,
        refresh: { periodMs: period, hz },
        runs: this.runs.map((r) => ({ ...r })),
        notes: [
          'frameMs is the rAF interval before the loop clamp; cpuMs is update + render on the CPU, so a GPU-bound frame shows in frameMs only.',
          'WebKit coarsens timers to about 1 ms.',
          'Shader compiles on entering an Area land in that Area’s first bucket.',
          'Percentiles at or over maxMs read maxMs; see maxMs for the real worst frame.',
          'heapMb is performance.memory (Chromium only), which Chromium rounds and refreshes slowly unless precise memory info is on: read it as a coarse trend.',
        ],
      },
      overall: { ...all.stats(), heapMb: this.heap.toJSON() },
      buckets: [...this.buckets.values()].map((b) => ({ area: b.area, tier: b.tier, tierName: getTier(b.tier).name, quality: b.quality, ...b.stats() })),
      excludedFrames: { ...this.excluded },
      qualityChanges: this.qualityChanges.map((q) => ({ ...q })),
      heapSeries: this.heapSeries.map((h) => [h[0], h[1]]),
      summary: '',
    };
    r.summary = summaryLine(r);
    return r;
  }

  private sampleHeap(): void {
    const t = this.now();
    if (t - this.lastHeapMs < HEAP_EVERY_MS) return;
    this.lastHeapMs = t;
    const mb = this.readHeapMb();
    if (mb === null) return;
    this.heap.add(mb);
    if ((this.heap.count - 1) % HEAP_SERIES_EVERY === 0 && this.heapSeries.length < MAX_HEAP_SERIES) this.heapSeries.push([round3(this.elapsedS), round3(mb)]);
  }
}

function defaultHeapMb(): number | null {
  const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
  return mem ? mem.usedJSHeapSize / 1048576 : null;
}

/** `mm:ss`, or `h:mm:ss` from an hour. */
export const clock = (s: number): string => {
  const t = Math.floor(s);
  const mm = String(Math.floor((t % 3600) / 60)).padStart(2, '0');
  const ss = String(t % 60).padStart(2, '0');
  return t >= 3600 ? `${Math.floor(t / 3600)}:${mm}:${ss}` : `${mm}:${ss}`;
};

const ms = (v: number | null): string => (v === null ? 'n/a' : v >= MAX_MS ? `≥${MAX_MS}` : v.toFixed(1));
const pct = (n: number, of: number): string => `${of ? ((100 * n) / of).toFixed(1) : '0.0'}%`;

/** Buckets shorter than this are too noisy to call the worst (unless no bucket is longer). */
const WORST_MIN_FRAMES = 300;

/**
 * One pasteable line, e.g. `perf android 15:02 · 54,120 frames · p50 16.7 / p95 24.1 / p99 41.3 ms ·
 * >33 ms 1.8% · >50 ms 0.4% · 212 calls avg · quality high→low 06:41 (city T8) · worst city T9 p95
 * 38.2 ms · heap 120–310 MB · a1b2c3d`.
 */
export function summaryLine(r: PerfReport): string {
  const f = r.overall.frameMs;
  const parts = [
    `perf ${r.meta.platform} ${clock(r.meta.durationS)}`,
    `${f.count.toLocaleString('en-US')} frames`,
    `p50 ${ms(f.p50Ms)} / p95 ${ms(f.p95Ms)} / p99 ${ms(f.p99Ms)} ms`,
    `>33 ms ${pct(f.over33, f.count)}`,
    `>50 ms ${pct(f.over50, f.count)}`,
    `${r.overall.drawCalls.mean === null ? 'n/a' : Math.round(r.overall.drawCalls.mean)} calls avg`,
  ];
  if (r.qualityChanges.length) parts.push(`quality ${r.qualityChanges.map((q) => `${q.from}→${q.to} ${clock(q.atS)} (${q.area} T${q.tier})`).join(', ')}`);
  const long = r.buckets.filter((b) => b.frameMs.count >= WORST_MIN_FRAMES);
  const worst = (long.length ? long : r.buckets).reduce<BucketJson | null>((w, b) => (!w || (b.frameMs.p95Ms ?? 0) > (w.frameMs.p95Ms ?? 0) ? b : w), null);
  if (worst) {
    const qualities = new Set(r.buckets.map((b) => b.quality));
    parts.push(`worst ${worst.area} T${worst.tier}${qualities.size > 1 ? ` ${worst.quality}` : ''} p95 ${ms(worst.frameMs.p95Ms)} ms`);
  }
  const heap = r.overall.heapMb;
  parts.push(heap.min === null || heap.max === null ? 'heap n/a' : `heap ${Math.round(heap.min)}–${Math.round(heap.max)} MB`);
  parts.push(r.meta.build.sha || 'no-sha');
  return parts.join(' · ');
}
