/**
 * Cloud save contract shared by the client (`src/meta/cloudSave.ts`) and `api/progress.ts`:
 * the part of the meta save that follows a signed-in player between devices (Fluff wallet,
 * Upgrade levels, lifetime stats). Settings, last Character and Difficulty stay per device.
 * Pure and dependency-free (see the note in `./score.ts`).
 *
 * Which copy wins: the one with more lifetime Fluff earned (`stats.totalFluffEarned` only ever
 * grows), then more Runs; on a tie the server copy wins on download and the upload wins on the
 * server (so spending Fluff, which changes neither counter, still syncs).
 */

export interface ProgressStats {
  runs: number;
  wins: number;
  bestRadius: number;
  bestTier: number;
  totalFluffEarned: number;
}

export interface Progress {
  fluff: number;
  /** Upgrade id → owned level (levels ≥ 1 only). */
  upgrades: Record<string, number>;
  stats: ProgressStats;
}

/** Generous sanity bounds: they stop garbage, not determined cheating (the game runs on the client). */
export const PROGRESS_BOUNDS = {
  fluff: 100_000_000,
  upgradeLevel: 100,
  upgradeCount: 64,
  count: 10_000_000,
  bestRadius: 100_000,
  bestTier: 100,
} as const;

const UPGRADE_ID = /^[a-z][a-z0-9_]{0,39}$/;

export type ProgressValidation = { ok: true; value: Progress } | { ok: false; field: string; message: string };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isCount = (v: unknown, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max;

/** Validates an untrusted progress body (also used to read rows back from the database). */
export function validateProgress(body: unknown): ProgressValidation {
  const fail = (field: string, message: string): ProgressValidation => ({ ok: false, field, message });
  if (!isObj(body)) return fail('body', 'Expected a JSON object.');
  if (!isCount(body.fluff, PROGRESS_BOUNDS.fluff)) return fail('fluff', 'fluff must be a non-negative integer.');

  if (!isObj(body.upgrades)) return fail('upgrades', 'upgrades must be an object.');
  const entries = Object.entries(body.upgrades);
  if (entries.length > PROGRESS_BOUNDS.upgradeCount) return fail('upgrades', 'Too many upgrades.');
  const upgrades: Record<string, number> = {};
  for (const [id, level] of entries) {
    if (!UPGRADE_ID.test(id)) return fail('upgrades', `Invalid upgrade id "${id.slice(0, 40)}".`);
    if (!isCount(level, PROGRESS_BOUNDS.upgradeLevel)) return fail('upgrades', `Invalid level for "${id}".`);
    if (level > 0) upgrades[id] = level;
  }

  const s = body.stats;
  if (!isObj(s)) return fail('stats', 'stats must be an object.');
  const { runs, wins, bestRadius, bestTier, totalFluffEarned } = s;
  if (!isCount(runs, PROGRESS_BOUNDS.count)) return fail('stats.runs', 'runs must be a non-negative integer.');
  if (!isCount(wins, PROGRESS_BOUNDS.count) || wins > runs) return fail('stats.wins', 'wins must be an integer between 0 and runs.');
  if (typeof bestRadius !== 'number' || !Number.isFinite(bestRadius) || bestRadius < 0 || bestRadius > PROGRESS_BOUNDS.bestRadius)
    return fail('stats.bestRadius', 'bestRadius out of range.');
  if (!isCount(bestTier, PROGRESS_BOUNDS.bestTier)) return fail('stats.bestTier', 'bestTier out of range.');
  if (!isCount(totalFluffEarned, PROGRESS_BOUNDS.count * 100)) return fail('stats.totalFluffEarned', 'totalFluffEarned out of range.');

  return { ok: true, value: { fluff: body.fluff, upgrades, stats: { runs, wins, bestRadius, bestTier, totalFluffEarned } } };
}

/** Positive when `a` holds more progress than `b`, 0 on a tie. */
export function compareProgress(a: Progress, b: Progress): number {
  return a.stats.totalFluffEarned - b.stats.totalFluffEarned || a.stats.runs - b.stats.runs;
}

/** True when the progress is a fresh, never-played save. */
export function isEmptyProgress(p: Progress): boolean {
  return p.fluff === 0 && p.stats.runs === 0 && p.stats.totalFluffEarned === 0 && Object.keys(p.upgrades).length === 0;
}

/** Deep equality for the synced fields (upgrade key order ignored). */
export function sameProgress(a: Progress, b: Progress): boolean {
  const ka = Object.keys(a.upgrades);
  if (ka.length !== Object.keys(b.upgrades).length || ka.some((k) => a.upgrades[k] !== b.upgrades[k])) return false;
  const sa = a.stats;
  const sb = b.stats;
  return (
    a.fluff === b.fluff &&
    sa.runs === sb.runs &&
    sa.wins === sb.wins &&
    sa.bestRadius === sb.bestRadius &&
    sa.bestTier === sb.bestTier &&
    sa.totalFluffEarned === sb.totalFluffEarned
  );
}
