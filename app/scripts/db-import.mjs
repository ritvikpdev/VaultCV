/**
 * Replace the local database with an exported one.
 *
 * This overwrites your vault, so it does three things before it will:
 *
 *   1. Checks the file is actually a vaultCV database, not some other .db
 *   2. Prints what you have now against what you're about to get
 *   3. Backs the current one up — via VACUUM INTO, so the backup is itself
 *      consistent rather than a naive copy with the same WAL problem
 *
 * Then it asks. Nothing is written until you type yes.
 *
 * Stop the dev server first. SQLite tolerates a lot, but swapping the file
 * underneath a process that has it open is not something to find out about.
 *
 * Usage:
 *   npm run db:import                     the git-synced snapshot
 *   npm run db:import -- <path>           some other export
 *   npm run db:import -- <path> --yes     skip the prompt
 */

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import Database from "better-sqlite3";

const args = process.argv.slice(2);
const skipPrompt = args.includes("--yes");
const sourceArg = args.find((a) => !a.startsWith("--"));

/** The git-tracked snapshot, so the usual case needs no argument. */
const SYNC_PATH = "./data/exports/vaultcv-sync.db";

const source = path.resolve(process.cwd(), sourceArg ?? SYNC_PATH);

if (!fs.existsSync(source)) {
  if (sourceArg) {
    console.error(`No such file: ${source}`);
  } else {
    console.error(`\nNo synced snapshot at ${SYNC_PATH}`);
    console.error("Run `npm run db:sync` on the other machine, commit and push,");
    console.error("then pull here. Or pass a path to an export directly.\n");
  }
  process.exit(1);
}

const dbPath = path.resolve(
  process.cwd(),
  process.env.DATABASE_PATH ?? "./data/vaultcv.db",
);

/** Tables that must exist for this to be a vaultCV database at all. */
const REQUIRED = ["vault_sections", "vault_entries", "resumes", "profile", "settings"];

function summarise(file) {
  const db = new Database(file, { readonly: true });
  const names = new Set(
    db
      .prepare("select name from sqlite_master where type='table'")
      .all()
      .map((r) => r.name),
  );

  const missing = REQUIRED.filter((t) => !names.has(t));
  if (missing.length > 0) {
    db.close();
    return { ok: false, missing };
  }

  const counts = {};
  for (const t of [
    "vault_sections",
    "vault_entries",
    "vault_bullets",
    "vault_skills",
    "resumes",
    "resume_entries",
    "resume_bullets",
    "resume_skills",
  ]) {
    counts[t] = names.has(t) ? db.prepare(`select count(*) c from "${t}"`).get().c : 0;
  }
  db.close();
  return { ok: true, counts };
}

const incoming = summarise(source);
if (!incoming.ok) {
  console.error(`\n${source}`);
  console.error(`is not a vaultCV database — missing: ${incoming.missing.join(", ")}\n`);
  process.exit(1);
}

const existing = fs.existsSync(dbPath) ? summarise(dbPath) : null;

console.log(`\nImporting  ${source}`);
console.log(`Replacing  ${dbPath}\n`);
console.log(`  ${"".padEnd(20)} ${"now".padStart(6)}  ${"after".padStart(6)}`);
console.log(`  ${"-".repeat(36)}`);

for (const [table, n] of Object.entries(incoming.counts)) {
  const before = existing?.ok ? existing.counts[table] : 0;
  const flag = before > n ? "  ← loses rows" : "";
  console.log(
    `  ${table.padEnd(20)} ${String(before).padStart(6)}  ${String(n).padStart(6)}${flag}`,
  );
}

if (!skipPrompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question("\nReplace the local database? (yes/no) ");
  rl.close();
  if (answer.trim().toLowerCase() !== "yes") {
    console.log("Cancelled. Nothing was written.\n");
    process.exit(0);
  }
}

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

// Back up what's there, consistently — a plain copy would inherit the same WAL
// problem this whole script exists to avoid.
if (fs.existsSync(dbPath)) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const backup = path.resolve(
    process.cwd(),
    `./data/backups/${stamp}-vaultcv-before-import.db`,
  );
  fs.mkdirSync(path.dirname(backup), { recursive: true });

  const current = new Database(dbPath);
  current.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
  current.close();
  console.log(`\nBacked up to ${backup}`);
}

// The old sidecars describe the old file. Left behind, SQLite would try to
// replay them against the new one.
for (const suffix of ["-wal", "-shm"]) {
  if (fs.existsSync(dbPath + suffix)) fs.rmSync(dbPath + suffix);
}

fs.copyFileSync(source, dbPath);

console.log(`Imported. Start the app with \`npm run dev\`.\n`);
