"use server";

import { revalidatePath } from "next/cache";
import { asc, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { bootstrap, getProfile } from "@/db/bootstrap";
import { findSectionByHeading } from "@/db/queries";
import { profile, vaultBullets, vaultEntries, vaultSections } from "@/db/schema";
import type { ParseSource } from "@/lib/import-parse";
import { parseResumeText } from "@/lib/import-parse";
import type { ParsedEntry, ParsedImport, ParsedProfile } from "@/lib/import-schema";
import { EmptyPdfTextError, extractPdfText } from "@/lib/pdf-extract";
import { profileSchema } from "@/lib/profile-schema";
import { normalizeTerm } from "@/lib/skill-aliases";
import { findSimilar } from "@/lib/similarity";

import { createBullet, createEntry, createSection } from "../actions";

export type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : { data: T }))
  | { ok: false; error: string };

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

/* ------------------------------------------------------------------ */
/* Parse                                                               */
/* ------------------------------------------------------------------ */

export type AnnotatedBullet = { text: string; possibleDuplicateOf?: string };

export type AnnotatedEntry = Omit<ParsedEntry, "bullets"> & {
  bullets: AnnotatedBullet[];
  /** Heading this entry was found under, verbatim from the resume. */
  sectionHeading: string;
  sectionType: "normal" | "skill";
  /** Set when a section with this heading is already in the vault. */
  existingSectionId: number | null;
  /** Set when an entry with this title and employer is already in that section. */
  existingEntryId: number | null;
};

export type AnnotatedImport = {
  profile: ParsedProfile;
  entries: AnnotatedEntry[];
  source: ParseSource;
  /**
   * Samples of text whose spacing the PDF didn't preserve. Non-empty means the
   * import is partly unreliable and the user should know before saving.
   */
  gluedSamples: string[];
  /** Why AI parsing was not used, when a provider is configured but failed. */
  fallbackReason: string;
};

/**
 * Attach vault context to each parsed entry.
 *
 * The import only ever creates what the resume actually contains — no template
 * of empty sections. Where a heading or an entry already exists it merges into
 * it, so importing a second resume enriches the vault rather than duplicating it.
 */
function annotate(parsed: ParsedImport): AnnotatedImport["entries"] {
  const existingBulletText = db
    .select({ text: vaultBullets.text, entryId: vaultBullets.entryId })
    .from(vaultBullets)
    .where(eq(vaultBullets.isActive, true))
    .all();

  const allEntries = db.select().from(vaultEntries).all();
  const seenInBatch: string[] = [];

  return parsed.entries.map((entry) => {
    const heading = entry.sectionHeading?.trim() || "Other";
    const section = findSectionByHeading(heading);

    // Same title and employer inside the same section is the same thing.
    const existingEntry = section
      ? (allEntries.find(
          (e) =>
            e.sectionId === section.id &&
            normalizeTerm(e.title) === normalizeTerm(entry.title) &&
            normalizeTerm(e.organization) === normalizeTerm(entry.organization),
        ) ?? null)
      : null;

    // Duplicate flags are scoped to the entry we'd merge into where there is
    // one — a bullet already under a different job isn't a duplicate here.
    const compareAgainst = existingEntry
      ? existingBulletText.filter((b) => b.entryId === existingEntry.id).map((b) => b.text)
      : existingBulletText.map((b) => b.text);

    const bullets = entry.bullets.map((b) => {
      const duplicateOf =
        findSimilar(b.text, compareAgainst) ?? findSimilar(b.text, seenInBatch);
      seenInBatch.push(b.text);
      return duplicateOf ? { text: b.text, possibleDuplicateOf: duplicateOf } : { text: b.text };
    });

    return {
      ...entry,
      bullets,
      sectionHeading: heading,
      sectionType: entry.sectionType === "skill" ? "skill" : "normal",
      existingSectionId: section?.id ?? null,
      existingEntryId: existingEntry?.id ?? null,
    };
  });
}

export async function parseImportInput(
  formData: FormData,
): Promise<ActionResult<AnnotatedImport>> {
  bootstrap();

  const file = formData.get("file");
  const pastedText = String(formData.get("text") ?? "").trim();

  let text: string;
  let gluedSamples: string[] = [];

  try {
    if (file instanceof File && file.size > 0) {
      const extracted = await extractPdfText(Buffer.from(await file.arrayBuffer()));
      text = extracted.text;
      gluedSamples = extracted.gluedSamples;
    } else {
      text = pastedText;
    }
  } catch (err) {
    if (err instanceof EmptyPdfTextError) return fail(err.message);
    return fail("Could not read that PDF. Try pasting the text instead.");
  }

  if (!text || text.replace(/\s+/g, "").length < 20) {
    return fail("Paste some resume text or choose a PDF file first.");
  }

  const { result, source, fallbackReason } = await parseResumeText(text);

  return {
    ok: true,
    data: {
      profile: result.profile,
      entries: annotate(result),
      source,
      gluedSamples,
      fallbackReason,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Save                                                                */
/* ------------------------------------------------------------------ */

export type ReviewedEntryInput = {
  sectionHeading: string;
  sectionType: "normal" | "skill";
  existingSectionId: number | null;
  existingEntryId: number | null;
  title: string;
  organization: string;
  subtitle: string;
  location: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
  information: string;
  checked: boolean;
  bullets: { text: string; checked: boolean }[];
};

export type ProfileImportAction = "skip" | "overwrite" | "merge";

export type ReviewedImportInput = {
  profileAction: ProfileImportAction;
  profile?: ParsedProfile;
  entries: ReviewedEntryInput[];
};

function applyProfileAction(action: ProfileImportAction, parsed: ParsedProfile | undefined) {
  if (action === "skip" || !parsed) return;

  const current = getProfile();
  const parsedLinks = (parsed.links ?? []).filter((l) => l.label && l.url);

  const next =
    action === "overwrite"
      ? {
          fullName: parsed.fullName || current.fullName,
          email: parsed.email || current.email,
          phone: parsed.phone || current.phone,
          location: parsed.location || current.location,
          summary: parsed.summary || current.summary,
          links: parsedLinks.length > 0 ? parsedLinks : current.links,
        }
      : {
          fullName: current.fullName || parsed.fullName || "",
          email: current.email || parsed.email || "",
          phone: current.phone || parsed.phone || "",
          location: current.location || parsed.location || "",
          summary: current.summary || parsed.summary || "",
          links: [
            ...current.links,
            ...parsedLinks.filter((l) => !current.links.some((e) => e.url === l.url)),
          ],
        };

  const validated = profileSchema.safeParse(next);
  if (!validated.success) return;

  db.update(profile)
    .set({ ...validated.data, updatedAt: Math.floor(Date.now() / 1000) })
    .where(eq(profile.id, current.id))
    .run();
}

export async function saveReviewedImport(
  reviewed: ReviewedImportInput,
): Promise<ActionResult<{ sections: number; entries: number; bullets: number; merged: number }>> {
  bootstrap();

  applyProfileAction(reviewed.profileAction, reviewed.profile);

  let sectionsCreated = 0;
  let entriesCreated = 0;
  let bulletsCreated = 0;
  let merged = 0;

  // Sections created during this run, so two entries under the same new
  // heading land in one section rather than creating it twice.
  const sectionCache = new Map<string, number>();

  for (const entry of reviewed.entries) {
    if (!entry.checked) continue;

    const key = normalizeTerm(entry.sectionHeading);
    let sectionId = entry.existingSectionId ?? sectionCache.get(key) ?? null;

    if (!sectionId) {
      const existing = findSectionByHeading(entry.sectionHeading);
      if (existing) {
        sectionId = existing.id;
      } else {
        const created = await createSection({
          heading: entry.sectionHeading,
          type: entry.sectionType,
        });
        if (!created.ok) continue;
        sectionId = created.data;
        sectionsCreated += 1;
      }
      sectionCache.set(key, sectionId);
    }

    // Merge into an existing entry, or create one.
    let entryId = entry.existingEntryId;

    if (entryId) {
      merged += 1;
    } else {
      const created = await createEntry(sectionId, {
        title: entry.title,
        organization: entry.organization,
        subtitle: entry.subtitle,
        location: entry.location,
        startDate: entry.startDate,
        endDate: entry.isCurrent ? "" : entry.endDate,
        isCurrent: entry.isCurrent,
        information: entry.information,
      });
      if (!created.ok) continue;
      entryId = created.data;
      entriesCreated += 1;
    }

    for (const bullet of entry.bullets) {
      if (!bullet.checked) continue;
      const result = await createBullet(entryId, bullet.text);
      if (result.ok) bulletsCreated += 1;
    }
  }

  revalidatePath("/vault");
  revalidatePath("/");

  return {
    ok: true,
    data: {
      sections: sectionsCreated,
      entries: entriesCreated,
      bullets: bulletsCreated,
      merged,
    },
  };
}

/** Existing vault sections, for the review screen's section dropdown. */
export async function existingSections() {
  bootstrap();
  return db
    .select()
    .from(vaultSections)
    .orderBy(asc(vaultSections.displayOrder))
    .all();
}
