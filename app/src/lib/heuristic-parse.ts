import { coerceMonthYear, type ParsedImport, ParsedImportSchema } from "./import-schema.ts";

/**
 * No-AI resume parser. Always available, always finishes — it exists so
 * import works with zero API key set. It is deliberately not clever: wrong
 * guesses are cheap because every parsed item goes through mandatory review
 * before it reaches the vault. Claude, when a key is present, is the better
 * parser; this is the floor, not the target.
 */

type EntryDraft = {
  sectionHeading: string;
  sectionType: "normal" | "skill";
  title: string;
  organization: string;
  subtitle: string;
  location: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
  url: string;
  information: string;
  bullets: { text: string }[];
};

/* ------------------------------------------------------------------ */
/* Section headers                                                     */
/* ------------------------------------------------------------------ */

/**
 * Headings that describe a list of skills rather than a list of things you did.
 *
 * This is the only classification left. The vault no longer has a fixed section
 * vocabulary to map onto — a heading is whatever the resume called it — but
 * skill sections genuinely hold a different shape of entry, so that one
 * distinction still has to be guessed.
 */
const SKILL_HEADING_RE =
  /\b(skills?|competenc|proficien|technolog|languages?|tools?|interests?|hobbies)\b/i;

/** Headings that are boilerplate, not content. */
const IGNORE_HEADING_RE =
  /^(about( me| us)?|profile|contact( information)?|references available|declaration)$/i;

/** Section headers common in resumes that aren't obviously title-case or caps. */
const TITLE_WORD_RE = /^[A-Z][a-z&]*$/;
const TITLE_EXCEPTION_RE = /^(and|of|the|&)$/i;

export type DetectedHeading = { heading: string; type: "normal" | "skill" };

/**
 * Detect a section header and return it VERBATIM.
 *
 * The heading the user wrote is the heading they get. Previously this mapped
 * onto a closed list of section types, which meant a resume saying "Side
 * Projects" or "Research" was filed as `custom` and lost its own name.
 */
function detectSectionHeader(line: string): DetectedHeading | null {
  if (line.length > 50) return null;
  const stripped = line.replace(/[:.]+$/, "").trim();
  if (!stripped || /[.,;]$/.test(stripped)) return null;

  // Digits rule a line out. Without this, "C.G.P.A: 8.9" reads as ALL CAPS and
  // becomes a spurious section header.
  if (/\d/.test(stripped)) return null;

  const letters = stripped.replace(/[^A-Za-z]/g, "");
  if (letters.length < 3) return null;

  const isAllCaps = letters === letters.toUpperCase();
  const isTitleCaseShort =
    !isAllCaps &&
    stripped.split(/\s+/).length <= 4 &&
    stripped.split(/\s+/).every((w) => TITLE_WORD_RE.test(w) || TITLE_EXCEPTION_RE.test(w));

  if (!isAllCaps && !isTitleCaseShort) return null;
  if (IGNORE_HEADING_RE.test(stripped)) return null;

  // Title-case lines are a weak signal — an entry's own job title looks the
  // same — so they only count when the words read like a section name.
  if (!isAllCaps && !/\b(experience|education|projects?|skills?|awards?|certifications?|publications?|summary|interests?|languages?|volunteer|leadership|courses?)\b/i.test(stripped)) {
    return null;
  }

  return {
    heading: stripped,
    type: SKILL_HEADING_RE.test(stripped) ? "skill" : "normal",
  };
}

/* ------------------------------------------------------------------ */
/* Bullets                                                              */
/* ------------------------------------------------------------------ */

const BULLET_RE = /^[-•*‣o]\s+/;

function isBulletLine(line: string): boolean {
  return BULLET_RE.test(line);
}

function stripBulletGlyph(line: string): string {
  return line.replace(BULLET_RE, "").trim();
}

/* ------------------------------------------------------------------ */
/* Dates                                                                */
/* ------------------------------------------------------------------ */

/**
 * Month names are spelled out rather than matched as "any 3–9 letters before a
 * year". The loose version swallowed ordinary words: "nutrition tracking app
 * 2026" parsed "app 2026" as a month/year pair, dropping "app" from the title
 * and yielding no date at all.
 */
const MONTH_NAMES = String.raw`(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)(?:[a-z]*)`;
const DATE_TOKEN = String.raw`(?:\d{1,2}\/\d{4}|${MONTH_NAMES}\.?\s+\d{4}|\d{4})`;
const RANGE_RE = new RegExp(
  `(${DATE_TOKEN})\\s*(?:-|–|—|to)\\s*(${DATE_TOKEN}|present|current|now)`,
  "i",
);
const SINGLE_DATE_RE = new RegExp(`\\b(${DATE_TOKEN})\\b`, "i");

type DateMatch = {
  matchedText: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
};

function extractDateRange(line: string): DateMatch | null {
  const range = line.match(RANGE_RE);
  if (range) {
    const endRaw = range[2]!;
    const isCurrent = /^(present|current|now)$/i.test(endRaw);
    return {
      matchedText: range[0],
      startDate: coerceMonthYear(range[1]),
      endDate: isCurrent ? "" : coerceMonthYear(endRaw),
      isCurrent,
    };
  }

  const single = line.match(SINGLE_DATE_RE);
  if (single) {
    return {
      matchedText: single[0],
      startDate: coerceMonthYear(single[1]),
      endDate: "",
      isCurrent: false,
    };
  }

  return null;
}

/* ------------------------------------------------------------------ */
/* Entry header split                                                  */
/* ------------------------------------------------------------------ */

/** Separators that surround a date or trail a field. Trimmed, never global-stripped. */
const EDGE_JUNK_RE = /^[\s|,\-–—·]+|[\s|,\-–—·]+$/g;

function trimEdges(s: string): string {
  return s.replace(EDGE_JUNK_RE, "").replace(/\s+/g, " ").trim();
}

/**
 * Split a header line into the "title, organization" half and the location.
 *
 * The date is always the pivot: what precedes it names the thing, what follows
 * it (after a `|`) is where it happened. Critically, punctuation is preserved —
 * an earlier version stripped every comma and pipe from the whole line before
 * splitting, which destroyed the very delimiter the title/org split depends on
 * and left `organization` empty for every entry.
 */
function splitHeaderLine(
  line: string,
  dateMatch: DateMatch | null,
): { titleOrg: string; location: string } {
  // A tab marks a column break the PDF extractor detected — in LaTeX templates
  // that's exactly where location or dates were pushed to the right margin.
  // Trusting it beats inferring the boundary from punctuation.
  if (line.includes("\t")) {
    const [left, ...rest] = line.split("\t");
    const right = trimEdges(rest.join(" "));
    const leftTrimmed = trimEdges(left ?? "");

    if (dateMatch) {
      // The right column held the dates; anything left of them is the name.
      const withoutDate = right.replace(dateMatch.matchedText, "").trim();
      return { titleOrg: leftTrimmed, location: trimEdges(withoutDate) };
    }
    return { titleOrg: leftTrimmed, location: right };
  }

  if (!dateMatch) return { titleOrg: trimEdges(line), location: "" };

  const idx = line.indexOf(dateMatch.matchedText);
  if (idx === -1) return { titleOrg: trimEdges(line), location: "" };

  return {
    titleOrg: trimEdges(line.slice(0, idx)),
    location: trimEdges(line.slice(idx + dateMatch.matchedText.length)),
  };
}

/**
 * Split on the *first* delimiter only. "Agilite Global Solutions Company, LLC"
 * contains a comma of its own; splitting on every comma would truncate it.
 */
function splitTitleRest(text: string): { title: string; rest: string } {
  const match = text.match(/,|\||\s+\bat\b\s+/i);
  if (!match || match.index === undefined) {
    return { title: text.trim(), rest: "" };
  }
  const title = text.slice(0, match.index).trim();
  const rest = text.slice(match.index + match[0].length).trim();
  return title ? { title, rest } : { title: text.trim(), rest: "" };
}

/**
 * Headings whose entries name an employer or institution, rather than being
 * self-describing. Used only to decide whether the text after the first comma
 * is an organization or a subtitle — a guess the user can correct in review.
 */
const ORG_HEADING_RE =
  /\b(experience|employment|work|education|certification|award|course|organi[sz]ation|volunteer|leadership)\b/i;

function makeEntryDraft(
  section: DetectedHeading,
  line: string,
  dateMatch: DateMatch | null,
): EntryDraft {
  const { titleOrg, location } = splitHeaderLine(line, dateMatch);
  const { title, rest } = splitTitleRest(titleOrg);

  // Where a section names employers, the text after the first comma is one.
  // Elsewhere ("GoLlama, Distributed LLM inference system built in Go") it's a
  // description and belongs in subtitle rather than being mislabelled.
  const hasOrg = ORG_HEADING_RE.test(section.heading);

  return {
    sectionHeading: section.heading,
    sectionType: section.type,
    title: title || titleOrg || "Untitled",
    organization: hasOrg ? rest : "",
    subtitle: hasOrg ? "" : rest,
    location,
    startDate: dateMatch?.startDate ?? "",
    endDate: dateMatch?.endDate ?? "",
    isCurrent: dateMatch?.isCurrent ?? false,
    url: "",
    information: "",
    bullets: [],
  };
}

/**
 * A skills line becomes one entry per category group.
 *
 * "Languages - Java | C#, Frameworks - Spring Boot" is two entries: "Languages"
 * holding "Java | C#", and "Frameworks" holding "Spring Boot". That's exactly
 * the shape the vault stores and the resume renders, so import and hand-entry
 * produce identical results.
 */
function skillEntriesFromLine(section: DetectedHeading, line: string): EntryDraft[] {
  const out: EntryDraft[] = [];

  for (const group of line.split(CATEGORY_GROUP_SPLIT_RE)) {
    const trimmed = group.trim();
    if (!trimmed) continue;

    const match = trimmed.match(CATEGORY_PREFIX_RE);
    // No label means the whole line is one undifferentiated list; the section
    // heading becomes the label so the entry still has a name.
    const title = match ? match[1]!.trim() : section.heading;
    const information = match ? match[2]!.trim() : trimmed;
    if (!information) continue;

    out.push({
      sectionHeading: section.heading,
      sectionType: "skill",
      title,
      organization: "",
      subtitle: "",
      location: "",
      startDate: "",
      endDate: "",
      isCurrent: false,
      url: "",
      information,
      bullets: [],
    });
  }

  return out;
}

/* ------------------------------------------------------------------ */
/* Skills                                                               */
/* ------------------------------------------------------------------ */

/** A "Label —" / "Label -" / "Label:" prefix that opens a category group. */
const CATEGORY_PREFIX_RE = /^([A-Za-z][A-Za-z&/\- ]{1,44}?)\s*(?:[—–:]|\s-)\s+(.+)$/;

/**
 * Commas that start a *new* category group, as opposed to commas separating
 * skills inside one. Only a comma followed by `Label -` counts.
 *
 * This is what one real line looks like:
 *
 *   Languages - Java | C#, Frameworks - Spring Boot | Hibernate, Databases - MySQL
 *
 * Splitting naively on every comma and reading the category from the first
 * chunk only put all 14 skills under "Languages" and turned the labels
 * themselves into skills named "Frameworks - Spring Boot".
 */
const CATEGORY_GROUP_SPLIT_RE = /,\s*(?=[A-Za-z][A-Za-z&/\- ]{1,44}?\s*(?:[—–:]|\s-)\s+)/;

/* ------------------------------------------------------------------ */
/* Contact block                                                        */
/* ------------------------------------------------------------------ */

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/;
/** Handles "(202) 509-6272", "+1 202-509-6272", "202.509.6272". */
const PHONE_RE = /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}/;
const DOMAIN_RE = /^(?:https?:\/\/)?(?:www\.)?[\w-]+(?:\.[\w-]+)+(?:\/\S*)?$/i;

/**
 * The contact block is usually one or two lines of pipe-separated fields, so
 * each line has to be split before classifying. Scanning whole lines meant the
 * first match won and everything after it on that line was dropped — which is
 * why phone and location came back empty from a line that plainly contained both.
 */
function parseContactBlock(lines: string[]) {
  if (lines.length === 0) return undefined;

  let fullName = "";
  let email = "";
  let phone = "";
  let location = "";
  const links: { label: string; url: string }[] = [];

  const fields = lines.flatMap((line) =>
    line.split(/[|•·]|\s{3,}/).map((f) => f.trim()).filter(Boolean),
  );

  for (const field of fields) {
    if (!email) {
      const m = field.match(EMAIL_RE);
      if (m) {
        email = m[0];
        continue;
      }
    }

    if (/linkedin\.com/i.test(field)) {
      links.push({ label: "LinkedIn", url: field });
      continue;
    }
    if (/github\.com/i.test(field)) {
      links.push({ label: "GitHub", url: field });
      continue;
    }

    if (!phone) {
      const m = field.match(PHONE_RE);
      if (m) {
        phone = m[0].trim();
        continue;
      }
    }

    if (DOMAIN_RE.test(field)) {
      links.push({ label: "Website", url: field });
      continue;
    }

    // A comma and no digits reads as "City, State, Country".
    if (!location && field.includes(",") && !/\d/.test(field)) {
      location = field;
      continue;
    }

    // First unclassified field is, by resume convention, the person's name.
    if (!fullName) fullName = field;
  }

  return { fullName, email, phone, location, summary: "", links };
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

/**
 * Parse plain resume text with no AI. When `forcedSectionType` is set (the
 * "paste into one section" path), header detection is skipped entirely and
 * every line is treated as body content of that one section.
 */
export function parseResumeHeuristically(
  text: string,
  forcedSection?: DetectedHeading,
): ParsedImport {
  const lines = text.split(/\r?\n/).map((l) => l.trim());

  let currentSection: DetectedHeading | null = forcedSection ?? null;
  let currentEntry: EntryDraft | null = null;
  let inContactBlock = !forcedSection;

  const entries: EntryDraft[] = [];
  const contactLines: string[] = [];

  function flushEntry() {
    if (currentEntry && currentEntry.title) entries.push(currentEntry);
    currentEntry = null;
  }

  for (const line of lines) {
    if (!line) continue;

    if (!forcedSection) {
      const header = detectSectionHeader(line);
      if (header) {
        flushEntry();
        currentSection = header;
        inContactBlock = false;
        continue;
      }
    }

    if (inContactBlock) {
      contactLines.push(line);
      continue;
    }

    if (!currentSection) continue;
    const section = currentSection;

    if (isBulletLine(line)) {
      const bulletText = stripBulletGlyph(line);
      if (!bulletText) continue;
      if (section.type === "skill") {
        entries.push(...skillEntriesFromLine(section, bulletText));
      } else if (currentEntry) {
        currentEntry.bullets.push({ text: bulletText });
      }
      continue;
    }

    /*
     * Wrapped bullet continuations.
     *
     * A long bullet in a PDF spans several lines, and only the first carries a
     * glyph:
     *
     *   • Built backend services for the payments hub, supporting reliable
     *   processing of high-volume international transactions
     *
     * Read line-by-line the second line looks like a new entry titled "processing
     * of high-volume…". The tell is that the previous bullet didn't finish its
     * sentence — no terminal punctuation — and this line starts mid-thought.
     *
     * Both conditions are needed. Lowercase alone would swallow "nuBoF | AI-Powered
     * Nutrition Tracking App", a real project title that happens to start lowercase.
     */
    if (currentEntry && currentEntry.bullets.length > 0 && !line.includes("\t")) {
      const last = currentEntry.bullets[currentEntry.bullets.length - 1]!;
      const unfinished = !/[.!?:]$/.test(last.text.trim());
      const startsMidSentence = /^[a-z0-9(]/.test(line);

      if (unfinished && startsMidSentence) {
        last.text = `${last.text} ${line}`.replace(/\s+/g, " ").trim();
        continue;
      }
    }

    // "C.G.P.A: 8.9" and friends annotate the entry above rather than starting
    // a new one. Checked before the date branch so a GPA's digits don't read
    // as a year.
    const annotation = line.match(/^([A-Za-z][A-Za-z.\s]{1,24}):\s*(\S.*)$/);
    if (annotation && currentEntry && currentEntry.bullets.length === 0) {
      const note = `${annotation[1]!.trim()}: ${annotation[2]!.trim()}`;
      currentEntry.subtitle = currentEntry.subtitle
        ? `${currentEntry.subtitle} · ${note}`
        : note;
      continue;
    }

    // A skills section has no dates or entries — every line is a list.
    if (section.type === "skill") {
      /*
       * Skill lines wrap too:
       *
       *   AI and Tools: Prompt Engineering, LLM API integration, ... Vercel
       *   AI SDK, llama.cpp
       *
       * The second line has no "Label:" prefix, so it belongs to the entry
       * above rather than starting a new one. Without this, half of a skills
       * list becomes a phantom entry titled after whatever the wrap landed on.
       */
      const isLabelled = CATEGORY_PREFIX_RE.test(line);
      const previousSkill = entries[entries.length - 1];

      if (
        !isLabelled &&
        previousSkill &&
        previousSkill.sectionType === "skill" &&
        previousSkill.sectionHeading === section.heading
      ) {
        previousSkill.information = `${previousSkill.information}, ${line}`
          .replace(/,\s*,/g, ",")
          .replace(/\s+/g, " ")
          .trim();
        continue;
      }

      entries.push(...skillEntriesFromLine(section, line));
      continue;
    }

    const dateMatch = extractDateRange(line);
    if (dateMatch) {
      const { titleOrg, location } = splitHeaderLine(line, dateMatch);

      /*
       * Two-line entry headers, as used by the Deedy / Awesome-CV family:
       *
       *   Accenture                       Hyderabad, India
       *   Software Engineer          October 2022 – July 2025
       *
       * The employer and location come first, the role and dates second. Read
       * naively that's two entries — one titled "Accenture" with no dates, then
       * another titled "Software Engineer". Folding them together when the
       * previous entry has no dates and no bullets yet recovers the real shape.
       */
      const previous = currentEntry;
      if (
        titleOrg &&
        previous &&
        previous.bullets.length === 0 &&
        !previous.startDate &&
        !previous.endDate &&
        !previous.isCurrent
      ) {
        const orgFromAbove = previous.title;
        const locationFromAbove = previous.location || previous.organization;

        currentEntry = makeEntryDraft(section, line, dateMatch);
        currentEntry.organization = orgFromAbove;
        currentEntry.location = location || locationFromAbove;
        continue;
      }

      if (titleOrg) {
        flushEntry();
        currentEntry = makeEntryDraft(section, line, dateMatch);
      } else if (
        currentEntry &&
        !currentEntry.startDate &&
        !currentEntry.endDate &&
        !currentEntry.isCurrent
      ) {
        currentEntry.startDate = dateMatch.startDate;
        currentEntry.endDate = dateMatch.endDate;
        currentEntry.isCurrent = dateMatch.isCurrent;
      }
      continue;
    }

    if (currentEntry && !currentEntry.organization && currentEntry.bullets.length === 0) {
      currentEntry.organization = line;
    } else {
      flushEntry();
      currentEntry = makeEntryDraft(section, line, null);
    }
  }
  flushEntry();

  return ParsedImportSchema.parse({
    profile: parseContactBlock(contactLines),
    entries,
  });
}
