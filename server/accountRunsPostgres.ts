/**
 * The Postgres store for the Account's Runs (server/accountRuns.ts): tables `saved_runs`,
 * `run_holders` and `run_credits` (server/schema.ts). It stores and reads rows; the rules are the
 * module's. `accountRuns` is the module over it, as api/saved-run.ts and api/run-credit.ts use it.
 */
import type { RunCredit, RunCreditReason, CreditStats } from '../src/shared/runCredit.js';
import { createAccountRuns, type AccountRunRows, type AccountRunStore, type ServerAccountRuns } from './accountRuns.js';
import { query, transaction } from './db.js';

type Query = <R>(text: string, params?: unknown[]) => Promise<R[]>;

interface CreditRow {
  id: number | string;
  run_key: string;
  reason: RunCreditReason;
  stats: CreditStats;
  credited_at: Date | string;
}

const CREDIT_COLUMNS = `id, run_key, reason, stats, credited_at`;

function toRunCredit(row: CreditRow): RunCredit {
  return { id: Number(row.id), runKey: row.run_key, reason: row.reason, stats: row.stats, creditedAt: new Date(row.credited_at).toISOString() };
}

function rowsOf(q: Query, userId: string): AccountRunRows {
  return {
    async slot() {
      const [row] = await q<{ run_key: string; lease: string; snapshot: Record<string, unknown> | null; version: number | null; ended_at: Date | string | null; updated_at: Date | string }>(
        `SELECT run_key, lease, snapshot, version, ended_at, updated_at FROM saved_runs WHERE user_id = $1`,
        [userId],
      );
      return row ? { runKey: row.run_key, lease: row.lease, snapshot: row.snapshot, version: row.version, ended: row.ended_at !== null, updatedAt: row.updated_at } : null;
    },
    async writeSlot(s) {
      await q(
        `INSERT INTO saved_runs (user_id, run_key, lease, snapshot, version, ended_at, updated_at) VALUES ($1, $2, $3, $4::jsonb, $5, CASE WHEN $6 THEN now() END, now())
         ON CONFLICT (user_id) DO UPDATE SET run_key = EXCLUDED.run_key, lease = EXCLUDED.lease, snapshot = EXCLUDED.snapshot, version = EXCLUDED.version, ended_at = EXCLUDED.ended_at, updated_at = now()`,
        [userId, s.runKey, s.lease, s.snapshot === null ? null : JSON.stringify(s.snapshot), s.version, s.ended],
      );
    },
    async holder(runKey) {
      const [row] = await q<{ lease: string; ended_at: Date | string | null }>(`SELECT lease, ended_at FROM run_holders WHERE user_id = $1 AND run_key = $2`, [userId, runKey]);
      return row ? { lease: row.lease, ended: row.ended_at !== null } : null;
    },
    async writeHolder(runKey, h) {
      // An ended record keeps the time it first ended.
      await q(
        `INSERT INTO run_holders (user_id, run_key, lease, ended_at, updated_at) VALUES ($1, $2, $3, CASE WHEN $4 THEN now() END, now())
         ON CONFLICT (user_id, run_key) DO UPDATE SET lease = EXCLUDED.lease, ended_at = CASE WHEN $4 THEN COALESCE(run_holders.ended_at, now()) END, updated_at = now()`,
        [userId, runKey, h.lease, h.ended],
      );
    },
    async pruneHolders(days, keep) {
      await q(
        `DELETE FROM run_holders WHERE user_id = $1 AND (updated_at < now() - make_interval(days => $2)
           OR run_key IN (SELECT run_key FROM run_holders WHERE user_id = $1 ORDER BY updated_at DESC, run_key OFFSET $3))`,
        [userId, days, keep],
      );
    },
    async credit(runKey) {
      const [row] = await q<CreditRow>(`SELECT ${CREDIT_COLUMNS} FROM run_credits WHERE user_id = $1 AND run_key = $2`, [userId, runKey]);
      return row ? toRunCredit(row) : null;
    },
    async insertCredit(c) {
      const [row] = await q<CreditRow>(
        `INSERT INTO run_credits (user_id, run_key, lease, reason, stats) VALUES ($1, $2, $3, $4, $5::jsonb)
         ON CONFLICT (user_id, run_key) DO NOTHING RETURNING ${CREDIT_COLUMNS}`,
        [userId, c.runKey, c.lease, c.reason, JSON.stringify(c.stats)],
      );
      return row ? toRunCredit(row) : null;
    },
    async recentCredits(windowSec) {
      const [row] = await q<{ n: string | number; oldest: Date | string | null }>(
        `SELECT count(*) AS n, min(credited_at) AS oldest FROM run_credits WHERE user_id = $1 AND credited_at > now() - make_interval(secs => $2)`,
        [userId, windowSec],
      );
      return { count: Number(row?.n ?? 0), oldest: row?.oldest ? new Date(row.oldest) : null };
    },
    async pruneCredits(keep) {
      await q(`DELETE FROM run_credits WHERE user_id = $1 AND id IN (SELECT id FROM run_credits WHERE user_id = $1 ORDER BY id DESC OFFSET $2)`, [userId, keep]);
    },
    async credits(limit) {
      const rows = await q<CreditRow>(`SELECT ${CREDIT_COLUMNS} FROM run_credits WHERE user_id = $1 ORDER BY id DESC LIMIT $2`, [userId, limit]);
      return rows.map(toRunCredit);
    },
  };
}

export const postgresAccountRunStore: AccountRunStore = {
  write: (userId, fn) =>
    transaction(async (q) => {
      // A transaction-scoped advisory lock: released at commit or rollback, and it works when there
      // is no `saved_runs` row yet to lock (`FOR UPDATE` on no row locks nothing): a store into an
      // empty slot and a claim for the same Run (the pagehide flush sends them together) would both decide.
      await q(`SELECT pg_advisory_xact_lock(hashtext('account_runs'), hashtext($1))`, [userId]);
      return fn(rowsOf(q, userId));
    }),
  read: (userId, fn) => fn(rowsOf(query, userId)),
};

/** The Account's Runs, stored in Postgres. */
export const accountRuns: ServerAccountRuns = createAccountRuns(postgresAccountRunStore);
