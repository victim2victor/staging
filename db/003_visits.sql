-- Victim2Victor — anonymous page-visit tracking
--
-- Written only by the `track-visit` edge function (service role). Both tables
-- are RLS-on with NO policies, so the publishable key can neither read nor
-- write them — analytics are private; the owner reads them in the dashboard.
--
-- The raw IP is never stored: the function uses it transiently to geolocate the
-- session and as a rate-limit key, and persists only a salted SHA-256 hash.
--
--   sessions    — one row per browser, keyed by its localStorage token
--                 (the same `v2v_session` used to soft-link contact submissions).
--                 Geolocated once, on first sight; best-effort, all nullable.
--   page_views  — one row per page load, referencing a session.

CREATE TABLE IF NOT EXISTS sessions (
  session_token  UUID         PRIMARY KEY,
  environment    TEXT         NOT NULL CHECK (environment IN ('staging', 'production')),
  ip_hash        TEXT         NOT NULL,
  country        CHAR(2),               -- ISO 3166-1 alpha-2; NULL if unknown
  continent      CHAR(2),
  city           TEXT,
  latitude       DOUBLE PRECISION,      -- city-level
  longitude      DOUBLE PRECISION,      -- city-level
  timezone       TEXT,                  -- IANA
  asorg          TEXT,                  -- ISP / network (bot-filtering signal)
  user_agent     TEXT,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  last_seen      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sessions_created_at_idx ON sessions (created_at);
CREATE INDEX IF NOT EXISTS sessions_env_idx        ON sessions (environment);

CREATE TABLE IF NOT EXISTS page_views (
  id             BIGSERIAL    PRIMARY KEY,
  session_token  UUID         NOT NULL REFERENCES sessions(session_token) ON DELETE CASCADE,
  page           TEXT         NOT NULL DEFAULT '/',
  referrer       TEXT,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS page_views_session_idx    ON page_views (session_token);
CREATE INDEX IF NOT EXISTS page_views_created_at_idx ON page_views (created_at);
CREATE INDEX IF NOT EXISTS page_views_page_idx       ON page_views (page);

-- Deny all direct access; the edge function connects as service role.
ALTER TABLE sessions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE page_views ENABLE ROW LEVEL SECURITY;
