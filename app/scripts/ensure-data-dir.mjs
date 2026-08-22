/**
 * Create the database's parent directory before anything tries to open it.
 *
 * `src/db/client.ts` does this itself, but drizzle-kit connects to SQLite
 * directly without going through our client — and because `data/` is gitignored,
 * it doesn't exist on a fresh checkout. SQLite will not create a missing
 * directory, so `db:push` failed with "Cannot open database because the
 * directory does not exist" before it could create a single table.
 *
 * Runs as a pre-hook for db:push / db:studio. A script file rather than an
 * inline `node -e` so quoting behaves the same in cmd.exe, PowerShell and bash.
 */

import fs from "node:fs";
import path from "node:path";

const dbPath = process.env.DATABASE_PATH ?? "./data/vaultcv.db";
const dir = path.dirname(path.resolve(process.cwd(), dbPath));

fs.mkdirSync(dir, { recursive: true });
