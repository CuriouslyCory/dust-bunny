/**
 * The Account's saved Run (Vercel Node function): one per signed-in player, so a Run paused (or
 * left with Save & quit) on one device can be resumed on another. One row per player: the Run's
 * key, the lease of whoever holds it now (a random id per device and take), and the snapshot while
 * it is stored (null while a device is playing it). src/meta/accountRun.ts is the client.
 *
 *   GET    /api/saved-run  -> 200 { savedRun: ServerSavedRun | null }
 *   PUT    /api/saved-run  body: { runKey, lease, prevLease?, snapshot }      (pause, Save & quit)
 *                          -> 200 { stored: true, replaced: { runKey, snapshot } | null }
 *                          -> 409 carried_on       the same Run is held under another lease
 *                          -> 409 newer_saved_run  another Run from a newer build is stored: kept
 *   POST   /api/saved-run  body: { runKey, lease, newLease }                  (take: Resume, unpause)
 *                          -> 200 { taken: true, snapshot, version }
 *                          -> 409 carried_on { savedRun }   not held under `lease` (any more)
 *   DELETE /api/saved-run  body: { runKey, lease, prevLease? }                (the Run ended or was abandoned)
 *                          -> 200 { deleted: boolean, snapshot }
 *
 * PUT stores the snapshot when the row holds the same Run under the caller's lease (or `prevLease`,
 * a take the caller never heard back from), and replaces a different Run, returning it so the
 * caller can credit it as a quit (as the saved Run slot does on a device). A different Run from a
 * newer snapshot version is never replaced (docs/adr/0001). Taking is one atomic UPDATE on the
 * lease, so of two devices racing to take a Run exactly one gets it; it is idempotent for the
 * winner (`newLease` matches too), so a retry after a lost response still succeeds. Taking keeps
 * the row (the lease moves), so a device that fell behind is refused later. Older snapshots are
 * migrated on the way in and out; newer ones are stored and returned as they are.
 *
 * Errors are JSON `{ error: code, message, field? }`: 401 unauthorized (no session), 400 invalid /
 * bad_json, 405, 409, 413 too_large, 503 unavailable.
 */
import { sessionUser } from '../server/auth.js';
import { ensureSchema, query, transaction } from '../server/db.js';
import { errorResponse, HttpError, json, readJson } from '../server/http.js';
import { MAX_SAVED_RUN_BYTES, migrateRunSnapshot, validateSavedRunClaim, validateSavedRunUpload, type ServerSavedRun } from '../src/shared/savedRun.js';

/** Take and end bodies are only ids. */
const MAX_CLAIM_BYTES = 2_048;

interface Row {
  run_key: string;
  lease: string;
  snapshot: Record<string, unknown> | null;
  version: number | null;
  updated_at: Date | string;
}

/** Stored older snapshots come back migrated (the server always runs the newest build); newer ones as they are. */
function readSnapshot(raw: Record<string, unknown> | null): Record<string, unknown> | null {
  return raw === null ? null : migrateRunSnapshot(raw);
}

function toSavedRun(row: Row): ServerSavedRun {
  const snapshot = readSnapshot(row.snapshot);
  return {
    runKey: row.run_key,
    lease: row.lease,
    version: snapshot ? (row.version ?? null) : null,
    snapshot,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

async function requireUser(request: Request): Promise<string> {
  const user = await sessionUser(request);
  if (!user) throw new HttpError(401, 'unauthorized', 'Sign in to keep a saved Run with your account.');
  return user.id;
}

const carriedOn = (savedRun: ServerSavedRun | null = null): HttpError =>
  new HttpError(409, 'carried_on', 'This Run is held by another device.', savedRun ? { savedRun } : {});

async function get(request: Request): Promise<Response> {
  await ensureSchema();
  const userId = await requireUser(request);
  const [row] = await query<Row>(`SELECT run_key, lease, snapshot, version, updated_at FROM saved_runs WHERE user_id = $1`, [userId]);
  return json(200, { savedRun: row ? toSavedRun(row) : null });
}

async function put(request: Request): Promise<Response> {
  await ensureSchema();
  const userId = await requireUser(request);
  const v = validateSavedRunUpload(await readJson(request, MAX_SAVED_RUN_BYTES));
  if (!v.ok) throw new HttpError(400, 'invalid', v.message, { field: v.field });
  const { runKey, lease, prevLease, snapshot, version } = v.value;
  const body = JSON.stringify(snapshot);
  return transaction(async (q) => {
    const inserted = await q(
      `INSERT INTO saved_runs (user_id, run_key, lease, snapshot, version, updated_at) VALUES ($1, $2, $3, $4::jsonb, $5, now())
       ON CONFLICT (user_id) DO NOTHING RETURNING user_id`,
      [userId, runKey, lease, body, version],
    );
    if (inserted.length) return json(200, { stored: true, replaced: null });
    // The row exists: lock it, so a take or another store can't slip in between the check and the write.
    const [old] = await q<Row>(`SELECT run_key, lease, snapshot, version, updated_at FROM saved_runs WHERE user_id = $1 FOR UPDATE`, [userId]);
    if (!old) throw new HttpError(503, 'unavailable', 'The saved Run changed; try again.');
    if (old.run_key === runKey) {
      if (old.lease !== lease && old.lease !== prevLease) throw carriedOn();
    } else if (old.snapshot !== null && (old.version ?? 0) > version) {
      throw new HttpError(409, 'newer_saved_run', 'A saved Run from a newer version of the game is stored; update to replace it.');
    }
    await q(`UPDATE saved_runs SET run_key = $2, lease = $3, snapshot = $4::jsonb, version = $5, updated_at = now() WHERE user_id = $1`, [userId, runKey, lease, body, version]);
    const replaced = old.run_key !== runKey && old.snapshot !== null ? { runKey: old.run_key, snapshot: readSnapshot(old.snapshot) } : null;
    return json(200, { stored: true, replaced });
  });
}

async function take(request: Request): Promise<Response> {
  await ensureSchema();
  const userId = await requireUser(request);
  const v = validateSavedRunClaim(await readJson(request, MAX_CLAIM_BYTES), true);
  if (!v.ok) throw new HttpError(400, 'invalid', v.message, { field: v.field });
  const { runKey, lease, newLease } = v.value;
  // One statement: of two racing takes, the second re-checks the row after the first commits and
  // finds the lease moved. `o` is the row as it was, so the taker gets the snapshot it took.
  const [row] = await query<{ snapshot: Record<string, unknown> | null; version: number | null }>(
    `UPDATE saved_runs AS n SET lease = $4, snapshot = NULL, version = NULL, updated_at = now()
       FROM saved_runs AS o
      WHERE n.user_id = $1 AND o.user_id = n.user_id AND n.run_key = $2 AND (n.lease = $3 OR n.lease = $4)
     RETURNING o.snapshot, o.version`,
    [userId, runKey, lease, newLease],
  );
  if (row) {
    const snapshot = readSnapshot(row.snapshot);
    return json(200, { taken: true, snapshot, version: snapshot ? row.version : null });
  }
  const [current] = await query<Row>(`SELECT run_key, lease, snapshot, version, updated_at FROM saved_runs WHERE user_id = $1`, [userId]);
  throw carriedOn(current ? toSavedRun(current) : null);
}

async function end(request: Request): Promise<Response> {
  await ensureSchema();
  const userId = await requireUser(request);
  const v = validateSavedRunClaim(await readJson(request, MAX_CLAIM_BYTES), false);
  if (!v.ok) throw new HttpError(400, 'invalid', v.message, { field: v.field });
  const { runKey, lease, prevLease } = v.value;
  const [row] = await query<{ snapshot: Record<string, unknown> | null }>(
    `DELETE FROM saved_runs WHERE user_id = $1 AND run_key = $2 AND (lease = $3 OR lease = $4) RETURNING snapshot`,
    [userId, runKey, lease, prevLease ?? lease],
  );
  return json(200, { deleted: !!row, snapshot: row ? readSnapshot(row.snapshot) : null });
}

export default {
  async fetch(request: Request): Promise<Response> {
    try {
      if (request.method === 'GET') return await get(request);
      if (request.method === 'PUT') return await put(request);
      if (request.method === 'POST') return await take(request);
      if (request.method === 'DELETE') return await end(request);
      return json(405, { error: 'method_not_allowed', message: 'Use GET, PUT, POST or DELETE.' }, { Allow: 'GET, PUT, POST, DELETE' });
    } catch (err) {
      return errorResponse(err, 'saved-run');
    }
  },
};
