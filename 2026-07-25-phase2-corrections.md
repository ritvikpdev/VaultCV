# Phase 2 plan — corrections before implementing

Review of `streamed-bubbling-lighthouse.md`. The plan is sound and the
`pdf-parse` version analysis is correct — keep `1.1.4`, keep the reasoning about
`@napi-rs/canvas`. Four changes required, then proceed.

---

## 1. Import must work with no API key (blocking)

**The plan makes import fully AI-gated. Reverse this.**

Ritvik has no `ANTHROPIC_API_KEY` and won't for a while. As written, `/vault/import`
renders a "add a key" notice and does nothing else, so Phase 2 delivers no usable
value to its only user, and the vault still has to be typed by hand.

The plan's justification — that CLAUDE.md's no-AI-gating list doesn't name import —
is technically right but misses why the rule exists. **The mandatory review screen
is precisely what makes a crude parser safe.** v1's regex fallback was dangerous
because it fed a pipeline with no review. Here every parsed item is a checkbox the
user approves before it touches the DB. A parser that is 70% correct under review
is a large win over manual entry; it is not a correctness risk.

### Required shape

One interface, two implementations, chosen at call time:

```ts
// src/lib/import-parse.ts
export type ParseSource = "claude" | "heuristic";

export async function parseResumeText(
  text: string,
): Promise<{ result: ParsedImport; source: ParseSource }>;
```

- No key → heuristic parser. Always available, never throws for lack of a key.
- Key present → Claude tool-use call. On **any** failure (network, malformed
  response, Zod rejection) fall back to the heuristic and return
  `source: "heuristic"`. Import must never dead-end.
- Surface `source` in the review UI: *"Parsed locally — add an API key in Settings
  for better accuracy"* vs *"Parsed with Claude."*

The review screen, duplicate annotation and save path are identical either way.
Only parse quality differs.

### Heuristic parser scope

`src/lib/heuristic-parse.ts`, pure and unit-testable, no `server-only`:

- **Section headers** — a line that is ALL CAPS, or title case and short (< 40
  chars) with no terminal punctuation, matched against `SECTION_DEFS` labels and
  common synonyms (`WORK EXPERIENCE` / `PROFESSIONAL EXPERIENCE` / `EMPLOYMENT` →
  `experience`). Unrecognized headers → `custom`.
- **Bullets** — lines starting with `•`, `-`, `–`, `*`, `‣`, or `o` followed by
  whitespace. Strip the glyph.
- **Entry headers** — a non-bullet line inside a section that contains a date
  range. Split title from organization on the first `,` or `|` or ` at `.
- **Dates** — extract `MM/YYYY`, `Month YYYY`, `YYYY`, and ranges joined by
  `-`, `–`, `to`. Normalize through the same `coerceMonthYear` the plan already
  specifies. `Present` / `Current` / `Now` → `isCurrent: true`.
- **Contact block** — before the first recognized section header, pull email via
  regex, phone via regex, and treat a line containing `linkedin.com` /
  `github.com` as a link.
- **Skills** — inside a skills section, split on `,` `|` `•` and on the
  `Category — a, b, c` pattern visible in the reference resumes. Run each token
  through `findAliasSeed()` so recognized skills get their category and aliases.

Do not attempt to be clever. Wrong guesses are cheap; the user unchecks them.

---

## 2. `profileSchema` cannot be exported from `settings/actions.ts`

That file starts with `"use server"`, and Next.js permits **only async function
exports** from such modules. Exporting a Zod schema fails the build with
*"Only async functions are allowed to be exported in a 'use server' file."*

Move it to `src/lib/profile-schema.ts` (plain module, no directive) and import it
from both `settings/actions.ts` and the import save action.

---

## 3. `pdf-parse@1.1.4` entry point breaks under bundling

`index.js` contains a debug block gated on `!module.parent` that reads
`./test/data/05-versions-space.pdf`. Under Next's bundling `module.parent` is
undefined, so it runs and throws `ENOENT`.

Two changes:

```ts
// src/lib/pdf-extract.ts — import the library file, not the package entry point
import pdfParse from "pdf-parse/lib/pdf-parse.js";
```

```js
// next.config.mjs
serverExternalPackages: ["better-sqlite3", "puppeteer", "pdf-parse"],
```

---

## 4. Handle PDFs with no text layer

A scanned or image-only PDF extracts to an empty or whitespace string. The plan
sends that straight to the parser and produces a silently empty review screen.

After extraction, if the text has fewer than ~100 non-whitespace characters,
return a typed failure: *"This PDF has no selectable text — it's likely a scan.
Paste the text instead, or use a PDF exported from a resume builder."* No OCR;
out of scope.

---

## 5. Minor

- Duplicate detection should also compare parsed bullets **against each other**,
  not just against the existing vault — importing two overlapping resumes in one
  pass otherwise inserts both copies.
- Add `tests/heuristic-parse.test.ts` covering: a resume with ALL-CAPS headers, one
  with title-case headers, bullets using three different glyphs, `Present` as an
  end date, and a `Category — a, b, c` skills line. Assert section assignment and
  bullet counts, not exact text.

---

## Unchanged from the original plan

Everything else stands: `/vault/import` as a route not a modal, Zod re-validation
of the Claude response, deterministic Jaccard duplicate detection with no
embeddings, reusing `createEntry` / `createBullet` / `createSkill` rather than
duplicating insert logic, and the verification steps.
