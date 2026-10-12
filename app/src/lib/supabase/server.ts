import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { supabasePublishableKey, supabaseUrl } from "./env";

/**
 * Supabase client for Server Components, Server Actions and route handlers,
 * reading and refreshing the session from cookies.
 *
 * Server Components can't set cookies, so `setAll` swallows that error — the
 * middleware refreshes the session on every request anyway, which is why this
 * is safe to ignore here.
 */
export async function createSupabaseServer() {
  const cookieStore = await cookies();

  return createServerClient(supabaseUrl(), supabasePublishableKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(toSet) {
        try {
          for (const { name, value, options } of toSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component — see above.
        }
      },
    },
  });
}
