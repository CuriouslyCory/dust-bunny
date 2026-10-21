/**
 * Leaderboard client. Talks to `/api/leaderboard` (see api/leaderboard.ts) and falls back to
 * a localStorage leaderboard when the API is unavailable: 404 (plain `pnpm dev`, static
 * hosting), non-JSON responses, 5xx/503 (no database), network errors and timeouts.
 * Validation (400) and rate-limit (429) errors are thrown as `LeaderboardError` instead.
 *
 *   const { entries, online } = await getTop({ character: 'zap' });
 *   const { rank, entry, online } = await submitScore(submissionFromRun(stats, reason, name));
 */
import type { RunEndReason, RunStats } from '../game/runStats';
import { DEFAULT_DIFFICULTY, isDifficultyId } from '../shared/difficulty';
import {
  cleanName,
  compareEntries,
  isLeaderboardCharacter,
  LEADERBOARD_SIZE,
  validateSubmission,
  type LeaderboardCharacter,
  type LeaderboardEntry,
  type ScoreSubmission,
} from '../shared/leaderboard';
import { computeScore } from '../shared/score';

export type { LeaderboardEntry, ScoreSubmission } from '../shared/leaderboard';

export interface TopResult {
  entries: LeaderboardEntry[];
  /** False when served from the local fallback. */
  online: boolean;
}

export interface SubmitResult {
  entry: LeaderboardEntry;
  /** 1-based rank on the board the entry went to (global online board, or local). */
  rank: number | null;
  online: boolean;
  nameCensored: boolean;
}

export class LeaderboardError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly field?: string,
  ) {
    super(message);
  }
}

export interface LeaderboardClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
  /** After the API looks unavailable, skip it for this long (ms) and use local scores. */
  offlineRetryMs?: number;
  fetch?: typeof fetch;
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  now?: () => number;
}

const LOCAL_KEY = 'dustbunny.leaderboard.local.v1';
const NAME_KEY = 'dustbunny.playerName';
/** Local entries kept (top N overall), so per-character views still have 20 rows. */
const LOCAL_KEEP = 100;

/** Thrown internally when the API is unreachable; triggers the local fallback. */
class Unavailable extends Error {}

function defaultStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function createLeaderboardClient(opts: LeaderboardClientOptions = {}) {
  const baseUrl = opts.baseUrl ?? '/api/leaderboard';
  const timeoutMs = opts.timeoutMs ?? 4000;
  const offlineRetryMs = opts.offlineRetryMs ?? 30_000;
  const doFetch = opts.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const storage = opts.storage === undefined ? defaultStorage() : opts.storage;
  const now = opts.now ?? Date.now;

  let online: boolean | null = null;
  let skipUntil = 0;

  async function request(path: string, init?: RequestInit): Promise<unknown> {
    if (online === false && now() < skipUntil) throw new Unavailable('skipping');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res: Response;
    try {
      res = await doFetch(baseUrl + path, { ...init, signal: ctrl.signal, headers: { Accept: 'application/json', ...init?.headers } });
    } catch {
      throw markOffline();
    } finally {
      clearTimeout(timer);
    }
    const isJson = (res.headers.get('content-type') ?? '').includes('application/json');
    if (!isJson || res.status === 404 || res.status >= 500) throw markOffline();
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw markOffline();
    }
    online = true;
    if (!res.ok) {
      const b = (body ?? {}) as { error?: string; message?: string; field?: string };
      throw new LeaderboardError(b.message ?? `Leaderboard error ${res.status}`, b.error ?? 'error', b.field);
    }
    return body;
  }

  function markOffline(): Unavailable {
    online = false;
    skipUntil = now() + offlineRetryMs;
    return new Unavailable('offline');
  }

  function readLocal(): LeaderboardEntry[] {
    try {
      const raw = storage?.getItem(LOCAL_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) return [];
      // Entries stored before Difficulty existed lack the field: they were casual Runs.
      // Local entries are never verified (only the server can vouch for an account).
      return (parsed as LeaderboardEntry[])
        .filter((e) => e && typeof e.score === 'number')
        .map((e) => ({ ...e, difficulty: isDifficultyId(e.difficulty) ? e.difficulty : DEFAULT_DIFFICULTY, verified: false }));
    } catch {
      return [];
    }
  }

  function writeLocal(entries: LeaderboardEntry[]): void {
    try {
      storage?.setItem(LOCAL_KEY, JSON.stringify(entries.slice(0, LOCAL_KEEP)));
    } catch {
      /* storage full or blocked: keep going without persistence */
    }
  }

  function localTop(character?: LeaderboardCharacter): LeaderboardEntry[] {
    return readLocal()
      .filter((e) => !character || e.character === character)
      .sort(compareEntries)
      .slice(0, LEADERBOARD_SIZE);
  }

  return {
    /** Last known API status: true online, false using local fallback, null not yet known. */
    isOnline(): boolean | null {
      return online;
    },

    async getTop(o: { character?: string } = {}): Promise<TopResult> {
      const character = isLeaderboardCharacter(o.character) ? o.character : undefined;
      try {
        const body = (await request(character ? `?character=${encodeURIComponent(character)}` : '')) as { entries?: LeaderboardEntry[] };
        return { entries: Array.isArray(body.entries) ? body.entries : [], online: true };
      } catch (err) {
        if (!(err instanceof Unavailable)) throw err;
        return { entries: localTop(character), online: false };
      }
    },

    async submitScore(sub: ScoreSubmission): Promise<SubmitResult> {
      const v = validateSubmission(sub);
      if (!v.ok) throw new LeaderboardError(v.message, 'invalid', v.field);
      try {
        const body = (await request('', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...sub, name: v.value.name }),
        })) as { entry: LeaderboardEntry; rank: number | null; nameCensored?: boolean };
        return { entry: body.entry, rank: body.rank ?? null, online: true, nameCensored: Boolean(body.nameCensored) };
      } catch (err) {
        if (!(err instanceof Unavailable)) throw err;
        const { nameCensored: _c, ...fields } = v.value;
        const entry: LeaderboardEntry = { ...fields, id: `local-${now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, verified: false, createdAt: new Date(now()).toISOString() };
        const all = [...readLocal(), entry].sort(compareEntries);
        writeLocal(all);
        const idx = all.indexOf(entry);
        return { entry, rank: idx < 0 || idx >= LOCAL_KEEP ? null : idx + 1, online: false, nameCensored: v.value.nameCensored };
      }
    },

    getPlayerName(): string {
      try {
        return storage?.getItem(NAME_KEY) ?? '';
      } catch {
        return '';
      }
    },

    setPlayerName(name: string): void {
      try {
        storage?.setItem(NAME_KEY, cleanName(name).name);
      } catch {
        /* ignore */
      }
    },
  };
}

export type LeaderboardClient = ReturnType<typeof createLeaderboardClient>;

/** Builds a submission from Run results (score computed with the shared formula). */
export function submissionFromRun(stats: RunStats, reason: RunEndReason, name: string): ScoreSubmission {
  const fields = {
    maxRadius: Math.round(stats.maxRadius * 100) / 100,
    debrisAbsorbed: stats.debrisAbsorbed,
    tierReached: stats.tierReached,
    durationMs: Math.round(stats.timeSec * 1000),
    victory: reason === 'victory',
    difficulty: stats.difficulty ?? DEFAULT_DIFFICULTY,
  };
  return { name, character: stats.characterId, ...fields, score: computeScore(fields) };
}

/** Default client for the game (uses fetch + localStorage). */
export const leaderboard = createLeaderboardClient();
export const getTop = leaderboard.getTop;
export const submitScore = leaderboard.submitScore;
export const isOnline = leaderboard.isOnline;
