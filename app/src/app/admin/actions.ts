"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getSessionUser, isAdmin, siteOrigin } from "@/db/session";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export type AdminResult<T = undefined> =
  ({ ok: true } & (T extends undefined ? object : { data: T })) | { ok: false; error: string };

/**
 * Every admin action starts here. The page hides itself from non-admins, but
 * an action is a public endpoint — the check has to live in the action too.
 */
async function adminClient() {
  const user = await getSessionUser();
  if (!isAdmin(user)) return { error: "Only the admin can do that." } as const;
  const client = createSupabaseAdmin();
  if (!client) {
    return {
      error: "SUPABASE_SECRET_KEY isn't set on the server, so users can't be managed.",
    } as const;
  }
  return { client, user: user! } as const;
}

const emailSchema = z.string().trim().toLowerCase().email("Enter a valid email address");

/**
 * A one-time link that signs the person in and asks them to choose a password.
 *
 * Built from the hashed token rather than the action_link Supabase returns:
 * that link runs through Supabase's default redirect, which hands the session
 * over in a URL fragment a server can't read. Ours goes to /auth/confirm.
 */
async function linkFor(type: "invite" | "recovery", hashedToken: string) {
  const params = new URLSearchParams({ token_hash: hashedToken, type });
  return `${await siteOrigin()}/auth/confirm?${params}`;
}

/**
 * Invite by link — creates the account and returns a link to send however you
 * like. Needs no email setup at all, which is why it's the default.
 */
export async function createInviteLink(email: string): Promise<AdminResult<string>> {
  const admin = await adminClient();
  if ("error" in admin) return { ok: false, error: admin.error! };

  const parsed = emailSchema.safeParse(email);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]!.message };

  const { data, error } = await admin.client.auth.admin.generateLink({
    type: "invite",
    email: parsed.data,
  });
  if (error) {
    return {
      ok: false,
      error: /already|registered|exists/i.test(error.message)
        ? "That email already has an account. Use “Reset link” on their row instead."
        : error.message,
    };
  }

  revalidatePath("/admin");
  return { ok: true, data: await linkFor("invite", data.properties.hashed_token) };
}

/**
 * Invite by email, sent by Supabase. Only delivers to arbitrary addresses once
 * the project has custom SMTP — see README.
 */
export async function sendInviteEmail(email: string): Promise<AdminResult> {
  const admin = await adminClient();
  if ("error" in admin) return { ok: false, error: admin.error! };

  const parsed = emailSchema.safeParse(email);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]!.message };

  const { error } = await admin.client.auth.admin.inviteUserByEmail(parsed.data, {
    redirectTo: `${await siteOrigin()}/auth/set-password`,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin");
  return { ok: true };
}

/** A one-time link to set a new password, for someone locked out. */
export async function createResetLink(email: string): Promise<AdminResult<string>> {
  const admin = await adminClient();
  if ("error" in admin) return { ok: false, error: admin.error! };

  const parsed = emailSchema.safeParse(email);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]!.message };

  // An invite that was never accepted can't be "recovered" — re-issue the invite.
  const { data: list } = await admin.client.auth.admin.listUsers({ perPage: 1000 });
  const target = list?.users.find((u) => u.email?.toLowerCase() === parsed.data);
  const type = target && !target.email_confirmed_at ? "invite" : "recovery";

  const { data, error } =
    type === "invite"
      ? await admin.client.auth.admin.generateLink({ type: "invite", email: parsed.data })
      : await admin.client.auth.admin.generateLink({ type: "recovery", email: parsed.data });
  if (error) return { ok: false, error: error.message };

  return { ok: true, data: await linkFor(type, data.properties.hashed_token) };
}

/**
 * Delete a user and — through ON DELETE CASCADE on every table's user_id —
 * everything they stored.
 */
export async function deleteUser(userId: string): Promise<AdminResult> {
  const admin = await adminClient();
  if ("error" in admin) return { ok: false, error: admin.error! };
  if (userId === admin.user.id) return { ok: false, error: "You can't delete your own account." };

  const { error } = await admin.client.auth.admin.deleteUser(userId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin");
  return { ok: true };
}
