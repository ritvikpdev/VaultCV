/**
 * Resolving a vault item to "Group → Section".
 */

import assert from "node:assert/strict";
import test, { describe } from "node:test";

import {
  buildVaultIndex,
  formatPath,
  pathOfEntry,
  pathOfSection,
  pathOfSkill,
} from "../src/lib/vault-path.ts";

const index = buildVaultIndex({
  groups: [
    { id: 1, name: "Work Experience" },
    { id: 2, name: "Skills" },
  ],
  sections: [
    { id: 10, heading: "SDE Experience", groupId: 1 },
    { id: 11, heading: "AI/ML Experience", groupId: 1 },
    { id: 20, heading: "Web Dev Skills", groupId: 2 },
    { id: 30, heading: "Old Section", groupId: null },
  ],
  entries: [
    { id: 100, sectionId: 10 },
    { id: 200, sectionId: 20 },
    { id: 300, sectionId: 30 },
  ],
  skills: [
    { id: 7, sourceEntryId: 200 },
    { id: 8, sourceEntryId: 999 },
  ],
});

describe("vault paths", () => {
  test("an entry resolves through its section to its group", () => {
    assert.deepEqual(pathOfEntry(index, 100), { group: "Work Experience", section: "SDE Experience" });
  });

  test("a derived skill resolves through the entry it came from", () => {
    assert.deepEqual(pathOfSkill(index, 7), { group: "Skills", section: "Web Dev Skills" });
  });

  test("a section filed before groups were required has no group, not a wrong one", () => {
    assert.deepEqual(pathOfEntry(index, 300), { group: null, section: "Old Section" });
    assert.equal(formatPath(pathOfEntry(index, 300)!), "Old Section");
  });

  test("unknown or missing ids resolve to null rather than throwing", () => {
    // A hand-typed resume entry has no source; a deleted vault entry leaves a
    // dangling id; a skill whose entry is gone has nowhere to point.
    assert.equal(pathOfEntry(index, null), null);
    assert.equal(pathOfEntry(index, 12345), null);
    assert.equal(pathOfSkill(index, 8), null);
    assert.equal(pathOfSection(index, undefined), null);
  });

  test("formats as group then section", () => {
    assert.equal(formatPath(pathOfSection(index, 11)!), "Work Experience → AI/ML Experience");
  });
});
