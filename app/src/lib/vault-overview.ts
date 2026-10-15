import { extractSkills } from "./skill-index.ts";

/**
 * The vault's front page, as numbers and a to-do list.
 *
 * Computed from the sections the page already loads rather than with its own
 * queries — the overview is a different view of the same rows, and a second
 * read path is a second thing to keep consistent with the first.
 *
 * Bullet strength here is writing quality only (see bullet-strength.ts). The
 * overview never says anything about fit for a job; that needs a JD.
 */

type OverviewBullet = { id: number; text: string; strength: number; isPinned: boolean };

type OverviewEntry = {
  id: number;
  title: string;
  organization: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
  information: string;
  bullets: OverviewBullet[];
};

type OverviewSection = {
  id: number;
  heading: string;
  type: string;
  /** Null for a section filed before every section needed a group. */
  groupName: string | null;
  entries: OverviewEntry[];
};

export type AttentionKind = "no-group" | "no-bullets" | "no-skills" | "weak-bullet" | "no-dates";

export type AttentionItem = {
  /**
   * Stable identity for clearing: the kind plus the row it's about (the
   * bullet for a weak bullet, the section for an ungrouped one, else the
   * entry). Survives reloads and reordering; a fixed problem just stops
   * being generated, so a stale cleared key is harmless.
   */
  key: string;
  kind: AttentionKind;
  sectionId: number;
  sectionHeading: string;
  groupName: string | null;
  /** Absent for `no-group`, which is about the section rather than an entry in it. */
  entryId?: number;
  entryTitle?: string;
  /** The bullet text, for a weak bullet. */
  detail?: string;
  /** The bullet's score, for a weak bullet — weakest are listed first. */
  strength?: number;
};

export type VaultOverview = {
  totals: { sections: number; entries: number; bullets: number; pinned: number; skills: number };
  /** How many items are hidden because the user cleared them. */
  cleared: number;
  /** Bullet counts by strength: index 0 is a score of 1, index 4 a score of 5. */
  strength: [number, number, number, number, number];
  attention: AttentionItem[];
  /** Every distinct skill across skill entries, canonical names, first-seen order. */
  skills: string[];
};

/** At or below this a bullet is flagged. Matches the "Weak" label. */
export const WEAK_BULLET_MAX = 2;

/**
 * Unfiled sections first — the app requires a group and these predate that —
 * then empty entries, the most obviously unfinished, then weak writing, then dates.
 */
const KIND_ORDER: Record<AttentionKind, number> = {
  "no-group": 0,
  "no-bullets": 1,
  "no-skills": 2,
  "weak-bullet": 3,
  "no-dates": 4,
};

export function summarizeVault(
  sections: OverviewSection[],
  cleared: ReadonlySet<string> = new Set(),
): VaultOverview {
  const strength: VaultOverview["strength"] = [0, 0, 0, 0, 0];
  const attention: AttentionItem[] = [];
  const skillKeys = new Set<string>();
  const skills: string[] = [];
  let entries = 0;
  let bullets = 0;
  let pinned = 0;

  for (const section of sections) {
    const isSkill = section.type === "skill";
    const place = {
      sectionId: section.id,
      sectionHeading: section.heading,
      groupName: section.groupName,
    };
    if (section.groupName === null) {
      attention.push({ key: `no-group:${section.id}`, kind: "no-group", ...place });
    }

    for (const entry of section.entries) {
      entries += 1;
      const where = {
        ...place,
        entryId: entry.id,
        entryTitle: entry.title,
      };

      if (isSkill) {
        const found = extractSkills(entry.information);
        if (found.length === 0) attention.push({ key: `no-skills:${entry.id}`, kind: "no-skills", ...where });
        for (const s of found) {
          const key = s.name.toLowerCase();
          if (skillKeys.has(key)) continue;
          skillKeys.add(key);
          skills.push(s.name);
        }
        continue;
      }

      if (entry.bullets.length === 0) attention.push({ key: `no-bullets:${entry.id}`, kind: "no-bullets", ...where });
      if (!entry.startDate && !entry.endDate && !entry.isCurrent) {
        attention.push({ key: `no-dates:${entry.id}`, kind: "no-dates", ...where });
      }

      for (const b of entry.bullets) {
        bullets += 1;
        if (b.isPinned) pinned += 1;
        const score = Math.max(1, Math.min(5, Math.round(b.strength)));
        strength[score - 1] += 1;
        if (score <= WEAK_BULLET_MAX) {
          attention.push({ key: `weak-bullet:${b.id}`, kind: "weak-bullet", ...where, detail: b.text, strength: score });
        }
      }
    }
  }

  // Stable sort keeps vault order within a kind, so the list reads top to
  // bottom the same way the sidebar does.
  attention.sort(
    (a, b) =>
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || (a.strength ?? 0) - (b.strength ?? 0),
  );

  const visible = attention.filter((a) => !cleared.has(a.key));

  return {
    totals: { sections: sections.length, entries, bullets, pinned, skills: skills.length },
    cleared: attention.length - visible.length,
    strength,
    attention: visible,
    skills,
  };
}
