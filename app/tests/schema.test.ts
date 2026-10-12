/**
 * Schema integrity tests.
 *
 * Run: npm run test  (generates DDL from schema.ts first — see package.json)
 *
 * These run against PGlite — real Postgres compiled to WebAssembly, in process
 * — so they need no database server and no network. What they verify is the
 * DDL that drizzle-kit generates from src/db/schema.ts, the same DDL
 * `db:push` applies to Supabase, so a broken relationship or policy fails here
 * rather than in production.
 *
 * Supabase's `auth` schema doesn't exist in plain Postgres, so a minimal stand-
 * in is created first: an `auth.users` table to reference and an `auth.uid()`
 * that reads the JWT claims setting exactly the way Supabase's does.
 *
 * Two kinds of assertion matter most:
 *   - linkage: deleting vault content must never destroy a resume that copied it;
 *   - isolation: one user can never read or write another user's rows.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test, { describe } from "node:test";

import { PGlite } from "@electric-sql/pglite";

const DRIZZLE_DIR = path.join(import.meta.dirname, "..", "drizzle");

const USER_A = "00000000-0000-0000-0000-00000000000a";
const USER_B = "00000000-0000-0000-0000-00000000000b";

const AUTH_STUB = `
  create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$
    -- Same shape as Supabase's own definition, including tolerating an
    -- empty setting, which is what "nobody signed in" looks like.
    select coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
    )::uuid
  $$;
  grant usage on schema auth to authenticated;
  grant execute on function auth.uid() to authenticated;
  insert into auth.users (id, email) values
    ('${USER_A}', 'a@example.com'),
    ('${USER_B}', 'b@example.com');
`;

/** What Supabase's default privileges grant on tables created in `public`. */
const GRANTS = `
  grant usage on schema public to authenticated;
  grant all on all tables in schema public to authenticated;
  grant all on all sequences in schema public to authenticated;
`;

function loadDdl(): string[] {
  const files = fs
    .readdirSync(DRIZZLE_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  if (files.length === 0) {
    throw new Error("No migration SQL found. Run `npm run db:generate` before the tests.");
  }

  return files
    .map((f) => fs.readFileSync(path.join(DRIZZLE_DIR, f), "utf8"))
    .join("\n--> statement-breakpoint\n")
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * A fresh database with the schema applied, connected as the owner (which
 * bypasses RLS, like the connection string's role on Supabase) but with
 * USER_A's claims set — so `user_id` defaults resolve, as they do in the app.
 */
async function freshDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(AUTH_STUB);
  for (const stmt of loadDdl()) await db.exec(stmt);
  await db.exec(GRANTS);
  await claims(db, USER_A);
  return db;
}

async function claims(db: PGlite, userId: string) {
  await db.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ sub: userId, role: "authenticated" }),
  ]);
}

/**
 * Run `fn` the way the app runs every request: as the `authenticated` role
 * with `userId`'s claims — exactly what `runAsUser` in client.ts sets up.
 */
async function asUser<T>(db: PGlite, userId: string, fn: () => Promise<T>): Promise<T> {
  await claims(db, userId);
  await db.exec("set role authenticated");
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
    await claims(db, USER_A);
  }
}

async function count(db: PGlite, table: string): Promise<number> {
  return (await db.query<{ c: number }>(`select count(*)::int c from ${table}`)).rows[0]!.c;
}

async function one<T>(db: PGlite, sql: string): Promise<T | undefined> {
  return (await db.query<T>(sql)).rows[0];
}

describe("schema", () => {
  test("every table is created, and every one has row-level security", async () => {
    const db = await freshDb();
    const rows = (
      await db.query<{ tablename: string; rowsecurity: boolean }>(
        "select tablename, rowsecurity from pg_tables where schemaname = 'public'",
      )
    ).rows;
    const byName = new Map(rows.map((r) => [r.tablename, r.rowsecurity]));

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
      assert.ok(byName.has(expected), `missing table: ${expected}`);
      // Supabase serves the public schema to anyone holding the publishable
      // key. A table without RLS is a table anyone can read.
      assert.equal(byName.get(expected), true, `RLS is off for ${expected}`);
    }

    // And no table slipped in without being listed above.
    for (const [name, rls] of byName) {
      assert.equal(rls, true, `RLS is off for ${name}`);
    }
  });

  test("JSON columns default to empty values", async () => {
    const db = await freshDb();
    await db.exec(`insert into vault_sections (heading,type) values ('WORK EXPERIENCE','normal')`);
    await db.exec(`insert into vault_entries (section_id,title) values (1,'SWE')`);
    const e = await one<{ id: number; meta: unknown }>(db, "select id, meta from vault_entries");
    assert.deepEqual(e!.meta, {});

    await db.exec(`insert into vault_bullets (entry_id,text) values (${e!.id},'Shipped')`);
    const b = await one<{ tags: unknown }>(db, "select tags from vault_bullets");
    assert.deepEqual(b!.tags, []);
  });

  test("user_id fills itself in from the signed-in user", async () => {
    const db = await freshDb();
    await asUser(db, USER_B, () =>
      db.exec(`insert into vault_groups (name) values ('Career')`),
    );
    const row = await one<{ user_id: string }>(db, "select user_id from vault_groups");
    assert.equal(row!.user_id, USER_B);
  });

  test("settings keys are per user, not global", async () => {
    const db = await freshDb();
    await asUser(db, USER_A, () =>
      db.exec(`insert into settings (key,value) values ('vault_link_mode','snapshot')`),
    );
    // The same key for a second user must not collide.
    await asUser(db, USER_B, () =>
      db.exec(`insert into settings (key,value) values ('vault_link_mode','linked')`),
    );
    assert.equal(await count(db, "settings"), 2);
  });
});

describe("isolation between users", () => {
  async function seededForA() {
    const db = await freshDb();
    await asUser(db, USER_A, async () => {
      await db.exec(`insert into profile (full_name) values ('Alice')`);
      await db.exec(`insert into vault_sections (heading,type) values ('WORK','normal')`);
      await db.exec(`insert into vault_entries (section_id,title) values (1,'Secret job')`);
      await db.exec(`insert into resume_styles (page_size) values ('letter')`);
      await db.exec(`insert into resumes (name,style_id) values ('Alice resume',1)`);
    });
    return db;
  }

  test("another user sees none of your rows", async () => {
    const db = await seededForA();
    await asUser(db, USER_B, async () => {
      for (const table of ["profile", "vault_sections", "vault_entries", "resumes", "resume_styles"]) {
        assert.equal(await count(db, table), 0, `${table} leaked across users`);
      }
    });
    // …while the owner still sees theirs.
    await asUser(db, USER_A, async () => {
      assert.equal(await count(db, "vault_entries"), 1);
    });
  });

  test("another user can't update or delete your rows by id", async () => {
    const db = await seededForA();
    await asUser(db, USER_B, async () => {
      // Matches nothing rather than erroring — the row is invisible to them.
      await db.exec(`update vault_entries set title = 'pwned' where id = 1`);
      await db.exec(`delete from resumes where id = 1`);
    });
    const entry = await one<{ title: string }>(db, "select title from vault_entries where id = 1");
    assert.equal(entry!.title, "Secret job");
    assert.equal(await count(db, "resumes"), 1);
  });

  test("you can't insert a row under someone else's id", async () => {
    const db = await freshDb();
    await assert.rejects(
      asUser(db, USER_B, () =>
        db.exec(`insert into vault_groups (user_id,name) values ('${USER_A}','Planted')`),
      ),
      /row-level security/i,
    );
  });

  test("with no signed-in user, nothing is visible", async () => {
    const db = await seededForA();
    await db.query("select set_config('request.jwt.claims', '', false)");
    await db.exec("set role authenticated");
    try {
      assert.equal(await count(db, "vault_entries"), 0);
    } finally {
      await db.exec("reset role");
    }
  });

  test("deleting an account deletes everything they stored", async () => {
    const db = await seededForA();
    await db.exec(`delete from auth.users where id = '${USER_A}'`);
    for (const table of ["profile", "vault_sections", "vault_entries", "resumes", "resume_styles"]) {
      assert.equal(await count(db, table), 0, `${table} outlived its account`);
    }
  });
});

describe("vault cascades", () => {
  test("deleting an entry removes its bullets", async () => {
    const db = await freshDb();
    await db.exec(`insert into vault_sections (heading,type) values ('WORK EXPERIENCE','normal')`);
    await db.exec(`insert into vault_entries (section_id,title) values (1,'SWE')`);
    await db.exec(`insert into vault_bullets (entry_id,text) values (1,'a')`);
    await db.exec(`insert into vault_bullets (entry_id,text) values (1,'b')`);

    await db.exec("delete from vault_entries");

    assert.equal(await count(db, "vault_bullets"), 0, "orphaned bullets left behind");
  });

  test("deleting a section removes its entries and their bullets", async () => {
    const db = await freshDb();
    await db.exec(`insert into vault_sections (heading,type) values ('PROJECTS','normal')`);
    await db.exec(`insert into vault_entries (section_id,title) values (1,'GoLlama')`);
    await db.exec(`insert into vault_bullets (entry_id,text) values (1,'Built a thing')`);

    await db.exec("delete from vault_sections");

    assert.equal(await count(db, "vault_entries"), 0, "orphaned entries left behind");
    assert.equal(await count(db, "vault_bullets"), 0, "orphaned bullets left behind");
  });

  test("the derived skill index is dropped with the entry that produced it", async () => {
    const db = await freshDb();
    await db.exec(`insert into vault_sections (heading,type) values ('SKILLS','skill')`);
    await db.exec(
      `insert into vault_entries (section_id,title,information) values (1,'Languages','Java | Go')`,
    );
    await db.exec(
      `insert into vault_skills (source_entry_id,name,category) values (1,'Java','Languages')`,
    );

    await db.exec("delete from vault_entries");

    assert.equal(
      await count(db, "vault_skills"),
      0,
      "the index must not outlive the entry it was derived from",
    );
  });

  test("moving an entry between sections carries its bullets", async () => {
    // Bullets hang off entry_id, not the section, so reparenting the entry is
    // the entire operation. This pins that down: if a future change ever hangs
    // bullets off the section instead, the move would silently orphan them.
    const db = await freshDb();
    await db.exec(`insert into vault_sections (heading,type) values ('PROJECTS SDE','normal')`);
    await db.exec(`insert into vault_sections (heading,type) values ('PROJECTS WEB','normal')`);
    await db.exec(`insert into vault_entries (section_id,title) values (1,'GoLlama')`);
    await db.exec(`insert into vault_bullets (entry_id,text) values (1,'Built a thing')`);
    await db.exec(`insert into vault_bullets (entry_id,text) values (1,'Shipped it')`);

    await db.exec("update vault_entries set section_id = 2 where id = 1");

    const moved = await one<{ c: number }>(
      db,
      "select count(*)::int c from vault_bullets b join vault_entries e on e.id = b.entry_id where e.section_id = 2",
    );
    assert.equal(moved!.c, 2, "bullets did not travel with their entry");
  });

  test("deleting a group leaves its sections standing, just ungrouped", async () => {
    const db = await freshDb();
    await db.exec(`insert into vault_groups (name) values ('Career')`);
    await db.exec(`insert into vault_sections (heading,type,group_id) values ('PROJECTS','normal',1)`);

    await db.exec("delete from vault_groups");

    const row = await one<{ group_id: number | null }>(db, "select group_id from vault_sections");
    assert.ok(row, "a section was deleted along with its group");
    assert.equal(row.group_id, null);
  });
});

describe("vault → resume linkage", () => {
  /** A resume with one section, one entry and one bullet, all sourced from the vault. */
  async function seeded() {
    const db = await freshDb();
    await db.exec(`insert into resume_styles (page_size) values ('letter')`);
    await db.exec(`insert into resumes (name,style_id) values ('Resume_Job',1)`);
    await db.exec(
      `insert into resume_sections (resume_id,section_type,heading) values (1,'experience','WORK EXPERIENCE')`,
    );
    await db.exec(`insert into vault_sections (heading,type) values ('WORK EXPERIENCE','normal')`);
    await db.exec(`insert into vault_entries (section_id,title) values (1,'SWE')`);
    await db.exec(`insert into vault_bullets (entry_id,text) values (1,'Shipped a thing')`);
    await db.exec(`insert into resume_entries (section_id,source_entry_id) values (1,1)`);
    await db.exec(
      `insert into resume_bullets (resume_entry_id,source_bullet_id,text) values (1,1,'Shipped a thing')`,
    );
    return db;
  }

  test("deleting a vault bullet nulls the pointer but preserves the resume's copy", async () => {
    const db = await seeded();
    await db.exec("delete from vault_bullets");

    const row = await one<{ source_bullet_id: number | null; text: string }>(
      db,
      "select source_bullet_id, text from resume_bullets",
    );

    assert.equal(row!.source_bullet_id, null, "pointer should be nulled");
    assert.equal(
      row!.text,
      "Shipped a thing",
      "snapshot text must survive — this is the whole guarantee of snapshot mode",
    );
  });

  test("deleting a vault entry leaves the resume entry standing", async () => {
    const db = await seeded();
    await db.exec("delete from vault_entries");

    const row = await one<{ source_entry_id: number | null }>(
      db,
      "select source_entry_id from resume_entries",
    );

    assert.ok(row, "resume entry was destroyed along with the vault entry");
    assert.equal(row.source_entry_id, null);
  });

  test("resume bullets carry their own display order within an entry", async () => {
    // The column always existed; nothing wrote to it until bullets became
    // draggable. This pins the contract that ordering is per-entry, so a future
    // change can't quietly make it global and scramble every other entry.
    const db = await seeded();

    await db.exec(`update resume_bullets set display_order = 5`);
    await db.exec(
      `insert into resume_bullets (resume_entry_id,text,display_order) values (1,'Second',2)`,
    );

    const rows = (
      await db.query<{ text: string }>(
        `select text from resume_bullets where resume_entry_id = 1 order by display_order`,
      )
    ).rows;

    assert.deepEqual(
      rows.map((r) => r.text),
      ["Second", "Shipped a thing"],
      "display_order does not drive bullet order within an entry",
    );
  });

  test("deleting a resume cascades through sections, entries and bullets", async () => {
    const db = await seeded();
    await db.exec("delete from resumes");

    for (const table of ["resume_sections", "resume_entries", "resume_bullets"]) {
      assert.equal(await count(db, table), 0, `${table} rows survived the resume delete`);
    }
  });

  test("a style in use cannot be deleted", async () => {
    const db = await seeded();
    await assert.rejects(
      db.exec("delete from resume_styles where id=1"),
      /foreign key/i,
      "restrict was not enforced — resumes could be left without a style",
    );
  });
});
