/**
 * Copy a vaultCV SQLite database into one Supabase account.
 *
 * The one-time move from the local-first app to the hosted one. Run it after
 * your account exists (create it from /admin, or invite yourself), with the
 * Supabase connection strings in .env.local:
 *
 *   npm run vault:import-sqlite -- --email you@example.com
 *   npm run vault:import-sqlite -- --email you@example.com --from data/exports/vaultcv-sync.db
 *   npm run vault:import-sqlite -- --email you@example.com --replace
 *
 * Defaults to the live data/vaultcv.db — usually newer than the git snapshot.
 *
 * Safety:
 *   - Reads a VACUUM INTO copy of the source, never the file directly, so rows
 *     still sitting in the -wal sidecar are included (see CLAUDE.md on WAL).
 *     The source is opened read-only and never modified.
 *   - Refuses if the account already has vault content, unless --replace,
 *     which deletes that account's existing rows first.
 *   - Everything happens in ONE transaction. Row counts are compared before
 *     committing; any mismatch rolls the whole import back.
 *
 * Ids are reassigned by Postgres and every foreign key is remapped, including
 * the ids stored inside tune-run recommendations.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import postgres from "postgres";

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : (args[i + 1] ?? "");
};
const email = flag("--email")?.trim().toLowerCase();
const source = path.resolve(process.cwd(), flag("--from") ?? "./data/vaultcv.db");
const replace = args.includes("--replace");

if (!email) {
  console.error("Usage: npm run vault:import-sqlite -- --email you@example.com [--from path] [--replace]");
  process.exit(1);
}
if (!fs.existsSync(source)) {
  console.error(`No database at ${source}`);
  process.exit(1);
}
const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("Set MIGRATION_DATABASE_URL (or DATABASE_URL) in app/.env.local first.");
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/* Read the source                                                     */
/* ------------------------------------------------------------------ */

const snapshot = path.join(os.tmpdir(), `vaultcv-import-${Date.now()}.db`);
{
  const live = new DatabaseSync(source, { readOnly: true });
  live.exec(`VACUUM INTO '${snapshot.replace(/'/g, "''")}'`);
  live.close();
}
const sqlite = new DatabaseSync(snapshot, { readOnly: true });
const sourceTables = new Set(
  sqlite
    .prepare("select name from sqlite_master where type='table'")
    .all()
    .map((r) => r.name),
);
const read = (table) =>
  sourceTables.has(table) ? sqlite.prepare(`select * from "${table}" order by rowid`).all() : [];

/**
 * Insert order follows the foreign keys. `fks` maps a column to the table whose
 * new ids it must be remapped through.
 */
const TABLES = [
  { name: "vault_groups", fks: {} },
  { name: "vault_sections", fks: { group_id: "vault_groups" } },
  { name: "vault_entries", fks: { section_id: "vault_sections" } },
  { name: "vault_bullets", fks: { entry_id: "vault_entries" } },
  { name: "vault_skills", fks: { source_entry_id: "vault_entries" } },
  { name: "resume_styles", fks: {} },
  { name: "resumes", fks: { style_id: "resume_styles" } },
  { name: "resume_sections", fks: { resume_id: "resumes" } },
  {
    name: "resume_entries",
    fks: { section_id: "resume_sections", source_entry_id: "vault_entries" },
  },
  {
    name: "resume_bullets",
    fks: { resume_entry_id: "resume_entries", source_bullet_id: "vault_bullets" },
  },
  { name: "resume_skills", fks: { section_id: "resume_sections", source_skill_id: "vault_skills" } },
  { name: "job_descriptions", fks: {} },
  { name: "tune_runs", fks: { resume_id: "resumes", jd_id: "job_descriptions" } },
];

/** Ids inside a recommendation's payload, and the table each points into. */
const PAYLOAD_IDS = {
  vaultEntryId: "vault_entries",
  vaultBulletId: "vault_bullets",
  vaultSkillId: "vault_skills",
  resumeBulletId: "resume_bullets",
  sectionId: "resume_sections",
};

/* ------------------------------------------------------------------ */
/* Write                                                               */
/* ------------------------------------------------------------------ */

const sql = postgres(url, { prepare: false, max: 1, onnotice: () => {} });

class Abort extends Error {}

try {
  const [user] = await sql`select id from auth.users where lower(email) = ${email}`;
  if (!user) {
    throw new Abort(
      `No account for ${email}. Create it first — invite yourself from /admin, or add the user in the Supabase dashboard (Authentication → Users).`,
    );
  }
  const userId = user.id;

  // Column metadata from the target, so values are converted by what Postgres
  // expects rather than by guesswork about the SQLite side.
  const columnRows = await sql`
    select table_name, column_name, data_type
    from information_schema.columns
    where table_schema = 'public'`;
  if (columnRows.length === 0) {
    throw new Abort("The Supabase database has no tables yet. Run `npm run db:push` first.");
  }
  const columns = new Map();
  for (const r of columnRows) {
    if (!columns.has(r.table_name)) columns.set(r.table_name, new Map());
    columns.get(r.table_name).set(r.column_name, r.data_type);
  }

  const convert = (table, column, value) => {
    const type = columns.get(table)?.get(column);
    if (value === null || value === undefined) return null;
    if (type === "boolean") return Boolean(value);
    if (type === "jsonb") return sql.json(typeof value === "string" ? JSON.parse(value) : value);
    if (type === "bigint" || type === "integer" || type === "double precision") return Number(value);
    return value;
  };

  const report = [];

  await sql.begin(async (tx) => {
    const [{ n: existingEntries }] =
      await tx`select count(*)::int n from vault_entries where user_id = ${userId}`;
    const [{ n: existingResumes }] =
      await tx`select count(*)::int n from resumes where user_id = ${userId}`;

    if (existingEntries + existingResumes > 0) {
      if (!replace) {
        throw new Abort(
          `${email} already has ${existingEntries} vault entries and ${existingResumes} resumes. ` +
            "Re-run with --replace to delete them and import over the top.",
        );
      }
      console.log(`--replace: deleting ${email}'s existing content first.`);
      // Children cascade from these; styles and JDs have no parent to cascade from.
      for (const t of ["resumes", "resume_styles", "vault_sections", "vault_groups", "job_descriptions", "tune_runs", "vault_entries"]) {
        await tx`delete from ${tx(t)} where user_id = ${userId}`;
      }
    }

    // Profile and settings are per-user singletons that sign-in may already
    // have created — upsert rather than insert.
    const [profile] = read("profile");
    if (profile) {
      const row = { user_id: userId };
      for (const [k, v] of Object.entries(profile)) {
        if (k !== "id" && columns.get("profile").has(k)) row[k] = convert("profile", k, v);
      }
      const keys = Object.keys(row).filter((k) => k !== "user_id");
      await tx`
        insert into profile ${tx(row)}
        on conflict (user_id) do update set ${tx(row, keys)}`;
      report.push(["profile", 1, 1]);
    }

    const settings = read("settings");
    for (const s of settings) {
      await tx`
        insert into settings (user_id, key, value) values (${userId}, ${s.key}, ${s.value})
        on conflict (user_id, key) do update set value = excluded.value`;
    }
    report.push(["settings", settings.length, settings.length]);

    const idMap = Object.fromEntries(TABLES.map((t) => [t.name, new Map()]));

    for (const { name, fks } of TABLES) {
      const rows = read(name);
      const target = columns.get(name);
      let written = 0;

      for (const original of rows) {
        const row = { user_id: userId };
        for (const [col, value] of Object.entries(original)) {
          if (col === "id" || col === "user_id" || !target.has(col)) continue;
          if (fks[col] && value !== null) {
            const mapped = idMap[fks[col]].get(value);
            // A dangling pointer in the source (e.g. a nulled-out vault link
            // SQLite never enforced) becomes null rather than failing the import.
            row[col] = mapped ?? null;
          } else {
            row[col] = convert(name, col, value);
          }
        }

        if (name === "tune_runs" && row.recommendations) {
          const recs = JSON.parse(original.recommendations ?? "[]").map((rec) => {
            const payload = { ...rec.payload };
            for (const [key, table] of Object.entries(PAYLOAD_IDS)) {
              if (payload[key] != null && idMap[table].has(Number(payload[key]))) {
                payload[key] = idMap[table].get(Number(payload[key]));
              }
            }
            return { ...rec, payload };
          });
          row.recommendations = sql.json(recs);
        }

        const [inserted] = await tx`insert into ${tx(name)} ${tx(row)} returning id`;
        idMap[name].set(original.id, inserted.id);
        written += 1;
      }

      const [{ n }] = await tx`select count(*)::int n from ${tx(name)} where user_id = ${userId}`;
      report.push([name, rows.length, n]);
      if (n !== rows.length) {
        throw new Abort(`${name}: read ${rows.length} rows but the account now has ${n}. Rolled back.`);
      }
    }
  });

  console.log(`\nImported ${source}\n    into ${email}\n`);
  console.log(`  ${"table".padEnd(18)} ${"source".padStart(7)} ${"supabase".padStart(9)}`);
  console.log(`  ${"-".repeat(36)}`);
  for (const [t, a, b] of report) {
    console.log(`  ${t.padEnd(18)} ${String(a).padStart(7)} ${String(b).padStart(9)}`);
  }
  console.log("\nAll counts match. Sign in and check your vault.\n");
} catch (error) {
  console.error(`\n${error instanceof Abort ? error.message : error?.stack ?? error}\n`);
  console.error("Nothing was written.\n");
  process.exitCode = 1;
} finally {
  await sql.end();
  sqlite.close();
  fs.rmSync(snapshot, { force: true });
}
