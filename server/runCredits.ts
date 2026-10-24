/**
 * The Run credit ledger's rows (`run_credits`, docs/adr/0003), shared by api/run-credit.ts (claims
 * and the list) and api/saved-run.ts (a replace that credits the replaced Run). One row per
 * `(user_id, run_key)`: `recordCredit` inserts it once and hands back the existing row after that,
 * so every writer is idempotent per Run key.
 */
import type { CreditStats, RunCredit, RunCreditReason } from '../src/shared/runCredit.js';

export type Query = <R>(text: string, params?: unknown[]) => Promise<R[]>;

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
 * Records the credit for a Run, unless the ledger already has one: then that row comes back and
 * `created` is false (a retry, or another device's credit for the same Run). Run it inside the
 * caller's transaction (`q`) after the caller has locked the player's `saved_runs` row, so a claim
 * and a replace for the same Run can't both decide.
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
  const [existing] = await q<CreditRow>(`SELECT ${CREDIT_COLUMNS} FROM run_credits WHERE user_id = $1 AND run_key = $2`, [credit.userId, credit.runKey]);
  if (!existing) throw new Error('run_credits: insert did nothing and no row found');
  return { credit: toRunCredit(existing), created: false };
}
