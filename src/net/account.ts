/**
 * Account client: who is signed in, and social sign-in / sign-out against the Better Auth routes
 * under `/api/auth` (api/auth.ts). Plain fetch, so no auth library ships to the browser.
 *
 *   account.subscribe((s) => …);          // s.status: 'unknown' | 'unavailable' | 'signedOut' | 'signedIn'
 *   await account.refresh();              // on boot: providers + current session
 *   await account.signIn('discord');      // popup (redirect when popups are blocked)
 *   await account.signOut();
 *
 * Sign-in opens the provider in a popup so the game keeps its state (for example an unsubmitted
 * score on the results screen); signIn() resolves once the popup is on its way and `pending` is
 * set. The popup lands on /auth-complete.html, which tells this window over a BroadcastChannel
 * (and postMessage) and closes itself; the session is then re-read. When the popup can't open,
 * the whole page goes to the provider and comes back to the current URL.
 */
import { isSocialProvider, type AccountConfig, type SocialProvider } from '../shared/account';

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
const COMPLETE_PATH = '/auth-complete.html';

class Unavailable extends Error {}

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
  let refreshing: Promise<AccountState> | null = null;

  function set(patch: Partial<AccountState>): void {
    state = { ...state, ...patch };
    for (const l of listeners) l(state);
  }

  async function request(path: string, init?: RequestInit): Promise<unknown> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
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
    if (!res.ok) throw new Error((body as { message?: string } | null)?.message ?? `Account error ${res.status}`);
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

    async signOut(): Promise<void> {
      try {
        await request('/sign-out', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      } finally {
        set({ status: state.providers.length ? 'signedOut' : state.status, user: null, pending: false, error: null });
      }
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
