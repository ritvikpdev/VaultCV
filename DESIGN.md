# vaultCV — Design Document

Written for whoever picks this up cold — most likely me, months from now. It
covers what the project is, why it's built the way it is, what's finished, and
what isn't. The odd decisions get an explanation, because without one they look
like mistakes and get "fixed" back into the problems they were solving.

For how to install and run it, see `README.md`. For the rules a coding agent
must follow when changing it, see `CLAUDE.md`.

---

## 1. The problem

Tailoring a resume to a job is mostly retyping. You keep several versions in
different files, each a slightly stale fork of the others, and every new
application means hunting for the version closest to the role and editing it
by hand. Facts drift apart across copies. Good bullets get lost in a document
you stopped opening.

vaultCV separates the two things that were tangled together:

- **The vault** — every career fact, entered once. Jobs, projects, degrees,
  skills, the bullets you've written. This is the master record.
- **A resume** — a selection from the vault, arranged and styled for one
  application. Compositions, not documents.
- **The tuner** — reads a job description and recommends which vault content
  to surface, hide or reorder for this specific role.

It started local-first — one machine, one SQLite file — and is now hosted and
invite-only, so a few friends can use it and it works from any device. §3a
covers that move and why it took the shape it did.

---

## 2. Why v1 failed, and what that forced

There was an earlier attempt. It reached a demoable state and then became
unusable. Understanding why is the shortest route to understanding this
codebase, because most of its unusual decisions are direct responses.

**Three causes, three permanent rules.**

### Matching depended on generated embeddings

Every bullet needed a vector computed by a local Ollama model before it could
be matched. Bullets that hadn't been embedded — new ones, or any if the model
server was down — silently vanished from results. The headline feature showed
an empty screen and gave no reason.

> **Rule: no embeddings, no vector search, no cosine similarity.** Matching is
> deterministic keyword and alias lookup (`src/lib/skill-aliases.ts`), which an
> AI call may refine afterwards. It must always return results with no API key
> and no precomputation step.

### A small local model did structured extraction

`llama3.2` was asked to turn job-description prose into structured JSON. It
couldn't do it reliably, so a regex fallback was bolted on — and that fallback,
which nobody had designed, became the path that actually ran.

> **Rule: no AI provider may ever be load-bearing.** The deterministic parser in
> `src/lib/jd-parse.ts` is the primary path and always runs. A provider only
> refines its output. A provider returning null is a normal outcome that every
> caller handles.

*Amended later:* this rule originally read "no Ollama at all." That was right
for v1's shape, where a small model sat on the only path. With deterministic
parsing primary and every provider optional and schema-validated,
`src/lib/ai-provider.ts` now supports Anthropic, Gemini and Ollama
interchangeably — a free option was needed. The prohibition that still stands
absolutely is the one above: nothing may depend on a model replying.

### The tuner was a separate app from the editor

`/tuner` had its own "Working Document" that duplicated the resume editor. Two
data paths, two renderers, guaranteed drift.

> **Rule: Tune is a tab inside `/resume/[id]`**, alongside Content and
> Customize. One resume model, one preview component, one renderer. No
> standalone tuner route.

**The theme.** Every one of these was a silent failure — nothing crashed, the
app just quietly did less than it appeared to. So the standing bias here is:
degrade with an explanation, never fail invisibly.

---

## 3. Architecture

Next.js 15 App Router, React 19, Postgres (Supabase) through Drizzle, deployed
on Vercel. Server Components read the database directly; mutations are Server
Actions next to the route that uses them. There is no API layer between the UI
and the data, because there is no second client to serve — the exceptions are
`/api/my-data` (a JSON download) and `/api/health`.

It was built bottom-up: the vault before the resume editor, the editor before
the tuner. That order was deliberate, not incidental — each layer had real
content from the one below it to work against, so nothing was ever verified only
against fixtures. Every parser bug and scoring flaw in this codebase was found
by running it on actual résumés rather than by a test passing.

```
src/
  db/
    schema.ts        every table — the only source of truth for structure
    client.ts        postgres-js pool + runAsUser: one transaction per request, as that user
    session.ts       getSessionUser / withVault — the entry point to all data
    ai-config.ts     the signed-in user's provider and decrypted key
    bootstrap.ts     idempotent first-sign-in seed, settings key/value helpers
    queries.ts       vault reads
    resume-queries.ts resume reads, including the snapshot/linked resolve rule
  lib/
    jd-parse.ts      deterministic job-description parsing (primary path)
    tuner.ts         scoring and recommendations — no AI at all
    ai-provider.ts   optional Anthropic / Gemini / Ollama, all interchangeable
    skill-aliases.ts the taxonomy that makes keyword matching work
    skill-index.ts   turns a written skills line into matchable terms
    heuristic-parse.ts  resume parsing for import
    pdf-extract.ts   text out of PDFs, by glyph coordinates
    word-split.ts    repairs PDF text that lost its spaces
    resume-blocks.ts the renderer's atoms, shared by preview and print
    use-sortable.ts  hand-rolled drag-and-drop
    reorder.ts       pure ordering arithmetic (tested)
    secret-box.ts    AES-GCM for users' AI keys
    supabase/        server and admin (service-role) clients
  middleware.ts      session refresh, sign-in redirect
  app/
    page.tsx         My Resumes
    vault/           the master vault
    resume/[id]/     editor — Content, Customize, Tune tabs
    print/[id]/      what the browser prints for PDF export
    settings/        profile, AI key, link mode, password, data download, delete
    admin/           invite links, reset links, delete users (ADMIN_EMAIL only)
    login/ auth/     sign-in, invite/reset landing, set password
```

### Decisions worth knowing

**`schema.ts` is the only source of truth for structure.** Tables come from
`npm run db:push`. There are no hand-written migrations to drift from it. The
`drizzle/` folder is generated for tests and is gitignored.

**The database handle is a lazy, scope-bound Proxy.** `next build` imports every
route module to collect page data; a connection opened at import time would make
building depend on a reachable database. The Proxy also refuses to work outside
`runAsUser` — see §3a.

**Preview and PDF share one renderer.** `ResumeDocument` is mounted by both
`/resume/[id]` and `/print/[id]`; the browser prints the latter. A second
renderer for export would reintroduce exactly the drift v1 died of.

**Pagination is measured, not estimated.** A hidden pass measures each block's
`offsetHeight` and splits pages on the same atoms Chrome will. Two subtleties
made this hard: margins collapse out of measuring wrappers unless they use
`display: flow-root`, and `getBoundingClientRect` returns post-transform sizes
inside a scaled preview, so every block measured 28% short.

**Single column, standard headings.** Two-column and mixed layouts are
deliberately out of scope — they parse badly through ATS and multiply the
renderer's complexity.

**Bullet strength is not job relevance.** `bullet-strength.ts` scores writing
quality — action verbs, metrics, length — locally and with no AI. Relevance to
a particular job is the tuner's separate concern. Merging them would produce a
number that means neither thing.

---

## 3a. Going hosted

**Why.** Friends wanted to use it, and Ritvik wanted it on every device. The
local-first version synced machines through a git-tracked SQLite snapshot —
one machine at a time, with conflicts that could only be resolved by losing one
side.

**The plan that was rejected** kept offline editing: a local Next.js + SQLite
install per person plus a sync server exchanging whole database files with a
revision number. It solved syncing but not the actual barrier for friends —
every one of them would still need Node, a native SQLite build and Chromium.
Most of its complexity (swapping database files on login, unsigned edits,
offline first-login) served cases that wouldn't occur. Dropping offline editing
collapsed all of it into "host it once".

**The shape it took.** One Vercel deployment, one Supabase project, both free.
Postgres holds everyone's vaults in the same fifteen tables, each row carrying
`user_id`. A separate SQLite file per user was the first idea; it doesn't
survive serverless hosting, which has no persistent disk.

**Isolation is the database's job.** Every table has a row-level-security
policy: rows are visible and writable only when `user_id = auth.uid()`. Every
request runs inside `runAsUser`, one transaction that switches to Supabase's
`authenticated` role and sets the JWT claims `auth.uid()` reads. The upshot:

- the existing queries — which load whole tables and group in memory — needed
  no `where user_id` added; Postgres filters before a row leaves the database;
- inserts never name `user_id`; the column default stamps it;
- an id guessed from another account matches nothing, rather than relying on
  every action to check ownership;
- the `db` Proxy throws outside a scope, so a forgotten wrapper fails loudly
  instead of quietly querying as nobody — or everybody.

RLS is not optional on Supabase: the publishable key ships to every browser and
can query any table without a policy. The schema tests fail if any table lacks it.

**What else changed with it.**
- *Async everywhere.* better-sqlite3 was synchronous; postgres-js isn't. Every
  query gained an `await`; loops of inserts became single multi-row inserts.
- *PDF export moved to the browser.* Puppeteer can't run comfortably on free
  serverless. The Download button prints `/print/[id]` through the browser's
  own engine — the same Chrome engine Puppeteer drove, same renderer, same
  real-text output for ATS. Zero `@page` margins reproduce Puppeteer's settings
  and suppress the browser's header and footer.
- *AI keys are per user*, encrypted in that user's settings. An environment key
  would have billed one person for everyone.
- *Accounts are invite-only.* Signup is off in Supabase; `/admin` generates
  one-time invite and reset links, so nothing depends on email being set up.
- *Slow calls stay outside the transaction.* `runTune` and the import parser
  fetch the user's AI config in one short scope, call the model with no scope
  open, then write in a second — a transaction shouldn't hold a pooled
  connection for a minute while a model thinks.

**Costs, stated plainly.** No offline editing. The operator can read everyone's
data in the Supabase dashboard, and can recover saved AI keys from the server's
secret — friends should know both. Supabase free pauses after a week idle and
has no backups; a nightly GitHub Action dump covers both.

---

## 4. The data model

Fifteen tables in four groups. Every arrow is a foreign key with
`ON DELETE CASCADE`. Every table also carries `user_id`, cascading from
`auth.users`, so deleting an account deletes everything in it.

**Vault (master record)**
`vault_groups` → `vault_sections` → `vault_entries` → `vault_bullets`, plus
`vault_skills`.

**Resume (compositions)**
`resumes` → `resume_sections` → `resume_entries` → `resume_bullets`, plus
`resume_skills` and `resume_styles`.

**Tuner** — `job_descriptions`, `tune_runs`.
**App** — `profile`, `settings`.

### Three things about it that look wrong and aren't

**The vault has no predefined sections.** `vault_sections` rows are created and
named entirely by the user. The only structural distinction is `type` — `normal`
(dates, organisation, bullets) versus `skill` (a label plus sub-skills) —
because that genuinely changes an entry's shape. An earlier version imposed
Career / Credentials / Personal plus a closed list of section types, which
decided for the user how their own history should be filed.

**Skills are entries, not their own table.** A skill entry is one resume line:
the title is the label ("Languages"), and `information` holds the sub-skills.
`vault_skills` still exists but is a *derived index*, rebuilt from that text on
every save by `skill-index.ts`, never edited by hand and never shown. It exists
so the tuner can answer "do you have Kubernetes?" without searching prose.

**`source_*_id` columns are kept even though the app runs in snapshot mode.**
`resume_bullets.source_bullet_id` and `resume_entries.source_entry_id` record
where content came from, even though the copied `text` is currently what
renders. They cost one integer each and they buy two things: linked mode becomes
a read-time rule instead of a migration, and the tuner can tell "already on this
resume" from "available in the vault." Deleting them as dead weight would be a
mistake.

---

## 5. The tuner

This is the feature the whole app exists for, and it is almost entirely
deterministic. **AI touches exactly one step.**

1. **Parse the job description** — `jd-parse.ts` finds bulleted requirement
   lines, reads markers ("required", "must have" versus "preferred", "nice to
   have"), flips defaults under headings like *Requirements* or *Preferred
   Qualifications*, skips *About Us* and *Benefits*, and matches technology
   names against the alias taxonomy. This always runs.

2. **Optionally refine it** — if a provider is configured, the text is sent for
   a cleaner requirement list, validated against a schema. Returning null is
   normal and the deterministic result stands. Section weighting stays
   deterministic even when this succeeds.

3. **Score and recommend** — `tuner.ts`, no AI. Term overlap weighted by term
   length, so "container orchestration" counts more than "apis". A hit on a
   known technology floors the score at 0.7; prose requirements score
   proportionally. Must-haves count ×1, nice-to-haves ×0.6. Multi-requirement
   coverage adds up to +0.2, writing quality ±0.06 as a tiebreaker, then
   multiplied by a section weight derived from the heading text.

Output is an **advisory diff**, never an auto-generated resume. Each row states
the change, which requirement it covers, and has Apply and Dismiss.
Recommendation types: `ADD_BULLET`, `ADD_ENTRY`, `ADD_SKILL` (from the vault, or
from evidence found in your own bullet text), `REMOVE_BULLET` (only above 12
bullets — on a short resume, cutting an irrelevant bullet isn't an improvement),
and `REORDER`.

**The tuner reads both sides, asymmetrically.** Your *resume* is scanned to
decide what a job description already covers. Your *vault* is the supply of
things it can suggest adding — it can't recommend Kubernetes unless Kubernetes
is somewhere to be found.

---

## 6. What vaultCV does

Everything below is built and working.

### The vault

- **Groups and sections you define yourself.** Groups are the top level ("Work
  Experience", "Skills") and every section sits in one ("SDE Experience",
  "Web Dev Skills"); both are named by you. Wherever a vault item appears
  outside the vault — the resume's vault picker, entries pulled into a resume,
  tuner suggestions — it is labelled "Group → Section". The only structural
  choice is `normal` (dates, organisation, bullets) versus `skill` (a label
  plus sub-skills).
- **Entries and bullets** with dates, organisation, location, subtitle, and
  per-section extra fields. Bullets can be pinned so the tuner always favours
  them. A section shows its entries as a grid of tiles; opening one slides in a
  panel where every field edits in place and saves itself — no forms, no Save
  button. Skill lines edit as chips.
- **An overview** as the vault's front page: totals, a bullet-strength
  breakdown, a "needs attention" list (empty entries, weak bullets, missing
  dates) linking straight to each item, and every skill in one cloud.
- **Bullet strength scoring** — action verbs, quantification, length, passive
  voice — computed locally with no AI, shown as a five-segment meter with the
  specific reasons it scored that way.
- **Skill entries** that read as one resume line ("Languages — Java | Python |
  C#"), automatically indexed into individual matchable technologies behind the
  scenes.
- **Search** across bullet text, entry titles, organisations, sub-skills and
  tags.
- **Move an entry to another section** through a picker, with a type guard that
  refuses `normal`↔`skill` moves in the server action as well as the UI.
- **Drag to reorder** groups, sections, entries and bullets. Sections can be
  dragged between groups to file them.

### The resume editor

- **FlowCV-style Content tab.** A list of cards — personal details, one
  collapsible card per section with draggable entry rows and an eye to hide an
  entry from this resume while keeping it — and an editor view that replaces
  the list when you open an entry. No Save button: the live preview updates on
  the same frame as you type, and changes save themselves.
- **Rich-text descriptions** with bold, italic, underline, links, alignment and
  paragraph lines, where each line is still its own bullet with its own vault
  link, strength score and visibility.
- **Pull from vault everywhere you add content:** whole entries from a
  section's footer, single bullets from inside the entry editor, and
  save-to-vault for entries and bullets written on the resume.
- **Masked MM/YYYY dates** with a month/year picker and "Present".
- **Per-section customizations** (title order, title line style, skills
  layout) and editor icons for sections.

### Import

- **PDF or pasted text.** Text is extracted from glyph coordinates rather than
  trusting the PDF's own spacing, so tightly-kerned LaTeX templates survive.
- **Glued-text repair.** Some templates position words with no space characters
  at all; Viterbi segmentation over a 26,000-word frequency list recovers them —
  `GeorgeWashingtonUniversity` becomes three words.
- **Review before writing.** Everything parsed appears as checkboxes with target
  sections. Nothing reaches the database unseen.
- **Merge by heading**, so re-importing doesn't duplicate sections.
- **Near-duplicate detection** on import, by Jaccard overlap — it flags "you
  probably already have this" for you to confirm, and never skips silently.

### Resumes

- **Compose from the vault** or type entries and bullets directly. Anything
  typed manually offers to save itself back to the vault.
- **Live preview with real page sheets** — measured, not estimated, so the page
  break you see is the one the PDF produces.
- **Customize:** font family and size, line height, spacing between sections,
  entries and bullets, margins in millimetres, page size, heading style, heading
  colour, date position, subtitle style.
- **Section order, visibility and page breaks** in one draggable list. Hiding a
  section keeps its content.
- **Manual skill categories** — build "AI & LLM — Claude | Cursor | Large
  Language Models" by hand instead of only pulling from the vault, with an offer
  to add the new skills back so the tuner learns them.
- **One-click compaction** that tightens whitespace before type size, when the
  resume is spilling onto another page.
- **PDF export** through the browser's print engine, rendering the same
  component as the preview.

### The tuner

- **Paste a job description**, get an advisory diff — bullets to surface, skills
  to add, content to hide, sections to promote. Each row states which
  requirement it covers, with Apply and Dismiss.
- **Coverage score** against the must-haves it found.
- **Works with no API key.** Parsing and scoring are deterministic; a provider
  only refines requirement extraction.

### Data and setup

- **Hosted, invite-only accounts** — Supabase Auth, signup closed, invite and
  reset links from `/admin`; every vault isolated by row-level security.
- **Per-user AI keys**, encrypted at rest; optional, like every AI feature.
- **Your data, yours to take** — a JSON download of everything, and account
  deletion that cascades through every table.
- **Nightly encrypted backups** via GitHub Actions, which double as the
  keep-alive for Supabase's free tier.
- **One-time import** of a local-first SQLite vault into an account, with id
  remapping and a per-table count check before commit.
- **Snapshot vs linked mode**, switchable in Settings.

162 tests pass, including schema and isolation tests on in-process Postgres. The suite deliberately asserts thresholds and relative ordering
rather than exact heuristic scores, so retuning weights doesn't break it.

---

## 7. Known limitations

Stated plainly, because these are the things that will surprise you later.

**Parsing arbitrary PDF résumés is unbounded.** Two real résumés needed six
distinct fixes between them; a third will likely need a seventh. Mitigations:
the mandatory review screen, an AI path for unusual layouts, and pasting text
beats uploading a PDF. Some glued runs still survive — `SQLServer` is one, below
a threshold that isn't safe to lower without breaking `Accenture` into
"Accent ure".

**Drag-and-drop has no auto-scroll.** Every list in the app fits on screen. The
Customize sections list is the one that could plausibly outgrow that, since it
sits in a scrolling panel. When it does, that's the moment for a real DnD
library rather than extending the hand-rolled hook.

**No offline editing.** The app needs a connection; it was the trade for
working on any device without a sync protocol.

**PDF output depends a little on the browser.** Chrome and Edge print exactly
what the preview shows. Safari and Firefox can differ slightly, and some mobile
browsers print the parent page instead of the hidden frame — the ↗ button opens
the print view in its own tab for those.

**Free-tier ceilings.** Vercel Hobby caps request bodies at 4.5 MB (large PDF
imports fail) and is for non-commercial use. Supabase free pauses after 7 idle
days — the nightly backup prevents it — and keeps no backups of its own.

**`estimatePages()` ignores skills.** It counts entries and bullets only, so a
large skills section doesn't register in the rough page-count hint. The measured
preview and the PDF are both correct; only that one warning is off.

**The old synced snapshot contains real personal data** and is still committed,
only because the repo is private. Once the Supabase import is verified it should
be deleted and removed from git history, not just the working tree.

---

## 8. Future scope

Roughly in order of value.

**An AI layer for tuning.** The obvious next step, and the deferred one. The
tuner can add, hide and reorder, but never improve wording in place. A
`REWRITE_BULLET` recommendation showing original and proposed text side by side,
with Apply and Dismiss, is where an AI call would genuinely earn its keep. It
must stay optional like everything else — absent when no key is set.

**Templates and colour presets.** Deferred by agreement. Single-column only, so
this is typography and spacing rather than layout.

**Linked mode in daily use.** The schema and the Settings toggle exist. What
hasn't been lived with is the behaviour: a vault edit silently changing a
resume you already sent is a real hazard, and the answer is probably a
notification rather than a silent update.

**Cover letters.** The vault already holds the raw material.

**Server-side PDF**, if browser printing proves inconsistent for friends on
other browsers: serverless Chromium (`@sparticuz/chromium`) can drive the same
`/print/[id]` page, at the cost of cold starts and bundle-size limits.

---

## 9. References

**FlowCV** — the model for the editor's shape: the two-panel layout, the
Content / Customize split, and the "add custom section" dialog with a Normal or
Skill type. Not copied, but the interaction vocabulary came from studying it.

**The v1 postmortem** — a full feature reference for the previous attempt,
including everything it got right. Its lessons are §2 of this document. The file
itself has been removed; it's recoverable from git history if the detail is ever
needed.

**Two real résumés** — a Modern Deedy LaTeX template and a plain single-column
one, which drove every parser fix. They're the reason the importer handles tab-
separated column breaks, two-line entry headers, and glued text at all.

**Word frequency data** — `word-list.ts` holds 26,000 frequency-ranked words
generated with Python's `wordfreq`, with engineering and resume vocabulary
spliced in. It's what makes Viterbi segmentation pick "George Washington
University" over any other split.
