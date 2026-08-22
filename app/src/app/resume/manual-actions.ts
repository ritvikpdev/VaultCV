"use server";

import { revalidatePath } from "next/cache";
import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { bootstrap } from "@/db/bootstrap";
import {
  resumeBullets,
  resumeEntries,
  resumeSections,
  vaultBullets,
  vaultEntries,
  vaultSections,
} from "@/db/schema";
import { bulletStrength } from "@/lib/bullet-strength";
import { normalizeTerm } from "@/lib/skill-aliases";

export type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : { data: T }))
  | { ok: false; error: string };

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

const dateField = z
  .string()
  .trim()
  .max(10)
  .refine((v) => v === "" || /^(0[1-9]|1[0-2])\/\d{4}$/.test(v) || /^\d{4}$/.test(v), {
    message: "Dates must look like MM/YYYY or YYYY",
  });

const manualEntrySchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  organization: z.string().trim().max(200),
  subtitle: z.string().trim().max(300),
  location: z.string().trim().max(160),
  startDate: dateField,
  endDate: dateField,
  isCurrent: z.boolean(),
});

export type ManualEntryInput = z.infer<typeof manualEntrySchema>;

function resumeIdForSection(sectionId: number): number | null {
  return (
    db
      .select({ id: resumeSections.resumeId })
      .from(resumeSections)
      .where(eq(resumeSections.id, sectionId))
      .get()?.id ?? null
  );
}

/**
 * Is there already a vault entry that looks like this one?
 *
 * Title + organization compared loosely. Used to decide whether to offer the
 * "also save to your vault?" prompt — asking about something already there
 * would be noise, and saving it again would duplicate.
 */
function findVaultEntryLike(title: string, organization: string): number | null {
  const t = normalizeTerm(title);
  const o = normalizeTerm(organization);

  // Searched across the whole vault rather than one section: the user may well
  // have filed this job under a section named differently from the resume's,
  // and offering to save a duplicate would be worse than a slightly loose match.
  const match = db
    .select()
    .from(vaultEntries)
    .all()
    .find(
      (e) => normalizeTerm(e.title) === t && (!o || normalizeTerm(e.organization) === o),
    );

  return match?.id ?? null;
}

/**
 * The vault section a resume section corresponds to, creating it if needed.
 *
 * Vault sections are user-defined now, so there's no type to look up — the
 * resume section's own heading is the link. Matching by heading means "Work
 * Experience" on a resume lands in "Work Experience" in the vault, and a
 * heading you invented creates the section it needs.
 */
function ensureVaultSection(heading: string, type: "normal" | "skill"): number {
  const target = heading.trim().toLowerCase();

  const existing = db
    .select()
    .from(vaultSections)
    .all()
    .find((s) => s.heading.trim().toLowerCase() === target);

  if (existing) return existing.id;

  const last = db
    .select({ o: vaultSections.displayOrder })
    .from(vaultSections)
    .orderBy(desc(vaultSections.displayOrder))
    .get();

  return db
    .insert(vaultSections)
    .values({ heading: heading.trim(), type, displayOrder: (last?.o ?? -1) + 1 })
    .returning({ id: vaultSections.id })
    .get().id;
}

/**
 * Create an entry typed directly into a resume.
 *
 * Writes to the resume first and always — the user's edit lands regardless of
 * what they decide about the vault. `vaultEntryId` in the result is null when
 * nothing similar exists, which is the caller's cue to offer the prompt.
 */
export async function addManualEntry(
  sectionId: number,
  input: ManualEntryInput,
): Promise<ActionResult<{ resumeEntryId: number; existsInVault: boolean }>> {
  bootstrap();

  const parsed = manualEntrySchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]!.message);

  const section = db
    .select()
    .from(resumeSections)
    .where(eq(resumeSections.id, sectionId))
    .get();
  if (!section) return fail("Section not found");

  const last = db
    .select({ o: resumeEntries.displayOrder })
    .from(resumeEntries)
    .where(eq(resumeEntries.sectionId, sectionId))
    .orderBy(desc(resumeEntries.displayOrder))
    .get();

  const data = parsed.data;

  const row = db
    .insert(resumeEntries)
    .values({
      sectionId,
      sourceEntryId: null,
      titleOverride: data.title,
      organizationOverride: data.organization,
      subtitleOverride: data.subtitle,
      locationOverride: data.location,
      startDateOverride: data.startDate,
      endDateOverride: data.isCurrent ? "" : data.endDate,
      displayOrder: (last?.o ?? -1) + 1,
    })
    .returning({ id: resumeEntries.id })
    .get();

  const existing = findVaultEntryLike(data.title, data.organization);

  revalidatePath(`/resume/${section.resumeId}`);
  return {
    ok: true,
    data: { resumeEntryId: row.id, existsInVault: existing !== null },
  };
}

/**
 * Copy a resume entry into the vault and link them.
 *
 * Called only after the user answers Yes. Links via `source_entry_id` so the
 * entry stops looking resume-only, and its bullets go across too.
 */
export async function saveEntryToVault(
  resumeEntryId: number,
): Promise<ActionResult<number>> {
  bootstrap();

  const entry = db
    .select()
    .from(resumeEntries)
    .where(eq(resumeEntries.id, resumeEntryId))
    .get();
  if (!entry) return fail("Entry not found");
  if (entry.sourceEntryId) return { ok: true, data: entry.sourceEntryId };

  const section = db
    .select()
    .from(resumeSections)
    .where(eq(resumeSections.id, entry.sectionId))
    .get();
  if (!section) return fail("Section not found");

  const vaultSectionId = ensureVaultSection(
    section.heading,
    section.layout === "skill" ? "skill" : "normal",
  );

  const lastOrder = db
    .select({ o: vaultEntries.displayOrder })
    .from(vaultEntries)
    .where(eq(vaultEntries.sectionId, vaultSectionId))
    .orderBy(desc(vaultEntries.displayOrder))
    .get();

  const vaultRow = db
    .insert(vaultEntries)
    .values({
      sectionId: vaultSectionId,
      title: entry.titleOverride ?? "Untitled",
      organization: entry.organizationOverride ?? "",
      subtitle: entry.subtitleOverride ?? "",
      location: entry.locationOverride ?? "",
      startDate: entry.startDateOverride ?? "",
      endDate: entry.endDateOverride ?? "",
      displayOrder: (lastOrder?.o ?? -1) + 1,
    })
    .returning({ id: vaultEntries.id })
    .get();

  const bullets = db
    .select()
    .from(resumeBullets)
    .where(eq(resumeBullets.resumeEntryId, resumeEntryId))
    .orderBy(asc(resumeBullets.displayOrder))
    .all();

  bullets.forEach((b, i) => {
    if (!b.text?.trim() || b.sourceBulletId) return;

    const created = db
      .insert(vaultBullets)
      .values({
        entryId: vaultRow.id,
        text: b.text,
        strength: bulletStrength(b.text),
        displayOrder: i,
      })
      .returning({ id: vaultBullets.id })
      .get();

    db.update(resumeBullets)
      .set({ sourceBulletId: created.id })
      .where(eq(resumeBullets.id, b.id))
      .run();
  });

  db.update(resumeEntries)
    .set({ sourceEntryId: vaultRow.id })
    .where(eq(resumeEntries.id, resumeEntryId))
    .run();

  revalidatePath(`/resume/${section.resumeId}`);
  revalidatePath("/vault");
  return { ok: true, data: vaultRow.id };
}

/* ------------------------------------------------------------------ */
/* Bullets                                                             */
/* ------------------------------------------------------------------ */

/**
 * Add a bullet typed by hand to a resume entry.
 *
 * `canSaveToVault` tells the caller whether the prompt is worth showing: only
 * when the entry is linked to the vault and the vault doesn't already hold
 * this wording.
 */
export async function addManualBullet(
  resumeEntryId: number,
  text: string,
): Promise<ActionResult<{ bulletId: number; canSaveToVault: boolean }>> {
  bootstrap();

  const parsed = z.string().trim().min(1, "Bullet can't be empty").max(1000).safeParse(text);
  if (!parsed.success) return fail(parsed.error.issues[0]!.message);

  const entry = db
    .select()
    .from(resumeEntries)
    .where(eq(resumeEntries.id, resumeEntryId))
    .get();
  if (!entry) return fail("Entry not found");

  const last = db
    .select({ o: resumeBullets.displayOrder })
    .from(resumeBullets)
    .where(eq(resumeBullets.resumeEntryId, resumeEntryId))
    .orderBy(desc(resumeBullets.displayOrder))
    .get();

  const row = db
    .insert(resumeBullets)
    .values({
      resumeEntryId,
      sourceBulletId: null,
      text: parsed.data,
      displayOrder: (last?.o ?? -1) + 1,
    })
    .returning({ id: resumeBullets.id })
    .get();

  let canSaveToVault = false;
  if (entry.sourceEntryId) {
    const already = db
      .select()
      .from(vaultBullets)
      .where(eq(vaultBullets.entryId, entry.sourceEntryId))
      .all()
      .some((b) => normalizeTerm(b.text) === normalizeTerm(parsed.data));
    canSaveToVault = !already;
  }

  const resumeId = resumeIdForSection(entry.sectionId);
  if (resumeId) revalidatePath(`/resume/${resumeId}`);

  return { ok: true, data: { bulletId: row.id, canSaveToVault } };
}

/** Copy a resume bullet into its entry's vault record and link them. */
export async function saveBulletToVault(
  resumeBulletId: number,
): Promise<ActionResult> {
  bootstrap();

  const bullet = db
    .select()
    .from(resumeBullets)
    .where(eq(resumeBullets.id, resumeBulletId))
    .get();
  if (!bullet?.text?.trim()) return fail("Bullet not found");
  if (bullet.sourceBulletId) return { ok: true };

  const entry = db
    .select()
    .from(resumeEntries)
    .where(eq(resumeEntries.id, bullet.resumeEntryId))
    .get();
  if (!entry?.sourceEntryId) {
    return fail("This entry isn't in your vault yet — save the entry first");
  }

  const last = db
    .select({ o: vaultBullets.displayOrder })
    .from(vaultBullets)
    .where(eq(vaultBullets.entryId, entry.sourceEntryId))
    .orderBy(desc(vaultBullets.displayOrder))
    .get();

  const created = db
    .insert(vaultBullets)
    .values({
      entryId: entry.sourceEntryId,
      text: bullet.text,
      strength: bulletStrength(bullet.text),
      displayOrder: (last?.o ?? -1) + 1,
    })
    .returning({ id: vaultBullets.id })
    .get();

  db.update(resumeBullets)
    .set({ sourceBulletId: created.id })
    .where(eq(resumeBullets.id, resumeBulletId))
    .run();

  const resumeId = resumeIdForSection(entry.sectionId);
  if (resumeId) revalidatePath(`/resume/${resumeId}`);
  revalidatePath("/vault");

  return { ok: true };
}

/**
 * Vault bullets available to add to a resume entry.
 *
 * Returns the entry's own unused bullets first — that's what you want 90% of
 * the time — with everything else from the vault behind a search.
 */
export async function bulletOptionsForEntry(
  resumeEntryId: number,
  query = "",
): Promise<
  ActionResult<{
    sameEntry: Array<{ id: number; text: string; strength: number }>;
    others: Array<{ id: number; text: string; strength: number; from: string }>;
  }>
> {
  bootstrap();

  const entry = db
    .select()
    .from(resumeEntries)
    .where(eq(resumeEntries.id, resumeEntryId))
    .get();
  if (!entry) return fail("Entry not found");

  const used = new Set(
    db
      .select()
      .from(resumeBullets)
      .where(eq(resumeBullets.resumeEntryId, resumeEntryId))
      .all()
      .map((b) => b.sourceBulletId)
      .filter((v): v is number => v !== null),
  );

  const allEntries = new Map(db.select().from(vaultEntries).all().map((e) => [e.id, e]));
  const q = normalizeTerm(query);

  const all = db
    .select()
    .from(vaultBullets)
    .orderBy(asc(vaultBullets.displayOrder))
    .all()
    .filter((b) => b.isActive && !used.has(b.id))
    .filter((b) => !q || normalizeTerm(b.text).includes(q));

  const sameEntry = all
    .filter((b) => entry.sourceEntryId !== null && b.entryId === entry.sourceEntryId)
    .map((b) => ({ id: b.id, text: b.text, strength: b.strength }));

  const others = all
    .filter((b) => entry.sourceEntryId === null || b.entryId !== entry.sourceEntryId)
    .slice(0, 40)
    .map((b) => {
      const from = allEntries.get(b.entryId);
      return {
        id: b.id,
        text: b.text,
        strength: b.strength,
        from: from ? `${from.title}${from.organization ? `, ${from.organization}` : ""}` : "",
      };
    });

  return { ok: true, data: { sameEntry, others } };
}

/** Attach an existing vault bullet to a resume entry. */
export async function addVaultBulletToEntry(
  resumeEntryId: number,
  vaultBulletId: number,
): Promise<ActionResult> {
  bootstrap();

  const bullet = db
    .select()
    .from(vaultBullets)
    .where(eq(vaultBullets.id, vaultBulletId))
    .get();
  if (!bullet) return fail("That bullet is no longer in your vault");

  const entry = db
    .select()
    .from(resumeEntries)
    .where(eq(resumeEntries.id, resumeEntryId))
    .get();
  if (!entry) return fail("Entry not found");

  const duplicate = db
    .select()
    .from(resumeBullets)
    .where(
      and(
        eq(resumeBullets.resumeEntryId, resumeEntryId),
        eq(resumeBullets.sourceBulletId, vaultBulletId),
      ),
    )
    .get();
  if (duplicate) return { ok: true };

  const last = db
    .select({ o: resumeBullets.displayOrder })
    .from(resumeBullets)
    .where(eq(resumeBullets.resumeEntryId, resumeEntryId))
    .orderBy(desc(resumeBullets.displayOrder))
    .get();

  db.insert(resumeBullets)
    .values({
      resumeEntryId,
      sourceBulletId: vaultBulletId,
      text: bullet.text,
      displayOrder: (last?.o ?? -1) + 1,
    })
    .run();

  const resumeId = resumeIdForSection(entry.sectionId);
  if (resumeId) revalidatePath(`/resume/${resumeId}`);

  return { ok: true };
}
