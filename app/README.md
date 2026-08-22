# vaultCV

Local-first resume tuner. A master vault holds everything you've done; resumes
are compositions drawn from it; the tuner reads a job description and tells you
what to change.

Runs entirely on this machine. No account, no sync, no telemetry.

## Setup

From this `app/` folder:

```bash
npm install          # builds better-sqlite3 natively — needs a few minutes first time
npm run db:push      # creates data/vaultcv.db from src/db/schema.ts
npm run dev          # http://localhost:3000
```

`npm run db:push` is the only thing that creates tables. `src/db/schema.ts` is
the single source of truth for structure — there are no hand-written migration
files to drift from it.

## Tests

```bash
npm run test        # 14 tests, no install beyond the app's own deps
```

Two suites, both using Node's built-in test runner and SQLite so nothing extra
is needed:

- **`tests/strength.test.ts`** — the bullet scorer, against real bullets from
  the reference resumes plus weak controls. Asserts thresholds and relative
  ordering rather than exact scores, so retuning the weights doesn't break the
  suite.
- **`tests/schema.test.ts`** — generates DDL from `schema.ts` and exercises it.
  The linkage cases are the ones that matter: deleting a vault bullet must null
  the resume's pointer while leaving its copied text intact.

### Optional: AI

Copy `.env.example` to `.env.local`. Three interchangeable providers, pick at
most one:

| Provider | Cost | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | paid, fractions of a cent per run | best quality |
| `GEMINI_API_KEY` | free tier covers personal use | [get one](https://aistudio.google.com/apikey) |
| `OLLAMA_BASE_URL` | free, fully offline | quality scales with model size |

**The app is fully usable with none of them.** Vault editing, resume building,
customization, PDF export, JD parsing and matching against your vault all run
locally and deterministically. A provider only improves how cleanly a job
description is split into requirements. Settings shows which state you're in.

## Layout

```
src/
  db/
    schema.ts      all tables — the source of truth for structure
    client.ts      lazy better-sqlite3 connection (WAL, foreign keys on)
    bootstrap.ts   idempotent first-run seed + settings key/value helpers
  lib/
    sections.ts    the section catalogue shared by vault and resume editor
  app/
    page.tsx       My Resumes
    vault/         master vault
    settings/      profile, API key status, vault link mode
    api/health/    readiness — informational, never gates the app
```

## Two decisions worth knowing

**Nothing is gated on AI.** The previous attempt at this app put an Ollama
health check in front of its core feature, so a stopped model server made the
app look broken. Here the health endpoint reports state and the UI explains
what's unavailable; no code path refuses to run because a key is missing.

**`source_bullet_id` is recorded even in snapshot mode.** Resumes currently copy
text from the vault, so later vault edits don't propagate. Keeping the pointer
anyway costs one integer per bullet and means linked mode later becomes a
read-time rule rather than a schema migration. See the comment above
`resumeBullets` in `schema.ts`.

## Build phases

| | | Status |
|---|---|---|
| 0 | Scaffold, schema, settings, health | **done** |
| 1 | Vault CRUD, skills, search | **done** |
| 2 | PDF/text import → parse → review → save | **done** |
| 3 | Resume editor: content tab, live preview, pull from vault | **done** |
| 4 | Customize tab: font, spacing, sections, headings | **done** |
| 5 | Puppeteer PDF export via `/print/[id]` | **done** |
| 6 | Tuner: JD parse, scoring, advisory diff | **done** |
| 7 | Linked vs snapshot, switchable in Settings | **done** |

Full plan: `../2026-07-25-vaultcv-plan.md`
