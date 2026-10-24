/**
 * The one HTTP caller behind the Account's saved Run (src/meta/savedRuns.ts, api/saved-run.ts)
 * and the Run credit ledger (src/meta/runCredits.ts, api/run-credit.ts): same-origin JSON, a
 * timeout that counts as offline, and the two errors every caller tells apart.
 */

/** The request didn't get a definite answer (offline, timeout, 5xx, 429): try again later. */
export class SavedRunNetError extends Error {}
/** The session is gone (401): stop until the Account says otherwise. */
export class SavedRunAuthError extends Error {}

export interface JsonCallerOptions {
  fetch?: typeof fetch;
  /** A request without an answer by then counts as offline (ms). */
  timeoutMs?: number;
}

export interface JsonAnswer {
  status: number;
  body: Record<string, unknown>;
}

export type JsonCaller = (method: string, url: string, body?: unknown, keepalive?: boolean) => Promise<JsonAnswer>;

/** A `keepalive` request (pagehide) is never aborted: the page is going away and nobody waits for it. */
export function createJsonCaller(opts: JsonCallerOptions = {}): JsonCaller {
  const doFetch = opts.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const timeoutMs = opts.timeoutMs ?? 8000;
  return async (method, url, body, keepalive = false) => {
    let res: Response;
    const ctrl = typeof AbortController === 'function' && !keepalive ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
    try {
      res = await doFetch(url, {
        method,
        credentials: 'same-origin',
        keepalive,
        signal: ctrl?.signal,
        headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      throw new SavedRunNetError(String(err));
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (res.status === 401) throw new SavedRunAuthError('unauthorized');
    if (res.status >= 500 || res.status === 429) throw new SavedRunNetError(`${url} ${res.status}`);
    let parsed: Record<string, unknown> = {};
    try {
      parsed = ((await res.json()) as Record<string, unknown>) ?? {};
    } catch {
      if (res.ok) throw new SavedRunNetError('bad response');
    }
    return { status: res.status, body: parsed };
  };
}
