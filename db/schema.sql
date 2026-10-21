-- Dust Bunny leaderboard schema (Neon Postgres).
-- api/leaderboard.ts runs the same statements lazily on first use, so applying this file
-- by hand is optional: psql "$DATABASE_URL" -f db/schema.sql

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
  -- SHA-256 of the client IP (salted with LEADERBOARD_IP_SALT); used only for rate limiting.
  ip_hash         text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS leaderboard_scores_score_idx ON leaderboard_scores (score DESC, id);
CREATE INDEX IF NOT EXISTS leaderboard_scores_character_idx ON leaderboard_scores (character, score DESC, id);
CREATE INDEX IF NOT EXISTS leaderboard_scores_ip_idx ON leaderboard_scores (ip_hash, created_at);
