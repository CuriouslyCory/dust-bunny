/**
 * Leaderboard API (Vercel Node function, Web-standard fetch handler).
 *
 *   GET  /api/leaderboard[?character=lint|tumble|zap]  -> 200 { entries: LeaderboardEntry[] } (top 20)
 *   POST /api/leaderboard  body: ScoreSubmission        -> 201 { entry, rank, nameCensored }
 *
 * Errors are JSON `{ error: code, message, field? }`: 400 invalid / bad_json, 405, 413,
 * 429 rate_limited (with Retry-After), 503 unavailable (no DATABASE_URL or DB down; the
 * client then falls back to its local leaderboard), 500 server_error.
 *
 * Needs DATABASE_URL (injected by the Vercel Neon integration). Optional LEADERBOARD_IP_SALT
 * salts the stored IP hashes. The table is created on first use (same DDL as db/schema.sql);
 * columns added later are applied with idempotent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`.
 *
 * Every Difficulty shares one board: submitted scores already include the Difficulty
 * multiplier (see src/shared/score.ts), and each entry carries its `difficulty`.
 *
 * Imports from src/ use `.js` extensions: Vercel runs this file as native ESM.
 */
import { createHash } from 'node:crypto';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { DEFAULT_DIFFICULTY, isDifficultyId } from '../src/shared/difficulty.js';
import {
  isLeaderboardCharacter,
  LEADERBOARD_CHARACTERS,
  LEADERBOARD_SIZE,
  validateSubmission,
  type LeaderboardEntry,
} from '../src/shared/leaderboard.js';

const MAX_BODY_BYTES = 2048;
/** Accepted submissions per IP per window (checked against the table, so it holds across instances). */
const RATE_LIMIT = { max: 6, windowSec: 600 };
/** Best-effort per-instance burst limit on all POSTs (including rejected ones). */
const BURST_LIMIT = { max: 5, windowMs: 60_000 };

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS leaderboard_scores (
    id bigserial PRIMARY KEY,
    name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 16),
    character text NOT NULL,
    score integer NOT NULL CHECK (score >= 0),
    max_radius real NOT NULL,
    debris_absorbed integer NOT NULL,
    tier_reached smallint NOT NULL,
    duration_ms integer NOT NULL,
    victory boolean NOT NULL DEFAULT false,
    difficulty text NOT NULL DEFAULT 'casual',
    ip_hash text,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  // Tables created before Difficulty existed.
  `ALTER TABLE leaderboard_scores ADD COLUMN IF NOT EXISTS difficulty text NOT NULL DEFAULT 'casual'`,
  `CREATE INDEX IF NOT EXISTS leaderboard_scores_score_idx ON leaderboard_scores (score DESC, id)`,
  `CREATE INDEX IF NOT EXISTS leaderboard_scores_character_idx ON leaderboard_scores (character, score DESC, id)`,
  `CREATE INDEX IF NOT EXISTS leaderboard_scores_ip_idx ON leaderboard_scores (ip_hash, created_at)`,
];

type Sql = NeonQueryFunction<false, false>;

let sqlClient: Sql | null = null;
let schemaReady: Promise<void> | null = null;
const burst = new Map<string, number[]>();

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra: Record<string, unknown> = {},
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
  }
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

function db(): Sql {
  if (sqlClient) return sqlClient;
  const url = process.env.DATABASE_URL;
  if (!url) throw new HttpError(503, 'unavailable', 'Leaderboard database is not configured.');
  sqlClient = neon(url);
  return sqlClient;
}

async function ensureSchema(sql: Sql): Promise<void> {
  schemaReady ??= (async () => {
    for (const stmt of SCHEMA) await sql.query(stmt);
  })().catch((err: unknown) => {
    schemaReady = null;
    throw err;
  });
  return schemaReady;
}

interface Row {
  id: string | number;
  name: string;
  character: string;
  score: number;
  max_radius: number;
  debris_absorbed: number;
  tier_reached: number;
  duration_ms: number;
  victory: boolean;
  difficulty: string | null;
  created_at: string | Date;
}

function toEntry(r: Row): LeaderboardEntry {
  return {
    id: String(r.id),
    name: r.name,
    character: isLeaderboardCharacter(r.character) ? r.character : 'lint',
    score: Number(r.score),
    maxRadius: Number(r.max_radius),
    debrisAbsorbed: Number(r.debris_absorbed),
    tierReached: Number(r.tier_reached),
    durationMs: Number(r.duration_ms),
    victory: Boolean(r.victory),
    difficulty: isDifficultyId(r.difficulty) ? r.difficulty : DEFAULT_DIFFICULTY,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

const COLUMNS = 'id, name, character, score, max_radius, debris_absorbed, tier_reached, duration_ms, victory, difficulty, created_at';

async function getTop(url: URL): Promise<Response> {
  const character = url.searchParams.get('character');
  if (character !== null && !isLeaderboardCharacter(character))
    throw new HttpError(400, 'invalid', `Unknown character; expected one of ${LEADERBOARD_CHARACTERS.join(', ')}.`, { field: 'character' });
  const sql = db();
  await ensureSchema(sql);
  const rows = (character
    ? await sql.query(`SELECT ${COLUMNS} FROM leaderboard_scores WHERE character = $1 ORDER BY score DESC, id ASC LIMIT $2`, [character, LEADERBOARD_SIZE])
    : await sql.query(`SELECT ${COLUMNS} FROM leaderboard_scores ORDER BY score DESC, id ASC LIMIT $1`, [LEADERBOARD_SIZE])) as Row[];
  return json(200, { entries: rows.map(toEntry) });
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

async function readJson(request: Request): Promise<unknown> {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > MAX_BODY_BYTES) throw new HttpError(413, 'too_large', 'Request body too large.');
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new HttpError(413, 'too_large', 'Request body too large.');
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new HttpError(400, 'bad_json', 'Request body must be JSON.');
  }
}

async function submit(request: Request): Promise<Response> {
  const ipHash = hashIp(clientIp(request));
  checkBurst(ipHash);
  const result = validateSubmission(await readJson(request));
  if (!result.ok) throw new HttpError(400, 'invalid', result.message, { field: result.field });
  const s = result.value;

  const sql = db();
  await ensureSchema(sql);

  const [recent] = (await sql.query(
    `SELECT count(*)::int AS n, extract(epoch FROM min(created_at))::float AS oldest
       FROM leaderboard_scores WHERE ip_hash = $1 AND created_at > now() - make_interval(secs => $2)`,
    [ipHash, RATE_LIMIT.windowSec],
  )) as Array<{ n: number; oldest: number | null }>;
  if (recent && recent.n >= RATE_LIMIT.max) {
    const retry = Math.max(1, Math.ceil((recent.oldest ?? Date.now() / 1000) + RATE_LIMIT.windowSec - Date.now() / 1000));
    throw new HttpError(429, 'rate_limited', 'Too many submissions; try again later.', { retryAfterSec: retry }, { 'Retry-After': String(retry) });
  }

  const [row] = (await sql.query(
    `INSERT INTO leaderboard_scores (name, character, score, max_radius, debris_absorbed, tier_reached, duration_ms, victory, difficulty, ip_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING ${COLUMNS}`,
    [s.name, s.character, s.score, s.maxRadius, s.debrisAbsorbed, s.tierReached, s.durationMs, s.victory, s.difficulty, ipHash],
  )) as Row[];
  const entry = toEntry(row!);
  const [rankRow] = (await sql.query(
    `SELECT count(*)::int + 1 AS rank FROM leaderboard_scores WHERE score > $1 OR (score = $1 AND id < $2)`,
    [entry.score, entry.id],
  )) as Array<{ rank: number }>;
  return json(201, { entry, rank: rankRow?.rank ?? null, nameCensored: s.nameCensored });
}

export default {
  async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (request.method === 'GET') return await getTop(url);
      if (request.method === 'POST') return await submit(request);
      return json(405, { error: 'method_not_allowed', message: 'Use GET or POST.' }, { Allow: 'GET, POST' });
    } catch (err) {
      if (err instanceof HttpError) return json(err.status, { error: err.code, message: err.message, ...err.extra }, err.headers);
      console.error('[leaderboard]', err);
      // Treat DB/network failures as "unavailable" so the client falls back to local scores.
      return json(503, { error: 'unavailable', message: 'Leaderboard is temporarily unavailable.' });
    }
  },
};
