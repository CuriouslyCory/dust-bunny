/**
 * The Run credit ledger (Vercel Node function, docs/adr/0003): the server decides, once per Run
 * key, that a signed-in player's Run is credited. A `run_credits` row is the only record of it.
 * The client (src/meta/runCredits.ts) computes the Fluff from the row's stats and applies it at
 * most once per progress copy (`Progress.creditedRuns`).
 *
 *   POST /api/run-credit  body: { runKey, lease, prevLease?, reason, stats }   (the Run ended here, or was abandoned)
 *                         -> 200 { credit: RunCredit, created: boolean }
 *                         -> 409 carried_on   another device holds this Run (its holder record, or the slot), still going
 *                         -> 409 run_ended    this Run ended but the ledger has no row for it: a client from before
 *                                             the ledger ended it (or replaced its stored copy) and credited it
 *                                             itself. Already credited elsewhere: the caller applies nothing.
 *   GET  /api/run-credit?limit=20  -> 200 { credits: RunCredit[] }   newest first (at most RUN_CREDIT_LIST_MAX)
 *
 * A claim is safe to retry any number of times: once the ledger has the Run, every claim for it
 * (whatever the lease, whoever sends it) gets the same row back with `created: false`. The claim
 * decides under the Account's advisory lock (server/runCredits.ts), against the Run's own holder
 * record first and the slot second: held under the caller's lease (or `prevLease`, a take never
 * heard back from) it is marked ended, as DELETE does; a Run the server never saw is nobody else's
 * to play, so it is credited, and left as the ended Run on an empty slot so a late upload is
 * refused. A refused claim never writes.
 *
 * A claim that would create a row is bounded per Account (`CREDIT_RATE_LIMIT`, server/runCredits.ts):
 * past it, 429 rate_limited with `Retry-After` (the client's queue retries later). The ledger keeps
 * the newest `CREDIT_KEEP` rows per Account, and a claim prunes the Account's holder rows as a store does.
 *
 * Errors are JSON `{ error: code, message, field? }`: 401 unauthorized (no session), 400 invalid /
 * bad_json, 405, 409, 413 too_large, 429 rate_limited, 503 unavailable.
 */
import { sessionUser } from '../server/auth.js';
import { ensureSchema, query, transaction } from '../server/db.js';
import { errorResponse, HttpError, json, readJson } from '../server/http.js';
import { checkCreditRate, checkHolder, creditOf, CREDIT_COLUMNS, lockAccountRuns, pruneHolders, recordCredit, setHolder, toRunCredit, type CreditRow } from '../server/runCredits.js';
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
    // Under the Account's lock: a store, take, end or another claim waits its turn.
    await lockAccountRuns(q, userId);
    const existing = await creditOf(q, userId, runKey);
    if (existing) return json(200, { credit: toRunCredit(existing), created: false });
    // The Run's own holder record: ended by a client from before the ledger (credited there, so
    // `run_ended`: nothing here applies it), or another device's now (`carried_on`).
    await checkHolder(q, userId, runKey, lease, prevLease);
    // A new row: bounded per Account (server/runCredits.ts). Nothing is written before this.
    await checkCreditRate(q, userId);
    const [row] = await q<SavedRunRow>(`SELECT run_key, lease, ended_at FROM saved_runs WHERE user_id = $1 FOR UPDATE`, [userId]);
    if (row && row.run_key === runKey) {
      // Rows from before run_holders: the slot itself says whether the Run ended or moved.
      if (row.ended_at !== null) throw new HttpError(409, 'run_ended', 'This Run has already ended.');
      if (row.lease !== lease && row.lease !== prevLease) throw new HttpError(409, 'carried_on', 'This Run is held by another device.');
      await q(`UPDATE saved_runs SET snapshot = NULL, version = NULL, ended_at = now(), updated_at = now() WHERE user_id = $1`, [userId]);
    } else {
      // Not in the slot: never stored, its upload still on the way, or replaced there while this
      // device played it (its holder record says so). Recorded as ended on an empty slot all the
      // same, so a late upload is refused; a Run still going in the slot is left alone.
      await q(
        `INSERT INTO saved_runs (user_id, run_key, lease, snapshot, version, ended_at, updated_at) VALUES ($1, $2, $3, NULL, NULL, now(), now())
         ON CONFLICT (user_id) DO UPDATE SET run_key = EXCLUDED.run_key, lease = EXCLUDED.lease, snapshot = NULL, version = NULL, ended_at = now(), updated_at = now()
          WHERE saved_runs.ended_at IS NOT NULL AND saved_runs.run_key <> EXCLUDED.run_key`,
        [userId, runKey, lease],
      );
    }
    await setHolder(q, userId, runKey, lease, true);
    await pruneHolders(q, userId); // a player who never pauses only ever claims: holders are pruned here too
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
