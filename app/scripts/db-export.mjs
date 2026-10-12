/**
 * Write the database out as one self-contained file.
 *
 * Copying `data/vaultcv.db` by hand is the obvious move and it silently loses
 * data. SQLite runs in WAL mode here, so recent writes live in the `-wal`
 * sidecar until they're folded back in — on a real vault that sidecar held
 * every bullet and half the entries. Copy the main file alone and the result
 * opens cleanly, looking merely as though you'd done less work. No error, no
 * warning, nothing to notice.
 *
 * `VACUUM INTO` avoids all of it: SQLite writes a fresh, fully checkpointed
 * database in one statement, consistent even if the app is running and mid-write.
 * One file, nothing to forget.
 *
 * Usage:
 *   npm run db:export                  → data/exports/YYYY-MM-DD-vaultcv.db
 *   npm run db:export -- <path>        → wherever you say
 *   npm run db:export -- <path> --force  overwrite an existing file
 */

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync as Database } from "node:sqlite";

const args = process.argv.slice(2);
const force = args.includes("--force");
const explicitTarget = args.find((a) => !a.startsWith("--"));

const dbPath = path.resolve(
  process.cwd(),
  process.env.DATABASE_PATH ?? "./data/vaultcv.db",
);

if (!fs.existsSync(dbPath)) {
  console.error(`No database at ${dbPath}`);
  console.error("Run `npm run db:push` first, or set DATABASE_PATH.");
  process.exit(1);
}

const today = new Date().toISOString().slice(0, 10);
const target = path.resolve(
  process.cwd(),
  explicitTarget ?? `./data/exports/${today}-vaultcv.db`,
);

if (fs.existsSync(target) && !force) {
  console.error(`${target} already exists.`);
  console.error("Pass --force to overwrite it, or give a different path.");
  process.exit(1);
}

fs.mkdirSync(path.dirname(target), { recursive: true });
// VACUUM INTO refuses to write over an existing file, so clear the way once
// the overwrite has been authorised above.
if (fs.existsSync(target)) fs.rmSync(target);

const db = new Database(dbPath, {});

const tables = db
  .prepare(
    "select name from sqlite_master where type='table' and name not like 'sqlite_%' order by name",
  )
  .all();

// Single quotes are the only thing that can break out of the string literal.
db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
db.close();

const check = new Database(target, { readOnly: true });
let total = 0;
const rows = tables.map(({ name }) => {
  const n = check.prepare(`select count(*) c from "${name}"`).get().c;
  total += n;
  return [name, n];
});
check.close();

const kb = (fs.statSync(target).size / 1024).toFixed(0);

console.log(`\nExported to  ${target}`);
console.log(`${kb} KB · ${total} rows · one file, no sidecars\n`);

for (const [name, n] of rows) {
  if (n > 0) console.log(`  ${name.padEnd(20)} ${n}`);
}

if (target.endsWith("vaultcv-sync.db")) {
  console.log("Now commit and push:");
  console.log("  git add -A && git commit -m \"vault snapshot\" && git push\n");
  console.log("On the other machine:  git pull && npm run db:import\n");
} else {
  console.log("Copy that single file to the other machine, then run:");
  console.log("  npm run db:import -- <path-to-the-file>\n");
}
