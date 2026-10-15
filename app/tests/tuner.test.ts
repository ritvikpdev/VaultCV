/**
 * Tuner tests — JD parsing and the recommendation engine.
 *
 * These assert BEHAVIOUR the feature is supposed to have, not the shape of
 * whatever the current implementation happens to emit. The important ones are
 * the "never returns nothing" cases: v1's tuner silently produced an empty
 * screen when its precondition wasn't met, and the whole point of the
 * deterministic design is that it can't.
 */

import assert from "node:assert/strict";
import test, { describe } from "node:test";

import { parseJobDescriptionHeuristically, extractSkillTerms } from "../src/lib/jd-parse.ts";
import { scoreBullets, tune, coveredByResume } from "../src/lib/tuner.ts";
import type { VaultBullet, VaultEntry, VaultSkill } from "../src/db/schema.ts";
import type { ResolvedResume } from "../src/lib/resume-model.ts";

const JD = `Senior Software Engineer

About the role
We are building payments infrastructure.

Requirements
- 3+ years of experience building backend services in Java or Kotlin
- Strong experience with Spring Boot and RESTful API design
- Hands-on experience with container orchestration (k8s)
- Experience with CI/CD pipelines and automated testing

Nice to have
- Familiarity with Kafka or other event streaming platforms
- Exposure to AWS

Benefits
- Health insurance and unlimited PTO
`;

const USER = "00000000-0000-0000-0000-000000000001";

function bullet(id: number, entryId: number, text: string, strength = 4): VaultBullet {
  return {
    id, userId: USER, entryId, text, tags: [], strength, isPinned: false, isActive: true,
    displayOrder: id, createdAt: 0, updatedAt: 0,
  };
}

function entry(id: number, title: string, sectionHeading: string): VaultEntry & { sectionHeading: string } {
  return {
    id, userId: USER, sectionId: 1, sectionHeading, title, organization: "Acme", location: "", startDate: "01/2022",
    endDate: "01/2024", isCurrent: false, url: "", subtitle: "", information: "", level: "", meta: {},
    displayOrder: id, isArchived: false, createdAt: 0, updatedAt: 0,
  };
}

function emptyResume(): ResolvedResume {
  return {
    id: 1, name: "Test", targetRole: "", targetCompany: "",
    profile: {
      id: 1, userId: USER, fullName: "Ritvik", email: "r@example.com", phone: "", location: "",
      links: [], summary: "", title: "", details: [], contactOrder: [], createdAt: 0, updatedAt: 0,
    },
    summary: "",
    style: {
      id: 1, userId: USER, fontFamily: "serif", baseSize: 10, nameSize: 21, headingSize: 11,
      lineHeight: 1.25, sectionGap: 10, entryGap: 6, bulletGap: 2, marginX: 0.5,
      marginY: 0.5, headingStyle: "rule", accentColor: "#000", pageSize: "letter",
      datePosition: "right", subtitleStyle: "italic",
    },
    sections: [],
  };
}

describe("JD parsing", () => {
  const jd = parseJobDescriptionHeuristically(JD);

  test("extracts only bulleted requirements, not prose boilerplate", () => {
    assert.ok(jd.requirements.length >= 5, `got ${jd.requirements.length}`);
    assert.ok(
      !jd.requirements.some((r) => /building payments infrastructure/i.test(r.text)),
      "prose paragraph leaked in as a requirement",
    );
  });

  test("ignores the benefits section entirely", () => {
    assert.ok(
      !jd.requirements.some((r) => /health insurance|PTO/i.test(r.text)),
      "benefits became requirements",
    );
  });

  test("separates must-haves from nice-to-haves by their heading", () => {
    const kafka = jd.requirements.find((r) => /kafka/i.test(r.text));
    const spring = jd.requirements.find((r) => /spring boot/i.test(r.text));

    assert.equal(kafka?.kind, "nice_to_have");
    assert.equal(spring?.kind, "must_have");
  });

  test("detects seniority", () => {
    assert.equal(jd.seniority, "senior");
  });

  test("resolves aliases to canonical skills — 'k8s' means Kubernetes", () => {
    assert.ok(jd.keywords.includes("Kubernetes"), `keywords: ${jd.keywords.join(", ")}`);
    assert.ok(jd.keywords.includes("Spring Boot"));
    assert.ok(jd.keywords.includes("CI/CD"));
  });

  test("never throws and always returns a usable shape, even on junk input", () => {
    for (const input of ["", "   ", "hello", "a\nb\nc", "•".repeat(50)]) {
      const result = parseJobDescriptionHeuristically(input);
      assert.ok(Array.isArray(result.requirements));
      assert.ok(Array.isArray(result.keywords));
    }
  });
});

describe("skill term extraction", () => {
  test("matches aliases as well as canonical names", () => {
    assert.ok(extractSkillTerms("experience with k8s").includes("Kubernetes"));
    assert.ok(extractSkillTerms("we use golang here").includes("Go"));
    assert.ok(extractSkillTerms("ReactJS and NextJS").includes("React"));
  });

  test("does not match a short skill name inside a longer word", () => {
    // "Go" must not fire on "goals", or every JD matches every Go developer.
    assert.ok(!extractSkillTerms("aligned with company goals").includes("Go"));
  });
});

describe("scoring", () => {
  const jd = parseJobDescriptionHeuristically(JD);

  const entries = [
    {
      ...entry(1, "Backend Engineer", "WORK EXPERIENCE"),
      bullets: [
        bullet(1, 1, "Engineered Spring Boot microservices handling 300K transactions daily, reducing latency by 35%.", 5),
        bullet(2, 1, "Automated CI/CD pipelines using Jenkins and Maven, cutting deployment time by 40%.", 5),
        bullet(3, 1, "Organised the office summer party and managed catering logistics.", 2),
      ],
    },
  ];

  test("ranks a relevant bullet above an irrelevant one", () => {
    const scored = scoreBullets(jd, entries);
    const springRank = scored.findIndex((s) => s.bullet.id === 1);
    const partyRank = scored.findIndex((s) => s.bullet.id === 3);

    assert.ok(springRank >= 0, "the Spring Boot bullet should score at all");
    assert.ok(
      partyRank === -1 || springRank < partyRank,
      "an irrelevant bullet outranked a directly relevant one",
    );
  });

  test("every scored bullet names which requirements it covers", () => {
    for (const hit of scoreBullets(jd, entries)) {
      assert.ok(
        hit.coveredRequirementIds.length > 0,
        "a recommendation with no stated reason is not advisory, it's a guess",
      );
    }
  });
});

describe("skill-anchored scoring", () => {
  /**
   * The exact case that made a real tuning run report "nothing left to
   * suggest" at 50% coverage. The requirement describes itself three ways;
   * the bullet names the technology once. Proportional scoring rejected it.
   */
  test("a bullet naming a technology satisfies a requirement that also describes it in prose", () => {
    const jd = parseJobDescriptionHeuristically(
      ["Requirements", "- Solid grounding in relational databases and SQL query optimization"].join("\n"),
    );

    const entries = [
      {
        ...entry(1, "Intern", "WORK EXPERIENCE"),
        bullets: [
          bullet(1, 1, "Optimized database interactions with Entity Framework and parameterized SQL queries, reducing data retrieval time by 30%.", 5),
        ],
      },
    ];

    const scored = scoreBullets(jd, entries);
    assert.equal(
      scored.length,
      1,
      "a bullet about SQL queries must match a SQL requirement, however verbosely that requirement is worded",
    );
  });

  test("a bullet with no relevant technology still does not match", () => {
    const jd = parseJobDescriptionHeuristically(
      ["Requirements", "- Strong experience with Kubernetes and container orchestration"].join("\n"),
    );

    const entries = [
      {
        ...entry(1, "Intern", "WORK EXPERIENCE"),
        bullets: [bullet(1, 1, "Organised the office summer party and managed catering.", 2)],
      },
    ];

    assert.equal(scoreBullets(jd, entries).length, 0, "false positive");
  });
});

describe("recommendations", () => {
  const jd = parseJobDescriptionHeuristically(JD);

  const vaultEntries = [
    {
      ...entry(1, "Backend Engineer", "WORK EXPERIENCE"),
      bullets: [
        bullet(1, 1, "Engineered Spring Boot microservices handling 300K transactions daily.", 5),
        bullet(2, 1, "Containerized services with Docker and deployed on Kubernetes clusters.", 5),
      ],
    },
  ];

  const vaultSkills: VaultSkill[] = [
    { id: 1, userId: USER, sourceEntryId: 99, category: "Cloud & DevOps", name: "Kubernetes", aliases: ["k8s"], level: "", displayOrder: 0, createdAt: 0 },
    { id: 2, userId: USER, sourceEntryId: 99, category: "Personal", name: "Watercolour painting", aliases: [], level: "", displayOrder: 1, createdAt: 0 },
  ];

  test("suggests vault content that fills a gap in an empty resume", () => {
    const out = tune({ jd, resume: emptyResume(), vaultEntries, vaultSkills });

    assert.ok(out.recommendations.length > 0, "an empty resume must produce suggestions");
    assert.ok(
      out.recommendations.some((r) => r.type === "ADD_ENTRY" || r.type === "ADD_BULLET"),
      "should suggest adding vault content",
    );
  });

  test("suggests a skill the JD asks for and the vault has", () => {
    const out = tune({ jd, resume: emptyResume(), vaultEntries, vaultSkills });
    const skillRecs = out.recommendations.filter((r) => r.type === "ADD_SKILL");

    assert.ok(skillRecs.some((r) => /Kubernetes/.test(r.label)), "Kubernetes should be suggested");
    assert.ok(
      !skillRecs.some((r) => /Watercolour/.test(r.label)),
      "an unrelated skill must not be suggested",
    );
  });

  test("coverage is zero for an empty resume and every suggestion states a reason", () => {
    const out = tune({ jd, resume: emptyResume(), vaultEntries, vaultSkills });

    assert.equal(out.coverage, 0);
    for (const rec of out.recommendations) {
      const explained =
        rec.coversRequirementIds.length > 0 ||
        rec.type === "REMOVE_BULLET" ||
        rec.type === "REORDER";
      assert.ok(explained, `"${rec.label}" has no stated reason`);
    }
  });

  test("returns a result even with an empty vault — never a blank screen", () => {
    const out = tune({ jd, resume: emptyResume(), vaultEntries: [], vaultSkills: [] });

    assert.ok(Array.isArray(out.recommendations));
    assert.equal(typeof out.coverage, "number");
    assert.ok(out.missingRequirementIds.length > 0, "gaps should still be reported");
  });

  test("does not re-suggest a bullet already on the resume", () => {
    const resume = emptyResume();
    resume.sections = [
      {
        id: 1, sectionType: "experience", heading: "WORK EXPERIENCE", layout: "normal", icon: null, options: {},
        isVisible: true, pageBreakAfter: false, skills: [],
        entries: [
          {
            id: 1, title: "Backend Engineer", organization: "Acme", subtitle: "", location: "",
            startDate: "01/2022", endDate: "01/2024", isCurrent: false, url: "", meta: {},
            sourceEntryId: 1, isVisible: true,
            bullets: [
              {
                id: 1,
                text: "Engineered Spring Boot microservices handling 300K transactions daily.",
                sourceBulletId: 1,
                isVisible: true,
                html: null,
                align: "left",
                isParagraph: false,
              },
            ],
          },
        ],
      },
    ];

    const out = tune({ jd, resume, vaultEntries, vaultSkills });
    assert.ok(
      !out.recommendations.some((r) => r.payload.vaultBulletId === 1),
      "suggested a bullet that's already on the resume — this is what source_bullet_id prevents",
    );
  });

  test("coverage rises once relevant content is on the resume", () => {
    const resume = emptyResume();
    resume.sections = [
      {
        id: 1, sectionType: "experience", heading: "WORK EXPERIENCE", layout: "normal", icon: null, options: {},
        isVisible: true, pageBreakAfter: false, skills: [],
        entries: [
          {
            id: 1, title: "Backend Engineer", organization: "Acme", subtitle: "", location: "",
            startDate: "01/2022", endDate: "01/2024", isCurrent: false, url: "", meta: {},
            sourceEntryId: 1, isVisible: true,
            bullets: [
              { id: 1, text: "Built Spring Boot RESTful APIs and Java backend services.", sourceBulletId: 1, isVisible: true, html: null, align: "left", isParagraph: false },
              { id: 2, text: "Ran Kubernetes container orchestration with automated CI/CD pipelines and testing.", sourceBulletId: 2, isVisible: true, html: null, align: "left", isParagraph: false },
            ],
          },
        ],
      },
    ];

    const before = tune({ jd, resume: emptyResume(), vaultEntries, vaultSkills }).coverage;
    const after = tune({ jd, resume, vaultEntries, vaultSkills }).coverage;

    assert.ok(after > before, `coverage did not rise: ${before} -> ${after}`);
  });
});

describe("resume coverage detection", () => {
  test("hidden content does not count as covered", () => {
    const jd = parseJobDescriptionHeuristically(JD);
    const resume = emptyResume();
    resume.sections = [
      {
        id: 1, sectionType: "experience", heading: "WORK EXPERIENCE", layout: "normal", icon: null, options: {},
        isVisible: true, pageBreakAfter: false, skills: [],
        entries: [
          {
            id: 1, title: "Backend Engineer", organization: "Acme", subtitle: "", location: "",
            startDate: "", endDate: "", isCurrent: false, url: "", meta: {},
            sourceEntryId: 1, isVisible: true,
            bullets: [
              { id: 1, text: "Built Spring Boot services in Java.", sourceBulletId: 1, isVisible: false, html: null, align: "left", isParagraph: false },
            ],
          },
        ],
      },
    ];

    const covered = coveredByResume(jd, resume);
    const spring = jd.requirements.find((r) => /spring boot/i.test(r.text));
    assert.ok(spring && !covered.has(spring.id), "a hidden bullet must not count as coverage");
  });
});
