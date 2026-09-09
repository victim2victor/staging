-- Shared rate limiter (sliding window)
--
-- One row per hit, keyed by an opaque `bucket` string. The `submit-form` edge
-- function writes a hit per request under two buckets — the salted IP hash
-- ('ip:<hash>') and, when present, the browser session token ('sess:<uuid>') —
-- and counts rows in the trailing window to decide whether to allow the insert.
-- Keeping the count in the database (not in function memory) means the limit
-- holds across the several stateless instances an edge function may run as.
--
-- The bucket is never a stored session column, so rotating the session token
-- can't reset the IP allowance. RLS is on with no policies: service role only.

CREATE TABLE IF NOT EXISTS rate_limits (
  id          BIGSERIAL    PRIMARY KEY,
  bucket      TEXT         NOT NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS rate_limits_bucket_created_idx
  ON rate_limits (bucket, created_at);

ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;

-- Old rows are harmless but accumulate; a scheduled job (e.g. pg_cron) can prune:
--   DELETE FROM rate_limits WHERE created_at < NOW() - INTERVAL '1 hour';
