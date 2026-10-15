/**
 * Inline rich text for resume bullets: the tiny HTML subset the editor may
 * produce, and its plain-text twin.
 *
 * A bullet stores both. `html` is what the resume prints; `text` is what every
 * other consumer reads — the tuner's keyword matching, strength scoring,
 * duplicate detection, save-to-vault. Deriving `text` from `html` here, in one
 * place, is what keeps those consumers from ever seeing a tag.
 *
 * Allowed: <strong>, <em>, <u>, <a href> (http, https, mailto only). Anything
 * else is dropped and its text kept. This runs on the server before a write
 * and again in the renderer before `dangerouslySetInnerHTML`, so a value that
 * reached the database some other way still can't inject markup.
 *
 * No DOM: it runs in server actions and in `node --test`. The input is a short
 * fragment from a known editor, so a tag tokenizer is enough — this is an
 * allowlist filter, not a general HTML parser.
 */

const ALIASES: Record<string, string> = { b: "strong", i: "em" };
const ALLOWED = new Set(["strong", "em", "u", "a"]);

const TAG_RE = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g;

function escapeText(text: string): string {
  // Entities already present (&amp;, &#39;) are kept; bare ampersands and
  // angle brackets are escaped.
  return text
    .replace(/&(?!(?:[a-zA-Z]+|#\d+|#x[0-9a-fA-F]+);)/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function safeHref(attrs: string): string | null {
  const m = attrs.match(/\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
  const raw = (m?.[2] ?? m?.[3] ?? m?.[4] ?? "").trim();
  if (!raw) return null;
  const decoded = raw.replace(/&amp;/g, "&");
  if (/^(https?:|mailto:)/i.test(decoded)) return decoded;
  // A bare domain ("github.com/x") is what people type; give it a scheme.
  if (/^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(decoded)) return `https://${decoded}`;
  return null; // javascript:, data:, relative paths — never.
}

function attr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/** Reduce a fragment to the allowed tags, balanced, with text escaped. */
export function sanitizeInlineHtml(html: string): string {
  let out = "";
  const open: string[] = [];
  let last = 0;

  for (const m of html.matchAll(TAG_RE)) {
    out += escapeText(html.slice(last, m.index));
    last = m.index! + m[0].length;

    const isClose = m[0].startsWith("</");
    const name = ALIASES[m[1]!.toLowerCase()] ?? m[1]!.toLowerCase();

    // Block-level breaks inside a single bullet become a space, so words on
    // either side of a pasted <br> or </p> don't run together.
    if (name === "br" || (isClose && (name === "p" || name === "div" || name === "li"))) {
      out += " ";
      continue;
    }
    if (!ALLOWED.has(name)) continue;

    if (isClose) {
      const at = open.lastIndexOf(name);
      if (at === -1) continue; // a closer with no opener
      // Close anything opened inside it first, so tags stay nested.
      while (open.length > at) out += `</${open.pop()}>`;
      continue;
    }

    if (name === "a") {
      const href = safeHref(m[2] ?? "");
      if (!href) continue;
      out += `<a href="${attr(href)}">`;
    } else {
      out += `<${name}>`;
    }
    open.push(name);
  }

  out += escapeText(html.slice(last));
  while (open.length) out += `</${open.pop()}>`;
  return out.replace(/\s{2,}/g, " ").trim();
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** The plain text of a fragment: tags dropped, entities decoded, whitespace collapsed. */
export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#\d+|#x[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, code: string) => {
      if (code[0] === "#") {
        const n = code[1] === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
      }
      return ENTITIES[code.toLowerCase()] ?? whole;
    })
    .replace(/\s+/g, " ")
    .trim();
}

/** Plain text as safe HTML — for bullets that have never been formatted. */
export function textToHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** True when the fragment carries any formatting worth storing as HTML. */
export function hasFormatting(html: string): boolean {
  return /<(strong|em|u|a)\b/i.test(html);
}

/**
 * Split pasted plain text into lines, recognising list markers.
 *
 * "- foo", "* foo", "• foo" become bullets; other non-empty lines become
 * paragraphs. Used by the editor's paste handler.
 */
export function splitPastedLines(text: string): Array<{ text: string; isBullet: boolean }> {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const m = line.match(/^([-*•▪◦·]|\d+[.)])\s+(.*)$/);
      return m ? { text: m[2]!.trim(), isBullet: true } : { text: line, isBullet: false };
    });
}
