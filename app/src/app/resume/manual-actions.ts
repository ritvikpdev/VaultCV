"use server";

import { revalidatePath } from "next/cache";
import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { db, first } from "@/db/client";
import { withVault } from "@/db/session";
import {
  resumeBullets,
  resumeEntries,
  resumeSections,
  vaultBullets,
  vaultEntries,
  vaultSections,
} from "@/db/schema";
import { ensureGroupNamed } from "@/db/vault-groups";
import { bulletStrength } from "@/lib/bullet-strength";
import { normalizeTerm } from "@/lib/skill-aliases";

export type ActionResult<T = undefined> =
  ({ ok: true } & (T extends undefined ? object : { data: T })) | { ok: false; error: string };

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

async function resumeIdForSection(sectionId: number): Promise<number | null> {
  return (
    (
      await first(
        db
          .select({ id: resumeSections.resumeId })
          .from(resumeSections)
          .where(eq(resumeSections.id, sectionId)),
      )
    )?.id ?? null
  );
}

/**
 * Is there already a vault entry that looks like this one?
 *
 * Title + organization compared loosely. Used to decide whether to offer the
 * "also save to your vault?" prompt — asking about something already there
 * would be noise, and saving it again would duplicate.
 */
async function findVaultEntryLike(title: string, organization: string): Promise<number | null> {
  const t = normalizeTerm(title);
  const o = normalizeTerm(organization);

  // Searched across the whole vault rather than one section: the user may well
  // have filed this job under a section named differently from the resume's,
  // and offering to save a duplicate would be worse than a slightly loose match.
  const match = (await db.select().from(vaultEntries)).find(
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
async function ensureVaultSection(heading: string, type: "normal" | "skill"): Promise<number> {
  const target = heading.trim().toLowerCase();

  const existing = (await db.select().from(vaultSections)).find(
    (s) => s.heading.trim().toLowerCase() === target,
  );

  if (existing) return existing.id;

  const last = await first(
    db
      .select({ o: vaultSections.displayOrder })
      .from(vaultSections)
      .orderBy(desc(vaultSections.displayOrder)),
  );

  return (await first(
    db
      .insert(vaultSections)
      .values({
        heading: heading.trim(),
        type,
        // Every section needs a group; a new one gets a group of its own name.
        groupId: await ensureGroupNamed(heading),
        displayOrder: (last?.o ?? -1) + 1,
      })
      .returning({ id: vaultSections.id }),
  ))!.id;
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
  return withVault(async () => {
    const parsed = manualEntrySchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]!.message);

    const section = await first(
      db.select().from(resumeSections).where(eq(resumeSections.id, sectionId)),
    );
    if (!section) return fail("Section not found");

    const last = await first(
      db
        .select({ o: resumeEntries.displayOrder })
        .from(resumeEntries)
        .where(eq(resumeEntries.sectionId, sectionId))
        .orderBy(desc(resumeEntries.displayOrder)),
    );

    const data = parsed.data;

    const row = (await first(
      db
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
        .returning({ id: resumeEntries.id }),
    ))!;

    const existing = await findVaultEntryLike(data.title, data.organization);

    revalidatePath(`/resume/${section.resumeId}`);
    return {
      ok: true,
      data: { resumeEntryId: row.id, existsInVault: existing !== null },
    };
  });
}

/**
 * The vault entry a resume entry belongs to, creating it from the resume's
 * fields if it has none yet, and linking the two.
 *
 * Creates the entry only — no bullets. Callers decide which bullets go with
 * it: all of them (save entry) or just one (save this bullet).
 */
async function ensureVaultEntryFor(
  entry: typeof resumeEntries.$inferSelect,
): Promise<{ ok: true; id: number; resumeId: number | null } | { ok: false; error: string }> {
  const section = await first(
    db.select().from(resumeSections).where(eq(resumeSections.id, entry.sectionId)),
  );
  if (!section) return fail("Section not found");
  if (entry.sourceEntryId) return { ok: true, id: entry.sourceEntryId, resumeId: section.resumeId };

  const vaultSectionId = await ensureVaultSection(
    section.heading,
    section.layout === "skill" ? "skill" : "normal",
  );

  const lastOrder = await first(
    db
      .select({ o: vaultEntries.displayOrder })
      .from(vaultEntries)
      .where(eq(vaultEntries.sectionId, vaultSectionId))
      .orderBy(desc(vaultEntries.displayOrder)),
  );

  const vaultRow = (await first(
    db
      .insert(vaultEntries)
      .values({
        sectionId: vaultSectionId,
        title: entry.titleOverride?.trim() || "Untitled",
        organization: entry.organizationOverride ?? "",
        subtitle: entry.subtitleOverride ?? "",
        location: entry.locationOverride ?? "",
        startDate: entry.startDateOverride ?? "",
        endDate: entry.endDateOverride ?? "",
        isCurrent: entry.isCurrentOverride ?? false,
        url: entry.urlOverride ?? "",
        meta: entry.metaOverride ?? {},
        displayOrder: (lastOrder?.o ?? -1) + 1,
      })
      .returning({ id: vaultEntries.id }),
  ))!;

  await db
    .update(resumeEntries)
    .set({ sourceEntryId: vaultRow.id })
    .where(eq(resumeEntries.id, entry.id));

  return { ok: true, id: vaultRow.id, resumeId: section.resumeId };
}

/**
 * Copy one resume bullet into a vault entry and link them.
 *
 * Plain `text` only — formatting belongs to the resume. If the vault entry
 * already holds the same wording, the bullet is linked to that row instead of
 * duplicating it.
 */
async function copyBulletToVault(
  bullet: typeof resumeBullets.$inferSelect,
  vaultEntryId: number,
): Promise<number> {
  const text = bullet.text!.trim();
  const siblings = await db.select().from(vaultBullets).where(eq(vaultBullets.entryId, vaultEntryId));
  const same = siblings.find((v) => normalizeTerm(v.text) === normalizeTerm(text));

  let vaultBulletId: number;
  if (same) {
    vaultBulletId = same.id;
  } else {
    const last = siblings.reduce((m, v) => Math.max(m, v.displayOrder), -1);
    vaultBulletId = (await first(
      db
        .insert(vaultBullets)
        .values({
          entryId: vaultEntryId,
          text,
          strength: bulletStrength(text),
          displayOrder: last + 1,
        })
        .returning({ id: vaultBullets.id }),
    ))!.id;
  }

  await db
    .update(resumeBullets)
    .set({ sourceBulletId: vaultBulletId })
    .where(eq(resumeBullets.id, bullet.id));
  return vaultBulletId;
}

/**
 * Save a resume entry to the vault, with every bullet not already there.
 *
 * Safe to call again: on an entry that's already linked it adds just the
 * bullets written since, so "Save entry to vault" stays useful after a few
 * single bullets have been saved one by one.
 */
export async function saveEntryToVault(resumeEntryId: number): Promise<ActionResult<number>> {
  return withVault(async () => {
    const entry = await first(
      db.select().from(resumeEntries).where(eq(resumeEntries.id, resumeEntryId)),
    );
    if (!entry) return fail("Entry not found");

    const target = await ensureVaultEntryFor(entry);
    if (!target.ok) return target;

    const bullets = await db
      .select()
      .from(resumeBullets)
      .where(eq(resumeBullets.resumeEntryId, resumeEntryId))
      .orderBy(asc(resumeBullets.displayOrder));

    for (const b of bullets) {
      if (!b.text?.trim() || b.sourceBulletId) continue;
      await copyBulletToVault(b, target.id);
    }

    if (target.resumeId) revalidatePath(`/resume/${target.resumeId}`);
    revalidatePath("/vault");
    return { ok: true, data: target.id };
  });
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
  return withVault(async () => {
    const parsed = z.string().trim().min(1, "Bullet can't be empty").max(1000).safeParse(text);
    if (!parsed.success) return fail(parsed.error.issues[0]!.message);

    const entry = await first(
      db.select().from(resumeEntries).where(eq(resumeEntries.id, resumeEntryId)),
    );
    if (!entry) return fail("Entry not found");

    const last = await first(
      db
        .select({ o: resumeBullets.displayOrder })
        .from(resumeBullets)
        .where(eq(resumeBullets.resumeEntryId, resumeEntryId))
        .orderBy(desc(resumeBullets.displayOrder)),
    );

    const row = (await first(
      db
        .insert(resumeBullets)
        .values({
          resumeEntryId,
          sourceBulletId: null,
          text: parsed.data,
          displayOrder: (last?.o ?? -1) + 1,
        })
        .returning({ id: resumeBullets.id }),
    ))!;

    let canSaveToVault = false;
    if (entry.sourceEntryId) {
      const already = (
        await db.select().from(vaultBullets).where(eq(vaultBullets.entryId, entry.sourceEntryId))
      ).some((b) => normalizeTerm(b.text) === normalizeTerm(parsed.data));
      canSaveToVault = !already;
    }

    const resumeId = await resumeIdForSection(entry.sectionId);
    if (resumeId) revalidatePath(`/resume/${resumeId}`);

    return { ok: true, data: { bulletId: row.id, canSaveToVault } };
  });
}

/**
 * Save one resume bullet to the vault.
 *
 * If its entry isn't in the vault yet, the entry is created there first —
 * fields only, without its other bullets — so a single good line can be kept
 * without committing the whole entry.
 */
export async function saveBulletToVault(
  resumeBulletId: number,
): Promise<ActionResult<{ vaultBulletId: number; entryCreated: boolean }>> {
  return withVault(async () => {
    const bullet = await first(
      db.select().from(resumeBullets).where(eq(resumeBullets.id, resumeBulletId)),
    );
    if (!bullet?.text?.trim()) return fail("Write something in this line first");
    if (bullet.sourceBulletId) {
      return { ok: true, data: { vaultBulletId: bullet.sourceBulletId, entryCreated: false } };
    }

    const entry = await first(
      db.select().from(resumeEntries).where(eq(resumeEntries.id, bullet.resumeEntryId)),
    );
    if (!entry) return fail("Entry not found");

    const entryCreated = !entry.sourceEntryId;
    const target = await ensureVaultEntryFor(entry);
    if (!target.ok) return target;

    const vaultBulletId = await copyBulletToVault(bullet, target.id);

    if (target.resumeId) revalidatePath(`/resume/${target.resumeId}`);
    revalidatePath("/vault");
    return { ok: true, data: { vaultBulletId, entryCreated } };
  });
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
  return withVault(async () => {
    const entry = await first(
      db.select().from(resumeEntries).where(eq(resumeEntries.id, resumeEntryId)),
    );
    if (!entry) return fail("Entry not found");

    const used = new Set(
      (await db.select().from(resumeBullets).where(eq(resumeBullets.resumeEntryId, resumeEntryId)))
        .map((b) => b.sourceBulletId)
        .filter((v): v is number => v !== null),
    );

    const allEntries = new Map((await db.select().from(vaultEntries)).map((e) => [e.id, e]));
    const q = normalizeTerm(query);

    const all = (await db.select().from(vaultBullets).orderBy(asc(vaultBullets.displayOrder)))
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
  });
}

/**
 * Attach an existing vault bullet to a resume entry.
 *
 * Returns the resume bullet's id and text, so the rich-text editor can add it
 * as a line it already knows — otherwise its next save would treat the row as
 * unseen. Callers that only need success ignore the data.
 */
export async function addVaultBulletToEntry(
  resumeEntryId: number,
  vaultBulletId: number,
): Promise<ActionResult<{ id: number; text: string; sourceBulletId: number }>> {
  return withVault(async () => {
    const bullet = await first(
      db.select().from(vaultBullets).where(eq(vaultBullets.id, vaultBulletId)),
    );
    if (!bullet) return fail("That bullet is no longer in your vault");

    const entry = await first(
      db.select().from(resumeEntries).where(eq(resumeEntries.id, resumeEntryId)),
    );
    if (!entry) return fail("Entry not found");

    const duplicate = await first(
      db
        .select()
        .from(resumeBullets)
        .where(
          and(
            eq(resumeBullets.resumeEntryId, resumeEntryId),
            eq(resumeBullets.sourceBulletId, vaultBulletId),
          ),
        ),
    );
    if (duplicate) {
      return {
        ok: true,
        data: { id: duplicate.id, text: duplicate.text ?? bullet.text, sourceBulletId: vaultBulletId },
      };
    }

    const last = await first(
      db
        .select({ o: resumeBullets.displayOrder })
        .from(resumeBullets)
        .where(eq(resumeBullets.resumeEntryId, resumeEntryId))
        .orderBy(desc(resumeBullets.displayOrder)),
    );

    const row = (await first(
      db
        .insert(resumeBullets)
        .values({
          resumeEntryId,
          sourceBulletId: vaultBulletId,
          text: bullet.text,
          displayOrder: (last?.o ?? -1) + 1,
        })
        .returning({ id: resumeBullets.id }),
    ))!;

    const resumeId = await resumeIdForSection(entry.sectionId);
    if (resumeId) revalidatePath(`/resume/${resumeId}`);

    return { ok: true, data: { id: row.id, text: bullet.text, sourceBulletId: vaultBulletId } };
  });
}
