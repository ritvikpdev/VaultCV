import type { SectionOptions } from "../db/schema.ts";
import {
  groupSkills,
  type ResolvedEntry,
  type ResolvedResume,
} from "./resume-model.ts";

/**
 * A resume flattened into the units a page break may fall between.
 *
 * Pagination needs something to measure and distribute. Making that a flat
 * block list — rather than paginating a nested section/entry/bullet tree —
 * keeps the layout rule in one place and means the preview and the PDF are
 * reasoning about the same atoms.
 *
 * The atom is one entry *with its bullets*. Breaking mid-entry leaves a job
 * title stranded at the bottom of a page, which is the one pagination artifact
 * that actually looks broken on a resume.
 */
export type ResumeBlock =
  | { kind: "header"; key: string }
  | { kind: "summary"; key: string; text: string }
  | { kind: "heading"; key: string; sectionId: number; heading: string }
  | {
      kind: "entry";
      key: string;
      sectionId: number;
      entry: ResolvedEntry;
      options: SectionOptions;
    }
  | {
      kind: "skills";
      key: string;
      sectionId: number;
      groups: Array<{ category: string; names: string[] }>;
      options: SectionOptions;
    }
  | { kind: "pageBreak"; key: string };

/**
 * An entry worth printing: something in its title line or a visible bullet.
 * A freshly added, still-empty entry is skipped, so it appears in the preview
 * with the first thing typed into it rather than as a blank line.
 */
export function hasContent(entry: ResolvedEntry): boolean {
  return Boolean(
    entry.title.trim() ||
      entry.organization.trim() ||
      entry.bullets.some((b) => b.isVisible && b.text.trim()),
  );
}

export function buildBlocks(resume: ResolvedResume): ResumeBlock[] {
  const blocks: ResumeBlock[] = [{ kind: "header", key: "header" }];

  if (resume.summary.trim()) {
    blocks.push({ kind: "summary", key: "summary", text: resume.summary });
  }

  for (const section of resume.sections) {
    if (!section.isVisible) continue;

    if (section.layout === "skill") {
      const groups = groupSkills(section.skills);
      // An empty section would otherwise print a heading with nothing under it.
      if (groups.length === 0) continue;

      blocks.push({
        kind: "heading",
        key: `h-${section.id}`,
        sectionId: section.id,
        heading: section.heading,
      });
      blocks.push({
        kind: "skills",
        key: `s-${section.id}`,
        sectionId: section.id,
        groups,
        options: section.options,
      });
    } else {
      const entries = section.entries.filter((e) => e.isVisible && hasContent(e));
      if (entries.length === 0) continue;

      blocks.push({
        kind: "heading",
        key: `h-${section.id}`,
        sectionId: section.id,
        heading: section.heading,
      });

      for (const entry of entries) {
        blocks.push({
          kind: "entry",
          key: `e-${entry.id}`,
          sectionId: section.id,
          entry,
          options: section.options,
        });
      }
    }

    if (section.pageBreakAfter) {
      blocks.push({ kind: "pageBreak", key: `pb-${section.id}` });
    }
  }

  return blocks;
}

/** Points of usable height on one page, after margins. */
export function pageContentHeightPt(style: ResolvedResume["style"]): number {
  // 1in = 72pt. Letter is 11in tall, A4 is 297mm ≈ 11.69in.
  const pageInches = style.pageSize === "a4" ? 11.69 : 11;
  return (pageInches - style.marginY * 2) * 72;
}

export function pageWidthIn(style: ResolvedResume["style"]): number {
  return style.pageSize === "a4" ? 8.27 : 8.5;
}

/**
 * Distribute measured blocks across pages.
 *
 * `heights` is keyed by block key, in the same units as `capacity`.
 *
 * Two rules beyond "fill until full":
 *  - a section heading never ends a page alone; it moves down with its first
 *    entry, because a heading orphaned at a page foot reads as a mistake
 *  - a block taller than a whole page gets its own page rather than looping
 *    forever trying to fit it
 */
export function paginate(
  blocks: ResumeBlock[],
  heights: Record<string, number>,
  capacity: number,
): ResumeBlock[][] {
  if (capacity <= 0) return [blocks];

  const pages: ResumeBlock[][] = [[]];
  let used = 0;

  const push = (block: ResumeBlock, height: number) => {
    pages[pages.length - 1]!.push(block);
    used += height;
  };

  const newPage = () => {
    pages.push([]);
    used = 0;
  };

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!;

    if (block.kind === "pageBreak") {
      if (pages[pages.length - 1]!.length > 0) newPage();
      continue;
    }

    const height = heights[block.key] ?? 0;

    // Keep a heading with whatever follows it.
    if (block.kind === "heading") {
      const next = blocks[i + 1];
      const pairHeight = height + (next ? (heights[next.key] ?? 0) : 0);

      if (used > 0 && used + pairHeight > capacity) newPage();
      push(block, height);
      continue;
    }

    if (used > 0 && used + height > capacity) newPage();
    push(block, height);
  }

  return pages.filter((p) => p.length > 0);
}
