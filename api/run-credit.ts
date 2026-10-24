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
 * decides under the Account's lock, against the Run's own holder record first and the slot second:
 * held under the caller's lease (or `prevLease`, a take never heard back from) it is marked ended,
 * as DELETE does; a Run the server never saw is nobody else's to play, so it is credited, and left
 * as the ended Run on an empty slot so a late upload is refused. A refused claim never writes.
 *
 * A claim that would create a row is bounded per Account (`CREDIT_RATE_LIMIT`, server/accountRuns.ts):
 * past it, 429 rate_limited with `Retry-After` (the client's queue retries later). The ledger keeps
 * the newest `CREDIT_KEEP` rows per Account, and a claim prunes the Account's holder rows as a store does.
 *
 * The rules live in server/accountRuns.ts; this file authenticates, validates and maps the
 * module's answer to a status.
 *
 * Errors are JSON `{ error: code, message, field? }`: 401 unauthorized (no session), 400 invalid /
 * bad_json, 405, 409, 413 too_large, 429 rate_limited, 503 unavailable.
 */
import { sessionUser } from '../server/auth.js';
import { accountRuns } from '../server/accountRunsPostgres.js';
import { ensureSchema } from '../server/db.js';
import { errorResponse, HttpError, json, readJson } from '../server/http.js';
import { MAX_RUN_CREDIT_BYTES, RUN_CREDIT_LIST_LIMIT, RUN_CREDIT_LIST_MAX, validateRunCreditClaim } from '../src/shared/runCredit.js';

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
  return json(200, { credits: await accountRuns.credits(userId, limit) });
}

async function claim(request: Request): Promise<Response> {
  await ensureSchema();
  const userId = await requireUser(request);
  const v = validateRunCreditClaim(await readJson(request, MAX_RUN_CREDIT_BYTES));
  if (!v.ok) throw new HttpError(400, 'invalid', v.message, { field: v.field });
  const res = await accountRuns.claim(userId, v.value);
  if (res.ok) return json(200, { credit: res.credit, created: res.created });
  if (res.reason === 'rate_limited') {
    const retry = res.retryAfterSec;
    throw new HttpError(429, 'rate_limited', 'Too many Runs credited recently; try again later.', { retryAfterSec: retry }, { 'Retry-After': String(retry) });
  }
  if (res.reason === 'run_ended') throw new HttpError(409, 'run_ended', 'This Run has already ended.');
  throw new HttpError(409, 'carried_on', 'This Run is held by another device.');
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
