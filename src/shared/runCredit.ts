/**
 * Run credit ledger contract shared by the client (src/meta/runCredits.ts) and `api/run-credit.ts`
 * (docs/adr/0003). The server decides, once per Run key, that a signed-in player's Run is credited
 * (Fluff and lifetime stats): a `run_credits` row is the only thing that means "credited". The
 * client computes the Fluff from the row's `stats` and applies it at most once per progress copy
 * (`Progress.creditedRuns`). Shared module (see the note in `./score.ts`).
 */
import { SCORE_TIER_MIN_RADII } from './score.js';

export type RunCreditReason = 'died' | 'victory' | 'quit';

/** A `POST /api/run-credit` body is ids plus a bounded stats subset. */
export const MAX_RUN_CREDIT_BYTES = 8_192;
/** `GET /api/run-credit` returns the newest rows: this many by default, and at most `RUN_CREDIT_LIST_MAX`. */
export const RUN_CREDIT_LIST_LIMIT = 20;
export const RUN_CREDIT_LIST_MAX = 50;
/**
 * How many Run keys a progress copy remembers as credited (`Progress.creditedRuns`, newest last).
 * Well above `RUN_CREDIT_LIST_MAX`, so a ledger row the list still returns can't have aged out of
 * the copy that applied it.
 */
export const CREDITED_RUNS_MAX = 100;
export const MAX_RUN_KEY_LENGTH = 128;
/**
 * Bounds on the stats subset (they stop garbage, not cheating: the game runs on the client). Radii
 * are real centimetres, so the ceiling is the Universe's last tier start times ten (the same as
 * `PROGRESS_BOUNDS.bestRadius`): a Galaxy Run passes 1e20 and a Universe Run 2.8e25.
 */
export const CREDIT_STATS_BOUNDS = {
  tier: 100,
  count: 100_000_000,
  radius: SCORE_TIER_MIN_RADII[SCORE_TIER_MIN_RADII.length - 1]! * 10,
  areas: 16,
  id: 40,
} as const;

/** One Area of the Run, as `fluffRadiusTerm` (src/meta/fluff.ts) reads it. */
export interface CreditAreaStats {
  area: string;
  radiusIn: number;
  maxRadius: number;
  debrisAbsorbed: number;
  cleared: boolean;
}

/** The part of a Run's stats that crediting reads (`fluffForRun` and `MetaProgress.awardRun`). */
export interface CreditStats {
  characterId?: string;
  difficulty?: string;
  maxRadius: number;
  debrisAbsorbed: number;
  tierReached: number;
  /** The Area the Run ended in (a Universe victory counts one more Universe). */
  area?: string;
  houseCleared?: boolean;
  neighborhoodCleared?: boolean;
  cityCleared?: boolean;
  regionCleared?: boolean;
  continentCleared?: boolean;
  globeCleared?: boolean;
  solarSystemCleared?: boolean;
  galaxyCleared?: boolean;
  universeCleared?: boolean;
  areas?: CreditAreaStats[];
}

const CLEARED_FLAGS = ['houseCleared', 'neighborhoodCleared', 'cityCleared', 'regionCleared', 'continentCleared', 'globeCleared', 'solarSystemCleared', 'galaxyCleared', 'universeCleared'] as const;

/** A `POST /api/run-credit` body, checked. */
export interface RunCreditClaim {
  runKey: string;
  /** The lease this device holds the Run under (see api/saved-run.ts). */
  lease: string;
  /** The lease before a take the device never heard back from. */
  prevLease?: string;
  reason: RunCreditReason;
  stats: CreditStats;
}

/** One ledger row, as the API returns it. */
export interface RunCredit {
  id: number;
  runKey: string;
  reason: RunCreditReason;
  stats: CreditStats;
  creditedAt: string;
}

export type RunCreditCheck<T> = { ok: true; value: T } | { ok: false; message: string; field?: string };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max;
const fail = (message: string, field?: string): { ok: false; message: string; field?: string } => ({ ok: false, message, field });

export function isRunKey(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= MAX_RUN_KEY_LENGTH;
}

export function isRunCreditReason(v: unknown): v is RunCreditReason {
  return v === 'died' || v === 'victory' || v === 'quit';
}

/**
 * The stats subset crediting needs, picked out of a full `RunStats` (or a stored snapshot's) and
 * bounded. Null when the required numbers are missing or out of range. Unknown fields are dropped,
 * so a row stays small whatever the client sent.
 */
export function pickCreditStats(raw: unknown): CreditStats | null {
  if (!isObj(raw)) return null;
  if (!isNum(raw.maxRadius, CREDIT_STATS_BOUNDS.radius) || !isNum(raw.debrisAbsorbed, CREDIT_STATS_BOUNDS.count) || !isNum(raw.tierReached, CREDIT_STATS_BOUNDS.tier)) return null;
  const out: CreditStats = { maxRadius: raw.maxRadius, debrisAbsorbed: raw.debrisAbsorbed, tierReached: raw.tierReached };
  const id = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= CREDIT_STATS_BOUNDS.id;
  if (id(raw.characterId)) out.characterId = raw.characterId;
  if (id(raw.difficulty)) out.difficulty = raw.difficulty;
  if (id(raw.area)) out.area = raw.area;
  for (const flag of CLEARED_FLAGS) if (raw[flag] === true) out[flag] = true;
  if (Array.isArray(raw.areas)) {
    if (raw.areas.length > CREDIT_STATS_BOUNDS.areas) return null;
    const areas: CreditAreaStats[] = [];
    for (const a of raw.areas as unknown[]) {
      if (!isObj(a) || !id(a.area)) return null;
      if (!isNum(a.radiusIn, CREDIT_STATS_BOUNDS.radius) || !isNum(a.maxRadius, CREDIT_STATS_BOUNDS.radius) || !isNum(a.debrisAbsorbed, CREDIT_STATS_BOUNDS.count)) return null;
      areas.push({ area: a.area, radiusIn: a.radiusIn, maxRadius: a.maxRadius, debrisAbsorbed: a.debrisAbsorbed, cleared: a.cleared === true });
    }
    out.areas = areas;
  }
  return out;
}

/**
 * Best-effort `CreditStats` from stats `pickCreditStats` refused: each required number is kept
 * where it is a finite non-negative number (clamped to its bound) and 0 otherwise; Areas that
 * read are kept, the rest dropped. For a stored copy the server credits on its own (a replace),
 * where refusing is not an option and zeros would lose the player the Run. The client should
 * never need it: a Run's own `RunStats` always pass `pickCreditStats`.
 */
export function salvageCreditStats(raw: unknown): CreditStats {
  const src = isObj(raw) ? raw : {};
  const num = (v: unknown, max: number): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(v, max) : 0);
  const out: CreditStats = {
    maxRadius: num(src.maxRadius, CREDIT_STATS_BOUNDS.radius),
    debrisAbsorbed: num(src.debrisAbsorbed, CREDIT_STATS_BOUNDS.count),
    tierReached: num(src.tierReached, CREDIT_STATS_BOUNDS.tier),
  };
  const id = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= CREDIT_STATS_BOUNDS.id;
  if (id(src.characterId)) out.characterId = src.characterId;
  if (id(src.difficulty)) out.difficulty = src.difficulty;
  if (id(src.area)) out.area = src.area;
  for (const flag of CLEARED_FLAGS) if (src[flag] === true) out[flag] = true;
  if (Array.isArray(src.areas)) {
    const areas: CreditAreaStats[] = [];
    for (const a of src.areas as unknown[]) {
      if (areas.length === CREDIT_STATS_BOUNDS.areas) break;
      if (!isObj(a) || !id(a.area)) continue;
      areas.push({ area: a.area, radiusIn: num(a.radiusIn, CREDIT_STATS_BOUNDS.radius), maxRadius: num(a.maxRadius, CREDIT_STATS_BOUNDS.radius), debrisAbsorbed: num(a.debrisAbsorbed, CREDIT_STATS_BOUNDS.count), cleared: a.cleared === true });
    }
    if (areas.length) out.areas = areas;
  }
  return out;
}

export function validateRunCreditClaim(body: unknown): RunCreditCheck<RunCreditClaim> {
  if (!isObj(body)) return fail('Body must be an object.');
  if (!isRunKey(body.runKey)) return fail('runKey must be a non-empty string.', 'runKey');
  if (!isRunKey(body.lease)) return fail('lease must be a non-empty string.', 'lease');
  if (body.prevLease !== undefined && !isRunKey(body.prevLease)) return fail('prevLease must be a non-empty string.', 'prevLease');
  if (!isRunCreditReason(body.reason)) return fail('reason must be died, victory or quit.', 'reason');
  const stats = pickCreditStats(body.stats);
  if (!stats) return fail('stats must hold maxRadius, debrisAbsorbed and tierReached in range.', 'stats');
  return { ok: true, value: { runKey: body.runKey, lease: body.lease, ...(body.prevLease !== undefined ? { prevLease: body.prevLease as string } : {}), reason: body.reason, stats } };
}

/** Validates a `creditedRuns` field: missing reads as unknown (undefined); present, at most `CREDITED_RUNS_MAX` distinct keys. */
export function validateCreditedRuns(raw: unknown): { ok: true; value: string[] | undefined } | { ok: false; message: string } {
  if (raw === undefined) return { ok: true, value: undefined };
  if (!Array.isArray(raw)) return { ok: false, message: 'creditedRuns must be an array of Run keys.' };
  if (raw.length > CREDITED_RUNS_MAX) return { ok: false, message: `creditedRuns holds more than ${CREDITED_RUNS_MAX} keys.` };
  const out: string[] = [];
  for (const k of raw as unknown[]) {
    if (!isRunKey(k)) return { ok: false, message: 'creditedRuns must be an array of Run keys.' };
    if (!out.includes(k)) out.push(k);
  }
  return { ok: true, value: out };
}

/** Same set of credited Run keys; a missing field (an older bundle or row) counts as the same. */
export function sameCreditedRuns(a: string[] | undefined, b: string[] | undefined): boolean {
  if (a === undefined || b === undefined) return true;
  return a.length === b.length && a.every((k) => b.includes(k));
}
