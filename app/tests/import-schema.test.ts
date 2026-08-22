import assert from "node:assert/strict";
import test from "node:test";

import { coerceMonthYear, ParsedImportSchema } from "../src/lib/import-schema.ts";

test("coerceMonthYear passes through already-correct MM/YYYY", () => {
  assert.equal(coerceMonthYear("06/2022"), "06/2022");
});

test("coerceMonthYear normalizes ISO-ish YYYY-MM", () => {
  assert.equal(coerceMonthYear("2022-06"), "06/2022");
});

test("coerceMonthYear normalizes full and abbreviated month names", () => {
  assert.equal(coerceMonthYear("June 2022"), "06/2022");
  assert.equal(coerceMonthYear("Jun 2022"), "06/2022");
  assert.equal(coerceMonthYear("Jun. 2022"), "06/2022");
});

test("coerceMonthYear keeps a bare year as a bare year", () => {
  // Deliberately not "01/2022". Defaulting the month invents data that isn't in
  // the resume; the vault's date field accepts "YYYY" so nothing is lost.
  assert.equal(coerceMonthYear("2022"), "2022");
});

test("coerceMonthYear returns empty string for empty or unreadable input", () => {
  assert.equal(coerceMonthYear(""), "");
  assert.equal(coerceMonthYear(undefined), "");
  assert.equal(coerceMonthYear("Present"), "");
  assert.equal(coerceMonthYear("sometime last year"), "");
});

test("ParsedImportSchema accepts a well-formed payload", () => {
  const parsed = ParsedImportSchema.safeParse({
    profile: { fullName: "Ritvik Kumar", email: "ritvik@example.com" },
    entries: [
      {
        sectionHeading: "WORK EXPERIENCE",
        sectionType: "normal",
        title: "Software Engineer",
        organization: "Example Corp",
        startDate: "06/2022",
        endDate: "",
        isCurrent: true,
        bullets: [{ text: "Shipped a thing" }],
      },
    ],
  });
  assert.equal(parsed.success, true);
});

test("ParsedImportSchema accepts an empty import (no profile, no content)", () => {
  const parsed = ParsedImportSchema.safeParse({ entries: [] });
  assert.equal(parsed.success, true);
});

test("ParsedImportSchema rejects an unknown section type", () => {
  const parsed = ParsedImportSchema.safeParse({
    entries: [{ sectionHeading: "Hobbies", sectionType: "hobbies", title: "Something" }],
  });
  assert.equal(parsed.success, false);
});

test("ParsedImportSchema rejects an entry with no title", () => {
  const parsed = ParsedImportSchema.safeParse({
    entries: [{ sectionHeading: "WORK EXPERIENCE", sectionType: "normal", title: "" }],
  });
  assert.equal(parsed.success, false);
});

test("a skills line parses as an entry, not a separate skills array", () => {
  // Skills are entries now: the label is the title, the list is `information`.
  const parsed = ParsedImportSchema.safeParse({
    entries: [
      {
        sectionHeading: "TECHNICAL SKILLS",
        sectionType: "skill",
        title: "Languages",
        information: "Java | C# | Python",
      },
    ],
  });

  assert.equal(parsed.success, true);
  assert.equal(parsed.data?.entries[0]?.information, "Java | C# | Python");
});

test("ParsedImportSchema rejects an entry with no section heading", () => {
  const parsed = ParsedImportSchema.safeParse({
    entries: [{ sectionHeading: "", sectionType: "normal", title: "Something" }],
  });
  assert.equal(parsed.success, false);
});
