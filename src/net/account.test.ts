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
