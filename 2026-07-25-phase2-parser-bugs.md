# Phase 2 — heuristic parser bugs found in browser testing

The import wizard itself is good: no-key path works, the `source` badge reads
"Parsed locally", review checkboxes and section dropdowns work, profile action
defaults to the safe "Keep what's in the vault", duplicate annotation is wired,
counts are right (5 entries, 4 bullets). `npm run test` passes 37 and
`npm run build` is green.

**The wrapper is correct. The field extraction inside `heuristic-parse.ts` is
not.** Verified by pasting Ritvik's actual resume into `/vault/import` on
localhost. Nothing was saved to the vault.

Note on why the existing tests didn't catch any of this: `tests/heuristic-parse.test.ts`
asserts section assignment and bullet counts, which are the parts that work.
None of the cases assert `organization`, `location`, or skill `category`.

---

## 1. `organization` and `location` are never populated (highest impact)

Every entry puts the whole header line into `title` and leaves `organization`
and `location` empty.

Observed:

```
title = "Master's in Computer Science George Washington University Washington DC USA"
organization = ""
location = ""
```

Expected:

```
title = "Master's in Computer Science"
organization = "George Washington University"
location = "Washington DC, USA"
```

Same for all four other entries — `"Software Engineer Analyst Accenture Hyderabad India"`,
`"Software Development Intern Agilite Global Solutions Company LLC Remote"`, etc.

**Cause:** punctuation is being stripped before the header is split, so the comma
that separates title from organization is gone by the time the split runs. The
corrections doc specified "split on the first `,` or `|` or ` at `" — that split
needs to happen on the **raw** line.

**Fix order for a header line:**

1. Pull the date range off the line first (it's always trailing), record it.
2. Whatever trails after the date, delimited by `|`, is the location.
3. In the remaining text, split on the **first** comma → `title`, `organization`.
4. Only then trim whitespace. Never strip commas, periods or hyphens from these
   fields — `"Agilite Global Solutions Company, LLC"` and `"Washington DC, USA"`
   both legitimately contain commas, so split on the *first* one only.

---

## 2. Skill category parsing is broken, and category labels become skill names

Input line:

```
Languages - Java | C# | Python | JavaScript, Frameworks - Spring Boot | Hibernate | ReactJS | NextJS, Databases - MySQL | MS SQL Server | Oracle SQL Developer, Tools & Technologies - Git | Maven | Jenkins
```

Produced 14 skills, **every one categorised "Languages"**, and three of the
"skills" are actually category labels:

```
Java[Languages]  C#[Languages]  Python[Languages]  JavaScript[Languages]
"Frameworks - Spring Boot"[Languages]   ← category label became a skill name
Hibernate[Languages]  React[Languages]  Next.js[Languages]
"Databases - MySQL"[Languages]          ← same
MS SQL Server[Languages]  Oracle[Languages]
"Tools & Technologies - Git"[Languages] ← same
Maven[Languages]  Jenkins[Languages]
```

**Cause:** the line is split on `,` first, producing chunks like
`"Frameworks - Spring Boot | Hibernate | ReactJS | NextJS"`. The `Category - a | b`
pattern is then only recognised on the first chunk; later chunks keep the
inherited category and their leading `"Frameworks - Spring Boot"` is treated as
one skill name.

**Fix:** parse category groups first, then skills within each group.

1. Split the line on the pattern `,\s*(?=[A-Z][A-Za-z& ]{2,30}\s*[-—–]\s*)` — i.e.
   only on commas that are followed by a new `Label -` prefix.
2. For each group, split off the label at the first `-`/`—`/`–`, use it as the
   category for that group only.
3. Split the group's remainder on `|` and `,`.
4. Run each token through `findAliasSeed()`; if it resolves, prefer the seed's
   canonical name and category over the parsed label.

This matters beyond cosmetics — Phase 6 weights matches by category, so
mis-filed skills degrade tuning quality.

---

## 3. Dates are invented

`GoLlama, Distributed LLM inference system built in Go      2025` produced
`startDate = "01/2025"` and rendered as `01/2025 – ?`.

There is no January in the source. The prompt sent to Claude explicitly says
"Do not invent dates" — the heuristic must hold to the same rule.

**Fix:** a bare `YYYY` has no month. Either leave both dates empty and put the
year in `meta.year`, or extend `coerceMonthYear` to return `""` for a bare year
rather than defaulting the month to `01`. Also render an unknown end date as
blank, not `?`.

---

## 4. Phone and location are not extracted from the contact block

`ritvikp@gwu.edu | (202) 509-6272 | Arlington, Virginia, USA | ritvikdev.com`
yielded name and email only; the review header shows `Ritvik Kumar Panchbhaiya ·
ritvikp@gwu.edu · —`.

The phone regex isn't matching `(202) 509-6272` (parenthesised area code), and
nothing attempts location. Since the contact line is pipe-delimited, split on `|`
and classify each field: contains `@` → email; matches a phone pattern including
`(###) ###-####` → phone; contains `linkedin.com`/`github.com`/a bare domain →
link; otherwise, if it contains a comma and no digits → location.

---

## 5. Punctuation stripping mangles text generally

`nuBoF, AI-powered nutrition tracking app` became `"nuBoF AI powered nutrition tracking"`
— lost the hyphen and the trailing word.

Normalisation is fine for *matching* (that's what `similarity.ts` is for) but
must never be applied to text that gets stored. Keep a raw copy of every line and
extract fields from that; use the normalised form only for comparisons.

---

## Regression tests to add

Extend `tests/heuristic-parse.test.ts` — the current cases only assert section
assignment and bullet counts, which is why all of the above passed:

- Header `"Software Engineer Analyst, Accenture   10/2022 - 07/2025 | Hyderabad, India"`
  → assert `title`, `organization` and `location` individually.
- Header with a comma inside the org: `"..., Agilite Global Solutions Company, LLC"`
  → org must be `"Agilite Global Solutions Company, LLC"`, not truncated at the
  second comma.
- The full four-group skills line above → assert 13 skills with four distinct
  categories, and assert that no skill name contains `" - "`.
- A bare `2025` date → assert `startDate === ""`, not `"01/2025"`.
- Contact line with `(202) 509-6272` → assert phone and location are extracted.

Assert the fields, not just the counts.
