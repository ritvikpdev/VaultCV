/**
 * Deterministic near-duplicate detection for vault import. No embeddings, no
 * AI — a bag-of-words Jaccard score over normalized tokens. Good enough to
 * flag "you've probably already got this" for a human to confirm; it is
 * never used to silently skip anything.
 */

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "of", "to", "in", "on", "for", "with", "at",
  "by", "from", "as", "is", "are", "was", "were", "be", "been", "it", "its",
]);

function tokens(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
  return new Set(words);
}

/** Jaccard similarity of two strings' token sets, in [0, 1]. */
export function textSimilarity(a: string, b: string): number {
  const setA = tokens(a);
  const setB = tokens(b);
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const t of setA) {
    if (setB.has(t)) intersection += 1;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export const DUPLICATE_THRESHOLD = 0.6;

/**
 * The best match for `text` among `candidates` at or above the threshold, or
 * null. Ties go to the first (typically closest to the top of the vault).
 */
export function findSimilar(
  text: string,
  candidates: string[],
  threshold = DUPLICATE_THRESHOLD,
): string | null {
  let best: { text: string; score: number } | null = null;

  for (const candidate of candidates) {
    const score = textSimilarity(text, candidate);
    if (score >= threshold && (!best || score > best.score)) {
      best = { text: candidate, score };
    }
  }

  return best?.text ?? null;
}
