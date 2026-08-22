import "server-only";

// The package entry point (`pdf-parse`) has a debug block gated on
// `!module.parent` that reads a bundled test fixture; under Next's bundling
// `module.parent` is undefined, so it runs and throws ENOENT. Importing the
// library file directly skips that block entirely.
import pdfParse from "pdf-parse/lib/pdf-parse.js";

import { dehyphenate, findGluedRuns } from "./pdf-text";
import { repairGluedText } from "./word-split";

export { findGluedRuns } from "./pdf-text";

const MIN_TEXT_LENGTH = 100;

export class EmptyPdfTextError extends Error {
  constructor() {
    super(
      "This PDF has no selectable text — it's likely a scan. Paste the text instead, or use a PDF exported from a resume builder.",
    );
    this.name = "EmptyPdfTextError";
  }
}

type TextItem = {
  str: string;
  width?: number;
  height?: number;
  transform: number[];
};

/**
 * Rebuild text from glyph positions rather than trusting pdf.js's own spacing.
 *
 * LaTeX resume templates — Deedy, Awesome-CV and friends — kern far tighter
 * than a word processor, and pdf.js's default rendering concatenates runs
 * without inserting spaces, producing "GeorgeWashingtonUniversity". The
 * coordinates survive, so measuring the horizontal gap between runs and
 * inserting a space when it exceeds a fraction of the line height recovers
 * most of it. A newline goes in when the baseline moves more than half a line.
 */
function renderPage(pageData: {
  getTextContent: (opts: Record<string, unknown>) => Promise<{ items: TextItem[] }>;
}): Promise<string> {
  return pageData
    .getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false })
    .then((content) => {
      let out = "";
      let lastEndX: number | null = null;
      let lastY: number | null = null;
      let lastHeight = 10;

      for (const item of content.items) {
        if (!item.str) continue;

        const x = item.transform[4]!;
        const y = item.transform[5]!;
        const height = item.height || lastHeight;

        const gap = lastEndX === null ? 0 : x - lastEndX;

        if (lastY !== null && Math.abs(y - lastY) > height * 0.5) {
          out += "\n";
        } else if (gap > height * 1.5) {
          // A gap this wide isn't a word space — it's the column break these
          // templates use to push location and dates to the right margin. Emit
          // a tab so the parser can split "Accenture⇥Hyderabad, India" cleanly
          // instead of guessing where the employer ends.
          out += "\t";
        } else if (gap > height * 0.12) {
          out += " ";
        }

        out += item.str;
        lastEndX = x + (item.width ?? 0);
        lastY = y;
        lastHeight = height;
      }

      return out;
    });
}

export type PdfExtraction = {
  text: string;
  /** Non-empty when spacing could not be fully recovered. */
  gluedSamples: string[];
};

/** Extracts text from a PDF buffer. Throws `EmptyPdfTextError` for scans. */
export async function extractPdfText(buffer: Buffer): Promise<PdfExtraction> {
  const { text } = await pdfParse(buffer, { pagerender: renderPage });
  const dehyphenated = dehyphenate(text);

  if (dehyphenated.replace(/\s+/g, "").length < MIN_TEXT_LENGTH) {
    throw new EmptyPdfTextError();
  }

  // Coordinates recover most spacing, but fully-justified lines position words
  // by glyph offset with no space characters at all — nothing in the geometry
  // to measure. Those get reconstructed from the language instead.
  const repaired = repairGluedText(dehyphenated);

  return {
    text: repaired,
    // Anything still glued after repair is a genuine failure worth surfacing,
    // rather than the routine case it used to be.
    gluedSamples: findGluedRuns(repaired),
  };
}
