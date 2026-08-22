# ResumeTuner — Feature Reference

**ResumeTuner** is a local-first AI resume tool. You store career content in a **Vault**, tailor resumes to job descriptions in the **Tuner**, and track past applications in **My Applications**. All AI runs through **Ollama** on your machine; data is stored in a local **SQLite** database.

---

## Table of Contents

1. [Platform & Architecture](#platform--architecture)
2. [Onboarding](#onboarding)
3. [Dashboard (Home)](#dashboard-home)
4. [My Vault](#my-vault)
5. [Apply to Job (Tuner)](#apply-to-job-tuner)
6. [My Applications (History)](#my-applications-history)
7. [Settings](#settings)
8. [AI & Local Services](#ai--local-services)
9. [Export](#export)
10. [API Routes Reference](#api-routes-reference)
11. [Known Limitations](#known-limitations)

---

## Platform & Architecture

| Component | Technology |
|-----------|------------|
| Frontend | Next.js 15 (App Router), React 19, Tailwind CSS, shadcn/ui |
| Database | SQLite via `better-sqlite3` + Drizzle ORM (`./data/app.db`) |
| AI | Ollama — default LLM `llama3.2`, default embeddings `nomic-embed-text` |
| Export libs | `pdfkit`, `docx` (backend routes exist) |

**Privacy model:** Resume content, job descriptions, and AI inference stay on your machine. No cloud API calls for AI features.

**Navigation:**

| Route | Label |
|-------|-------|
| `/dashboard` | Home |
| `/vault` | My Vault |
| `/tuner` | Apply to Job |
| `/history` | My Applications |
| `/settings` | Settings |

---

## Onboarding

**Location:** First-launch wizard (`OnboardingGate` → `OnboardingWizard`)

**Steps:**

1. **Ollama** — Checks that Ollama is running and required models are pulled. Calls `GET /api/health`.
2. **Profile** — Collects name, email, phone, location, LinkedIn, GitHub. Can be skipped.
3. **Import** — Paste resume text; Ollama parses it into structured experiences. Can be skipped.
4. **Review** — Preview parsed experiences/bullets before importing into the vault via `POST /api/vault/import`.

**How it works:**

- Completion is stored in `localStorage` under `onboarding_complete`.
- Import uses the same resume parser as the vault import dialog, with a simplified onboarding flow.
- Parsed data is written to SQLite (experiences, bullets, optional profile fields).

---

## Dashboard (Home)

**Route:** `/dashboard`

### Primary action cards

| Card | Destination | Purpose |
|------|-------------|---------|
| Add to My Vault | `/vault` | Capture experiences and bullets |
| Apply to a Job | `/tuner` | Paste a JD and build a tailored resume |
| My Applications | `/history` | Browse past tailored resumes |

### Readiness Indicator

A setup progress meter (informational, never blocking) tracking five checks:

| Check | Requirement | Fix link |
|-------|-------------|----------|
| Ollama connected | Ollama reachable + models ready | Settings |
| Profile created | Name + email filled in | Settings |
| Vault has bullets | At least 1 bullet in vault | Vault |
| Bullets embedded | At least 1 bullet has an embedding vector | Vault (Embed all) |
| Voice profile calibrated | Voice calibration completed | Settings |

**How it works:** Reads Ollama status from `OllamaStatusContext`, profile from `GET /api/profile`, bullet counts from `GET /api/vault/bullets?count=true`, and voice flag from `localStorage`.

---

## My Vault

**Route:** `/vault`

The vault is your long-term career database. Everything here feeds the Tuner when matching bullets to job descriptions.

### Vault sections

| Section | Stored in | Description |
|---------|-----------|-------------|
| Personal Profile | `profile` table | Contact info, summary, languages |
| Professional Experience | `experiences` | Jobs, internships, contracts |
| Education | `experiences` | Degrees, programs |
| Certifications | `experiences` | Credentials |
| Skills | `skills` table | Categorized skills with proficiency |
| Sports & Athletics | `experiences` | Competitive/team sports |
| Cultural & Extracurricular | `experiences` | Clubs, volunteering, arts |
| Projects | `experiences` | Side/personal/open-source work |
| Publications | `experiences` | Papers, articles, books |
| Speaking & Events | `experiences` | Talks, panels, workshops |

Sections are grouped in the sidebar: **Career**, **Personal**, **Credentials**.

### Experience management

- **Add experience** — Dialog with section-specific fields (dates, org, employment type, industry tag, URL, extra fields like GPA or tech stack).
- **Edit / delete** — `PATCH` / `DELETE` on `/api/vault/experiences/[id]`.
- **Reorder** — `POST /api/vault/experiences/reorder` updates `display_order`.

### Bullet management

Each experience holds one or more **bullets** (achievement statements).

| Feature | How it works |
|---------|--------------|
| Add bullet inline | Text field on each experience card |
| Edit bullet | Dialog: content, tags, strength score (1–5) |
| Delete bullet | Soft-delete via `is_active` flag |
| Reorder bullets | `POST /api/vault/bullets/reorder` |
| Pin bullet | `is_pinned` — auto-selected in Tuner after JD analysis |
| Strength score | Auto-computed on save by `bulletStrength.ts` (action verbs, metrics, length — no AI) |
| Tags | JSON array on each bullet; searchable and used in matching context |

### Embeddings

Bullets can have an **embedding vector** (from Ollama) stored in the `embedding` column.

| Action | API | Purpose |
|--------|-----|---------|
| Embed one bullet | `POST /api/vault/embed-bullet` | Generate vector for a single bullet |
| Embed all | `POST /api/vault/embed-all` | Batch embed unembedded bullets (used in Bullet Bank and vault) |

**Why:** Embeddings power semantic matching in the Tuner (cosine similarity against JD-derived queries).

### Duplicate detection

When adding or editing bullets, the app can warn about near-duplicates.

**How it works:**

1. New bullet text is embedded.
2. `findSimilarBullets()` compares cosine similarity against existing bullet embeddings.
3. Threshold default: **0.85**.
4. API: `POST /api/vault/check-duplicate`.

### Resume import

**UI:** `ImportResumeDialog` (also used in onboarding)

**Flow:**

1. Paste resume text → `POST /api/vault/parse-resume`
2. Ollama extracts profile, experiences, bullets, skills (with defensive parsing for small models)
3. User reviews checkboxes per item; resolves profile conflicts (create / merge / skip)
4. Save → `POST /api/vault/import-parsed`

**Parser features (`resumeParser.ts`):**

- Maps raw headers ("WORK EXPERIENCE") to canonical sections
- Promotes sibling arrays into `experiences[]`
- Strips empty bullets and invalid skills
- Folds stray `contact_info` into profile

### Skill extraction

**API:** `POST /api/vault/extract-skills`

Uses Ollama to suggest skills from bullet text or pasted content. User confirms before saving to the `skills` table.

### Vault search

**API:** `GET /api/vault/search?q=...`

Case-insensitive substring search across bullet content, experience title, and organization. Results ranked: pinned first, then exact bullet match, then by ID. Grouped by section for sidebar display.

### Tags

**API:** `GET /api/vault/tags` — Returns all unique tags across bullets for autocomplete/filtering.

### AI feature guard

AI buttons (import, embed, extract skills) are wrapped in `AIFeatureGuard`. When Ollama is offline or a required model is missing, buttons are disabled with a tooltip explaining why.

### Persistence

- Last active vault section saved to `localStorage` (`resume-tuner:vault-active-section`).
- Collapsed sidebar groups saved to `resume-tuner:vault-collapsed-groups`.

---

## Apply to Job (Tuner)

**Route:** `/tuner`

The core workflow: paste a job description, match vault bullets, customize, check ATS readiness, export.

### Session state (`TunerContext`)

All tuner state lives in React context with:

- **Autosave** to `localStorage` (24-hour TTL; restore banner on return)
- **Undo stack** for destructive actions (toast with Undo button)
- **Saved resume/version IDs** after first save to DB

**Snapshot fields:** role, company, JD text, JD analysis, matched bullets, selected bullet IDs, tuned content overrides, bullet order, extra ad-hoc bullets, polished bullet IDs, summary, skills override.

### Top bar

- **Target role** and **target company** text fields
- **Analyze JD** — opens JD drawer
- **Save version** — creates/updates resume record + version snapshot in SQLite
- **Export PDF** — triggers browser print (`window.print()`)
- **Export DOCX** — downloads plain `.txt` (see [Known Limitations](#known-limitations))

### Requirements strip

Shown below the top bar after JD analysis.

**How it works:**

- Shows up to 5 keyword pills (green = covered in resume text, gray = missing)
- Progress bar: % of **must-have** requirements covered by current resume text
- Click opens Requirements drawer

### Workshop tab

Two-panel layout:

#### Bullet Bank (left)

Shows vault bullets ranked against the current JD.

**Matching pipeline:**

1. User pastes JD → `POST /api/tuner/analyze` → structured `JDAnalysis`
2. `POST /api/tuner/match` → ranks all embedded vault bullets
3. Each bullet gets:
   - `similarity_score` — cosine similarity (embedding vs JD)
   - `section_weight` — how important that vault section is for this role (from JD analysis)
   - `final_score` = similarity × section weight
   - `tier`: **core** (>0.6), **supporting** (0.3–0.6), **not_relevant** (<0.3)
   - `match_reason`, `requirements_covered`, matched keywords

**UI tabs:** Core 🎯 | Supporting 💡 | Irrelevant 🚫

**Actions:**

- Toggle bullet selection (adds to Working Document)
- Open **Polish** panel for a bullet
- Filter by keyword (from ATS fix actions)
- **Embed all** if bullets lack embeddings

**Auto-behavior:** Pinned vault bullets are auto-selected after JD analysis.

#### Working Document (right)

Live preview of the tailored resume being built.

| Feature | Behavior |
|---------|----------|
| Section layout | Built from selected bullets grouped by experience |
| Reorder bullets | Drag or move within experience groups |
| Edit bullet text | Creates `tunedContent` override (original vault text preserved) |
| Add extra bullets | Session-only bullets (negative IDs, not in vault) |
| Professional summary | Per-session override field |
| Skills override | Comma-separated override for this application |
| Page estimate | Character-based page count via `estimatePageLength()` |

### Review Room tab

Split view:

- **Clean Resume** — formatted preview
- **Analysis Panel** — ATS check results + export buttons

### JD Drawer

Paste full job description → **Analyze**.

**API:** `POST /api/tuner/analyze`

**Output (`JDAnalysis`):**

| Field | Description |
|-------|-------------|
| `target_role`, `target_company` | Extracted from JD text |
| `role_type`, `domain`, `seniority` | Role classification |
| `requirements[]` | Typed (must_have / nice_to_have) and categorized (technical, soft_skill, domain, cultural, experience) |
| `keywords[]` | ATS-relevant terms |
| `section_weights` | 0–1 weight per vault section for this role |
| `summary` | Short JD summary for polish prompts |

**Fallback:** Regex-based parser if LLM fails (`analyzeJobDescriptionVerbose`).

**Side effect:** JD archived in `jd_history` table.

After analysis, matching runs automatically and populates the Bullet Bank.

### Requirements Drawer

Full list of JD requirements with coverage status (covered / not covered) based on current resume text. Links to run ATS check.

### Polish Panel

**API:** `POST /api/tuner/polish`

Rewrites a selected bullet using Ollama.

| Input | Description |
|-------|-------------|
| Original bullet text | From vault or extra bullet |
| JD summary | Context from analysis |
| Tone | concise / impactful / technical / executive |
| Voice profile | Optional — from calibration |

**Output (`PolishResult`):**

- Polished text
- Changes made (explanation)
- Readability before/after scores
- AI risk flags (banned words, patterns)
- Confidence level

User accepts or rejects; accepted text goes into `tunedContent`.

### ATS Check

**API:** `POST /api/tuner/ats-check`

Deterministic checker (no LLM). Runs in Review Room Analysis Panel.

**Checks include:**

- Contact info present (name, email, phone, LinkedIn/GitHub)
- Keyword coverage % vs JD keywords
- Must-have requirement coverage
- Page count (warns if >2 pages)
- Banned "AI-sounding" words
- Bullet count minimums

**States:** `not_ready` | `almost` | `ready`

**Fix actions:** Each failed check can link to filter Bullet Bank, go to Vault section, or edit profile field.

### Save version

**APIs:**

- `POST /api/resumes` — create resume record (first save)
- `POST /api/resumes/[id]/versions` — save version with full snapshot

**Stored per version:**

- Selected bullet IDs
- Tuned content overrides
- Bullet order
- Full JSON snapshot (for restore/export/diff)

### Restore from history

From My Applications, **Restore in Tuner** sets `localStorage` key `tuner_restore_from_history`. Tuner page shows a banner to load that snapshot into the current session.

---

## My Applications (History)

**Route:** `/history`

Application CRM for past tuning sessions.

### Resume list (left panel)

Shows all saved resumes with:

- Target role / company
- Status dot: **Sent** (green) | **Exported** (blue) | **Draft** (gray)
- Version count, export count, created date
- Sent date badge if marked

**API:** `GET /api/resumes`

### Resume detail (right panel)

For selected resume:

| Feature | How it works |
|---------|--------------|
| Version list | `GET /api/resumes/[id]/versions` |
| Version preview | Renders resume text from stored snapshot |
| Version diff | `VersionDiff` component — added/removed/changed bullets between two versions |
| Mark as sent | `PATCH /api/resumes/[id]/sent` with date |
| Restore in Tuner | Writes snapshot to localStorage, navigates to `/tuner` |
| Export PDF | Opens printable window + `window.print()` |
| Export DOCX | Downloads `.txt` file |
| Export log | Each export logged via `POST /api/export-log` |

### JD history

Past job descriptions are stored in `jd_history` when analyzed.

**API:** `GET /api/tuner/jd-history`

---

## Settings

**Route:** `/settings`

### Profile

Full profile editor synced to `profile` table via `GET/PATCH /api/profile`:

- Name, email, phone, location
- LinkedIn, GitHub, portfolio URLs
- Professional summary, career objective
- Languages spoken (tag input)

### Voice calibration

**Component:** `VoiceCalibration`  
**API:** `POST /api/profile/voice-calibrate`

Paste 3–5 representative resume bullets → Ollama analyzes writing style.

**Stored as `VoiceProfile`:**

- Average word count per bullet
- Formality (casual / neutral / formal)
- Top 5 preferred action verbs
- Tone description (used in polish prompts)

Flag stored in `localStorage`: `resume-tuner:voice-profile-calibrated`.

### AI preferences

Stored in `localStorage` (`resume-tuner:ai-preferences`):

| Setting | Options |
|---------|---------|
| Default tone | Concise, Impactful, Technical, Executive |
| LLM model override | Empty = server default (`OLLAMA_LLM_MODEL`) |
| Embedding model override | Empty = server default (`OLLAMA_EMBED_MODEL`) |

### App preferences

Stored in `localStorage` (`resume-tuner:app-preferences`):

| Setting | Options |
|---------|---------|
| Dark mode | On/off (applied before paint to avoid flash) |
| Export template | Styled, ATS |

---

## AI & Local Services

### Ollama integration (`services/ollama.ts`)

| Function | Purpose |
|----------|---------|
| `checkOllamaHealth()` | Ping Ollama, list installed models |
| `generateEmbedding(text)` | Vector via embed model |
| `generateStructuredOutput()` | LLM JSON output validated with Zod |

**Env vars:**

| Variable | Default |
|----------|---------|
| `OLLAMA_BASE_URL` | `http://localhost:11434` |
| `OLLAMA_LLM_MODEL` | `llama3.2` |
| `OLLAMA_EMBED_MODEL` | `nomic-embed-text` |

### Health monitoring

| Component | Behavior |
|-----------|----------|
| `GET /api/health` | Returns Ollama connection, LLM ready, embed model ready, missing models |
| `HealthIndicator` (navbar) | Live status dot |
| `OfflineBanner` | Dismissible amber banner when Ollama unreachable; session-only dismiss |
| `OllamaStatusProvider` | Polls health, shares status app-wide |
| `AIFeatureGuard` | Disables AI buttons when offline |

**Non-AI features still work** when Ollama is down (vault CRUD, manual editing, history browsing).

---

## Export

### Current UI behavior (Tuner + History)

| Format | What happens |
|--------|--------------|
| PDF | Browser print dialog (`window.print()` or new window + print) |
| DOCX | Plain text downloaded as `.txt` |

Export events are logged to `export_log` table with format, filename, timestamp, and linked `resume_version_id`.

### Backend export APIs (implemented, not fully wired to UI)

| Route | Output |
|-------|--------|
| `POST /api/export/pdf` | PDF via `pdfkit` |
| `POST /api/export/docx` | DOCX via `docx` library |

**Export modes:** `styled` or `ats` (from app preferences `exportTemplate`).

**Payload:** Profile, target role/company, sections with entries and bullets, skill groups.

---

## API Routes Reference

### Profile
- `GET/PATCH /api/profile`
- `POST /api/profile/voice-calibrate`

### Vault
- `GET/POST /api/vault/experiences`
- `PATCH/DELETE /api/vault/experiences/[id]`
- `POST /api/vault/experiences/reorder`
- `GET/POST /api/vault/bullets`
- `PATCH/DELETE /api/vault/bullets/[id]`
- `POST /api/vault/bullets/reorder`
- `GET/POST /api/vault/skills`
- `PATCH/DELETE /api/vault/skills/[id]`
- `POST /api/vault/parse-resume`
- `POST /api/vault/import`
- `POST /api/vault/import-parsed`
- `POST /api/vault/embed-bullet`
- `POST /api/vault/embed-all`
- `POST /api/vault/check-duplicate`
- `POST /api/vault/extract-skills`
- `GET /api/vault/search`
- `GET /api/vault/tags`
- `POST /api/vault/save`

### Tuner
- `POST /api/tuner/analyze`
- `POST /api/tuner/match`
- `POST /api/tuner/polish`
- `POST /api/tuner/ats-check`
- `GET /api/tuner/jd-history`

### Resumes & history
- `GET/POST /api/resumes`
- `GET/POST /api/resumes/[id]/versions`
- `GET/DELETE /api/resumes/[id]/versions/[versionId]`
- `PATCH /api/resumes/[id]/sent`

### Export
- `POST /api/export/pdf`
- `POST /api/export/docx`
- `POST /api/export-log`

### System
- `GET /api/health`

---

## Known Limitations

1. **DOCX export in UI** — Downloads plain text; toast says native `.docx` is coming soon. Full DOCX API exists at `/api/export/docx`.
2. **PDF export in UI** — Uses browser print, not `/api/export/pdf`.
3. **Single-user local app** — No auth, no multi-user support.
4. **Embedding dependency** — Bullet matching requires embeddings; unembedded bullets won't appear in semantic match results.
5. **Small local models** — Resume parsing includes defensive fallacies for models like `llama3.2`; complex resumes may need manual review after import.
6. **README** — Default Next.js boilerplate only; this document serves as the feature reference.

---

## Quick start

```bash
cd resume-tuner
npm install
npm run db:migrate   # or npm run db:push
npm run dev