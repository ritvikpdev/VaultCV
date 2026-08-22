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

Everything runs on one machine. No account, no server, no telemetry. The data
is a single SQLite file you own.

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

Next.js 15 App Router, React 19, SQLite through Drizzle. Server Components read
the database directly; mutations are Server Actions next to the route that uses
them. There is no API layer between the UI and the data, because there is no
second client to serve — the one exception is `/api/export/[id]`, which needs to
stream a PDF.

It was built bottom-up: the vault before the resume editor, the editor before
the tuner. That order was deliberate, not incidental — each layer had real
content from the one below it to work against, so nothing was ever verified only
against fixtures. Every parser bug and scoring flaw in this codebase was found
by running it on actual résumés rather than by a test passing.

```
src/
  db/
    schema.ts        every table — the only source of truth for structure
    client.ts        lazy better-sqlite3 connection (WAL, foreign keys on)
    bootstrap.ts     idempotent first-run seed, settings key/value helpers
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
  app/
    page.tsx         My Resumes
    vault/           the master vault
    resume/[id]/     editor — Content, Customize, Tune tabs
    print/[id]/      what Puppeteer renders for PDF export
    settings/        profile, provider status, link mode
```

### Decisions worth knowing

**`schema.ts` is the only source of truth for structure.** Tables come from
`npm run db:push`. There are no hand-written migrations to drift from it. The
`drizzle/` folder is generated for tests and is gitignored.

**The database connection is a lazy Proxy.** `next build` imports every route
module to collect page data. If the connection were created at import time,
building would open the database as a side effect and hard-fail on any machine
where the native binding wasn't compiled yet — even though no query ever runs.

**Preview and PDF share one renderer.** `ResumeDocument` is mounted by both
`/resume/[id]` and `/print/[id]`; Puppeteer prints the latter. A second renderer
for export would reintroduce exactly the drift v1 died of.

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

## 4. The data model

Fifteen tables in four groups. Every arrow is a foreign key with
`ON DELETE CASCADE`.

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

- **Sections and groups you define yourself.** Create and name them as you like;
  grouping is optional. The only structural choice is `normal` (dates,
  organisation, bullets) versus `skill` (a label plus sub-skills).
- **Entries and bullets** with dates, organisation, location, subtitle, and
  per-section extra fields. Bullets can be pinned so the tuner always favours
  them.
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
  dragged between groups to file them. Chevrons collapse entries; they never
  move anything.

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
- **PDF export** through Puppeteer, rendering the same component as the preview.

### The tuner

- **Paste a job description**, get an advisory diff — bullets to surface, skills
  to add, content to hide, sections to promote. Each row states which
  requirement it covers, with Apply and Dismiss.
- **Coverage score** against the must-haves it found.
- **Works with no API key.** Parsing and scoring are deterministic; a provider
  only refines requirement extraction.

### Data and setup

- **One SQLite file**, entirely on your machine. No account, no server, no
  telemetry.
- **Two-machine sync** through a single git-tracked snapshot, written with
  `VACUUM INTO` so it's always consistent, and imported with a row-count diff
  and an automatic backup.
- **Snapshot vs linked mode**, switchable in Settings.

155 tests pass. The suite deliberately asserts thresholds and relative ordering
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

**The two-machine sync is a discipline, not a guarantee.** SQLite is binary, so
git can't merge it. Editing the vault on both machines before syncing produces
a conflict whose only resolutions are "keep mine" or "keep theirs". `db:import`
prints a row-count diff, flags tables that would lose rows, and backs up first —
recoverable, but still one machine at a time.

**`estimatePages()` ignores skills.** It counts entries and bullets only, so a
large skills section doesn't register in the rough page-count hint. The measured
preview and the PDF are both correct; only that one warning is off.

**The synced snapshot contains real personal data** and is committed only
because the repo is private. If that changes, it has to come out of the git
history, not just the working tree.

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

**A better sync story**, if the two-machine workflow gets heavy. Anything
involving a SQLite file in Dropbox or OneDrive corrupts databases; the real
options are a proper server or a text-based export format git can merge.

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
