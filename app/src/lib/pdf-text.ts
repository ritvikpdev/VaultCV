/**
 * Pure text helpers for PDF extraction.
 *
 * Kept separate from `pdf-extract.ts` because that module is `server-only` and
 * pulls in pdf-parse. These functions are the part worth testing, and a test
 * shouldn't have to load a PDF library to check a regex.
 */

/**
 * LaTeX hyphenates across line breaks ("pay-\nment records"). Rejoining those
 * keeps "payment" one word instead of two fragments.
 */
export function dehyphenate(text: string): string {
  return text.replace(/([a-z])-\n([a-z])/g, "$1$2");
}

/**
 * Detect runs that lost their spacing entirely and can't be recovered.
 *
 * Some fully-justified LaTeX lines position words by glyph offsets rather than
 * space characters. pdf.js hands those back as a single string with the spaces
 * already gone, so no amount of gap measuring brings them back — the
 * information isn't in what the library exposes.
 *
 * Detecting them matters more than it sounds: importing
 * "BuiltbackendservicesforBankofAmerica" as a bullet looks like it worked, and
 * the user only finds out once it's in their vault. Better to say so up front.
 */
/** URLs, emails and file paths are legitimately long and unspaced. */
const ADDRESS_LIKE = /[@/\\]|\.(com|org|net|io|dev|edu|gov)\b/i;

export function findGluedRuns(text: string): string[] {
  const seen = new Set<string>();

  for (const raw of text.split(/\s+/)) {
    const token = raw.replace(/[.,;:]+$/, "");
    if (token.length < 25 || ADDRESS_LIKE.test(token)) continue;

    // Two independent tells, because they catch different shapes:
    //   "CustomerExperienceandCommunication" — a lowercase→uppercase seam
    //   "Technicalassistanceanddocumentation" — no seam at all, just too long
    //     to be a real word, since English tops out around 20 letters.
    const hasSeam = /[a-z][A-Z]/.test(token);
    const implausiblyLong = /^[A-Za-z]{28,}$/.test(token);

    if (hasSeam || implausiblyLong) {
      seen.add(token.slice(0, 60));
      if (seen.size >= 4) break;
    }
  }

  return [...seen];
}
