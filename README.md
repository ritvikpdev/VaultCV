# vaultCV

A resume tuner. A **master vault** holds everything you've done; **resumes** are
compositions drawn from it; the **tuner** reads a job description and tells you
what to change.

Hosted, invite-only, multi-user: one deployment on Vercel, one Supabase project,
and each person sees only their own vault. Runs free on both services' free tiers.

> Design decisions and project history: [`DESIGN.md`](./DESIGN.md)

---

## What it does

**Vault**: enter each career fact once. Sections and groups are yours to name;
nothing is predefined. Import an existing resume (PDF or pasted text) and review
what was parsed before any of it is saved.

**Resumes**: build one by pulling from the vault or typing directly. Live
preview with real page sheets, so you see the page break before you export.
Customize font, spacing, margins, section order, headings. Download as PDF.

**Tuner**: paste a job description. Get an advisory list of changes: bullets to
surface, skills to add, things to hide, sections to promote. Each row says which
requirement it covers. Nothing is applied without a click.

**Works with no API key.** Vault editing, resume building, PDF export, job
description parsing and matching all run deterministically. Each user may add
their own Anthropic or Gemini key in Settings to make requirement extraction
cleaner. Nobody pays for anyone else's usage.

---

## How it fits together

| Piece | Runs on | Holds |
|---|---|---|
| Next.js app | Vercel (free Hobby plan) | nothing; it's stateless |
| Postgres | Supabase (free) | every vault, one `user_id` per row |
| Sign-in | Supabase Auth | accounts, passwords, invite links |
| Backups + keep-alive | GitHub Actions | a nightly dump, kept 30 days |

Isolation is enforced **by Postgres**, not by the app remembering to filter.
Every table has row-level security, and every request runs in a transaction as
the signed-in user. A query that forgot a `where user_id = …` still returns only
that user's rows.

---

## First-time setup

You need: a Supabase project, a GitHub repo (this one, private), and Node 22+
locally. Work from the `app/` folder.

### 1. Supabase

1. **Authentication → Sign In / Providers → Email**: turn **off** "Allow new
   users to sign up". Invites still work; strangers can't register.
2. **Authentication → URL Configuration**:
   - *Site URL*: `http://localhost:3000` for now (change it after deploying).
   - *Redirect URLs*: add `http://localhost:3000/**`, and later your Vercel URL
     with `/**` on the end.
3. **Create the tables**, either way:
   - **SQL Editor** → New query → paste all of [`app/supabase-schema.sql`](./app/supabase-schema.sql) → Run, *or*
   - `npm run db:push` once `.env.local` is filled in (step 2).
4. **Create your own account**: **Authentication → Users → Add user → Create new
   user**, with your email and a password, and tick *Auto Confirm User*.

### 2. Local environment

```bash
cd app
npm install
cp .env.example .env.local   # then fill it in; every variable is explained inside
```

Set `ADMIN_EMAIL` to the email from step 1.4. That account gets the Admin page.
Generate `VAULTCV_SECRET` with the command shown in `.env.example`.

```bash
npm run dev                   # http://localhost:3000, then sign in
```

### 3. Bring your existing vault across (one time)

If you used the old local-first version, copy its SQLite database into your
account:

```bash
npm run vault:import-sqlite -- --email you@example.com
```

It reads `data/vaultcv.db` by default (`--from <path>` for another file, such as
`data/exports/vaultcv-sync.db`). It never modifies the source, runs in one
transaction, and prints a source-vs-Supabase row count for every table. Any
mismatch rolls everything back. If the account already has content it refuses
unless you add `--replace`.

### 4. Deploy to Vercel

1. vercel.com → **Add New → Project** → import this GitHub repo.
2. **Root Directory**: `app`. The framework preset is detected as Next.js.
3. **Environment Variables**: everything from your `.env.local`, except set
   `SITE_URL` to the Vercel URL (e.g. `https://vaultcv-yourname.vercel.app`).
4. Deploy. Then go back to Supabase **URL Configuration**: set *Site URL* to
   the Vercel URL and add `https://…vercel.app/**` to *Redirect URLs*.

Every push to `main` redeploys.

### 5. Backups (recommended)

GitHub repo → **Settings → Secrets and variables → Actions** → add:

- `SUPABASE_DB_URL`: the Session pooler connection string, same as
  `MIGRATION_DATABASE_URL`.
- `BACKUP_PASSPHRASE`: any long passphrase. Backups are encrypted with it.

[`.github/workflows/backup.yml`](./.github/workflows/backup.yml) then dumps the
database daily. That also counts as activity, which stops Supabase pausing the
free project after a week of nobody signing in. Run it once by hand (Actions →
Backup database → Run workflow) to check it works.

---

## Inviting friends

**Admin** (top nav, visible only to `ADMIN_EMAIL`) → enter their email →
**Create link** → send them the link however you like. It signs them in once and
asks them to choose a password. Links expire after an hour by default
(Supabase → Authentication → Emails lets you raise that).

Locked out? Use **Reset link** on their row and send that instead.

**Email invites and "Forgot password?"** need Supabase to send email. Its
built-in mailer only delivers to members of your Supabase team, so for friends
you'd add custom SMTP (Authentication → Emails → SMTP Settings). A Gmail
account with an App Password works and is free. Then, under **Email
Templates**, change the link in *Invite user* to:

```
{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite
```

Without SMTP, the link buttons on the Admin page do everything email would.

**Tell your friends** that you, as the operator, can technically see their data
through the Supabase dashboard, and that a saved AI key is encrypted but
recoverable by whoever runs the server.

---

## Commands

All from `app/`.

| | |
|---|---|
| `npm run dev` | development server |
| `npm run build` | production build |
| `npm run test` | full suite: Node's test runner, schema tests on in-process Postgres (PGlite) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:push` | apply `schema.ts` to Supabase (uses `MIGRATION_DATABASE_URL`) |
| `npm run db:sql` | regenerate `supabase-schema.sql` from `schema.ts` |
| `npm run db:studio` | browse the database |
| `npm run vault:import-sqlite` | one-time copy of an old SQLite vault into an account |
| `npm run db:export` / `db:sync` / `db:import` | legacy: the old local SQLite file. Kept until the import is verified |

---

## Downloading a PDF

**Download PDF** opens the browser's print dialog on the resume. Choose
**Save as PDF**. It's the same Chrome engine the old server-side export used,
so the file contains real, selectable text that ATS parsers read. Chrome and
Edge match the preview exactly. If a mobile browser prints the wrong thing, use
the ↗ button next to it to open the print view in its own tab.

---

## Layout

```
CLAUDE.md          rules for coding agents working on this repo
DESIGN.md          why it's built this way, what's done, what's next
.github/workflows/ nightly backup
app/
  src/db/          schema, connection + per-user scope, queries, session
  src/lib/         parsing, tuning, rendering, drag-and-drop, Supabase clients
  src/app/         routes: vault, resume editor, print, settings, admin, sign-in
  src/middleware.ts session refresh and the sign-in redirect
  scripts/         SQLite import, schema SQL, legacy export/import
  tests/           unit tests + schema/RLS tests
```

---

## Notes

**Your data is personal**, and now so is your friends'. The backups contain
every vault. Keep this repo private and set `BACKUP_PASSPHRASE`. The old
git-tracked snapshot (`app/data/exports/vaultcv-sync.db`) is still committed;
once your import is verified it should be deleted, and removed from git
history, not just the working tree.

**Free-tier limits** that matter: Vercel Hobby is for non-commercial use, and
request bodies are capped at 4.5 MB, so PDF imports larger than that fail
(real resumes are far smaller). Supabase free gives 500 MB of database, which
is thousands of vaults.
