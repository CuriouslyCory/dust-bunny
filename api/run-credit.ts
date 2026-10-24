/**
 * The Run credit ledger (Vercel Node function, docs/adr/0003): the server decides, once per Run
 * key, that a signed-in player's Run is credited. A `run_credits` row is the only record of it.
 * The client (src/meta/runCredits.ts) computes the Fluff from the row's stats and applies it at
 * most once per progress copy (`Progress.creditedRuns`).
 *
 *   POST /api/run-credit  body: { runKey, lease, prevLease?, reason, stats }   (the Run ended here, or was abandoned)
 *                         -> 200 { credit: RunCredit, created: boolean }
 *                         -> 409 carried_on   the saved Run row holds this Run under another lease, still going
 *                         -> 409 run_ended    the row says this Run ended, but the ledger has no row for it
 *                                             (a client from before the ledger ended it and credited it itself)
 *   GET  /api/run-credit?limit=20  -> 200 { credits: RunCredit[] }   newest first (at most RUN_CREDIT_LIST_MAX)
 *
 * A claim is safe to retry any number of times: once the ledger has the Run, every claim for it
 * (whatever the lease, whoever sends it) gets the same row back with `created: false`. The claim
 * decides under the player's `saved_runs` row lock: held under the caller's lease (or `prevLease`,
 * a take never heard back from) the row is marked ended, as DELETE does; a Run the row doesn't hold
 * (never uploaded, or already replaced) is nobody else's to play, so it is credited, and, as
 * DELETE does, left as the ended Run on an empty row so a late upload is refused. A refused claim
 * never writes.
 *
 * Errors are JSON `{ error: code, message, field? }`: 401 unauthorized (no session), 400 invalid /
 * bad_json, 405, 409, 413 too_large, 503 unavailable.
 */
import { sessionUser } from '../server/auth.js';
import { ensureSchema, query, transaction } from '../server/db.js';
import { errorResponse, HttpError, json, readJson } from '../server/http.js';
import { CREDIT_COLUMNS, recordCredit, toRunCredit, type CreditRow } from '../server/runCredits.js';
import { MAX_RUN_CREDIT_BYTES, RUN_CREDIT_LIST_LIMIT, RUN_CREDIT_LIST_MAX, validateRunCreditClaim } from '../src/shared/runCredit.js';

interface SavedRunRow {
  run_key: string;
  lease: string;
  ended_at: Date | string | null;
}

async function requireUser(request: Request): Promise<string> {
  const user = await sessionUser(request);
  if (!user) throw new HttpError(401, 'unauthorized', 'Sign in to credit a Run to your account.');
  return user.id;
}

async function list(request: Request): Promise<Response> {
  await ensureSchema();
  const userId = await requireUser(request);
  const raw = Number(new URL(request.url).searchParams.get('limit') ?? RUN_CREDIT_LIST_LIMIT);
  const limit = Number.isInteger(raw) && raw >= 1 ? Math.min(raw, RUN_CREDIT_LIST_MAX) : RUN_CREDIT_LIST_LIMIT;
  const rows = await query<CreditRow>(`SELECT ${CREDIT_COLUMNS} FROM run_credits WHERE user_id = $1 ORDER BY id DESC LIMIT $2`, [userId, limit]);
  return json(200, { credits: rows.map(toRunCredit) });
}

async function claim(request: Request): Promise<Response> {
  await ensureSchema();
  const userId = await requireUser(request);
  const v = validateRunCreditClaim(await readJson(request, MAX_RUN_CREDIT_BYTES));
  if (!v.ok) throw new HttpError(400, 'invalid', v.message, { field: v.field });
  const { runKey, lease, prevLease, reason, stats } = v.value;
  return transaction(async (q) => {
    // Lock the player's saved Run row (if any), so a take, a store or another claim waits its turn.
    const [row] = await q<SavedRunRow>(`SELECT run_key, lease, ended_at FROM saved_runs WHERE user_id = $1 FOR UPDATE`, [userId]);
    const [existing] = await q<CreditRow>(`SELECT ${CREDIT_COLUMNS} FROM run_credits WHERE user_id = $1 AND run_key = $2`, [userId, runKey]);
    if (existing) return json(200, { credit: toRunCredit(existing), created: false });
    if (row && row.run_key === runKey) {
      if (row.ended_at !== null) throw new HttpError(409, 'run_ended', 'This Run has already ended.');
      if (row.lease !== lease && row.lease !== prevLease) throw new HttpError(409, 'carried_on', 'This Run is held by another device.');
      await q(`UPDATE saved_runs SET snapshot = NULL, version = NULL, ended_at = now(), updated_at = now() WHERE user_id = $1`, [userId]);
    } else {
      // Not held here. A Run the Account doesn't have (never stored, or its upload is still on the
      // way) is recorded as ended all the same, unless the row holds another Run that is still going.
      await q(
        `INSERT INTO saved_runs (user_id, run_key, lease, snapshot, version, ended_at, updated_at) VALUES ($1, $2, $3, NULL, NULL, now(), now())
         ON CONFLICT (user_id) DO UPDATE SET run_key = EXCLUDED.run_key, lease = EXCLUDED.lease, snapshot = NULL, version = NULL, ended_at = now(), updated_at = now()
          WHERE saved_runs.ended_at IS NOT NULL AND saved_runs.run_key <> EXCLUDED.run_key`,
        [userId, runKey, lease],
      );
    }
    const res = await recordCredit(q, { userId, runKey, lease, reason, stats });
    return json(200, res);
  });
}

export default {
  async fetch(request: Request): Promise<Response> {
    try {
      if (request.method === 'GET') return await list(request);
      if (request.method === 'POST') return await claim(request);
      return json(405, { error: 'method_not_allowed', message: 'Use GET or POST.' }, { Allow: 'GET, POST' });
    } catch (err) {
      return errorResponse(err, 'run-credit');
    }
  },
};
