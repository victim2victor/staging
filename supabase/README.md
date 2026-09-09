# Supabase back-end

The contact forms and anonymous page-visit tracking live in Supabase. The
offline `dev` build never touches it (the forms fall back to a `mailto:`, and no
tracking fires); the online `stg`/`prd` builds POST to the edge functions.

Everything is private by default: every table is **RLS-on with no policies**, so
the publishable key can neither read nor write it. The edge functions
(`submit-form`, `track-visit`) are the only write path, connecting as service
role; the owner reads the data in the Supabase dashboard.

## Write path — edge function only

Both tables are **RLS-on with no policies**, so the publishable key can neither
read nor write them. Every submission goes through the **`submit-form`** edge
function, which writes as **service role**. Routing it through the function is
what makes the rate limiting unbypassable — the browser has no write path that
skips the limiter — and keeps submissions unreadable from the client (read them
in the dashboard or via the service role).

- **`../db/003_contact_forms.sql`** — `enquiries` and `workshop_registrations`
  (RLS on, no policies). Each row carries `env` (`0` = staging, `1` = production)
  and a mandatory `session_id` referencing `sessions(id)` — the function resolves
  the browser's session before inserting. (Runs after `001_sessions.sql`.)
- **`../db/002_rate_limits.sql`** — the shared limiter: a fixed-window counter
  table plus the atomic `rate_limit_hit` SQL function.
- **`functions/submit-form/`** — validates the form, applies the rate limit,
  and inserts the row. One function serves both forms (routed by the `form`
  field in the body).

## Spam protection

Three layers, all in the function:

1. **Honeypot** — a hidden `company` field. If a bot fills it, the function
   returns `{ ok: true }` and stores nothing.
2. **Validation** — required fields, email format, length clamps per form.
3. **Rate limit** — a fixed-window atomic counter (default **5 per 10 min**) via
   the `rate_limit_hit` SQL function, keyed by **both** the caller's salted IP
   hash and their session `token`. Either key over its limit returns `429` (with
   `Retry-After`). The count lives in the database and is incremented in one
   statement, so it holds across the function's stateless instances and
   concurrent requests can't race past the limit.

The raw IP is never stored — only a salted SHA-256 hash, used transiently as a
rate-limit key. Set **`IP_HASH_SALT`** so the small IPv4 space can't be brute-
forced back from a hash.

## Page-visit tracking

A fire-and-forget beacon on every page load records anonymous visits, written
only by the **`track-visit`** edge function (service role). Both tables are
RLS-on with no policies — the browser can neither read nor write them.

- **`../db/001_sessions.sql`** — `sessions` (one row per browser; surrogate `id`
  PK, with the `v2v_session` localStorage UUID in `token`; geolocated once on
  first sight, all fields best-effort) and `page_views` (one row per load,
  referencing `sessions(id)` via `session_id`). Both carry their own `env`
  column. Run this **first** — the contact-form tables reference `sessions(id)`.
- **`functions/track-visit/`** — drops bot user-agents up front (never
  recorded), rate-limits by hashed IP (default **60 / min**), geolocates the IP
  on the session's first sight (ipapi.co, best-effort), then resolves the session
  (insert on first sight, else bump `last_seen`) and appends the page view with
  its `session_id`. The raw IP is only ever hashed, never stored.

Bot filtering is metrics-only — the site is static Pages, so crawlers still load
every page and **SEO is unaffected**.

## Setup (once the project exists)

1. **Run the schema, in order.** Paste `db/001_sessions.sql` (the `sessions` table
   the others reference), then `db/002_rate_limits.sql`, then
   `db/003_contact_forms.sql` into the Supabase SQL editor (or `supabase db push`).
   All are idempotent.
2. **Deploy both functions with JWT verification off:**
   ```bash
   supabase functions deploy submit-form --no-verify-jwt
   supabase functions deploy track-visit --no-verify-jwt
   ```
   `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` are provided automatically.
3. **Set the salt secret** (the **same** salt both functions use, so IP hashes
   match):
   ```bash
   supabase secrets set IP_HASH_SALT=<a long random string>
   ```
   Without it the IP hash still removes plaintext IPs but offers no pre-image
   resistance.
4. **Point the site at the project.** In `ui/layout.js` (`//online` block), set
   `SUPABASE_URL` → `https://<project-ref>.supabase.co` and `SUPABASE_ANON` →
   the project's **publishable** key. Both are public and ship in the online
   bundle; until they are set the form falls back to the `mailto:` and tracking
   no-ops.
5. **Origins.** Both functions allow the site's origins in `ALLOWED_ORIGINS`;
   add the production custom domain there once it is live.

Staging and production share one project — every interaction row is tagged
`env=0` (staging) vs `env=1` (production) on the row itself, so
`where env=1` filters staging out.
