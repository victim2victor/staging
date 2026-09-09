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
-- environment  — 'staging' or 'production', so both sites can share one project
--                yet stay filterable (set by the edge function; see supabase/).
-- session_token — soft link to the browser's random localStorage token (no FK):
--                a submission may arrive before/without a session, and it is
--                also one of the rate-limit keys.

CREATE TABLE IF NOT EXISTS enquiries (
  id             BIGSERIAL    PRIMARY KEY,
  environment    TEXT         NOT NULL CHECK (environment IN ('staging', 'production')),
  email          TEXT         NOT NULL,
  subject        TEXT         NOT NULL,
  message        TEXT         NOT NULL,
  session_token  UUID,                  -- soft link; may be NULL
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workshop_registrations (
  id             BIGSERIAL    PRIMARY KEY,
  environment    TEXT         NOT NULL CHECK (environment IN ('staging', 'production')),
  workshop       TEXT         NOT NULL,
  name           TEXT         NOT NULL,
  people         TEXT         NOT NULL,
  email          TEXT         NOT NULL,
  phone          TEXT         NOT NULL,
  session_token  UUID,                  -- soft link; may be NULL
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS enquiries_created_at_idx
  ON enquiries (created_at DESC);
CREATE INDEX IF NOT EXISTS workshop_registrations_created_at_idx
  ON workshop_registrations (created_at DESC);

-- Deny all direct access; the edge function connects as service role.
ALTER TABLE enquiries              ENABLE ROW LEVEL SECURITY;
ALTER TABLE workshop_registrations ENABLE ROW LEVEL SECURITY;
