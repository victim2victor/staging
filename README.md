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
git submodule update --init --recursive   # pull the unframe-kit composer
make dev                                   # → ui/dist/index.html (+ ui/dist/img)
```

Open `ui/dist/index.html` in a browser. `make clean` removes the output.

The build is the unframe composer (`unframe-kit/runtime/tpl.mk`): an `awk` macro
that streams `ui/layout.html` and inlines the CSS, JS and every section partial —
driven by the token → file map in `make/web.map`.

## Structure

```
Makefile                     build targets (dev, clean)
make/web.map                 token → file mapping for the composer
unframe-kit/                 the unframe kit (git submodule): runtime + skill
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

`.github/workflows/pages.yml` checks out the repo (with submodules), runs
`make dev`, and publishes `ui/dist` on every push to `main`. One-time setup in the
repo: **Settings → Pages → Source: GitHub Actions**. Point the
`victim2victor.co.za` domain at Pages once the build is verified.

---

Runtime and build conventions come from the **unframe** kit vendored at
`unframe-kit/` (its skill is symlinked into `.claude/skills/unframe`).
