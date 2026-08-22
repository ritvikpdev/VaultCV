import "server-only";

import { asc, eq } from "drizzle-orm";

import { orderedBlocks } from "../lib/reorder";

import { db } from "./client";
import { bootstrap, getSetting, SETTING_KEYS } from "./bootstrap";
import {
  vaultBullets,
  vaultEntries,
  vaultGroups,
  vaultSections,
  vaultSkills,
  type VaultBullet,
  type VaultEntry,
  type VaultGroup,
  type VaultSection,
  type VaultSkill,
} from "./schema";

export type EntryWithBullets = VaultEntry & { bullets: VaultBullet[] };
export type SectionWithEntries = VaultSection & { entries: EntryWithBullets[] };

/**
 * Every section, in order, with entries and bullets attached.
 *
 * A handful of small reads from local SQLite grouped in memory, rather than a
 * join with row duplication. At vault scale the difference is unmeasurable and
 * this stays readable.
 */
export function allSections(): SectionWithEntries[] {
  bootstrap();

  const sections = db
    .select()
    .from(vaultSections)
    .orderBy(asc(vaultSections.displayOrder))
    .all();

  if (sections.length === 0) return [];

  const entries = db
    .select()
    .from(vaultEntries)
    .orderBy(asc(vaultEntries.displayOrder))
    .all();

  const bullets = db
    .select()
    .from(vaultBullets)
    .orderBy(asc(vaultBullets.displayOrder))
    .all();

  const bulletsByEntry = new Map<number, VaultBullet[]>();
  for (const b of bullets) {
    if (!b.isActive) continue;
    const list = bulletsByEntry.get(b.entryId);
    if (list) list.push(b);
    else bulletsByEntry.set(b.entryId, [b]);
  }

  const entriesBySection = new Map<number, EntryWithBullets[]>();
  for (const e of entries) {
    const withBullets = { ...e, bullets: bulletsByEntry.get(e.id) ?? [] };
    const list = entriesBySection.get(e.sectionId);
    if (list) list.push(withBullets);
    else entriesBySection.set(e.sectionId, [withBullets]);
  }

  return sections.map((s) => ({ ...s, entries: entriesBySection.get(s.id) ?? [] }));
}

export function getSection(id: number): SectionWithEntries | null {
  return allSections().find((s) => s.id === id) ?? null;
}

export function allGroups(): VaultGroup[] {
  bootstrap();
  return db.select().from(vaultGroups).orderBy(asc(vaultGroups.displayOrder)).all();
}

/** One top-level block of the vault sidebar. A null group is the ungrouped block. */
export type VaultBlock = { group: VaultGroup | null; sections: SectionWithEntries[] };

/**
 * The sidebar's blocks, in display order, each with its sections.
 *
 * Block order is the one piece of vault ordering that isn't a plain column —
 * the ungrouped block's position is a setting, interleaved with the groups'
 * `display_order`. That reconciliation lives here so the sidebar, the reorder
 * action and any future consumer can't each interpret it slightly differently.
 */
export function vaultBlocks(): VaultBlock[] {
  bootstrap();

  const groups = allGroups();
  const sections = allSections();
  const ungroupedOrder = Number(getSetting(SETTING_KEYS.ungroupedOrder) ?? -1);

  return orderedBlocks(groups, Number.isFinite(ungroupedOrder) ? ungroupedOrder : -1).map(
    (key) => ({
      group: key === null ? null : (groups.find((g) => g.id === key) ?? null),
      sections: sections.filter((s) => s.groupId === key),
    }),
  );
}

/**
 * The derived skill index. Read by the tuner; never edited directly.
 * Ordered by id so it reflects the order skills were written in.
 */
export function allSkills(): VaultSkill[] {
  bootstrap();
  return db.select().from(vaultSkills).orderBy(asc(vaultSkills.id)).all();
}

export type SearchHit = {
  entry: VaultEntry;
  section: VaultSection;
  bullets: VaultBullet[];
  matchedHeader: boolean;
};

/**
 * Case-insensitive substring search across bullet text, entry title,
 * organization and a skill entry's sub-skills.
 *
 * Deliberately not fuzzy — when you're hunting a bullet you half-remember,
 * exact substring is more predictable than a ranked guess.
 */
export function searchVault(query: string): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const sections = allSections();
  const hits: SearchHit[] = [];

  for (const section of sections) {
    for (const entry of section.entries) {
      const matchedHeader =
        entry.title.toLowerCase().includes(q) ||
        entry.organization.toLowerCase().includes(q) ||
        entry.subtitle.toLowerCase().includes(q) ||
        entry.information.toLowerCase().includes(q);

      const matchedBullets = entry.bullets.filter(
        (b) =>
          b.text.toLowerCase().includes(q) ||
          b.tags.some((t) => t.toLowerCase().includes(q)),
      );

      if (matchedHeader || matchedBullets.length > 0) {
        hits.push({ entry, section, bullets: matchedBullets, matchedHeader });
      }
    }
  }

  // Pinned content first — if you pinned it, it's what you reach for.
  return hits.sort((a, b) => {
    const aPinned = a.bullets.some((x) => x.isPinned) ? 1 : 0;
    const bPinned = b.bullets.some((x) => x.isPinned) ? 1 : 0;
    return bPinned - aPinned;
  });
}

/** Entry counts per section, for the sidebar badges. */
export function entryCountsBySection(): Record<number, number> {
  bootstrap();
  const rows = db
    .select({ sectionId: vaultEntries.sectionId })
    .from(vaultEntries)
    .all();

  const out: Record<number, number> = {};
  for (const r of rows) out[r.sectionId] = (out[r.sectionId] ?? 0) + 1;
  return out;
}

/** Look up a section by heading, case-insensitively. Used by import merging. */
export function findSectionByHeading(heading: string): VaultSection | null {
  bootstrap();
  const target = heading.trim().toLowerCase();
  return (
    db
      .select()
      .from(vaultSections)
      .all()
      .find((s) => s.heading.trim().toLowerCase() === target) ?? null
  );
}
