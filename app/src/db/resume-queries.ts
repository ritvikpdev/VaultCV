import "server-only";

import { asc, eq } from "drizzle-orm";

import { db } from "./client";
import { bootstrap, getProfile, getSetting, SETTING_KEYS } from "./bootstrap";
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
} from "./schema";
import {
  resolveBullet,
  resolveEntry,
  resolveSection,
  resolveSkill,
  type ResolvedResume,
  type VaultLinkMode,
} from "../lib/resume-model";

export function vaultLinkMode(): VaultLinkMode {
  return getSetting(SETTING_KEYS.vaultLinkMode) === "linked" ? "linked" : "snapshot";
}

export function listResumes() {
  bootstrap();
  return db.select().from(resumes).orderBy(asc(resumes.updatedAt)).all().reverse();
}

/**
 * A whole resume, resolved and ready to render.
 *
 * Loads the vault tables wholesale rather than joining per row. At vault scale
 * that's a handful of small reads from local SQLite, and it keeps the resolve
 * step (which is where the snapshot/linked rule lives) in one readable place
 * instead of spread across SQL.
 */
export function getResumeFull(id: number): ResolvedResume | null {
  bootstrap();

  const resume = db.select().from(resumes).where(eq(resumes.id, id)).get();
  if (!resume) return null;

  const style = db
    .select()
    .from(resumeStyles)
    .where(eq(resumeStyles.id, resume.styleId))
    .get();
  if (!style) return null;

  const mode = vaultLinkMode();
  const profile = getProfile();

  const sectionRows = db
    .select()
    .from(resumeSections)
    .where(eq(resumeSections.resumeId, id))
    .orderBy(asc(resumeSections.displayOrder))
    .all();

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

  const entryRows = db
    .select()
    .from(resumeEntries)
    .orderBy(asc(resumeEntries.displayOrder))
    .all()
    .filter((e) => sectionIds.has(e.sectionId));

  const entryIds = new Set(entryRows.map((e) => e.id));

  const bulletRows = db
    .select()
    .from(resumeBullets)
    .orderBy(asc(resumeBullets.displayOrder))
    .all()
    .filter((b) => entryIds.has(b.resumeEntryId));

  const skillRows = db
    .select()
    .from(resumeSkills)
    .orderBy(asc(resumeSkills.displayOrder))
    .all()
    .filter((s) => sectionIds.has(s.sectionId));

  // Vault lookups, only needed when an override is absent.
  const vEntries = new Map(db.select().from(vaultEntries).all().map((e) => [e.id, e]));
  const vBullets = new Map(db.select().from(vaultBullets).all().map((b) => [b.id, b]));
  const vSkills = new Map(db.select().from(vaultSkills).all().map((s) => [s.id, s]));

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
 * Vault content available to a section, with the ids already used in this
 * resume marked. Drives the Pull-from-Vault picker — this is one of the things
 * `source_entry_id` is load-bearing for.
 */
export function vaultOptionsForSection(resumeId: number, sectionId: number) {
  bootstrap();

  const section = db
    .select()
    .from(resumeSections)
    .where(eq(resumeSections.id, sectionId))
    .get();
  if (!section) return { entries: [], skills: [], usedEntryIds: new Set<number>() };

  const usedEntryIds = new Set(
    db
      .select()
      .from(resumeEntries)
      .all()
      .filter((e) => e.sectionId === sectionId && e.sourceEntryId !== null)
      .map((e) => e.sourceEntryId!),
  );

  // Every vault entry, not just one section's. Vault sections are user-defined
  // now, so a resume section can't infer which one it corresponds to — the
  // picker offers all of them and lets the user choose.
  const entries = db
    .select()
    .from(vaultEntries)
    .orderBy(asc(vaultEntries.displayOrder))
    .all();

  const allBullets = db
    .select()
    .from(vaultBullets)
    .orderBy(asc(vaultBullets.displayOrder))
    .all();

  const bulletsByEntry = new Map<number, typeof allBullets>();
  for (const b of allBullets) {
    if (!b.isActive) continue;
    const list = bulletsByEntry.get(b.entryId);
    if (list) list.push(b);
    else bulletsByEntry.set(b.entryId, [b]);
  }

  return {
    entries: entries.map((e) => ({ ...e, bullets: bulletsByEntry.get(e.id) ?? [] })),
    // Creation order, not alphabetical by category. An import inserts skills in
    // the order the source resume listed them, so ordering by id reproduces
    // "Languages, Frameworks, Databases, Tools" rather than sorting it into
    // "Databases, Frameworks, Languages, Tools" — which is not what anyone wrote.
    skills: db.select().from(vaultSkills).orderBy(asc(vaultSkills.id)).all(),
    usedEntryIds,
  };
}
