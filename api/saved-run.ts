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
 * Holders (`run_holders`): the slot shows only the last Run stored, so each
 * Run's own holder record (lease, ended) is kept current by PUT, take and DELETE and checked by PUT
 * and the claim: a Run another device plays stays theirs after a new Run replaces it in the slot.
 * Every write runs under the Account's lock, so a PUT, take, DELETE and claim sent together decide
 * one after the other. The rules live in server/accountRuns.ts; this file authenticates, validates
 * and maps the module's answer to a status.
 *
 * Errors are JSON `{ error: code, message, field? }`: 401 unauthorized (no session), 400 invalid /
 * bad_json, 405, 409, 413 too_large, 503 unavailable.
 */
import { sessionUser } from '../server/auth.js';
import { accountRuns } from '../server/accountRunsPostgres.js';
import { ensureSchema } from '../server/db.js';
import { errorResponse, HttpError, json, readJson } from '../server/http.js';
import { MAX_SAVED_RUN_BYTES, validateSavedRunClaim, validateSavedRunUpload } from '../src/shared/savedRun.js';

/** Take and end bodies are only ids. */
const MAX_CLAIM_BYTES = 2_048;

async function requireUser(request: Request): Promise<string> {
  const user = await sessionUser(request);
  if (!user) throw new HttpError(401, 'unauthorized', 'Sign in to keep a saved Run with your account.');
  return user.id;
}

const REFUSALS = {
  carried_on: 'This Run is held by another device.',
  run_ended: 'This Run has already ended.',
  newer_saved_run: 'A saved Run from a newer version of the game is stored; update to replace it.',
} as const;

async function get(request: Request): Promise<Response> {
  await ensureSchema();
  const userId = await requireUser(request);
  return json(200, { savedRun: await accountRuns.savedRun(userId) });
}

async function put(request: Request): Promise<Response> {
  await ensureSchema();
  const userId = await requireUser(request);
  const v = validateSavedRunUpload(await readJson(request, MAX_SAVED_RUN_BYTES));
  if (!v.ok) throw new HttpError(400, 'invalid', v.message, { field: v.field });
  const res = await accountRuns.store(userId, v.value);
  if (!res.ok) throw new HttpError(409, res.reason, REFUSALS[res.reason]);
  return json(200, { stored: true, replaced: res.replaced, credits: res.credits });
}

async function take(request: Request): Promise<Response> {
  await ensureSchema();
  const userId = await requireUser(request);
  const v = validateSavedRunClaim(await readJson(request, MAX_CLAIM_BYTES), true);
  if (!v.ok) throw new HttpError(400, 'invalid', v.message, { field: v.field });
  const { runKey, lease, newLease } = v.value;
  if (newLease === undefined) throw new HttpError(400, 'invalid', 'newLease must be a non-empty string.', { field: 'newLease' });
  const res = await accountRuns.take(userId, { runKey, lease, newLease });
  if (!res.ok) throw new HttpError(409, res.reason, REFUSALS[res.reason], res.savedRun ? { savedRun: res.savedRun } : {});
  return json(200, { taken: true, snapshot: res.snapshot, version: res.version });
}

async function end(request: Request): Promise<Response> {
  await ensureSchema();
  const userId = await requireUser(request);
  const v = validateSavedRunClaim(await readJson(request, MAX_CLAIM_BYTES), false);
  if (!v.ok) throw new HttpError(400, 'invalid', v.message, { field: v.field });
  const res = await accountRuns.end(userId, v.value);
  return json(200, { deleted: res.deleted, snapshot: res.snapshot });
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
