import { describe, expect, it, vi } from 'vitest';
import { createAccountClient, signInErrorMessage } from './account';

const jsonResponse = (body: unknown, status = 200) => Response.json(body, { status });

/** Routes fake fetches by path under /api/auth. */
function fakeFetch(routes: Record<string, (init?: RequestInit) => Response>) {
  const calls: Array<{ path: string; init?: RequestInit }> = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url).replace('/api/auth', '');
    calls.push({ path, init });
    const route = routes[path];
    return route ? route(init) : new Response('not found', { status: 404 });
  });
  return { calls, fetch: fn as unknown as typeof fetch };
}

const USER = { user: { id: 'u1', name: 'Dusty', image: 'https://cdn.example/a.png', email: 'secret@example.com' }, session: { id: 's' } };

describe('account client', () => {
  it('is unavailable when the API is missing (static hosting / plain dev)', async () => {
    const { fetch } = fakeFetch({});
    const a = createAccountClient({ fetch });
    expect((await a.refresh()).status).toBe('unavailable');
  });

  it('is unavailable when the server has accounts turned off', async () => {
    const { fetch } = fakeFetch({ '/providers': () => jsonResponse({ enabled: false, providers: [] }) });
    expect((await createAccountClient({ fetch }).refresh()).status).toBe('unavailable');
  });

  it('loads providers and the session', async () => {
    let session: unknown = null;
    const { fetch } = fakeFetch({
      '/providers': () => jsonResponse({ enabled: true, providers: ['discord', 'myspace'] }),
      '/get-session': () => jsonResponse(session),
    });
    const a = createAccountClient({ fetch });
    expect(await a.refresh()).toMatchObject({ status: 'signedOut', providers: ['discord'] });
    session = USER;
    expect(await a.refresh()).toMatchObject({ status: 'signedIn', user: { id: 'u1', name: 'Dusty', image: 'https://cdn.example/a.png' } });
    expect(a.state.user).not.toHaveProperty('email');
  });

  it('opens the provider in a popup that lands on /auth-complete.html', async () => {
    const { fetch, calls } = fakeFetch({ '/sign-in/social': () => jsonResponse({ url: 'https://discord.com/oauth2/authorize?x=1', redirect: false }) });
    const popup = { location: { href: '' }, close: vi.fn(), closed: false } as unknown as Window;
    const navigate = vi.fn();
    const a = createAccountClient({ fetch, openPopup: () => popup, navigate, currentUrl: () => 'http://localhost/?seed=1' });
    await a.signIn('discord');
    expect(popup.location.href).toBe('https://discord.com/oauth2/authorize?x=1');
    expect(navigate).not.toHaveBeenCalled();
    expect(a.state.pending).toBe(true);
    expect(JSON.parse(String(calls[0]!.init!.body))).toEqual({ provider: 'discord', callbackURL: '/auth-complete.html', errorCallbackURL: '/auth-complete.html', disableRedirect: true });
  });

  it('falls back to a full-page redirect back to the current page when popups are blocked', async () => {
    const { fetch, calls } = fakeFetch({ '/sign-in/social': () => jsonResponse({ url: 'https://accounts.google.com/o/oauth2/auth?x=1' }) });
    const navigate = vi.fn();
    const a = createAccountClient({ fetch, openPopup: () => null, navigate, currentUrl: () => 'http://localhost/?seed=1' });
    await a.signIn('google');
    expect(navigate).toHaveBeenCalledWith('https://accounts.google.com/o/oauth2/auth?x=1');
    expect(JSON.parse(String(calls[0]!.init!.body)).callbackURL).toBe('http://localhost/?seed=1');
  });

  it('reports a failed sign-in start and closes the popup', async () => {
    const { fetch } = fakeFetch({ '/sign-in/social': () => jsonResponse({ message: 'Provider not found' }, 404) });
    const popup = { location: { href: '' }, close: vi.fn(), closed: false } as unknown as Window;
    const a = createAccountClient({ fetch, openPopup: () => popup });
    await a.signIn('google');
    expect(popup.close).toHaveBeenCalled();
    expect(a.state).toMatchObject({ pending: false, error: signInErrorMessage('failed') });
  });

  it('signs out', async () => {
    const { fetch, calls } = fakeFetch({
      '/providers': () => jsonResponse({ enabled: true, providers: ['google'] }),
      '/get-session': () => jsonResponse(USER),
      '/sign-out': () => jsonResponse({ success: true }),
    });
    const a = createAccountClient({ fetch });
    await a.refresh();
    const seen: string[] = [];
    a.subscribe((s) => seen.push(s.status));
    await a.signOut();
    expect(a.state).toMatchObject({ status: 'signedOut', user: null });
    expect(calls.at(-1)).toMatchObject({ path: '/sign-out', init: { method: 'POST' } });
    expect(seen).toEqual(['signedIn', 'signedOut']);
  });

  it('stays signed in when sign-out fails', async () => {
    const { fetch } = fakeFetch({
      '/providers': () => jsonResponse({ enabled: true, providers: ['google'] }),
      '/get-session': () => jsonResponse(USER),
      '/sign-out': () => jsonResponse({ message: 'down' }, 503),
    });
    const a = createAccountClient({ fetch });
    await a.refresh();
    await expect(a.signOut()).rejects.toThrow();
    expect(a.state).toMatchObject({ status: 'signedIn', user: { id: 'u1' } });
    expect(a.state.error).toMatch(/Could not sign out/);
  });

  describe('deleteAccount', () => {
    const client = (deleteUser: () => Response) => {
      const f = fakeFetch({
        '/providers': () => jsonResponse({ enabled: true, providers: ['google'] }),
        '/get-session': () => jsonResponse(USER),
        '/delete-user': deleteUser,
      });
      return { ...f, a: createAccountClient({ fetch: f.fetch }) };
    };

    it('signs out once the server deleted the Account, then tells onDeleted listeners', async () => {
      const { a, calls } = client(() => jsonResponse({ success: true, message: 'User deleted' }));
      await a.refresh();
      const heard: Array<[string, string]> = [];
      a.onDeleted((id) => heard.push([id, a.state.status]));
      expect(await a.deleteAccount()).toBe('deleted');
      expect(calls.at(-1)).toMatchObject({ path: '/delete-user', init: { method: 'POST' } });
      expect(a.state).toMatchObject({ status: 'signedOut', user: null, error: null });
      expect(heard).toEqual([['u1', 'signedOut']]);
    });

    it.each([
      ['a session older than freshAge', () => jsonResponse({ code: 'SESSION_EXPIRED', message: 'Session expired.' }, 400)],
      ['a session that is gone', () => jsonResponse({ code: 'UNAUTHORIZED', message: 'Unauthorized' }, 401)],
    ])('asks to sign in again for %s, and changes nothing', async (_, answer) => {
      const { a } = client(answer);
      await a.refresh();
      const heard: string[] = [];
      a.onDeleted((id) => heard.push(id));
      expect(await a.deleteAccount()).toBe('reauth');
      expect(a.state).toMatchObject({ status: 'signedIn', user: { id: 'u1' }, error: null });
      expect(heard).toEqual([]);
    });

    it('names the confirmed Account; when the session is someone else’s now (another tab switched), deletes nothing and shows who is signed in', async () => {
      let session: unknown = USER;
      const { fetch, calls } = fakeFetch({
        '/providers': () => jsonResponse({ enabled: true, providers: ['google'] }),
        '/get-session': () => jsonResponse(session),
        '/delete-user': () => jsonResponse({ code: 'ACCOUNT_CHANGED', message: 'x' }, 409),
      });
      const a = createAccountClient({ fetch });
      await a.refresh();
      const heard: string[] = [];
      a.onDeleted((id) => heard.push(id));
      session = { user: { id: 'u2', name: 'Other', image: null }, session: {} }; // another tab signed in as u2
      expect(await a.deleteAccount()).toBe('changed');
      const sent = calls.find((c) => c.path === '/delete-user')!;
      expect(new Headers(sent.init?.headers).get('x-delete-account-user')).toBe('u1');
      expect(a.state).toMatchObject({ status: 'signedIn', user: { id: 'u2' } });
      expect(heard).toEqual([]);
    });

    it('tells the game’s other tabs: one signed in as the deleted Account signs out, and each forgets it', async () => {
      // A shared channel: each tab hears the others' messages, not its own (as a BroadcastChannel).
      const tabs: Array<(d: unknown) => void> = [];
      const channel = () => {
        let me: ((d: unknown) => void) | null = null;
        return { post: (m: unknown) => tabs.filter((t) => t !== me).forEach((t) => t(m)), listen: (fn: (d: unknown) => void) => void tabs.push((me = fn)) };
      };
      const tab = (user: unknown) =>
        createAccountClient({
          channel: channel(),
          fetch: fakeFetch({
            '/providers': () => jsonResponse({ enabled: true, providers: ['google'] }),
            '/get-session': () => jsonResponse(user),
            '/delete-user': () => jsonResponse({ success: true, message: 'User deleted' }),
          }).fetch,
        });
      const a = tab(USER);
      const b = tab(USER);
      const other = tab({ user: { id: 'u2', name: 'Other', image: null }, session: {} });
      await Promise.all([a.refresh(), b.refresh(), other.refresh()]);
      const heard: string[] = [];
      for (const [name, t] of [['a', a], ['b', b], ['other', other]] as const) t.onDeleted((id) => heard.push(`${name}:${id}`));

      expect(await a.deleteAccount()).toBe('deleted');
      expect(heard.sort()).toEqual(['a:u1', 'b:u1', 'other:u1']);
      expect(b.state).toMatchObject({ status: 'signedOut', user: null });
      expect(other.state).toMatchObject({ status: 'signedIn', user: { id: 'u2' } });
    });

    it('drops a session read that started before the deletion (it would name the deleted Account)', async () => {
      let release!: () => void;
      let slow = false;
      const { fetch } = fakeFetch({
        '/providers': () => jsonResponse({ enabled: true, providers: ['google'] }),
        '/get-session': () => jsonResponse(USER),
        '/delete-user': () => jsonResponse({ success: true, message: 'User deleted' }),
      });
      const gated = (async (url: string | URL | Request, init?: RequestInit) => {
        const res = await fetch(url, init);
        if (slow && String(url).endsWith('/get-session')) await new Promise<void>((r) => (release = r));
        return res;
      }) as typeof globalThis.fetch;
      const a = createAccountClient({ fetch: gated });
      await a.refresh();
      slow = true;
      const stale = a.refresh(); // read the old session; its answer comes after the deletion
      await new Promise((r) => setTimeout(r, 0));
      slow = false;
      expect(await a.deleteAccount()).toBe('deleted');
      release();
      await stale;
      expect(a.state).toMatchObject({ status: 'signedOut', user: null });
    });

    it('waits longer than other calls for the server to answer', async () => {
      const { fetch } = fakeFetch({
        '/providers': () => jsonResponse({ enabled: true, providers: ['google'] }),
        '/get-session': () => jsonResponse(USER),
      });
      const slow = (async (url: string | URL | Request, init?: RequestInit) => {
        if (!String(url).endsWith('/delete-user')) return fetch(url, init);
        await new Promise((r) => setTimeout(r, 60));
        if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError');
        return jsonResponse({ success: true, message: 'User deleted' });
      }) as typeof globalThis.fetch;
      const a = createAccountClient({ fetch: slow, timeoutMs: 20 });
      await a.refresh();
      expect(await a.deleteAccount()).toBe('deleted');
    });

    it('stays signed in, with an error, when the server can’t be reached', async () => {
      const { a } = client(() => jsonResponse({ message: 'down' }, 503));
      await a.refresh();
      expect(await a.deleteAccount()).toBe('failed');
      expect(a.state).toMatchObject({ status: 'signedIn', user: { id: 'u1' } });
      expect(a.state.error).toMatch(/Could not delete your account/);
    });

    it('does nothing when signed out', async () => {
      const { a, calls } = client(() => jsonResponse({ success: true }));
      expect(await a.deleteAccount()).toBe('failed');
      expect(calls.some((c) => c.path === '/delete-user')).toBe(false);
    });
  });
});
