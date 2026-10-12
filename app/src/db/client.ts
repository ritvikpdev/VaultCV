import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";

import { sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

type Root = PostgresJsDatabase<typeof schema>;
/** What `db` is inside a request: one transaction, scoped to one user. */
export type Db = Parameters<Parameters<Root["transaction"]>[0]>[0];

/**
 * One connection pool per server process, reused across hot reloads.
 *
 * Next dev re-evaluates modules on every change; without the global cache each
 * edit would open a fresh pool and eventually exhaust Supabase's connection
 * limit.
 */
const globalForDb = globalThis as unknown as { __vaultcvRoot?: Root };

function getRoot(): Root {
  if (!globalForDb.__vaultcvRoot) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error(
        "DATABASE_URL is not set. Copy app/.env.example to app/.env.local and fill in the Supabase connection strings.",
      );
    }
    const client = postgres(url, {
      // Supabase's transaction pooler can't keep prepared statements: the next
      // statement may run on a different backend connection.
      prepare: false,
      max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    });
    globalForDb.__vaultcvRoot = drizzle(client, { schema });
  }
  return globalForDb.__vaultcvRoot;
}

type Scope = { userId: string; tx: Db };
const scope = new AsyncLocalStorage<Scope>();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Run `fn` with `db` bound to one transaction acting as `userId`.
 *
 * The transaction switches to Supabase's `authenticated` role and sets the JWT
 * claims `auth.uid()` reads, so every row-level-security policy in schema.ts
 * applies: selects see only this user's rows, inserts are stamped with their
 * id by the column default, and a write to anyone else's row matches nothing.
 * The connection string's own role bypasses RLS — this is what puts it back.
 *
 * Nested calls (an action calling another action) join the outer transaction
 * instead of opening a second one — but only for the same user.
 *
 * Callers normally reach this through `withVault()` in session.ts, which
 * resolves the user from the session cookie first.
 */
export async function runAsUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const current = scope.getStore();
  if (current) {
    if (current.userId !== userId) {
      throw new Error("Refusing to nest a vault scope for a different user");
    }
    return fn();
  }

  if (!UUID.test(userId)) throw new Error("Invalid user id");

  return getRoot().transaction(async (tx) => {
    const claims = JSON.stringify({ sub: userId, role: "authenticated" });
    await tx.execute(sql`select set_config('request.jwt.claims', ${claims}, true)`);
    await tx.execute(sql`set local role authenticated`);
    return scope.run({ userId, tx }, fn);
  });
}

/** The user the current scope is acting as, or null outside one. */
export function currentUserId(): string | null {
  return scope.getStore()?.userId ?? null;
}

/**
 * The current request's transaction.
 *
 * Lazy on purpose, as before: `next build` imports every route module to
 * collect page data, and opening a pool at import time would make building
 * depend on a reachable database.
 *
 * Fails closed. Touching `db` outside `runAsUser` throws rather than falling
 * back to an unscoped connection — there is no code path that can query
 * without a user, so there is none that can query as the wrong one.
 */
export const db = new Proxy({} as Db, {
  get(_target, prop) {
    const current = scope.getStore();
    if (!current) {
      throw new Error(
        "Database accessed outside a user scope. Wrap the page or action in withVault().",
      );
    }
    const value = Reflect.get(current.tx, prop, current.tx);
    return typeof value === "function" ? value.bind(current.tx) : value;
  },
});

/** First row of a result, or undefined — the Postgres stand-in for SQLite's `.get()`. */
export async function first<T>(query: PromiseLike<T[]>): Promise<T | undefined> {
  return (await query)[0];
}

export { schema };
