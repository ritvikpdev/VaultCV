import type { EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";

import { safeNext } from "@/lib/safe-next";
import { createSupabaseServer } from "@/lib/supabase/server";

const TYPES: EmailOtpType[] = [
  "invite",
  "recovery",
  "email",
  "magiclink",
  "signup",
  "email_change",
];

/**
 * Where invite and password-reset links land.
 *
 * The link carries a one-time `token_hash`; verifying it signs the visitor in
 * and sets the session cookies on this response. Invites and resets then go on
 * to /auth/set-password.
 *
 * Two link shapes arrive here:
 *   ?token_hash=…&type=…  — invite links from /admin, and emails whose template
 *                           was customised (README). Works in any browser.
 *   ?code=…               — Supabase's default email flow (PKCE). Works only in
 *                           the browser that asked, which is fine for "forgot
 *                           password" and why invites never use it.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  const fallbackNext = type === "invite" || type === "recovery" ? "/auth/set-password" : "/";
  const next = safeNext(searchParams.get("next"), fallbackNext);

  const code = searchParams.get("code");
  if (code) {
    const supabase = await createSupabaseServer();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) redirect(safeNext(searchParams.get("next")));
  }

  if (tokenHash && type && TYPES.includes(type)) {
    const supabase = await createSupabaseServer();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) redirect(next);
  }

  // `redirect()` rather than a NextResponse: it carries the session cookies
  // the verify call just set, exactly as Supabase's own SSR guide does.
  redirect("/login?error=link");
}
