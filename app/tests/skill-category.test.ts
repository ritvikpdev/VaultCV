/**
 * Editing a skills category without losing its vault links.
 *
 * The property that matters most here is negative: an edit must not delete and
 * reinsert a row it could have kept. A reinserted row loses `source_skill_id`,
 * which linked mode reads through and the tuner uses to distinguish "already on
 * this resume" from "available in the vault" — so a silent severing shows up
 * much later as the tuner recommending something already on the page.
 */

import assert from "node:assert/strict";
import test, { describe } from "node:test";

import { parseSkillNames, planSkillRows } from "../src/lib/skill-category.ts";

describe("parsing the skills box", () => {
  test("commas, pipes and newlines all separate", () => {
    assert.deepEqual(parseSkillNames("Claude, Cursor | Copilot\nOllama"), [
      "Claude",
      "Cursor",
      "Copilot",
      "Ollama",
    ]);
  });

  test("the order typed is the order kept", () => {
    // Alphabetising would quietly rewrite which skill leads the line.
    assert.deepEqual(parseSkillNames("Python, Assembly, Go"), [
      "Python",
      "Assembly",
      "Go",
    ]);
  });

  test("duplicates collapse regardless of case", () => {
    assert.deepEqual(parseSkillNames("Claude, claude, CLAUDE"), ["Claude"]);
  });

  test("leading list markers are stripped", () => {
    assert.deepEqual(parseSkillNames("- Claude\n– Cursor\n* Ollama"), [
      "Claude",
      "Cursor",
      "Ollama",
    ]);
  });

  test("multi-word skills survive intact", () => {
    assert.deepEqual(parseSkillNames("Large Language Models, Back Propagation"), [
      "Large Language Models",
      "Back Propagation",
    ]);
  });

  test("noise and empties are dropped", () => {
    assert.deepEqual(parseSkillNames("Go,,  , x , ,Rust"), ["Go", "Rust"]);
  });

  test("an empty box yields an empty list, not a row of nothing", () => {
    assert.deepEqual(parseSkillNames(""), []);
    assert.deepEqual(parseSkillNames("   \n  "), []);
  });
});

describe("planning the writes for an edited category", () => {
  const rows = [
    { id: 1, name: "Claude" },
    { id: 2, name: "Cursor" },
    { id: 3, name: "Ollama" },
  ];

  test("an unchanged list touches nothing but order", () => {
    const plan = planSkillRows(rows, ["Claude", "Cursor", "Ollama"]);
    assert.deepEqual(plan.insert, []);
    assert.deepEqual(plan.remove, []);
    assert.deepEqual(
      plan.keep,
      [
        { id: 1, order: 0, name: null },
        { id: 2, order: 1, name: null },
        { id: 3, order: 2, name: null },
      ],
      "names should be null when unchanged, so no override is written",
    );
  });

  test("reordering keeps every row and only moves it", () => {
    const plan = planSkillRows(rows, ["Ollama", "Claude", "Cursor"]);
    assert.deepEqual(plan.remove, []);
    assert.deepEqual(plan.insert, []);
    assert.deepEqual(
      plan.keep.map((k) => [k.id, k.order]),
      [
        [3, 0],
        [1, 1],
        [2, 2],
      ],
    );
  });

  test("adding one skill inserts one row and disturbs nothing else", () => {
    const plan = planSkillRows(rows, ["Claude", "Cursor", "Ollama", "LangChain"]);
    assert.equal(plan.keep.length, 3);
    assert.deepEqual(plan.remove, []);
    assert.deepEqual(plan.insert, [{ name: "LangChain", order: 3 }]);
  });

  test("removing one skill deletes exactly that row", () => {
    const plan = planSkillRows(rows, ["Claude", "Ollama"]);
    assert.deepEqual(plan.remove, [2]);
    assert.deepEqual(plan.insert, []);
    assert.equal(plan.keep.length, 2);
  });

  test("a case correction is a rename, not a delete plus insert", () => {
    // This is the whole point. "cursor" → "Cursor" must keep row 2, because
    // reinserting it would drop the vault pointer for one capital letter.
    const plan = planSkillRows([{ id: 2, name: "cursor" }], ["Cursor"]);
    assert.deepEqual(plan.insert, []);
    assert.deepEqual(plan.remove, []);
    assert.deepEqual(plan.keep, [{ id: 2, order: 0, name: "Cursor" }]);
  });

  test("a genuine rename is a delete plus an insert", () => {
    // Nothing links "Ollama" to "vLLM"; pretending otherwise would silently
    // point a vault-backed row at a skill the vault never said you had.
    const plan = planSkillRows([{ id: 3, name: "Ollama" }], ["vLLM"]);
    assert.deepEqual(plan.remove, [3]);
    assert.deepEqual(plan.insert, [{ name: "vLLM", order: 0 }]);
    assert.deepEqual(plan.keep, []);
  });

  test("emptying the list removes every row", () => {
    const plan = planSkillRows(rows, []);
    assert.deepEqual(plan.remove, [1, 2, 3]);
    assert.deepEqual(plan.keep, []);
  });

  test("a brand-new category inserts everything", () => {
    const plan = planSkillRows([], ["Claude", "Cursor"]);
    assert.deepEqual(plan.keep, []);
    assert.deepEqual(plan.remove, []);
    assert.deepEqual(plan.insert, [
      { name: "Claude", order: 0 },
      { name: "Cursor", order: 1 },
    ]);
  });

  test("a repeated name claims one row, not two", () => {
    const plan = planSkillRows(rows, ["Claude", "Claude"]);
    assert.equal(plan.keep.length, 1, "row 1 was claimed twice");
    assert.deepEqual(plan.insert, [{ name: "Claude", order: 1 }]);
  });

  test("duplicate rows for one name are reduced, keeping the first", () => {
    // Two rows saying "Go" can exist if one was pulled and one typed. Saving
    // the category should settle on one rather than preserve the duplicate.
    const plan = planSkillRows(
      [
        { id: 7, name: "Go" },
        { id: 8, name: "Go" },
      ],
      ["Go"],
    );
    assert.deepEqual(plan.keep, [{ id: 7, order: 0, name: null }]);
    assert.deepEqual(plan.remove, [8]);
  });

  test("surrounding whitespace never causes a needless rewrite", () => {
    const plan = planSkillRows([{ id: 1, name: "Claude" }], ["  Claude  "]);
    assert.deepEqual(plan.remove, []);
    assert.deepEqual(plan.insert, []);
    assert.equal(plan.keep[0]!.id, 1);
  });
});
