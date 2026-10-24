/**
 * The Account's Runs (docs/adr/0002, docs/adr/0003): the saved Run slot, who holds each Run and the
 * credit ledger, with every rule about them. api/saved-run.ts and api/run-credit.ts authenticate,
 * validate and map a result to an HTTP status; everything else is here:
 *
 * - The slot (`saved_runs`): one per Account, the last Run stored. A Run that ended keeps its row,
 *   marked ended, until another Run is stored, so a late upload of it is refused.
 * - Holders (`run_holders`): one record per Run with the lease it was last stored or taken under,
 *   and whether it ended. It outlives the slot: a Run another device replaced in the slot while
 *   this one plays it is still this one's, and a Run that ended stays ended whatever the slot holds
 *   now. Ended without a ledger row means a client from before the ledger ended (and credited) it.
 * - The ledger (`run_credits`): one row per Run key, the only record that a Run is credited.
 *
 * Every write runs under one per-Account lock (`AccountRunStore.write`), so a store, take, end and
 * claim sent together (the pagehide flush) decide one after the other; every check comes before
 * the first write, so a refusal writes nothing.
 *
 * Storage sits behind `AccountRunStore`, which stores and reads rows and decides nothing:
 * server/accountRunsPostgres.ts (production) and server/accountRunsMemory.ts (tests).
 */
import { pickCreditStats, salvageCreditStats, type CreditStats, type RunCredit, type RunCreditClaim, type RunCreditReason } from '../src/shared/runCredit.js';
import { migrateRunSnapshot, type SavedRunUpload, type ServerSavedRun } from '../src/shared/savedRun.js';

/** Holder records older than this, or past the newest `HOLDER_KEEP` per Account, are pruned on a store, a claim and an end. */
export const HOLDER_RETENTION_DAYS = 90;
export const HOLDER_KEEP = 200;
/**
 * New ledger rows an Account may create per window (a claim for a Run not yet in the ledger). The
 * leaderboard's Run board allows the same per Account (`RATE_LIMIT.account.run`): a Run credits once
 * and posts once. Counted from the stored rows, so it holds across instances; a claim for a Run
 * already in the ledger is answered from the row and never counts.
 */
export const CREDIT_RATE_LIMIT = { max: 30, windowSec: 600 };
/** Ledger rows kept per Account (the newest); older ones are pruned when a row is created. */
export const CREDIT_KEEP = 1000;

// ---------------------------------------------------------------------------------------------
// The storage seam
// ---------------------------------------------------------------------------------------------

/** The Account's saved Run slot as stored. `snapshot` is the stored JSON as it was written (not migrated). */
export interface SlotRow {
  runKey: string;
  lease: string;
  snapshot: Record<string, unknown> | null;
  version: number | null;
  ended: boolean;
  updatedAt: Date | string;
}

/** A slot write: the whole row (the store stamps `updatedAt`). */
export type SlotWrite = Omit<SlotRow, 'updatedAt'>;

/** One Run's holder record. */
export interface HolderRow {
  lease: string;
  ended: boolean;
}

export interface NewCredit {
  runKey: string;
  /** The lease the Run ended under (the replaced copy's, for a replace). */
  lease: string | null;
  reason: RunCreditReason;
  stats: CreditStats;
}

/**
 * One Account's rows, as `AccountRunStore.write` / `read` hand them to an operation. Each method
 * stores or reads exactly what it says; the rules (what to check, in what order, what to write)
 * are this module's.
 */
export interface AccountRunRows {
  slot(): Promise<SlotRow | null>;
  /** Inserts or overwrites the slot. */
  writeSlot(slot: SlotWrite): Promise<void>;
  holder(runKey: string): Promise<HolderRow | null>;
  /** Inserts or overwrites `runKey`'s holder record, stamping its update time. */
  writeHolder(runKey: string, holder: HolderRow): Promise<void>;
  /** Deletes holder records last updated more than `days` ago, or past the newest `keep` (by update time, then Run key). */
  pruneHolders(days: number, keep: number): Promise<void>;
  credit(runKey: string): Promise<RunCredit | null>;
  /** Inserts a ledger row; null (and nothing written) when `runKey` already has one. */
  insertCredit(credit: NewCredit): Promise<RunCredit | null>;
  /** Ledger rows created in the last `windowSec`, and when the oldest of them was. */
  recentCredits(windowSec: number): Promise<{ count: number; oldest: Date | null }>;
  /** Deletes ledger rows past the newest `keep`. */
  pruneCredits(keep: number): Promise<void>;
  /** The newest `limit` ledger rows, newest first. */
  credits(limit: number): Promise<RunCredit[]>;
}

export interface AccountRunStore {
  /** Runs `fn` in one transaction under the Account's lock: writes from one Account decide one at a time. A throw undoes its writes. */
  write<T>(userId: string, fn: (rows: AccountRunRows) => Promise<T>): Promise<T>;
  /** Runs `fn` without the lock (reads only). */
  read<T>(userId: string, fn: (rows: AccountRunRows) => Promise<T>): Promise<T>;
}

// ---------------------------------------------------------------------------------------------
// The operations
// ---------------------------------------------------------------------------------------------

/** `run_ended`: the Run is over (in the ledger, or ended). `carried_on`: another device holds it. `newer_saved_run`: a newer build's Run is stored, and kept. */
export type StoreResult =
  | { ok: true; replaced: { runKey: string; snapshot: Record<string, unknown> } | null; credits: RunCredit[] }
  | { ok: false; reason: 'run_ended' | 'carried_on' | 'newer_saved_run' };

/** Refused: `savedRun` is the slot as it is now (an ended Run has its key and no snapshot), or null when there is none. */
export type TakeResult =
  | { ok: true; snapshot: Record<string, unknown> | null; version: number | null }
  | { ok: false; reason: 'carried_on'; savedRun: ServerSavedRun | null };

/** `deleted`: the Run was the caller's to end (in the slot under its lease, or by its holder record). */
export interface EndResult {
  ok: true;
  deleted: boolean;
  snapshot: Record<string, unknown> | null;
}

export type ClaimResult =
  | { ok: true; credit: RunCredit; created: boolean }
  | { ok: false; reason: 'run_ended' | 'carried_on' }
  | { ok: false; reason: 'rate_limited'; retryAfterSec: number };

export interface ServerAccountRuns {
  /** The Account's saved Run, unless none is stored or the last one ended (`GET /api/saved-run`). */
  savedRun(userId: string): Promise<ServerSavedRun | null>;
  /** Stores a Run (pause, Save & quit; `PUT /api/saved-run`). */
  store(userId: string, upload: SavedRunUpload): Promise<StoreResult>;
  /** Takes the stored Run to play it here (Resume, unpause; `POST /api/saved-run`). */
  take(userId: string, body: { runKey: string; lease: string; newLease: string }): Promise<TakeResult>;
  /** Ends a Run without the ledger (clients from before it; `DELETE /api/saved-run`). */
  end(userId: string, body: { runKey: string; lease: string; prevLease?: string }): Promise<EndResult>;
  /** Claims a Run's ending: credits it once in the ledger (`POST /api/run-credit`). */
  claim(userId: string, claim: RunCreditClaim): Promise<ClaimResult>;
  /** The newest ledger rows, newest first (`GET /api/run-credit`). */
  credits(userId: string, limit: number): Promise<RunCredit[]>;
}

/** Stored older snapshots come back migrated (the server always runs the newest build); newer ones as they are. */
function readSnapshot(raw: Record<string, unknown> | null): Record<string, unknown> | null {
  return raw === null ? null : migrateRunSnapshot(raw);
}

function toSavedRun(slot: SlotRow): ServerSavedRun {
  const snapshot = readSnapshot(slot.snapshot);
  return {
    runKey: slot.runKey,
    lease: slot.lease,
    version: snapshot ? (slot.version ?? null) : null,
    snapshot,
    updatedAt: new Date(slot.updatedAt).toISOString(),
  };
}

/** A lease the caller may hold the Run under: its own, or the one before a take it never heard back about. */
const holds = (lease: string, caller: { lease: string; prevLease?: string | undefined }): boolean => lease === caller.lease || lease === caller.prevLease;

/**
 * The checks on `runKey`'s own holder record, shared by a store and a claim: a Run that ended is
 * over whatever the slot holds now; one another device stored or took since is theirs.
 */
function holderRefusal(holder: HolderRow | null, caller: { lease: string; prevLease?: string | undefined }): 'run_ended' | 'carried_on' | null {
  if (holder?.ended) return 'run_ended';
  if (holder && !holds(holder.lease, caller)) return 'carried_on';
  return null;
}

/**
 * The checks on the slot when it holds `runKey`, for rows from before holder records existed: the
 * slot itself says whether the Run ended or moved.
 */
function slotRefusal(slot: SlotRow, caller: { lease: string; prevLease?: string | undefined }): 'run_ended' | 'carried_on' | null {
  if (slot.ended) return 'run_ended';
  if (!holds(slot.lease, caller)) return 'carried_on';
  return null;
}

/**
 * Records `runKey` as the ended Run on an empty slot, so a late upload of it is refused: when there
 * is no slot, or it holds another Run that ended. A Run still going in the slot is left alone.
 */
async function endOnEmptySlot(rows: AccountRunRows, slot: SlotRow | null, runKey: string, lease: string): Promise<void> {
  if (slot && !(slot.ended && slot.runKey !== runKey)) return;
  await rows.writeSlot({ runKey, lease, snapshot: null, version: null, ended: true });
}

/** Prunes holder records past the retention policy (`HOLDER_RETENTION_DAYS`, `HOLDER_KEEP`). */
const pruneHolders = (rows: AccountRunRows): Promise<void> => rows.pruneHolders(HOLDER_RETENTION_DAYS, HOLDER_KEEP);

/**
 * Records the credit for a Run, unless the ledger already has one: then that row comes back and
 * `created` is false (a retry, or another device's credit for the same Run). A new row prunes the
 * Account's ledger to the newest `CREDIT_KEEP`.
 */
async function recordCredit(rows: AccountRunRows, credit: NewCredit): Promise<{ credit: RunCredit; created: boolean }> {
  const inserted = await rows.insertCredit(credit);
  if (inserted) {
    await rows.pruneCredits(CREDIT_KEEP);
    return { credit: inserted, created: true };
  }
  const existing = await rows.credit(credit.runKey);
  if (!existing) throw new Error('run_credits: insert did nothing and no row found');
  return { credit: existing, created: false };
}

/**
 * Seconds until a claim that would create a ledger row may be made, or null when the Account is
 * under `CREDIT_RATE_LIMIT`.
 */
async function creditRateWait(rows: AccountRunRows, now: number): Promise<number | null> {
  const recent = await rows.recentCredits(CREDIT_RATE_LIMIT.windowSec);
  if (recent.count < CREDIT_RATE_LIMIT.max) return null;
  const oldest = recent.oldest ? new Date(recent.oldest).getTime() : now;
  return Math.max(1, Math.ceil((oldest + CREDIT_RATE_LIMIT.windowSec * 1000 - now) / 1000));
}

export interface AccountRunsOptions {
  /** The clock for `Retry-After` (ms). */
  now?: () => number;
}

export function createAccountRuns(store: AccountRunStore, opts: AccountRunsOptions = {}): ServerAccountRuns {
  const now = opts.now ?? Date.now;
  return {
    savedRun: (userId) =>
      store.read(userId, async (rows) => {
        const slot = await rows.slot();
        return slot && !slot.ended ? toSavedRun(slot) : null;
      }),

    store: (userId, upload) =>
      store.write(userId, async (rows): Promise<StoreResult> => {
        const { runKey, lease, snapshot, version, ledger } = upload;
        // A Run in the ledger ended for good, whatever the slot holds now (a device that fell
        // behind across a whole other Run's start can't store it again).
        if (await rows.credit(runKey)) return { ok: false, reason: 'run_ended' };
        // Its own holder record: ended (by a client from before the ledger), or another device's now.
        const holder = await rows.holder(runKey);
        const byHolder = holderRefusal(holder, upload);
        if (byHolder) return { ok: false, reason: byHolder };
        const old = await rows.slot();
        if (old && old.runKey === runKey) {
          const bySlot = slotRefusal(old, upload);
          if (bySlot) return { ok: false, reason: bySlot };
        } else if (old && old.snapshot !== null && (old.version ?? 0) > version) {
          // Another Run from a newer build is never replaced (docs/adr/0001).
          return { ok: false, reason: 'newer_saved_run' };
        }
        await rows.writeSlot({ runKey, lease, snapshot, version, ended: false });
        await rows.writeHolder(runKey, { lease, ended: false });
        await pruneHolders(rows);
        if (!old) return { ok: true, replaced: null, credits: [] };
        const replacedSnapshot = old.runKey !== runKey && old.snapshot !== null ? readSnapshot(old.snapshot) : null;
        const replaced = replacedSnapshot ? { runKey: old.runKey, snapshot: replacedSnapshot } : null;
        const credits: RunCredit[] = [];
        if (replaced) {
          // The replaced Run's stored copy is gone, so it is over: ended for its holder record either
          // way. A ledger client's replace credits it here, as a quit, once per Run key; a client from
          // before the ledger credits `replaced` itself, so the ledger gets no row, and a later claim
          // for the Run (a stale synced copy on a ledger client) is refused with `run_ended`.
          await rows.writeHolder(old.runKey, { lease: old.lease, ended: true });
          if (ledger) {
            // The stored copy's stats, salvaged if they don't read whole; zeros only when there are none at all.
            const stats = pickCreditStats(replacedSnapshot?.stats) ?? salvageCreditStats(replacedSnapshot?.stats);
            credits.push((await recordCredit(rows, { runKey: old.runKey, lease: old.lease, reason: 'quit', stats })).credit);
          }
        }
        return { ok: true, replaced, credits };
      }),

    take: (userId, { runKey, lease, newLease }) =>
      store.write(userId, async (rows): Promise<TakeResult> => {
        // Of two racing takes, the second finds the lease moved (`newLease` matches too, so a retry
        // of the take that won still succeeds). A Run in the ledger is over, whatever the slot says.
        const slot = await rows.slot();
        const takeable = slot !== null && slot.runKey === runKey && holds(slot.lease, { lease, prevLease: newLease }) && !slot.ended && !(await rows.credit(runKey));
        // An ended Run comes back too (its key, no snapshot): the taker learns it isn't theirs to play.
        if (!takeable) return { ok: false, reason: 'carried_on', savedRun: slot ? toSavedRun(slot) : null };
        await rows.writeSlot({ runKey, lease: newLease, snapshot: null, version: null, ended: false });
        const holder = await rows.holder(runKey);
        await rows.writeHolder(runKey, { lease: newLease, ended: holder?.ended ?? false });
        // The taker gets the snapshot it took.
        const snapshot = readSnapshot(slot.snapshot);
        return { ok: true, snapshot, version: snapshot ? slot.version : null };
      }),

    end: (userId, { runKey, lease, prevLease }) =>
      store.write(userId, async (rows): Promise<EndResult> => {
        const slot = await rows.slot();
        // In the slot under the caller's lease: ended there. The row stays, marked ended, so a late
        // upload of this Run is refused.
        const inSlot = slot !== null && slot.runKey === runKey && holds(slot.lease, { lease, prevLease }) && !slot.ended;
        if (inSlot) await rows.writeSlot({ runKey, lease: slot.lease, snapshot: null, version: null, ended: true });
        // The caller credits a Run it ended (`deleted: true`) itself: the holder record keeps that, so
        // a ledger client's later claim for it is refused rather than crediting it a second time. The
        // holder decides too: a Run this device plays that another Run replaced in the slot is still its.
        const holder = await rows.holder(runKey);
        if (inSlot || (holder !== null && !holder.ended && holds(holder.lease, { lease, prevLease }))) {
          await rows.writeHolder(runKey, { lease, ended: true });
          await pruneHolders(rows);
          return { ok: true, deleted: true, snapshot: inSlot ? readSnapshot(slot.snapshot) : null };
        }
        // Not held here. A Run the Account doesn't have (never stored, or its upload is still on the
        // way) is recorded as ended all the same, unless the slot holds another Run that is still going.
        await endOnEmptySlot(rows, slot, runKey, lease);
        if (!holder) {
          await rows.writeHolder(runKey, { lease, ended: true });
          await pruneHolders(rows);
        }
        return { ok: true, deleted: false, snapshot: null };
      }),

    claim: (userId, claim) =>
      store.write(userId, async (rows): Promise<ClaimResult> => {
        const { runKey, lease, reason, stats } = claim;
        // A Run in the ledger: its row, to anyone (a retry after a lost answer, or another device's claim).
        const existing = await rows.credit(runKey);
        if (existing) return { ok: true, credit: existing, created: false };
        // The Run's own holder record: ended by a client from before the ledger (credited there, so
        // `run_ended`: nothing here applies it), or another device's now (`carried_on`).
        const byHolder = holderRefusal(await rows.holder(runKey), claim);
        if (byHolder) return { ok: false, reason: byHolder };
        // A new row: bounded per Account. Nothing is written before this.
        const wait = await creditRateWait(rows, now());
        if (wait !== null) return { ok: false, reason: 'rate_limited', retryAfterSec: wait };
        const slot = await rows.slot();
        if (slot && slot.runKey === runKey) {
          const bySlot = slotRefusal(slot, claim);
          if (bySlot) return { ok: false, reason: bySlot };
          await rows.writeSlot({ runKey, lease: slot.lease, snapshot: null, version: null, ended: true });
        } else {
          // Not in the slot: never stored, its upload still on the way, or replaced there while this
          // device played it (its holder record says so). Recorded as ended on an empty slot all the
          // same, so a late upload is refused.
          await endOnEmptySlot(rows, slot, runKey, lease);
        }
        await rows.writeHolder(runKey, { lease, ended: true });
        await pruneHolders(rows); // a player who never pauses only ever claims: holders are pruned here too
        return { ok: true, ...(await recordCredit(rows, { runKey, lease, reason, stats })) };
      }),

    credits: (userId, limit) => store.read(userId, (rows) => rows.credits(limit)),
  };
}
