"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { siteOrigin } from "@/db/session";
import { createSupabaseServer } from "@/lib/supabase/server";
import { safeNext } from "@/lib/safe-next";

export type AuthResult = { ok: true; message?: string } | { ok: false; error: string };

const credentials = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  password: z.string().min(1, "Enter your password"),
});

export async function signIn(formData: FormData): Promise<AuthResult> {
  const parsed = credentials.safeParse({
    email: formData.get("email") ?? "",
    password: formData.get("password") ?? "",
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]!.message };

  const supabase = await createSupabaseServer();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  // One message for every failure. Saying "no such account" would tell a
  // stranger which emails are invited.
  if (error) return { ok: false, error: "That email and password don't match an account." };

  redirect(safeNext(String(formData.get("next") ?? "")));
}

export async function signOut() {
  const supabase = await createSupabaseServer();
  await supabase.auth.signOut();
  redirect("/login");
}

/**
 * Email a reset link. Always answers the same way, whether or not the address
 * has an account, for the same reason as above.
 *
 * The link comes back through /auth/confirm, which signs the user in and
 * forwards to /auth/set-password. Supabase's built-in mailer only delivers to
 * the project's own team, so friends need custom SMTP for this — see README.
 * Without it, the admin page hands out reset links directly.
 */
export async function requestPasswordReset(formData: FormData): Promise<AuthResult> {
  const email = z
    .string()
    .trim()
    .toLowerCase()
    .email()
    .safeParse(formData.get("email") ?? "");
  if (!email.success) return { ok: false, error: "Enter a valid email address" };

  const supabase = await createSupabaseServer();
  await supabase.auth.resetPasswordForEmail(email.data, {
    redirectTo: `${await siteOrigin()}/auth/confirm?next=/auth/set-password`,
  });

  return {
    ok: true,
    message: "If that address has an account, a reset link is on its way. Check your inbox.",
  };
}

const newPassword = z
  .object({
    password: z.string().min(8, "Use at least 8 characters").max(72),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: "The two passwords don't match" });

/** Set a password after following an invite or reset link. */
export async function setNewPassword(formData: FormData): Promise<AuthResult> {
  const parsed = newPassword.safeParse({
    password: formData.get("password") ?? "",
    confirm: formData.get("confirm") ?? "",
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]!.message };

  const supabase = await createSupabaseServer();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    return {
      ok: false,
      error: /session/i.test(error.message)
        ? "This link has expired. Ask for a new one."
        : error.message,
    };
  }

  redirect("/");
}
