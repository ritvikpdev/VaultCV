import type { Config } from "drizzle-kit";

// drizzle-kit doesn't read .env.local the way Next does.
try {
  process.loadEnvFile(".env.local");
} catch {
  // No file — fine on CI or Vercel, where the variables come from the environment.
}

/**
 * `npm run db:push` applies schema.ts to your Supabase database.
 *
 * Uses the SESSION pooler (MIGRATION_DATABASE_URL): drizzle-kit introspects the
 * live schema before diffing, and that needs a session-scoped connection the
 * transaction pooler can't provide. The app itself uses DATABASE_URL.
 *
 * `schemaFilter` keeps drizzle-kit inside `public` — Supabase owns `auth`,
 * `storage` and the rest, and a push must never try to reconcile them. The
 * `roles` entry tells it Supabase already provides `authenticated` & co., so
 * the RLS policies can reference them without drizzle-kit creating them.
 */
export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL ?? "",
  },
  schemaFilter: ["public"],
  entities: { roles: { provider: "supabase" } },
  verbose: true,
  strict: true,
} satisfies Config;
