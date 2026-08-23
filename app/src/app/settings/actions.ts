"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";

import { db } from "@/db/client";
import { bootstrap, getProfile, setSetting, SETTING_KEYS } from "@/db/bootstrap";
import { profile } from "@/db/schema";
import { profileSchema } from "@/lib/profile-schema";

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function saveProfile(formData: FormData): Promise<ActionResult> {
  bootstrap();

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

  const current = getProfile();

  db.update(profile)
    .set({
      ...parsed.data,
      updatedAt: Math.floor(Date.now() / 1000),
    })
    .where(eq(profile.id, current.id))
    .run();

  revalidatePath("/settings");
  // Every resume's header reads this one shared profile, unlike other actions
  // here which are scoped to a single resumeId. Without this, a resume page
  // already open in the client Router Cache keeps showing the old label/url
  // until a hard reload.
  revalidatePath("/resume/[id]", "page");
  return { ok: true };
}

export async function saveVaultLinkMode(mode: string): Promise<ActionResult> {
  if (mode !== "snapshot" && mode !== "linked") {
    return { ok: false, error: "Unknown mode" };
  }
  setSetting(SETTING_KEYS.vaultLinkMode, mode);
  revalidatePath("/settings");
  return { ok: true };
}
