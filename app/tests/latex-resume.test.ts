/**
 * The LaTeX / Deedy resume layout.
 *
 * This is one of the most widely used résumé templates, and it broke the parser
 * in three separate ways that a hand-written fixture never would have shown:
 *
 *   1. Entry headers span TWO lines — employer and location, then role and
 *      dates — which read naively produces two entries per job.
 *   2. Columns are positioned, not delimited. The PDF extractor emits a tab
 *      where the template pushed text to the right margin.
 *   3. Long bullets wrap onto continuation lines carrying no bullet glyph, and
 *      each continuation looked like a fresh entry.
 *
 * The fixture below is the real extractor output for a real PDF, tabs and all.
 */

import assert from "node:assert/strict";
import test, { describe } from "node:test";

import { parseResumeHeuristically } from "../src/lib/heuristic-parse.ts";
import { findGluedRuns } from "../src/lib/pdf-text.ts";
import { extractSkills } from "../src/lib/skill-index.ts";

/** Verbatim extractor output. `\t` marks a detected column break. */
const DEEDY = [
  "Ritvik Kumar Panchbhaiya",
  "ritvikp@gwu.edu • (202) 509-6272 • Arlington, VA • ritvikdev.com",
  "EDUCATION",
  "George Washington University\tWashington, DC",
  "Master of Science in Computer Science; GPA: 3.62/4.0\tAugust 2025 – May 2027",
  "Sikkim Manipal Institute of Technology\tSikkim, India",
  "Bachelor of Technology in Information Technology; GPA: 8.94/10\tAugust 2018 – May 2022",
  "SKILLS",
  "Languages: Java, Go, Python, C#, JavaScript, TypeScript",
  "Frameworks: Thymeleaf, Spring Boot, Hibernate, ReactJS, NextJS, .NET",
  "Databases: MySQL, MS SQL Server, Oracle SQL Developer",
  "WORK EXPERIENCE",
  "Accenture\tHyderabad, India",
  "Software Engineer\tOctober 2022 – July 2025",
  "• Built backend services for the global Payment Services Hub, supporting reliable processing",
  "of high-volume international payment transactions",
  "• Improved data processing performance by optimizing Hibernate queries, indexing, and batch",
  "operations, and resolved internationalization issues.",
  "PROJECTS",
  "GoLlama | Distributed LLM inference system in Go",
  "• Architected a hub-and-spoke distributed system with a fault-tolerant worker pool, round-robin",
  "load balancing, and automatic health monitoring.",
  "nuBoF | AI-Powered Nutrition Tracking App",
  "• Built a full-stack precision nutrition app using Next.js and Supabase.",
].join("\n");

describe("two-line entry headers", () => {
  const { entries } = parseResumeHeuristically(DEEDY);

  test("employer and role collapse into one entry, not two", () => {
    const work = entries.filter((e) => e.sectionHeading === "WORK EXPERIENCE");
    assert.equal(work.length, 1, `expected 1 job, got ${work.length}`);
  });

  test("the role is the title and the employer is the organization", () => {
    const job = entries.find((e) => e.sectionHeading === "WORK EXPERIENCE")!;
    assert.equal(job.title, "Software Engineer");
    assert.equal(job.organization, "Accenture");
    assert.equal(job.location, "Hyderabad, India");
    assert.equal(job.startDate, "10/2022");
    assert.equal(job.endDate, "07/2025");
  });

  test("education reads the same way", () => {
    const edu = entries.filter((e) => e.sectionHeading === "EDUCATION");
    assert.equal(edu.length, 2);
    assert.equal(edu[0]!.organization, "George Washington University");
    assert.equal(edu[0]!.location, "Washington, DC");
    assert.match(edu[0]!.title, /Master of Science/);
  });
});

describe("wrapped bullets", () => {
  const { entries } = parseResumeHeuristically(DEEDY);

  test("continuation lines rejoin their bullet instead of becoming entries", () => {
    const job = entries.find((e) => e.sectionHeading === "WORK EXPERIENCE")!;
    assert.equal(job.bullets.length, 2, "each wrapped bullet must stay one bullet");
    assert.match(job.bullets[0]!.text, /supporting reliable processing of high-volume/);
  });

  test("a lowercase line after a FINISHED sentence still starts a new entry", () => {
    // "nuBoF" begins lowercase and follows a bullet ending in a full stop.
    // Treating every lowercase line as a continuation would swallow it.
    const projects = entries.filter((e) => e.sectionHeading === "PROJECTS");
    assert.equal(projects.length, 2);
    assert.deepEqual(
      projects.map((p) => p.title),
      ["GoLlama", "nuBoF"],
    );
  });
});

describe("skills with colon labels", () => {
  const { entries } = parseResumeHeuristically(DEEDY);
  const skills = entries.filter((e) => e.sectionHeading === "SKILLS");

  test("each label becomes its own skill entry", () => {
    assert.deepEqual(
      skills.map((s) => s.title),
      ["Languages", "Frameworks", "Databases"],
    );
    for (const s of skills) assert.equal(s.sectionType, "skill");
  });

  test("aliases resolve, including dotted names", () => {
    const frameworks = skills.find((s) => s.title === "Frameworks")!;
    const names = extractSkills(frameworks.information).map((n) => n.name);

    assert.ok(names.includes("React"), "ReactJS → React");
    assert.ok(names.includes("Next.js"), "NextJS → Next.js");
    assert.ok(names.includes("ASP.NET Core"), ".NET → ASP.NET Core");
  });
});

describe("wrapped skill lines", () => {
  /**
   * Skills wrap the same way bullets do, and the continuation has no label:
   *
   *   AI and Tools: Prompt Engineering, LLM API integration, ... Vercel
   *   AI SDK, llama.cpp
   *
   * Treated as a new line it became a phantom skill entry titled after
   * whatever the wrap happened to land on.
   */
  const WRAPPED = [
    "SKILLS",
    "AI and Tools: Prompt Engineering, LLM API integration, Google Gemini, Vercel",
    "AI SDK, llama.cpp",
    "Programming Languages: Python, SQL, JavaScript",
  ].join("\n");

  const { entries } = parseResumeHeuristically(WRAPPED);

  test("a continuation without a label joins the entry above", () => {
    assert.equal(entries.length, 2, `expected 2 skill entries, got ${entries.length}`);
    assert.deepEqual(
      entries.map((e) => e.title),
      ["AI and Tools", "Programming Languages"],
    );
  });

  test("the wrapped content lands in the right entry", () => {
    const tools = entries.find((e) => e.title === "AI and Tools")!;
    assert.match(tools.information, /llama\.cpp/);

    const langs = entries.find((e) => e.title === "Programming Languages")!;
    assert.ok(!/llama\.cpp/.test(langs.information), "wrap leaked into the next label");
  });

  test("a long label is still recognised as a label", () => {
    // Glued extraction can produce a 34-character label. Rejecting it for
    // length made its contents leak into the previous entry.
    const { entries: e } = parseResumeHeuristically(
      ["SKILLS", "CustomerExperienceandCommunication: Inclusivity, positive engagement"].join("\n"),
    );
    assert.equal(e.length, 1);
    assert.equal(e[0]!.title, "CustomerExperienceandCommunication");
  });
});

describe("unrecoverable spacing", () => {
  test("glued runs are detected so the user is warned rather than surprised", () => {
    const glued = findGluedRuns(
      "• BuiltbackendservicesforBankofAmericasglobalPaymentServicesHub, supporting work",
    );
    assert.equal(glued.length, 1);
  });

  test("ordinary text is not flagged", () => {
    assert.deepEqual(findGluedRuns(DEEDY), []);
  });
});
