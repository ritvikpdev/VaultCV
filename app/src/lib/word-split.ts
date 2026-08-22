import { SKILL_ALIAS_SEEDS } from "./skill-aliases.ts";
import { WORD_LIST } from "./word-list.ts";

/**
 * Putting the spaces back into text a PDF lost them from.
 *
 * Some LaTeX résumés position words by glyph offset with no space characters
 * at all, so extraction yields "BuiltbackendservicesforBankofAmerica". The
 * information isn't recoverable from coordinates — but English is redundant
 * enough that the original segmentation can be inferred.
 *
 * This is a Viterbi segmentation: walk the string left to right, and for each
 * position keep the cheapest way to have reached it. Cost is
 * -log(word probability), estimated from the word's rank in a frequency list
 * (Zipf's law), so common words are cheap and rare ones expensive. That's what
 * makes "Bank of America" beat "Ban k of America" — the latter's "Ban" and "k"
 * are individually plausible but jointly improbable.
 *
 * Unknown runs are allowed at a penalty, because résumés are full of proper
 * nouns no word list contains — Accenture, Blazor, Supabase, GoLlama. Refusing
 * to segment around them would be worse than the glued text.
 */

/** rank 0 is the most common word. */
const RANK = new Map<string, number>();

// The generated list starts at two letters, which silently omits the two
// single-letter words English actually has. Without "a", the phrase
// "Coordinated a team of" had no cheap path and lost to "Coordinate date amof".
RANK.set("a", 0);
RANK.set("i", 8);

for (const [i, word] of WORD_LIST.trim().split(/\s+/).entries()) {
  if (!RANK.has(word)) RANK.set(word, i);
}

// Technology names, at a rank that makes them cheaper than a generic word of
// the same length. A résumé mentions Kubernetes far more often than English
// generally does.
// Acronyms that appear glued to neighbouring words in résumé text and are too
// short to survive as unknown runs, plus closed compounds a general frequency
// list splits — "workspace" absent from the list meant "Google Workspace"
// came apart into "Work space".
for (const term of [
  "asp", "net", "sql", "api", "jwt", "ui", "ux", "aws", "llm",
  "workspace", "workflow", "workflows", "workspaces", "codebase", "dataset",
  "datasets", "runtime", "toolchain", "webhook", "webhooks", "roadmap",
  "handoff", "onboarding", "offboarding", "changelog", "walkthrough",
  // Brand names built from two ordinary words, which is exactly the shape the
  // segmenter is tempted to take apart. Not exhaustive — a novel portmanteau
  // brand may still split, and the review screen is where that gets fixed.
  "salesforce", "cloudflare", "snowflake", "databricks", "mailchimp",
  "shopify", "wordpress", "sharepoint", "powerpoint", "dropbox", "hubspot",
  "zendesk", "atlassian", "sendgrid", "twilio", "stripe", "figma", "notion",
]) {
  if (!RANK.has(term)) RANK.set(term, 800);
}

for (const seed of SKILL_ALIAS_SEEDS) {
  for (const term of [seed.canonical, ...seed.aliases]) {
    const clean = term.toLowerCase().replace(/[^a-z]/g, "");
    if (clean.length >= 2 && !RANK.has(clean)) RANK.set(clean, 500);
  }
}

const TOTAL = RANK.size;
const MAX_WORD = 20;

/**
 * Endings a word list never enumerates but that are trivially derivable.
 *
 * Without this, "internationalization" is unknown, and splitting it into
 * "international" + "ization" looks cheaper than keeping it — so the segmenter
 * mangles a perfectly ordinary word. Checking the stem costs one lookup and
 * removes a whole class of bad splits.
 */
const SUFFIXES = [
  "ization", "isation", "ational", "ability", "ibility", "ization",
  "ations", "ition", "ement", "ments", "ingly", "ation", "ances", "ences",
  "ings", "ment", "ness", "less", "ally", "able", "ible", "ised", "ized",
  "ing", "ers", "ed", "es", "s", "ly", "er", "or", "al",
];

/** −log P(word), from rank via Zipf. Lower is better. */
function wordCost(word: string): number {
  const rank = RANK.get(word);
  // +10 keeps the very top of the list from being nearly free, which would
  // otherwise let "a" and "i" shatter longer words.
  if (rank !== undefined) return Math.log((rank + 10) * Math.log(TOTAL));

  // Derived forms: charge the stem plus a small penalty for the ending.
  for (const suffix of SUFFIXES) {
    if (word.length <= suffix.length + 3 || !word.endsWith(suffix)) continue;

    const stem = word.slice(0, -suffix.length);

    // Only two rewrites are legitimate: a dropped silent "e" ("using" →
    // "use") and a doubled consonant ("running" → "run"). An earlier version
    // also tried stripping any final letter, which turned "servicesfor" into
    // "services" and made a glued run look like a real word.
    const candidates = [stem, `${stem}e`];
    if (stem.length >= 2 && stem.at(-1) === stem.at(-2)) {
      candidates.push(stem.slice(0, -1));
    }

    for (const candidate of candidates) {
      const stemRank = RANK.get(candidate);
      if (stemRank !== undefined) {
        return Math.log((stemRank + 10) * Math.log(TOTAL)) + 1.5;
      }
    }
  }

  return Infinity;
}

/**
 * Cost of treating a run as an unknown token — a proper noun, an acronym, a
 * product name. Scaled by length so the segmenter prefers a short unknown over
 * a long one, but still accepts "Supabase" whole rather than mangling it.
 */
function unknownCost(length: number): number {
  // Steeply per-character, and deliberately so. A known word costs ~10 whatever
  // its length, so if unknown runs were charged a flat fee the segmenter would
  // happily swallow "Builtbackendservicesfor" whole rather than pay for five
  // real words. The rate has to exceed the per-character cost of ordinary text.
  return 9 + length * 3;
}

export type SplitOptions = {
  /** Extra vocabulary, e.g. words seen elsewhere in the same document. */
  hints?: Iterable<string>;
};

/**
 * Segment one unspaced run. Returns the original unchanged when it already
 * looks like ordinary text.
 */
export function splitGlued(token: string, options: SplitOptions = {}): string {
  if (token.length < 8) return token;

  const hintRanks = new Map<string, number>();
  for (const hint of options.hints ?? []) {
    const clean = hint.toLowerCase().replace(/[^a-z]/g, "");
    // Words from the same document are strong evidence — this résumé already
    // used them, spaced, somewhere else.
    if (clean.length >= 3) hintRanks.set(clean, 200);
  }

  const lower = token.toLowerCase();
  const n = lower.length;

  const cost = new Array<number>(n + 1).fill(Infinity);
  const from = new Array<number>(n + 1).fill(0);
  cost[0] = 0;

  for (let end = 1; end <= n; end++) {
    for (let start = Math.max(0, end - MAX_WORD); start < end; start++) {
      if (cost[start] === Infinity) continue;

      const piece = lower.slice(start, end);
      const known = Math.min(
        wordCost(piece),
        hintRanks.has(piece) ? Math.log((hintRanks.get(piece)! + 10) * Math.log(TOTAL)) : Infinity,
      );

      /*
       * Short fragments need a surcharge, but not indiscriminately.
       *
       * A blanket penalty on every ≤2-letter piece stopped "using" becoming
       * "us in g" — and also wrecked "Coordinated a team of", because "a" and
       * "of" are genuine words that happen to be short. Charging only the ones
       * outside the top of the frequency list separates the two: "of" (rank 3)
       * and "in" (rank 4) are free, while "us" (rank 89) and unknown single
       * letters pay.
       */
      const rank = RANK.get(piece);
      const shortPenalty =
        piece.length <= 2 && (rank === undefined || rank > 60) ? 6 : 0;

      const candidate =
        cost[start]! +
        (known === Infinity ? unknownCost(piece.length) : known) +
        shortPenalty;

      if (candidate < cost[end]!) {
        cost[end] = candidate;
        from[end] = start;
      }
    }
  }

  // Walk the pointers back to recover the boundaries.
  const bounds: number[] = [];
  for (let at = n; at > 0; at = from[at]!) bounds.push(at);
  bounds.push(0);
  bounds.reverse();

  const pieces: string[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    pieces.push(token.slice(bounds[i]!, bounds[i + 1]!));
  }

  if (pieces.length <= 1) return token;

  // A segmentation that shatters into mostly one- and two-letter fragments is
  // worse than leaving the run alone — the signature of a proper noun the
  // dictionary couldn't help with. Only applied from three pieces up, since
  // "by optimizing" is a perfectly good two-piece split with one short half.
  const tiny = pieces.filter((p) => p.length <= 2).length;
  if (pieces.length >= 3 && tiny / pieces.length > 0.5) return token;

  /*
   * Splitting must be CLEARLY better, not marginally.
   *
   * Every unknown word is a plausible-looking split away from nonsense:
   * "Accenture" decomposes into "Accent" + "ure" at slightly lower cost than
   * keeping it whole, and "Workspace" into "Work" + "space". Requiring a real
   * margin means an unfamiliar word has to be genuinely improbable before it
   * gets taken apart, while a true glue like "dayevents" — which beats its
   * whole form by a wide margin — still splits.
   */
  const wholeCost = wordCost(lower);
  const keepCost = wholeCost === Infinity ? unknownCost(n) : wholeCost;
  if (keepCost - cost[n]! < 12) return token;

  return pieces.join(" ");
}

/**
 * Long pure-letter runs, which is what glued extraction produces.
 *
 * Apostrophes are excluded so "forBankofAmerica’s" is handled as the run
 * "forBankofAmerica" with "’s" left attached to the end — including the
 * apostrophe made "america’s" an unknown token and blocked the whole split.
 */
const GLUED_MIN = 9;
const GLUED_RE = new RegExp(`[A-Za-z]{${GLUED_MIN},}`, "g");

/**
 * Numbers glue to their neighbours too: "ateamof10+members" leaves "of10" and
 * "10+members" once the letter runs are handled, because neither side is long
 * enough to be a run on its own.
 *
 * Split only when the letter half is a word the dictionary knows. That keeps
 * "of 10" and "10+ members" while leaving "mp3", "S3", "utf8" and "Web3"
 * alone — their letter halves aren't words, so nothing fires.
 */
function splitNumberBoundaries(text: string): string {
  return (
    text
      // Letter→digit is the dangerous direction: "mp3", "Web3", "utf8" and
      // "COVID19" are all single tokens whose letter half is a real word.
      // Restricting to short, very common words means only the genuine glue
      // fires — a preposition or article that lost its space before a number
      // ("of10", "over100") — while product names and versions stay intact.
      .replace(/\b([A-Za-z]{2,4})(?=\d)/g, (word) => {
        const rank = RANK.get(word.toLowerCase());
        return rank !== undefined && rank < 400 ? `${word} ` : word;
      })
      // Digit→letter is safer: an ordinal ("3rd") has a two-letter suffix, and
      // the three-letter minimum plus a dictionary check excludes it.
      .replace(/(\d\+?)([A-Za-z]{3,})/g, (whole, num: string, word: string) =>
        RANK.has(word.toLowerCase()) ? `${num} ${word}` : whole,
      )
  );
}

/**
 * Repair a whole document.
 *
 * Runs of 9+ letters are considered. The threshold was 12, which missed
 * "dayevents" in "multi-dayevents" — short glued pairs are common because a
 * hyphenated word puts the seam mid-run. Ordinary long words are safe at this
 * threshold because they're in the dictionary, so keeping them whole is
 * already the cheapest option.
 */
export function repairGluedText(text: string): string {
  // Words already spaced correctly elsewhere in this document are the best
  // possible hints — the résumé's own vocabulary, including proper nouns no
  // dictionary carries.
  //
  // Capped below the glued threshold on purpose. Without that cap the glued
  // runs themselves get harvested as hints, so "andbatchoperations" becomes a
  // "known word" and the segmenter has every reason to leave it alone. The
  // document teaching itself its own mistakes.
  // Capped strictly below the glue threshold. Any word long enough to be a
  // glue candidate must not be allowed to vouch for itself — that's how
  // "dayevents" ended up teaching the segmenter it was a real word. The cap has
  // to track GLUED_MIN, not sit at a fixed number, or lowering the threshold
  // silently reintroduces the bug.
  const hints = new Set<string>();
  for (const word of text.split(/[^A-Za-z]+/)) {
    if (word.length >= 3 && word.length < GLUED_MIN) hints.add(word.toLowerCase());
  }

  // Word segmentation first. Number boundaries come afterwards because before
  // the split, the letters preceding a digit are still the whole glued run —
  // "Coordinatedateamof10" offers no "of" to recognise.
  const segmented = text
    .replace(GLUED_RE, (run) => splitGlued(run, { hints }))
    // Punctuation swallows the following space in glued extraction too:
    // "Hub,supporting" and "operations.Designed". Restoring it is safe — a
    // comma or period followed directly by a letter is never intentional.
    // The digit case ("3.62", "1,000") is excluded by requiring a letter.
    .replace(/([,;:])(?=[A-Za-z])/g, "$1 ")
    .replace(/([a-z]{2})\.(?=[A-Z][a-z])/g, "$1. ");

  return splitNumberBoundaries(segmented);
}
