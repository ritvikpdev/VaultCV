import { findAliasSeed, normalizeTerm } from "./skill-aliases.ts";

/**
 * Turning a written skill line into something matchable.
 *
 * You write skills the way they appear on a resume — a label plus a list:
 *
 *     Languages      Java | C# | Python | JavaScript
 *
 * That reads well and is useless for answering "does this person know
 * Kubernetes?". This splits the list into individual technologies and resolves
 * each through the alias taxonomy, so the tuner can answer that question
 * without an API key and without string luck.
 *
 * The split is deliberately generous about separators, because nobody types a
 * skills list consistently — pipes, commas, bullets and slashes all appear.
 */

export type ExtractedSkill = {
  /** Canonical name if the taxonomy recognised it, else exactly as written. */
  name: string;
  /** Alternate spellings a job description might use. */
  aliases: string[];
};

/** Separators people actually use between skills. */
const SPLIT_RE = /[,|•·;\n]+|\s+\/\s+/;

/**
 * Strip the light HTML a rich-text field produces, without pulling in a parser.
 * `<li>` and `<br>` become separators so a bulleted list splits correctly
 * instead of collapsing into one run-on skill.
 */
function stripHtml(input: string): string {
  return input
    .replace(/<\/(li|p|div)>/gi, ",")
    .replace(/<br\s*\/?>/gi, ",")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

export function extractSkills(information: string): ExtractedSkill[] {
  const text = stripHtml(information ?? "");
  const seen = new Set<string>();
  const out: ExtractedSkill[] = [];

  for (const raw of text.split(SPLIT_RE)) {
    const token = raw.trim().replace(/^[-–—*]\s*/, "");
    // One character is never a skill; 60 means the line wasn't really a list.
    if (token.length < 2 || token.length > 60) continue;

    const seed = findAliasSeed(token);
    const name = seed?.canonical ?? token;
    const key = normalizeTerm(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);

    out.push({ name, aliases: seed?.aliases ?? [] });
  }

  return out;
}

/**
 * The skills line split into the pieces the user wrote, for the chip editor.
 *
 * Unlike `extractSkills` this neither canonicalises ("k8s" stays "k8s") nor
 * drops short tokens: the chip editor writes its chips back as the whole line,
 * so anything filtered here would be deleted from the vault on the next save —
 * "C" is a language. Only exact repeats (ignoring case) are folded.
 */
export function splitSkillTokens(information: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const raw of stripHtml(information ?? "").split(SPLIT_RE)) {
    const token = raw.trim().replace(/^[-–—*]\s*/, "");
    const key = token.toLowerCase();
    if (!token || seen.has(key)) continue;
    seen.add(key);
    out.push(token);
  }

  return out;
}

/** Chips back to the stored line. Pipes, because that is how the line prints. */
export function joinSkillTokens(tokens: string[]): string {
  return tokens.join(" | ");
}

/**
 * Render extracted skills back to a display string, for the resume line and
 * for pre-filling the editor. Kept next to the parser so the round trip stays
 * obvious: what you typed is what you get back.
 */
export function formatSkillList(skills: ExtractedSkill[]): string {
  return skills.map((s) => s.name).join(" | ");
}
