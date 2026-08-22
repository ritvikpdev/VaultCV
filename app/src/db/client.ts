import "server-only";

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

import * as schema from "./schema";

/**
 * Single SQLite connection, reused across hot reloads.
 *
 * Next dev re-evaluates modules on every change; without the global cache we
 * would open a new file handle each time and eventually exhaust them.
 */
const globalForDb = globalThis as unknown as {
  __vaultcvDb?: ReturnType<typeof createDb>;
};

function createDb() {
  const dbPath = path.resolve(
    process.cwd(),
    process.env.DATABASE_PATH ?? "./data/vaultcv.db",
  );

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const sqlite = new Database(dbPath);

  // WAL: concurrent reads while the editor autosaves. Meaningful on a local app
  // where the preview re-reads on every keystroke.
  sqlite.pragma("journal_mode = WAL");
  // Without this, ON DELETE CASCADE silently does nothing in SQLite.
  sqlite.pragma("foreign_keys = ON");

  return drizzle(sqlite, { schema });
}

function getDb() {
  if (!globalForDb.__vaultcvDb) {
    globalForDb.__vaultcvDb = createDb();
  }
  return globalForDb.__vaultcvDb;
}

/**
 * Lazy on purpose.
 *
 * `next build` imports every route module to collect page data. If the
 * connection were created at import time, building would open (and create) the
 * database as a side effect — and would hard-fail on any machine where the
 * native binding isn't compiled yet, even though no query ever runs.
 *
 * The Proxy defers `createDb()` to the first actual property access, so
 * importing this module is free and only real queries touch the filesystem.
 */
export const db = new Proxy({} as ReturnType<typeof createDb>, {
  get(_target, prop, receiver) {
    return Reflect.get(getDb(), prop, receiver);
  },
});

export { schema };
