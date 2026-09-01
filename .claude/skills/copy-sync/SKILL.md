---
name: copy-sync
description: Check, compare, or update the Victim2Victor site copy against its Google Docs source of truth. Use when the user asks to check/compare/verify/sync/update copy, text, wording, or content on the site (hero, purpose, workshop, testimonials, about, founder, contact, or the footer) — the Google Doc is authoritative; the HTML in ui/ is the target.
---

# Copy sync — Google Doc → website

The user writes and maintains the site copy in a **Google Doc** (the source of
truth). This skill maps that doc to the repo's HTML and helps
**check / compare / update** the copy.

Direction is **Doc → site**. Edit the site to match the doc, never the reverse,
unless the user explicitly asks to update the doc.

## 1. Find and read the doc

The copy lives in a **single** Google Doc — the whole site in one file:

- **Folder:** `Victim2Victor` (in the user's Drive)
- **Doc title:** `WebsiteCopy`

Locate it with the Google Drive tools, then read it with `read_file_content`:

- Find the folder: `search_files` with
  `title = 'Victim2Victor' and mimeType = 'application/vnd.google-apps.folder'`.
- List its contents: `search_files` with `parentId = '<that folder id>'`, and
  pick `WebsiteCopy`.

No file id is recorded here yet — **once you resolve it, add it to this file**
so later runs can skip the search. If the search returns nothing, the doc has
not been shared with the connected Drive account; tell the user rather than
guessing at another file.

## 2. Doc section → target mapping

The site is **one page**, composed by `make` from partials in `ui/comps/`. Each
top-level section of the doc maps to one partial:

| Doc section | Target |
|---|---|
| hero / masthead | `ui/comps/hero.html` (`<section class="hero" id="top">`) |
| purpose statement | `ui/comps/purpose.html` |
| workshop | `ui/comps/workshop.html` (`id="workshops"`) |
| testimonials | `ui/comps/testimonials.html` (`id="testimonials"`) |
| what makes us different | `ui/comps/different.html` |
| about | `ui/comps/about.html` (`id="about"`) |
| founder | `ui/comps/founder.html` |
| contact | `ui/comps/contact.html` (`id="contact"`) |
| footer | `ui/comps/footer.html` |
| nav labels | `ui/comps/header.html` |
| page title, meta description, og: tags | `ui/layout.html` |

Match a doc section to its partial by its heading and eyebrow text — each
section carries a `.eyebrow` line (`Our Purpose Statement`, `Upcoming Workshop`,
`Testimonials`, `Why Victim2Victor`, `Who We Are`, `Our Founder`, `Contact`) and
an `<h2>`. If the doc names a target explicitly (a `File:` or `Page:` field),
that wins.

Edit the source files in **`ui/`** — never `ui/dist/` (that folder is generated
by `make dev`). The nav and footer link to the section `id`s above; if a doc
section is renamed, check whether its `id` and the matching nav link still line
up.

### Images — copy new ones out of Drive

Images live in the **same `Victim2Victor` Drive folder** as the doc, and in the
repo under **`ui/img/`**, referenced as `src="img/<name>"`.

When the doc references an image (an `IMAGE` block, a `file:<name>` line, or a
filename named in a field), check whether `ui/img/<name>` already exists:

- **It exists** → nothing to copy. Confirm the reference in the HTML points at
  it and move on.
- **It does not** → find it in the Drive folder (`search_files` with the folder's
  `parentId` and the file's title), download it, and write it to
  `ui/img/<name>`. Then point the referencing element at `img/<name>` and give
  it a meaningful `alt`.

Rules for bringing an image across:

- **Keep the Drive filename**, lowercased with hyphens for spaces. Don't invent
  a new name — the doc refers to it by that name.
- **Never overwrite** an existing file in `ui/img/` with different content. If
  the names collide, ask; the site's asset may be a deliberately optimised
  version of the same picture.
- **Web formats only.** `.webp`, `.jpg`, `.png`, `.svg` go straight in. Anything
  else (`.heic`, `.tiff`, a PDF, a Google Drawing) needs converting first — ask
  before converting.
- **Flag heavy files.** If the original is over ~500 KB, say so and offer a
  resized/WebP version rather than silently shipping it. Note the existing
  `hero-couple.jpg` is already 1.1 MB.
- **Don't delete.** An image that disappears from the doc is a discrepancy to
  report, not a file to remove.

The Makefile picks images up by wildcard (`IMGS := $(wildcard ui/img/*)`) and
copies them into `ui/dist/img/`, so a new file in `ui/img/` makes the build
out of date on its own — just run `make dev`. Never put an image in `ui/dist/`.

## 3. What is copy vs. what is a marker

**Prose paragraphs → verbatim.** A plain block with no `Label:` prefix, not
wrapped in `%…%`, and not an author note is body copy. It must appear
**word-for-word** in the target. Report any drift, however small — a changed
preposition or a dropped word counts.

Everything below is **structure / instruction** — map its value to the right
slot; don't treat the marker itself as literal text:

- **Field lines `Label: value`** — structured copy for one slot. The **label**
  is structural; only the **value** is content. Expect at least
  `Eyebrow:` → `<span class="eyebrow">`, `Heading:` → the section `<h2>`,
  `Title:` → the hero `<h1>`, `CTA:` → a `.btn` label.
- **`%…%` inline instructions** — e.g. `%emphasize X%` / `%emphasise X%` wraps X
  in `<em>` in that slot. Note the author uses both spellings across his sites.
- **Author notes** — an aside to self, in `%% … %%` or single `% … %`.
  **Ignore** them; they are neither copy nor emphasis.
- **`!!!remove`** (sometimes exported escaped, `\!\!\!remove`) — the line or
  element is **not live**: don't render it, and if it is currently in the HTML,
  that's a discrepancy to flag.
- **Block markers** (a bare all-caps word on its own line, e.g. `SECTION`,
  `CARD`) — start a component rather than a paragraph. A `class:` / `Class:`
  line after one names the CSS class; treat the label case-insensitively.
- **`IMAGE` + `file:<name>`** — an image in `ui/img/`, e.g. `file:founder.jpg`
  → `<img src="img/founder.jpg">`. No prose to match; make sure the asset is in
  the repo, copying it out of Drive if it isn't (see §2).
- **`<ref …>`** — a link or cross-reference. **Its exact form is not yet
  confirmed for this doc** and it means different things on the user's other
  sites; ask rather than assuming.
- **`**bold**`** — markdown bold, used for sub-headings. Maps to the
  corresponding `<h3>`/`<h4>`/`<strong>`, not literal asterisks.
- **Markdown `#` headings** — section structure (see §2), not literal headings.

This doc's dialect has **not been verified yet**. The list above is the
vocabulary the author uses on his other sites; on the first run through
`WebsiteCopy`, confirm which of these actually appear and correct this section.

## 4. Workflow

- **Check / compare:** read the doc and the mapped partial(s). Walk the doc top
  to bottom; for each paragraph confirm a verbatim match, for each field confirm
  the value sits in the right slot. Produce a discrepancy list: missing copy,
  drifted wording, extra site text not in the doc, or an element the doc marks
  `!!!remove` that is still live. Also list any **referenced image missing from
  `ui/img/`**, and any image in `ui/img/` no longer referenced by the doc.
- **Update:** apply the doc's copy to the target. Preserve the surrounding markup
  and the conventions above — only the copy changes. Match prose verbatim; place
  field values in their slots. Copy any newly referenced image out of the Drive
  folder into `ui/img/` (see §2). Afterwards run `make dev` and confirm
  `ui/dist/index.html` rebuilds cleanly and that new images landed in
  `ui/dist/img/`.

## 5. Ask when unsure

The user explicitly wants to be asked rather than guessed at. Ask when:

- A doc section has no clear target partial, and there's no `File:` / `Page:`.
- A marker or block you haven't seen before appears, or its intent is ambiguous
  — including any `<ref …>`, until this doc's form is pinned down.
- The doc reorders or removes a section (which may also mean a nav link and a
  section `id` need changing).
- Copy exists on the site but not in the doc — delete it, or keep it?
- A field value seems to belong to a slot that doesn't exist on the page.
- A referenced image isn't in the Drive folder, or more than one file there
  could plausibly be it.
- Copying an image in would overwrite a different file of the same name, the
  original needs format conversion, or it's large enough to want optimising.
