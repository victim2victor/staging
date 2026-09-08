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
make dev    # → ui/dist/index.html (+ ui/dist/img)
```

No dependencies to install — `make` and `awk` are all it needs.

Open `ui/dist/index.html` in a browser. `make clean` removes the output.

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

**None yet.** This is a static content/brochure site — there are no CRUD entities
or localStorage models. If the site later grows dynamic data (e.g. a workshop
calendar or bookings), document the models here per the unframe convention and add
them as the online build lands (see below).

## Contact forms — backend deferred

Both forms (general enquiry and workshop registration) currently compose a
`mailto:info@victim2victor.co.za` from their fields via `handleForm` in
`ui/layout.js`, keeping the site fully static. When a backend is chosen, wire the
submit path to it (e.g. Supabase, per the unframe online build) inside `//online`
markers and keep the mailto as the offline fallback.

## Deployment (GitHub Pages)

`.github/workflows/pages.yml` is committed **identically to both repos** and
branches on `github.repository`:

| Repo | Ref | Result |
|---|---|---|
| `victim2victor/staging` | any branch | build → staging Pages site |
| `victim2victor/staging` | `main` | build → staging Pages, then promote to production |
| `victim2victor/victim2victor.github.io` | `main` | build → production Pages site |
| `victim2victor/victim2victor.github.io` | other | build-check only, no deploy |

Push a branch to see it on the staging site (one Pages site per repo, so the most
recent push is what's live there). Merging to `main` ships to production —
promotion is gated on the staging build succeeding.

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
