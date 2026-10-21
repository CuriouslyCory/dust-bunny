/**
 * Cloud save for signed-in players (Vercel Node function): Fluff, Upgrade levels and lifetime stats.
 *
 *   GET /api/progress        -> 200 { progress: Progress | null, updatedAt: string | null }
 *   PUT /api/progress  body: Progress
 *                            -> 200 { accepted: true,  progress, updatedAt }   stored
 *                            -> 200 { accepted: false, progress, updatedAt }   the server copy has more
 *                                                                            progress; adopt it instead
 *
 * Errors are JSON `{ error: code, message, field? }`: 401 unauthorized (no session), 400 invalid /
 * bad_json, 405, 413, 503 unavailable. The comparison rule lives in src/shared/progress.ts; the
 * upsert applies it atomically, so two devices can't overwrite each other's newer progress.
 */
import { validateProgress, type Progress } from '../src/shared/progress.js';
import { sessionUser } from '../server/auth.js';
import { ensureSchema, query } from '../server/db.js';
import { errorResponse, HttpError, json, readJson } from '../server/http.js';

const MAX_BODY_BYTES = 4096;

interface Row {
  fluff: number;
  upgrades: unknown;
  stats: unknown;
  updated_at: Date | string;
}

/** Rows were validated on the way in; re-check anyway so a bad row can't break clients. */
function toProgress(row: Row): { progress: Progress | null; updatedAt: string } {
  const v = validateProgress({ fluff: row.fluff, upgrades: row.upgrades, stats: row.stats });
  return { progress: v.ok ? v.value : null, updatedAt: new Date(row.updated_at).toISOString() };
}

async function requireUser(request: Request): Promise<string> {
  const user = await sessionUser(request);
  if (!user) throw new HttpError(401, 'unauthorized', 'Sign in to sync progress.');
  return user.id;
}

async function get(request: Request): Promise<Response> {
  await ensureSchema();
  const userId = await requireUser(request);
  const [row] = await query<Row>(`SELECT fluff, upgrades, stats, updated_at FROM player_progress WHERE user_id = $1`, [userId]);
  return json(200, row ? toProgress(row) : { progress: null, updatedAt: null });
}

async function put(request: Request): Promise<Response> {
  await ensureSchema();
  const userId = await requireUser(request);
  const v = validateProgress(await readJson(request, MAX_BODY_BYTES));
  if (!v.ok) throw new HttpError(400, 'invalid', v.message, { field: v.field });
  const p = v.value;

  // Accept when the upload has at least as much lifetime progress as the stored copy.
  const total = `(player_progress.stats->>'totalFluffEarned')::bigint`;
  const runs = `(player_progress.stats->>'runs')::bigint`;
  const [stored] = await query<Row>(
    `INSERT INTO player_progress AS player_progress (user_id, fluff, upgrades, stats, updated_at)
       VALUES ($1, $2, $3::jsonb, $4::jsonb, now())
     ON CONFLICT (user_id) DO UPDATE
       SET fluff = EXCLUDED.fluff, upgrades = EXCLUDED.upgrades, stats = EXCLUDED.stats, updated_at = now()
       WHERE ${total} < (EXCLUDED.stats->>'totalFluffEarned')::bigint
          OR (${total} = (EXCLUDED.stats->>'totalFluffEarned')::bigint AND ${runs} <= (EXCLUDED.stats->>'runs')::bigint)
     RETURNING fluff, upgrades, stats, updated_at`,
    [userId, p.fluff, JSON.stringify(p.upgrades), JSON.stringify(p.stats)],
  );
  if (stored) return json(200, { accepted: true, ...toProgress(stored) });
  const [current] = await query<Row>(`SELECT fluff, upgrades, stats, updated_at FROM player_progress WHERE user_id = $1`, [userId]);
  return json(200, { accepted: false, ...toProgress(current!) });
}

export default {
  async fetch(request: Request): Promise<Response> {
    try {
      if (request.method === 'GET') return await get(request);
      if (request.method === 'PUT') return await put(request);
      return json(405, { error: 'method_not_allowed', message: 'Use GET or PUT.' }, { Allow: 'GET, PUT' });
    } catch (err) {
      return errorResponse(err, 'progress');
    }
  },
};
