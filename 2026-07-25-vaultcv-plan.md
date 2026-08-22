# vaultCV — Build Plan

**Status:** awaiting approval
**Date:** 2026-07-25

A local-only resume tuner. Master vault holds everything you've ever done; resumes are compositions drawn from it; the tuner reads a JD and tells you what to change.

---

## 1. What killed v1, and what changes

Reading `Failed Resume_Tuner_idea.md`, three structural problems stand out. The plan below fixes each.

| v1 problem | Why it broke | v2 fix |
|---|---|---|
| Matching required Ollama embeddings on every bullet | Unembedded bullets silently vanish from results. The headline feature shows an empty screen and you can't tell why. | **No embeddings at all.** Deterministic keyword/alias matching always runs; Claude adds semantic judgment in one batched call. Never an empty state. |
| `llama3.2` doing structured JD extraction | Small models fail at reliable JSON. v1 needed a regex fallback parser — a tell that the primary path didn't hold. | Claude API with a strict schema. Regex fallback stays as a safety net, not a load-bearing path. |
| Tuner was a separate app from the resume editor | Two ways to build a resume, two code paths, two preview renderers. The "Working Document" duplicated the resume editor. | **Tune is a tab inside the resume editor.** One resume model, one preview component, one renderer. |

Two further v1 limitations worth naming: DOCX export shipped as `.txt`, and PDF used the browser print dialog. Both are dropped — Puppeteer only.

---

## 2. Architecture

**Stack:** Next.js 15 (App Router) · SQLite via `better-sqlite3` + Drizzle · Tailwind + shadcn/ui · Puppeteer · Anthropic SDK
**Run:** `npm run dev` → `localhost:3000`. Single user, no auth. DB at `./data/vaultcv.db`.

### Routes

| Route | Purpose |
|---|---|
| `/` | My Resumes — card grid, thumbnails, duplicate/rename/delete |
| `/vault` | Master vault — sectioned CRUD, search, import |
| `/resume/[id]` | Editor. Tabs: **Content · Customize · Tune** |
| `/print/[id]` | Bare render target for Puppeteer (no chrome, no nav) |
| `/settings` | Profile, API key, defaults |

---

## 3. Data model

### Vault (source of truth)

- **`profile`** — singleton. Name, email, phone, location, links (JSON array of `{label, url}`), default summary.
- **`vault_entries`** — `section_type` (`experience` `education` `project` `certification` `publication` `award` `course` `organization` `volunteer` `custom`), title, organization, location, start/end date, `is_current`, url, `meta` JSON (GPA, tech stack, issuer, DOI, venue…), `display_order`.
- **`vault_bullets`** — `entry_id`, text, `tags` JSON, `strength` (1–5, computed locally from action verbs / metrics / length — no AI), `is_active`.
- **`vault_skills`** — `category` (Languages, Frameworks, Databases, Tools…), name, level, **`aliases` JSON** (`k8s` → Kubernetes, `RDS` → PostgreSQL). Aliases are what make deterministic JD matching actually work.

### Resume (composition)

- **`resumes`** — name, target role, target company, `style_id`, timestamps.
- **`resume_sections`** — heading text, `section_type`, order, `visible`, `layout` (`normal` | `skill`).
- **`resume_entries`** — `source_entry_id` *(nullable)*, order, `visible`, plus nullable override columns for title/org/dates/location.
- **`resume_bullets`** — `source_bullet_id` *(nullable)*, `text`, order, `visible`.

> **The linkage hook.** You asked to see snapshot and linked behaviour before choosing. Every resume row carries `source_*_id` from day one, so:
> - **Snapshot mode (default, v1):** `text` is authoritative. Vault edits don't propagate.
> - **Linked mode (flag, added in Phase 6):** `text IS NULL` reads through to the vault; typing in the resume fills `text` and pins it as an override.
>
> Same schema, one boolean. No migration when you decide.

- **`resume_styles`** — font family, base/name/heading sizes, line height, section gap, entry gap, bullet gap, page margins, heading style (`plain` `underline` `rule` `caps`), accent colour, page size (US Letter / A4).

### Tuner

- **`job_descriptions`** — raw text, `parsed` JSON, created_at.
- **`tune_runs`** — `resume_id`, `jd_id`, `recommendations` JSON, per-row applied/dismissed state.

---

## 4. The tuner

### Pipeline

1. **Paste JD** → Claude extracts a strict schema: role, company, seniority, `requirements[]` (each typed `must_have` / `nice_to_have`, categorised technical / domain / soft / experience), `keywords[]`.
2. **Score** every vault bullet, entry and skill against every requirement:
   - *Deterministic layer* — keyword and alias hits, always runs, zero cost, instant.
   - *Semantic layer* — one batched Claude call sends the requirement list plus all vault bullets, returns a relevance matrix. One call, not one per bullet.
3. **Diff** the ranked vault content against what's currently in the resume.

### Output — an advisory change list

Each row states the action, the target, and **which requirement it covers**, with Apply / Dismiss:

| Type | Example |
|---|---|
| `ADD_BULLET` | Add *"Containerized services with Docker…"* from Accenture → covers *must-have: container orchestration* |
| `ADD_SKILL` | Add **Kubernetes** to Technical Skills — it's in your vault, the JD asks twice, your resume omits it |
| `ADD_ENTRY` | Surface **GoLlama** project → covers *distributed systems*, *Go* |
| `REMOVE_BULLET` | Drop *"Coordinated campus event logistics"* — covers nothing in this JD, costs 2 lines |
| `REORDER` | Move Projects above Education — JD is IC-heavy, not credential-heavy |
| `EDIT_BULLET` | Reword to surface "microservices" verbatim (ATS keyword match) — *requires API key* |

Above the list: **coverage bar** (must-haves covered / total) and a strip of keyword pills, green covered / grey missing.

`Apply all` exists but is not the default. You review, you decide.

---

## 5. Vault import

Two paths into the vault, both landing in the same review screen:

1. **PDF upload** — `pdf-parse` extracts text (layout-aware, preserving line order) → Claude structures it into entries + bullets + skills.
2. **Paste text** — same parse step, skipping extraction. Also supports pasting into one section at a time.

**Review before write, always.** Every parsed item shows as a checkbox with its target section; you uncheck junk, fix mis-sectioned rows, resolve profile conflicts (create / merge / skip), then save. Nothing reaches the DB unreviewed.

Near-duplicate detection uses normalised text similarity (no embeddings) so re-importing a second FlowCV PDF flags overlap instead of doubling your vault.

---

## 6. Editor & preview

**Content tab** — mirrors your screenshots. Left: collapsible section cards, entries listed with drag handles and eye icons, `Add Entry`, `Add Content` modal offering the section catalogue (Summary, Education, Work Experience, Technical Skills, Languages, Certificates, Interests, Projects, Courses, Awards, Organizations, Publications, References, Custom). Right: live preview.

Editing an entry opens the form from `content_edit_example.png`: title, org, dates, location, rich-text bullet list (bold / italic / underline / list / link / align).

**Pull from Vault** is the one addition FlowCV lacks — a picker inside each section showing matching vault entries and bullets, with the ones already used greyed out.

**Customize tab** — all four groups you selected:

- Font size: base, full name, section headings (stepper + slider, as in your screenshot)
- Spacing: line height, section gap, entry gap, bullet gap, page margins
- Sections: drag reorder, show/hide, rename headings, page-break marker
- Font family and heading style

Layout is locked to **single column, standard headings** per your spec. The two/mix column options are deliberately not built.

**Preview and PDF share one renderer.** The preview component renders at true US Letter dimensions from CSS variables driven by `resume_styles`. `/print/[id]` mounts that identical component; Puppeteer prints it. Preview drift is structurally impossible.

---

## 7. Build phases

| Phase | Deliverable | Verify |
|---|---|---|
| **0** | Scaffold, Drizzle schema, migrations, settings page + API key storage | `npm run dev` boots, DB file created, health check green |
| **1** | Vault CRUD, all section types, search, skills + aliases | Enter one experience by hand end-to-end |
| **2** | PDF/text import → Claude parse → review → save | Import a real FlowCV PDF, confirm nothing unreviewed lands |
| **3** | Resume editor Content tab + live preview + Pull from Vault | Rebuild `Resume_Job` from the vault |
| **4** | Customize tab, all four control groups | Squeeze a 2-page resume to 1 page using only these controls |
| **5** | Puppeteer export via `/print/[id]` | Diff exported PDF against on-screen preview |
| **6** | Tuner: JD parse, scoring, diff UI, apply/dismiss | Paste a real SWE JD, confirm recommendations are non-obvious and correct |
| **7** | Linked-vs-snapshot toggle, side by side | You pick a mode; loser gets deleted |

Phases 0–5 give a working FlowCV replacement. Phase 6 is the reason the app exists.

---

## 8. Open items

- **API key handling** — stored in `.env.local`, never committed. `.gitignore` covers `data/` and `.env.local` from the first commit.
- **Cost** — a tune run is one JD-parse call plus one batched scoring call. Fractions of a cent. Deterministic matching runs with no key at all.
- **Not in scope for v1:** DOCX export, application-tracking CRM, cover letters, multi-column layouts, voice calibration.
- **Where it lives** — I'd put the app in `vaultCV/app/` and move the FlowCV screenshots into `vaultCV/reference/`. Confirm before I move anything.
