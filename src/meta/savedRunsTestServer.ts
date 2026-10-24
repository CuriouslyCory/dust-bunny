/**
 * Test helpers for the saved Run (src/meta/savedRuns.ts): the real server rules
 * (server/accountRuns.ts) over the in-memory store (server/accountRunsMemory.ts), behind a
 * simulated network (`TestServer`), plus in-memory storage and `storage` events. Not a test file:
 * the saved Run tests import it.
 */
import { createAccountRuns } from '../../server/accountRuns';
import { MemoryAccountRunStore } from '../../server/accountRunsMemory';
import { RUN_CREDIT_LIST_LIMIT, validateRunCreditClaim, type RunCredit } from '../shared/runCredit';
import { validateSavedRunClaim, validateSavedRunUpload } from '../shared/savedRun';
import { SavedRunAuthError, SavedRunNetError, type PutResult, type SavedRunApi, type TakeResult } from './savedRuns';
import type { ClaimResult, RunCreditApi } from './runCredits';

/** localStorage in memory (`map`: what it holds). */
export const memStorage = () => {
  const map = new Map<string, string>();
  return { map, getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) };
};

/** The Account the test devices sign in as unless a test says otherwise. */
export const USER = 'u1';

/** A JSON round trip: what goes over the wire. */
export const wire = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

/** A device's connection: whether it is offline, and who it is signed in as (`undefined`: u1). */
export interface Link {
  offline: boolean;
  user?: string | null;
}

/**
 * The real server rules (server/accountRuns.ts) over the in-memory store, behind the client's
 * `SavedRunApi` / `RunCreditApi`: each request is validated as api/saved-run.ts and
 * api/run-credit.ts validate it, and the module's answer is mapped as those handlers and the
 * client's HTTP callers map it. The network is simulated here: `offline`: every request fails.
 * `loseAnswer[what]`: the next such request is carried out but its answer is lost (a network error
 * after the server wrote). `calls`: what was asked. `row` and `ledger`: u1's slot and ledger as stored.
 */
export class TestServer {
  /** The server's clock (ms). A 429 moves it past the wait it asks for: the client's backoff stands for that time. */
  now = Date.now();
  readonly store = new MemoryAccountRunStore({ now: () => this.now });
  readonly runs = createAccountRuns(this.store, { now: () => this.now });
  offline = false;
  /** While set, every answer waits for it (a slow network). */
  gate: Promise<void> | null = null;
  /** Answers to one kind of request (`put`, `take`, `claim`, …) wait for its promise (that request is slow). */
  hold: Partial<Record<string, Promise<void>>> = {};
  loseAnswer: Partial<Record<string, boolean>> = {};
  calls: string[] = [];

  /** u1's saved Run slot as stored (`ended` once the Run is over), or null. */
  get row(): { runKey: string; lease: string; snapshot: Record<string, unknown> | null; version: number | null; ended: boolean } | null {
    const s = this.store.slotOf(USER);
    return s ? { runKey: s.runKey, lease: s.lease, snapshot: s.snapshot, version: s.version, ended: s.ended } : null;
  }

  /** u1's ledger, oldest first. */
  get ledger(): RunCredit[] {
    return this.store.creditsOf(USER);
  }

  private async net(what: string, link: Link): Promise<string> {
    // The session is the one signed in when the request leaves.
    const user = link.user === undefined ? USER : link.user;
    this.calls.push(what);
    if (this.gate) await this.gate;
    if (this.hold[what]) await this.hold[what];
    if (this.offline || link.offline) throw new SavedRunNetError('offline');
    if (user === null) throw new SavedRunAuthError('unauthorized');
    return user;
  }

  private answer<T>(what: string, value: T): T {
    if (this.loseAnswer[what]) {
      this.loseAnswer[what] = false;
      throw new SavedRunNetError('answer lost');
    }
    return wire(value);
  }

  /** `link.offline`: this device alone can't reach the server. `link.user`: who it is signed in as (default u1). */
  api(link: Link = { offline: false }): SavedRunApi {
    return {
      get: async () => {
        // Read as the request arrives; a slow answer (`gate`, `hold`) reports the row as it was then.
        const row = this.runs.savedRun(link.user ?? USER);
        await this.net('get', link);
        return wire(await row);
      },
      put: async (body): Promise<PutResult> => {
        const sent = wire(body);
        const user = await this.net('put', link);
        const v = validateSavedRunUpload(sent);
        if (!v.ok) return { ok: false, reason: 'rejected' };
        const res = await this.runs.store(user, v.value);
        return this.answer('put', res.ok ? { ok: true, credits: res.credits } : { ok: false, reason: res.reason === 'newer_saved_run' ? 'newer' : 'carriedOn' });
      },
      take: async (body): Promise<TakeResult> => {
        const sent = wire(body);
        const user = await this.net('take', link);
        const v = validateSavedRunClaim(sent, true);
        if (!v.ok || v.value.newLease === undefined) throw new SavedRunNetError('saved-run 400');
        const res = await this.runs.take(user, { runKey: v.value.runKey, lease: v.value.lease, newLease: v.value.newLease });
        return this.answer('take', res.ok ? { taken: true, snapshot: res.snapshot } : { taken: false, savedRun: res.savedRun });
      },
    };
  }

  /** A device's connection to this server: what `SavedRuns` takes as `api` and `creditApi`. */
  client(link: Link = { offline: false }): { api: SavedRunApi; creditApi: RunCreditApi } {
    return { api: this.api(link), creditApi: this.creditApi(link) };
  }

  creditApi(link: Link = { offline: false }): RunCreditApi {
    return {
      claim: async (body): Promise<ClaimResult> => {
        const sent = wire(body);
        const user = await this.net('claim', link);
        const v = validateRunCreditClaim(sent);
        if (!v.ok) return { ok: false, reason: 'rejected' };
        const res = await this.runs.claim(user, v.value);
        if (!res.ok && res.reason === 'rate_limited') {
          this.now += res.retryAfterSec * 1000;
          throw new SavedRunNetError('run-credit 429');
        }
        return this.answer('claim', res.ok ? { ok: true, credit: res.credit, created: res.created } : { ok: false, reason: res.reason === 'run_ended' ? 'runEnded' : 'carriedOn' });
      },
      list: async (limit = RUN_CREDIT_LIST_LIMIT) => {
        const user = await this.net('list', link);
        return this.answer('list', await this.runs.credits(user, limit));
      },
    };
  }
}

/** The browser's `storage` events between tabs that share one storage (fired by hand: `fire`). */
export const fakeEvents = () => {
  const listeners = new Set<(e: { key: string | null }) => void>();
  return {
    addEventListener: (_t: 'storage', fn: (e: { key: string | null }) => void) => void listeners.add(fn),
    removeEventListener: (_t: 'storage', fn: (e: { key: string | null }) => void) => void listeners.delete(fn),
    fire: (key: string) => listeners.forEach((fn) => fn({ key })),
  };
};
