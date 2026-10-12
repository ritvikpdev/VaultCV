import "server-only";

import { eq } from "drizzle-orm";

import { currentUserId, db, first } from "./client";
import { profile, settings } from "./schema";

/**
 * First-sign-in setup for the current user. Idempotent — safe on every request.
 *
 * Deliberately does NOT create tables. Schema comes from `npm run db:push`, so
 * there is exactly one source of truth for structure (schema.ts) and no chance
 * of a hand-written CREATE TABLE drifting from the Drizzle definition.
 *
 * Runs inside the user's scope, so the rows it inserts are stamped with their
 * id by the `user_id` column default.
 */

export const SETTING_KEYS = {
  /**
   * "snapshot" | "linked" — how resume content relates to the vault.
   *
   * Ships as "snapshot": pulling a bullet copies its text, and later vault edits
   * do not propagate. Phase 7 turns on "linked", where resume_bullets.text NULL
   * reads through to the vault. Both modes use the same schema; this key is the
   * whole switch.
   */
  vaultLinkMode: "vault_link_mode",
  /** Have we run the welcome flow. */
  onboarded: "onboarded",
  /**
   * Where the ungrouped block sits among the vault sidebar's groups.
   *
   * Groups carry their own `display_order`; the ungrouped block has no row to
   * carry one, so it lives here and is interleaved at read time. The default of
   * -1 sorts it above every group, which is exactly how the sidebar behaved
   * before it could be dragged — so existing vaults need no migration.
   */
  ungroupedOrder: "vault_ungrouped_order",
  /** "anthropic" | "gemini" | "" — which provider the user's own key is for. */
  aiProvider: "ai_provider",
  /** The user's API key, encrypted with VAULTCV_SECRET (see secret-box.ts). */
  aiKey: "ai_key",
  /** Last four characters of the key, so Settings can show which one is saved. */
  aiKeyHint: "ai_key_hint",
} as const;

const DEFAULT_SETTINGS: Record<string, string> = {
  [SETTING_KEYS.vaultLinkMode]: "snapshot",
  [SETTING_KEYS.onboarded]: "false",
  [SETTING_KEYS.ungroupedOrder]: "-1",
};

/**
 * Users already set up by this server process. Per user rather than one flag,
 * because one process now serves everybody. Losing it (a cold start) costs two
 * cheap reads, never a duplicate row — the inserts below are guarded.
 */
const bootstrapped = new Set<string>();

export async function bootstrap() {
  const userId = currentUserId();
  if (!userId || bootstrapped.has(userId)) return;

  // `onConflictDoNothing` on the unique user index: two first requests racing
  // in parallel must not both create a profile.
  await db
    .insert(profile)
    .values({ fullName: "", email: "" })
    .onConflictDoNothing({ target: profile.userId });

  // Default settings, without clobbering anything already set.
  const existing = new Set((await db.select().from(settings)).map((s) => s.key));
  const missing = Object.entries(DEFAULT_SETTINGS).filter(([key]) => !existing.has(key));
  if (missing.length > 0) {
    await db
      .insert(settings)
      .values(missing.map(([key, value]) => ({ key, value })))
      .onConflictDoNothing();
  }

  bootstrapped.add(userId);
}

export async function getSetting(key: string): Promise<string | null> {
  const row = await first(db.select().from(settings).where(eq(settings.key, key)));
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string) {
  await db
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: [settings.userId, settings.key], set: { value } });
}

export async function deleteSetting(key: string) {
  await db.delete(settings).where(eq(settings.key, key));
}

export async function getProfile() {
  await bootstrap();
  return (await first(db.select().from(profile)))!;
}
