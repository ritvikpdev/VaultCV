import { z } from "zod";

/**
 * The contract both parsers (Claude and the heuristic fallback) must produce.
 * Validated with Zod regardless of source — never trust a parsed blob just
 * because it came back as JSON.
 */
export const ParsedBulletSchema = z.object({
  text: z.string().trim().min(1).max(1000),
});

export const ParsedEntrySchema = z.object({
  /**
   * The heading exactly as the resume wrote it — "WORK EXPERIENCE", "Side
   * Projects", anything. The vault no longer has a fixed vocabulary to map
   * onto, so the resume's own words are what create or match a section.
   */
  sectionHeading: z.string().trim().min(1).max(60).default("Other"),
  /** The only structural distinction: bullets-and-dates, or a skills list. */
  sectionType: z.enum(["normal", "skill"]).default("normal"),
  title: z.string().trim().min(1).max(200),
  /** Skill entries only: the sub-skills list. */
  information: z.string().trim().max(2000).default(""),
  organization: z.string().trim().max(200).default(""),
  /**
   * The italic line under the title. In sections that carry no organization
   * (projects, publications) the text after the first comma is a description,
   * not an employer, and belongs here instead.
   */
  subtitle: z.string().trim().max(300).default(""),
  location: z.string().trim().max(160).default(""),
  /** "MM/YYYY", "YYYY", or "". Run raw dates through `coerceMonthYear` first. */
  startDate: z.string().trim().max(10).default(""),
  endDate: z.string().trim().max(10).default(""),
  isCurrent: z.boolean().default(false),
  url: z.string().trim().max(500).default(""),
  bullets: z.array(ParsedBulletSchema).max(30).default([]),
});

/**
 * Skills are no longer a separate top-level list. A skills line on a resume
 * ("Languages — Java | C# | Python") becomes an ENTRY in a skill-type section,
 * with "Languages" as the title and the rest as `information`. That matches how
 * the vault stores them, so import and manual entry produce the same shape.
 */

export const ParsedLinkSchema = z.object({
  label: z.string().trim().max(60),
  url: z.string().trim().max(300),
});

export const ParsedProfileSchema = z
  .object({
    fullName: z.string().trim().max(120),
    email: z.string().trim().max(200),
    phone: z.string().trim().max(60),
    location: z.string().trim().max(160),
    summary: z.string().trim().max(4000),
    links: z.array(ParsedLinkSchema).max(8),
  })
  .partial()
  .optional();

export const ParsedImportSchema = z.object({
  profile: ParsedProfileSchema,
  entries: z.array(ParsedEntrySchema).max(80).default([]),
});

export type ParsedBullet = z.infer<typeof ParsedBulletSchema>;
export type ParsedEntry = z.infer<typeof ParsedEntrySchema>;
export type ParsedProfile = z.infer<typeof ParsedProfileSchema>;
export type ParsedImport = z.infer<typeof ParsedImportSchema>;

const MONTHS: Record<string, string> = {
  jan: "01", january: "01",
  feb: "02", february: "02",
  mar: "03", march: "03",
  apr: "04", april: "04",
  may: "05",
  jun: "06", june: "06",
  jul: "07", july: "07",
  aug: "08", august: "08",
  sep: "09", sept: "09", september: "09",
  oct: "10", october: "10",
  nov: "11", november: "11",
  dec: "12", december: "12",
};

/**
 * Normalize whatever date shape a parser hands back into "MM/YYYY", or "" if
 * it can't be read. Shared by the heuristic parser and the Claude response —
 * neither is trusted to emit the exact format on its own.
 */
export function coerceMonthYear(raw: string | null | undefined): string {
  const s = (raw ?? "").trim();
  if (!s) return "";

  // Already "MM/YYYY".
  if (/^(0[1-9]|1[0-2])\/\d{4}$/.test(s)) return s;

  // "YYYY-MM" (ISO-ish).
  const iso = s.match(/^(\d{4})-(0[1-9]|1[0-2])$/);
  if (iso) return `${iso[2]}/${iso[1]}`;

  // "Month YYYY" or "Mon YYYY" or "Mon. YYYY".
  const named = s.match(/^([A-Za-z]+)\.?\s+(\d{4})$/);
  if (named) {
    const month = MONTHS[named[1]!.toLowerCase()];
    if (month) return `${month}/${named[2]}`;
  }

  // Bare year — kept as-is. Defaulting to January would invent a month that
  // isn't in the source; projects legitimately carry a year with no month, and
  // the vault's date field accepts "YYYY" for exactly this case.
  if (/^\d{4}$/.test(s)) return s;

  return "";
}
