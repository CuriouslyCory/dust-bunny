/**
 * The Account's saved Run (Vercel Node function): one per signed-in player, so a Run paused (or
 * left with Save & quit) on one device can be resumed on another. One row per player: the Run's
 * key, the lease of whoever holds it now (a random id per device and take), and the snapshot while
 * it is stored (null while a device is playing it). A Run that ended (or was abandoned) keeps its
 * row, marked `ended_at`, until another Run is stored: GET shows none, and a late upload of it from
 * a device that fell behind is refused instead of storing it again. src/meta/accountRun.ts is the
 * client.
 *
 *   GET    /api/saved-run  -> 200 { savedRun: ServerSavedRun | null }
 *   PUT    /api/saved-run  body: { runKey, lease, prevLease?, snapshot, ledger? }  (pause, Save & quit)
 *                          -> 200 { stored: true, replaced: { runKey, snapshot } | null, credits: RunCredit[] }
 *                          -> 409 carried_on       the same Run is held under another lease
 *                          -> 409 run_ended        the same Run has ended (its row, or the credit ledger)
 *                          -> 409 newer_saved_run  another Run from a newer build is stored: kept
 *   POST   /api/saved-run  body: { runKey, lease, newLease }                  (take: Resume, unpause)
 *                          -> 200 { taken: true, snapshot, version }
 *                          -> 409 carried_on { savedRun }   not held under `lease` (any more), or ended
 *                                                           (`savedRun` then has its key and no snapshot)
 *   DELETE /api/saved-run  body: { runKey, lease, prevLease? }                (the Run ended or was abandoned)
 *                          -> 200 { deleted: boolean, snapshot }   the row stays, marked ended
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
 * Credit ledger (docs/adr/0003, api/run-credit.ts): a Run in `run_credits` has ended for good, so
 * a PUT or a take of it is refused (`run_ended` / `carried_on`) whatever the row holds now. A PUT
 * with `ledger: true` (a client that credits through the ledger) replacing a different stored Run
 * records that Run as a quit in the ledger, in the same transaction, and returns the row in
 * `credits`. Without the flag the client credits `replaced` itself, as before the ledger, and the
 * Run is only marked ended in `run_holders`, so a ledger client's claim for it is refused.
 * TODO(adr-0003): once every client sends `ledger`, drop `replaced` crediting and DELETE.
 *
 * Holders (`run_holders`, server/runCredits.ts): the slot shows only the last Run stored, so each
 * Run's own holder record (lease, ended) is kept current by PUT, take and DELETE and checked by PUT
 * and the claim: a Run another device plays stays theirs after a new Run replaces it in the slot.
 * Every write runs under the Account's advisory lock, so a PUT, take, DELETE and claim sent
 * together decide one after the other.
 *
 * Errors are JSON `{ error: code, message, field? }`: 401 unauthorized (no session), 400 invalid /
 * bad_json, 405, 409, 413 too_large, 503 unavailable.
 */
import { sessionUser } from '../server/auth.js';
import { ensureSchema, query, transaction } from '../server/db.js';
import { errorResponse, HttpError, json, readJson } from '../server/http.js';
import { checkHolder, creditOf, holderOf, lockAccountRuns, pruneHolders, recordCredit, setHolder } from '../server/runCredits.js';
import { pickCreditStats, salvageCreditStats, type RunCredit } from '../src/shared/runCredit.js';
import { MAX_SAVED_RUN_BYTES, migrateRunSnapshot, validateSavedRunClaim, validateSavedRunUpload, type ServerSavedRun } from '../src/shared/savedRun.js';

/** Take and end bodies are only ids. */
const MAX_CLAIM_BYTES = 2_048;

interface Row {
  run_key: string;
  lease: string;
  snapshot: Record<string, unknown> | null;
  version: number | null;
  ended_at: Date | string | null;
  updated_at: Date | string;
}

const COLUMNS = `run_key, lease, snapshot, version, ended_at, updated_at`;

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
  const [row] = await query<Row>(`SELECT ${COLUMNS} FROM saved_runs WHERE user_id = $1 AND ended_at IS NULL`, [userId]);
  return json(200, { savedRun: row ? toSavedRun(row) : null });
}

async function put(request: Request): Promise<Response> {
  await ensureSchema();
  const userId = await requireUser(request);
  const v = validateSavedRunUpload(await readJson(request, MAX_SAVED_RUN_BYTES));
  if (!v.ok) throw new HttpError(400, 'invalid', v.message, { field: v.field });
  const { runKey, lease, prevLease, snapshot, version, ledger } = v.value;
  const body = JSON.stringify(snapshot);
  return transaction(async (q) => {
    await lockAccountRuns(q, userId);
    // A Run in the credit ledger ended for good, whatever the row holds now (a device that fell
    // behind across a whole other Run's start can't store it again, docs/adr/0003).
    if (await creditOf(q, userId, runKey)) throw new HttpError(409, 'run_ended', 'This Run has already ended.');
    // Its own holder record: ended (by a client from before the ledger), or another device's now.
    await checkHolder(q, userId, runKey, lease, prevLease);
    const [old] = await q<Row>(`SELECT ${COLUMNS} FROM saved_runs WHERE user_id = $1 FOR UPDATE`, [userId]);
    if (old && old.run_key === runKey) {
      // Rows from before run_holders: the slot itself says whether the Run ended or moved.
      if (old.ended_at !== null) throw new HttpError(409, 'run_ended', 'This Run has already ended.');
      if (old.lease !== lease && old.lease !== prevLease) throw carriedOn();
    } else if (old && old.snapshot !== null && (old.version ?? 0) > version) {
      throw new HttpError(409, 'newer_saved_run', 'A saved Run from a newer version of the game is stored; update to replace it.');
    }
    await q(
      `INSERT INTO saved_runs (user_id, run_key, lease, snapshot, version, ended_at, updated_at) VALUES ($1, $2, $3, $4::jsonb, $5, NULL, now())
       ON CONFLICT (user_id) DO UPDATE SET run_key = EXCLUDED.run_key, lease = EXCLUDED.lease, snapshot = EXCLUDED.snapshot, version = EXCLUDED.version, ended_at = NULL, updated_at = now()`,
      [userId, runKey, lease, body, version],
    );
    await setHolder(q, userId, runKey, lease, false);
    await pruneHolders(q, userId);
    if (!old) return json(200, { stored: true, replaced: null, credits: [] });
    const replacedSnapshot = old.run_key !== runKey && old.snapshot !== null ? readSnapshot(old.snapshot) : null;
    const replaced = replacedSnapshot ? { runKey: old.run_key, snapshot: replacedSnapshot } : null;
    const credits: RunCredit[] = [];
    if (replaced) {
      // The replaced Run's stored copy is gone, so it is over: ended for its holder record either
      // way. A ledger client's replace credits it here, as a quit, once per Run key; a client from
      // before the ledger credits `replaced` itself, so the ledger gets no row, and a later claim
      // for the Run (a stale synced copy on a ledger client) is refused with `run_ended`.
      await setHolder(q, userId, old.run_key, old.lease, true);
      if (ledger) {
        // The stored copy's stats, salvaged if they don't read whole; zeros only when there are none at all.
        const stats = pickCreditStats(replacedSnapshot?.stats) ?? salvageCreditStats(replacedSnapshot?.stats);
        credits.push((await recordCredit(q, { userId, runKey: old.run_key, lease: old.lease, reason: 'quit', stats })).credit);
      }
    }
    return json(200, { stored: true, replaced, credits });
  });
}

async function take(request: Request): Promise<Response> {
  await ensureSchema();
  const userId = await requireUser(request);
  const v = validateSavedRunClaim(await readJson(request, MAX_CLAIM_BYTES), true);
  if (!v.ok) throw new HttpError(400, 'invalid', v.message, { field: v.field });
  const { runKey, lease, newLease } = v.value;
  if (newLease === undefined) throw new HttpError(400, 'invalid', 'newLease must be a non-empty string.', { field: 'newLease' });
  return transaction(async (q) => {
    await lockAccountRuns(q, userId);
    // Of two racing takes, the second finds the lease moved (`newLease` matches too, so a retry of
    // the take that won still succeeds). A Run in the ledger is over, whatever the slot says.
    // `o` is the row as it was, so the taker gets the snapshot it took.
    const [row] = await q<{ snapshot: Record<string, unknown> | null; version: number | null }>(
      `UPDATE saved_runs AS n SET lease = $4, snapshot = NULL, version = NULL, updated_at = now()
         FROM saved_runs AS o
        WHERE n.user_id = $1 AND o.user_id = n.user_id AND n.run_key = $2 AND (n.lease = $3 OR n.lease = $4) AND n.ended_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM run_credits c WHERE c.user_id = n.user_id AND c.run_key = n.run_key)
       RETURNING o.snapshot, o.version`,
      [userId, runKey, lease, newLease],
    );
    if (row) {
      await setHolder(q, userId, runKey, newLease, false);
      const snapshot = readSnapshot(row.snapshot);
      return json(200, { taken: true, snapshot, version: snapshot ? row.version : null });
    }
    // An ended Run comes back too (its key, no snapshot): the taker learns it isn't theirs to play.
    const [current] = await q<Row>(`SELECT ${COLUMNS} FROM saved_runs WHERE user_id = $1`, [userId]);
    throw carriedOn(current ? toSavedRun(current) : null);
  });
}

async function end(request: Request): Promise<Response> {
  await ensureSchema();
  const userId = await requireUser(request);
  const v = validateSavedRunClaim(await readJson(request, MAX_CLAIM_BYTES), false);
  if (!v.ok) throw new HttpError(400, 'invalid', v.message, { field: v.field });
  const { runKey, lease, prevLease } = v.value;
  return transaction(async (q) => {
    await lockAccountRuns(q, userId);
    // The row stays, marked ended, so a late upload of this Run is refused (`o`: the row as it was).
    const [row] = await q<{ snapshot: Record<string, unknown> | null }>(
      `UPDATE saved_runs AS n SET snapshot = NULL, version = NULL, ended_at = now(), updated_at = now()
         FROM saved_runs AS o
        WHERE n.user_id = $1 AND o.user_id = n.user_id AND n.run_key = $2 AND (n.lease = $3 OR n.lease = $4) AND n.ended_at IS NULL
       RETURNING o.snapshot`,
      [userId, runKey, lease, prevLease ?? lease],
    );
    // The caller credits a Run it ended (`deleted: true`) itself: the holder record keeps that, so
    // a ledger client's later claim for it is refused rather than crediting it a second time. The
    // holder decides too: a Run this device plays that another Run replaced in the slot is still its.
    const holder = await holderOf(q, userId, runKey);
    const held = row !== undefined || (holder !== null && !holder.ended && (holder.lease === lease || holder.lease === prevLease));
    if (held) {
      await setHolder(q, userId, runKey, lease, true);
      await pruneHolders(q, userId);
      return json(200, { deleted: true, snapshot: row ? readSnapshot(row.snapshot) : null });
    }
    // Not held here. A Run the Account doesn't have (never stored, or its upload is still on the way)
    // is recorded as ended all the same, unless the row holds another Run that is still going.
    await q(
      `INSERT INTO saved_runs (user_id, run_key, lease, snapshot, version, ended_at, updated_at) VALUES ($1, $2, $3, NULL, NULL, now(), now())
       ON CONFLICT (user_id) DO UPDATE SET run_key = EXCLUDED.run_key, lease = EXCLUDED.lease, snapshot = NULL, version = NULL, ended_at = now(), updated_at = now()
        WHERE saved_runs.ended_at IS NOT NULL AND saved_runs.run_key <> EXCLUDED.run_key`,
      [userId, runKey, lease],
    );
    if (!holder) {
      await setHolder(q, userId, runKey, lease, true);
      await pruneHolders(q, userId);
    }
    return json(200, { deleted: false, snapshot: null });
  });
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
