import "server-only";

import { createClient } from "@supabase/supabase-js";

import { supabaseSecretKey, supabaseUrl } from "./env";

/**
 * Service-role client for user management: invite, reset links, delete.
 *
 * Holds a key that bypasses row-level security, so it is created only inside
 * admin-gated actions and never touches vault data — that always goes through
 * the user-scoped connection in db/client.ts.
 *
 * Returns null when the secret key isn't configured; the admin page explains
 * rather than crashing.
 */
export function createSupabaseAdmin() {
  const key = supabaseSecretKey();
  if (!key) return null;
  return createClient(supabaseUrl(), key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
