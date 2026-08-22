import type { JdParsed, JdRequirement, SectionType } from "../db/schema.ts";
import { normalizeTerm, SKILL_ALIAS_SEEDS } from "./skill-aliases.ts";

/**
 * Deterministic job-description parsing.
 *
 * This is the PRIMARY path, not a fallback. v1 put a small local model in front
 * of JD extraction, and when it produced unusable JSON the whole tuner degraded
 * to a regex parser that nobody had designed. Here the regex parser IS the
 * design: it always runs, needs no key, and returns something useful. Claude
 * refines the result when a key exists — it never gates it.
 */

/** Bulleted or numbered requirement lines — how JDs actually list them. */
const BULLET_RE = /^\s*(?:[-•*‣●○▪]|\d+[.)])\s+/;

const MUST_MARKERS = [
  "required", "must have", "must-have", "minimum", "you have", "you will need",
  "essential", "at least", "proven", "demonstrated", "strong",
];

const NICE_MARKERS = [
  "nice to have", "nice-to-have", "preferred", "bonus", "plus", "desirable",
  "a plus", "ideally", "familiarity with", "exposure to",
];

/** Headings that flip the default requirement kind for everything beneath. */
const SECTION_MUST = /^(requirements?|qualifications?|what you.{0,4}ll need|minimum qualifications?|basic qualifications?|who you are|must have)/i;
const SECTION_NICE = /^(nice to have|preferred|bonus|desirable|preferred qualifications?|plus(es)?)/i;
const SECTION_IGNORE = /^(about (us|the (company|team|role))|benefits?|perks?|compensation|salary|equal opportunity|diversity|how to apply|what we offer)/i;

const SOFT_TERMS = [
  "communication", "collaborat", "team", "leadership", "mentor", "stakeholder",
  "ownership", "self-starter", "problem solving", "problem-solving", "agile",
];

const DOMAIN_TERMS = [
  "fintech", "healthcare", "banking", "payments", "e-commerce", "ecommerce",
  "logistics", "security", "compliance", "saas", "b2b", "enterprise",
];

const SENIORITY_PATTERNS: Array<[RegExp, string]> = [
  [/\b(intern|internship)\b/i, "intern"],
  [/\b(junior|entry[- ]level|graduate|new grad|associate)\b/i, "junior"],
  [/\b(senior|sr\.?)\b/i, "senior"],
  [/\b(staff|principal|lead|architect)\b/i, "staff+"],
  [/\b(manager|director|head of|vp)\b/i, "management"],
];

/** Every skill term the taxonomy knows, longest first so "MS SQL Server" wins over "SQL". */
const ALL_SKILL_TERMS: Array<{ term: string; canonical: string }> = SKILL_ALIAS_SEEDS
  .flatMap((seed) => [
    { term: normalizeTerm(seed.canonical), canonical: seed.canonical },
    ...seed.aliases.map((a) => ({ term: normalizeTerm(a), canonical: seed.canonical })),
  ])
  .sort((a, b) => b.term.length - a.term.length);

/** Skills named anywhere in the text, canonicalized and de-duplicated. */
export function extractSkillTerms(text: string): string[] {
  const haystack = ` ${normalizeTerm(text).replace(/[^a-z0-9+#./ -]/g, " ")} `;
  const found = new Set<string>();

  for (const { term, canonical } of ALL_SKILL_TERMS) {
    if (found.has(canonical)) continue;
    // Word-ish boundaries: "go" must not match inside "goal", but "c#" and
    // "node.js" have to survive, so the boundary is space-delimited rather than \b.
    if (haystack.includes(` ${term} `) || haystack.includes(` ${term},`)) {
      found.add(canonical);
    }
  }

  return [...found];
}

function classify(line: string): JdRequirement["category"] {
  const lower = line.toLowerCase();
  if (extractSkillTerms(line).length > 0) return "technical";
  if (SOFT_TERMS.some((t) => lower.includes(t))) return "soft";
  if (DOMAIN_TERMS.some((t) => lower.includes(t))) return "domain";
  if (/\b\d+\+?\s*(years?|yrs?)\b/i.test(line)) return "experience";
  return "technical";
}

function detectKind(line: string, sectionDefault: JdRequirement["kind"]): JdRequirement["kind"] {
  const lower = line.toLowerCase();
  if (NICE_MARKERS.some((m) => lower.includes(m))) return "nice_to_have";
  if (MUST_MARKERS.some((m) => lower.includes(m))) return "must_have";
  return sectionDefault;
}

/**
 * Terms a vault bullet could plausibly contain to satisfy this requirement.
 * Canonical skill names plus a few content words — enough for the matcher to
 * find evidence without matching on "and".
 */
function termsFor(line: string): string[] {
  const skills = extractSkillTerms(line);
  const words = normalizeTerm(line)
    .split(/[^a-z0-9+#.]+/)
    .filter((w) => w.length > 4 && !STOPWORDS.has(w));

  return [...new Set([...skills.map(normalizeTerm), ...words])].slice(0, 12);
}

const STOPWORDS = new Set([
  "about", "across", "should", "would", "their", "there", "these", "those",
  "which", "while", "within", "using", "with", "have", "years", "experience",
  "working", "ability", "strong", "including", "related", "similar", "other",
  "will", "your", "yours", "team", "teams", "role", "roles", "work",
]);

/** Roughly how much this role cares about each vault section. */
function sectionWeights(text: string, seniority: string): Partial<Record<SectionType, number>> {
  const lower = text.toLowerCase();
  const isEarlyCareer = seniority === "intern" || seniority === "junior";

  return {
    experience: 1,
    project: isEarlyCareer ? 0.9 : /\b(portfolio|side project|open source|github)\b/.test(lower) ? 0.7 : 0.5,
    skill: 0.9,
    education: isEarlyCareer ? 0.7 : 0.3,
    certification: /\b(certif|aws certified|pmp|cissp)\b/.test(lower) ? 0.6 : 0.2,
    publication: /\b(research|publication|paper|phd)\b/.test(lower) ? 0.6 : 0.1,
    award: 0.2,
    organization: 0.1,
    volunteer: 0.1,
  };
}

export function parseJobDescriptionHeuristically(text: string): JdParsed {
  const lines = text.split(/\r?\n/).map((l) => l.trim());

  let sectionDefault: JdRequirement["kind"] = "must_have";
  let ignoring = false;
  const requirements: JdRequirement[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    if (!line) continue;

    // Short, unpunctuated lines act as headings and set the default kind for
    // everything under them — that's how JDs separate must-haves from nice-to-haves.
    const isHeading = line.length < 60 && !BULLET_RE.test(line) && !/[.;]$/.test(line);
    if (isHeading) {
      if (SECTION_IGNORE.test(line)) {
        ignoring = true;
        continue;
      }
      if (SECTION_NICE.test(line)) {
        sectionDefault = "nice_to_have";
        ignoring = false;
        continue;
      }
      if (SECTION_MUST.test(line)) {
        sectionDefault = "must_have";
        ignoring = false;
        continue;
      }
    }

    if (ignoring) continue;

    // Only bulleted lines become requirements. Prose paragraphs in a JD are
    // almost always company boilerplate, and treating them as requirements
    // floods the diff with noise.
    if (!BULLET_RE.test(line)) continue;

    const body = line.replace(BULLET_RE, "").trim();
    if (body.length < 8) continue;

    const key = normalizeTerm(body).slice(0, 80);
    if (seen.has(key)) continue;
    seen.add(key);

    requirements.push({
      id: `r${requirements.length + 1}`,
      text: body.slice(0, 300),
      kind: detectKind(body, sectionDefault),
      category: classify(body),
      terms: termsFor(body),
    });
  }

  const seniority =
    SENIORITY_PATTERNS.find(([re]) => re.test(text))?.[1] ?? "mid";

  // First non-empty line is conventionally the job title.
  const firstLine = lines.find(Boolean) ?? "";
  const roleMatch = firstLine.match(/^([A-Z][\w /&+-]{2,60})/);

  return {
    role: roleMatch?.[1]?.trim() ?? "",
    company: text.match(/\bat\s+([A-Z][\w&.\- ]{2,40})/)?.[1]?.trim() ?? "",
    seniority,
    requirements: requirements.slice(0, 40),
    keywords: extractSkillTerms(text),
    sectionWeights: sectionWeights(text, seniority),
    source: "heuristic",
  };
}
