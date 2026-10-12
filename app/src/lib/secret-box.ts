import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Symmetric encryption for the one secret users hand us: their AI API key.
 *
 * AES-256-GCM, keyed by a SHA-256 of VAULTCV_SECRET so any long random string
 * works as the secret. GCM authenticates as well as encrypts — a tampered or
 * truncated value fails to open rather than decrypting to garbage.
 *
 * What this protects against: someone reading the database (a leaked backup,
 * a Supabase dashboard session) learns nothing usable. What it doesn't: the
 * server needs the plaintext to call the provider, so whoever controls the
 * deployment's environment can recover keys. That is inherent to calling an
 * API on a user's behalf, and the reason Settings says so.
 *
 * Pure functions with the secret passed in, so they're testable without env.
 */

const VERSION = "v1";

function keyFrom(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf8").digest();
}

export function seal(plaintext: string, secret: string): string {
  if (!secret) throw new Error("No encryption secret configured");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(secret), iv);
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64"), tag.toString("base64"), body.toString("base64")].join(
    ":",
  );
}

/** The plaintext, or null if the value is malformed, tampered or sealed with another secret. */
export function open(sealed: string, secret: string): string | null {
  if (!secret) return null;
  const [version, iv, tag, body] = sealed.split(":");
  if (version !== VERSION || !iv || !tag || !body) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", keyFrom(secret), Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(body, "base64")), decipher.final()]).toString(
      "utf8",
    );
  } catch {
    return null;
  }
}
