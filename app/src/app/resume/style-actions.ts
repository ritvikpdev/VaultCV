"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db, first } from "@/db/client";
import { withVault } from "@/db/session";
import { resumeSections, resumes, resumeStyles } from "@/db/schema";
import {
  clampStyleValue,
  DATE_POSITIONS,
  DEFAULT_STYLE,
  FONT_FAMILIES,
  HEADING_STYLES,
  PAGE_SIZES,
  SUBTITLE_STYLES,
  type NumericStyleKey,
} from "@/lib/style-presets";

export type ActionResult = { ok: true } | { ok: false; error: string };

function fail(error: string): ActionResult {
  return { ok: false, error };
}

const NUMERIC_KEYS: NumericStyleKey[] = [
  "baseSize",
  "nameSize",
  "headingSize",
  "lineHeight",
  "sectionGap",
  "entryGap",
  "bulletGap",
  "marginX",
  "marginY",
];

const stylePatchSchema = z
  .object({
    fontFamily: z.enum(FONT_FAMILIES.map((f) => f.value) as [string, ...string[]]),
    headingStyle: z.enum(HEADING_STYLES.map((h) => h.value) as [string, ...string[]]),
    pageSize: z.enum(PAGE_SIZES.map((p) => p.value) as [string, ...string[]]),
    datePosition: z.enum(DATE_POSITIONS.map((d) => d.value) as [string, ...string[]]),
    subtitleStyle: z.enum(SUBTITLE_STYLES.map((s) => s.value) as [string, ...string[]]),
    accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Colour must be a hex value"),
    baseSize: z.number(),
    nameSize: z.number(),
    headingSize: z.number(),
    lineHeight: z.number(),
    sectionGap: z.number(),
    entryGap: z.number(),
    bulletGap: z.number(),
    marginX: z.number(),
    marginY: z.number(),
  })
  .partial();

export type StylePatch = z.infer<typeof stylePatchSchema>;

/**
 * Persist customize changes.
 *
 * The client already applied the change optimistically — sliders drive the
 * preview from local state so dragging is smooth — so this is the durable
 * write, called on release rather than per pixel. Values are re-clamped here
 * because the slider's `min`/`max` are a UI affordance, not a guarantee.
 */
export async function updateResumeStyle(
  resumeId: number,
  patch: StylePatch,
): Promise<ActionResult> {
  return withVault(async () => {
    const parsed = stylePatchSchema.safeParse(patch);
    if (!parsed.success) return fail(parsed.error.issues[0]!.message);

    const resume = await first(db.select().from(resumes).where(eq(resumes.id, resumeId)));
    if (!resume) return fail("Resume not found");

    const clamped: Record<string, unknown> = { ...parsed.data };
    for (const key of NUMERIC_KEYS) {
      const value = parsed.data[key];
      if (typeof value === "number") clamped[key] = clampStyleValue(key, value);
    }

    if (Object.keys(clamped).length === 0) return { ok: true };

    await db.update(resumeStyles).set(clamped).where(eq(resumeStyles.id, resume.styleId));
    await db
      .update(resumes)
      .set({ updatedAt: Math.floor(Date.now() / 1000) })
      .where(eq(resumes.id, resumeId));

    revalidatePath(`/resume/${resumeId}`);
    return { ok: true };
  });
}

export async function resetResumeStyle(resumeId: number): Promise<ActionResult> {
  return withVault(async () => {
    const resume = await first(db.select().from(resumes).where(eq(resumes.id, resumeId)));
    if (!resume) return fail("Resume not found");

    await db.update(resumeStyles).set(DEFAULT_STYLE).where(eq(resumeStyles.id, resume.styleId));

    revalidatePath(`/resume/${resumeId}`);
    return { ok: true };
  });
}

/** Insert a hard page break after a section, or clear it. */
export async function setSectionPageBreak(
  sectionId: number,
  value: boolean,
): Promise<ActionResult> {
  return withVault(async () => {
    const section = await first(
      db.select().from(resumeSections).where(eq(resumeSections.id, sectionId)),
    );
    if (!section) return fail("Section not found");

    await db
      .update(resumeSections)
      .set({ pageBreakAfter: value })
      .where(eq(resumeSections.id, sectionId));

    revalidatePath(`/resume/${section.resumeId}`);
    return { ok: true };
  });
}

export async function toggleSectionVisible(sectionId: number): Promise<ActionResult> {
  return withVault(async () => {
    const section = await first(
      db.select().from(resumeSections).where(eq(resumeSections.id, sectionId)),
    );
    if (!section) return fail("Section not found");

    await db
      .update(resumeSections)
      .set({ isVisible: !section.isVisible })
      .where(eq(resumeSections.id, sectionId));

    revalidatePath(`/resume/${section.resumeId}`);
    return { ok: true };
  });
}
