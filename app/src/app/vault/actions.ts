"use server";

import { revalidatePath } from "next/cache";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { bootstrap, setSetting, SETTING_KEYS } from "@/db/bootstrap";
import {
  vaultBullets,
  vaultEntries,
  vaultGroups,
  vaultSections,
  vaultSkills,
} from "@/db/schema";
import { bulletStrength } from "@/lib/bullet-strength";
import { extractSkills } from "@/lib/skill-index";


export type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : { data: T }))
  | { ok: false; error: string };

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

function touch() {
  return Math.floor(Date.now() / 1000);
}

function refresh() {
  revalidatePath("/vault");
  revalidatePath("/");
}

/* ------------------------------------------------------------------ */
/* Groups — optional, user-named                                       */
/* ------------------------------------------------------------------ */

export async function createGroup(name: string): Promise<ActionResult<number>> {
  bootstrap();
  const parsed = z.string().trim().min(1, "Group needs a name").max(60).safeParse(name);
  if (!parsed.success) return fail(parsed.error.issues[0]!.message);

  const last = db
    .select({ o: vaultGroups.displayOrder })
    .from(vaultGroups)
    .orderBy(desc(vaultGroups.displayOrder))
    .get();

  const row = db
    .insert(vaultGroups)
    .values({ name: parsed.data, displayOrder: (last?.o ?? -1) + 1 })
    .returning({ id: vaultGroups.id })
    .get();

  refresh();
  return { ok: true, data: row.id };
}

export async function renameGroup(id: number, name: string): Promise<ActionResult> {
  bootstrap();
  const parsed = z.string().trim().min(1).max(60).safeParse(name);
  if (!parsed.success) return fail("Group needs a name");

  db.update(vaultGroups).set({ name: parsed.data }).where(eq(vaultGroups.id, id)).run();
  refresh();
  return { ok: true };
}

/** Deleting a group never deletes its sections — they just become ungrouped. */
export async function deleteGroup(id: number): Promise<ActionResult> {
  bootstrap();
  db.delete(vaultGroups).where(eq(vaultGroups.id, id)).run();
  refresh();
  return { ok: true };
}

export async function setSectionGroup(
  sectionId: number,
  groupId: number | null,
): Promise<ActionResult> {
  bootstrap();
  db.update(vaultSections).set({ groupId }).where(eq(vaultSections.id, sectionId)).run();
  refresh();
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Sections                                                            */
/* ------------------------------------------------------------------ */

const sectionSchema = z.object({
  heading: z.string().trim().min(1, "Section needs a heading").max(60),
  type: z.enum(["normal", "skill"]),
  icon: z.string().trim().max(40).default(""),
  groupId: z.number().int().nullable().default(null),
});

export async function createSection(input: {
  heading: string;
  type: string;
  icon?: string;
  groupId?: number | null;
}): Promise<ActionResult<number>> {
  bootstrap();

  const parsed = sectionSchema.safeParse({
    heading: input.heading,
    type: input.type,
    icon: input.icon ?? "",
    groupId: input.groupId ?? null,
  });
  if (!parsed.success) return fail(parsed.error.issues[0]!.message);

  const last = db
    .select({ o: vaultSections.displayOrder })
    .from(vaultSections)
    .orderBy(desc(vaultSections.displayOrder))
    .get();

  const row = db
    .insert(vaultSections)
    .values({ ...parsed.data, displayOrder: (last?.o ?? -1) + 1 })
    .returning({ id: vaultSections.id })
    .get();

  refresh();
  return { ok: true, data: row.id };
}

export async function updateSection(
  id: number,
  input: { heading: string; icon?: string; groupId?: number | null },
): Promise<ActionResult> {
  bootstrap();

  const parsed = z
    .object({
      heading: z.string().trim().min(1, "Section needs a heading").max(60),
      icon: z.string().trim().max(40).default(""),
      groupId: z.number().int().nullable().default(null),
    })
    .safeParse({
      heading: input.heading,
      icon: input.icon ?? "",
      groupId: input.groupId ?? null,
    });
  if (!parsed.success) return fail(parsed.error.issues[0]!.message);

  // `type` is deliberately not editable: switching a section between normal and
  // skill would leave every existing entry with the wrong shape.
  db.update(vaultSections).set(parsed.data).where(eq(vaultSections.id, id)).run();
  refresh();
  return { ok: true };
}

export async function deleteSection(id: number): Promise<ActionResult> {
  bootstrap();
  // Entries cascade, and their bullets and skill-index rows cascade in turn.
  db.delete(vaultSections).where(eq(vaultSections.id, id)).run();
  refresh();
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Reordering                                                          */
/* ------------------------------------------------------------------ */

/**
 * These four replace the old moveSection / moveEntry / moveBullet pair-swaps.
 *
 * CLAUDE.md used to say reordering swaps `display_order` with the adjacent row
 * rather than renumbering a list. That rule was written for up/down buttons,
 * where a swap is the whole operation. A drag lands an item at an arbitrary
 * index, which no sequence of swaps expresses without walking it there one row
 * at a time — so these renumber the affected list contiguously, inside a
 * transaction. The lists are a handful of rows; the write is trivial.
 *
 * Each takes the complete arrangement rather than a delta. The client already
 * knows the final order, and sending it whole means a dropped or reordered
 * request can't leave the vault in a state that never appeared on screen.
 */

const idList = z.array(z.number().int().positive()).max(500);

/**
 * Section order across the entire sidebar, including which group each belongs to.
 *
 * Takes every block at once because `vault_sections.display_order` is global:
 * numbering each group's sections from zero independently would make them
 * collide, and `allSections()` — which the resume builder and tuner both read —
 * would get an arbitrary order back. Flattening the sidebar into one sequence
 * keeps that single column meaningful.
 */
export async function reorderSections(
  blocks: Array<{ groupId: number | null; sectionIds: number[] }>,
): Promise<ActionResult> {
  bootstrap();

  const parsed = z
    .array(z.object({ groupId: z.number().int().positive().nullable(), sectionIds: idList }))
    .max(100)
    .safeParse(blocks);
  if (!parsed.success) return fail("Could not read the new section order");

  const known = new Set(
    db.select({ id: vaultSections.id }).from(vaultSections).all().map((r) => r.id),
  );

  db.transaction((tx) => {
    let position = 0;
    for (const block of parsed.data) {
      for (const id of block.sectionIds) {
        // Silently skipping unknown ids matters: a section deleted in another
        // tab would otherwise resurrect itself as a phantom update.
        if (!known.has(id)) continue;
        tx.update(vaultSections)
          .set({ groupId: block.groupId, displayOrder: position })
          .where(eq(vaultSections.id, id))
          .run();
        position += 1;
      }
    }
  });

  refresh();
  return { ok: true };
}

/**
 * Top-level block order. `null` marks where the ungrouped block sits.
 *
 * Groups take their index as `display_order`; the ungrouped block's index goes
 * to the setting. Because both are read back through `orderedBlocks`, the gaps
 * left in the groups' numbering by the ungrouped slot are harmless.
 */
export async function reorderBlocks(
  blocks: Array<number | null>,
): Promise<ActionResult> {
  bootstrap();

  const parsed = z
    .array(z.number().int().positive().nullable())
    .max(100)
    .safeParse(blocks);
  if (!parsed.success) return fail("Could not read the new group order");

  db.transaction((tx) => {
    parsed.data.forEach((key, i) => {
      if (key === null) return;
      tx.update(vaultGroups).set({ displayOrder: i }).where(eq(vaultGroups.id, key)).run();
    });
  });

  const ungroupedAt = parsed.data.indexOf(null);
  setSetting(SETTING_KEYS.ungroupedOrder, String(ungroupedAt === -1 ? -1 : ungroupedAt));

  refresh();
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Entries                                                             */
/* ------------------------------------------------------------------ */

const dateField = z
  .string()
  .trim()
  .max(10)
  .refine((v) => v === "" || /^(0[1-9]|1[0-2])\/\d{4}$/.test(v) || /^\d{4}$/.test(v), {
    message: "Dates must look like MM/YYYY or YYYY",
  });

const entrySchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  organization: z.string().trim().max(200).default(""),
  subtitle: z.string().trim().max(300).default(""),
  location: z.string().trim().max(160).default(""),
  startDate: dateField.default(""),
  endDate: dateField.default(""),
  isCurrent: z.boolean().default(false),
  url: z.string().trim().max(500).default(""),
  /** Skill sections only. */
  information: z.string().trim().max(2000).default(""),
  level: z.string().trim().max(20).default(""),
  meta: z.record(z.string(), z.unknown()).default({}),
});

export type EntryInput = z.input<typeof entrySchema>;

/**
 * Rebuild the derived skill index for one entry.
 *
 * Delete-then-insert rather than diffing: the index is disposable, the entry is
 * the truth, and a partial diff that goes wrong leaves matching quietly stale.
 */
function reindexSkills(entryId: number) {
  db.delete(vaultSkills).where(eq(vaultSkills.sourceEntryId, entryId)).run();

  const entry = db.select().from(vaultEntries).where(eq(vaultEntries.id, entryId)).get();
  if (!entry) return;

  const section = db
    .select()
    .from(vaultSections)
    .where(eq(vaultSections.id, entry.sectionId))
    .get();
  if (section?.type !== "skill") return;

  extractSkills(entry.information).forEach((skill, i) => {
    db.insert(vaultSkills)
      .values({
        sourceEntryId: entryId,
        // The entry's own label is the category — "Languages", "Frameworks".
        category: entry.title || section.heading,
        name: skill.name,
        aliases: skill.aliases,
        level: entry.level,
        displayOrder: i,
      })
      .run();
  });
}

/**
 * Add a skills category to the vault, merging into an entry of that name.
 *
 * The resume editor calls this after you hand-build a category, so a skill you
 * invented on one resume becomes something the tuner knows you have. The vault
 * models a category as a single entry — title is the label, `information` holds
 * the list — so this reads that entry, unions the names in, and writes it back.
 *
 * Union rather than replace: the vault is the master record, and a resume shows
 * a subset of it. Overwriting would let a trimmed-down resume line silently
 * delete skills from the vault that no resume happened to be showing.
 *
 * Returns the names that were genuinely new, so the UI can say what it did
 * rather than claiming a change that amounted to nothing.
 */
export async function addSkillsToVault(
  sectionId: number,
  category: string,
  names: string[],
): Promise<ActionResult<string[]>> {
  bootstrap();

  const parsed = z
    .object({
      category: z.string().trim().min(1, "The category needs a name").max(200),
      names: z.array(z.string().trim().min(1).max(60)).min(1).max(100),
    })
    .safeParse({ category, names });
  if (!parsed.success) return fail(parsed.error.issues[0]!.message);

  const section = db
    .select()
    .from(vaultSections)
    .where(eq(vaultSections.id, sectionId))
    .get();
  if (!section) return fail("That vault section no longer exists");
  if (section.type !== "skill") {
    return fail(`"${section.heading}" holds entries with dates and bullets, not skills`);
  }

  const label = parsed.data.category;
  const existing = db
    .select()
    .from(vaultEntries)
    .where(eq(vaultEntries.sectionId, sectionId))
    .all()
    .find((e) => e.title.trim().toLowerCase() === label.toLowerCase());

  const current = existing ? extractSkills(existing.information).map((s) => s.name) : [];
  const have = new Set(current.map((n) => n.toLowerCase()));

  const added = parsed.data.names.filter((n) => !have.has(n.toLowerCase()));
  if (added.length === 0 && existing) return { ok: true, data: [] };

  const information = [...current, ...added].join(" | ");

  if (existing) {
    db.update(vaultEntries)
      .set({ information, updatedAt: touch() })
      .where(eq(vaultEntries.id, existing.id))
      .run();
    reindexSkills(existing.id);
  } else {
    const last = db
      .select({ o: vaultEntries.displayOrder })
      .from(vaultEntries)
      .where(eq(vaultEntries.sectionId, sectionId))
      .orderBy(desc(vaultEntries.displayOrder))
      .get();

    const row = db
      .insert(vaultEntries)
      .values({
        sectionId,
        title: label,
        information,
        displayOrder: (last?.o ?? -1) + 1,
      })
      .returning({ id: vaultEntries.id })
      .get();

    reindexSkills(row.id);
  }

  refresh();
  return { ok: true, data: added };
}

export async function createEntry(
  sectionId: number,
  input: EntryInput,
): Promise<ActionResult<number>> {
  bootstrap();

  const parsed = entrySchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]!.message);

  const section = db
    .select()
    .from(vaultSections)
    .where(eq(vaultSections.id, sectionId))
    .get();
  if (!section) return fail("Section not found");

  const last = db
    .select({ o: vaultEntries.displayOrder })
    .from(vaultEntries)
    .where(eq(vaultEntries.sectionId, sectionId))
    .orderBy(desc(vaultEntries.displayOrder))
    .get();

  const row = db
    .insert(vaultEntries)
    .values({ ...parsed.data, sectionId, displayOrder: (last?.o ?? -1) + 1 })
    .returning({ id: vaultEntries.id })
    .get();

  reindexSkills(row.id);
  refresh();
  return { ok: true, data: row.id };
}

export async function updateEntry(
  id: number,
  input: EntryInput,
): Promise<ActionResult> {
  bootstrap();

  const parsed = entrySchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]!.message);

  db.update(vaultEntries)
    .set({ ...parsed.data, updatedAt: touch() })
    .where(eq(vaultEntries.id, id))
    .run();

  reindexSkills(id);
  refresh();
  return { ok: true };
}

export async function deleteEntry(id: number): Promise<ActionResult> {
  bootstrap();
  db.delete(vaultEntries).where(eq(vaultEntries.id, id)).run();
  refresh();
  return { ok: true };
}

/**
 * Move a whole entry, with its bullets, into another section.
 *
 * Bullets need no handling — they hang off `entry_id`, not the section, so they
 * travel with the entry for free. Resumes that pulled from this entry keep
 * their copies and their `source_entry_id` stays valid: the entry keeps its id
 * and only changes parent.
 *
 * The type check is duplicated here even though the dialog only offers matching
 * targets. A server action is a public entry point; relying on the UI to
 * enforce a data rule means the rule holds only as long as nobody calls it any
 * other way. Moving a bulleted job into a skill section would leave its dates
 * and bullets with nowhere to render — not deleted, but invisible, which reads
 * as data loss.
 */
export async function moveEntryToSection(
  entryId: number,
  targetSectionId: number,
): Promise<ActionResult> {
  bootstrap();

  const entry = db.select().from(vaultEntries).where(eq(vaultEntries.id, entryId)).get();
  if (!entry) return fail("Entry not found");

  if (entry.sectionId === targetSectionId) return { ok: true };

  const from = db
    .select()
    .from(vaultSections)
    .where(eq(vaultSections.id, entry.sectionId))
    .get();
  const to = db
    .select()
    .from(vaultSections)
    .where(eq(vaultSections.id, targetSectionId))
    .get();

  if (!to) return fail("That section no longer exists");
  if (from && from.type !== to.type) {
    return fail(
      to.type === "skill"
        ? `"${to.heading}" holds skill entries — a label plus sub-skills. This entry's dates and bullets would have nowhere to go.`
        : `"${to.heading}" holds entries with dates and bullets. This is a skill entry, so it would arrive empty.`,
    );
  }

  const last = db
    .select({ o: vaultEntries.displayOrder })
    .from(vaultEntries)
    .where(eq(vaultEntries.sectionId, targetSectionId))
    .orderBy(desc(vaultEntries.displayOrder))
    .get();

  db.update(vaultEntries)
    .set({
      sectionId: targetSectionId,
      displayOrder: (last?.o ?? -1) + 1,
      updatedAt: touch(),
    })
    .where(eq(vaultEntries.id, entryId))
    .run();

  // The derived index records the section it came from, and whether the entry
  // is indexed at all depends on that section's type.
  reindexSkills(entryId);

  refresh();
  return { ok: true };
}

/** Entry order within one section. Entries never move between sections by drag. */
export async function reorderEntries(
  sectionId: number,
  entryIds: number[],
): Promise<ActionResult> {
  bootstrap();

  const parsed = idList.safeParse(entryIds);
  if (!parsed.success) return fail("Could not read the new entry order");

  // Scoped to the section, so a stray id from elsewhere can't be dragged in.
  const known = new Set(
    db
      .select({ id: vaultEntries.id })
      .from(vaultEntries)
      .where(eq(vaultEntries.sectionId, sectionId))
      .all()
      .map((r) => r.id),
  );

  db.transaction((tx) => {
    let position = 0;
    for (const id of parsed.data) {
      if (!known.has(id)) continue;
      tx.update(vaultEntries)
        .set({ displayOrder: position })
        .where(eq(vaultEntries.id, id))
        .run();
      position += 1;
    }
  });

  refresh();
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Bullets                                                             */
/* ------------------------------------------------------------------ */

const bulletTextSchema = z.string().trim().min(1, "Bullet cannot be empty").max(1000);

export async function createBullet(
  entryId: number,
  text: string,
): Promise<ActionResult<number>> {
  bootstrap();

  const parsed = bulletTextSchema.safeParse(text);
  if (!parsed.success) return fail(parsed.error.issues[0]!.message);

  const last = db
    .select({ o: vaultBullets.displayOrder })
    .from(vaultBullets)
    .where(eq(vaultBullets.entryId, entryId))
    .orderBy(desc(vaultBullets.displayOrder))
    .get();

  const row = db
    .insert(vaultBullets)
    .values({
      entryId,
      text: parsed.data,
      strength: bulletStrength(parsed.data),
      displayOrder: (last?.o ?? -1) + 1,
    })
    .returning({ id: vaultBullets.id })
    .get();

  refresh();
  return { ok: true, data: row.id };
}

export async function updateBullet(
  id: number,
  text: string,
  tags: string[] = [],
): Promise<ActionResult> {
  bootstrap();

  const parsed = bulletTextSchema.safeParse(text);
  if (!parsed.success) return fail(parsed.error.issues[0]!.message);

  db.update(vaultBullets)
    .set({
      text: parsed.data,
      tags: tags.map((t) => t.trim()).filter(Boolean).slice(0, 12),
      strength: bulletStrength(parsed.data),
      updatedAt: touch(),
    })
    .where(eq(vaultBullets.id, id))
    .run();

  refresh();
  return { ok: true };
}

export async function deleteBullet(id: number): Promise<ActionResult> {
  bootstrap();
  db.delete(vaultBullets).where(eq(vaultBullets.id, id)).run();
  refresh();
  return { ok: true };
}

export async function toggleBulletPin(id: number): Promise<ActionResult> {
  bootstrap();
  const row = db.select().from(vaultBullets).where(eq(vaultBullets.id, id)).get();
  if (!row) return fail("Bullet not found");

  db.update(vaultBullets)
    .set({ isPinned: !row.isPinned, updatedAt: touch() })
    .where(eq(vaultBullets.id, id))
    .run();

  refresh();
  return { ok: true };
}

/** Bullet order within one entry. */
export async function reorderBullets(
  entryId: number,
  bulletIds: number[],
): Promise<ActionResult> {
  bootstrap();

  const parsed = idList.safeParse(bulletIds);
  if (!parsed.success) return fail("Could not read the new bullet order");

  const known = new Set(
    db
      .select({ id: vaultBullets.id })
      .from(vaultBullets)
      .where(eq(vaultBullets.entryId, entryId))
      .all()
      .map((r) => r.id),
  );

  db.transaction((tx) => {
    let position = 0;
    for (const id of parsed.data) {
      if (!known.has(id)) continue;
      tx.update(vaultBullets)
        .set({ displayOrder: position })
        .where(eq(vaultBullets.id, id))
        .run();
      position += 1;
    }
  });

  refresh();
  return { ok: true };
}
