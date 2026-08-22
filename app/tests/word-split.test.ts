/**
 * Recovering spaces from PDF text that lost them.
 *
 * Some LaTeX résumés position words by glyph offset with no space characters,
 * so extraction yields "BuiltbackendservicesforBankofAmerica". Coordinates
 * can't help — the information isn't there. This is inferred from the language
 * instead, by Viterbi segmentation over a frequency-ranked word list.
 *
 * Two failure modes matter equally and pull against each other:
 *   under-splitting  — leaving a glued run intact
 *   over-splitting   — mangling "internationalization" into "international ization"
 *
 * Both are tested, because every tuning change trades one for the other.
 */

import assert from "node:assert/strict";
import test, { describe } from "node:test";

import { repairGluedText, splitGlued } from "../src/lib/word-split.ts";

describe("recovering glued text", () => {
  const cases: Array<[input: string, expected: string]> = [
    ["GeorgeWashingtonUniversity", "George Washington University"],
    ["MasterofScienceinComputerScience", "Master of Science in Computer Science"],
    ["SoftwareDevelopmentIntern", "Software Development Intern"],
    ["CustomerExperienceandCommunication", "Customer Experience and Communication"],
    ["andbatchoperations", "and batch operations"],
    ["Builtbackendservicesfor", "Built backend services for"],
  ];

  for (const [input, expected] of cases) {
    test(`"${input.slice(0, 34)}" splits correctly`, () => {
      assert.equal(repairGluedText(input), expected);
    });
  }

  test("a full glued sentence comes back readable", () => {
    const result = repairGluedText(
      "ImproveddataprocessingperformancebyoptimizingHibernatequeries,indexing,andbatchoperations",
    );
    assert.equal(
      result,
      "Improved data processing performance by optimizing Hibernate queries, indexing, and batch operations",
    );
  });

  test("punctuation that swallowed its following space is restored", () => {
    assert.equal(repairGluedText("Hub,supporting reliable"), "Hub, supporting reliable");
    // A decimal must not be touched — the rule requires a letter after.
    assert.equal(repairGluedText("GPA: 3.62/4.0"), "GPA: 3.62/4.0");
  });
});

describe("numbers glued to their neighbours", () => {
  test("the reported line comes back exactly as written", () => {
    assert.equal(
      repairGluedText(
        "Coordinatedateamof10+members across multi-dayevents, maintaining internal documentation.",
      ),
      "Coordinated a team of 10+ members across multi-day events, maintaining internal documentation.",
    );
  });

  test("short function words separate from a following number", () => {
    assert.equal(repairGluedText("Managed a budget of50000 dollars"), "Managed a budget of 50000 dollars");
  });

  /**
   * The letter→digit rule is the dangerous one: plenty of real tokens are a
   * word followed by a digit. Restricting it to short, very common words is
   * what keeps these intact.
   */
  const intactTokens = ["mp3 player", "utf8 encoding", "Web3 wallet", "S3 bucket", "v2 release", "3rd place", "COVID19 era"];

  for (const token of intactTokens) {
    test(`"${token}" is left alone`, () => {
      assert.equal(repairGluedText(token), token);
    });
  }

  test("decimals and thousands separators survive", () => {
    assert.equal(repairGluedText("GPA: 3.62/4.0 across 1,000 records"), "GPA: 3.62/4.0 across 1,000 records");
  });
});

describe("not over-splitting", () => {
  const intact = [
    "internationalization",
    "microservices",
    "documentation",
    "responsibilities",
    "Panchbhaiya",
    "Kubernetes",
    "Supabase",
    "linkedin",
  ];

  for (const word of intact) {
    test(`"${word}" survives untouched`, () => {
      assert.equal(splitGlued(word), word);
    });
  }

  test("ordinary prose is returned unchanged", () => {
    const prose =
      "Built a full-stack precision nutrition app using Next.js and Supabase that tracks calories.";
    assert.equal(repairGluedText(prose), prose);
  });

  test("short runs are left alone entirely", () => {
    // Below the 12-letter threshold nothing is attempted, because segmenting
    // ordinary words risks "management" → "manage ment" for no gain.
    assert.equal(repairGluedText("management workflow"), "management workflow");
  });
});

describe("document vocabulary as hints", () => {
  test("a proper noun spaced elsewhere helps split it where it's glued", () => {
    // "Agilite" is in no dictionary, but the document uses it correctly once.
    const text = "Worked at Agilite Global. RoleatAgiliteGlobalSolutions was varied.";
    assert.match(repairGluedText(text), /Role at Agilite Global Solutions/);
  });

  test("a glued run cannot vouch for itself", () => {
    // Hints are capped below the glued threshold. Without that cap the run
    // gets harvested as its own evidence and is never split.
    assert.equal(repairGluedText("andbatchoperations"), "and batch operations");
  });
});
