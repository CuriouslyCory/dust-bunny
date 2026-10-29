/**
 * Accounts: self-hosted Better Auth on our Vercel functions, storing users and sessions in the
 * same Neon Postgres as the leaderboard (tables in ./schema.ts). Neon's managed Auth only offers
 * Google, GitHub and Vercel sign-in, and we need Discord, hence self-hosted.
 *
 * Env: BETTER_AUTH_SECRET (required), DATABASE_URL (required), BETTER_AUTH_URL (canonical
 * origin, used when the request host is not recognised), and per provider a client id + secret:
 * GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET, DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET. A provider
 * without both is simply not offered. See .env.example.
 */
import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { SOCIAL_PROVIDERS, type SocialProvider } from '../src/shared/account.js';
import { deleteAccount } from './accountDeletion.js';
import { ensureSchema, getPool, hasDatabase } from './db.js';

type Env = Record<string, string | undefined>;

const PROVIDER_ENV: Record<SocialProvider, { id: string; secret: string }> = {
  google: { id: 'GOOGLE_CLIENT_ID', secret: 'GOOGLE_CLIENT_SECRET' },
  discord: { id: 'DISCORD_CLIENT_ID', secret: 'DISCORD_CLIENT_SECRET' },
};

/** Providers with both a client id and a secret set. */
export function configuredProviders(env: Env = process.env): SocialProvider[] {
  return SOCIAL_PROVIDERS.filter((p) => env[PROVIDER_ENV[p].id] && env[PROVIDER_ENV[p].secret]);
}

/** Accounts work only with a database and a secret; otherwise everyone plays anonymously. */
export function authConfigured(env: Env = process.env): boolean {
  return hasDatabase() && Boolean(env.BETTER_AUTH_SECRET);
}

const hostOf = (url: string | undefined): string | null => {
  if (!url) return null;
  try {
    return new URL(url.includes('://') ? url : `https://${url}`).host;
  } catch {
    return null;
  }
};

/**
 * Hosts Better Auth may build callback URLs for: the canonical BETTER_AUTH_URL, this Vercel
 * deployment's own URLs (production, branch and per-deployment) and, outside production, local
 * dev. Each also becomes a trusted origin for redirects. OAuth itself only succeeds where the
 * provider has that host's redirect URI registered.
 */
export function allowedHosts(env: Env = process.env): string[] {
  const hosts = [env.BETTER_AUTH_URL, env.VERCEL_PROJECT_PRODUCTION_URL, env.VERCEL_BRANCH_URL, env.VERCEL_URL].map(hostOf).filter((h): h is string => Boolean(h));
  if (env.VERCEL_ENV !== 'production') hosts.push('localhost:*', '127.0.0.1:*');
  return [...new Set(hosts)];
}

export function authOptions(env: Env = process.env): BetterAuthOptions {
  const enabled = configuredProviders(env);
  const credentials = (p: SocialProvider) => ({ clientId: env[PROVIDER_ENV[p].id]!, clientSecret: env[PROVIDER_ENV[p].secret]! });
  const socialProviders: NonNullable<BetterAuthOptions['socialProviders']> = {
    // Google: always show the account chooser, so a shared device can switch accounts.
    ...(enabled.includes('google') ? { google: { ...credentials('google'), prompt: 'select_account' as const } } : {}),
    ...(enabled.includes('discord') ? { discord: credentials('discord') } : {}),
  };
  return {
    appName: 'Dust Bunny',
    secret: env.BETTER_AUTH_SECRET,
    basePath: '/api/auth',
    baseURL: {
      allowedHosts: allowedHosts(env),
      ...(env.BETTER_AUTH_URL ? { fallback: env.BETTER_AUTH_URL } : {}),
      // Vercel serves only HTTPS; never let a callback URL come out as http:// there.
      protocol: env.VERCEL ? 'https' : 'auto',
    },
    database: getPool(),
    socialProviders,
    session: {
      expiresIn: 60 * 60 * 24 * 60, // 60 days
      updateAge: 60 * 60 * 24, // refresh the expiry at most daily
    },
    // Signing in with a second provider that reports the same verified email links the accounts.
    account: { accountLinking: { enabled: true } },
    // Delete account (POST /api/auth/delete-user): needs a session signed in within the last day
    // (Better Auth's default `freshAge`), else 400 SESSION_EXPIRED and the game asks to sign in
    // again. beforeDelete removes the Account and everything it owns (./accountDeletion.ts).
    user: { deleteUser: { enabled: true, beforeDelete: (user) => deleteAccount(user.id) } },
    telemetry: { enabled: false },
  };
}

export type Auth = ReturnType<typeof betterAuth>;

let instance: Auth | null = null;
let testOverrides: Partial<BetterAuthOptions> = {};

/**
 * The Better Auth instance, built on first use. Better Auth checks the database schema when it
 * initialises (and remembers a failure), so the tables are created before it is constructed.
 */
export async function getAuth(): Promise<Auth> {
  await ensureSchema();
  instance ??= betterAuth({ ...authOptions(), ...testOverrides });
  return instance;
}

/** Tests only: the next getAuth() is rebuilt from the current env plus these overrides. */
export function resetAuthForTests(overrides: Partial<BetterAuthOptions> = {}): void {
  testOverrides = overrides;
  instance = null;
}

export interface SessionUser {
  id: string;
  name: string;
  image: string | null;
}

/** The signed-in user for a request, or null (no cookie, expired session, or accounts not configured). */
export async function sessionUser(request: Request): Promise<SessionUser | null> {
  if (!authConfigured()) return null;
  const session = await (await getAuth()).api.getSession({ headers: request.headers });
  if (!session) return null;
  return { id: session.user.id, name: session.user.name, image: session.user.image ?? null };
}
