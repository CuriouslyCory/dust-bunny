import { describe, expect, it } from 'vitest';
import { PerfRecorder, summaryLine, type FrameSample, type PerfMeta, type PerfReport } from './perfRecorder';

const META: PerfMeta = {
  platform: 'android',
  build: { mode: 'native', native: true, e2e: 'perf', sha: 'a1b2c3d' },
  device: { userAgent: 'test', pixelRatio: 2, canvasPx: [800, 400], gpu: null, hardwareConcurrency: 8, deviceMemoryGb: null },
};

const sample = (over: Partial<FrameSample> = {}): FrameSample => ({
  simulating: true,
  hidden: false,
  timeScale: 1,
  area: 'house',
  tier: 1,
  quality: 'high',
  drawCalls: 100,
  debris: 500,
  ...over,
});

/** A recorder on a fake clock; `tick(frames, ms, s)` plays `frames` frames of `ms` each. */
function setup(heapMb: number | null = null) {
  let t = 1_000_000;
  const rec = new PerfRecorder({ now: () => t, readHeapMb: () => heapMb });
  const tick = (frames: number, ms: number, s: Partial<FrameSample> = {}) => {
    for (let i = 0; i < frames; i++) {
      t += ms;
      rec.frame(ms, ms / 2, sample(s));
    }
  };
  return { rec, tick, advance: (ms: number) => (t += ms) };
}

const bucket = (r: PerfReport, area: string, tier: number, quality = 'high') => r.buckets.find((b) => b.area === area && b.tier === tier && b.quality === quality);

describe('PerfRecorder', () => {
  it('records nothing until started', () => {
    const { rec, tick } = setup();
    tick(10, 16);
    rec.start();
    tick(1, 16);
    expect(rec.report(META).overall.frameMs.count).toBe(1);
  });

  it('buckets frames by Area, Tier and quality, read from every frame', () => {
    const { rec, tick } = setup();
    rec.start();
    tick(10, 16);
    tick(5, 20, { tier: 2 });
    // A resumed or new Run drops the Tier without any tierUp: frames go back to the T1 bucket.
    tick(3, 16, { tier: 1 });
    tick(4, 30, { tier: 1, quality: 'low' });
    tick(2, 40, { area: 'city', tier: 8 });
    const r = rec.report(META);
    expect(bucket(r, 'house', 1)?.frameMs.count).toBe(13);
    expect(bucket(r, 'house', 2)?.frameMs.count).toBe(5);
    expect(bucket(r, 'house', 1, 'low')?.frameMs.count).toBe(4);
    expect(bucket(r, 'city', 8)?.frameMs.count).toBe(2);
    expect(bucket(r, 'city', 8)?.tierName).toBe('Dust Hurricane');
    expect(r.buckets).toHaveLength(4);
    expect(r.overall.frameMs.count).toBe(24);
    expect(bucket(r, 'house', 2)?.durationS).toBeCloseTo(0.1, 6);
  });

  it('keeps cpu time, draw calls and Debris per bucket', () => {
    const { rec, tick } = setup();
    rec.start();
    tick(4, 20, { drawCalls: 210, debris: 900 });
    const b = rec.report(META).buckets[0]!;
    expect(b.cpuMs.p50Ms).toBeCloseTo(10, 0);
    expect(b.drawCalls).toMatchObject({ count: 4, mean: 210 });
    expect(b.debris).toMatchObject({ count: 4, mean: 900 });
  });

  it('counts excluded frames, and the first frame after a gap, without recording them', () => {
    const { rec, tick } = setup();
    rec.start();
    tick(2, 16);
    tick(3, 16, { simulating: false });
    tick(2, 900); // first one: back from pause
    tick(1, 16, { hidden: true });
    tick(2, 16, { timeScale: 2 });
    tick(2, 16); // first one: back to normal speed
    rec.markGap();
    tick(2, 16);
    const r = rec.report(META);
    expect(r.excludedFrames).toEqual({ total: 9, notSimulating: 3, hidden: 1, timeScale: 2, afterGap: 3 });
    expect(r.overall.frameMs.count).toBe(5);
    expect(r.overall.frameMs.maxMs).toBe(900);
  });

  it('lists every Run of the recording', () => {
    const { rec, tick, advance } = setup();
    rec.start();
    rec.runStarted({ seed: 'a', characterId: 'lint', difficulty: 'casual' });
    tick(2, 16);
    advance(5000);
    rec.runStarted({ seed: 'b', characterId: 'zap', difficulty: 'arcade', resumed: true });
    const runs = rec.report(META).meta.runs;
    expect(runs).toHaveLength(2);
    expect(runs[0]).toMatchObject({ seed: 'a', characterId: 'lint', difficulty: 'casual', resumed: false, atS: 0 });
    expect(runs[1]).toMatchObject({ seed: 'b', resumed: true });
    expect(runs[1]!.atS).toBeCloseTo(5.032, 3);
  });

  it('logs quality changes, capped', () => {
    const { rec, advance } = setup();
    rec.start();
    advance(2000);
    rec.qualityChanged('high', 'low', 'city', 8, 1.5);
    for (let i = 0; i < 40; i++) rec.qualityChanged('low', 'high', 'city', 8, 2);
    const r = rec.report(META);
    expect(r.qualityChanges[0]).toEqual({ atS: 2, area: 'city', tier: 8, from: 'high', to: 'low', pixelRatio: 1.5 });
    expect(r.qualityChanges).toHaveLength(32);
  });

  it('samples the heap about once a second', () => {
    const { rec, tick } = setup(120);
    rec.start();
    tick(130, 16); // ~2.1 s
    const r = rec.report(META);
    expect(r.overall.heapMb.count).toBe(3);
    expect(r.overall.heapMb.mean).toBe(120);
  });

  it('reports no heap where the browser has none', () => {
    const { rec, tick } = setup(null);
    rec.start();
    tick(130, 16);
    expect(rec.report(META).overall.heapMb.count).toBe(0);
  });

  it('estimates the refresh period from the fast frames', () => {
    const { rec, tick } = setup();
    rec.start();
    tick(900, 8.33);
    tick(100, 25);
    expect(rec.report(META).meta.refresh).toEqual({ periodMs: expect.closeTo(8.33, 1), hz: 120 });
  });

  it('starts over on start(), and stop() freezes the duration', () => {
    const { rec, tick, advance } = setup();
    rec.start();
    tick(10, 16);
    rec.start();
    tick(5, 16);
    rec.stop();
    advance(10_000);
    const r = rec.report(META);
    expect(r.overall.frameMs.count).toBe(5);
    expect(r.meta.durationS).toBeCloseTo(0.08, 6);
    expect(r.meta.recording).toBe(false);
  });

  it('carries the schema, units and the caller’s meta', () => {
    const { rec, tick } = setup();
    rec.start();
    tick(1, 16);
    const r = rec.report(META);
    expect(r.schema).toBe(1);
    expect(r.meta).toMatchObject({ platform: 'android', binMs: 0.25, maxMs: 125, build: META.build, device: META.device });
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  });
});

describe('summaryLine', () => {
  it('is one pasteable line', () => {
    let t = 0;
    const rec = new PerfRecorder({ now: () => t, readHeapMb: () => 150 });
    rec.start();
    const play = (frames: number, ms: number, s: Partial<FrameSample>) => {
      for (let i = 0; i < frames; i++) {
        t += ms;
        rec.frame(ms, 4, sample(s));
      }
    };
    play(600, 16, { drawCalls: 200 });
    t += 1000;
    rec.qualityChanged('high', 'low', 'city', 8, 1);
    play(400, 40, { area: 'city', tier: 9, quality: 'low', drawCalls: 230 });
    const line = summaryLine(rec.report(META));
    expect(line).toMatch(/^perf android 00:\d\d · 1,000 frames · p50 [\d.]+ \/ p95 [\d.]+ \/ p99 [\d.]+ ms · >33 ms 40\.0% · >50 ms 0\.0% · 212 calls avg · quality high→low 00:10 \(city T8\) · worst city T9 low p95 40\.0 ms · heap 150–150 MB · a1b2c3d$/);
    expect(line).not.toContain('\n');
  });

  it('says when there is no heap, no quality change and an overflowing percentile', () => {
    let t = 0;
    const rec = new PerfRecorder({ now: () => t, readHeapMb: () => null });
    rec.start();
    for (let i = 0; i < 10; i++) {
      t += 200;
      rec.frame(200, 4, sample());
    }
    const line = summaryLine(rec.report(META));
    expect(line).toContain('p50 ≥125 / p95 ≥125 / p99 ≥125 ms');
    expect(line).toContain('heap n/a');
    expect(line).not.toContain('quality');
    expect(line).toContain('worst house T1 p95 ≥125 ms');
  });
});
