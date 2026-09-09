-- Victim2Victor — sessions + anonymous page-visit tracking
--
-- Written only by the edge functions (service role). Every table is RLS-on with
-- NO policies, so the publishable key can neither read nor write them — the
-- data is private; the owner reads it in the Supabase dashboard.
--
-- The raw IP is never stored: the functions use it transiently to geolocate the
-- session and as a rate-limit key, and persist only a salted SHA-256 hash.
--
--   sessions    — one row per browser. `id` (surrogate BIGSERIAL) is the key
--                 every other table references as `session_id`; `token` is the
--                 browser's random localStorage identifier, used to recognise a
--                 returning browser and to resolve its `id` for interaction
--                 inserts. Geolocated once, on first sight; best-effort, all
--                 nullable. `first_seen`/`last_seen` bracket the
--                 browser's activity: both default to NOW() on insert, but only
--                 `last_seen` is bumped on return visits, so `first_seen` stays
--                 pinned to the first sight (there is no row-audit `created_at`).
--   page_views  — one row per page load, referencing a session.
--
-- Conventions (see supabase/README.md and the unframe skill):
--   env         — SMALLINT, 0 = staging, 1 = production. Both sites share one
--                 project; every interaction table carries `env` so its rows are
--                 self-describing without a join. Set by the edge function.
--   session_id  — every interaction row references sessions(id) (hard FK).

CREATE TABLE IF NOT EXISTS sessions (
  id             BIGSERIAL    PRIMARY KEY,
  token          UUID         NOT NULL UNIQUE,       -- browser's localStorage identifier
  env            SMALLINT     NOT NULL CHECK (env IN (0, 1)),
  ip_hash        TEXT         NOT NULL,
  country        CHAR(2),               -- ISO 3166-1 alpha-2; NULL if unknown
  continent      CHAR(2),
  city           TEXT,
  latitude       DOUBLE PRECISION,      -- city-level
  longitude      DOUBLE PRECISION,      -- city-level
  timezone       TEXT,                  -- IANA
  asorg          TEXT,                  -- ISP / network (bot-filtering signal)
  user_agent     TEXT,
  first_seen     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),  -- first sight; set once, never bumped
  last_seen      TIMESTAMPTZ  NOT NULL DEFAULT NOW()    -- bumped on every return visit
);

CREATE INDEX IF NOT EXISTS sessions_first_seen_idx ON sessions (first_seen);
CREATE INDEX IF NOT EXISTS sessions_env_idx        ON sessions (env);
-- `token` already has a unique index from its constraint (used to look up a
-- returning browser and to resolve session_id for interaction inserts).

CREATE TABLE IF NOT EXISTS page_views (
  id             BIGSERIAL    PRIMARY KEY,
  env            SMALLINT     NOT NULL CHECK (env IN (0, 1)),
  session_id     BIGINT       NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  page           TEXT         NOT NULL DEFAULT '/',
  referrer       TEXT,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS page_views_session_idx    ON page_views (session_id);
CREATE INDEX IF NOT EXISTS page_views_created_at_idx ON page_views (created_at);
CREATE INDEX IF NOT EXISTS page_views_page_idx       ON page_views (page);

-- Deny all direct access; the edge functions connect as service role.
ALTER TABLE sessions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE page_views ENABLE ROW LEVEL SECURITY;
