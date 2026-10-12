/**
 * The vault overview's counts and "needs attention" list.
 *
 * Asserts which things are flagged and in what order, not exact strength
 * scores — those come from the heuristic, whose weights are meant to move.
 */

import assert from "node:assert/strict";
import test, { describe } from "node:test";

import { joinSkillTokens, splitSkillTokens } from "../src/lib/skill-index.ts";
import { summarizeVault } from "../src/lib/vault-overview.ts";

const entry = (over: Partial<Parameters<typeof summarizeVault>[0][number]["entries"][number]>) => ({
  id: 1,
  title: "Engineer",
  organization: "",
  startDate: "01/2020",
  endDate: "",
  isCurrent: true,
  information: "",
  bullets: [],
  ...over,
});

const bullet = (id: number, strength: number, isPinned = false) => ({
  id,
  text: `bullet ${id}`,
  strength,
  isPinned,
});

describe("summarizing the vault", () => {
  const sections = [
    {
      id: 10,
      heading: "Experience",
      type: "normal",
      entries: [
        entry({ id: 1, bullets: [bullet(1, 5, true), bullet(2, 1), bullet(3, 2)] }),
        entry({ id: 2, title: "Intern", startDate: "", isCurrent: false }),
      ],
    },
    {
      id: 20,
      heading: "Skills",
      type: "skill",
      entries: [
        entry({ id: 3, title: "Languages", information: "Java | k8s | Python" }),
        entry({ id: 4, title: "Tools", information: "kubernetes, Git" }),
        entry({ id: 5, title: "Empty", information: "" }),
      ],
    },
  ];

  const overview = summarizeVault(sections);

  test("counts everything, skill entries included as entries", () => {
    assert.deepEqual(overview.totals, {
      sections: 2,
      entries: 5,
      bullets: 3,
      pinned: 1,
      skills: overview.skills.length,
    });
  });

  test("buckets bullets by strength", () => {
    assert.equal(overview.strength.reduce((a, b) => a + b, 0), 3);
    assert.equal(overview.strength[4], 1);
  });

  test("skills are deduplicated across entries through the alias table", () => {
    // "k8s" and "kubernetes" are one skill.
    const kube = overview.skills.filter((s) => s.toLowerCase().includes("kube"));
    assert.equal(kube.length, 1);
    assert.ok(overview.skills.includes("Git"));
  });

  test("flags empty entries before weak writing, and the weakest bullet first", () => {
    const kinds = overview.attention.map((a) => a.kind);
    assert.deepEqual(kinds, ["no-bullets", "no-skills", "weak-bullet", "weak-bullet", "no-dates"]);

    const weak = overview.attention.filter((a) => a.kind === "weak-bullet");
    assert.ok(weak[0]!.strength! <= weak[1]!.strength!);
  });

  test("every flag says where it lives, so it can link there", () => {
    for (const item of overview.attention) {
      assert.ok(item.sectionId > 0 && item.entryId > 0);
    }
  });

  test("an empty vault is all zeroes and no flags", () => {
    const empty = summarizeVault([]);
    assert.equal(empty.totals.entries, 0);
    assert.deepEqual(empty.attention, []);
  });
});

describe("skill chips", () => {
  test("split keeps what was typed — no canonicalising, no dropped short names", () => {
    assert.deepEqual(splitSkillTokens("C | k8s, Go\nRust"), ["C", "k8s", "Go", "Rust"]);
  });

  test("repeats are folded ignoring case", () => {
    assert.deepEqual(splitSkillTokens("Java | java | JAVA"), ["Java"]);
  });

  test("a round trip through the chips loses nothing", () => {
    const tokens = ["C", "C++", "Node.js", "SQL Server"];
    assert.deepEqual(splitSkillTokens(joinSkillTokens(tokens)), tokens);
  });
});
