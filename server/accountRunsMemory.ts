/**
 * An in-memory store for the Account's Runs (server/accountRuns.ts), for tests: the same rows as
 * server/accountRunsPostgres.ts keeps, in maps, with the same lock and transaction semantics (one
 * write per Account at a time; a throw undoes its writes). Snapshots and stats are copied through
 * JSON on the way in and out, as a `jsonb` column does.
 *
 *   const runs = createAccountRuns(new MemoryAccountRunStore());
 */
import type { RunCredit } from '../src/shared/runCredit.js';
import type { AccountRunRows, AccountRunStore, HolderRow, NewCredit, SlotRow } from './accountRuns.js';

interface StoredHolder extends HolderRow {
  updatedAt: number;
}

interface StoredCredit extends NewCredit {
  id: number;
  creditedAt: number;
}

interface AccountState {
  slot: (Omit<SlotRow, 'updatedAt'> & { updatedAt: number }) | null;
  holders: Map<string, StoredHolder>;
  credits: StoredCredit[];
}

const DAY_MS = 86_400_000;

const json = <T>(v: T): T => (v === null || v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

const toRunCredit = (c: StoredCredit): RunCredit => ({ id: c.id, runKey: c.runKey, reason: c.reason, stats: json(c.stats), creditedAt: new Date(c.creditedAt).toISOString() });

export interface MemoryAccountRunStoreOptions {
  /** The store's clock (ms): update and credit times, retention. */
  now?: () => number;
}

export class MemoryAccountRunStore implements AccountRunStore {
  private readonly accounts = new Map<string, AccountState>();
  private readonly locks = new Map<string, Promise<unknown>>();
  private nextCreditId = 1;
  private readonly now: () => number;

  constructor(opts: MemoryAccountRunStoreOptions = {}) {
    this.now = opts.now ?? Date.now;
  }

  write<T>(userId: string, fn: (rows: AccountRunRows) => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      const before = this.copy(userId);
      try {
        return await fn(this.rowsOf(userId));
      } catch (err) {
        this.accounts.set(userId, before); // rolled back
        throw err;
      }
    };
    const tail = this.locks.get(userId) ?? Promise.resolve();
    const result = tail.then(run, run);
    this.locks.set(userId, result.catch(() => undefined));
    return result;
  }

  read<T>(userId: string, fn: (rows: AccountRunRows) => Promise<T>): Promise<T> {
    return fn(this.rowsOf(userId));
  }

  // --- Inspection, for tests ---

  /** The Account's slot as stored, or null. */
  slotOf(userId: string): SlotRow | null {
    const s = this.accounts.get(userId)?.slot;
    return s ? { ...json(s), updatedAt: new Date(s.updatedAt) } : null;
  }

  /** The Account's holder records, by Run key. */
  holdersOf(userId: string): Record<string, HolderRow> {
    const out: Record<string, HolderRow> = {};
    for (const [k, h] of this.accounts.get(userId)?.holders ?? []) out[k] = { lease: h.lease, ended: h.ended };
    return out;
  }

  /** The Account's ledger, oldest first. */
  creditsOf(userId: string): RunCredit[] {
    return (this.accounts.get(userId)?.credits ?? []).map(toRunCredit);
  }

  private state(userId: string): AccountState {
    let s = this.accounts.get(userId);
    if (!s) this.accounts.set(userId, (s = { slot: null, holders: new Map(), credits: [] }));
    return s;
  }

  private copy(userId: string): AccountState {
    const s = this.state(userId);
    return { slot: s.slot ? json(s.slot) : null, holders: new Map([...s.holders].map(([k, h]) => [k, { ...h }])), credits: s.credits.map((c) => ({ ...c, stats: json(c.stats) })) };
  }

  private rowsOf(userId: string): AccountRunRows {
    const st = () => this.state(userId);
    return {
      slot: async () => {
        const s = st().slot;
        return s ? { ...json(s), updatedAt: new Date(s.updatedAt) } : null;
      },
      writeSlot: async (slot) => {
        st().slot = { ...json(slot), updatedAt: this.now() };
      },
      holder: async (runKey) => {
        const h = st().holders.get(runKey);
        return h ? { lease: h.lease, ended: h.ended } : null;
      },
      writeHolder: async (runKey, h) => {
        st().holders.set(runKey, { lease: h.lease, ended: h.ended, updatedAt: this.now() });
      },
      pruneHolders: async (days, keep) => {
        const { holders } = st();
        const cutoff = this.now() - days * DAY_MS;
        const newest = [...holders].sort(([ka, a], [kb, b]) => b.updatedAt - a.updatedAt || (ka < kb ? -1 : ka > kb ? 1 : 0));
        newest.forEach(([k, h], i) => {
          if (h.updatedAt < cutoff || i >= keep) holders.delete(k);
        });
      },
      credit: async (runKey) => {
        const c = st().credits.find((x) => x.runKey === runKey);
        return c ? toRunCredit(c) : null;
      },
      insertCredit: async (credit) => {
        const s = st();
        if (s.credits.some((x) => x.runKey === credit.runKey)) return null;
        const row: StoredCredit = { ...json(credit), id: this.nextCreditId++, creditedAt: this.now() };
        s.credits.push(row);
        return toRunCredit(row);
      },
      recentCredits: async (windowSec) => {
        const since = this.now() - windowSec * 1000;
        const recent = st().credits.filter((c) => c.creditedAt > since);
        return { count: recent.length, oldest: recent.length ? new Date(Math.min(...recent.map((c) => c.creditedAt))) : null };
      },
      pruneCredits: async (keep) => {
        const s = st();
        s.credits = [...s.credits].sort((a, b) => b.id - a.id).slice(0, keep).sort((a, b) => a.id - b.id);
      },
      credits: async (limit) => [...st().credits].sort((a, b) => b.id - a.id).slice(0, limit).map(toRunCredit),
    };
  }
}
