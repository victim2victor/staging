---
name: unframe
description: >-
  Build a small web app the "unframe" way — no framework, plain JS with a ~120-line
  Proxy-based reactivity core, HTML/CSS/JS components composed into a single static
  index.html by an awk-based Makefile, and an online/offline build toggle. Use this
  when the user wants to scaffold or extend a lightweight single-file web UI, add a
  reactive component, define relational localStorage data models with an offline demo
  seed, or set up the make-based single-file build. Reflects anroleroux's personal
  app-building conventions. Also covers deployment: the single-repo GitHub Pages demo,
  and the two-repo staging→production setup where a staging repo deploys every branch
  and promotes to a production repo (on merge to main, or via a prod branch).
---

# unframe — building apps with no framework

This skill describes a specific, opinionated way to build small web apps: **plain
HTML/CSS/JS, zero npm dependencies, zero framework, one static `index.html` output.**
Reactivity comes from a ~120-line Proxy core; the build is an `awk` macro driven by a
Makefile. Follow these conventions when scaffolding or extending an app in this style.

The reusable runtime lives next to this file in `runtime/` (`reactivity.js`,
`tpl.mk`). Treat those as the source of truth — copy or submodule them, don't rewrite
them.

## The tech stack

The preferred stack is deliberately small and boring. Stay inside it unless the app has a
concrete reason to leave:

- **Frontend** — vanilla **HTML / CSS / JS**. No framework, no npm runtime deps.
- **Backend** — **Go** (golang) service + **Postgres**, or **Supabase** (managed Postgres
  with auto REST/auth) as the lower-effort managed option.
- **Tooling** — **Make** (the build/compose + target orchestration) and **Docker Compose**
  (spin up local server and DB instances).

Read this as a **proto→production ladder**, climbed gradually (see "The app evolves"):

1. **In-browser only** — vanilla HTML/CSS/JS + localStorage. No backend. The starting
   point for most apps and what deploys as the GitHub Pages demo.
2. **Supabase** — a managed Postgres backend reached with little infrastructure; a fast
   way to get real persistence and auth behind the online build.
3. **Go + Postgres** — a self-hosted Go service over Postgres. This is normally the
   **highest rung** — where an app lands when it needs full backend control. You climb to
   it last, **unless a Go service is specifically required**, in which case bring Go in
   directly rather than routing through Supabase first.

Both backends sit behind the **same `//online` fetch contract** (below), so moving up the
ladder changes what the online paths talk to, not the frontend.

### Local server + DB via Docker Compose

When the app has a backend, use **Docker containers** to run it locally: a `docker
compose` stack that brings up the **Go server** and a **Postgres** instance (and, if used
locally, the Supabase stack) for `dev`/`stg`. Make targets wrap the compose commands so
`make dev` (or similar) spins the local instances up. Keep the compose file to exactly the
services the app currently needs — same rule as the Makefile.

## The mental model

An app is a set of **components**, each a plain `.js` file, plus a **layout** that
declares where components and shared assets get inlined. A Makefile runs an `awk`
**composer** that replaces placeholder tokens in the layout with the contents of
mapped files, producing a single `dist/index.html` (with CSS and JS inlined). There is
no bundler, no transpile step, no runtime dependency fetch.

```
ui/
  layout.html      layout.css      layout.js      reactivity.js   ← shells + core
  comps/
    products.js    categories.js   ...                            ← one file per component
  dist/
    index.html  index.css  index.js                               ← generated, single-file
make/
  tpl.mk           ← the compose macro (from runtime/tpl.mk)
  web.map          ← token → file mapping
Makefile           ← build targets
```

## Reactivity: `reactive()` + `mount()`

`runtime/reactivity.js` gives you two primitives. Do not reach for a framework; use
these.

- **`reactive(obj, onChange)`** wraps an object in a `Proxy`. Any `set`/`delete` on it
  (or a nested object) calls `onChange`. The property `_draft` is exempt — it holds
  in-flight edit text without forcing a re-render.
- **`mount(root, state, templateFn)`** creates a reactive state object, renders
  `templateFn(state)` into `root.innerHTML`, and re-renders on every state mutation.
  It returns the reactive object; assigning to that object *is* how you update the UI.

A component follows this exact shape:

```js
// 1. A pure template: state in, HTML string out. No side effects.
function productsTemplate(state) {
    if (state.selected) return detailTemplate(state.selected);
    if (state.adding)   return addFormTemplate();
    return state.list.map(rowTemplate).join("");
}

// 2. Mount once, into a global named after the component.
var products = mount(
    document.getElementById("products-list"),
    { list: [], selected: null, adding: false, editing_field: null },
    productsTemplate
);

// 3. Handlers mutate the global; the mutation triggers the re-render.
function selectProduct(i) { products.selected = products.list[i]; }
```

Conventions that make this work:
- The mount global is named for the component (`products`, `categories`) and is
  referenced from inline `onclick=`/`oninput=` handlers by that name.
- Templates are **pure string builders** — never touch the DOM inside them; let
  `mount`'s `render()` own `innerHTML`.
- Inline-editable fields use the `editableField()` / `beginEdit` / `saveField` /
  `cancelEdit` helpers in `reactivity.js`, with `_draft` holding the unsaved value and
  `editing_field` naming the field currently in edit mode.

## The single-file build (composer)

`runtime/tpl.mk` defines one make macro:

```
$(call compose, SOURCE, MAP, OUTPUT)
```

It reads `MAP` (lines of `token:filepath`), then streams `SOURCE` line by line; when a
line contains a token, it splices in that file's contents **preserving the source
line's indentation**, otherwise it passes the line through. Output goes to `OUTPUT`.

The layout files carry the tokens:

- `layout.html` has `/*{{layout-css}}*/` inside `<style>` and `// {{layout-js}}` inside
  `<script>` — so the final HTML inlines all CSS and JS into one file.
- `layout.js` has `/* {{reactivity-js}} */` then one `/* {{component}}-js */` token per
  component, in load order.
- `web.map` maps every token to its file.

To add a component `foo`:
1. Create `ui/comps/foo.js` with a `fooTemplate`, a `mount(...)` into `var foo`, and
   its handlers.
2. Add a `<section id="page-foo">` (and nav button) to `layout.html`.
3. Add `/* {{foo-js}} */` to `layout.js` and `{{foo-js}}:ui/comps/foo.js` to `web.map`.
4. `make` — the token gets inlined into `dist/index.js` and then into `dist/index.html`.

Wildcard prerequisites (`$(wildcard ui/comps/*.js)`) mean the build re-runs when any
component changes; no manifest to maintain beyond `web.map`.

## Data models & local storage

Most apps have a **relational data structure**: a handful of entities that reference each
other by id. **The user provides the CRUD models** — the entities, their fields, and how
they relate. You don't invent them; you implement against what the user specifies.

Every app keeps a **local, offline instance of its data in browser localStorage, one
model per key.** The key is the model's name; its value is the JSON array of that model's
rows. The `loadLocal` / `saveLocal` / `nextLocalId` helpers in `layout.js` are the whole
data layer for the offline build:

```
localStorage["products"]   → [ { id: 1, name: "…", category_id: 2, price: 3.49 }, … ]
localStorage["categories"] → [ { id: 1, name: "…" }, … ]
```

- **Relations are ids.** A child row stores the parent's `id` (e.g. `category_id`); joins
  happen in the template/handler code, not in storage.
- **Ids are local and monotonic** via `nextLocalId(model)` — mirrors what a DB
  auto-increment would give, so the same code works when a backend lands.
- This local instance is **universal** — it exists in every build, at every stage. It's
  the source of truth for the offline build and the working cache/fallback for the online
  build.

### HARD RULE — document the models in the README

**Always document the app's CRUD models in its README, and update the README whenever a
model changes.** This is not optional and not deferrable: when you add, remove, or alter a
model or a field, the README's models section changes in the *same* change. Treat a model
edit with a stale README as an incomplete change.

Document each entity with its fields, types, and relationships — enough that the models can
be recreated from the README alone (and later translated into a Supabase schema). A simple
per-entity table or list is fine; keep it exact.

## The demo seed — dev/stg only, never prd

Ship a **demo seed JS file** (e.g. `ui/demo.js`) that **populates the localStorage keys
with sample rows when they don't already exist** — one guarded block per model:

```js
function seedDemo() {
    if (!localStorage.getItem("categories"))
        saveLocal("categories", [ { id: 1, name: "Drinks" }, { id: 2, name: "Snacks" } ]);
    if (!localStorage.getItem("products"))
        saveLocal("products", [ { id: 1, name: "Cola", category_id: 1, price: 3.49 } ]);
}
```

- **It only seeds missing keys** — it never overwrites data the user has entered.
- **It runs in the offline `dev` build only.** The online `stg`/`prd` builds read from
  the real backend (staging is online by default — see the deployment section), so they
  don't seed localStorage. Exclude the seed from them (leave its token out of their
  `web.map`, or strip it the way online blocks are stripped) so the backend-backed
  builds start from real data, not demo rows.
- Its rows are the natural place to show the relational shape working end to end, so keep
  them consistent with the documented models.

## Toward a backend: prd may leave localStorage behind

The local offline instance is the default everywhere, but `prd` can later **pull from a
real database** (Supabase, or a Go service over Postgres — see below) instead of browser
storage. That transition is a
genuine design decision, not a free switch: pulling from a DB may mean **disabling browser
storage in prd**, or **building an offline↔online sync layer** so the local instance and
the DB stay reconciled. Pick one deliberately when the app reaches that point; until then,
localStorage is the store.

## Online / offline: one codebase, two builds

The same source produces two kinds of build: an **offline** build (pure in-browser,
localStorage, no backend) and an **online** build (wired to a real backend). Data code
is written **online-first**, then the online paths are wrapped in markers so the offline
build can strip them:

```js
async function loadProducts() {
    //online-start
    ... fetch(...) ...        // stripped in the offline build
    return;
    //online-end
    products.list = loadLocal("products");   // the offline fallback runs
}
```

- `//online-start` … `//online-end` — a block deleted in the offline build.
- `//online` — a single trailing-comment line deleted in the offline build.
- The offline build runs `sed` to delete those, leaving a pure **localStorage** app
  driven by `loadLocal` / `saveLocal` / `nextLocalId` (defined in `layout.js`). This is
  what deploys to GitHub Pages — a working demo with no backend.

The backend the online paths target is **Supabase or a Go + Postgres service** (see
below) — but an app rarely starts there. It usually begins life as the offline build
alone, and only grows the online paths once it needs a real backend.

## Deploying the demo to GitHub Pages

The offline build's single static `index.html` is the **GitHub Pages demo** — a working,
backend-free version of the app anyone can open from the repo's Pages URL. Ship a GitHub
Actions workflow that **builds that file and publishes it on every push**, so the demo
stays in lockstep with the source. This is part of scaffolding an app that has HTML to
show, not a later add-on.

Add `.github/workflows/pages.yml` in the **app** repo (not in this kit). It runs the
same `make` + `awk` + `sed` build the developer runs locally — all three are already on
the `ubuntu-latest` runner, so there's **no toolchain to install** and nothing that
breaks the dependency-free rule:

```yaml
name: Deploy demo to GitHub Pages

on:
  push:
    branches: [main]        # deploy the demo on every push to the default branch
  workflow_dispatch:        # ...and let it be triggered by hand

permissions:                # least privilege the Pages deploy needs
  contents: read
  pages: write
  id-token: write

concurrency:                # one deploy at a time; don't cancel an in-flight one
  group: pages
  cancel-in-progress: false

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deploy.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
        with:
          submodules: recursive        # pull the unframe-kit submodule for the runtime

      - name: Build the offline single-file demo
        run: make dev                   # the in-browser, seeded offline build → ui/dist/index.html

      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: ui/dist                 # the single-file build output
      - id: deploy
        uses: actions/deploy-pages@v4
```

The demo is the **in-browser, seeded offline build** — the `dev` target (see the naming
preference below), which strips the `//online` blocks and includes the demo seed so
visitors land on a populated app. This single-repo demo is always the offline `dev`
build; `stg`/`prd` are the online, backend-backed builds of the two-repo production
setup (below), not this one.

Adjust two things to the app:

- **The build target and output dir.** Swap `make dev` for the app's actual demo target
  if it differs, and `ui/dist` for its output directory.
- **The submodule step.** Keep `submodules: recursive` only if the app vendors this kit
  as a git submodule; drop it if the runtime is copied in.

One-time repo setup the developer does by hand: **Settings → Pages → Source: GitHub
Actions.** The workflow does the rest on each push.

That is the whole story while the app has **one** Pages site. Once it has a real
audience and needs a staging site separate from a live one, see "Going to production"
below — the workflow there supersedes this one rather than sitting alongside it.

## Going to production: a staging repo and a production repo

The single workflow above is the whole story while an app has one Pages site. Once it
has a **real audience**, split it across two repos:

- a **staging repo** — every branch deploys to a staging Pages site, so pushing a branch
  is how you look at it;
- a **production repo** — `main` deploys to the live site, and nothing else deploys.

Work happens in the staging repo. Production is reached by **promotion**: a job in the
staging repo pushes a ref to the production repo's `main`, and the production repo's own
copy of the workflow picks it up and deploys. Production has no build of its own to
babysit and no second workflow to keep in step.

**Staging deploys the online build by default.** Once the app has a backend, the
staging repo builds `make stg` and the production repo `make prd` — **both online**,
both talking to the real backend. Staging is where you exercise the live wiring before
promoting, so it should hit the backend, not the offline demo. Both environments write
to the **same** backend; to keep their data distinguishable, every interaction table
carries an `env` column (see "The `env` column" below): `make stg` stamps rows `0`
(staging), `make prd` stamps `1` (production), so staging activity can be viewed on its
own or filtered out of production. (`make dev` stays the local offline preview and the
single-repo Pages demo — there is no backend there to be online against.)

**One workflow file, committed identically to both repos**, branching on
`github.repository` so the same file behaves correctly in each. Keeping the two copies
identical is not tidiness — promotion pushes the staging branch into the production
repo's `main`, and the workflow file travels with it. If the copies diverged, a
promotion would silently overwrite production's workflow with staging's.

Note that a repo has exactly **one** Pages deployment. "Every branch deploys to staging"
means the most recent push is what's live there — not a URL per branch.

### Two promotion triggers — pick one per project

**Option A — promote on merge to `main`.** The trunk *is* production.

- staging repo, any branch → build + deploy to staging
- staging repo, `main` → deploy to staging **and** promote to production
- Gate the promotion on the staging deploy with `needs:`, so a merge that fails to
  build never reaches production.

Fewest moving parts, and no second branch to remember. The cost is that there is no
manual gate: every merge to `main` is live within a minute. Choose this when `main` is
already treated as "ready to ship" — a brochure site, a solo project, anything where
merging already means finished.

**Option B — promote on merge to a `prod` branch.** Shipping is a separate, deliberate act.

- staging repo, any branch **except `prod`** → build + deploy to staging
- staging repo, `prod` → promote to production, nothing else
- `main` stays a safe trunk that only ever updates staging

Shipping is merging `main` into `prod` and pushing it. The cost is the extra branch and
merge. Choose this when `main` accumulates work that isn't all ready to go out at once,
when several people merge, or when a release wants to be a decision rather than a
side effect.

Both options give the production repo the same two jobs: `main` builds and deploys, and
every other branch runs a **build-check that never deploys**.

### The workflow

Option A, complete. The `if:` conditions carry all the routing; there is no matrix and
no reusable-workflow indirection to unpick:

```yaml
name: Deploy to GitHub Pages

# Committed identically to BOTH repos; branches on github.repository.
#   <org>/<prod-repo>  main → deploy live;  other branches → build-check only
#   <org>/<staging>    any branch → deploy staging;  main → also promote

on:
  push:
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages-${{ github.repository }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  deploy-prod:
    if: github.repository == '<org>/<prod-repo>' && github.ref == 'refs/heads/main'
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: make prd            # online: rows tagged environment=production
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: ui/dist
      - uses: actions/deploy-pages@v4
        id: deployment

  build-check:
    if: github.repository == '<org>/<prod-repo>' && github.ref != 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: make prd            # online build; validate only, never deploys

  deploy-staging:
    if: github.repository == '<org>/<staging-repo>'
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: make stg            # online: rows tagged environment=staging
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: ui/dist
      - uses: actions/deploy-pages@v4
        id: deployment

  promote-prod:
    if: github.repository == '<org>/<staging-repo>' && github.ref == 'refs/heads/main'
    needs: deploy-staging        # a failed staging build never promotes
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0         # promotion is a real push; it needs the history
      - name: Push to production repo
        env:
          PROD_DEPLOY_KEY: ${{ secrets.PROD_DEPLOY_KEY }}
        run: |
          mkdir -p ~/.ssh
          printf '%s\n' "$PROD_DEPLOY_KEY" > ~/.ssh/prod_key
          chmod 600 ~/.ssh/prod_key
          ssh-keyscan github.com >> ~/.ssh/known_hosts 2>/dev/null
          export GIT_SSH_COMMAND="ssh -i ~/.ssh/prod_key -o IdentitiesOnly=yes"
          git remote add production git@github.com:<org>/<prod-repo>.git
          git push production HEAD:main
```

**For Option B, three lines change:**

```yaml
  deploy-staging:
    if: github.repository == '<org>/<staging-repo>' && github.ref != 'refs/heads/prod'

  promote-prod:
    if: github.repository == '<org>/<staging-repo>' && github.ref == 'refs/heads/prod'
    # drop `needs: deploy-staging` — on the prod branch there is no staging deploy
    # to wait for. main already built and deployed to staging before the merge.
```

### Promotion mechanics — the parts that bite

- **Auth is a deploy key, not a PAT.** Generate one
  (`ssh-keygen -t ed25519 -f prod_key -N ""`), register the **public** half on the
  production repo under Settings → Deploy keys with **write access ticked**, and store
  the **private** half as the `PROD_DEPLOY_KEY` secret in the staging repo. A deploy key
  is scoped to the one repo it is registered on, which a PAT is not.
- **Create the production repo completely empty** — no README, no `.gitignore`, no
  licence. Promotion is a fast-forward push; against an initialised repo it is rejected
  because the histories are unrelated. Recreate it empty, or do the first push by hand
  with `--force`.
- **Never `--force` the promotion push.** A rejection means the two histories diverged —
  someone committed directly to production. That is a signal to go and look, not
  something to overwrite.
- **`fetch-depth: 0`** on the promoting checkout. The default shallow clone cannot push.
- **Custom domains** need a `CNAME` written into the artifact before upload
  (`echo "example.com" > ui/dist/CNAME`), one hostname per repo. Without it the Pages
  deploy drops the domain.
- **One-time, per repo:** Settings → Pages → Source: **GitHub Actions**.
- The build targets are the app's own. Once the app has an online build, **staging
  deploys `make stg` and production `make prd` — both online** (see "Staging deploys
  the online build by default" above). Before a backend exists there is only the
  offline `make dev`, and both jobs run that until `stg`/`prd` targets actually exist —
  see the naming section below; don't add one just to have a production-sounding name.

## The app evolves — how many targets is per-project, but name them dev/stg/prd

There is **no fixed set of phases** here. An app starts as whatever it needs to be —
often just an in-browser localStorage build — and grows toward a backend, auth, and a
real deploy **gradually**, as the work demands it. The build reflects wherever the app
currently is, not a predefined ladder.

So treat *how many* build targets exist as **per-project and evolving** — but keep their
*names* predictable:

- **Prefer the `dev` / `stg` / `prd` names for whatever targets do exist** (in-browser dev
  build → staging → production against Supabase). The point is muscle memory: running
  `make dev` / `make stg` / `make prd` should be reliable without opening the Makefile to
  look up what a target is called. So don't invent app-specific names when one of these
  fits — but *do* still let the app decide how many targets it needs. A single-file
  in-browser app may only have `dev`; that's fine. Just don't scaffold `stg`/`prd` before
  the app reaches for them, and when they arrive, name them from this same vocabulary.
- **Flags are optional, not a convention.** If a build genuinely needs a variant (a
  readable vs. minified output, a test build), a flag is fine — but there is no standard
  flag alphabet to satisfy. Don't add `T/R/G/S`-style flag machinery preemptively.
- **The Makefile should contain exactly what the app needs right now — no more.** Add a
  target when the app reaches for it; don't scaffold empty stages ahead of need. When a
  target stops earning its place, remove it.

The through-line that *is* stable is the offline↔online split above: it's what lets a
single codebase serve both the zero-backend demo and the backend-backed production build,
and lets the app move between them without a rewrite.

## The online build: Supabase, or Go + Postgres

When an app grows past in-browser storage, the online paths target a real backend. The
move is incremental and touches only the code inside the `//online` markers — the offline
build keeps working throughout. Two backends, same `fetch` contract:

- **Supabase** (managed) — the `fetch(...)` calls inside `//online-start … //online-end`
  blocks talk to Supabase. **Data is private by default**: tables are RLS-on with no
  policies, so the publishable key can neither read nor write them. **Writes always go
  through a rate-limited edge function; reads do too — unless the table is deliberately
  public content** (e.g. a read-only catalogue), which may then be read straight from
  PostgREST. See the two subsections below. Persistence and later auth live in Supabase.
  Lower-effort; reach for it first when a managed Postgres is enough.
- **Go + Postgres** (self-hosted) — the same `fetch(...)` calls hit a **Go HTTP service**
  that owns a **Postgres** database. This is the **top of the ladder**: full control over
  the API and schema. Climb here last, **unless a Go service is specifically required**,
  in which case go straight to it. Run it locally with the Docker Compose stack (Go server
  + Postgres); Make targets bring the instances up for `dev`/`stg`.

In both cases only the online path changes — the offline build still runs entirely from
localStorage, so the GitHub Pages demo never needs a backend. Introduce a backend when the
app actually needs shared/persistent data, not at scaffold time, and keep the offline
build a first-class target after it lands. When you move to Postgres (Supabase or Go), the
documented CRUD models are what the schema is built from — another reason the README
models must stay exact.

### Data is private by default — open reads only for public content

**Treat everything in the database as sensitive unless proven otherwise.** The
default for every table is **RLS enabled with no policies**, which closes *both*
reads and writes to the publishable key — the browser can neither `SELECT` from it
nor write to it. Only the edge functions (service role) touch the data, and the
owner reads it in the dashboard. Form submissions, sign-ups, orders, metrics,
anything with a person's details: all stay closed. There is no "read-only is
harmless" — a public `SELECT` exposes every row to anyone with the URL.

**A public read policy is a deliberate, per-table exception, justified only when the
table holds content the site is *meant* to publish** — e.g. a product catalogue the
pages render for everyone (as in the wtl site). Such a table gets a permissive
`SELECT` policy and `SELECT` granted to `anon`, and is read straight from PostgREST
with the publishable key; it must carry **no private columns**, since the whole row
becomes world-readable. Everything else keeps the closed default and is reached only
through an edge function. When you add a `SELECT` policy, say in the README why that
table's contents are public.

```sql
-- Default (private): closed to the publishable key; edge function (service role) only.
ALTER TABLE contact_requests ENABLE ROW LEVEL SECURITY;   -- no policies → no public read/write

-- Exception (public content): explicit, read-only, non-sensitive rows.
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read" ON products FOR SELECT TO anon, authenticated USING (true);
```

### Writes go through a rate-limited edge function (default)

**Inserts do not go straight to PostgREST — they go through an edge function that
rate-limits them.** This is the default for any user-writable table (form
submissions, sign-ups, reactions, orders). The reason is that rate limiting is only
enforceable server-side: if the browser could `POST` straight to PostgREST with the
publishable key, it could bypass any limiter. So:

- **The table is RLS-on with *no* policies.** The publishable key can neither read
  nor write it (see "Data is private by default" above; a public read is the rare,
  deliberate exception).
- **An edge function is the only write path**, connecting as **service role**
  (`SUPABASE_SERVICE_ROLE_KEY`, injected automatically). It validates input, applies
  the rate limit, then inserts. Deploy it with JWT verification off
  (`supabase functions deploy <name> --no-verify-jwt`) since the browser calls it
  with only the publishable key; record that in `supabase/config.toml`.
- **The browser** `POST`s to `<url>/functions/v1/<name>` with the publishable key as
  a bearer token, inside the `//online` markers (stripped from the offline build,
  which keeps whatever local fallback the form had).

**Rate limiting** is counted in the database, not function memory (an edge function
runs as several stateless instances). Use a **fixed-window atomic counter**: one
`rate_limits` row per `(key, window)` bucket, incremented in a single statement so
concurrent requests can't race past the limit. Expose it as a `rate_limit_hit(key,
limit, window)` SQL function the edge functions call by RPC — it returns the verdict
plus `retry_after` for a proper `429` header:

```sql
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT NOT NULL, window_start TIMESTAMPTZ NOT NULL, count INT NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;   -- service role only

CREATE OR REPLACE FUNCTION rate_limit_hit(p_key TEXT, p_limit INT, p_window_seconds INT)
RETURNS TABLE (allowed BOOLEAN, remaining INT, retry_after INT)
LANGUAGE plpgsql AS $$
DECLARE v_bucket TIMESTAMPTZ; v_count INT;
BEGIN
  v_bucket := to_timestamp(floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds);
  INSERT INTO rate_limits (key, window_start, count) VALUES (p_key, v_bucket, 1)
    ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limits.count + 1
    RETURNING count INTO v_count;
  allowed     := v_count <= p_limit;
  remaining   := greatest(0, p_limit - v_count);
  retry_after := CASE WHEN v_count <= p_limit THEN 0
    ELSE ceil(extract(epoch FROM (v_bucket + make_interval(secs => p_window_seconds)) - now()))::INT END;
  RETURN NEXT;
END; $$;
REVOKE ALL ON FUNCTION rate_limit_hit(TEXT, INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rate_limit_hit(TEXT, INT, INT) TO service_role;
```

The function **fails open** — if the limiter itself errors, allow the request rather
than block real users over a transient DB problem. (A simpler row-per-hit sliding
window — one row per request, counted over the trailing window — also works, but it
has a count-then-insert race and grows a row per request; prefer the atomic function.)

Key each request under the caller's **IP and their session token** — `<action>:<ip_hash>`
and `<action>:sess:<token>` — so one browser is capped even behind a shared IP, and a
rotated token can't reset the IP's allowance (the token is the browser's `sessions.token`,
available client-side before any session row exists — never the surrogate `session_id`):

- **IP** — never store the raw IP. Hash it (`SHA-256` with an `IP_HASH_SALT` secret,
  the **same salt across all functions**) and use it in the key.
- **Session token** — a random `crypto.randomUUID()` the client keeps in
  `localStorage` and sends with every write. Store it on the row too (nullable, no FK)
  as a soft link.

Add cheap **spam protection** in the same function: a hidden **honeypot** field (bots
fill it → return success, store nothing) and per-field validation (required, email
format, length clamps). See the app-side reference implementation in
`supabase/functions/` and `db/` of a repo that has one.

Lay the back-end out like the other repos: `db/NNN_*.sql` for schema, one
`supabase/functions/<name>/index.ts` per function, `supabase/config.toml` for
`verify_jwt`, and a `supabase/README.md` with the setup steps (run SQL, deploy
functions, set `IP_HASH_SALT`, fill the URL + publishable key).

### The `env` column — tag every row with its build

Staging and production deploy online by default (above) and write to the **same**
backend, so **every interaction table carries an `env` column** to keep the two apart.
Make it `env SMALLINT NOT NULL CHECK (env IN (0, 1))` — **`0` = staging, `1` = production**
— and document it alongside the other columns in the README. (A compact integer flag,
not a string: it's the same two-way tag on every table, so keep it small and uniform.)

**The edge function sets it**, two ways in order of preference:

1. **From the request origin**, where staging and production have distinct hostnames
   (`https://app.example.com` → `1`). This is server-authoritative and the client can't
   spoof it.
2. **From a build stamp**, where the two share an origin (e.g. GitHub Pages path-based
   staging). The online config in `layout.js` carries a variable (e.g. `DB_ENV`)
   defaulting to `1` (production); the browser sends it and the function trusts it as a
   fallback. The `prd` target keeps the default; the `stg` target rewrites it with a
   one-line `sed` on the composed output — the same mechanism `dev` uses to strip
   `//online` code:

   ```make
   stg:
   	$(call compose,$(SRC),$(MAP),$(BUILD_DIR)/index.html)
   	@sed -i 's/\(var DB_ENV *= *\)1/\10/' $(BUILD_DIR)/index.html
   ```

Then reads filter by build: `where env = 1` excludes staging traffic; `= 0` shows only
it. (The offline `dev` build strips the online path
entirely, so no row is ever written from it.)

### Schema conventions — keep table & column names identical across repos

The backend schema is meant to be **portable**: the same tables and column names
recur in every app built this way, so when you copy this skill (and the `db/*.sql`
files) into a new repo, keep the shared shapes **byte-for-byte identical** and only
add site-specific tables around them. That way one mental model — and one set of
dashboard queries — works everywhere.

**Column-naming rules (every table follows these):**

- **`snake_case`** for all identifiers; **plural** table names (`enquiries`,
  `sessions`, `page_views`); index names are **`<table>_<column>_idx`** (add
  `_desc` intent via the index definition, not the name).
- **Primary key** — **every** table uses a surrogate `id BIGSERIAL PRIMARY KEY`,
  `sessions` included. Natural identifiers (like a browser token) are separate
  columns with their own `UNIQUE` constraint, never the PK — so foreign keys are
  always a compact `BIGINT`, uniform across the schema.
- **`env SMALLINT NOT NULL CHECK (env IN (0, 1))`** — **`0` = staging, `1` = production**
  — on **every interaction table** (each row is self-describing without a join). Set it
  in the edge function, never trust it blind from the client. (See the `env` column
  section above.) *Not* on pure infrastructure tables like `rate_limits`, whose key is
  its identity and which is deliberately shared across builds.
- **`created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`** — the row-audit timestamp, on
  every **insert-once** table (`enquiries`, `page_views`, …). Index it `DESC` for
  anything the owner reads newest-first (`CREATE INDEX … ON t (created_at DESC)`).
- **Activity timestamps** — where a row is *seen repeatedly* (like a session), use a
  **`first_seen` / `last_seen`** pair **instead of** `created_at`: both
  `TIMESTAMPTZ NOT NULL DEFAULT NOW()`, set together on insert, but **only `last_seen`
  is bumped** on return activity, so `first_seen` stays pinned to the first sight. The
  pair supersedes a row-audit `created_at` on such tables — `sessions` carries
  `first_seen`/`last_seen` and **no `created_at`** (its first-sight time *is*
  `first_seen`).
- **`session_id BIGINT`** — the reference to a session, **always this exact name**,
  pointing at `sessions(id)` (see the reference rule below). The browser's own random
  identifier is **`sessions.token UUID` (`UNIQUE NOT NULL`)** — the value the client
  holds in `localStorage` and sends up; the function looks the session up by `token`
  and stores/returns its `id`. Never expose the surrogate `id` to the client, and never
  reference a session by `token`.
- **`ip_hash TEXT`** — a **salted SHA-256** of the caller's IP. The raw IP is never
  stored in any table; it's used transiently for geo + as a rate-limit key.

**The shared tables are canonical — copy them unchanged.** These three carry no
site-specific meaning, so they should be **identical in every repo**:

- **`rate_limits`** + the `rate_limit_hit(...)` function — copy verbatim (see the
  rate-limit section above). Same columns, same function signature, everywhere.
- **`sessions`** — the hub, one row per browser (`token` is the client-facing identity,
  `id` is what every other table references):

  ```sql
  CREATE TABLE IF NOT EXISTS sessions (
    id             BIGSERIAL    PRIMARY KEY,
    token          UUID         NOT NULL UNIQUE,       -- browser's localStorage identifier
    env            SMALLINT     NOT NULL CHECK (env IN (0, 1)),
    ip_hash        TEXT         NOT NULL,
    country        CHAR(2),               -- ISO 3166-1 alpha-2; NULL if unknown
    continent      CHAR(2),
    city           TEXT,
    latitude       DOUBLE PRECISION,      -- city-level
    longitude      DOUBLE PRECISION,      -- city-level
    timezone       TEXT,                  -- IANA
    asorg          TEXT,                  -- ISP / network (bot-filtering signal)
    user_agent     TEXT,
    first_seen     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),  -- first sight; set once, never bumped
    last_seen      TIMESTAMPTZ  NOT NULL DEFAULT NOW()    -- bumped on every return visit
  );
  ```

- **`page_views`** — one row per load, referencing a session:

  ```sql
  CREATE TABLE IF NOT EXISTS page_views (
    id             BIGSERIAL    PRIMARY KEY,
    env            SMALLINT     NOT NULL CHECK (env IN (0, 1)),
    session_id     BIGINT       NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    page           TEXT         NOT NULL DEFAULT '/',
    referrer       TEXT,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
  );
  ```

**Site-specific tables — the rules.** Whatever a given app adds (orders, bookings,
comments, …) follows the same conventions plus one hard rule:

1. **Every interaction row references a session — always.** Carry
   `session_id BIGINT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE`, so any row is
   attributable to the browser that created it (join back to `sessions` for geo,
   first/last seen, user agent; dedupe or rate-limit by browser; the session's deletion
   cascades). **This is possible for every table** — including ones that can arrive
   *before* a page-view beacon, like a contact form — because the write already goes
   through an edge function: the function **resolves the session first** (look it up by
   `token`; create a minimal row if this is the browser's first write), gets its `id`,
   then inserts the interaction row with that `session_id`. So there is no nullable
   "soft link" any more — the reference is mandatory everywhere, and the function's
   job is to make sure the session exists before it writes.
2. **Carry `env` and `created_at`** (rules above).
3. **RLS on, no policies** — private by default; the edge function (service role)
   is the only write path. The sole exception is deliberately public content (e.g. a
   read-only catalog), which gets a `SELECT` policy — see "Data is private by default".
4. **All user-supplied fields are `TEXT`** unless there's a real reason otherwise
   (forms are free-text); validate/clamp lengths in the edge function, not the schema.

### Anonymous page-visit tracking

When an app wants to know its traffic, add tracking the same way — an edge function
is the only write path, so it stays private and rate-limited. The online build fires
a **fire-and-forget beacon on every page load**; the offline build strips it, so the
demo sends nothing.

Two tables, both **RLS-on with no policies** (analytics are private — the owner reads
them in the dashboard):

- **`sessions`** — the hub, one row per browser. Surrogate `id` PK; the browser's
  random `crypto.randomUUID()` value lives in the `token` column (`UNIQUE`), held in
  `localStorage` and **reused for every write**, so the function can find the session
  and stamp its `id` onto each interaction row. It also carries the salted `ip_hash`,
  the `env`, the user agent, and coarse geolocation. A **`first_seen`/`last_seen`** pair
  brackets the browser's activity: both default to `NOW()` on insert, but only
  `last_seen` is bumped on return visits, so `first_seen` stays pinned to the first
  sight. There is **no `created_at`** on `sessions` — the first-sight time *is*
  `first_seen`.
- **`page_views`** — one row per load, `session_id` referencing `sessions(id)`
  (`on delete cascade`), plus its own `env`, `page`, and `referrer`.

The **`track-visit`** function (service role), in order:

1. **Drop bots up front** by User-Agent (a denylist of `bot|crawl|spider|headless|…`
   plus named crawlers and link-preview unfurlers) — return `200 {ok:true,bot:true}`
   so the beacon doesn't retry, and record nothing. This is **metrics-only**: the site
   is static Pages, so crawlers still load every page and **SEO is unaffected**.
2. **Rate-limit** by hashed IP via `rate_limit_hit` (above), e.g. 60/min. Fail open.
3. **Geolocate once, on first sight only** — look up the raw IP (ipapi.co, free/no key,
   with a ~2s timeout; best-effort, all fields nullable) *only* when inserting a new
   session; a returning session just bumps `last_seen`. Never geolocate on every visit —
   that burns the lookup quota for no new information.
4. **Resolve the session, then insert the page view.** Look the session up by `token`:
   insert it (returning its `id`) on first sight, else bump `last_seen`; then insert the
   page view with that `session_id`. The raw IP is used only in memory (geo + rate-limit
   key); only its salted hash is ever stored.

Client beacon (inside `//online`, so `dev` strips it) — send the browser's `token` and
the numeric `env`:

```js
fetch(SUPABASE_URL + "/functions/v1/track-visit", {
    method: "POST", keepalive: true,
    headers: { "Authorization": "Bearer " + SUPABASE_ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ token: sessionToken(), env: DB_ENV,
                           page: location.pathname, referrer: document.referrer || null })
}).catch(function () {});   // never blocks or affects the page
```

Keep session identity to **the token alone** (one browser = one session, simplest key)
by default. Where sessions also anchor sensitive records (e.g. orders) or you want
per-network granularity, match on `(token, ip_hash)` instead — the same token from
a new network then starts a new session. Either way the token is only ever the lookup
key; other tables always reference the resolved `sessions.id` via `session_id`.

## When scaffolding a new app

1. Copy `runtime/reactivity.js` → `ui/reactivity.js` and `runtime/tpl.mk` → `make/tpl.mk`
   (or submodule this kit and reference them — see the kit README).
2. Create `ui/layout.html`, `layout.css`, `layout.js` with the placeholder tokens.
3. Add `make/web.map` and a `Makefile` that `include make/tpl.mk` and calls
   `$(call compose, …)` for html/css/js, plus an offline build target that `sed`-strips
   the online blocks. Add only the targets the app needs — see "The app evolves" above.
4. Get the CRUD models from the user, **document them in the README** (hard rule above),
   and add a `ui/demo.js` seed that populates each model's localStorage key — wired into
   the `dev`/`stg` builds only, never `prd`.
5. Add one file per component under `ui/comps/`.
6. Build with `make`; deploy `ui/dist/` as static files.
7. Add `.github/workflows/pages.yml` to build the offline demo and publish it to GitHub
   Pages on every push — see "Deploying the demo to GitHub Pages" above.

Keep the **frontend** dependency-free. If a task tempts you toward a JS framework, a
bundler, or an npm runtime dep, stop — the whole point of this style is that the frontend
output is one static file and its toolchain is `make` + `awk` + `sed`. (This is a
frontend rule; the backend legitimately uses Go, Postgres, and Docker Compose — see "The
tech stack".)
