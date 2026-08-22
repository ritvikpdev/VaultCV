# vaultCV — working agreement

Local-first resume tuner for a single user (Ritvik). A **master vault** holds
every career fact once; **resumes** are compositions drawn from it; the **tuner**
reads a job description and recommends changes.

App lives in `app/`. Full plan: `2026-07-25-vaultcv-plan.md`. Design rationale:
`app/README.md`.

---

## This is a rebuild. Read this before proposing architecture.

`Failed Resume_Tuner_idea.md` documents v1, which failed. Three causes. Each has
a fix that is **already implemented and must not be undone**:

**1. Matching depended on Ollama embeddings.**
Every bullet needed a generated vector; unembedded bullets silently vanished
from results, so the headline feature showed an empty screen with no
explanation.

> **Do not add embeddings, vector search, or cosine similarity.** Matching is
> deterministic keyword/alias lookup (`src/lib/skill-aliases.ts`), optionally
> refined by a single batched Claude call. Deterministic matching must always
> return results with no API key and no precomputation step.

**2. A small local model did structured JD extraction.**
`llama3.2` couldn't produce reliable JSON, so v1 needed a regex fallback as a
load-bearing path.

> **No AI provider may ever be load-bearing.** The deterministic parser in
> `src/lib/jd-parse.ts` is the PRIMARY path and always runs. A provider only
> refines its output, and `callStructured` returning null is a normal outcome
> every caller handles.
>
> *Amended in Phase 6.* This rule originally read "No Ollama." That was the
> right rule for v1's architecture, where a small local model sat on the only
> path. With deterministic parsing primary and every provider optional and
> Zod-validated, `src/lib/ai-provider.ts` supports Anthropic, Gemini and Ollama
> interchangeably — Ritvik needed a free option. The prohibition that still
> stands absolutely is the one above: nothing may depend on a model replying.

**3. The tuner was a separate app from the resume editor.**
`/tuner` had a "Working Document" that duplicated the resume editor — two data
paths, two renderers, guaranteed drift.

> **Tune is a tab inside `/resume/[id]`**, alongside Content and Customize. One
> resume model, one preview component, one renderer. Do not create a standalone
> tuner route.

---

## Non-negotiable constraints

**Nothing is gated on AI.** Vault CRUD, resume building, customization, PDF
export and keyword matching must all work with `ANTHROPIC_API_KEY` unset. When a
key is missing, features degrade with an explanation — they never fail, and no
code path refuses to run. `/api/health` is informational only; it must never
block rendering.

**Single column, standard headings.** Two-column and mixed layouts are
deliberately out of scope. Don't build them.

**`schema.ts` is the only source of truth for structure.** Tables come from
`npm run db:push`. Never hand-write `CREATE TABLE`. The `drizzle/` folder is
generated for tests only and is gitignored.

**`source_*_id` columns stay, even though the app runs in snapshot mode.**
`resume_bullets.source_bullet_id` and `resume_entries.source_entry_id` are
recorded even though `text` is currently authoritative. They let linked mode
(Phase 7) become a read-time rule instead of a migration, and let the tuner
distinguish "already in this resume" from "available in vault". Do not remove
them as dead weight — they are load-bearing for a decision not yet made.

**Preview and PDF share one renderer.** The resume preview component is mounted
by both `/resume/[id]` and `/print/[id]`; Puppeteer prints the latter. Never
write a second renderer for export — that reintroduces preview/PDF drift.

**Bullet strength ≠ job relevance.** `src/lib/bullet-strength.ts` scores writing
quality (action verbs, metrics, length) and runs locally with no AI. Relevance to
a specific JD is the tuner's separate concern. Don't merge them.

**Destructive actions confirm.** Vault deletes go through `ConfirmButton`.

---

## Commands

```bash
npm install       # builds better-sqlite3 natively
npm run db:push   # create/update tables from schema.ts
npm run dev       # localhost:3000
npm run test      # node:test — strength scorer + schema integrity
npm run typecheck
npm run build
```

All from `app/`.

---

## Environment gotchas

Dev machine is **Windows**. Two failures have already come from ignoring that:

- **`better-sqlite3` is a native module.** It must be built on Windows. Don't
  copy `node_modules` between platforms.
- **SQLite will not create a missing directory.** `data/` is gitignored, so it's
  absent on a fresh checkout. `scripts/ensure-data-dir.mjs` runs as a pre-hook
  for `db:push` and `db:studio`. Any new script that opens the DB outside
  `src/db/client.ts` needs the same guard.

Prefer script files over inline `node -e` in npm scripts — quoting differs
across cmd.exe, PowerShell and bash.

---

## Conventions

- Server Components read via `src/db/queries.ts`; mutations are Server Actions
  in `actions.ts` next to the route, Zod-validated, returning
  `{ ok: true } | { ok: false, error }` rather than throwing.
- `db` in `src/db/client.ts` is a lazy Proxy — importing it must not open the
  database, or `next build` breaks while collecting page data.
- **The vault has no predefined sections.** `vault_sections` rows are created and
  named by the user; the only structural distinction is `type` (`normal` vs
  `skill`), because that genuinely changes an entry's shape. Grouping is
  optional and user-named. Do not reintroduce a fixed taxonomy — an earlier
  version imposed Career / Credentials / Personal plus a closed list of section
  types, which decided for the user how their own history should be filed.
- **Skills are entries, not their own table.** A skill entry is one resume line:
  title is the label ("Languages"), `information` holds the sub-skills.
  `vault_skills` still exists but is a DERIVED index — rebuilt from that text on
  every save via `src/lib/skill-index.ts`, never edited by hand, never shown.
  It exists so the tuner can answer "do you have Kubernetes?" without searching
  prose.
- `src/lib/sections.ts` now drives **resume** sections only — default sections
  for a new resume and their layout. The vault no longer reads it.
- **Reordering renumbers the affected list contiguously, inside a transaction.**
  This rule used to say the opposite — swap `displayOrder` with the adjacent row,
  never renumber. That was right while reordering meant up/down buttons, where a
  swap *is* the whole operation. Drag-and-drop lands an item at an arbitrary
  index, which no sequence of swaps expresses without walking it there a row at
  a time. The vault's lists are a handful of rows; the extra writes are free.
  The reorder actions in `src/app/vault/actions.ts` take the complete
  arrangement rather than a delta, so a dropped request can't leave the vault in
  a state that never appeared on screen. Resume section ordering still uses
  adjacent swaps and is unaffected.
- **Drag-and-drop is hand-rolled** in `src/lib/use-sortable.ts`, over
  `src/lib/reorder.ts` (pure, tested). No dnd library. Two things there are
  load-bearing and easy to break: the in-flight order lives in a **ref updated
  synchronously**, because `setState` is async and a fast drag would otherwise
  reach the release handler thinking nothing changed and silently drop the
  write; and drags start from a **grip handle**, not the row, because rows are
  links. There is no auto-scroll — a list long enough to scroll mid-drag is the
  point to reach for a real library rather than extend this one. The Customize
  sections list is the one place that could plausibly reach it, since it sits in
  a scrolling panel; it holds a handful of rows today.
- **Entries change section through a dialog, not a drag.** Only one section is
  on screen at a time, so there is no second list to drop onto.
  `moveEntryToSection` refuses a move between a `normal` and a `skill` section —
  the check lives in the action as well as the picker, because an action is a
  public entry point and a bulleted job landing in a skill section would have
  its dates and bullets rendered nowhere, which reads as data loss. Bullets need
  no handling; they hang off `entry_id`.
- **Section order lives in Customize; Content has no move controls.** The
  Content tab reorders entries and bullets by drag and folds sections with a
  chevron, but cannot move a section — that belongs next to visibility and page
  breaks in Customize, where ordering is the job. `moveSection` survives as an
  adjacent swap with exactly one caller, the tuner's REORDER recommendation;
  don't delete it as unused. Resume entries drag only within their section,
  because sections are typed and a job under EDUCATION renders wrong.
- **In the vault, chevrons collapse; they never move.** Entry cards fold to
  their title row, and the section header carries one Collapse all / Expand all
  toggle. Reordering is drag-only at every level: blocks, sections, entries,
  bullets. Don't reintroduce up/down arrows alongside it — the same icon meaning
  two things depending on the row is how misclicks get trained.
- Tailwind classes only; app chrome colours are in `tailwind.config.ts`. Resume
  document styling is CSS variables from `resume_styles`, never Tailwind.

---

## Phases

| | | |
|---|---|---|
| 0 | Scaffold, schema, settings, health | done |
| 1 | Vault CRUD, skills + aliases, search | done |
| 2 | PDF/text import → parse → review → save | done |
| 3 | Resume editor: content tab, live preview, pull from vault | done |
| 4 | Customize: font size, spacing, section order, headings | done |
| 5 | Puppeteer PDF export via `/print/[id]` | done |
| 6 | Tuner: JD parse, scoring, advisory diff | done |
| 7 | Linked vs snapshot, switchable in Settings | done |

**Import must review before writing.** Parsed items appear as checkboxes with
target sections; nothing reaches the DB unreviewed.

**Tuner output is an advisory diff, not an auto-generated resume.** Each row
states the change, which requirement it covers, and has Apply / Dismiss. An
"apply all" button may exist but is not the default.

---

## Working style

Ritvik's global preferences apply: outline a plan and get approval before
multi-step work, summarize after each major step, and list files created or
modified at the end. Confirm before deleting, overwriting or renaming existing
files.

Verify with `npm run test` and `npm run build` before claiming a phase is done.
Tests assert thresholds and ordering rather than exact heuristic scores, so
retuning weights shouldn't break the suite — keep it that way.
