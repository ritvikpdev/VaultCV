/**
 * Write supabase-schema.sql — the whole schema as one script for Supabase's
 * SQL Editor, for setting up a fresh project without a database connection
 * from this machine.
 *
 * Generated, never hand-written: it is drizzle-kit's own output for
 * src/db/schema.ts, wrapped in a transaction. Regenerate after changing the
 * schema. Only for an EMPTY database — it creates, it doesn't migrate; use
 * `npm run db:push` against a live one.
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// Brings drizzle/ up to date with schema.ts (a no-op when nothing changed).
// The migrations there, applied in order, ARE the schema — the same files the
// tests run against.
execSync("npx drizzle-kit generate", { stdio: "ignore" });
const out = "drizzle";

const ddl = fs
  .readdirSync(out)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => fs.readFileSync(path.join(out, f), "utf8"))
  .join("\n")
  .replaceAll("--> statement-breakpoint", "");

const header = `-- vaultCV schema for Supabase.
-- GENERATED from app/src/db/schema.ts by \`npm run db:sql\`. Do not edit by hand.
--
-- For an EMPTY database only. Paste the whole file into
-- Supabase -> SQL Editor -> New query -> Run.
-- Runs in one transaction: it either creates everything or nothing.
`;

fs.writeFileSync("supabase-schema.sql", `${header}\nbegin;\n\n${ddl.trim()}\n\ncommit;\n`);
console.log("Wrote supabase-schema.sql");
