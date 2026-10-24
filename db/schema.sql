-- Dust Bunny schema (Neon Postgres): accounts, leaderboard, cloud save.
-- The functions in api/ run the same statements lazily on first use (server/schema.ts), so
-- applying this file by hand is optional: psql "$DATABASE_URL" -f db/schema.sql

-- Better Auth core tables (users, sessions, linked provider accounts, OAuth state).
CREATE TABLE IF NOT EXISTS "user" (
  "id"            text        NOT NULL PRIMARY KEY,
  "name"          text        NOT NULL,
  "email"         text        NOT NULL UNIQUE,
  "emailVerified" boolean     NOT NULL,
  "image"         text,
  "createdAt"     timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt"     timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS "session" (
  "id"        text        NOT NULL PRIMARY KEY,
  "expiresAt" timestamptz NOT NULL,
  "token"     text        NOT NULL UNIQUE,
  "createdAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" timestamptz NOT NULL,
  "ipAddress" text,
  "userAgent" text,
  "userId"    text        NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "account" (
  "id"                    text        NOT NULL PRIMARY KEY,
  "accountId"             text        NOT NULL,
  "providerId"            text        NOT NULL,
  "userId"                text        NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  "accessToken"           text,
  "refreshToken"          text,
  "idToken"               text,
  "accessTokenExpiresAt"  timestamptz,
  "refreshTokenExpiresAt" timestamptz,
  "scope"                 text,
  "password"              text,
  "createdAt"             timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt"             timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS "verification" (
  "id"         text        NOT NULL PRIMARY KEY,
  "identifier" text        NOT NULL,
  "value"      text        NOT NULL,
  "expiresAt"  timestamptz NOT NULL,
  "createdAt"  timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt"  timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS "session_userId_idx" ON "session" ("userId");
CREATE INDEX IF NOT EXISTS "account_userId_idx" ON "account" ("userId");
CREATE INDEX IF NOT EXISTS "verification_identifier_idx" ON "verification" ("identifier");
-- One row per provider identity (Better Auth fails a lookup that matches two).
CREATE UNIQUE INDEX IF NOT EXISTS "account_provider_account_idx" ON "account" ("providerId", "accountId");

-- Leaderboard.
CREATE TABLE IF NOT EXISTS leaderboard_scores (
  id              bigserial PRIMARY KEY,
  name            text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 16),
  character       text        NOT NULL,
  score           integer     NOT NULL CHECK (score >= 0),
  max_radius      real        NOT NULL,
  debris_absorbed integer     NOT NULL,
  tier_reached    smallint    NOT NULL,
  duration_ms     integer     NOT NULL,
  victory         boolean     NOT NULL DEFAULT false,
  -- Difficulty id (casual | arcade | hardcore); the score already includes its multiplier.
  difficulty      text        NOT NULL DEFAULT 'casual',
  -- SHA-256 of the client IP (salted with LEADERBOARD_IP_SALT); used only for rate limiting.
  ip_hash         text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Tables created before Difficulty existed.
ALTER TABLE leaderboard_scores ADD COLUMN IF NOT EXISTS difficulty text NOT NULL DEFAULT 'casual';
-- Set when a signed-in player submitted the score (a verified entry); NULL means anonymous.
ALTER TABLE leaderboard_scores ADD COLUMN IF NOT EXISTS user_id text REFERENCES "user" ("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS leaderboard_scores_score_idx ON leaderboard_scores (score DESC, id);
CREATE INDEX IF NOT EXISTS leaderboard_scores_character_idx ON leaderboard_scores (character, score DESC, id);
CREATE INDEX IF NOT EXISTS leaderboard_scores_ip_idx ON leaderboard_scores (ip_hash, created_at);
-- Client-generated Run id: posting the same Run twice returns the first entry.
ALTER TABLE leaderboard_scores ADD COLUMN IF NOT EXISTS run_id text;
CREATE UNIQUE INDEX IF NOT EXISTS leaderboard_scores_run_idx ON leaderboard_scores (run_id) WHERE run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS leaderboard_scores_user_idx ON leaderboard_scores (user_id, score DESC) WHERE user_id IS NOT NULL;

-- Area boards: one row per Area (house | neighborhood | city | region | continent | globe | solar_system | galaxy | universe) a Run cleared. Radii are in the Area's unit (the Region's is 10 m, the Continent's 10 km, the Globe's 1,000 km, the Solar System's 0.01 AU, the Galaxy's 100 ly, the Universe's 10 Mly).
CREATE TABLE IF NOT EXISTS area_scores (
  id              bigserial PRIMARY KEY,
  area            text        NOT NULL,
  name            text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 16),
  character       text        NOT NULL,
  score           integer     NOT NULL CHECK (score >= 0),
  -- Radius on entering the Area, and the largest reached before leaving it.
  radius_in       real        NOT NULL,
  max_radius      real        NOT NULL,
  -- Debris absorbed and time spent in the Area.
  debris_absorbed integer     NOT NULL,
  duration_ms     integer     NOT NULL,
  difficulty      text        NOT NULL DEFAULT 'casual',
  run_id          text,
  ip_hash         text,
  user_id         text        REFERENCES "user" ("id") ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS area_scores_score_idx ON area_scores (area, score DESC, id);
CREATE INDEX IF NOT EXISTS area_scores_character_idx ON area_scores (area, character, score DESC, id);
CREATE INDEX IF NOT EXISTS area_scores_ip_idx ON area_scores (ip_hash, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS area_scores_run_idx ON area_scores (run_id, area) WHERE run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS area_scores_user_idx ON area_scores (user_id, area, score DESC) WHERE user_id IS NOT NULL;

-- The Run's Loadout: [{ "type": "thick_clog", "rarity": 3 }, …] (0–2 Keepsakes, rarity 1–5); rows from
-- before rarities hold { "type", "grade": 1–10 }, read as rarities by the API. NULL for entries
-- from clients before Keepsakes.
ALTER TABLE leaderboard_scores ADD COLUMN IF NOT EXISTS loadout jsonb;
ALTER TABLE area_scores ADD COLUMN IF NOT EXISTS loadout jsonb;

-- Universes the player had ended when the Run was posted (a Universe victory counts itself);
-- NULL for entries from clients before Act 9.
ALTER TABLE leaderboard_scores ADD COLUMN IF NOT EXISTS universes integer;

-- Cloud save for signed-in players: Fluff wallet, Upgrade levels (id → level), lifetime stats,
-- and per Character its Keepsake Hoard ("type:rarityId" → count, e.g. "thick_clog:epic"; rows from
-- before rarities use "type:1"…"type:10", converted on read) bosses beaten, and Universe
-- victories (only ever goes up).
CREATE TABLE IF NOT EXISTS player_progress (
  user_id    text        PRIMARY KEY REFERENCES "user" ("id") ON DELETE CASCADE,
  fluff      integer     NOT NULL CHECK (fluff >= 0),
  upgrades   jsonb       NOT NULL,
  stats      jsonb       NOT NULL,
  characters jsonb       NOT NULL DEFAULT '{}',
  universes  integer     NOT NULL DEFAULT 0 CHECK (universes >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Tables created before Keepsakes.
ALTER TABLE player_progress ADD COLUMN IF NOT EXISTS characters jsonb NOT NULL DEFAULT '{}';
-- Tables created before Act 9.
ALTER TABLE player_progress ADD COLUMN IF NOT EXISTS universes integer NOT NULL DEFAULT 0 CHECK (universes >= 0);

-- The Account's saved Run (api/saved-run.ts): one per player, held by one device at a time.
-- run_key names the Run (RunSnapshot.runKey); lease is whoever holds it now (the device that last
-- stored or took it); snapshot (a RunSnapshot, with its version) is NULL while a device is playing
-- it. Taking it moves the lease; ending the Run sets ended_at, and the row stays (no snapshot) until
-- another Run is stored, so a late upload of the ended Run from a device that fell behind is refused.
CREATE TABLE IF NOT EXISTS saved_runs (
  user_id    text        PRIMARY KEY REFERENCES "user" ("id") ON DELETE CASCADE,
  run_key    text        NOT NULL,
  lease      text        NOT NULL,
  snapshot   jsonb,
  version    integer,
  ended_at   timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Tables created before ended Runs kept their row.
ALTER TABLE saved_runs ADD COLUMN IF NOT EXISTS ended_at timestamptz;

-- The Run credit ledger (api/run-credit.ts, docs/adr/0003): one row per Run a signed-in player is
-- credited for (Fluff and lifetime stats), written when the device holding the Run claims its
-- ending, or when the server replaces or abandons a stored copy. The only record that a Run is
-- credited: a late upload of a Run in the ledger is refused, and a claim for one already here
-- returns the existing row. `stats` is the bounded subset crediting reads (CreditStats,
-- src/shared/runCredit.ts); `lease` is the lease it ended under.
CREATE TABLE IF NOT EXISTS run_credits (
  id          bigserial   PRIMARY KEY,
  user_id     text        NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  run_key     text        NOT NULL,
  lease       text,
  reason      text        NOT NULL CHECK (reason IN ('died', 'victory', 'quit')),
  stats       jsonb       NOT NULL,
  credited_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, run_key)
);
CREATE INDEX IF NOT EXISTS run_credits_user_idx ON run_credits (user_id, id DESC);

-- The newest Run keys whose credit the stored progress copy holds (Progress.creditedRuns); it
-- travels with the Fluff. Kept as it is when an upload from before the ledger omits it.
ALTER TABLE player_progress ADD COLUMN IF NOT EXISTS credited_runs jsonb;
