"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { getProfile } from "@/db/bootstrap";
import { db, first } from "@/db/client";
import { withVault } from "@/db/session";
import {
  profile,
  resumeBullets,
  resumeEntries,
  resumeSections,
  resumeSkills,
  resumes,
  type ContactKey,
  type SectionOptions,
} from "@/db/schema";
import { hasFormatting, htmlToText, sanitizeInlineHtml } from "@/lib/rich-text";

/**
 * Writes behind the redesigned Content editor.
 *
 * The editor applies every change to its own copy of the resume first — that
 * is what makes the preview update as you type — and these persist it a beat
 * later. So each takes the *state the user arrived at* rather than a toggle or
 * a delta: a write that lands twice, or late, still leaves the database
 * matching the screen. (The older `toggle…` actions in actions.ts flip
 * whatever is stored, which is fine for a click but wrong for a replay.)
 */

export type ActionResult<T = undefined> =
  ({ ok: true } & (T extends undefined ? object : { data: T })) | { ok: false; error: string };

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

function touch() {
  return Math.floor(Date.now() / 1000);
}

async function resumeIdForSection(sectionId: number): Promise<number | null> {
  const row = await first(
    db.select({ id: resumeSections.resumeId }).from(resumeSections).where(eq(resumeSections.id, sectionId)),
  );
  return row?.id ?? null;
}

async function resumeIdForEntry(entryId: number): Promise<number | null> {
  const entry = await first(
    db.select({ sectionId: resumeEntries.sectionId }).from(resumeEntries).where(eq(resumeEntries.id, entryId)),
  );
  return entry ? await resumeIdForSection(entry.sectionId) : null;
}

/**
 * Bump the resume's timestamp, and reload the page only when asked.
 *
 * The draft already shows the result of every write here, so reloading the
 * resume page after each debounced save would just re-fetch the whole vault
 * to learn nothing. Every page involved is `force-dynamic`, so there is no
 * cached copy to invalidate either. `refresh` is for writes the client can't
 * show on its own — a newly created row it doesn't have an id for yet.
 */
async function touched(resumeId: number | null, { refresh = false } = {}) {
  if (!resumeId) return;
  await db.update(resumes).set({ updatedAt: touch() }).where(eq(resumes.id, resumeId));
  if (refresh) revalidatePath(`/resume/${resumeId}`);
}

/* ------------------------------------------------------------------ */
/* Entries                                                             */
/* ------------------------------------------------------------------ */

/** Matches the vault's rule: empty, MM/YYYY or YYYY. */
const dateField = z
  .string()
  .trim()
  .max(10)
  .refine((v) => v === "" || /^(0[1-9]|1[0-2])\/\d{4}$/.test(v) || /^\d{4}$/.test(v), {
    message: "Dates must look like MM/YYYY or YYYY",
  });

const entryPatchSchema = z
  .object({
    title: z.string().max(200),
    organization: z.string().max(200),
    subtitle: z.string().max(300),
    location: z.string().max(160),
    startDate: dateField,
    endDate: dateField,
    isCurrent: z.boolean(),
    url: z.string().trim().max(500),
    meta: z.record(z.string(), z.unknown()),
  })
  .partial();

export type EntryPatch = z.input<typeof entryPatchSchema>;

/**
 * Write the fields the editor changed as this resume's overrides.
 *
 * Only the fields present are written. In linked mode an untouched field keeps
 * reading through to the vault; writing the whole entry on every keystroke
 * would freeze all of them the first time you fixed a typo in one.
 */
export async function updateResumeEntry(entryId: number, patch: EntryPatch): Promise<ActionResult> {
  return withVault(async () => {
    const parsed = entryPatchSchema.safeParse(patch);
    if (!parsed.success) return fail(parsed.error.issues[0]!.message);
    const p = parsed.data;

    const set: Partial<typeof resumeEntries.$inferInsert> = {};
    if (p.title !== undefined) set.titleOverride = p.title;
    if (p.organization !== undefined) set.organizationOverride = p.organization;
    if (p.subtitle !== undefined) set.subtitleOverride = p.subtitle;
    if (p.location !== undefined) set.locationOverride = p.location;
    if (p.startDate !== undefined) set.startDateOverride = p.startDate;
    if (p.endDate !== undefined) set.endDateOverride = p.endDate;
    if (p.isCurrent !== undefined) set.isCurrentOverride = p.isCurrent;
    if (p.url !== undefined) set.urlOverride = p.url;
    if (p.meta !== undefined) set.metaOverride = p.meta;
    if (Object.keys(set).length === 0) return { ok: true };

    await db.update(resumeEntries).set(set).where(eq(resumeEntries.id, entryId));
    await touched(await resumeIdForEntry(entryId));
    return { ok: true };
  });
}

/** Set (not toggle) an entry's visibility — see the note at the top of the file. */
export async function setEntryVisible(entryId: number, visible: boolean): Promise<ActionResult> {
  return withVault(async () => {
    await db.update(resumeEntries).set({ isVisible: visible }).where(eq(resumeEntries.id, entryId));
    await touched(await resumeIdForEntry(entryId));
    return { ok: true };
  });
}

/**
 * A new, empty entry typed into the resume — what "+ Add Entry" creates before
 * opening the editor on it. Every field starts as an empty override, so it
 * never reads through to anything. The renderer skips an entry with no
 * content, so it appears in the preview with the first character typed.
 */
export async function createBlankEntry(sectionId: number): Promise<ActionResult<number>> {
  return withVault(async () => {
    const section = await first(db.select().from(resumeSections).where(eq(resumeSections.id, sectionId)));
    if (!section) return fail("Section not found");
    if (section.layout === "skill") return fail("Skill sections hold categories, not entries");

    const last = await first(
      db
        .select({ o: resumeEntries.displayOrder })
        .from(resumeEntries)
        .where(eq(resumeEntries.sectionId, sectionId))
        .orderBy(desc(resumeEntries.displayOrder)),
    );

    const row = (await first(
      db
        .insert(resumeEntries)
        .values({
          sectionId,
          titleOverride: "",
          organizationOverride: "",
          subtitleOverride: "",
          locationOverride: "",
          startDateOverride: "",
          endDateOverride: "",
          isCurrentOverride: false,
          urlOverride: "",
          metaOverride: {},
          displayOrder: (last?.o ?? -1) + 1,
        })
        .returning({ id: resumeEntries.id }),
    ))!;

    await touched(section.resumeId, { refresh: true });
    return { ok: true, data: row.id };
  });
}

/* ------------------------------------------------------------------ */
/* Bullets — the rich-text description                                 */
/* ------------------------------------------------------------------ */

const lineSchema = z.object({
  /** Client-side identity for a line that has no row yet. */
  key: z.string().min(1).max(64),
  id: z.number().int().positive().nullable(),
  html: z.string().max(4000),
  align: z.enum(["left", "center", "right", "justify"]),
  isParagraph: z.boolean(),
  isVisible: z.boolean(),
});

export type DescriptionLine = z.infer<typeof lineSchema>;

/**
 * Persist an entry's description as the editor holds it: the whole list of
 * lines, in order.
 *
 * Each line is one `resume_bullets` row — the rich-text box is a view over the
 * same rows the rest of the app reads, so vault links (`source_bullet_id`),
 * strength scoring and the tuner keep working per bullet. Lines with an id
 * update that row; lines without one become new rows; rows no longer present
 * are removed from this resume (the vault keeps its own copy). Empty lines are
 * skipped, so clearing a line removes its bullet.
 *
 * Only rows in `knownIds` — the ones the editor was showing — can be removed.
 * A bullet added meanwhile by another path (the tuner, the vault drawer)
 * isn't in the editor yet, and its absence from `lines` means "not seen", not
 * "deleted".
 *
 * Returns the row id for every line key, so the editor can stamp new lines
 * with their ids and the next save updates them instead of inserting again.
 */
export async function syncEntryBullets(
  entryId: number,
  lines: DescriptionLine[],
  knownIds: number[],
): Promise<ActionResult<Record<string, number>>> {
  return withVault(async () => {
    const parsed = z.array(lineSchema).max(200).safeParse(lines);
    if (!parsed.success) return fail("Could not read the description");
    const known = new Set(z.array(z.number().int()).max(500).catch([]).parse(knownIds));

    const existing = await db.select().from(resumeBullets).where(eq(resumeBullets.resumeEntryId, entryId));
    const owned = new Set(existing.map((b) => b.id));
    const kept = new Set<number>();
    const ids: Record<string, number> = {};

    let position = 0;
    for (const line of parsed.data) {
      const clean = sanitizeInlineHtml(line.html);
      const text = htmlToText(clean).slice(0, 1000);
      if (!text) continue;

      const values = {
        text,
        html: hasFormatting(clean) ? clean : null,
        align: line.align === "left" ? null : line.align,
        isParagraph: line.isParagraph,
        isVisible: line.isVisible,
        displayOrder: position,
      };

      // An id the entry doesn't own (stale, or duplicated by a line split in
      // the editor) is treated as a new line rather than trusted.
      if (line.id !== null && owned.has(line.id) && !kept.has(line.id)) {
        await db.update(resumeBullets).set(values).where(eq(resumeBullets.id, line.id));
        kept.add(line.id);
        ids[line.key] = line.id;
      } else {
        const row = (await first(
          db
            .insert(resumeBullets)
            .values({ resumeEntryId: entryId, ...values })
            .returning({ id: resumeBullets.id }),
        ))!;
        ids[line.key] = row.id;
      }
      position += 1;
    }

    // Rows the editor hasn't seen go after the ones it has, in their old
    // order, so positions stay contiguous and nothing collides.
    const unseen = existing
      .filter((b) => !known.has(b.id) && !kept.has(b.id))
      .sort((a, b) => a.displayOrder - b.displayOrder);
    for (const b of unseen) {
      await db.update(resumeBullets).set({ displayOrder: position }).where(eq(resumeBullets.id, b.id));
      position += 1;
    }

    for (const b of existing) {
      if (known.has(b.id) && !kept.has(b.id)) {
        await db
          .delete(resumeBullets)
          .where(and(eq(resumeBullets.id, b.id), eq(resumeBullets.resumeEntryId, entryId)));
      }
    }

    await touched(await resumeIdForEntry(entryId));
    return { ok: true, data: ids };
  });
}

/* ------------------------------------------------------------------ */
/* Sections                                                            */
/* ------------------------------------------------------------------ */

const sectionPatchSchema = z
  .object({
    heading: z.string().trim().min(1, "Heading can't be empty").max(60),
    icon: z.string().trim().max(40).nullable(),
    options: z.object({
      titleOrder: z.enum(["title-first", "org-first"]).optional(),
      titleJoin: z.enum(["comma", "dash", "stacked"]).optional(),
      skillsLayout: z.enum(["lines", "colon", "bullets", "inline"]).optional(),
    }),
  })
  .partial();

/** Heading, editor icon and per-section layout options. */
export async function updateResumeSection(
  sectionId: number,
  patch: { heading?: string; icon?: string | null; options?: SectionOptions },
): Promise<ActionResult> {
  return withVault(async () => {
    const parsed = sectionPatchSchema.safeParse(patch);
    if (!parsed.success) return fail(parsed.error.issues[0]!.message);
    if (Object.keys(parsed.data).length === 0) return { ok: true };

    await db.update(resumeSections).set(parsed.data).where(eq(resumeSections.id, sectionId));
    await touched(await resumeIdForSection(sectionId));
    return { ok: true };
  });
}

/**
 * Show or hide one skills line. A category is the rows sharing its name (see
 * `groupSkills`), so this sets every row in it; the renderer drops a category
 * with no visible rows.
 */
export async function setSkillCategoryVisible(
  sectionId: number,
  rowIds: number[],
  visible: boolean,
): Promise<ActionResult> {
  return withVault(async () => {
    const ids = z.array(z.number().int().positive()).max(200).safeParse(rowIds);
    if (!ids.success) return fail("Could not read the skills line");

    for (const id of ids.data) {
      await db
        .update(resumeSkills)
        .set({ isVisible: visible })
        .where(and(eq(resumeSkills.id, id), eq(resumeSkills.sectionId, sectionId)));
    }
    await touched(await resumeIdForSection(sectionId));
    return { ok: true };
  });
}

/* ------------------------------------------------------------------ */
/* Personal details — the shared profile                               */
/* ------------------------------------------------------------------ */

const CONTACT_KEYS = ["email", "phone", "location", "links", "details"] as const;

const profilePatchSchema = z
  .object({
    fullName: z.string().trim().max(120),
    title: z.string().trim().max(120),
    email: z.string().trim().max(200),
    phone: z.string().trim().max(60),
    location: z.string().trim().max(160),
    summary: z.string().trim().max(4000),
    links: z.array(z.object({ label: z.string().trim().max(60), url: z.string().trim().max(500) })).max(8),
    details: z.array(z.object({ label: z.string().trim().max(60), value: z.string().trim().max(200) })).max(16),
    contactOrder: z.array(z.enum(CONTACT_KEYS)).max(CONTACT_KEYS.length),
  })
  .partial();

export type ProfilePatch = z.input<typeof profilePatchSchema>;

/**
 * Personal details, edited from inside a resume.
 *
 * This is the account profile, not a per-resume copy — every resume's header
 * reads it, and the editor says so. Half-filled link and detail rows are
 * dropped rather than rejected, because the editor saves while you type and a
 * label typed before its URL is a normal intermediate state.
 */
export async function updateProfileDetails(patch: ProfilePatch): Promise<ActionResult> {
  return withVault(async () => {
    const parsed = profilePatchSchema.safeParse(patch);
    if (!parsed.success) return fail(parsed.error.issues[0]!.message);

    const set: Record<string, unknown> = { ...parsed.data };
    if (parsed.data.links) set.links = parsed.data.links.filter((l) => l.label && l.url);
    if (parsed.data.details) set.details = parsed.data.details.filter((d) => d.label && d.value);
    if (parsed.data.contactOrder) {
      set.contactOrder = [...new Set(parsed.data.contactOrder)] as ContactKey[];
    }

    const current = await getProfile();
    await db
      .update(profile)
      .set({ ...set, updatedAt: touch() })
      .where(eq(profile.id, current.id));

    // No revalidation: the editor shows the change already, and /settings and
    // every resume page are force-dynamic, so they read it fresh next visit.
    return { ok: true };
  });
}
