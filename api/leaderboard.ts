/**
 * Leaderboard API (Vercel Node function, Web-standard fetch handler).
 *
 *   GET  /api/leaderboard[?character=lint|tumble|zap]  -> 200 { entries: LeaderboardEntry[] } (top 20)
 *   POST /api/leaderboard  body: ScoreSubmission        -> 201 { entry, rank, nameCensored }
 *
 * A POST with a valid session cookie (see server/auth.ts) stores the player's user id, and the entry
 * comes back `verified: true`; without one the entry is anonymous (`verified: false`).
 *
 * Errors are JSON `{ error: code, message, field? }`: 400 invalid / bad_json, 405, 413,
 * 429 rate_limited (with Retry-After), 503 unavailable (no DATABASE_URL or DB down; the
 * client then falls back to its local leaderboard), 500 server_error.
 *
 * Needs DATABASE_URL (injected by the Vercel Neon integration). Optional LEADERBOARD_IP_SALT
 * salts the stored IP hashes. Tables are created on first use (server/schema.ts, mirrored in
 * db/schema.sql); columns added later are applied with idempotent `ADD COLUMN IF NOT EXISTS`.
 *
 * Every Difficulty shares one board: submitted scores already include the Difficulty
 * multiplier (see src/shared/score.ts), and each entry carries its `difficulty`.
 *
 * Imports from src/ use `.js` extensions: Vercel runs this file as native ESM.
 */
import { createHash } from 'node:crypto';
import { DEFAULT_DIFFICULTY, isDifficultyId } from '../src/shared/difficulty.js';
import {
  isLeaderboardCharacter,
  LEADERBOARD_CHARACTERS,
  LEADERBOARD_SIZE,
  validateSubmission,
  type LeaderboardEntry,
} from '../src/shared/leaderboard.js';
import { sessionUser } from '../server/auth.js';
import { ensureSchema, query } from '../server/db.js';
import { errorResponse, HttpError, json, readJson } from '../server/http.js';

const MAX_BODY_BYTES = 2048;
/** Accepted submissions per IP per window (checked against the table, so it holds across instances). */
const RATE_LIMIT = { max: 6, windowSec: 600 };
/** Best-effort per-instance burst limit on all POSTs (including rejected ones). */
const BURST_LIMIT = { max: 5, windowMs: 60_000 };

const burst = new Map<string, number[]>();

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
  verified: boolean;
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
    verified: Boolean(r.verified),
    createdAt: new Date(r.created_at).toISOString(),
  };
}

const COLUMNS = 'id, name, character, score, max_radius, debris_absorbed, tier_reached, duration_ms, victory, difficulty, user_id IS NOT NULL AS verified, created_at';

async function getTop(url: URL): Promise<Response> {
  const character = url.searchParams.get('character');
  if (character !== null && !isLeaderboardCharacter(character))
    throw new HttpError(400, 'invalid', `Unknown character; expected one of ${LEADERBOARD_CHARACTERS.join(', ')}.`, { field: 'character' });
  await ensureSchema();
  const rows = character
    ? await query<Row>(`SELECT ${COLUMNS} FROM leaderboard_scores WHERE character = $1 ORDER BY score DESC, id ASC LIMIT $2`, [character, LEADERBOARD_SIZE])
    : await query<Row>(`SELECT ${COLUMNS} FROM leaderboard_scores ORDER BY score DESC, id ASC LIMIT $1`, [LEADERBOARD_SIZE]);
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

async function submit(request: Request): Promise<Response> {
  const ipHash = hashIp(clientIp(request));
  checkBurst(ipHash);
  const result = validateSubmission(await readJson(request, MAX_BODY_BYTES));
  if (!result.ok) throw new HttpError(400, 'invalid', result.message, { field: result.field });
  const s = result.value;

  await ensureSchema();
  // An auth problem must not cost anyone their score: post it anonymously instead.
  const user = await sessionUser(request).catch((err: unknown) => {
    console.error('[leaderboard] session lookup failed', err);
    return null;
  });

  const [recent] = await query<{ n: number; oldest: number | null }>(
    `SELECT count(*)::int AS n, extract(epoch FROM min(created_at))::float AS oldest
       FROM leaderboard_scores WHERE ip_hash = $1 AND created_at > now() - make_interval(secs => $2)`,
    [ipHash, RATE_LIMIT.windowSec],
  );
  if (recent && recent.n >= RATE_LIMIT.max) {
    const retry = Math.max(1, Math.ceil((recent.oldest ?? Date.now() / 1000) + RATE_LIMIT.windowSec - Date.now() / 1000));
    throw new HttpError(429, 'rate_limited', 'Too many submissions; try again later.', { retryAfterSec: retry }, { 'Retry-After': String(retry) });
  }

  const [row] = await query<Row>(
    `INSERT INTO leaderboard_scores (name, character, score, max_radius, debris_absorbed, tier_reached, duration_ms, victory, difficulty, ip_hash, user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING ${COLUMNS}`,
    [s.name, s.character, s.score, s.maxRadius, s.debrisAbsorbed, s.tierReached, s.durationMs, s.victory, s.difficulty, ipHash, user?.id ?? null],
  );
  const entry = toEntry(row!);
  const [rankRow] = await query<{ rank: number }>(
    `SELECT count(*)::int + 1 AS rank FROM leaderboard_scores WHERE score > $1 OR (score = $1 AND id < $2)`,
    [entry.score, entry.id],
  );
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
      // DB/network failures become 503 "unavailable", so the client falls back to local scores.
      return errorResponse(err, 'leaderboard');
    }
  },
};
