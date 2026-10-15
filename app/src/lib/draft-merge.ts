import type { ResolvedEntry, ResolvedResume, ResolvedSection } from "./resume-model.ts";

/**
 * Merging fresh server data into the editor's working copy.
 *
 * The resume editor applies edits to a local copy first (so the preview keeps
 * up with typing) and saves behind it. When the server sends new data — after
 * a vault pull, an added section, a tab switch — taking it wholesale would
 * revert whatever was typed while that request was in flight. Taking the
 * local copy wholesale would hide the new entry the vault pull just added.
 *
 * So: start from the server, and put back only what was edited locally
 * ("dirty"). Kept free of React so it can be tested directly.
 */

export type EntryKey =
  | "title"
  | "organization"
  | "subtitle"
  | "location"
  | "startDate"
  | "endDate"
  | "isCurrent"
  | "url"
  | "meta";
export type SectionField = "heading" | "icon" | "options";
export type ProfileField =
  | "fullName"
  | "title"
  | "email"
  | "phone"
  | "location"
  | "summary"
  | "links"
  | "details"
  | "contactOrder";

export type Dirty = {
  entries: Map<number, Set<EntryKey | "isVisible">>;
  /** Entries whose bullet list is owned by the rich-text editor. */
  bullets: Set<number>;
  sections: Map<number, Set<SectionField>>;
  profile: Set<ProfileField>;
  sectionOrder: boolean;
  entryOrder: Set<number>;
  /** Skill sections with an edit still on its way to the server. */
  skills: Set<number>;
};

export function emptyDirty(): Dirty {
  return {
    entries: new Map(),
    bullets: new Set(),
    sections: new Map(),
    profile: new Set(),
    sectionOrder: false,
    entryOrder: new Set(),
    skills: new Set(),
  };
}

/**
 * Local order for rows both sides know; rows only the server has (just pulled
 * from the vault) after them, in the server's order. Rows the server no longer
 * has are dropped — deleted elsewhere.
 */
export function orderLike<T extends { id: number }>(local: T[], server: T[]): T[] {
  const byId = new Map(server.map((r) => [r.id, r]));
  const known = local.filter((r) => byId.has(r.id)).map((r) => byId.get(r.id)!);
  const seen = new Set(known.map((r) => r.id));
  return [...known, ...server.filter((r) => !seen.has(r.id))];
}

/** Server data, with every locally edited field kept as the user left it. */
export function mergeDraft(server: ResolvedResume, draft: ResolvedResume, dirty: Dirty): ResolvedResume {
  const draftSections = new Map(draft.sections.map((s) => [s.id, s]));
  const sections = dirty.sectionOrder ? orderLike(draft.sections, server.sections) : server.sections;

  const profile = { ...server.profile };
  for (const field of dirty.profile) {
    (profile as Record<string, unknown>)[field] = (draft.profile as Record<string, unknown>)[field];
  }

  return {
    ...server,
    profile,
    sections: sections.map((s) => {
      const local = draftSections.get(s.id);
      if (!local) return s;
      const merged: ResolvedSection = { ...s };
      for (const f of dirty.sections.get(s.id) ?? []) {
        (merged as Record<string, unknown>)[f] = local[f];
      }
      if (dirty.skills.has(s.id)) merged.skills = local.skills;

      const localEntries = new Map(local.entries.map((e) => [e.id, e]));
      const entries = dirty.entryOrder.has(s.id) ? orderLike(local.entries, s.entries) : s.entries;
      merged.entries = entries.map((e) => {
        const le = localEntries.get(e.id);
        if (!le) return e;
        const me: ResolvedEntry = { ...e };
        for (const f of dirty.entries.get(e.id) ?? []) {
          (me as Record<string, unknown>)[f] = le[f as keyof ResolvedEntry];
        }
        if (dirty.bullets.has(e.id)) me.bullets = le.bullets;
        return me;
      });
      return merged;
    }),
  };
}
