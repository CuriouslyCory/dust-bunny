/**
 * Fixed-size frame-time histogram for the frame recorder (./perfRecorder.ts): linear bins
 * `BIN_MS` wide from 0 to `MAX_MS`, an overflow count above that, and the exact min and max.
 * `add` is O(1) and allocates nothing, so a recording costs the same memory after 15 minutes as
 * after one second. Percentiles interpolate within a bin, so they're within `BIN_MS` of exact.
 */
export const BIN_MS = 0.25;
export const MAX_MS = 125;
const BINS = MAX_MS / BIN_MS;

const round3 = (v: number): number => Math.round(v * 1000) / 1000;

export interface HistogramJson {
  count: number;
  meanMs: number | null;
  minMs: number | null;
  maxMs: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  /** Frames strictly over 33 ms (missed a 30 Hz deadline). */
  over33: number;
  /** Frames strictly over 50 ms. */
  over50: number;
  /** Frames at or over `MAX_MS`: no bin, only `maxMs`. */
  overflow: number;
  /** Non-empty bins, `[index, count]`: bin `i` covers `[i × binMs, (i + 1) × binMs)`. */
  bins: Array<[number, number]>;
}

export class FrameHistogram {
  readonly bins = new Uint32Array(BINS);
  overflow = 0;
  count = 0;
  sum = 0;
  minMs = Infinity;
  maxMs = -Infinity;
  over33 = 0;
  over50 = 0;

  add(ms: number): void {
    if (!(ms > 0)) ms = 0;
    const i = Math.floor(ms / BIN_MS);
    if (i < BINS) this.bins[i]!++;
    else this.overflow++;
    this.count++;
    this.sum += ms;
    if (ms < this.minMs) this.minMs = ms;
    if (ms > this.maxMs) this.maxMs = ms;
    if (ms > 33) this.over33++;
    if (ms > 50) this.over50++;
  }

  /**
   * The `p`th percentile (0–100) in ms; NaN when empty. A percentile that falls in the overflow
   * reads `MAX_MS` (p100 is always the exact max).
   */
  percentile(p: number): number {
    if (this.count === 0) return NaN;
    if (p >= 100) return this.maxMs;
    const target = (Math.max(0, p) / 100) * this.count;
    let cum = 0;
    for (let i = 0; i < BINS; i++) {
      const c = this.bins[i]!;
      if (c > 0 && cum + c >= target) {
        const v = (i + (target - cum) / c) * BIN_MS;
        return Math.min(this.maxMs, Math.max(this.minMs, v));
      }
      cum += c;
    }
    return MAX_MS;
  }

  merge(other: FrameHistogram): void {
    for (let i = 0; i < BINS; i++) this.bins[i]! += other.bins[i]!;
    this.overflow += other.overflow;
    this.count += other.count;
    this.sum += other.sum;
    this.minMs = Math.min(this.minMs, other.minMs);
    this.maxMs = Math.max(this.maxMs, other.maxMs);
    this.over33 += other.over33;
    this.over50 += other.over50;
  }

  toJSON(): HistogramJson {
    const empty = this.count === 0;
    const pct = (p: number) => (empty ? null : round3(this.percentile(p)));
    const bins: Array<[number, number]> = [];
    for (let i = 0; i < BINS; i++) if (this.bins[i]) bins.push([i, this.bins[i]!]);
    return {
      count: this.count,
      meanMs: empty ? null : round3(this.sum / this.count),
      minMs: empty ? null : round3(this.minMs),
      maxMs: empty ? null : round3(this.maxMs),
      p50Ms: pct(50),
      p95Ms: pct(95),
      p99Ms: pct(99),
      over33: this.over33,
      over50: this.over50,
      overflow: this.overflow,
      bins,
    };
  }
}

export interface StatJson {
  count: number;
  mean: number | null;
  min: number | null;
  max: number | null;
}

/** Count, mean, min and max of a per-frame value (draw calls, Debris, heap). */
export class Stat {
  count = 0;
  sum = 0;
  min = Infinity;
  max = -Infinity;

  add(v: number): void {
    this.count++;
    this.sum += v;
    if (v < this.min) this.min = v;
    if (v > this.max) this.max = v;
  }

  merge(other: Stat): void {
    this.count += other.count;
    this.sum += other.sum;
    this.min = Math.min(this.min, other.min);
    this.max = Math.max(this.max, other.max);
  }

  toJSON(): StatJson {
    if (this.count === 0) return { count: 0, mean: null, min: null, max: null };
    return { count: this.count, mean: round3(this.sum / this.count), min: round3(this.min), max: round3(this.max) };
  }
}
