/**
 * Cloud save for signed-in players (Vercel Node function): Fluff, Upgrade levels, each Character's
 * Keepsake Hoard and bosses beaten (`characters`), each Character's remembered Loadout
 * (`loadouts`), and lifetime stats.
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
 * A body without `characters` (a bundle from before Keepsakes) keeps the stored Hoards; one without
 * `loadouts` (a bundle from before Loadouts synced) keeps the stored Loadouts. A row stored before
 * then has none (`loadouts` is left out of the response). Hoard keys from
 * before rarities ("arc:6") are converted to rarity ids ("arc:epic") by `validateProgress`, in stored
 * rows on read and in uploads on write.
 * `universes` never goes down: the stored count becomes the larger of the two even when the upload
 * is refused (a body without it, from before Act 9, reads as 0 and keeps the stored count).
 */
import { validateProgress, type Progress } from '../src/shared/progress.js';
import { sessionUser } from '../server/auth.js';
import { ensureSchema, query } from '../server/db.js';
import { errorResponse, HttpError, json, readJson } from '../server/http.js';

/** Up to 3 Characters × 50 Hoard cells fit in about 4 KB; the rest is headroom. */
const MAX_BODY_BYTES = 16_384;

const COLUMNS = 'fluff, upgrades, stats, characters, loadouts, universes, updated_at';

interface Row {
  fluff: number;
  upgrades: unknown;
  stats: unknown;
  characters: unknown;
  loadouts: unknown;
  universes: number | null;
  updated_at: Date | string;
}

/** Rows were validated on the way in; re-check anyway so a bad row can't break clients. */
function toProgress(row: Row): { progress: Progress | null; updatedAt: string } {
  const v = validateProgress({ fluff: row.fluff, upgrades: row.upgrades, stats: row.stats, characters: row.characters ?? {}, loadouts: row.loadouts ?? undefined, universes: row.universes ?? 0 });
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
  const [row] = await query<Row>(`SELECT ${COLUMNS} FROM player_progress WHERE user_id = $1`, [userId]);
  return json(200, row ? toProgress(row) : { progress: null, updatedAt: null });
}

async function put(request: Request): Promise<Response> {
  await ensureSchema();
  const userId = await requireUser(request);
  const body = await readJson(request, MAX_BODY_BYTES);
  const v = validateProgress(body);
  if (!v.ok) throw new HttpError(400, 'invalid', v.message, { field: v.field });
  const p = v.value;
  // Older bundles don't know about Keepsakes: keep the stored Hoards and Keepsake count.
  const keepCharacters = (body as Record<string, unknown>).characters === undefined;
  // ...nor (before Loadouts synced) about Loadouts: keep the stored ones.
  const keepLoadouts = p.loadouts === undefined;

  // Accept when the upload has at least as much lifetime progress as the stored copy.
  const total = `(player_progress.stats->>'totalFluffEarned')::bigint`;
  const runs = `(player_progress.stats->>'runs')::bigint`;
  const [stored] = await query<Row>(
    `INSERT INTO player_progress AS player_progress (user_id, fluff, upgrades, stats, characters, loadouts, universes, updated_at)
       VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $8::jsonb, $7, now())
     ON CONFLICT (user_id) DO UPDATE
       SET fluff = EXCLUDED.fluff, upgrades = EXCLUDED.upgrades,
           stats = CASE WHEN $6::boolean
             THEN EXCLUDED.stats || jsonb_build_object('keepsakesEarned', COALESCE(player_progress.stats->'keepsakesEarned', '0'::jsonb))
             ELSE EXCLUDED.stats END,
           characters = CASE WHEN $6::boolean THEN player_progress.characters ELSE EXCLUDED.characters END,
           loadouts = CASE WHEN $9::boolean THEN player_progress.loadouts ELSE EXCLUDED.loadouts END,
           universes = GREATEST(player_progress.universes, EXCLUDED.universes),
           updated_at = now()
       WHERE ${total} < (EXCLUDED.stats->>'totalFluffEarned')::bigint
          OR (${total} = (EXCLUDED.stats->>'totalFluffEarned')::bigint AND ${runs} <= (EXCLUDED.stats->>'runs')::bigint)
     RETURNING ${COLUMNS}`,
    [userId, p.fluff, JSON.stringify(p.upgrades), JSON.stringify(p.stats), JSON.stringify(p.characters), keepCharacters, p.universes, keepLoadouts ? null : JSON.stringify(p.loadouts), keepLoadouts],
  );
  if (stored) return json(200, { accepted: true, ...toProgress(stored) });
  // Refused, but a Universe ended on this device still counts.
  const [current] = await query<Row>(
    `UPDATE player_progress SET universes = GREATEST(universes, $2) WHERE user_id = $1 RETURNING ${COLUMNS}`,
    [userId, p.universes],
  );
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
