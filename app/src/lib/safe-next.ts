/**
 * Where to go after signing in or following an email link.
 *
 * Only same-site paths. `next` arrives in a URL anyone can craft, and an
 * unchecked redirect would let a link that looks like this app's login bounce
 * a user to a lookalike site afterwards. "//evil.com" and "/\evil.com" are
 * protocol-relative in browsers, so a leading slash alone isn't enough.
 */
export function safeNext(next: string | null | undefined, fallback = "/"): string {
  if (!next) return fallback;
  if (!next.startsWith("/")) return fallback;
  if (next.startsWith("//") || next.startsWith("/\\")) return fallback;
  if (/[\u0000-\u001f]/.test(next)) return fallback;
  return next;
}
