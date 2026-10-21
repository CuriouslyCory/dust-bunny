/**
 * Accounts (Vercel Node function). vercel.json rewrites every `/api/auth/*` path here; Better Auth
 * routes by the original pathname (`/api/auth/sign-in/social`, `/api/auth/callback/google`,
 * `/api/auth/get-session`, `/api/auth/sign-out`, …). Configuration lives in server/auth.ts.
 *
 *   GET /api/auth/providers  -> 200 AccountConfig { enabled, providers } (never fails)
 *
 * Without DATABASE_URL or BETTER_AUTH_SECRET, `providers` reports `enabled: false` and every other
 * route answers 503 `unavailable`; the game then hides sign-in and everyone plays anonymously.
 */
import type { AccountConfig } from '../src/shared/account.js';
import { authConfigured, configuredProviders, getAuth } from '../server/auth.js';
import { errorResponse, HttpError, json } from '../server/http.js';

export default {
  async fetch(request: Request): Promise<Response> {
    try {
      const { pathname } = new URL(request.url);
      if (pathname.replace(/\/$/, '') === '/api/auth/providers') {
        const enabled = authConfigured();
        const body: AccountConfig = { enabled, providers: enabled ? configuredProviders() : [] };
        return json(200, body);
      }
      if (!authConfigured()) throw new HttpError(503, 'unavailable', 'Accounts are not configured on this server.');
      return await (await getAuth()).handler(request);
    } catch (err) {
      return errorResponse(err, 'auth');
    }
  },
};
