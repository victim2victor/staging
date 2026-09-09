-- Shared rate limiter (fixed-window, atomic)
--
-- Edge functions are stateless and may run as several instances, so the count
-- is kept in the database where the increment is atomic. Each row is one
-- (key, window) bucket; `rate_limit_hit` increments the current window's
-- counter and reports the verdict in a single statement, so concurrent callers
-- cannot race past the limit.
--
-- The key embeds the salted IP hash (and, for submissions, the session token)
-- transiently — e.g. 'submit:<ip_hash>', 'submit:sess:<uuid>', 'visit:<ip_hash>'.
-- It is never a stored session column, so rotating a session token can't reset
-- the IP allowance. RLS is on with no policies: service role only.

CREATE TABLE IF NOT EXISTS rate_limits (
  key           TEXT        NOT NULL,
  window_start  TIMESTAMPTZ NOT NULL,
  count         INT         NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);

CREATE INDEX IF NOT EXISTS rate_limits_window_idx ON rate_limits (window_start);

ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;
-- No policies: only the edge functions (service role, which bypasses RLS) touch it.

-- Atomically record a hit against `p_key` and report whether it is within the
-- limit for the current fixed window of `p_window_seconds`. Returns the verdict,
-- the remaining allowance, and seconds until the window resets (0 while allowed).
-- The increment and the read are one statement, so concurrent callers cannot
-- race past the limit.
CREATE OR REPLACE FUNCTION rate_limit_hit(
  p_key            TEXT,
  p_limit          INT,
  p_window_seconds INT
)
RETURNS TABLE (allowed BOOLEAN, remaining INT, retry_after INT)
LANGUAGE plpgsql
AS $$
DECLARE
  v_bucket TIMESTAMPTZ;
  v_count  INT;
BEGIN
  -- Start of the current fixed window.
  v_bucket := to_timestamp(
    floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds
  );

  INSERT INTO rate_limits (key, window_start, count)
    VALUES (p_key, v_bucket, 1)
  ON CONFLICT (key, window_start)
    DO UPDATE SET count = rate_limits.count + 1
  RETURNING count INTO v_count;

  allowed     := v_count <= p_limit;
  remaining   := greatest(0, p_limit - v_count);
  retry_after := CASE
                   WHEN v_count <= p_limit THEN 0
                   ELSE ceil(extract(epoch FROM
                     (v_bucket + make_interval(secs => p_window_seconds)) - now()))::INT
                 END;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION rate_limit_hit(TEXT, INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rate_limit_hit(TEXT, INT, INT) TO service_role;

-- Past windows are dead weight once they pass; a scheduled job (e.g. pg_cron)
-- can purge them:
--   DELETE FROM rate_limits WHERE window_start < NOW() - INTERVAL '1 hour';
