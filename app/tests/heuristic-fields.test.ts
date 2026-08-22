/**
 * Field-level regression tests for the heuristic parser.
 *
 * `heuristic-parse.test.ts` covers section assignment and bullet counts. Those
 * passed while the parser was still emitting an empty `organization` for every
 * entry and filing all fourteen skills under one wrong category — because
 * nothing asserted the fields themselves. These do.
 *
 * The fixtures are lifted from a real resume, not invented, so the shapes are
 * ones the parser will actually meet.
 */

import assert from "node:assert/strict";
import test, { describe } from "node:test";

import { parseResumeHeuristically } from "../src/lib/heuristic-parse.ts";
import { extractSkills } from "../src/lib/skill-index.ts";

describe("entry headers", () => {
  test("splits title, organization and location around the date", () => {
    const { entries } = parseResumeHeuristically(
      [
        "WORK EXPERIENCE",
        "Software Engineer Analyst, Accenture       10/2022 - 07/2025 | Hyderabad, India",
        "- Engineered Spring Boot microservices reducing latency by 35%.",
      ].join("\n"),
    );

    assert.equal(entries.length, 1);
    const e = entries[0]!;
    assert.equal(e.title, "Software Engineer Analyst");
    assert.equal(e.organization, "Accenture");
    assert.equal(e.location, "Hyderabad, India");
    assert.equal(e.startDate, "10/2022");
    assert.equal(e.endDate, "07/2025");
    assert.equal(e.isCurrent, false);
  });

  test("an organization containing a comma is not truncated", () => {
    const { entries } = parseResumeHeuristically(
      [
        "WORK EXPERIENCE",
        "Software Development Intern, Agilite Global Solutions Company, LLC      02/2022 - 06/2022 | Remote",
      ].join("\n"),
    );

    const e = entries[0]!;
    assert.equal(e.title, "Software Development Intern");
    assert.equal(
      e.organization,
      "Agilite Global Solutions Company, LLC",
      "split on the first comma only — the org's own comma must survive",
    );
    assert.equal(e.location, "Remote");
  });

  test("'Present' sets isCurrent and leaves endDate empty", () => {
    const { entries } = parseResumeHeuristically(
      [
        "EDUCATION",
        "Master's in Computer Science, George Washington University   08/2025 - Present | Washington DC, USA",
      ].join("\n"),
    );

    const e = entries[0]!;
    assert.equal(e.title, "Master's in Computer Science");
    assert.equal(e.organization, "George Washington University");
    assert.equal(e.location, "Washington DC, USA");
    assert.equal(e.isCurrent, true);
    assert.equal(e.endDate, "");
  });

  test("in a section with no employer, the text after the comma is a subtitle", () => {
    const { entries } = parseResumeHeuristically(
      [
        "PROJECTS",
        "GoLlama, Distributed LLM inference system built in Go      2025",
        "- Architected a hub-and-spoke model for horizontal scaling.",
      ].join("\n"),
    );

    const e = entries[0]!;
    assert.equal(e.title, "GoLlama");
    assert.equal(e.subtitle, "Distributed LLM inference system built in Go");
    assert.equal(e.organization, "", "projects have no employer");
  });
});

describe("dates", () => {
  test("a bare year stays a bare year — no invented month", () => {
    const { entries } = parseResumeHeuristically(
      ["PROJECTS", "nuBoF, AI-powered nutrition tracking app      2026"].join("\n"),
    );

    assert.equal(entries[0]!.startDate, "2026");
    assert.notEqual(entries[0]!.startDate, "01/2026");
  });

  test("hyphens inside the title survive", () => {
    const { entries } = parseResumeHeuristically(
      ["PROJECTS", "nuBoF, AI-powered nutrition tracking app      2026"].join("\n"),
    );
    assert.equal(entries[0]!.subtitle, "AI-powered nutrition tracking app");
  });
});

describe("skills", () => {
  const LINE =
    "Languages - Java | C# | Python | JavaScript, Frameworks - Spring Boot | Hibernate | ReactJS | NextJS, Databases - MySQL | MS SQL Server | Oracle SQL Developer, Tools & Technologies - Git | Maven | Jenkins";

  /**
   * Skills are now ENTRIES, matching the reference tool: one entry per labelled
   * group, where the label is the title and the list is `information`. The
   * individual technologies are derived from that text by `extractSkills`,
   * which is what the tuner matches against.
   */
  test("each labelled group becomes its own entry", () => {
    const { entries } = parseResumeHeuristically(`TECHNICAL SKILLS\n${LINE}`);

    const titles = entries.map((e) => e.title);
    assert.deepEqual(titles, ["Languages", "Frameworks", "Databases", "Tools & Technologies"]);
  });

  test("every skill entry lands in a skill-type section named by the resume", () => {
    const { entries } = parseResumeHeuristically(`TECHNICAL SKILLS\n${LINE}`);

    for (const e of entries) {
      assert.equal(e.sectionType, "skill");
      assert.equal(e.sectionHeading, "TECHNICAL SKILLS");
    }
  });

  test("the sub-skills stay with their own label", () => {
    const { entries } = parseResumeHeuristically(`TECHNICAL SKILLS\n${LINE}`);
    const byTitle = new Map(entries.map((e) => [e.title, e.information]));

    assert.match(byTitle.get("Languages") ?? "", /Java/);
    assert.match(byTitle.get("Frameworks") ?? "", /Spring Boot/);
    assert.match(byTitle.get("Databases") ?? "", /MySQL/);
    assert.match(byTitle.get("Tools & Technologies") ?? "", /Jenkins/);

    // The old bug: everything ended up under the first label.
    assert.ok(!/Spring Boot/.test(byTitle.get("Languages") ?? ""));
  });

  test("extraction resolves aliases to canonical names", () => {
    const { entries } = parseResumeHeuristically(`TECHNICAL SKILLS\n${LINE}`);
    const frameworks = entries.find((e) => e.title === "Frameworks")!;
    const names = extractSkills(frameworks.information).map((s) => s.name);

    assert.ok(names.includes("React"), "ReactJS should canonicalize to React");
    assert.ok(names.includes("Next.js"), "NextJS should canonicalize to Next.js");
  });

  test("a list with no label becomes one entry named after the section", () => {
    const { entries } = parseResumeHeuristically("TECHNICAL SKILLS\nJava, Python, Go");

    assert.equal(entries.length, 1);
    assert.equal(entries[0]!.title, "TECHNICAL SKILLS");
    assert.equal(extractSkills(entries[0]!.information).length, 3);
  });
});

describe("contact block", () => {
  const HEADER = [
    "Ritvik Kumar Panchbhaiya",
    "ritvikp@gwu.edu | (202) 509-6272 | Arlington, Virginia, USA | ritvikdev.com",
    "",
    "EDUCATION",
    "B.Tech in Information Technology, Sikkim Manipal Institute Of Technology  08/2018 - 05/2022 | Sikkim, India",
  ].join("\n");

  test("pulls every field out of one pipe-delimited line", () => {
    const { profile } = parseResumeHeuristically(HEADER);

    assert.equal(profile?.fullName, "Ritvik Kumar Panchbhaiya");
    assert.equal(profile?.email, "ritvikp@gwu.edu");
    assert.equal(profile?.phone, "(202) 509-6272");
    assert.equal(profile?.location, "Arlington, Virginia, USA");
  });

  test("a personal domain is captured as a link", () => {
    const { profile } = parseResumeHeuristically(HEADER);
    assert.ok(profile?.links?.some((l) => l.url.includes("ritvikdev.com")));
  });
});

describe("annotations", () => {
  test("a GPA line annotates the entry above instead of creating a section", () => {
    const { entries } = parseResumeHeuristically(
      [
        "EDUCATION",
        "B.Tech in Information Technology, Sikkim Manipal Institute Of Technology   08/2018 - 05/2022 | Sikkim, India",
        "C.G.P.A: 8.9",
      ].join("\n"),
    );

    assert.equal(entries.length, 1, "the GPA line must not become its own entry");
    assert.match(entries[0]!.subtitle, /8\.9/);
  });
});
