/**
 * Account contract shared by the client (`src/net/account.ts`) and the auth function
 * (`api/auth.ts`, `server/auth.ts`). Pure and dependency-free (see the note in `./score.ts`).
 */

/** Social sign-in providers the game supports (each needs its client id + secret on the server). */
export const SOCIAL_PROVIDERS = ['google', 'discord'] as const;
export type SocialProvider = (typeof SOCIAL_PROVIDERS)[number];

export const PROVIDER_LABELS: Record<SocialProvider, string> = { google: 'Google', discord: 'Discord' };

export function isSocialProvider(v: unknown): v is SocialProvider {
  return typeof v === 'string' && (SOCIAL_PROVIDERS as readonly string[]).includes(v);
}

/**
 * Header naming the Account a Delete account confirmation was shown for. The server deletes only
 * when it matches the session's user (another tab may have switched Accounts since), else 409
 * `ACCOUNT_CHANGED` and nothing is deleted.
 */
export const DELETE_ACCOUNT_USER_HEADER = 'x-delete-account-user';

/** `GET /api/auth/providers`: whether accounts work on this deployment, and with which providers. */
export interface AccountConfig {
  enabled: boolean;
  providers: SocialProvider[];
}
