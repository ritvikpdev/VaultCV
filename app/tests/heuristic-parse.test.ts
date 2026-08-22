import assert from "node:assert/strict";
import test from "node:test";

import { parseResumeHeuristically } from "../src/lib/heuristic-parse.ts";

test("recognizes ALL-CAPS section headers and files entries under them", () => {
  const text = `
Jane Doe
jane@example.com

WORK EXPERIENCE
Software Engineer, Acme Corp
06/2020 - Present
• Built a thing
• Shipped another thing

EDUCATION
BS Computer Science, State University
08/2016 - 05/2020
`;

  const result = parseResumeHeuristically(text);

  // Filtered by the resume's OWN heading — the whole point of the change.
  const experience = result.entries.filter((e) => e.sectionHeading === "WORK EXPERIENCE");
  const education = result.entries.filter((e) => e.sectionHeading === "EDUCATION");

  assert.equal(experience.length, 1);
  assert.equal(experience[0]!.bullets.length, 2);
  assert.equal(education.length, 1);
  assert.equal(result.profile?.email, "jane@example.com");
});

test("recognizes common title-case section headers via synonyms", () => {
  const text = `
John Smith
john@example.com

Work Experience
Product Manager, Widget Inc
Jan 2019 - Dec 2021
- Led a cross-functional team

Education
MBA, Business School
2017 - 2019
`;

  const result = parseResumeHeuristically(text);

  const experience = result.entries.filter((e) => e.sectionHeading === "Work Experience");
  const education = result.entries.filter((e) => e.sectionHeading === "Education");

  assert.equal(experience.length, 1);
  assert.equal(experience[0]!.bullets.length, 1);
  assert.equal(education.length, 1);
});

test("strips three different bullet glyphs and counts all of them", () => {
  const text = `
WORK EXPERIENCE
Software Engineer, Acme Corp
06/2020 - Present
• Bullet with a dot glyph
* Bullet with a star glyph
o Bullet with a letter-o glyph
`;

  const result = parseResumeHeuristically(text);
  const [entry] = result.entries;

  assert.equal(entry!.bullets.length, 3);
  for (const bullet of entry!.bullets) {
    assert.ok(!/^[-•*‣o]/.test(bullet.text), `glyph should be stripped from: "${bullet.text}"`);
  }
});

test("Present as an end date sets isCurrent true with no endDate", () => {
  const text = `
WORK EXPERIENCE
Software Engineer, Acme Corp
06/2020 - Present
• Did the work
`;

  const result = parseResumeHeuristically(text);
  const [entry] = result.entries;

  assert.equal(entry!.isCurrent, true);
  assert.equal(entry!.endDate, "");
  assert.equal(entry!.startDate, "06/2020");
});

test("an em-dash skills line becomes one entry labelled by its group", () => {
  const text = `
TECHNICAL SKILLS
Must-Have — React, Django, Flask
`;

  const result = parseResumeHeuristically(text);

  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0]!.title, "Must-Have");
  assert.equal(result.entries[0]!.sectionType, "skill");
  assert.match(result.entries[0]!.information, /React/);
});

test("a plain-hyphen skills line keeps its label out of the list", () => {
  const text = `
TECHNICAL SKILLS
Languages - Python, TypeScript, Go
`;

  const result = parseResumeHeuristically(text);

  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0]!.title, "Languages");
  assert.match(result.entries[0]!.information, /Python/);
  assert.ok(
    !/Languages/.test(result.entries[0]!.information),
    "the label leaked into the sub-skills",
  );
});

test("a forced section skips header detection and files everything under it", () => {
  const text = `
Personal Site, self-directed
2022
• Built a thing
• Shipped another thing
`;

  const result = parseResumeHeuristically(text, {
    heading: "Side Projects",
    type: "normal",
  });

  assert.equal(result.entries.length, 1);
  // The heading is the user's own words, not a mapped-on type.
  assert.equal(result.entries[0]!.sectionHeading, "Side Projects");
  assert.equal(result.entries[0]!.bullets.length, 2);
});
