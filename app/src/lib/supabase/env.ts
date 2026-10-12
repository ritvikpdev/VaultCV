/**
 * Supabase settings, read in one place.
 *
 * Accepts both key generations: the current "publishable"/"secret" names and
 * the legacy "anon"/"service_role" ones, since the dashboard shows whichever
 * the project was created with.
 */

export function supabaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set — see app/.env.example");
  return url;
}

export function supabasePublishableKey(): string {
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is not set — see app/.env.example");
  }
  return key;
}

/** Server-only. Bypasses row-level security — used solely by the admin page. */
export function supabaseSecretKey(): string | null {
  return process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? null;
}
