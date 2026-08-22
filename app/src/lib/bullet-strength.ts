/**
 * Local bullet strength scoring, 1–5.
 *
 * Deliberately has no AI dependency. This runs on every keystroke in the vault
 * editor and must be instant, free and available with no API key. It is a
 * writing-quality heuristic, not a relevance judgment — relevance to a specific
 * job is the tuner's problem, and it is a different question entirely.
 */

/** Verbs that describe ownership and outcome. Non-exhaustive by design. */
const STRONG_VERBS = new Set([
  "architected", "automated", "built", "consolidated", "converted", "created",
  "cut", "delivered", "deployed", "designed", "developed", "diagnosed",
  "doubled", "drove", "eliminated", "engineered", "established", "expanded",
  "generated", "implemented", "improved", "increased", "initiated",
  "introduced", "launched", "led", "migrated", "modernized", "negotiated",
  "optimized", "orchestrated", "overhauled", "pioneered", "prototyped",
  "rearchitected", "rebuilt", "reduced", "refactored", "resolved",
  "restructured", "scaled", "secured", "shipped", "simplified", "spearheaded",
  "standardized", "streamlined", "tripled", "unified",
]);

/**
 * Openers that describe a job description rather than an accomplishment.
 * "Responsible for testing" tells a reader what you were assigned; "Cut test
 * runtime 40%" tells them what happened because you were there.
 */
const WEAK_OPENERS = [
  "responsible for",
  "worked on",
  "worked with",
  "helped",
  "assisted",
  "participated in",
  "involved in",
  "tasked with",
  "duties included",
  "in charge of",
  "part of a team",
  "contributed to",
];

/** Numbers, percentages, currency, multipliers, time and data volumes. */
const METRIC_PATTERNS = [
  /\d+\s?%/,                       // 35%
  /[$€£]\s?\d/,                    // $2M
  /\b\d+(\.\d+)?\s?[kKmMbB]\b/,    // 300K, 2.5M
  /\b\d+(\.\d+)?x\b/i,             // 3x
  /\b\d+\s?(ms|s|sec|min|hr|hours?|days?|weeks?|months?)\b/i,
  /\b\d+\s?(gb|tb|mb|qps|rps|req\/s)\b/i,
  /\b\d{2,}\b/,                    // any bare number ≥ 2 digits
];

export type StrengthBreakdown = {
  score: number;
  reasons: Array<{ label: string; delta: number; met: boolean }>;
};

function firstWord(text: string): string {
  const m = text.trim().toLowerCase().match(/^[a-z]+/);
  return m?.[0] ?? "";
}

/**
 * Proper nouns and acronyms *after* the first word — a proxy for naming the
 * actual technology rather than gesturing at it. "Deployed on Kubernetes"
 * scores; "deployed to the cloud" does not.
 */
function hasNamedTech(text: string): boolean {
  const rest = text.trim().split(/\s+/).slice(1).join(" ");
  return /\b([A-Z][a-z]{2,}|[A-Z]{2,}|[A-Z][a-zA-Z]*\.[a-z]{2,})\b/.test(rest);
}

export function scoreBullet(rawText: string): StrengthBreakdown {
  const text = rawText.trim();

  if (!text) {
    return { score: 1, reasons: [] };
  }

  const lower = text.toLowerCase();
  const len = text.length;

  const startsStrong = STRONG_VERBS.has(firstWord(text));
  const startsWeak = WEAK_OPENERS.some((w) => lower.startsWith(w));
  const hasMetric = METRIC_PATTERNS.some((p) => p.test(text));
  const named = hasNamedTech(text);

  // 80–220 chars is roughly one to two printed lines at 10pt. Shorter tends to
  // be a fragment; longer wraps to three lines and gets skimmed past.
  const goodLength = len >= 80 && len <= 220;
  const tooLong = len > 260;

  const reasons: StrengthBreakdown["reasons"] = [
    { label: "Opens with a strong action verb", delta: 1, met: startsStrong },
    { label: "Includes a concrete metric", delta: 1.5, met: hasMetric },
    { label: "Names specific technology or tools", delta: 0.5, met: named },
    { label: "Well-sized for one or two lines", delta: 0.5, met: goodLength },
    { label: "Avoids a passive opener", delta: -1.5, met: startsWeak },
    { label: "Not overlong", delta: -0.5, met: tooLong },
  ];

  let score = 2; // neutral baseline: a grammatical sentence with no signal
  for (const r of reasons) {
    // Negative reasons apply when met; positive reasons apply when met.
    if (r.met) score += r.delta;
  }

  return {
    score: Math.max(1, Math.min(5, Math.round(score))),
    reasons,
  };
}

/** Convenience for callers that only need the number. */
export function bulletStrength(text: string): number {
  return scoreBullet(text).score;
}

export const STRENGTH_LABELS: Record<number, string> = {
  1: "Needs work",
  2: "Weak",
  3: "Okay",
  4: "Strong",
  5: "Excellent",
};
