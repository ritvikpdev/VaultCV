# vaultCV — working agreement

Local-first resume tuner, single user (Ritvik). A **master vault** holds every
career fact once; **resumes** are compositions drawn from it; the **tuner**
reads a job description and recommends changes.

App lives in `app/`. Background and rationale: `DESIGN.md`. Setup: `README.md`.

---

## This is a rebuild. Three rules exist because v1 died of them.

Each is already implemented. Do not undo them.

**1. No embeddings, vector search, or cosine similarity.** v1 required a
generated vector per bullet; unembedded bullets silently vanished from results
and the headline feature showed an empty screen with no explanation. Matching is
deterministic keyword/alias lookup (`src/lib/skill-aliases.ts`), optionally
refined by one batched AI call. It must always return results with no API key
and no precomputation step.

**2. No AI provider may ever be load-bearing.** v1 had `llama3.2` doing
structured JD extraction; it couldn't produce reliable JSON, so an undesigned
regex fallback became the real path. Here the deterministic parser in
`src/lib/jd-parse.ts` is PRIMARY and always runs. A provider only refines its
output, and `callStructured` returning null is a normal outcome every caller
handles.

> *Amended in Phase 6.* This originally read "no Ollama" — right for v1's
> architecture, where a small local model sat on the only path. With
> deterministic parsing primary and every provider optional and Zod-validated,
> `src/lib/ai-provider.ts` supports Anthropic, Gemini and Ollama
> interchangeably; a free option was needed. What still stands absolutely is
> that nothing may depend on a model replying.

**3. Tune is a tab inside `/resume/[id]`**, alongside Content and Customize.
v1's separate `/tuner` route had a "Working Document" duplicating the resume
editor — two data paths, two renderers, guaranteed drift. One resume model, one
preview component, one renderer. Never create a standalone tuner route.

---

## Non-negotiable constraints

**Nothing is gated on AI.** Vault CRUD, resume building, customization, PDF
export and keyword matching all work with no API key set. Features degrade with
an explanation; they never fail, and no code path refuses to run. `/api/health`
is informational and must never block rendering.

**Single column, standard headings.** Two-column and mixed layouts are
deliberately out of scope.

**`schema.ts` is the only source of truth for structure.** Tables come from
`npm run db:push`. Never hand-write `CREATE TABLE`. `drizzle/` is generated for
tests and gitignored.

**`source_*_id` columns stay, despite snapshot mode.**
`resume_bullets.source_bullet_id` and `resume_entries.source_entry_id` are
recorded even though `text` is currently authoritative. They make linked mode a
read-time rule rather than a migration, and let the tuner distinguish "already
in this resume" from "available in vault". Not dead weight.

**Preview and PDF share one renderer.** `ResumeDocument` is mounted by both
`/resume/[id]` and `/print/[id]`; Puppeteer prints the latter. A second renderer
for export reintroduces preview/PDF drift.

**Bullet strength ≠ job relevance.** `src/lib/bullet-strength.ts` scores writing
quality locally with no AI. Relevance to a specific JD is the tuner's separate
concern. Don't merge them.

**Destructive actions confirm.** Vault deletes go through `ConfirmButton`.

---

## Commands

```bash
npm install       # builds better-sqlite3 natively
npm run db:push   # create/update tables from schema.ts
npm run db:sync   # snapshot the DB into the one git-tracked file
npm run db:import # replace the local DB from that snapshot, after confirming
npm run db:export # ad-hoc dated export, untracked
npm run dev       # localhost:3000
npm run test
npm run typecheck
npm run build
```

All from `app/`. Verify with `npm run test` and `npm run build` before calling
anything done. Tests assert thresholds and ordering rather than exact heuristic
scores — keep it that way so retuning weights doesn't break the suite.

---

## Environment

Dev machines are **Windows**.

- **`better-sqlite3` is native.** It must be built per machine; never copy
  `node_modules` across platforms.
- **SQLite will not create a missing directory.** `data/` is gitignored, so it's
  absent on a fresh checkout. `scripts/ensure-data-dir.mjs` runs as a pre-hook
  for `db:push` and `db:studio`. Any new script that opens the DB outside
  `src/db/client.ts` needs the same guard.
- Prefer script files over inline `node -e` in npm scripts — quoting differs
  across cmd.exe, PowerShell and bash.
- **Never move the database by copying `data/vaultcv.db`.** WAL mode means
  recent writes sit in the `-wal` sidecar until checkpointed; on a real vault
  that sidecar was 4 MB against a 143 KB main file and held every bullet. The
  copy opens cleanly and just looks like less work was done. `db:export` and
  `db:sync` use `VACUUM INTO`, which writes one checkpointed file safely while
  the app runs.
- **The vault syncs between machines as a git-tracked snapshot** —
  `app/data/exports/vaultcv-sync.db`, and only that path. The live DB stays
  ignored. SQLite is binary so git can't merge it: editing on both machines
  before syncing gives a conflict whose only resolutions lose one side's work.
  `db:import` prints a row-count diff, flags tables that would lose rows, and
  backs up first — a mitigation, not a fix. One machine at a time. The snapshot
  holds real personal data and is committed only because the repo is private.

---

## Conventions

- Server Components read via `src/db/queries.ts`; mutations are Server Actions
  in `actions.ts` next to the route, Zod-validated, returning
  `{ ok: true } | { ok: false, error }` rather than throwing.
- `db` in `src/db/client.ts` is a lazy Proxy — importing it must not open the
  database, or `next build` breaks while collecting page data.
- Tailwind classes only; app chrome colours live in `tailwind.config.ts`. Resume
  document styling is CSS variables from `resume_styles`, never Tailwind.

### The vault

- **No predefined sections.** `vault_sections` rows are created and named by the
  user. The only structural distinction is `type` (`normal` vs `skill`), because
  that changes an entry's shape. Grouping is optional and user-named. Do not
  reintroduce a fixed taxonomy — an earlier version imposed Career / Credentials
  / Personal plus a closed list of section types, deciding for the user how
  their own history should be filed.
- **Skills are entries, not their own table.** A skill entry is one resume line:
  title is the label ("Languages"), `information` holds the sub-skills.
  `vault_skills` is a DERIVED index, rebuilt from that text on every save via
  `src/lib/skill-index.ts` — never edited by hand, never shown. It exists so the
  tuner can answer "do you have Kubernetes?" without searching prose.
- **Entries change section through a dialog, not a drag** — only one section is
  on screen at a time. `moveEntryToSection` refuses moves between a `normal` and
  a `skill` section, and the check lives in the action as well as the picker: an
  action is a public entry point, and a bulleted job landing in a skill section
  would render its dates and bullets nowhere, which reads as data loss.
- `src/lib/sections.ts` now drives **resume** sections only. The vault no longer
  reads it.

### Ordering and drag-and-drop

- **Reordering renumbers the affected list contiguously, inside a transaction.**
  This rule used to say the opposite — swap with the adjacent row, never
  renumber — which was right when reordering meant up/down buttons, where a swap
  *is* the operation. A drag lands an item at an arbitrary index, which no
  sequence of swaps expresses without walking it there a row at a time. The
  lists are a handful of rows; the extra writes are free. Reorder actions take
  the complete arrangement rather than a delta, so a dropped request can't leave
  the data in a state that never appeared on screen.
- **Drag-and-drop is hand-rolled** in `src/lib/use-sortable.ts` over
  `src/lib/reorder.ts` (pure, tested). No dnd library. Two things there are
  load-bearing: the in-flight order lives in a **ref updated synchronously**,
  because `setState` is async and a fast drag would otherwise reach the release
  handler thinking nothing changed and silently drop the write; and drags start
  from a **grip handle**, not the row, because rows are links. No auto-scroll —
  a list long enough to scroll mid-drag is the point to reach for a real
  library. The Customize sections list is the only plausible candidate.
- **Chevrons collapse; they never move.** True in both the vault and the resume
  editor. Reordering is drag-only at every level. Don't reintroduce up/down
  arrows alongside it — the same icon meaning two things depending on the row is
  how misclicks get trained.
- **Section order lives in Customize; Content has no move controls.** Content
  reorders entries and bullets by drag and folds sections with a chevron, but
  can't move a section. `moveSection` survives as an adjacent swap with exactly
  one caller — the tuner's REORDER recommendation — so don't delete it as
  unused. Resume entries drag only within their section, because sections are
  typed and a job under EDUCATION renders wrong.
- **Resume skill categories are derived, not stored.** `resume_skills` holds one
  row per skill carrying a category string; the renderer groups them. Editing a
  category means editing a set of rows, and the save diffs by name
  (`src/lib/skill-category.ts`) so rows keep their `source_skill_id` — a
  blanket delete-and-reinsert would sever every vault link on a typo fix.

---

## Behaviour rules

**Import must review before writing.** Parsed items appear as checkboxes with
target sections; nothing reaches the DB unreviewed.

**Tuner output is an advisory diff, not an auto-generated resume.** Each row
states the change, which requirement it covers, and has Apply / Dismiss. An
"apply all" may exist but is not the default.

---

## Working style

Outline a plan and get approval before multi-step work. Summarize after each
major step. List files created or modified at the end. Confirm before deleting,
overwriting or renaming anything that exists.
