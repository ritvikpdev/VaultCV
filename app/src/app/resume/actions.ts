"use server";

import { revalidatePath } from "next/cache";
import { and, asc, desc, eq, gt, lt } from "drizzle-orm";
import { z } from "zod";

import { db, first } from "@/db/client";
import { withVault } from "@/db/session";
import { vaultLinkMode } from "@/db/resume-queries";
import {
  resumeBullets,
  resumeEntries,
  resumeSections,
  resumeSkills,
  resumes,
  resumeStyles,
  vaultBullets,
  vaultEntries,
  vaultSkills,
  SECTION_TYPES,
  type SectionType,
} from "@/db/schema";
import { resolveSkill } from "@/lib/resume-model";
import { DEFAULT_RESUME_SECTIONS, getSectionDef } from "@/lib/sections";
import { parseSkillNames, planSkillRows } from "@/lib/skill-category";

export type ActionResult<T = undefined> =
  ({ ok: true } & (T extends undefined ? object : { data: T })) | { ok: false; error: string };

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

function touch() {
  return Math.floor(Date.now() / 1000);
}

function refresh(resumeId?: number) {
  revalidatePath("/");
  if (resumeId) revalidatePath(`/resume/${resumeId}`);
}

async function bumpResume(resumeId: number) {
  await db.update(resumes).set({ updatedAt: touch() }).where(eq(resumes.id, resumeId));
}

/** The resume a section belongs to — needed to revalidate and bump timestamps. */
async function resumeIdForSection(sectionId: number): Promise<number | null> {
  const row = await first(
    db
      .select({ id: resumeSections.resumeId })
      .from(resumeSections)
      .where(eq(resumeSections.id, sectionId)),
  );
  return row?.id ?? null;
}

async function resumeIdForEntry(entryId: number): Promise<number | null> {
  const entry = await first(
    db
      .select({ sectionId: resumeEntries.sectionId })
      .from(resumeEntries)
      .where(eq(resumeEntries.id, entryId)),
  );
  return entry ? await resumeIdForSection(entry.sectionId) : null;
}

/* ------------------------------------------------------------------ */
/* Resumes                                                             */
/* ------------------------------------------------------------------ */

/**
 * A new resume gets its own style row and the default section set, so it opens
 * as a usable skeleton rather than a blank page you have to assemble first.
 */
export async function createResume(name?: string): Promise<ActionResult<number>> {
  return withVault(async () => {
    try {
      // Explicit rather than `.values({})` — an all-defaults insert compiles to
      // `INSERT INTO resume_styles () VALUES ()`, which SQLite rejects. Naming one
      // column keeps the statement valid; the rest still come from schema defaults.
      const style = (await first(
        db.insert(resumeStyles).values({ pageSize: "letter" }).returning({ id: resumeStyles.id }),
      ))!;

      const resume = (await first(
        db
          .insert(resumes)
          .values({ name: name?.trim() || "Untitled resume", styleId: style.id })
          .returning({ id: resumes.id }),
      ))!;

      await db.insert(resumeSections).values(
        DEFAULT_RESUME_SECTIONS.map((type, i) => {
          const def = getSectionDef(type);
          return {
            resumeId: resume.id,
            sectionType: type,
            heading: def.heading,
            layout: def.layout,
            displayOrder: i,
          };
        }),
      );

      refresh(resume.id);
      return { ok: true, data: resume.id };
    } catch (err) {
      // Without this, a DB-level failure surfaces as an unhandled Server Action
      // rejection: the button just does nothing and the reason stays in the
      // terminal. Returning it lets the UI say what went wrong.
      const message = err instanceof Error ? err.message : String(err);
      return fail(
        /no such table/i.test(message)
          ? "Database tables are missing. Run `npm run db:push` in the app folder."
          : `Could not create the resume: ${message}`,
      );
    }
  });
}

export async function renameResume(id: number, name: string): Promise<ActionResult> {
  return withVault(async () => {
    const parsed = z.string().trim().min(1).max(120).safeParse(name);
    if (!parsed.success) return fail("Name can't be empty");

    await db
      .update(resumes)
      .set({ name: parsed.data, updatedAt: touch() })
      .where(eq(resumes.id, id));
    refresh(id);
    return { ok: true };
  });
}

export async function setResumeTarget(
  id: number,
  role: string,
  company: string,
): Promise<ActionResult> {
  return withVault(async () => {
    await db
      .update(resumes)
      .set({
        targetRole: role.trim().slice(0, 120),
        targetCompany: company.trim().slice(0, 120),
        updatedAt: touch(),
      })
      .where(eq(resumes.id, id));
    refresh(id);
    return { ok: true };
  });
}

export async function setResumeSummary(id: number, summary: string): Promise<ActionResult> {
  return withVault(async () => {
    await db
      .update(resumes)
      .set({ summaryOverride: summary.trim().slice(0, 4000), updatedAt: touch() })
      .where(eq(resumes.id, id));
    refresh(id);
    return { ok: true };
  });
}

export async function deleteResume(id: number): Promise<ActionResult> {
  return withVault(async () => {
    const resume = await first(db.select().from(resumes).where(eq(resumes.id, id)));
    if (!resume) return fail("Resume not found");

    // Sections/entries/bullets cascade. The style row does not (it's RESTRICT),
    // so it has to go after the resume that references it.
    await db.transaction(async (tx) => {
      await tx.delete(resumes).where(eq(resumes.id, id));
      await tx.delete(resumeStyles).where(eq(resumeStyles.id, resume.styleId));
    });

    refresh();
    return { ok: true };
  });
}

/** Deep copy — a new style row plus every section, entry, bullet and skill. */
export async function duplicateResume(id: number): Promise<ActionResult<number>> {
  return withVault(async () => {
    const source = await first(db.select().from(resumes).where(eq(resumes.id, id)));
    if (!source) return fail("Resume not found");

    const sourceStyle = await first(
      db.select().from(resumeStyles).where(eq(resumeStyles.id, source.styleId)),
    );
    if (!sourceStyle) return fail("Resume style missing");

    const { id: _styleId, ...styleValues } = sourceStyle;
    const newStyle = (await first(
      db.insert(resumeStyles).values(styleValues).returning({ id: resumeStyles.id }),
    ))!;

    const newResume = (await first(
      db
        .insert(resumes)
        .values({
          name: `Copy of ${source.name}`.slice(0, 120),
          targetRole: source.targetRole,
          targetCompany: source.targetCompany,
          summaryOverride: source.summaryOverride,
          styleId: newStyle.id,
        })
        .returning({ id: resumes.id }),
    ))!;

    const sections = await db
      .select()
      .from(resumeSections)
      .where(eq(resumeSections.resumeId, id))
      .orderBy(asc(resumeSections.displayOrder));

    for (const section of sections) {
      const newSection = (await first(
        db
          .insert(resumeSections)
          .values({
            resumeId: newResume.id,
            sectionType: section.sectionType,
            heading: section.heading,
            layout: section.layout,
            displayOrder: section.displayOrder,
            isVisible: section.isVisible,
            pageBreakAfter: section.pageBreakAfter,
          })
          .returning({ id: resumeSections.id }),
      ))!;

      const entries = await db
        .select()
        .from(resumeEntries)
        .where(eq(resumeEntries.sectionId, section.id))
        .orderBy(asc(resumeEntries.displayOrder));

      for (const entry of entries) {
        const { id: _eid, sectionId: _sid, ...entryValues } = entry;
        const newEntry = (await first(
          db
            .insert(resumeEntries)
            .values({ ...entryValues, sectionId: newSection.id })
            .returning({ id: resumeEntries.id }),
        ))!;

        const bullets = await db
          .select()
          .from(resumeBullets)
          .where(eq(resumeBullets.resumeEntryId, entry.id))
          .orderBy(asc(resumeBullets.displayOrder));

        for (const bullet of bullets) {
          const { id: _bid, resumeEntryId: _reid, ...bulletValues } = bullet;
          await db.insert(resumeBullets).values({ ...bulletValues, resumeEntryId: newEntry.id });
        }
      }

      const skills = await db
        .select()
        .from(resumeSkills)
        .where(eq(resumeSkills.sectionId, section.id))
        .orderBy(asc(resumeSkills.displayOrder));

      for (const skill of skills) {
        const { id: _skid, sectionId: _ssid, ...skillValues } = skill;
        await db.insert(resumeSkills).values({ ...skillValues, sectionId: newSection.id });
      }
    }

    refresh();
    return { ok: true, data: newResume.id };
  });
}

/* ------------------------------------------------------------------ */
/* Sections                                                            */
/* ------------------------------------------------------------------ */

export async function addSection(
  resumeId: number,
  sectionType: string,
  heading?: string,
): Promise<ActionResult<number>> {
  return withVault(async () => {
    if (!(SECTION_TYPES as readonly string[]).includes(sectionType)) {
      return fail("Unknown section type");
    }
    const def = getSectionDef(sectionType as SectionType);

    const last = await first(
      db
        .select({ o: resumeSections.displayOrder })
        .from(resumeSections)
        .where(eq(resumeSections.resumeId, resumeId))
        .orderBy(desc(resumeSections.displayOrder)),
    );

    const row = (await first(
      db
        .insert(resumeSections)
        .values({
          resumeId,
          sectionType: def.type,
          heading: (heading?.trim() || def.heading).slice(0, 60),
          layout: def.layout,
          displayOrder: (last?.o ?? -1) + 1,
        })
        .returning({ id: resumeSections.id }),
    ))!;

    await bumpResume(resumeId);
    refresh(resumeId);
    return { ok: true, data: row.id };
  });
}

export async function renameSection(sectionId: number, heading: string): Promise<ActionResult> {
  return withVault(async () => {
    const parsed = z.string().trim().min(1).max(60).safeParse(heading);
    if (!parsed.success) return fail("Heading can't be empty");

    await db
      .update(resumeSections)
      .set({ heading: parsed.data })
      .where(eq(resumeSections.id, sectionId));

    const resumeId = await resumeIdForSection(sectionId);
    if (resumeId) {
      await bumpResume(resumeId);
      refresh(resumeId);
    }
    return { ok: true };
  });
}

export async function removeSection(sectionId: number): Promise<ActionResult> {
  return withVault(async () => {
    const resumeId = await resumeIdForSection(sectionId);
    await db.delete(resumeSections).where(eq(resumeSections.id, sectionId));
    if (resumeId) {
      await bumpResume(resumeId);
      refresh(resumeId);
    }
    return { ok: true };
  });
}

/**
 * Adjacent swap, kept for one caller: the tuner.
 *
 * Its buttons are gone — sections are reordered by dragging in Customize. But
 * the REORDER recommendation applies itself by promoting a section one place,
 * which is exactly a swap, and expressing that as a full arrangement would mean
 * the tuner reconstructing an order it has no other reason to know.
 */
export async function moveSection(
  sectionId: number,
  direction: "up" | "down",
): Promise<ActionResult> {
  return withVault(async () => {
    const current = await first(
      db.select().from(resumeSections).where(eq(resumeSections.id, sectionId)),
    );
    if (!current) return fail("Section not found");

    const neighbour = await first(
      db
        .select()
        .from(resumeSections)
        .where(
          and(
            eq(resumeSections.resumeId, current.resumeId),
            direction === "up"
              ? lt(resumeSections.displayOrder, current.displayOrder)
              : gt(resumeSections.displayOrder, current.displayOrder),
          ),
        )
        .orderBy(
          direction === "up" ? desc(resumeSections.displayOrder) : asc(resumeSections.displayOrder),
        ),
    );

    if (!neighbour) return { ok: true };

    await db.transaction(async (tx) => {
      await tx
        .update(resumeSections)
        .set({ displayOrder: neighbour.displayOrder })
        .where(eq(resumeSections.id, current.id));
      await tx
        .update(resumeSections)
        .set({ displayOrder: current.displayOrder })
        .where(eq(resumeSections.id, neighbour.id));
    });

    await bumpResume(current.resumeId);
    refresh(current.resumeId);
    return { ok: true };
  });
}

/* ------------------------------------------------------------------ */
/* Pull from vault                                                     */
/* ------------------------------------------------------------------ */

/**
 * Copy a vault entry and the chosen bullets into a resume section.
 *
 * `sourceEntryId` / `sourceBulletId` are recorded even though this writes the
 * text too. In snapshot mode the text is what renders; the pointers are what
 * let the tuner say "already in this resume" and what make linked mode a
 * read-time rule later.
 */
export async function pullEntryFromVault(
  sectionId: number,
  vaultEntryId: number,
  bulletIds: number[],
): Promise<ActionResult<number>> {
  return withVault(async () => {
    const vaultEntry = await first(
      db.select().from(vaultEntries).where(eq(vaultEntries.id, vaultEntryId)),
    );
    if (!vaultEntry) return fail("That vault entry no longer exists");

    const last = await first(
      db
        .select({ o: resumeEntries.displayOrder })
        .from(resumeEntries)
        .where(eq(resumeEntries.sectionId, sectionId))
        .orderBy(desc(resumeEntries.displayOrder)),
    );

    const entry = (await first(
      db
        .insert(resumeEntries)
        .values({
          sectionId,
          sourceEntryId: vaultEntryId,
          displayOrder: (last?.o ?? -1) + 1,
        })
        .returning({ id: resumeEntries.id }),
    ))!;

    const wanted = new Set(bulletIds);
    const bullets = (
      await db
        .select()
        .from(vaultBullets)
        .where(eq(vaultBullets.entryId, vaultEntryId))
        .orderBy(asc(vaultBullets.displayOrder))
    ).filter((b) => b.isActive && wanted.has(b.id));

    // In linked mode `text` stays NULL so the renderer reads through to the vault
    // and later vault edits propagate. In snapshot mode the text is copied and
    // frozen. Same columns either way — the mode is the only difference, which is
    // why this was a settings flag rather than a migration.
    const linked = (await vaultLinkMode()) === "linked";

    if (bullets.length > 0) {
      await db.insert(resumeBullets).values(
        bullets.map((b, i) => ({
          resumeEntryId: entry.id,
          sourceBulletId: b.id,
          text: linked ? null : b.text,
          displayOrder: i,
        })),
      );
    }

    const resumeId = await resumeIdForSection(sectionId);
    if (resumeId) {
      await bumpResume(resumeId);
      refresh(resumeId);
    }
    return { ok: true, data: entry.id };
  });
}

/** Copy vault skills into a skill-layout section, skipping ones already there. */
export async function pullSkillsFromVault(
  sectionId: number,
  vaultSkillIds: number[],
): Promise<ActionResult<number>> {
  return withVault(async () => {
    const existing = new Set(
      (await db.select().from(resumeSkills).where(eq(resumeSkills.sectionId, sectionId)))
        .map((s) => s.sourceSkillId)
        .filter((v): v is number => v !== null),
    );

    const last = await first(
      db
        .select({ o: resumeSkills.displayOrder })
        .from(resumeSkills)
        .where(eq(resumeSkills.sectionId, sectionId))
        .orderBy(desc(resumeSkills.displayOrder)),
    );

    let order = (last?.o ?? -1) + 1;
    let added = 0;

    for (const skillId of vaultSkillIds) {
      if (existing.has(skillId)) continue;
      await db
        .insert(resumeSkills)
        .values({ sectionId, sourceSkillId: skillId, displayOrder: order++ });
      added += 1;
    }

    const resumeId = await resumeIdForSection(sectionId);
    if (resumeId) {
      await bumpResume(resumeId);
      refresh(resumeId);
    }
    return { ok: true, data: added };
  });
}

/* ------------------------------------------------------------------ */
/* Skill categories                                                     */
/* ------------------------------------------------------------------ */

/**
 * A category is derived, not stored.
 *
 * `resume_skills` holds one row per skill, each with a category string, and
 * `groupSkills` collapses rows sharing one into a line. These three actions
 * therefore operate on *sets of rows* selected by that string. Keeping it
 * derived avoids a category table that would be a second, divergeable
 * statement of something the rows already say.
 *
 * Rows are read through `resolveSkill`, because a row's displayed name may come
 * from the vault rather than from `name_override` — matching on the override
 * alone would treat every pulled skill as nameless.
 */
async function categoryRows(sectionId: number, category: string) {
  const rows = await db
    .select()
    .from(resumeSkills)
    .where(eq(resumeSkills.sectionId, sectionId))
    .orderBy(asc(resumeSkills.displayOrder));

  const vault = new Map((await db.select().from(vaultSkills)).map((s) => [s.id, s]));
  const target = category.trim().toLowerCase();

  return rows
    .map((row) => ({
      row,
      resolved: resolveSkill(row, row.sourceSkillId ? vault.get(row.sourceSkillId) : undefined),
    }))
    .filter((r) => (r.resolved.category ?? "").trim().toLowerCase() === target);
}

const categorySchema = z.object({
  category: z.string().trim().min(1, "The category needs a name").max(60),
  skills: z.string().max(2000),
});

/**
 * Create or replace one category's skills.
 *
 * `previousCategory` is the label as it was before the edit; omit it when
 * creating. Renaming is therefore a normal save rather than a special case —
 * the rows are found under the old label and written with the new one.
 *
 * New rows land at the end of the section. Existing rows keep their position
 * relative to each other within the category, which is what makes editing a
 * category feel local rather than reshuffling the whole section.
 */
export async function saveSkillCategory(
  sectionId: number,
  input: { category: string; skills: string; previousCategory?: string },
): Promise<ActionResult<number>> {
  return withVault(async () => {
    const parsed = categorySchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]!.message);

    const names = parseSkillNames(parsed.data.skills);
    if (names.length === 0) {
      return fail("Add at least one skill, separated by commas or new lines");
    }

    const category = parsed.data.category;
    const existing = await categoryRows(sectionId, input.previousCategory ?? category);

    const plan = planSkillRows(
      existing.map((r) => ({ id: r.row.id, name: r.resolved.name })),
      names,
    );

    // Where the category currently sits, so an edit doesn't jump it to the end.
    const base =
      existing.length > 0
        ? Math.min(...existing.map((r) => r.row.displayOrder))
        : ((
            await first(
              db
                .select({ o: resumeSkills.displayOrder })
                .from(resumeSkills)
                .where(eq(resumeSkills.sectionId, sectionId))
                .orderBy(desc(resumeSkills.displayOrder)),
            )
          )?.o ?? -1) + 1;

    await db.transaction(async (tx) => {
      for (const id of plan.remove) {
        await tx.delete(resumeSkills).where(eq(resumeSkills.id, id));
      }

      for (const k of plan.keep) {
        await tx
          .update(resumeSkills)
          .set({
            displayOrder: base + k.order,
            categoryOverride: category,
            // Only written when the name actually changed, so a pulled skill
            // keeps reading through to the vault until you retype it.
            ...(k.name === null ? {} : { nameOverride: k.name }),
          })
          .where(eq(resumeSkills.id, k.id));
      }

      for (const ins of plan.insert) {
        await tx.insert(resumeSkills).values({
          sectionId,
          sourceSkillId: null,
          nameOverride: ins.name,
          categoryOverride: category,
          displayOrder: base + ins.order,
        });
      }
    });

    const resumeId = await resumeIdForSection(sectionId);
    if (resumeId) {
      await bumpResume(resumeId);
      refresh(resumeId);
    }
    return { ok: true, data: names.length };
  });
}

/** Delete a whole category line. Individual chips are removed one at a time. */
export async function removeSkillCategory(
  sectionId: number,
  category: string,
): Promise<ActionResult> {
  return withVault(async () => {
    for (const { row } of await categoryRows(sectionId, category)) {
      await db.delete(resumeSkills).where(eq(resumeSkills.id, row.id));
    }

    const resumeId = await resumeIdForSection(sectionId);
    if (resumeId) {
      await bumpResume(resumeId);
      refresh(resumeId);
    }
    return { ok: true };
  });
}

/**
 * Reorder the category lines.
 *
 * `groupSkills` keys a Map by category, so a group's position is decided by
 * where its *first* row falls. Renumbering the whole section category by
 * category keeps each group's rows contiguous, which makes that rule
 * predictable instead of incidental — and keeps skills within a category in
 * the order the user arranged them.
 */
export async function reorderSkillCategories(
  sectionId: number,
  categories: string[],
): Promise<ActionResult> {
  return withVault(async () => {
    const parsed = z.array(z.string()).max(50).safeParse(categories);
    if (!parsed.success) return fail("Could not read the new category order");

    await db.transaction(async (tx) => {
      let order = 0;
      const written = new Set<number>();

      for (const category of parsed.data) {
        for (const { row } of await categoryRows(sectionId, category)) {
          if (written.has(row.id)) continue;
          written.add(row.id);
          await tx
            .update(resumeSkills)
            .set({ displayOrder: order++ })
            .where(eq(resumeSkills.id, row.id));
        }
      }

      // Anything the client didn't mention — a category added in another tab —
      // keeps its rows and lands after, rather than being silently dropped.
      const rest = await db
        .select()
        .from(resumeSkills)
        .where(eq(resumeSkills.sectionId, sectionId))
        .orderBy(asc(resumeSkills.displayOrder));

      for (const row of rest) {
        if (written.has(row.id)) continue;
        await tx
          .update(resumeSkills)
          .set({ displayOrder: order++ })
          .where(eq(resumeSkills.id, row.id));
      }
    });

    const resumeId = await resumeIdForSection(sectionId);
    if (resumeId) {
      await bumpResume(resumeId);
      refresh(resumeId);
    }
    return { ok: true };
  });
}

/* ------------------------------------------------------------------ */
/* Entries, bullets, skills within a resume                            */
/* ------------------------------------------------------------------ */

export async function removeResumeEntry(entryId: number): Promise<ActionResult> {
  return withVault(async () => {
    const resumeId = await resumeIdForEntry(entryId);
    await db.delete(resumeEntries).where(eq(resumeEntries.id, entryId));
    if (resumeId) {
      await bumpResume(resumeId);
      refresh(resumeId);
    }
    return { ok: true };
  });
}

export async function toggleEntryVisible(entryId: number): Promise<ActionResult> {
  return withVault(async () => {
    const row = await first(db.select().from(resumeEntries).where(eq(resumeEntries.id, entryId)));
    if (!row) return fail("Entry not found");

    await db
      .update(resumeEntries)
      .set({ isVisible: !row.isVisible })
      .where(eq(resumeEntries.id, entryId));

    const resumeId = await resumeIdForEntry(entryId);
    if (resumeId) {
      await bumpResume(resumeId);
      refresh(resumeId);
    }
    return { ok: true };
  });
}

/* ------------------------------------------------------------------ */
/* Reordering by drag                                                   */
/* ------------------------------------------------------------------ */

/**
 * Each takes the complete arrangement rather than a delta, and renumbers the
 * list contiguously inside a transaction — see the vault's equivalents for why
 * a drag can't be expressed as a sequence of swaps.
 *
 * Every one is scoped to its parent and silently skips ids that don't belong to
 * it. That is what keeps a stale client — a section deleted in another tab, an
 * entry that moved — from resurrecting rows or reparenting them by accident.
 */
const idList = z.array(z.number().int().positive()).max(500);

export async function reorderResumeSections(
  resumeId: number,
  sectionIds: number[],
): Promise<ActionResult> {
  return withVault(async () => {
    const parsed = idList.safeParse(sectionIds);
    if (!parsed.success) return fail("Could not read the new section order");

    const known = new Set(
      (
        await db
          .select({ id: resumeSections.id })
          .from(resumeSections)
          .where(eq(resumeSections.resumeId, resumeId))
      ).map((r) => r.id),
    );

    await db.transaction(async (tx) => {
      let order = 0;
      for (const id of parsed.data) {
        if (!known.has(id)) continue;
        await tx
          .update(resumeSections)
          .set({ displayOrder: order++ })
          .where(eq(resumeSections.id, id));
      }
    });

    await bumpResume(resumeId);
    refresh(resumeId);
    return { ok: true };
  });
}

export async function reorderResumeEntries(
  sectionId: number,
  entryIds: number[],
): Promise<ActionResult> {
  return withVault(async () => {
    const parsed = idList.safeParse(entryIds);
    if (!parsed.success) return fail("Could not read the new entry order");

    const known = new Set(
      (
        await db
          .select({ id: resumeEntries.id })
          .from(resumeEntries)
          .where(eq(resumeEntries.sectionId, sectionId))
      ).map((r) => r.id),
    );

    await db.transaction(async (tx) => {
      let order = 0;
      for (const id of parsed.data) {
        if (!known.has(id)) continue;
        await tx
          .update(resumeEntries)
          .set({ displayOrder: order++ })
          .where(eq(resumeEntries.id, id));
      }
    });

    const resumeId = await resumeIdForSection(sectionId);
    if (resumeId) {
      await bumpResume(resumeId);
      refresh(resumeId);
    }
    return { ok: true };
  });
}

/**
 * Bullet order within one resume entry.
 *
 * New capability rather than a replacement — resume bullets had a
 * `display_order` column and no way to change it, so they have always rendered
 * in the order they were pulled.
 */
export async function reorderResumeBullets(
  resumeEntryId: number,
  bulletIds: number[],
): Promise<ActionResult> {
  return withVault(async () => {
    const parsed = idList.safeParse(bulletIds);
    if (!parsed.success) return fail("Could not read the new bullet order");

    const known = new Set(
      (
        await db
          .select({ id: resumeBullets.id })
          .from(resumeBullets)
          .where(eq(resumeBullets.resumeEntryId, resumeEntryId))
      ).map((r) => r.id),
    );

    await db.transaction(async (tx) => {
      let order = 0;
      for (const id of parsed.data) {
        if (!known.has(id)) continue;
        await tx
          .update(resumeBullets)
          .set({ displayOrder: order++ })
          .where(eq(resumeBullets.id, id));
      }
    });

    const resumeId = await resumeIdForEntry(resumeEntryId);
    if (resumeId) {
      await bumpResume(resumeId);
      refresh(resumeId);
    }
    return { ok: true };
  });
}

/**
 * Editing a bullet inside a resume writes an override. The `sourceBulletId`
 * pointer is deliberately kept: the tuner still needs to know this bullet came
 * from the vault even once its wording diverges.
 */
export async function editResumeBullet(bulletId: number, text: string): Promise<ActionResult> {
  return withVault(async () => {
    const parsed = z.string().trim().min(1).max(1000).safeParse(text);
    if (!parsed.success) return fail("Bullet can't be empty");

    await db.update(resumeBullets).set({ text: parsed.data }).where(eq(resumeBullets.id, bulletId));

    const row = await first(db.select().from(resumeBullets).where(eq(resumeBullets.id, bulletId)));
    const resumeId = row ? await resumeIdForEntry(row.resumeEntryId) : null;
    if (resumeId) {
      await bumpResume(resumeId);
      refresh(resumeId);
    }
    return { ok: true };
  });
}

export async function toggleBulletVisible(bulletId: number): Promise<ActionResult> {
  return withVault(async () => {
    const row = await first(db.select().from(resumeBullets).where(eq(resumeBullets.id, bulletId)));
    if (!row) return fail("Bullet not found");

    await db
      .update(resumeBullets)
      .set({ isVisible: !row.isVisible })
      .where(eq(resumeBullets.id, bulletId));

    const resumeId = await resumeIdForEntry(row.resumeEntryId);
    if (resumeId) {
      await bumpResume(resumeId);
      refresh(resumeId);
    }
    return { ok: true };
  });
}

export async function removeResumeBullet(bulletId: number): Promise<ActionResult> {
  return withVault(async () => {
    const row = await first(db.select().from(resumeBullets).where(eq(resumeBullets.id, bulletId)));
    const resumeId = row ? await resumeIdForEntry(row.resumeEntryId) : null;

    await db.delete(resumeBullets).where(eq(resumeBullets.id, bulletId));

    if (resumeId) {
      await bumpResume(resumeId);
      refresh(resumeId);
    }
    return { ok: true };
  });
}

export async function removeResumeSkill(skillId: number): Promise<ActionResult> {
  return withVault(async () => {
    const row = await first(db.select().from(resumeSkills).where(eq(resumeSkills.id, skillId)));
    const resumeId = row ? await resumeIdForSection(row.sectionId) : null;

    await db.delete(resumeSkills).where(eq(resumeSkills.id, skillId));

    if (resumeId) {
      await bumpResume(resumeId);
      refresh(resumeId);
    }
    return { ok: true };
  });
}
