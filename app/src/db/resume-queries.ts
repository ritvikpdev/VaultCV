import "server-only";

import { asc, desc, eq } from "drizzle-orm";

import { db, first } from "./client";
import { getProfile, getSetting, SETTING_KEYS } from "./bootstrap";
import {
  resumeBullets,
  resumeEntries,
  resumeSections,
  resumeSkills,
  resumes,
  resumeStyles,
  vaultBullets,
  vaultEntries,
  vaultSections,
  vaultSkills,
} from "./schema";
import {
  resolveBullet,
  resolveEntry,
  resolveSection,
  resolveSkill,
  type ResolvedResume,
  type VaultLinkMode,
} from "../lib/resume-model";

export async function vaultLinkMode(): Promise<VaultLinkMode> {
  return (await getSetting(SETTING_KEYS.vaultLinkMode)) === "linked" ? "linked" : "snapshot";
}

export async function listResumes() {
  return db.select().from(resumes).orderBy(desc(resumes.updatedAt));
}

/**
 * A whole resume, resolved and ready to render.
 *
 * Loads the vault tables wholesale rather than joining per row — the current
 * user's rows only, by row-level security. At vault scale that's a handful of
 * small reads, and it keeps the resolve step (which is where the
 * snapshot/linked rule lives) in one readable place instead of spread across
 * SQL.
 */
export async function getResumeFull(id: number): Promise<ResolvedResume | null> {
  const resume = await first(db.select().from(resumes).where(eq(resumes.id, id)));
  if (!resume) return null;

  const [style, mode, profile, sectionRows] = await Promise.all([
    first(db.select().from(resumeStyles).where(eq(resumeStyles.id, resume.styleId))),
    vaultLinkMode(),
    getProfile(),
    db
      .select()
      .from(resumeSections)
      .where(eq(resumeSections.resumeId, id))
      .orderBy(asc(resumeSections.displayOrder)),
  ]);
  if (!style) return null;

  const sectionIds = new Set(sectionRows.map((s) => s.id));
  if (sectionIds.size === 0) {
    return {
      id: resume.id,
      name: resume.name,
      targetRole: resume.targetRole,
      targetCompany: resume.targetCompany,
      profile,
      summary: resume.summaryOverride || profile.summary,
      style,
      sections: [],
    };
  }

  const [allEntryRows, allBulletRows, allSkillRows, vEntryRows, vBulletRows, vSkillRows] =
    await Promise.all([
      db.select().from(resumeEntries).orderBy(asc(resumeEntries.displayOrder)),
      db.select().from(resumeBullets).orderBy(asc(resumeBullets.displayOrder)),
      db.select().from(resumeSkills).orderBy(asc(resumeSkills.displayOrder)),
      // Vault lookups, only needed when an override is absent.
      db.select().from(vaultEntries),
      db.select().from(vaultBullets),
      db.select().from(vaultSkills),
    ]);

  const entryRows = allEntryRows.filter((e) => sectionIds.has(e.sectionId));
  const entryIds = new Set(entryRows.map((e) => e.id));
  const bulletRows = allBulletRows.filter((b) => entryIds.has(b.resumeEntryId));
  const skillRows = allSkillRows.filter((s) => sectionIds.has(s.sectionId));

  const vEntries = new Map(vEntryRows.map((e) => [e.id, e]));
  const vBullets = new Map(vBulletRows.map((b) => [b.id, b]));
  const vSkills = new Map(vSkillRows.map((s) => [s.id, s]));

  const bulletsByEntry = new Map<number, ReturnType<typeof resolveBullet>[]>();
  for (const row of bulletRows) {
    const resolved = resolveBullet(
      row,
      row.sourceBulletId ? vBullets.get(row.sourceBulletId) : undefined,
      mode,
    );
    const list = bulletsByEntry.get(row.resumeEntryId);
    if (list) list.push(resolved);
    else bulletsByEntry.set(row.resumeEntryId, [resolved]);
  }

  const entriesBySection = new Map<number, ReturnType<typeof resolveEntry>[]>();
  for (const row of entryRows) {
    const resolved = resolveEntry(
      row,
      row.sourceEntryId ? vEntries.get(row.sourceEntryId) : undefined,
      bulletsByEntry.get(row.id) ?? [],
    );
    const list = entriesBySection.get(row.sectionId);
    if (list) list.push(resolved);
    else entriesBySection.set(row.sectionId, [resolved]);
  }

  const skillsBySection = new Map<number, ReturnType<typeof resolveSkill>[]>();
  for (const row of skillRows) {
    const resolved = resolveSkill(
      row,
      row.sourceSkillId ? vSkills.get(row.sourceSkillId) : undefined,
    );
    const list = skillsBySection.get(row.sectionId);
    if (list) list.push(resolved);
    else skillsBySection.set(row.sectionId, [resolved]);
  }

  return {
    id: resume.id,
    name: resume.name,
    targetRole: resume.targetRole,
    targetCompany: resume.targetCompany,
    profile,
    summary: resume.summaryOverride || profile.summary,
    style,
    sections: sectionRows.map((s) =>
      resolveSection(s, entriesBySection.get(s.id) ?? [], skillsBySection.get(s.id) ?? []),
    ),
  };
}

/**
 * Vault content available to every section of a resume, with the ids already
 * used marked per section. Drives the Pull-from-Vault picker — this is one of
 * the things `source_entry_id` is load-bearing for.
 *
 * One call for the whole resume, where it used to be one per section: the
 * vault reads are identical for every section, and repeating them is a round
 * trip each now that the database isn't a local file.
 */
export async function vaultOptionsForResume(sectionIds: number[]) {
  const [resumeEntryRows, entries, allBullets, skills, sections] = await Promise.all([
    db.select().from(resumeEntries),
    // Every vault entry, not just one section's. Vault sections are
    // user-defined, so a resume section can't infer which one it corresponds
    // to — the picker offers all of them, grouped by their vault section, and
    // lets the user choose which one to draw from.
    db.select().from(vaultEntries).orderBy(asc(vaultEntries.displayOrder)),
    db.select().from(vaultBullets).orderBy(asc(vaultBullets.displayOrder)),
    // Creation order, not alphabetical by category. An import inserts skills in
    // the order the source resume listed them, so ordering by id reproduces
    // "Languages, Frameworks, Databases, Tools" rather than sorting it into
    // "Databases, Frameworks, Languages, Tools" — which is not what anyone wrote.
    db.select().from(vaultSkills).orderBy(asc(vaultSkills.id)),
    db.select().from(vaultSections).orderBy(asc(vaultSections.displayOrder)),
  ]);

  const bulletsByEntry = new Map<number, typeof allBullets>();
  for (const b of allBullets) {
    if (!b.isActive) continue;
    const list = bulletsByEntry.get(b.entryId);
    if (list) list.push(b);
    else bulletsByEntry.set(b.entryId, [b]);
  }

  const entryIdToSectionId = new Map(entries.map((e) => [e.id, e.sectionId]));

  const usedEntryIds = new Map<number, Set<number>>();
  for (const id of sectionIds) usedEntryIds.set(id, new Set());
  for (const e of resumeEntryRows) {
    if (e.sourceEntryId !== null) usedEntryIds.get(e.sectionId)?.add(e.sourceEntryId);
  }

  return {
    sections,
    entries: entries.map((e) => ({ ...e, bullets: bulletsByEntry.get(e.id) ?? [] })),
    skills: skills.map((s) => ({
      ...s,
      sectionId: entryIdToSectionId.get(s.sourceEntryId) ?? null,
    })),
    usedEntryIds,
  };
}
