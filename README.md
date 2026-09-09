# Victim2Victor

The [victim2victor.co.za](https://www.victim2victor.co.za) website, rebuilt on the
**unframe** stack — plain HTML/CSS/JS composed into a single static `index.html`,
no framework, no npm, no bundler. This replaces the previous WordPress hosting and
is designed to deploy to **GitHub Pages**.

Victim 2 Victor Initiative offers Bible-based coaching and workshops for healing
father and mother wounds — from victimhood to victory. Rooted in Cape Town,
reaching across South Africa.

## Build

```bash
make dev    # offline build → ui/dist/index.html (+ ui/dist/img)
make stg    # online build (Supabase calls kept) — staging
make prd    # online build (Supabase calls kept) — production
make clean  # remove the output
```

No dependencies to install — `make`, `awk` and `sed` are all it needs.

The three targets differ **only in the back-end (Supabase) calls**. The JS source
fences those with `//online` markers (`//online-start … //online-end` for a block,
a trailing `//online` for one line). `make dev` strips them with `sed` — the
offline build talks to no back-end and the contact forms fall back to a `mailto:`.
`make stg` / `make prd` keep them, so the forms insert into Supabase. See
**Contact forms** below.

Open `ui/dist/index.html` in a browser.

The build is the unframe composer (`make/tpl.mk`): an `awk` macro
that streams `ui/layout.html` and inlines the CSS, JS and every section partial —
driven by the token → file map in `make/web.map`.

## Structure

```
Makefile                     build targets (dev, clean)
make/web.map                 token → file mapping for the composer
make/tpl.mk                  the unframe compose macro (vendored)
ui/
  layout.html                page shell with composer tokens
  layout.css                 the whole design system (palette, type, components)
  layout.js                  mobile nav toggle + contact-form handler
  comps/                     one file per page section
    header.html  hero.html  purpose.html  workshop.html  testimonials.html
    different.html  about.html  founder.html  contact.html  footer.html
  img/                       images (logo, hero, workshop, about, partner logo)
  dist/                      generated single-file build (git-ignored)
.github/workflows/pages.yml  builds + publishes ui/dist on every push to main
```

Adding or changing a section = edit/add a file in `ui/comps/`, add its token to
`ui/layout.html` and a `token:path` line to `make/web.map`, then `make dev`.

## Content sections

Single-page site, in order: **hero** (Join the Journey) · **purpose** (Isaiah 58:12
purpose statement) · **workshop** (Overcoming Childhood Trauma) · **testimonials**
(Gordon, Danfred, Leonard) · **what makes us different** (five feature cards) ·
**about Victim2Victor** · **about Stefan Ehlers** (founder) · **contact** (details +
two forms) · **footer**.

## Design tokens

- **Palette** (CSS custom properties in `layout.css`): off-white `#f9f9f9`, ink
  `#313131`, terracotta accent `#d8613c`, warm sand `#c2a990`, sage `#b1c5a4`,
  beige `#cfcabe` — the earthy scheme carried over from the original site.
- **Type**: Cardo (serif headings) + Poppins (sans body), loaded from fonts.bunny.net
  with system-font fallbacks.

## Data models

The two contact forms persist to Supabase in the online build. Each form maps to
one table; all user fields are stored as `text` (the forms are free-text inputs).
The schema lives in `db/001_contact_forms.sql`; see `supabase/README.md` for the
back-end setup.

**`enquiries`** — the "Send us a message" form.

| Column | Type | Notes |
|---|---|---|
| `id` | `bigint` | identity, primary key |
| `environment` | `text` | `'staging'` or `'production'` — which site wrote the row |
| `email` | `text` | sender's email |
| `subject` | `text` | subject line |
| `message` | `text` | message body |
| `session_token` | `uuid` | soft link to the browser's session token; nullable |
| `created_at` | `timestamptz` | defaults to `now()` |

**`workshop_registrations`** — the "Register for a workshop" form.

| Column | Type | Notes |
|---|---|---|
| `id` | `bigint` | identity, primary key |
| `environment` | `text` | `'staging'` or `'production'` — which site wrote the row |
| `workshop` | `text` | which workshop |
| `name` | `text` | registrant's name |
| `people` | `text` | number of people |
| `email` | `text` | registrant's email |
| `phone` | `text` | phone number |
| `session_token` | `uuid` | soft link to the browser's session token; nullable |
| `created_at` | `timestamptz` | defaults to `now()` |

A shared **`rate_limits`** table (`db/002_rate_limits.sql`) backs the limiter — see
below.

### Page-visit tracking

Anonymous visits are tracked in two tables (`db/003_visits.sql`), written only by
the `track-visit` edge function. The raw IP is never stored — only a salted hash.

**`sessions`** — one row per browser, keyed by the same `session_token` the forms
use. Geolocated once on first sight; every geo field is best-effort and nullable.

| Column | Type | Notes |
|---|---|---|
| `session_token` | `uuid` | primary key — the browser's `v2v_session` token |
| `environment` | `text` | `'staging'` or `'production'` |
| `ip_hash` | `text` | salted SHA-256 of the IP (never the raw IP) |
| `country` / `continent` | `char(2)` | ISO codes; nullable |
| `city` | `text` | nullable |
| `latitude` / `longitude` | `double precision` | city-level; nullable |
| `timezone` | `text` | IANA; nullable |
| `asorg` | `text` | ISP / network; nullable |
| `user_agent` | `text` | nullable |
| `created_at` / `last_seen` | `timestamptz` | default `now()` |

**`page_views`** — one row per page load.

| Column | Type | Notes |
|---|---|---|
| `id` | `bigint` | identity, primary key |
| `session_token` | `uuid` | references `sessions`, `on delete cascade` |
| `page` | `text` | path, defaults to `'/'` |
| `referrer` | `text` | nullable |
| `created_at` | `timestamptz` | defaults to `now()` |

**Environment tagging.** Both the staging and production sites write to the same
Supabase project, so every row records which one it came from. The edge function
sets `environment`: from the request origin where the hostnames differ (the live
custom domain → `'production'`), otherwise from the build stamp (`make stg` →
`'staging'`, `make prd` → `'production'`). A `check` constraint allows only those
two values. Filter on `environment = 'production'` to exclude staging traffic.

**Security.** Every table — `enquiries`, `workshop_registrations`, `rate_limits`,
`sessions`, `page_views` — has **row-level security enabled with no policies**, so
the publishable key can neither read nor write it. All writes go through the edge
functions (`submit-form`, `track-visit`) as **service role**, which is what makes
the rate limiting unbypassable and keeps the data unreadable from the client. Read
it in the Supabase dashboard or via the service role.

## Contact forms — Supabase backend

Both forms (general enquiry and workshop registration) are wired through
`handleForm` in `ui/layout.js` following the unframe online/offline split:

- **online (`make stg` / `make prd`)** — the submission is POSTed to the
  **`submit-form` edge function** (`/functions/v1/submit-form`), which validates,
  applies a **honeypot + rate limit**, and inserts as service role. The browser
  sends a random `session_token` (kept in `localStorage`) alongside the fields.
  This code is fenced with `//online` markers.
- **offline (`make dev`)** — the `//online` code is stripped, leaving a
  `mailto:victim2victorinitiative@gmail.com` fallback so the static demo still
  reaches the team.

**Spam protection / rate limiting** lives entirely in the function: a hidden
honeypot field, per-field validation, and a fixed-window atomic rate limit
(default **5 per 10 min**) via the `rate_limit_hit` SQL function, keyed by **both**
the caller's salted IP hash and their `session_token`. See `supabase/README.md`.

**Before the online build works:** run the `db/*.sql` files, deploy the functions
(`supabase functions deploy submit-form --no-verify-jwt` and likewise
`track-visit`), set the `IP_HASH_SALT` secret, and fill in `SUPABASE_URL` /
`SUPABASE_ANON` (the publishable key) in `ui/layout.js`. Full steps are in
`supabase/README.md`.

## Page-visit tracking — Supabase backend

The online build fires a fire-and-forget beacon on every page load to the
**`track-visit` edge function**, which bot-filters, geolocates (once per browser),
rate-limits by hashed IP, and records the visit into `sessions` / `page_views`
(see **Data models**). It never blocks or affects the page. The offline `dev`
build strips the beacon entirely, so the static demo sends nothing. Setup is the
same one-time flow above (the `db/003_visits.sql` schema and the `track-visit`
deploy are included there).

## Deployment (GitHub Pages)

`.github/workflows/pages.yml` is committed **identically to both repos** and
branches on `github.repository`:

| Repo | Ref | Result |
|---|---|---|
| `victim2victor/staging` | any branch | `make stg` (online, env=staging) → staging Pages site |
| `victim2victor/staging` | `main` | `make stg` → staging Pages, then promote to production |
| `victim2victor/victim2victor.github.io` | `main` | `make prd` (online, env=production) → production Pages site |
| `victim2victor/victim2victor.github.io` | other | `make prd` build-check only, no deploy |

Both sites deploy an **online** build and write to the same Supabase project —
staging tags its rows `environment='staging'`, production tags `'production'` (see
**Data models** above), so staging traffic can be filtered out. Both therefore need
the Supabase credentials filled in (see **Contact forms**). The URL and publishable
key are public and committed, so there are no repo secrets to set for the build
itself. `make dev` remains the local **offline** preview (mailto fallback, no
back-end). One Pages site per repo, so the most recent push is what's live on
staging. Merging to `main` ships to production — promotion is gated on the staging
build succeeding.

The production repo must be named `victim2victor.github.io` — that exact name is
what makes GitHub serve it at `https://victim2victor.github.io` rather than
`https://victim2victor.github.io/<repo>/`.

One-time setup: **Settings → Pages → Source: GitHub Actions** in both repos, and
a write-enabled deploy key for the production repo whose private half is stored
as the `PROD_DEPLOY_KEY` secret in the staging repo. Point the
`victim2victor.co.za` domain at Pages once the build is verified.

---

Runtime and build conventions come from the **unframe** kit. Its compose macro
is vendored at `make/tpl.mk` and its skill at `.claude/skills/unframe/` — both
copied in, so the repo has no submodule to initialise.
