/**
 * A recorded Run: a deterministic Run driven through several Areas (cleared, skipped, rewound by the
 * cheats, the black-hole Form) whose snapshots, RunStats and CreditStats were saved as JSON before
 * Area progress became one value in `Run` (#67). They must stay byte-identical, and the stored
 * snapshots (saved by that older build) must still resume.
 *
 * `RECORD=1 pnpm vitest run src/game/recordedRun.test.ts` rewrites the fixture; only do that for a
 * change that is meant to alter saved data (and then ADR 0001 applies).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../core/events';
import { creditStatsOf } from '../meta/accountRun';
import { createRun } from './assembly';
import type { Run } from './run';
import { parseRunSnapshot, type RunSnapshot } from './snapshot';

const FIXTURE = new URL('./__fixtures__/recordedRun.json', import.meta.url);
const DT = 1 / 60;
const step = (run: Run, seconds: number) => {
  for (let i = 0; i < Math.round(seconds / DT) && !run.ended; i++) run.update(DT);
};
const json = (v: unknown) => JSON.stringify(v);
const resume = (s: RunSnapshot) =>
  createRun(new EventBus(), { seed: s.seed, characterId: s.characterId, difficulty: s.difficulty, modifiers: s.modifiers, loadout: s.loadout, resume: s });

interface Recording {
  snapshots: Record<string, unknown>;
  stats: unknown;
  credit: unknown;
  resumed: Record<string, unknown>;
}

function record(): Recording {
  const snapshots: Record<string, unknown> = {};
  const run = createRun(new EventBus(), { seed: 'recorded-run', characterId: 'tumble', difficulty: 'arcade' });
  step(run, 2);
  run.openExit();
  snapshots.houseCleared = run.toSnapshot();
  run.enterNextArea();
  step(run, 2);
  snapshots.neighborhood = run.toSnapshot();
  run.openExit();
  run.enterNextArea();
  step(run, 1);
  // Left without clearing it: entering a later Area counts it as cleared.
  run.enterArea('region');
  step(run, 1);
  snapshots.region = run.toSnapshot();
  // The cheats' jump back: the City and every Area after it count as not cleared again.
  run.jumpToArea('city', 50);
  step(run, 1);
  snapshots.rewound = run.toSnapshot();
  run.jumpToArea('universe', 1);
  step(run, 1);
  snapshots.universe = run.toSnapshot();
  run.jumpToArea('galaxy', 1);
  step(run, 1);
  snapshots.galaxy = run.toSnapshot();
  run.openExit();
  snapshots.galaxyCleared = run.toSnapshot();
  run.enterNextArea();
  step(run, 1);
  run.clearArea();
  const stats = run.getStats();

  const resumed: Record<string, unknown> = {};
  for (const [k, s] of Object.entries(snapshots)) {
    const back = resume(parseRunSnapshot(JSON.parse(json(s)))!);
    step(back, 1);
    resumed[k] = back.toSnapshot();
  }
  return { snapshots, stats, credit: creditStatsOf(stats), resumed };
}

describe('a recorded Run', () => {
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(1_760_000_000_000);
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000067');
  });
  afterEach(() => vi.restoreAllMocks());

  it('keeps its snapshots, RunStats and CreditStats byte-identical', () => {
    const now = record();
    if (process.env.RECORD) writeFileSync(FIXTURE, `${JSON.stringify(now, null, 1)}\n`);
    else if (!existsSync(FIXTURE)) throw new Error('recordedRun.json is missing: run with RECORD=1 only for a change meant to alter saved data');
    const was = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Recording;
    for (const k of Object.keys(was.snapshots)) expect(json(now.snapshots[k]), `snapshot ${k}`).toBe(json(was.snapshots[k]));
    expect(json(now.stats)).toBe(json(was.stats));
    expect(json(now.credit)).toBe(json(was.credit));
    for (const k of Object.keys(was.resumed)) expect(json(now.resumed[k]), `resumed ${k}`).toBe(json(was.resumed[k]));
  });

  it('resumes the snapshots the older build stored, as that build resumed them', () => {
    const was = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Recording;
    for (const [k, s] of Object.entries(was.snapshots)) {
      const back = resume(parseRunSnapshot(s)!);
      step(back, 1);
      expect(json(back.toSnapshot()), `resumed ${k}`).toBe(json(was.resumed[k]));
    }
  });

  it('resumes a snapshot saved before runKey and startArea existed', () => {
    const was = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Recording;
    const { runKey: _key, startArea: _start, ...old } = was.snapshots.galaxyCleared as RunSnapshot;
    const back = resume(parseRunSnapshot(old)!);
    expect(back.runKey).toBe('seed:recorded-run:tumble');
    expect(back.area).toBe('galaxy');
    expect(back.isAreaCleared('galaxy')).toBe(true);
    expect(back.canLeaveArea).toBe(true);
    expect(back.bunny.form).toBe('black_hole');
    expect(back.getStats()).toMatchObject({ houseCleared: true, solarSystemCleared: true, galaxyCleared: true, universeCleared: false });
  });
});
