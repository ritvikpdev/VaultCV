# vaultCV

A local-first resume tuner. A **master vault** holds everything you've done;
**resumes** are compositions drawn from it; the **tuner** reads a job
description and tells you what to change.

Runs entirely on your machine. No account, no server, no telemetry. Your data
is one SQLite file you own.

> Design decisions and project history: [`DESIGN.md`](./DESIGN.md)

---

## What it does

**Vault** — enter each career fact once. Sections and groups are yours to name;
nothing is predefined. Import an existing resume (PDF or pasted text) and review
what was parsed before any of it is saved.

**Resumes** — build one by pulling from the vault or typing directly. Live
preview with real page sheets, so you see the page break before you export.
Customize font, spacing, margins, section order, headings. Export to PDF.

**Tuner** — paste a job description. Get an advisory list of changes: bullets to
surface, skills to add, things to hide, sections to promote. Each row says which
requirement it covers. Nothing is applied without a click.

**Works with no API key.** Vault editing, resume building, PDF export, job
description parsing and matching all run locally and deterministically. A
provider only makes requirement extraction cleaner.

---

## Setup

Requires Node 22+. From the `app/` folder:

```bash
npm install       # builds better-sqlite3 natively — a few minutes the first time
npm run db:push   # creates data/vaultcv.db from src/db/schema.ts
npm run dev       # http://localhost:3000
```

That's a working, empty app. Import a resume from the vault page to fill it.

### Optional: an AI provider

Copy `.env.example` to `.env.local` and set at most one:

| Variable | Cost |
|---|---|
| `ANTHROPIC_API_KEY` | paid, fractions of a cent per run |
| `GEMINI_API_KEY` | free tier covers personal use |
| `OLLAMA_BASE_URL` | free, fully offline |

Settings shows which state you're in. Nothing refuses to run without one.

---

## Commands

All from `app/`.

| | |
|---|---|
| `npm run dev` | development server |
| `npm run build` | production build |
| `npm run test` | full suite (Node's test runner, no extra install) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:push` | create or update tables from `schema.ts` |
| `npm run db:studio` | browse the database |
| `npm run db:sync` | write the git-tracked snapshot, for syncing machines |
| `npm run db:import` | replace the local database from that snapshot |
| `npm run db:export` | ad-hoc dated export, untracked |

---

## Working across two machines

The live database is gitignored — the app writes to it constantly, and a file
captured mid-write is missing whatever is still in SQLite's WAL sidecar. One
snapshot is tracked instead.

**Where you've been working:**

```bash
npm run db:sync
git add -A && git commit -m "vault snapshot" && git push
```

**Where you're going:**

```bash
git pull
npm run db:import
```

`db:import` prints a row-count comparison, flags any table that would *lose*
rows, backs up what it's replacing into `data/backups/`, and waits for you to
type `yes`. Stop the dev server first.

**One machine at a time.** SQLite is binary, so git cannot merge it. Editing the
vault in both places before syncing gives you a conflict where the only outcomes
are keeping one side and losing the other.

### Setting up a second machine

`npm install` (the native module must be built per machine — never copy
`node_modules`), then `npm run db:push`, then `npm run db:import`. You'll also
need to recreate `.env.local` if you use a provider; it's gitignored.

---

## Layout

```
CLAUDE.md          rules for coding agents working on this repo
DESIGN.md          why it's built this way, what's done, what's next
app/
  src/db/          schema, connection, queries
  src/lib/         parsing, tuning, rendering, drag-and-drop
  src/app/         routes — vault, resume editor, print, settings
  scripts/         database export and import
  tests/           155 tests
  data/            your database (gitignored except the sync snapshot)
```

---

## Notes

**Windows.** `better-sqlite3` is a native module and must be built on the
machine that runs it. SQLite will not create a missing directory, so `data/`
is created by a pre-hook before `db:push` opens anything.

**Your data is personal.** The vault holds your address, phone number and full
employment history. The synced snapshot is committed only because this repo is
private — if that ever changes, it has to come out of the git history, not just
the working tree.
