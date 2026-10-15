/**
 * Where something lives in the vault, as "Group → Section".
 *
 * Groups are the vault's top level ("Work Experience"), sections the shelves
 * inside them ("SDE Experience"). Anything that shows a vault item away from
 * the vault — the resume's vault picker, a pulled entry's source tag, a tuner
 * suggestion — says both, because section names alone are ambiguous once two
 * groups each hold an "SDE" section.
 *
 * Plain records keyed by id so the index can cross from a Server Component to
 * the client as props. Paths are resolved when shown, not stored: an entry
 * moved to another section reports where it lives now.
 */

export type VaultPath = {
  /** Null only for sections filed before every section needed a group. */
  group: string | null;
  section: string;
};

export type VaultIndex = {
  sections: Record<number, VaultPath>;
  /** Vault entry id → its section id. */
  entrySection: Record<number, number>;
  /** Vault skill id (the derived index) → the section of the entry it came from. */
  skillSection: Record<number, number>;
};

export function buildVaultIndex({
  groups,
  sections,
  entries,
  skills,
}: {
  groups: Array<{ id: number; name: string }>;
  sections: Array<{ id: number; heading: string; groupId: number | null }>;
  entries: Array<{ id: number; sectionId: number }>;
  skills: Array<{ id: number; sourceEntryId: number }>;
}): VaultIndex {
  const groupName = new Map(groups.map((g) => [g.id, g.name]));
  const index: VaultIndex = { sections: {}, entrySection: {}, skillSection: {} };

  for (const s of sections) {
    index.sections[s.id] = {
      group: s.groupId === null ? null : (groupName.get(s.groupId) ?? null),
      section: s.heading,
    };
  }
  for (const e of entries) index.entrySection[e.id] = e.sectionId;
  for (const k of skills) {
    const sectionId = index.entrySection[k.sourceEntryId];
    if (sectionId !== undefined) index.skillSection[k.id] = sectionId;
  }

  return index;
}

export function pathOfSection(index: VaultIndex, sectionId: number | null | undefined): VaultPath | null {
  if (sectionId === null || sectionId === undefined) return null;
  return index.sections[sectionId] ?? null;
}

/** Null for an id the vault no longer has — a deleted source, or a hand-typed entry. */
export function pathOfEntry(index: VaultIndex, entryId: number | null | undefined): VaultPath | null {
  if (entryId === null || entryId === undefined) return null;
  return pathOfSection(index, index.entrySection[entryId]);
}

export function pathOfSkill(index: VaultIndex, skillId: number | null | undefined): VaultPath | null {
  if (skillId === null || skillId === undefined) return null;
  return pathOfSection(index, index.skillSection[skillId]);
}

/** "Work Experience → SDE Experience", for titles and plain-text contexts. */
export function formatPath(path: VaultPath): string {
  return path.group ? `${path.group} → ${path.section}` : path.section;
}
