# vaultCV

A resume tuner. Keep every career fact once in your **vault**, build **resumes**
from it, and let the **tuner** suggest changes for a job description.

Invite-only and multi-user: one Vercel deployment, one Supabase project, each
person sees only their own data. Works without any AI key.

## Features

- **Vault**: groups and sections you name yourself, entries with bullets, an
  overview of what needs attention, and resume import (PDF or text) with review.
- **Resume editor**: edit on the left, live preview on the right. Pull entries
  and bullets from the vault, format descriptions, hide entries per resume.
- **Customize**: fonts, spacing, margins, section order. **Download** opens the
  print dialog; choose *Save as PDF*.
- **Tune**: paste a job description and get suggestions to apply or dismiss.

## Setup

Needs Node 22+, a Supabase project and this repo. Run everything from `app/`.

1. **Supabase**
   - Authentication → Email: turn off *Allow new users to sign up*.
   - Authentication → URL Configuration: Site URL `http://localhost:3000`,
     Redirect URL `http://localhost:3000/**`.
   - Authentication → Users → Add user: create your own account (*Auto Confirm*).
2. **Configure**
   ```bash
   cd app
   npm install
   cp .env.example .env.local   # fill in; each variable is explained there
   ```
   Set `ADMIN_EMAIL` to your account's email.
3. **Create the tables and run**
   ```bash
   npm run db:push
   npm run dev                  # http://localhost:3000
   ```

## Deploy

1. Vercel → Add New → Project → import this repo, **Root Directory** `app`.
2. Add the variables from `.env.local`, with `SITE_URL` set to the Vercel URL.
3. In Supabase URL Configuration, set the Site URL to the Vercel URL and add
   `https://<your-app>.vercel.app/**` to Redirect URLs.

Pushes to `main` go to production; other branches get preview deployments.

**Backups**: add `SUPABASE_DB_URL` (session pooler URL) and `BACKUP_PASSPHRASE`
as GitHub Actions secrets. The nightly workflow also keeps the free Supabase
project from pausing.

## Inviting people

Admin page (visible to `ADMIN_EMAIL`) → enter an email → **Create link** → send
it. Use **Reset link** if someone is locked out.

## Commands

| Command | |
|---|---|
| `npm run dev` | development server |
| `npm run build` | production build (stop `dev` first — they share `.next`) |
| `npm run test` | test suite |
| `npm run typecheck` | type check |
| `npm run db:push` | apply `src/db/schema.ts` to Supabase |
| `npm run db:sql` | regenerate `supabase-schema.sql` |

Keep the repo private: backups and the legacy SQLite snapshot contain personal
data.
