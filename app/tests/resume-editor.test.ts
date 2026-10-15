/**
 * The redesigned editor's pure pieces: merging server data into the working
 * copy, what the renderer prints, and the per-section option defaults.
 *
 * The merge tests pin the property the live preview depends on: server data
 * that arrives mid-edit adds what's new without reverting what was typed.
 */

import assert from "node:assert/strict";
import test, { describe } from "node:test";

import { emptyDirty, mergeDraft } from "../src/lib/draft-merge.ts";
import { buildBlocks, hasContent } from "../src/lib/resume-blocks.ts";
import {
  contactOrder,
  formatContactLine,
  sectionOptions,
  type ResolvedEntry,
  type ResolvedResume,
  type ResolvedSection,
} from "../src/lib/resume-model.ts";

const USER = "00000000-0000-0000-0000-000000000001";

function entry(id: number, over: Partial<ResolvedEntry> = {}): ResolvedEntry {
  return {
    id, title: `Role ${id}`, organization: "Acme", subtitle: "", location: "", startDate: "01/2020",
    endDate: "", isCurrent: true, url: "", meta: {}, sourceEntryId: null, isVisible: true,
    bullets: [], ...over,
  };
}

function section(id: number, entries: ResolvedEntry[], over: Partial<ResolvedSection> = {}): ResolvedSection {
  return {
    id, sectionType: "experience", heading: "WORK EXPERIENCE", icon: null, options: {}, layout: "normal",
    isVisible: true, pageBreakAfter: false, entries, skills: [], ...over,
  };
}

function resume(sections: ResolvedSection[]): ResolvedResume {
  return {
    id: 1, name: "R", targetRole: "", targetCompany: "",
    profile: {
      id: 1, userId: USER, fullName: "Ritvik", email: "r@example.com", phone: "+1 (555) 010-2000",
      location: "Boston", links: [{ label: "GitHub", url: "github.com/r" }], summary: "",
      title: "", details: [], contactOrder: [], createdAt: 0, updatedAt: 0,
    },
    summary: "",
    style: {
      id: 1, userId: USER, fontFamily: "serif", baseSize: 10, nameSize: 21, headingSize: 11,
      lineHeight: 1.25, sectionGap: 10, entryGap: 6, bulletGap: 2, marginX: 0.5, marginY: 0.5,
      headingStyle: "rule", accentColor: "#000", pageSize: "letter", datePosition: "right",
      subtitleStyle: "italic",
    },
    sections,
  };
}

describe("merging server data into the working copy", () => {
  test("a field typed locally survives a server reload that predates it", () => {
    const server = resume([section(10, [entry(1, { title: "Engineer" })])]);
    const local = resume([section(10, [entry(1, { title: "Senior Engineer" })])]);
    const dirty = emptyDirty();
    dirty.entries.set(1, new Set(["title"]));

    const merged = mergeDraft(server, local, dirty);
    assert.equal(merged.sections[0]!.entries[0]!.title, "Senior Engineer");
  });

  test("untouched fields and new entries come from the server", () => {
    const server = resume([
      section(10, [entry(1, { title: "Engineer", location: "Remote" }), entry(2, { title: "Pulled from vault" })]),
    ]);
    const local = resume([section(10, [entry(1, { title: "Senior Engineer", location: "" })])]);
    const dirty = emptyDirty();
    dirty.entries.set(1, new Set(["title"]));

    const merged = mergeDraft(server, local, dirty);
    const [a, b] = merged.sections[0]!.entries;
    assert.equal(a!.location, "Remote");
    assert.equal(b!.title, "Pulled from vault");
  });

  test("a local reorder holds; rows only the server has go after it", () => {
    const server = resume([section(10, [entry(1), entry(2), entry(3)])]);
    const local = resume([section(10, [entry(2), entry(1)])]);
    const dirty = emptyDirty();
    dirty.entryOrder.add(10);

    assert.deepEqual(
      mergeDraft(server, local, dirty).sections[0]!.entries.map((e) => e.id),
      [2, 1, 3],
    );
  });

  test("an entry deleted on the server is gone even if it was edited locally", () => {
    const server = resume([section(10, [entry(2)])]);
    const local = resume([section(10, [entry(1, { title: "Edited" }), entry(2)])]);
    const dirty = emptyDirty();
    dirty.entries.set(1, new Set(["title"]));
    dirty.entryOrder.add(10);

    assert.deepEqual(mergeDraft(server, local, dirty).sections[0]!.entries.map((e) => e.id), [2]);
  });

  test("with nothing dirty, the server copy is taken as is", () => {
    const server = resume([section(10, [entry(1, { title: "Server" })])]);
    const local = resume([section(10, [entry(1, { title: "Local" })])]);
    assert.equal(mergeDraft(server, local, emptyDirty()).sections[0]!.entries[0]!.title, "Server");
  });

  test("profile fields merge the same way", () => {
    const server = resume([]);
    const local = { ...server, profile: { ...server.profile, fullName: "Ritvik K", email: "old@x.com" } };
    const dirty = emptyDirty();
    dirty.profile.add("fullName");
    const merged = mergeDraft(server, local, dirty);
    assert.equal(merged.profile.fullName, "Ritvik K");
    assert.equal(merged.profile.email, "r@example.com");
  });
});

describe("what the preview prints", () => {
  test("a brand-new empty entry is left out until it has content", () => {
    const blank = entry(5, { title: "", organization: "" });
    assert.equal(hasContent(blank), false);
    assert.equal(hasContent({ ...blank, title: "E" }), true);

    const blocks = buildBlocks(resume([section(10, [blank])]));
    // Header only: no heading for a section with nothing to print.
    assert.deepEqual(blocks.map((b) => b.kind), ["header"]);
  });

  test("hidden entries and their empty sections drop out, heading included", () => {
    const blocks = buildBlocks(resume([section(10, [entry(1, { isVisible: false })])]));
    assert.ok(!blocks.some((b) => b.kind === "heading"));
  });

  test("entry blocks carry their section's options to the renderer", () => {
    const blocks = buildBlocks(resume([section(10, [entry(1)], { options: { titleJoin: "dash" } })]));
    const e = blocks.find((b) => b.kind === "entry");
    assert.ok(e && e.kind === "entry");
    assert.equal(e.options.titleJoin, "dash");
  });
});

describe("contact line", () => {
  test("default order is the original one, and email/phone become links", () => {
    const items = formatContactLine(resume([]).profile);
    assert.deepEqual(items.map((i) => i.text), ["r@example.com", "+1 (555) 010-2000", "Boston", "GitHub"]);
    assert.equal(items[0]!.href, "mailto:r@example.com");
    assert.equal(items[1]!.href, "tel:+15550102000");
    assert.equal(items[3]!.href, "https://github.com/r");
  });

  test("a saved order is honoured, with unmentioned groups appended", () => {
    assert.deepEqual(contactOrder(["links", "email"]), ["links", "email", "phone", "location", "details"]);
    const p = { ...resume([]).profile, contactOrder: ["location" as const] };
    assert.equal(formatContactLine(p)[0]!.text, "Boston");
  });

  test("details print as label: value, or as a link when the value is a URL", () => {
    const p = {
      ...resume([]).profile,
      details: [
        { label: "Nationality", value: "Indian" },
        { label: "Portfolio", value: "ritvik.dev" },
      ],
    };
    const items = formatContactLine(p);
    assert.ok(items.some((i) => i.text === "Nationality: Indian" && !i.href));
    assert.ok(items.some((i) => i.text === "Portfolio" && i.href === "https://ritvik.dev"));
  });
});

describe("section options", () => {
  test("an old row's {} means every default — the look resumes always had", () => {
    assert.deepEqual(sectionOptions({ options: {} }), {
      titleOrder: "title-first",
      titleJoin: "comma",
      skillsLayout: "lines",
    });
  });
});
