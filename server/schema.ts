/**
 * Database DDL, applied lazily and idempotently on first use by every function (see `ensureSchema`
 * in ./db.ts). Keep db/schema.sql in sync. Order matters: later tables reference "user".
 *
 * The four auth tables are Better Auth's core schema (user, session, account, verification) as
 * `better-auth/db/migration` generates it for Postgres; server/api.test.ts checks that Better Auth
 * finds nothing to migrate after these statements ran.
 */

/**
 * True when the newest objects in SCHEMA already exist, so the DDL can be skipped. Update it to
 * check whatever a schema change adds.
 */
export const SCHEMA_PROBE = `SELECT to_regclass('public.player_progress') IS NOT NULL
  AND to_regclass('public.account_provider_account_idx') IS NOT NULL
  AND to_regclass('public.leaderboard_scores_run_idx') IS NOT NULL
  AND to_regclass('public.area_scores_user_idx') IS NOT NULL AS ready`;

export const SCHEMA: readonly string[] = [
  // --- Better Auth (accounts and sessions) ---
  `CREATE TABLE IF NOT EXISTS "user" (
    "id" text NOT NULL PRIMARY KEY,
    "name" text NOT NULL,
    "email" text NOT NULL UNIQUE,
    "emailVerified" boolean NOT NULL,
    "image" text,
    "createdAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "session" (
    "id" text NOT NULL PRIMARY KEY,
    "expiresAt" timestamptz NOT NULL,
    "token" text NOT NULL UNIQUE,
    "createdAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamptz NOT NULL,
    "ipAddress" text,
    "userAgent" text,
    "userId" text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "account" (
    "id" text NOT NULL PRIMARY KEY,
    "accountId" text NOT NULL,
    "providerId" text NOT NULL,
    "userId" text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
    "accessToken" text,
    "refreshToken" text,
    "idToken" text,
    "accessTokenExpiresAt" timestamptz,
    "refreshTokenExpiresAt" timestamptz,
    "scope" text,
    "password" text,
    "createdAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamptz NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "verification" (
    "id" text NOT NULL PRIMARY KEY,
    "identifier" text NOT NULL,
    "value" text NOT NULL,
    "expiresAt" timestamptz NOT NULL,
    "createdAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS "session_userId_idx" ON "session" ("userId")`,
  `CREATE INDEX IF NOT EXISTS "account_userId_idx" ON "account" ("userId")`,
  `CREATE INDEX IF NOT EXISTS "verification_identifier_idx" ON "verification" ("identifier")`,
  // One row per provider identity. Better Auth looks accounts up by this pair and fails if two
  // rows match, which concurrent OAuth callbacks could otherwise create.
  `CREATE UNIQUE INDEX IF NOT EXISTS "account_provider_account_idx" ON "account" ("providerId", "accountId")`,

  // --- Leaderboard ---
  `CREATE TABLE IF NOT EXISTS leaderboard_scores (
    id bigserial PRIMARY KEY,
    name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 16),
    character text NOT NULL,
    score integer NOT NULL CHECK (score >= 0),
    max_radius real NOT NULL,
    debris_absorbed integer NOT NULL,
    tier_reached smallint NOT NULL,
    duration_ms integer NOT NULL,
    victory boolean NOT NULL DEFAULT false,
    difficulty text NOT NULL DEFAULT 'casual',
    ip_hash text,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  // Tables created before Difficulty existed.
  `ALTER TABLE leaderboard_scores ADD COLUMN IF NOT EXISTS difficulty text NOT NULL DEFAULT 'casual'`,
  // Set when a signed-in player submitted the score (a verified entry); NULL means anonymous.
  `ALTER TABLE leaderboard_scores ADD COLUMN IF NOT EXISTS user_id text REFERENCES "user" ("id") ON DELETE SET NULL`,
  `CREATE INDEX IF NOT EXISTS leaderboard_scores_score_idx ON leaderboard_scores (score DESC, id)`,
  `CREATE INDEX IF NOT EXISTS leaderboard_scores_character_idx ON leaderboard_scores (character, score DESC, id)`,
  `CREATE INDEX IF NOT EXISTS leaderboard_scores_ip_idx ON leaderboard_scores (ip_hash, created_at)`,
  // Client-generated Run id: posting the same Run twice (a retry, auto-post plus manual) returns the first entry.
  `ALTER TABLE leaderboard_scores ADD COLUMN IF NOT EXISTS run_id text`,
  `CREATE UNIQUE INDEX IF NOT EXISTS leaderboard_scores_run_idx ON leaderboard_scores (run_id) WHERE run_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS leaderboard_scores_user_idx ON leaderboard_scores (user_id, score DESC) WHERE user_id IS NOT NULL`,

  // --- Area boards: one row per Area a Run cleared ---
  `CREATE TABLE IF NOT EXISTS area_scores (
    id bigserial PRIMARY KEY,
    area text NOT NULL,
    name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 16),
    character text NOT NULL,
    score integer NOT NULL CHECK (score >= 0),
    radius_in real NOT NULL,
    max_radius real NOT NULL,
    debris_absorbed integer NOT NULL,
    duration_ms integer NOT NULL,
    difficulty text NOT NULL DEFAULT 'casual',
    run_id text,
    ip_hash text,
    user_id text REFERENCES "user" ("id") ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS area_scores_score_idx ON area_scores (area, score DESC, id)`,
  `CREATE INDEX IF NOT EXISTS area_scores_character_idx ON area_scores (area, character, score DESC, id)`,
  `CREATE INDEX IF NOT EXISTS area_scores_ip_idx ON area_scores (ip_hash, created_at)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS area_scores_run_idx ON area_scores (run_id, area) WHERE run_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS area_scores_user_idx ON area_scores (user_id, area, score DESC) WHERE user_id IS NOT NULL`,

  // --- Cloud save (Fluff, Upgrades, stats) for signed-in players ---
  `CREATE TABLE IF NOT EXISTS player_progress (
    user_id text PRIMARY KEY REFERENCES "user" ("id") ON DELETE CASCADE,
    fluff integer NOT NULL CHECK (fluff >= 0),
    upgrades jsonb NOT NULL,
    stats jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
];
