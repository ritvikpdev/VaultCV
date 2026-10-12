import type {
  Profile,
  ResumeBullet,
  ResumeEntry,
  ResumeSection,
  ResumeSkill,
  ResumeStyle,
  SectionType,
  VaultBullet,
  VaultEntry,
  VaultSkill,
} from "../db/schema.ts";

/**
 * The resolve rule — where snapshot and linked mode actually differ.
 *
 * A resume row holds a pointer to its vault origin plus optional overrides.
 * Reading it means deciding which wins:
 *
 *   snapshot : the resume's own text is authoritative. Vault edits do not
 *              propagate. This is what ships.
 *   linked   : a NULL override reads through to the vault, so fixing a typo
 *              once fixes it everywhere. A non-NULL override still wins, so
 *              per-resume wording survives.
 *
 * Both modes read the same columns. That is the whole point of carrying
 * `source_*_id` from day one — switching is a change to these functions, not a
 * migration. Anything that renders a resume must go through here rather than
 * reading `.text` directly, or the two modes will disagree.
 */
export type VaultLinkMode = "snapshot" | "linked";

/** Flattened, render-ready shapes. The renderer never sees a nullable override. */
export type ResolvedBullet = {
  id: number;
  text: string;
  sourceBulletId: number | null;
  isVisible: boolean;
};

export type ResolvedEntry = {
  id: number;
  title: string;
  organization: string;
  subtitle: string;
  location: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
  url: string;
  meta: Record<string, unknown>;
  sourceEntryId: number | null;
  isVisible: boolean;
  bullets: ResolvedBullet[];
};

export type ResolvedSection = {
  id: number;
  sectionType: SectionType;
  heading: string;
  layout: "normal" | "skill";
  isVisible: boolean;
  pageBreakAfter: boolean;
  entries: ResolvedEntry[];
  /** Populated for skill-layout sections instead of `entries`. */
  skills: Array<{ id: number; name: string; category: string; isVisible: boolean }>;
};

export type ResolvedResume = {
  id: number;
  name: string;
  targetRole: string;
  targetCompany: string;
  profile: Profile;
  /** Resume override if set, else the profile's default. */
  summary: string;
  style: ResumeStyle;
  sections: ResolvedSection[];
};

/** `override ?? vault ?? ""`, with empty-string overrides treated as real values. */
function pick(override: string | null | undefined, fallback: string | undefined): string {
  return override ?? fallback ?? "";
}

export function resolveBullet(
  row: ResumeBullet,
  vault: VaultBullet | undefined,
  mode: VaultLinkMode,
): ResolvedBullet {
  // In snapshot mode `text` is always populated, so the vault lookup is never
  // consulted. In linked mode a NULL text falls through to the vault.
  const text =
    mode === "snapshot" ? (row.text ?? vault?.text ?? "") : pick(row.text, vault?.text);

  return {
    id: row.id,
    text,
    sourceBulletId: row.sourceBulletId,
    isVisible: row.isVisible,
  };
}

export function resolveEntry(
  row: ResumeEntry,
  vault: VaultEntry | undefined,
  bullets: ResolvedBullet[],
): ResolvedEntry {
  return {
    id: row.id,
    title: pick(row.titleOverride, vault?.title),
    organization: pick(row.organizationOverride, vault?.organization),
    subtitle: pick(row.subtitleOverride, vault?.subtitle),
    location: pick(row.locationOverride, vault?.location),
    startDate: pick(row.startDateOverride, vault?.startDate),
    endDate: pick(row.endDateOverride, vault?.endDate),
    isCurrent: vault?.isCurrent ?? false,
    url: vault?.url ?? "",
    meta: vault?.meta ?? {},
    sourceEntryId: row.sourceEntryId,
    isVisible: row.isVisible,
    bullets,
  };
}

export function resolveSkill(row: ResumeSkill, vault: VaultSkill | undefined) {
  return {
    id: row.id,
    name: pick(row.nameOverride, vault?.name),
    category: pick(row.categoryOverride, vault?.category),
    isVisible: row.isVisible,
  };
}

export function resolveSection(
  row: ResumeSection,
  entries: ResolvedEntry[],
  skills: ResolvedSection["skills"],
): ResolvedSection {
  return {
    id: row.id,
    sectionType: row.sectionType,
    heading: row.heading,
    layout: row.layout === "skill" ? "skill" : "normal",
    isVisible: row.isVisible,
    pageBreakAfter: row.pageBreakAfter,
    entries,
    skills,
  };
}

/* ------------------------------------------------------------------ */
/* Display helpers — shared by preview and print                       */
/* ------------------------------------------------------------------ */

/** "10/2022 – 07/2025", "08/2025 – Present", "2025", or "". */
export function formatDateRange(entry: {
  startDate: string;
  endDate: string;
  isCurrent: boolean;
}): string {
  const end = entry.isCurrent ? "Present" : entry.endDate;
  return [entry.startDate, end].filter(Boolean).join(" – ");
}

export type ContactItem = { text: string; href?: string };

/**
 * A URL as typed ("linkedin.com/in/x") isn't a valid `href` — the browser
 * would resolve it relative to the current page instead of navigating out.
 */
function withScheme(url: string): string {
  return /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`;
}

/**
 * Contact line under the name: email · phone · location · links.
 *
 * A link prints as its label (e.g. "LinkedIn"), not the raw URL, with the URL
 * carried as `href` — the whole point of the label field. Email and phone have
 * no separate label, so they print as themselves.
 */
export function formatContactLine(profile: Profile): ContactItem[] {
  const items: ContactItem[] = [];
  if (profile.email) items.push({ text: profile.email });
  if (profile.phone) items.push({ text: profile.phone });
  if (profile.location) items.push({ text: profile.location });
  for (const link of profile.links) {
    if (!link.url) continue;
    items.push({ text: link.label || link.url, href: withScheme(link.url) });
  }
  return items;
}

/** Skills grouped by category, preserving insertion order within each group. */
export function groupSkills(skills: ResolvedSection["skills"]) {
  const groups = new Map<string, string[]>();
  for (const s of skills) {
    if (!s.isVisible || !s.name) continue;
    const list = groups.get(s.category);
    if (list) list.push(s.name);
    else groups.set(s.category, [s.name]);
  }
  return Array.from(groups, ([category, names]) => ({ category, names }));
}

/**
 * The same grouping, for the editor rather than the page.
 *
 * Two differences, both deliberate. Hidden skills are kept, because the editor
 * is where you unhide them. And each group carries its rows, so a category can
 * be edited, deleted or dragged as a unit — the renderer only ever needs the
 * names, but the editor needs to know which rows a line is made of.
 */
export function groupSkillsForEditing(skills: ResolvedSection["skills"]) {
  const groups = new Map<string, ResolvedSection["skills"]>();
  for (const s of skills) {
    const list = groups.get(s.category);
    if (list) list.push(s);
    else groups.set(s.category, [s]);
  }
  return Array.from(groups, ([category, items]) => ({ category, skills: items }));
}

/**
 * Rough page-count estimate from character volume and line height. Used to warn
 * "this is spilling onto page 2" without rendering a PDF on every keystroke.
 * Deliberately approximate — the browser's print engine is the source of truth for pagination.
 */
export function estimatePages(resume: ResolvedResume): number {
  let chars = 0;
  for (const section of resume.sections) {
    if (!section.isVisible) continue;
    chars += section.heading.length + 40;
    for (const entry of section.entries) {
      if (!entry.isVisible) continue;
      chars += entry.title.length + entry.organization.length + 60;
      for (const b of entry.bullets) {
        if (b.isVisible) chars += b.text.length + 10;
      }
    }
    for (const g of groupSkills(section.skills)) {
      chars += g.category.length + g.names.join(", ").length + 20;
    }
  }

  // ~3800 characters fills a US Letter page at 10pt with 0.5in margins.
  const perPage = 3800 * (10 / Math.max(resume.style.baseSize, 6));
  return Math.max(1, Math.ceil(chars / perPage));
}
