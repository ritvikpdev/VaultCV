import "server-only";

import { asc } from "drizzle-orm";

import { orderedBlocks } from "../lib/reorder";

import { db } from "./client";
import { getSetting, SETTING_KEYS } from "./bootstrap";
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
 * Three whole-table reads grouped in memory, rather than a join with row
 * duplication. "Whole table" means the current user's rows only — row-level
 * security filters before anything leaves Postgres. At vault scale the
 * difference from a join is unmeasurable and this stays readable.
 */
export async function allSections(): Promise<SectionWithEntries[]> {
  const sections = await db.select().from(vaultSections).orderBy(asc(vaultSections.displayOrder));

  if (sections.length === 0) return [];

  const [entries, bullets] = await Promise.all([
    db.select().from(vaultEntries).orderBy(asc(vaultEntries.displayOrder)),
    db.select().from(vaultBullets).orderBy(asc(vaultBullets.displayOrder)),
  ]);

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

export async function allGroups(): Promise<VaultGroup[]> {
  return db.select().from(vaultGroups).orderBy(asc(vaultGroups.displayOrder));
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
export async function vaultBlocks(): Promise<VaultBlock[]> {
  const [groups, sections, ungroupedSetting] = await Promise.all([
    allGroups(),
    allSections(),
    getSetting(SETTING_KEYS.ungroupedOrder),
  ]);
  const ungroupedOrder = Number(ungroupedSetting ?? -1);

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
export async function allSkills(): Promise<VaultSkill[]> {
  return db.select().from(vaultSkills).orderBy(asc(vaultSkills.id));
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
export async function searchVault(query: string): Promise<SearchHit[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const sections = await allSections();
  const hits: SearchHit[] = [];

  for (const section of sections) {
    for (const entry of section.entries) {
      const matchedHeader =
        entry.title.toLowerCase().includes(q) ||
        entry.organization.toLowerCase().includes(q) ||
        entry.subtitle.toLowerCase().includes(q) ||
        entry.information.toLowerCase().includes(q);

      const matchedBullets = entry.bullets.filter(
        (b) => b.text.toLowerCase().includes(q) || b.tags.some((t) => t.toLowerCase().includes(q)),
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
export async function entryCountsBySection(): Promise<Record<number, number>> {
  const rows = await db.select({ sectionId: vaultEntries.sectionId }).from(vaultEntries);

  const out: Record<number, number> = {};
  for (const r of rows) out[r.sectionId] = (out[r.sectionId] ?? 0) + 1;
  return out;
}

/** Look up a section by heading, case-insensitively. Used by import merging. */
export async function findSectionByHeading(heading: string): Promise<VaultSection | null> {
  const target = heading.trim().toLowerCase();
  return (
    (await db.select().from(vaultSections)).find(
      (s) => s.heading.trim().toLowerCase() === target,
    ) ?? null
  );
}
