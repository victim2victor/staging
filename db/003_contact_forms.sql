-- Victim2Victor — contact form submissions
--
-- Written only by the `submit-form` edge function (service role). RLS is
-- enabled with NO policies, so the publishable key cannot read or write these
-- tables directly: every insert must go through the function, which is what
-- makes the rate limiting unbypassable (the browser has no write path that
-- skips the limiter) and keeps submissions unreadable from the client.
--
-- Two public forms, one table each; all user fields are stored as text (the
-- forms are free-text inputs).
--
-- Requires db/001_sessions.sql to have run first (the FK below points at it).
--
-- env         — SMALLINT, 0 = staging, 1 = production, so both sites can share
--               one project yet stay filterable (set by the edge function).
-- session_id  — hard FK to sessions(id): every submission references the
--               browser's session. The function resolves the session by its
--               token (creating it if this is the browser's first write),
--               then inserts the row with the returned id — so an interaction
--               row can never exist without a session.

CREATE TABLE IF NOT EXISTS enquiries (
  id          BIGSERIAL    PRIMARY KEY,
  env         SMALLINT     NOT NULL CHECK (env IN (0, 1)),
  session_id  BIGINT       NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  email       TEXT         NOT NULL,
  subject     TEXT         NOT NULL,
  message     TEXT         NOT NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workshop_registrations (
  id          BIGSERIAL    PRIMARY KEY,
  env         SMALLINT     NOT NULL CHECK (env IN (0, 1)),
  session_id  BIGINT       NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  workshop    TEXT         NOT NULL,
  name        TEXT         NOT NULL,
  people      TEXT         NOT NULL,
  email       TEXT         NOT NULL,
  phone       TEXT         NOT NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS enquiries_session_idx    ON enquiries (session_id);
CREATE INDEX IF NOT EXISTS enquiries_created_at_idx ON enquiries (created_at DESC);
CREATE INDEX IF NOT EXISTS workshop_registrations_session_idx    ON workshop_registrations (session_id);
CREATE INDEX IF NOT EXISTS workshop_registrations_created_at_idx ON workshop_registrations (created_at DESC);

-- Deny all direct access; the edge function connects as service role.
ALTER TABLE enquiries              ENABLE ROW LEVEL SECURITY;
ALTER TABLE workshop_registrations ENABLE ROW LEVEL SECURITY;
