/**
 * Leaderboard API (Vercel Node function, Web-standard fetch handler).
 *
 *   GET  /api/leaderboard[?board=…][&character=lint|tumble|zap]  -> 200 { entries } (top 20)
 *   POST /api/leaderboard[?board=…]  body: submission            -> 201 { entry, rank, nameCensored }
 *
 * Boards: `run` (default: whole Runs, body ScoreSubmission, rows LeaderboardEntry) and one Area
 * board per Area, `house` | `neighborhood` | `city` (a Run clearing that Area, body
 * AreaScoreSubmission, rows AreaLeaderboardEntry). See src/shared/leaderboard.ts.
 *
 * A POST with a valid session cookie (see server/auth.ts) stores the player's user id, and the entry
 * comes back `verified: true`; without one the entry is anonymous (`verified: false`). Signed-in
 * players post every Run automatically, so a board lists each signed-in player once, with their
 * best entry; anonymous entries are listed individually. `rank` is where the posted entry places
 * among those listed entries (a signed-in player's own better entry counts too).
 *
 * A submission may carry a client-generated `runId`. Posting the same Run to the same board again
 * (a retry after a timeout, say) returns the stored entry with 200 instead of adding a second row.
 *
 * Errors are JSON `{ error: code, message, field? }`: 400 invalid / bad_json, 405, 413,
 * 429 rate_limited (with Retry-After), 503 unavailable (no DATABASE_URL or DB down; the
 * client then falls back to its local leaderboard), 500 server_error.
 *
 * Needs DATABASE_URL (injected by the Vercel Neon integration). Optional LEADERBOARD_IP_SALT
 * salts the stored IP hashes. Tables are created on first use (server/schema.ts, mirrored in
 * db/schema.sql); columns added later are applied with idempotent `ADD COLUMN IF NOT EXISTS`.
 *
 * Entries carry the Run's Loadout (`loadout`: up to two `{ type, grade }` Keepsakes, column
 * `loadout jsonb`, NULL for older clients that send none).
 *
 * Every Difficulty shares one board: submitted scores already include the Difficulty
 * multiplier (see src/shared/score.ts), and each entry carries its `difficulty`.
 *
 * Imports from src/ use `.js` extensions: Vercel runs this file as native ESM.
 */
import { createHash } from 'node:crypto';
import { DEFAULT_DIFFICULTY, isDifficultyId } from '../src/shared/difficulty.js';
import { parseLoadout } from '../src/shared/keepsakes.js';
import {
  BOARD_IDS,
  isAreaBoardId,
  isBoardId,
  isLeaderboardCharacter,
  LEADERBOARD_CHARACTERS,
  LEADERBOARD_SIZE,
  validateAreaSubmission,
  validateSubmission,
  type AnyLeaderboardEntry,
  type AreaLeaderboardEntry,
  type BoardId,
  type LeaderboardEntry,
} from '../src/shared/leaderboard.js';
import { sessionUser } from '../server/auth.js';
import { ensureSchema, query } from '../server/db.js';
import { errorResponse, HttpError, json, readJson } from '../server/http.js';

const MAX_BODY_BYTES = 2048;
/**
 * Accepted submissions per window and table (checked against the table, so it holds across instances):
 * per IP for anonymous posts, per account for signed-in ones, which post every Run automatically.
 */
const RATE_LIMIT = {
  anonymous: { run: 6, area: 9 },
  account: { run: 30, area: 30 },
  windowSec: 600,
};
/** Best-effort per-instance burst limit on all POSTs (including rejected ones). One Run posts up to four entries. */
const BURST_LIMIT = { max: 12, windowMs: 60_000 };

const burst = new Map<string, number[]>();

interface Row {
  id: string | number;
  name: string;
  character: string;
  score: number;
  max_radius: number;
  debris_absorbed: number;
  duration_ms: number;
  difficulty: string | null;
  verified: boolean;
  /** jsonb [{ type, grade }], NULL for entries from clients before Keepsakes. */
  loadout: unknown;
  created_at: string | Date;
  // Run board
  tier_reached?: number;
  victory?: boolean;
  // Area boards
  area?: string;
  radius_in?: number;
}

function common(r: Row) {
  const character = isLeaderboardCharacter(r.character) ? r.character : ('lint' as const);
  const loadout = r.loadout == null ? null : parseLoadout(character, r.loadout);
  return {
    id: String(r.id),
    name: r.name,
    character,
    score: Number(r.score),
    maxRadius: Number(r.max_radius),
    debrisAbsorbed: Number(r.debris_absorbed),
    durationMs: Number(r.duration_ms),
    difficulty: isDifficultyId(r.difficulty) ? r.difficulty : DEFAULT_DIFFICULTY,
    verified: Boolean(r.verified),
    ...(loadout ? { loadout } : {}),
    createdAt: new Date(r.created_at).toISOString(),
  };
}

const toRunEntry = (r: Row): LeaderboardEntry => ({ ...common(r), tierReached: Number(r.tier_reached), victory: Boolean(r.victory) });
const toAreaEntry = (r: Row): AreaLeaderboardEntry => ({
  ...common(r),
  area: isAreaBoardId(r.area) ? r.area : 'house',
  radiusIn: Number(r.radius_in),
});

const RUN_COLUMNS = 'id, name, character, score, max_radius, debris_absorbed, tier_reached, duration_ms, victory, difficulty, loadout, user_id IS NOT NULL AS verified, created_at';
const AREA_COLUMNS = 'id, area, name, character, score, radius_in, max_radius, debris_absorbed, duration_ms, difficulty, loadout, user_id IS NOT NULL AS verified, created_at';

interface BoardSql {
  table: 'leaderboard_scores' | 'area_scores';
  columns: string;
  toEntry(r: Row): AnyLeaderboardEntry;
  /** WHERE clause selecting this board's rows (params start at $1) and its params. */
  scope: { sql: string; params: unknown[] };
}

function boardSql(board: BoardId): BoardSql {
  if (board === 'run') return { table: 'leaderboard_scores', columns: RUN_COLUMNS, toEntry: toRunEntry, scope: { sql: 'TRUE', params: [] } };
  return { table: 'area_scores', columns: AREA_COLUMNS, toEntry: toAreaEntry, scope: { sql: 'area = $1', params: [board] } };
}

/**
 * The listed entries: every anonymous row, plus each signed-in player's best. Two halves so each can
 * use its index (score for anonymous rows, user_id + score for players). `limit` caps the anonymous
 * half, which is all a top-N needs from it.
 */
const listed = (table: string, where: string, limit = '') =>
  `(SELECT * FROM ${table} WHERE ${where} AND user_id IS NULL ORDER BY score DESC, id ASC ${limit})
   UNION ALL
   (SELECT DISTINCT ON (user_id) * FROM ${table} WHERE ${where} AND user_id IS NOT NULL ORDER BY user_id, score DESC, id ASC)`;

function readBoard(url: URL): BoardId {
  const board = url.searchParams.get('board') ?? 'run';
  if (!isBoardId(board)) throw new HttpError(400, 'invalid', `Unknown board; expected one of ${BOARD_IDS.join(', ')}.`, { field: 'board' });
  return board;
}

async function getTop(url: URL): Promise<Response> {
  const b = boardSql(readBoard(url));
  const character = url.searchParams.get('character');
  if (character !== null && !isLeaderboardCharacter(character))
    throw new HttpError(400, 'invalid', `Unknown character; expected one of ${LEADERBOARD_CHARACTERS.join(', ')}.`, { field: 'character' });
  await ensureSchema();
  const params = [...b.scope.params];
  let where = b.scope.sql;
  if (character) {
    params.push(character);
    where += ` AND character = $${params.length}`;
  }
  params.push(LEADERBOARD_SIZE);
  const n = `$${params.length}`;
  const rows = await query<Row>(`SELECT ${b.columns} FROM (${listed(b.table, where, `LIMIT ${n}`)}) best ORDER BY score DESC, id ASC LIMIT ${n}`, params);
  return json(200, { entries: rows.map(b.toEntry) });
}

function clientIp(request: Request): string {
  const fwd = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return fwd || request.headers.get('x-real-ip') || 'unknown';
}

function hashIp(ip: string): string {
  const salt = process.env.LEADERBOARD_IP_SALT ?? 'dust-bunny-leaderboard';
  return createHash('sha256').update(`${salt}:${ip}`).digest('hex').slice(0, 32);
}

function checkBurst(ipHash: string, now = Date.now()): void {
  const recent = (burst.get(ipHash) ?? []).filter((t) => now - t < BURST_LIMIT.windowMs);
  if (recent.length >= BURST_LIMIT.max) {
    const retry = Math.ceil((BURST_LIMIT.windowMs - (now - recent[0]!)) / 1000);
    throw new HttpError(429, 'rate_limited', 'Too many submissions; try again shortly.', { retryAfterSec: retry }, { 'Retry-After': String(retry) });
  }
  recent.push(now);
  burst.set(ipHash, recent);
  if (burst.size > 5000) burst.clear();
}

async function checkRateLimit(table: BoardSql['table'], ipHash: string, userId: string | null): Promise<void> {
  const kind = table === 'leaderboard_scores' ? 'run' : 'area';
  const max = userId ? RATE_LIMIT.account[kind] : RATE_LIMIT.anonymous[kind];
  const windowSec = RATE_LIMIT.windowSec;
  const [recent] = await query<{ n: number; oldest: number | null }>(
    `SELECT count(*)::int AS n, extract(epoch FROM min(created_at))::float AS oldest
       FROM ${table} WHERE ${userId ? 'user_id = $1' : 'ip_hash = $1 AND user_id IS NULL'} AND created_at > now() - make_interval(secs => $2)`,
    [userId ?? ipHash, windowSec],
  );
  if (recent && recent.n >= max) {
    const retry = Math.max(1, Math.ceil((recent.oldest ?? Date.now() / 1000) + windowSec - Date.now() / 1000));
    throw new HttpError(429, 'rate_limited', 'Too many submissions; try again later.', { retryAfterSec: retry }, { 'Retry-After': String(retry) });
  }
}

/** Where `entry` places among the board's listed entries (1-based), as if it were listed itself. */
async function rankOf(b: BoardSql, entry: AnyLeaderboardEntry): Promise<number | null> {
  const n = b.scope.params.length;
  const [row] = await query<{ rank: number }>(
    `SELECT count(*)::int + 1 AS rank FROM (${listed(b.table, b.scope.sql)}) best
      WHERE (score > $${n + 1} OR (score = $${n + 1} AND id < $${n + 2}))`,
    [...b.scope.params, entry.score, entry.id],
  );
  return row?.rank ?? null;
}

/** The jsonb value for a validated Loadout (NULL when an older client sent none). */
const loadoutJson = (l: unknown[] | undefined): string | null => (l ? JSON.stringify(l) : null);

/** A submission validated for its board, as the INSERT's column list and values. */
function prepareInsert(board: BoardId, body: unknown): { columns: string[]; values: unknown[]; runId?: string; nameCensored: boolean } {
  if (board === 'run') {
    const r = validateSubmission(body);
    if (!r.ok) throw new HttpError(400, 'invalid', r.message, { field: r.field });
    const s = r.value;
    return {
      columns: ['name', 'character', 'score', 'max_radius', 'debris_absorbed', 'tier_reached', 'duration_ms', 'victory', 'difficulty', 'run_id', 'loadout'],
      values: [s.name, s.character, s.score, s.maxRadius, s.debrisAbsorbed, s.tierReached, s.durationMs, s.victory, s.difficulty, s.runId ?? null, loadoutJson(s.loadout)],
      runId: s.runId,
      nameCensored: s.nameCensored,
    };
  }
  const r = validateAreaSubmission(body);
  if (!r.ok) throw new HttpError(400, 'invalid', r.message, { field: r.field });
  const s = r.value;
  if (s.area !== board) throw new HttpError(400, 'invalid', `This entry is for the ${s.area} board.`, { field: 'area' });
  return {
    columns: ['area', 'name', 'character', 'score', 'radius_in', 'max_radius', 'debris_absorbed', 'duration_ms', 'difficulty', 'run_id', 'loadout'],
    values: [s.area, s.name, s.character, s.score, s.radiusIn, s.maxRadius, s.debrisAbsorbed, s.durationMs, s.difficulty, s.runId ?? null, loadoutJson(s.loadout)],
    runId: s.runId,
    nameCensored: s.nameCensored,
  };
}

async function findRun(b: BoardSql, runId: string): Promise<Row | undefined> {
  const n = b.scope.params.length;
  const [row] = await query<Row>(`SELECT ${b.columns} FROM ${b.table} WHERE ${b.scope.sql} AND run_id = $${n + 1}`, [...b.scope.params, runId]);
  return row;
}

async function submit(request: Request, url: URL): Promise<Response> {
  const board = readBoard(url);
  const b = boardSql(board);
  const ipHash = hashIp(clientIp(request));
  checkBurst(ipHash);
  const ins = prepareInsert(board, await readJson(request, MAX_BODY_BYTES));

  await ensureSchema();
  // An auth problem must not cost anyone their score: post it anonymously instead.
  const user = await sessionUser(request).catch((err: unknown) => {
    console.error('[leaderboard] session lookup failed', err);
    return null;
  });

  const existing = ins.runId ? await findRun(b, ins.runId) : undefined;
  let row = existing;
  if (!row) {
    await checkRateLimit(b.table, ipHash, user?.id ?? null);
    const columns = [...ins.columns, 'ip_hash', 'user_id'];
    const values = [...ins.values, ipHash, user?.id ?? null];
    const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
    const conflict = board === 'run' ? '(run_id) WHERE run_id IS NOT NULL' : '(run_id, area) WHERE run_id IS NOT NULL';
    [row] = await query<Row>(
      `INSERT INTO ${b.table} (${columns.join(', ')}) VALUES (${placeholders}) ON CONFLICT ${conflict} DO NOTHING RETURNING ${b.columns}`,
      values,
    );
    // Lost a race with a concurrent post of the same Run.
    row ??= ins.runId ? await findRun(b, ins.runId) : undefined;
  }
  if (!row) throw new HttpError(500, 'server_error', 'The score was not stored.');
  const entry = b.toEntry(row);
  const rank = await rankOf(b, entry);
  return json(existing ? 200 : 201, { entry, rank, nameCensored: ins.nameCensored });
}

export default {
  async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (request.method === 'GET') return await getTop(url);
      if (request.method === 'POST') return await submit(request, url);
      return json(405, { error: 'method_not_allowed', message: 'Use GET or POST.' }, { Allow: 'GET, POST' });
    } catch (err) {
      // DB/network failures become 503 "unavailable", so the client falls back to local scores.
      return errorResponse(err, 'leaderboard');
    }
  },
};
