/**
 * Account client: who is signed in, and social sign-in / sign-out against the Better Auth routes
 * under `/api/auth` (api/auth.ts). Plain fetch, so no auth library ships to the browser.
 *
 *   account.subscribe((s) => …);          // s.status: 'unknown' | 'unavailable' | 'signedOut' | 'signedIn'
 *   await account.refresh();              // on boot: providers + current session
 *   await account.signIn('discord');      // popup (redirect when popups are blocked)
 *   await account.signOut();
 *   await account.deleteAccount();         // 'deleted' | 'reauth' (sign in again first) | 'failed'
 *   account.onDeleted((userId) => …);      // forget what the device kept for that Account
 *
 * Sign-in opens the provider in a popup so the game keeps its state (for example an unsubmitted
 * score on the results screen); signIn() resolves once the popup is on its way and `pending` is
 * set. The popup lands on /auth-complete.html, which tells this window over a BroadcastChannel
 * (and postMessage) and closes itself; the session is then re-read. When the popup can't open,
 * the whole page goes to the provider and comes back to the current URL.
 */
import { DELETE_ACCOUNT_USER_HEADER, isSocialProvider, type AccountConfig, type SocialProvider } from '../shared/account';

export interface AccountUser {
  id: string;
  name: string;
  image: string | null;
}

export type AccountStatus = 'unknown' | 'unavailable' | 'signedOut' | 'signedIn';

export interface AccountState {
  status: AccountStatus;
  user: AccountUser | null;
  /** Providers configured on the server (empty when accounts are unavailable). */
  providers: SocialProvider[];
  /** A sign-in popup is open and hasn't reported back yet. */
  pending: boolean;
  /** Last sign-in problem to show the player, cleared on the next attempt. */
  error: string | null;
}

/** Message the sign-in popup sends back (see public/auth-complete.html). */
export const AUTH_CHANNEL = 'dust-bunny-auth';
export interface AuthCompleteMessage {
  type: 'dust-bunny:auth-complete';
  error: string | null;
}

export interface AccountClientOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
  /** Opens the sign-in popup; return null when blocked. Defaults to window.open. */
  openPopup?: () => Window | null;
  /** Full-page navigation (redirect fallback). Defaults to location.assign. */
  navigate?: (url: string) => void;
  /** Current page URL, used as the redirect fallback's return address. */
  currentUrl?: () => string;
  timeoutMs?: number;
}

const POPUP_FEATURES = 'popup,width=500,height=700';
/** How long `deleteAccount` waits for the server (other calls: `timeoutMs`, 6 s by default). */
const DELETE_TIMEOUT_MS = 20_000;
const COMPLETE_PATH = '/auth-complete.html';

class Unavailable extends Error {}

/** The server answered with an error (`code` is Better Auth's, e.g. `SESSION_EXPIRED`). */
class AccountRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    message: string,
  ) {
    super(message);
  }
}

/**
 * `deleteAccount()`: `reauth` when the server wants a recent sign-in first (the session is older
 * than Better Auth's `freshAge`, a day, or gone); signing in again and retrying then works.
 * `changed`: the session belongs to another Account than the one confirmed (another tab switched);
 * nothing was deleted and the state now shows who is signed in.
 */
export type DeleteAccountResult = 'deleted' | 'reauth' | 'changed' | 'failed';

function isAuthComplete(v: unknown): v is AuthCompleteMessage {
  return typeof v === 'object' && v !== null && (v as { type?: unknown }).type === 'dust-bunny:auth-complete';
}

function toUser(v: unknown): AccountUser | null {
  const u = (v as { user?: Record<string, unknown> } | null)?.user;
  if (!u || typeof u.id !== 'string') return null;
  return { id: u.id, name: typeof u.name === 'string' ? u.name : '', image: typeof u.image === 'string' ? u.image : null };
}

/** Readable text for the `?error=` codes Better Auth puts on the callback URL. */
export function signInErrorMessage(code: string): string {
  if (code === 'access_denied') return 'Sign-in was cancelled.';
  if (code === 'account_not_linked') return 'That email already belongs to an account that signed in another way. Use that provider instead.';
  return 'Sign-in failed. Please try again.';
}

export function createAccountClient(opts: AccountClientOptions = {}) {
  const baseUrl = opts.baseUrl ?? '/api/auth';
  const doFetch = opts.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const timeoutMs = opts.timeoutMs ?? 6000;
  const openPopup = opts.openPopup ?? (() => (typeof window === 'undefined' ? null : window.open('', 'dust-bunny-sign-in', POPUP_FEATURES)));
  const navigate = opts.navigate ?? ((url: string) => location.assign(url));
  const currentUrl = opts.currentUrl ?? (() => (typeof location === 'undefined' ? '/' : location.href));

  let state: AccountState = { status: 'unknown', user: null, providers: [], pending: false, error: null };
  const listeners = new Set<(s: AccountState) => void>();
  const deletedListeners = new Set<(userId: string) => void>();
  let refreshing: Promise<AccountState> | null = null;

  function set(patch: Partial<AccountState>): void {
    state = { ...state, ...patch };
    for (const l of listeners) l(state);
  }

  async function request(path: string, init?: RequestInit, timeout = timeoutMs): Promise<unknown> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    let res: Response;
    try {
      res = await doFetch(baseUrl + path, { credentials: 'same-origin', ...init, signal: ctrl.signal, headers: { Accept: 'application/json', ...init?.headers } });
    } catch {
      throw new Unavailable('network');
    } finally {
      clearTimeout(timer);
    }
    const isJson = (res.headers.get('content-type') ?? '').includes('application/json');
    if (!isJson || res.status === 404 || res.status >= 500) throw new Unavailable(String(res.status));
    const body: unknown = await res.json().catch(() => {
      throw new Unavailable('bad json');
    });
    if (!res.ok) {
      const err = body as { message?: unknown; code?: unknown } | null;
      throw new AccountRequestError(res.status, typeof err?.code === 'string' ? err.code : null, typeof err?.message === 'string' ? err.message : `Account error ${res.status}`);
    }
    return body;
  }

  async function loadSession(): Promise<void> {
    const user = toUser(await request('/get-session'));
    set({ status: user ? 'signedIn' : 'signedOut', user });
  }

  async function doRefresh(): Promise<AccountState> {
    try {
      if (state.status === 'unknown' || state.status === 'unavailable') {
        const config = (await request('/providers')) as AccountConfig;
        const providers = Array.isArray(config.providers) ? config.providers.filter(isSocialProvider) : [];
        if (!config.enabled) {
          set({ status: 'unavailable', user: null, providers: [] });
          return state;
        }
        set({ providers });
      }
      await loadSession();
    } catch (err) {
      // Static hosting / plain `pnpm dev` without a database: no accounts, play anonymously.
      if (err instanceof Unavailable && state.status === 'unknown') set({ status: 'unavailable', user: null, providers: [] });
    }
    return state;
  }

  /** The popup finished (from any tab of ours): re-read the session. */
  async function onAuthComplete(msg: AuthCompleteMessage): Promise<void> {
    await loadSession().catch(() => undefined);
    set({ pending: false, error: state.status !== 'signedIn' && msg.error ? signInErrorMessage(msg.error) : null });
  }

  let popup: Window | null = null;
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('message', (e) => {
      if (e.origin === location.origin && isAuthComplete(e.data)) void onAuthComplete(e.data);
    });
    if (typeof BroadcastChannel !== 'undefined') {
      new BroadcastChannel(AUTH_CHANNEL).onmessage = (e) => {
        if (isAuthComplete(e.data)) void onAuthComplete(e.data);
      };
    }
    // Provider pages can cut the link to the popup (COOP makes popup.closed read true while it is
    // still open), so "closed" is only trusted when the player comes back to the game.
    window.addEventListener('focus', () => {
      if (state.pending && (!popup || popup.closed)) {
        void loadSession()
          .catch(() => undefined)
          .then(() => set({ pending: false }));
      }
    });
  }

  return {
    get state(): AccountState {
      return state;
    },

    subscribe(fn: (s: AccountState) => void): () => void {
      listeners.add(fn);
      fn(state);
      return () => listeners.delete(fn);
    },

    /** Loads the provider list (once) and the current session. Concurrent calls share one request. */
    refresh(): Promise<AccountState> {
      refreshing ??= doRefresh().finally(() => {
        refreshing = null;
      });
      return refreshing;
    },

    async signIn(provider: SocialProvider): Promise<void> {
      set({ error: null });
      // Open the window synchronously, inside the click, so popup blockers allow it.
      popup = openPopup();
      const returnTo = currentUrl();
      try {
        const callbackURL = popup ? COMPLETE_PATH : returnTo;
        const body = (await request('/sign-in/social', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider, callbackURL, errorCallbackURL: callbackURL, disableRedirect: true }),
        })) as { url?: string };
        if (!body.url) throw new Error('No sign-in URL');
        if (!popup) {
          navigate(body.url);
          return;
        }
        popup.location.href = body.url;
        set({ pending: true });
      } catch {
        popup?.close();
        popup = null;
        set({ pending: false, error: signInErrorMessage('failed') });
      }
    },

    /** Signs out once the server confirms; on failure the player stays signed in, with `error` set, and this rejects. */
    async signOut(): Promise<void> {
      try {
        await request('/sign-out', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      } catch (err) {
        set({ error: 'Could not sign out. Check your connection and try again.' });
        throw err;
      }
      set({ status: 'signedOut', user: null, pending: false, error: null });
    },

    /**
     * Deletes the signed-in Account on the server (api/auth.ts → server/accountDeletion.ts), and only
     * that one: the request names it, and the server refuses if the session is someone else's. Once
     * it is gone the client is signed out and `onDeleted` listeners hear the Account's id; on failure
     * nothing changes here and `error` is set.
     */
    async deleteAccount(): Promise<DeleteAccountResult> {
      const user = state.user;
      if (state.status !== 'signedIn' || !user) return 'failed';
      set({ error: null });
      try {
        // A longer wait than other calls (a cold start, then one transaction with the cascades): an
        // answer lost after the server committed would leave this device holding the deleted Account.
        await request('/delete-user', { method: 'POST', headers: { 'Content-Type': 'application/json', [DELETE_ACCOUNT_USER_HEADER]: user.id }, body: '{}' }, DELETE_TIMEOUT_MS);
      } catch (err) {
        if (err instanceof AccountRequestError && err.code === 'ACCOUNT_CHANGED') {
          await loadSession().catch(() => undefined);
          return 'changed';
        }
        if (err instanceof AccountRequestError && (err.code === 'SESSION_EXPIRED' || err.status === 401)) return 'reauth';
        set({ error: 'Could not delete your account. Check your connection and try again.' });
        return 'failed';
      }
      set({ status: 'signedOut', user: null, pending: false, error: null });
      for (const fn of deletedListeners) fn(user.id);
      return 'deleted';
    },

    /** Called with the Account's id after `deleteAccount` deleted it. */
    onDeleted(fn: (userId: string) => void): () => void {
      deletedListeners.add(fn);
      return () => deletedListeners.delete(fn);
    },

    /** Reads `?error=` left by a redirect-fallback sign-in and strips it from the address bar. */
    consumeRedirectError(): void {
      if (typeof location === 'undefined') return;
      const url = new URL(location.href);
      const code = url.searchParams.get('error');
      if (!code) return;
      url.searchParams.delete('error');
      history.replaceState(history.state, '', url);
      set({ error: signInErrorMessage(code) });
    },
  };
}

export type AccountClient = ReturnType<typeof createAccountClient>;

/** Default client for the game. */
export const account = createAccountClient();
