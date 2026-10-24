/**
 * The Account's Run records (docs/adr/0003), shared by api/run-credit.ts (claims and the list) and
 * api/saved-run.ts (store, take, end):
 *
 * - `run_credits`, the credit ledger: one row per `(user_id, run_key)`. `recordCredit` inserts it
 *   once and hands back the existing row after that, so every writer is idempotent per Run key.
 * - `run_holders`, who holds each Run: one row per `(user_id, run_key)` with the lease it was last
 *   stored or taken under, and `ended_at` once it is over. It outlives the `saved_runs` slot, which
 *   only ever shows the last Run stored: a Run another device replaced in the slot while this one
 *   plays it is still this device's, and a Run that ended stays ended whatever the slot holds now.
 *   `ended_at` without a ledger row means a client from before the ledger ended (and credited) it.
 * - `lockAccountRuns`: every write to any of these runs under one per-Account advisory lock, so a
 *   store, take, end and claim sent together (the pagehide flush) decide one after the other.
 */
import type { CreditStats, RunCredit, RunCreditReason } from '../src/shared/runCredit.js';
import { HttpError } from './http.js';

export type Query = <R>(text: string, params?: unknown[]) => Promise<R[]>;

/** Holder rows older than this, or past the newest `HOLDER_KEEP` per Account, are pruned on a store. */
export const HOLDER_RETENTION_DAYS = 90;
export const HOLDER_KEEP = 200;

export interface CreditRow {
  id: number | string;
  run_key: string;
  reason: RunCreditReason;
  stats: CreditStats;
  credited_at: Date | string;
}

export const CREDIT_COLUMNS = `id, run_key, reason, stats, credited_at`;

export function toRunCredit(row: CreditRow): RunCredit {
  return { id: Number(row.id), runKey: row.run_key, reason: row.reason, stats: row.stats, creditedAt: new Date(row.credited_at).toISOString() };
}

/**
 * Serialises this Account's Run writes for the rest of the transaction (`q` must be inside one).
 * A transaction-scoped advisory lock: released at commit or rollback, and it works when there is
 * no `saved_runs` row yet to lock (`FOR UPDATE` on no row locks nothing).
 */
export async function lockAccountRuns(q: Query, userId: string): Promise<void> {
  await q(`SELECT pg_advisory_xact_lock(hashtext('account_runs'), hashtext($1))`, [userId]);
}

export interface Holder {
  lease: string;
  ended: boolean;
}

/** Who holds `runKey`, and whether it ended; null when the server never saw it (or pruned it). */
export async function holderOf(q: Query, userId: string, runKey: string): Promise<Holder | null> {
  const [row] = await q<{ lease: string; ended_at: Date | string | null }>(`SELECT lease, ended_at FROM run_holders WHERE user_id = $1 AND run_key = $2`, [userId, runKey]);
  return row ? { lease: row.lease, ended: row.ended_at !== null } : null;
}

/**
 * The checks on `runKey`'s own holder record, shared by a store and a claim: a Run that ended is
 * over whatever the slot holds now (`409 run_ended`); one another device stored or took since is
 * theirs (`409 carried_on`). Null when the server never saw the Run (nothing to check against).
 */
export async function checkHolder(q: Query, userId: string, runKey: string, lease: string, prevLease: string | undefined): Promise<Holder | null> {
  const holder = await holderOf(q, userId, runKey);
  if (holder?.ended) throw new HttpError(409, 'run_ended', 'This Run has already ended.');
  if (holder && holder.lease !== lease && holder.lease !== prevLease) throw new HttpError(409, 'carried_on', 'This Run is held by another device.');
  return holder;
}

/** Records who holds `runKey` now (a store or a take), or that it ended (an end, a claim, a replace). */
export async function setHolder(q: Query, userId: string, runKey: string, lease: string, ended: boolean): Promise<void> {
  await q(
    `INSERT INTO run_holders (user_id, run_key, lease, ended_at, updated_at) VALUES ($1, $2, $3, CASE WHEN $4 THEN now() END, now())
     ON CONFLICT (user_id, run_key) DO UPDATE SET lease = EXCLUDED.lease, ended_at = COALESCE(run_holders.ended_at, EXCLUDED.ended_at), updated_at = now()`,
    [userId, runKey, lease, ended],
  );
}

/** Drops this Account's holder rows past the retention policy (see the constants above). */
export async function pruneHolders(q: Query, userId: string): Promise<void> {
  await q(
    `DELETE FROM run_holders WHERE user_id = $1 AND (updated_at < now() - make_interval(days => $2)
       OR run_key IN (SELECT run_key FROM run_holders WHERE user_id = $1 ORDER BY updated_at DESC, run_key OFFSET $3))`,
    [userId, HOLDER_RETENTION_DAYS, HOLDER_KEEP],
  );
}

/** The ledger row for `runKey`, if the Run is credited. */
export async function creditOf(q: Query, userId: string, runKey: string): Promise<CreditRow | null> {
  const [row] = await q<CreditRow>(`SELECT ${CREDIT_COLUMNS} FROM run_credits WHERE user_id = $1 AND run_key = $2`, [userId, runKey]);
  return row ?? null;
}

/**
 * Records the credit for a Run, unless the ledger already has one: then that row comes back and
 * `created` is false (a retry, or another device's credit for the same Run). Run it inside the
 * caller's transaction (`q`) after `lockAccountRuns`, so a claim and a replace for the same Run
 * can't both decide.
 */
export async function recordCredit(
  q: Query,
  credit: { userId: string; runKey: string; lease: string | null; reason: RunCreditReason; stats: CreditStats },
): Promise<{ credit: RunCredit; created: boolean }> {
  const [inserted] = await q<CreditRow>(
    `INSERT INTO run_credits (user_id, run_key, lease, reason, stats) VALUES ($1, $2, $3, $4, $5::jsonb)
     ON CONFLICT (user_id, run_key) DO NOTHING RETURNING ${CREDIT_COLUMNS}`,
    [credit.userId, credit.runKey, credit.lease, credit.reason, JSON.stringify(credit.stats)],
  );
  if (inserted) return { credit: toRunCredit(inserted), created: true };
  const existing = await creditOf(q, credit.userId, credit.runKey);
  if (!existing) throw new Error('run_credits: insert did nothing and no row found');
  return { credit: toRunCredit(existing), created: false };
}
