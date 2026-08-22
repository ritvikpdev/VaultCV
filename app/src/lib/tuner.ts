import type {
  JdParsed,
  JdRequirement,
  Recommendation,
  SectionType,
  VaultBullet,
  VaultEntry,
  VaultSkill,
} from "../db/schema.ts";
import type { ResolvedResume } from "./resume-model.ts";
import { matchTermsFor, normalizeTerm, SKILL_ALIAS_SEEDS } from "./skill-aliases.ts";

/**
 * The tuner engine.
 *
 * Scores vault content against a parsed JD, then diffs the result against
 * what's already on the resume. Deterministic and instant — no embeddings, no
 * precomputation step, no API key. v1 made this depend on generated vectors and
 * silently returned nothing when they were missing; the rule here is that it
 * always returns something explicable.
 *
 * Output is an ADVISORY list. Every row says what to change and which
 * requirement it covers, and nothing is applied without a click.
 */

export type ScoredBullet = {
  bullet: VaultBullet;
  entry: VaultEntry;
  score: number;
  coveredRequirementIds: string[];
  matchedTerms: string[];
};

/** Terms that name a real technology, rather than describing one in prose. */
const SKILL_TERMS = new Set(
  SKILL_ALIAS_SEEDS.flatMap((s) => [
    normalizeTerm(s.canonical),
    ...s.aliases.map(normalizeTerm),
  ]),
);

/**
 * How well `text` satisfies a requirement described by `terms`, 0–1.
 *
 * Matching a named technology is sufficient evidence on its own. Requiring a
 * *proportion* of terms was wrong, and wrong in a way that got worse the better
 * the JD was written: a requirement phrased "relational databases and SQL query
 * optimization" yields terms like ["sql", "relational databases", "query
 * optimization"], and a bullet saying "parameterized SQL queries" matched only
 * "sql" — one short term out of three long ones, scoring 0.14 against a 0.34
 * threshold. A direct hit on the actual technology was rejected because the
 * requirement had described itself thoroughly.
 *
 * So: any hit on a known skill term floors the score above threshold.
 * Proportional scoring still applies to prose requirements with no technology
 * to anchor on ("experience mentoring engineers"), where breadth of overlap
 * genuinely is the signal.
 */
function termOverlap(text: string, terms: string[]): { score: number; matched: string[] } {
  if (terms.length === 0) return { score: 0, matched: [] };

  const haystack = ` ${normalizeTerm(text)} `;
  const matched: string[] = [];
  let weight = 0;
  let total = 0;
  let skillHit = false;

  for (const term of terms) {
    if (!term) continue;

    // Longer terms are more specific, so a hit on "container orchestration"
    // counts for more than a hit on "apis".
    const w = Math.min(3, Math.max(1, term.length / 6));
    total += w;

    const hit =
      haystack.includes(` ${term} `) ||
      haystack.includes(` ${term},`) ||
      haystack.includes(` ${term}.`) ||
      haystack.includes(` ${term}s `);

    if (hit) {
      matched.push(term);
      weight += w;
      if (SKILL_TERMS.has(term)) skillHit = true;
    }
  }

  const proportional = total === 0 ? 0 : weight / total;
  // 0.7 rather than 1.0: a named-technology hit clears the bar decisively but
  // still ranks below a bullet that matches the requirement comprehensively.
  return { score: skillHit ? Math.max(proportional, 0.7) : proportional, matched };
}

/**
 * Score every vault bullet against every requirement.
 *
 * A bullet's score is the best single requirement it satisfies, plus a small
 * bonus for covering several — a bullet that speaks to three requirements is
 * worth more than one that nails a single one, but not three times as much.
 */
/**
 * How much a section counts for this role, from its heading text.
 *
 * Section types used to be a closed list, so weights could be looked up.
 * Headings are now whatever the user wrote, so this reads the words instead.
 * An unrecognised heading gets a neutral 0.6 rather than being penalised —
 * "Research" or "Open Source" shouldn't rank last just because the app didn't
 * anticipate the name.
 */
export function weightForHeading(
  heading: string,
  weights: JdParsed["sectionWeights"],
): number {
  const h = heading.toLowerCase();

  const bucket = (): keyof typeof weights | null => {
    if (/experience|employment|work|intern/.test(h)) return "experience";
    if (/project|portfolio/.test(h)) return "project";
    if (/skill|competenc|technolog|tool/.test(h)) return "skill";
    if (/education|degree|academic/.test(h)) return "education";
    if (/certif|licen/.test(h)) return "certification";
    if (/publication|paper|research/.test(h)) return "publication";
    if (/award|honor|achievement/.test(h)) return "award";
    if (/volunteer|community/.test(h)) return "volunteer";
    if (/organi|leadership|affiliation/.test(h)) return "organization";
    return null;
  };

  const key = bucket();
  return key ? (weights[key] ?? 0.6) : 0.6;
}

export function scoreBullets(
  jd: JdParsed,
  entries: Array<VaultEntry & { bullets: VaultBullet[]; sectionHeading?: string }>,
): ScoredBullet[] {
  const scored: ScoredBullet[] = [];

  for (const entry of entries) {
    const sectionWeight = weightForHeading(entry.sectionHeading ?? "", jd.sectionWeights);

    for (const bullet of entry.bullets) {
      if (!bullet.isActive) continue;

      let best = 0;
      const covered: string[] = [];
      const matched = new Set<string>();

      for (const req of jd.requirements) {
        const { score, matched: hits } = termOverlap(bullet.text, req.terms);
        if (score >= 0.34) {
          covered.push(req.id);
          hits.forEach((h) => matched.add(h));
          // Must-haves are worth more than nice-to-haves.
          const weighted = score * (req.kind === "must_have" ? 1 : 0.6);
          if (weighted > best) best = weighted;
        }
      }

      if (covered.length === 0) continue;

      const multiBonus = Math.min(0.2, (covered.length - 1) * 0.07);
      // Writing quality is a mild tiebreaker, not a driver — a weak bullet that
      // covers a must-have still beats a beautiful one that covers nothing.
      const strengthBonus = (bullet.strength - 3) * 0.03;

      scored.push({
        bullet,
        entry,
        score: Math.min(1, (best + multiBonus + strengthBonus) * sectionWeight),
        coveredRequirementIds: covered,
        matchedTerms: [...matched],
      });
    }
  }

  return scored.sort((a, b) => b.score - a.score);
}

/** Requirement ids already evidenced by what's currently on the resume. */
export function coveredByResume(jd: JdParsed, resume: ResolvedResume): Set<string> {
  const resumeText = resume.sections
    .filter((s) => s.isVisible)
    .flatMap((s) => [
      ...s.entries
        .filter((e) => e.isVisible)
        .flatMap((e) => [e.title, e.organization, e.subtitle, ...e.bullets.filter((b) => b.isVisible).map((b) => b.text)]),
      ...s.skills.filter((k) => k.isVisible).map((k) => k.name),
    ])
    .join(" \n ");

  const covered = new Set<string>();
  for (const req of jd.requirements) {
    if (termOverlap(resumeText, req.terms).score >= 0.34) covered.add(req.id);
  }
  return covered;
}

export type TuneInput = {
  jd: JdParsed;
  resume: ResolvedResume;
  /** `sectionHeading` carries the user's own section name for weighting. */
  vaultEntries: Array<VaultEntry & { bullets: VaultBullet[]; sectionHeading?: string }>;
  vaultSkills: VaultSkill[];
};

export type TuneOutput = {
  recommendations: Recommendation[];
  coverage: number;
  coveredRequirementIds: string[];
  missingRequirementIds: string[];
};

function requirementLabel(jd: JdParsed, ids: string[]): string {
  const first = jd.requirements.find((r) => r.id === ids[0]);
  if (!first) return "";
  const extra = ids.length > 1 ? ` +${ids.length - 1} more` : "";
  return `${first.text.slice(0, 90)}${first.text.length > 90 ? "…" : ""}${extra}`;
}

export function tune({ jd, resume, vaultEntries, vaultSkills }: TuneInput): TuneOutput {
  const recommendations: Recommendation[] = [];

  /** Vault bullet ids already used in this resume — what `source_bullet_id` is for. */
  const usedBulletIds = new Set(
    resume.sections.flatMap((s) =>
      s.entries.flatMap((e) => e.bullets.map((b) => b.sourceBulletId).filter((v): v is number => v !== null)),
    ),
  );
  const usedEntryIds = new Set(
    resume.sections.flatMap((s) =>
      s.entries.map((e) => e.sourceEntryId).filter((v): v is number => v !== null),
    ),
  );

  const covered = coveredByResume(jd, resume);
  const mustHaves = jd.requirements.filter((r) => r.kind === "must_have");
  const coverage =
    mustHaves.length === 0
      ? 1
      : mustHaves.filter((r) => covered.has(r.id)).length / mustHaves.length;

  const scored = scoreBullets(jd, vaultEntries);

  // ---- ADD_BULLET / ADD_ENTRY --------------------------------------------
  // Prioritise bullets that close a gap over ones that merely reinforce
  // something the resume already says.
  const gapFilling = scored.filter((s) =>
    s.coveredRequirementIds.some((id) => !covered.has(id)),
  );

  for (const hit of gapFilling.slice(0, 12)) {
    if (usedBulletIds.has(hit.bullet.id)) continue;

    const newIds = hit.coveredRequirementIds.filter((id) => !covered.has(id));
    const entryOnResume = usedEntryIds.has(hit.entry.id);

    recommendations.push({
      id: `add-bullet-${hit.bullet.id}`,
      type: entryOnResume ? "ADD_BULLET" : "ADD_ENTRY",
      label: entryOnResume
        ? `Add "${hit.bullet.text.slice(0, 70)}…" from ${hit.entry.title}`
        : `Surface ${hit.entry.title}${hit.entry.organization ? ` (${hit.entry.organization})` : ""} — not on this resume`,
      coversRequirementIds: newIds,
      score: hit.score,
      payload: {
        vaultBulletId: hit.bullet.id,
        vaultEntryId: hit.entry.id,
        vaultSectionId: hit.entry.sectionId,
        bulletText: hit.bullet.text,
        entryTitle: hit.entry.title,
        why: requirementLabel(jd, newIds),
        matchedTerms: hit.matchedTerms,
      },
      status: "pending",
    });
  }

  // ---- ADD_SKILL ----------------------------------------------------------
  const resumeSkillNames = new Set(
    resume.sections.flatMap((s) => s.skills.map((k) => normalizeTerm(k.name))),
  );

  for (const skill of vaultSkills) {
    if (resumeSkillNames.has(normalizeTerm(skill.name))) continue;

    const terms = matchTermsFor(skill.name, skill.aliases);
    const wanted = jd.requirements.filter(
      (r) => termOverlap(r.text, terms).score > 0 || r.terms.some((t) => terms.includes(t)),
    );
    const inKeywords = jd.keywords.some((k) => normalizeTerm(k) === normalizeTerm(skill.name));

    if (wanted.length === 0 && !inKeywords) continue;

    recommendations.push({
      id: `add-skill-${skill.id}`,
      type: "ADD_SKILL",
      label: `Add ${skill.name} to your skills — the JD asks for it and it's in your vault`,
      coversRequirementIds: wanted.map((r) => r.id),
      score: 0.85,
      payload: { vaultSkillId: skill.id, skillName: skill.name, why: requirementLabel(jd, wanted.map((r) => r.id)) },
      status: "pending",
    });
  }

  // ---- ADD_SKILL from evidence in your own bullets ------------------------
  // A skill the JD wants, named in your bullet text, but absent from your vault
  // skills — so nothing above could suggest it. This is the gap that made a
  // real tuning run report "nothing left to suggest" while the resume said
  // "deployed on Kubernetes clusters" and the JD asked for Kubernetes.
  const vaultSkillNames = new Set(vaultSkills.map((s) => normalizeTerm(s.name)));
  const allBulletText = vaultEntries
    .flatMap((e) => e.bullets.map((b) => b.text))
    .join(" \n ");

  for (const keyword of jd.keywords) {
    const normalized = normalizeTerm(keyword);
    if (vaultSkillNames.has(normalized) || resumeSkillNames.has(normalized)) continue;

    const seed = SKILL_ALIAS_SEEDS.find(
      (s) => normalizeTerm(s.canonical) === normalized,
    );
    const terms = seed
      ? [normalizeTerm(seed.canonical), ...seed.aliases.map(normalizeTerm)]
      : [normalized];

    const evidence = termOverlap(allBulletText, terms);
    if (evidence.matched.length === 0) continue;

    recommendations.push({
      id: `evidence-skill-${normalized}`,
      type: "ADD_SKILL",
      label: `Add ${seed?.canonical ?? keyword} to your vault skills — your bullets already mention it and the JD asks for it`,
      coversRequirementIds: jd.requirements
        .filter((r) => r.terms.some((t) => terms.includes(normalizeTerm(t))))
        .map((r) => r.id),
      score: 0.75,
      payload: {
        newSkillName: seed?.canonical ?? keyword,
        newSkillCategory: seed?.category ?? "General",
        why: `You wrote about it, but it isn't listed as a skill`,
      },
      status: "pending",
    });
  }

  // ---- REMOVE_BULLET ------------------------------------------------------
  // Only offered when the resume is long. On a one-page resume with room to
  // spare, cutting a bullet that merely isn't relevant is not an improvement.
  const totalBullets = resume.sections.reduce(
    (n, s) => n + s.entries.reduce((m, e) => m + e.bullets.filter((b) => b.isVisible).length, 0),
    0,
  );

  if (totalBullets > 12) {
    for (const section of resume.sections) {
      for (const entry of section.entries) {
        for (const bullet of entry.bullets) {
          if (!bullet.isVisible) continue;

          const relevance = Math.max(
            0,
            ...jd.requirements.map((r) => termOverlap(bullet.text, r.terms).score),
          );
          if (relevance > 0.15) continue;

          recommendations.push({
            id: `remove-bullet-${bullet.id}`,
            type: "REMOVE_BULLET",
            label: `Hide "${bullet.text.slice(0, 70)}…" — covers nothing in this JD`,
            coversRequirementIds: [],
            score: 0.3,
            payload: { resumeBulletId: bullet.id, bulletText: bullet.text },
            status: "pending",
          });
        }
      }
    }
  }

  // ---- REORDER ------------------------------------------------------------
  // Suggest promoting the section that carries the most weight for this role.
  const visible = resume.sections.filter((s) => s.isVisible && s.entries.length > 0);
  if (visible.length > 1) {
    const weightOf = (t: SectionType) => jd.sectionWeights[t] ?? 0.5;
    const best = [...visible].sort((a, b) => weightOf(b.sectionType) - weightOf(a.sectionType))[0]!;

    if (best.id !== visible[0]!.id && weightOf(best.sectionType) > weightOf(visible[0]!.sectionType) + 0.15) {
      recommendations.push({
        id: `reorder-${best.id}`,
        type: "REORDER",
        label: `Move ${best.heading} above ${visible[0]!.heading} — this role weights it more heavily`,
        coversRequirementIds: [],
        score: 0.5,
        payload: { sectionId: best.id },
        status: "pending",
      });
    }
  }

  return {
    recommendations: recommendations.sort((a, b) => b.score - a.score).slice(0, 25),
    coverage,
    coveredRequirementIds: [...covered],
    missingRequirementIds: jd.requirements.filter((r) => !covered.has(r.id)).map((r) => r.id),
  };
}
