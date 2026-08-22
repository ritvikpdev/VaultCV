/**
 * Schema integrity tests.
 *
 * Run: npm run test  (generates DDL from schema.ts first — see package.json)
 *
 * These run against Node's built-in SQLite rather than better-sqlite3, so they
 * work on any machine without a native build step. What they verify is the DDL
 * that drizzle-kit generates from src/db/schema.ts — the same DDL `db:push`
 * applies — so a broken relationship fails here rather than in the app.
 *
 * The linkage assertions are the important ones. They pin down the exact
 * behaviour the snapshot-vs-linked decision rests on: deleting vault content
 * must never destroy a resume that copied it.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { before, describe } from "node:test";

const DRIZZLE_DIR = path.join(import.meta.dirname, "..", "drizzle");

function loadDdl(): string {
  const files = fs
    .readdirSync(DRIZZLE_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  if (files.length === 0) {
    throw new Error(
      "No migration SQL found. Run `npm run db:generate` before the tests.",
    );
  }

  return files
    .map((f) => fs.readFileSync(path.join(DRIZZLE_DIR, f), "utf8"))
    .join("\n");
}

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  for (const stmt of loadDdl().split("--> statement-breakpoint")) {
    const s = stmt.trim();
    if (s) db.exec(s);
  }
  return db;
}

describe("schema", () => {
  let db: DatabaseSync;
  before(() => {
    db = freshDb();
  });

  test("every table is created", () => {
    const rows = db
      .prepare(
        "select name from sqlite_master where type='table' and name not like 'sqlite_%'",
      )
      .all() as Array<{ name: string }>;
    const names = new Set(rows.map((r) => r.name));

    for (const expected of [
      "profile",
      "vault_groups",
      "vault_sections",
      "vault_entries",
      "vault_bullets",
      "vault_skills",
      "resumes",
      "resume_styles",
      "resume_sections",
      "resume_entries",
      "resume_bullets",
      "resume_skills",
      "job_descriptions",
      "tune_runs",
      "settings",
    ]) {
      assert.ok(names.has(expected), `missing table: ${expected}`);
    }
  });

  test("JSON columns default to parseable empty values", () => {
    db.exec(`insert into vault_sections (heading,type) values ('WORK EXPERIENCE','normal')`);
    db.exec(`insert into vault_entries (section_id,title) values (1,'SWE')`);
    const e = db.prepare("select id, meta from vault_entries").get() as {
      id: number;
      meta: string;
    };
    assert.deepEqual(JSON.parse(e.meta), {});

    db.exec(`insert into vault_bullets (entry_id,text) values (${e.id},'Shipped')`);
    const b = db.prepare("select tags from vault_bullets").get() as { tags: string };
    assert.deepEqual(JSON.parse(b.tags), []);
  });
});

describe("vault cascades", () => {
  test("deleting an entry removes its bullets", () => {
    const db = freshDb();
    db.exec(`insert into vault_sections (heading,type) values ('WORK EXPERIENCE','normal')`);
    db.exec(`insert into vault_entries (section_id,title) values (1,'SWE')`);
    const id = (db.prepare("select id from vault_entries").get() as { id: number }).id;
    db.exec(`insert into vault_bullets (entry_id,text) values (${id},'a')`);
    db.exec(`insert into vault_bullets (entry_id,text) values (${id},'b')`);

    db.exec("delete from vault_entries");

    const n = (db.prepare("select count(*) c from vault_bullets").get() as { c: number }).c;
    assert.equal(n, 0, "orphaned bullets left behind");
  });

  test("deleting a section removes its entries and their bullets", () => {
    const db = freshDb();
    db.exec(`insert into vault_sections (heading,type) values ('PROJECTS','normal')`);
    db.exec(`insert into vault_entries (section_id,title) values (1,'GoLlama')`);
    db.exec(`insert into vault_bullets (entry_id,text) values (1,'Built a thing')`);

    db.exec("delete from vault_sections");

    assert.equal(
      (db.prepare("select count(*) c from vault_entries").get() as { c: number }).c,
      0,
      "orphaned entries left behind",
    );
    assert.equal(
      (db.prepare("select count(*) c from vault_bullets").get() as { c: number }).c,
      0,
      "orphaned bullets left behind",
    );
  });

  test("the derived skill index is dropped with the entry that produced it", () => {
    const db = freshDb();
    db.exec(`insert into vault_sections (heading,type) values ('SKILLS','skill')`);
    db.exec(`insert into vault_entries (section_id,title,information) values (1,'Languages','Java | Go')`);
    db.exec(`insert into vault_skills (source_entry_id,name,category) values (1,'Java','Languages')`);

    db.exec("delete from vault_entries");

    assert.equal(
      (db.prepare("select count(*) c from vault_skills").get() as { c: number }).c,
      0,
      "the index must not outlive the entry it was derived from",
    );
  });

  test("moving an entry between sections carries its bullets", () => {
    // Bullets hang off entry_id, not the section, so reparenting the entry is
    // the entire operation. This pins that down: if a future change ever hangs
    // bullets off the section instead, the move would silently orphan them.
    const db = freshDb();
    db.exec(`insert into vault_sections (heading,type) values ('PROJECTS SDE','normal')`);
    db.exec(`insert into vault_sections (heading,type) values ('PROJECTS WEB','normal')`);
    db.exec(`insert into vault_entries (section_id,title) values (1,'GoLlama')`);
    db.exec(`insert into vault_bullets (entry_id,text) values (1,'Built a thing')`);
    db.exec(`insert into vault_bullets (entry_id,text) values (1,'Shipped it')`);

    db.exec("update vault_entries set section_id = 2 where id = 1");

    const moved = db
      .prepare(
        "select count(*) c from vault_bullets b join vault_entries e on e.id = b.entry_id where e.section_id = 2",
      )
      .get() as { c: number };
    assert.equal(moved.c, 2, "bullets did not travel with their entry");
  });

  test("deleting a group leaves its sections standing, just ungrouped", () => {
    const db = freshDb();
    db.exec(`insert into vault_groups (name) values ('Career')`);
    db.exec(`insert into vault_sections (heading,type,group_id) values ('PROJECTS','normal',1)`);

    db.exec("delete from vault_groups");

    const row = db.prepare("select group_id from vault_sections").get() as
      | { group_id: number | null }
      | undefined;
    assert.ok(row, "a section was deleted along with its group");
    assert.equal(row.group_id, null);
  });
});

describe("vault → resume linkage", () => {
  /** A resume with one section, one entry and one bullet, all sourced from the vault. */
  function seeded() {
    const db = freshDb();
    db.exec(`insert into resume_styles (id) values (1)`);
    db.exec(`insert into resumes (name,style_id) values ('Resume_Job',1)`);
    const rid = (db.prepare("select id from resumes").get() as { id: number }).id;

    db.exec(
      `insert into resume_sections (resume_id,section_type,heading) values (${rid},'experience','WORK EXPERIENCE')`,
    );
    const sid = (db.prepare("select id from resume_sections").get() as { id: number }).id;

    db.exec(`insert into vault_sections (heading,type) values ('WORK EXPERIENCE','normal')`);
    db.exec(`insert into vault_entries (section_id,title) values (1,'SWE')`);
    const ve = (db.prepare("select id from vault_entries").get() as { id: number }).id;
    db.exec(`insert into vault_bullets (entry_id,text) values (${ve},'Shipped a thing')`);
    const vb = (db.prepare("select id from vault_bullets").get() as { id: number }).id;

    db.exec(
      `insert into resume_entries (section_id,source_entry_id) values (${sid},${ve})`,
    );
    const re = (db.prepare("select id from resume_entries").get() as { id: number }).id;
    db.exec(
      `insert into resume_bullets (resume_entry_id,source_bullet_id,text) values (${re},${vb},'Shipped a thing')`,
    );

    return { db, rid };
  }

  test("deleting a vault bullet nulls the pointer but preserves the resume's copy", () => {
    const { db } = seeded();
    db.exec("delete from vault_bullets");

    const row = db
      .prepare("select source_bullet_id, text from resume_bullets")
      .get() as { source_bullet_id: number | null; text: string };

    assert.equal(row.source_bullet_id, null, "pointer should be nulled");
    assert.equal(
      row.text,
      "Shipped a thing",
      "snapshot text must survive — this is the whole guarantee of snapshot mode",
    );
  });

  test("deleting a vault entry leaves the resume entry standing", () => {
    const { db } = seeded();
    db.exec("delete from vault_entries");

    const row = db.prepare("select source_entry_id from resume_entries").get() as
      | { source_entry_id: number | null }
      | undefined;

    assert.ok(row, "resume entry was destroyed along with the vault entry");
    assert.equal(row.source_entry_id, null);
  });

  test("resume bullets carry their own display order within an entry", () => {
    // The column always existed; nothing wrote to it until bullets became
    // draggable. This pins the contract that ordering is per-entry, so a future
    // change can't quietly make it global and scramble every other entry.
    const { db } = seeded();
    const re = (db.prepare("select id from resume_entries").get() as { id: number }).id;

    db.exec(`update resume_bullets set display_order = 5`);
    db.exec(
      `insert into resume_bullets (resume_entry_id,text,display_order) values (${re},'Second',2)`,
    );

    const rows = db
      .prepare(
        `select text from resume_bullets where resume_entry_id = ${re} order by display_order`,
      )
      .all() as Array<{ text: string }>;

    assert.deepEqual(
      rows.map((r) => r.text),
      ["Second", "Shipped a thing"],
      "display_order does not drive bullet order within an entry",
    );
  });

  test("deleting a resume cascades through sections, entries and bullets", () => {
    const { db } = seeded();
    db.exec("delete from resumes");

    for (const table of ["resume_sections", "resume_entries", "resume_bullets"]) {
      const n = (db.prepare(`select count(*) c from ${table}`).get() as { c: number }).c;
      assert.equal(n, 0, `${table} rows survived the resume delete`);
    }
  });

  test("a style in use cannot be deleted", () => {
    const { db } = seeded();
    assert.throws(
      () => db.exec("delete from resume_styles where id=1"),
      /constraint/i,
      "restrict was not enforced — resumes could be left without a style",
    );
  });
});
