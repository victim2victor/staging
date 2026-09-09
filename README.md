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
one table; all fields are stored as `text` (the forms are free-text inputs). The
schema lives in `supabase/migrations/0001_contact_forms.sql`.

**`enquiries`** — the "Send us a message" form.

| Column | Type | Notes |
|---|---|---|
| `id` | `bigint` | identity, primary key |
| `created_at` | `timestamptz` | defaults to `now()` |
| `email` | `text` | sender's email |
| `subject` | `text` | subject line |
| `message` | `text` | message body |

**`workshop_registrations`** — the "Register for a workshop" form.

| Column | Type | Notes |
|---|---|---|
| `id` | `bigint` | identity, primary key |
| `created_at` | `timestamptz` | defaults to `now()` |
| `workshop` | `text` | which workshop |
| `name` | `text` | registrant's name |
| `people` | `text` | number of people |
| `email` | `text` | registrant's email |
| `phone` | `text` | phone number |

**Security.** Both tables have row-level security enabled with an INSERT-only
policy for the `anon` role — the public forms can submit rows but cannot read,
edit, or delete them. Read submissions in the Supabase dashboard or with the
service role.

## Contact forms — Supabase backend

Both forms (general enquiry and workshop registration) are wired through
`handleForm` in `ui/layout.js` following the unframe online/offline split:

- **online (`make stg` / `make prd`)** — the submission is inserted into the
  matching Supabase table via the REST API (`POST /rest/v1/<table>`). Each
  input's `name` is its column; its `data-label` is the human label used by the
  mailto fallback. This code is fenced with `//online` markers.
- **offline (`make dev`)** — the `//online` code is stripped, leaving a
  `mailto:victim2victorinitiative@gmail.com` fallback so the static demo still
  reaches the team.

**Before the online build works, fill in the project credentials.** `ui/layout.js`
has placeholders (`SUPABASE_URL`, `SUPABASE_ANON_KEY`) inside `//online` markers.
Set them to the Victim2Victor Supabase project's URL and **publishable (anon)**
key — both are public by design and safe to commit; row-level security is what
protects the data. Then apply `supabase/migrations/0001_contact_forms.sql` to the
project (Supabase dashboard SQL editor, or `supabase db push`).

## Deployment (GitHub Pages)

`.github/workflows/pages.yml` is committed **identically to both repos** and
branches on `github.repository`:

| Repo | Ref | Result |
|---|---|---|
| `victim2victor/staging` | any branch | `make dev` (offline) → staging Pages site |
| `victim2victor/staging` | `main` | `make dev` → staging Pages, then promote to production |
| `victim2victor/victim2victor.github.io` | `main` | `make prd` (online) → production Pages site |
| `victim2victor/victim2victor.github.io` | other | `make prd` build-check only, no deploy |

Staging deploys the **offline** build (`make dev`) — no secrets, forms use the
mailto fallback — so pushing a branch to see it on staging works with no Supabase
setup. Production deploys the **online** build (`make prd`), which needs the
Supabase credentials filled in (see **Contact forms** above) to submit form data.
One Pages site per repo, so the most recent push is what's live on staging.
Merging to `main` ships to production — promotion is gated on the staging build
succeeding.

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
