"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";

import { redirect } from "next/navigation";
import { z } from "zod";

import { db } from "@/db/client";
import { deleteSetting, getProfile, setSetting, SETTING_KEYS } from "@/db/bootstrap";
import { getSessionUser, isAdmin, withVault } from "@/db/session";
import { profile } from "@/db/schema";
import { profileSchema } from "@/lib/profile-schema";
import { seal } from "@/lib/secret-box";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { createSupabaseServer } from "@/lib/supabase/server";

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function saveProfile(formData: FormData): Promise<ActionResult> {
  return withVault(async () => {
    // Links arrive as parallel label[]/url[] arrays from the repeatable field group.
    const labels = formData.getAll("linkLabel").map(String);
    const urls = formData.getAll("linkUrl").map(String);
    const links = labels
      .map((label, i) => ({ label: label.trim(), url: (urls[i] ?? "").trim() }))
      // Drop rows where either half is blank rather than saving half a link.
      .filter((l) => l.label && l.url);

    const parsed = profileSchema.safeParse({
      fullName: formData.get("fullName") ?? "",
      email: formData.get("email") ?? "",
      phone: formData.get("phone") ?? "",
      location: formData.get("location") ?? "",
      summary: formData.get("summary") ?? "",
      links,
    });

    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
    }

    const current = await getProfile();

    await db
      .update(profile)
      .set({
        ...parsed.data,
        updatedAt: Math.floor(Date.now() / 1000),
      })
      .where(eq(profile.id, current.id));

    revalidatePath("/settings");
    // Every resume's header reads this one shared profile, unlike other actions
    // here which are scoped to a single resumeId. Without this, a resume page
    // already open in the client Router Cache keeps showing the old label/url
    // until a hard reload.
    revalidatePath("/resume/[id]", "page");
    return { ok: true };
  });
}

export async function saveVaultLinkMode(mode: string): Promise<ActionResult> {
  if (mode !== "snapshot" && mode !== "linked") {
    return { ok: false, error: "Unknown mode" };
  }
  await withVault(() => setSetting(SETTING_KEYS.vaultLinkMode, mode));
  revalidatePath("/settings");
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* AI key                                                              */
/* ------------------------------------------------------------------ */

const aiKeySchema = z.object({
  provider: z.enum(["anthropic", "gemini"]),
  apiKey: z.string().trim().min(20, "That doesn't look like a full API key").max(400),
});

/**
 * Store the user's own provider key, encrypted.
 *
 * Not validated against the provider here: a network check would make saving
 * depend on the provider being up, and a bad key already degrades the right
 * way — the tuner falls back to local parsing and says why.
 */
export async function saveAiKey(provider: string, apiKey: string): Promise<ActionResult> {
  const parsed = aiKeySchema.safeParse({ provider, apiKey });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]!.message };

  const secret = process.env.VAULTCV_SECRET ?? "";
  if (!secret) {
    return {
      ok: false,
      error:
        "The server has no VAULTCV_SECRET set, so keys can't be stored safely. Ask the admin to set one.",
    };
  }

  await withVault(async () => {
    await setSetting(SETTING_KEYS.aiProvider, parsed.data.provider);
    await setSetting(SETTING_KEYS.aiKey, seal(parsed.data.apiKey, secret));
    await setSetting(SETTING_KEYS.aiKeyHint, parsed.data.apiKey.slice(-4));
  });

  revalidatePath("/settings");
  revalidatePath("/");
  return { ok: true };
}

export async function clearAiKey(): Promise<ActionResult> {
  await withVault(async () => {
    await deleteSetting(SETTING_KEYS.aiProvider);
    await deleteSetting(SETTING_KEYS.aiKey);
    await deleteSetting(SETTING_KEYS.aiKeyHint);
  });
  revalidatePath("/settings");
  revalidatePath("/");
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Account                                                             */
/* ------------------------------------------------------------------ */

const passwordSchema = z
  .object({
    password: z.string().min(8, "Use at least 8 characters").max(72),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: "The two passwords don't match" });

export async function changePassword(formData: FormData): Promise<ActionResult> {
  const parsed = passwordSchema.safeParse({
    password: formData.get("password") ?? "",
    confirm: formData.get("confirm") ?? "",
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]!.message };

  const supabase = await createSupabaseServer();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Delete the signed-in account and everything in it.
 *
 * Deleting the auth user is the whole operation: every table's `user_id`
 * references auth.users with ON DELETE CASCADE, so the vault, resumes and
 * tuning history go with it in one statement on Supabase's side.
 *
 * The admin can't delete their own account here — that would leave nobody
 * able to invite or manage users.
 */
export async function deleteMyAccount(): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Not signed in" };
  if (isAdmin(user)) {
    return { ok: false, error: "The admin account can't delete itself from here." };
  }

  const admin = createSupabaseAdmin();
  if (!admin) return { ok: false, error: "Account deletion isn't configured on this server." };

  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) return { ok: false, error: error.message };

  const supabase = await createSupabaseServer();
  await supabase.auth.signOut();
  redirect("/login?deleted=1");
}
