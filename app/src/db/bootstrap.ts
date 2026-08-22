import "server-only";

import { eq } from "drizzle-orm";

import { db } from "./client";
import { profile, settings } from "./schema";

/**
 * First-run setup. Idempotent — safe to call on every request.
 *
 * Deliberately does NOT create tables. Schema comes from `npm run db:push`, so
 * there is exactly one source of truth for structure (schema.ts) and no chance
 * of a hand-written CREATE TABLE drifting from the Drizzle definition.
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
} as const;

const DEFAULT_SETTINGS: Record<string, string> = {
  [SETTING_KEYS.vaultLinkMode]: "snapshot",
  [SETTING_KEYS.onboarded]: "false",
  [SETTING_KEYS.ungroupedOrder]: "-1",
};

let didBootstrap = false;

export function bootstrap() {
  if (didBootstrap) return;

  // Singleton profile row.
  const existingProfile = db.select().from(profile).limit(1).all();
  if (existingProfile.length === 0) {
    db.insert(profile).values({ fullName: "", email: "" }).run();
  }

  // Default settings, without clobbering anything already set.
  const existing = new Set(db.select().from(settings).all().map((s) => s.key));
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    if (!existing.has(key)) {
      db.insert(settings).values({ key, value }).run();
    }
  }

  didBootstrap = true;
}

export function getSetting(key: string): string | null {
  bootstrap();
  const row = db.select().from(settings).where(eq(settings.key, key)).get();
  return row?.value ?? null;
}

export function setSetting(key: string, value: string) {
  bootstrap();
  db.insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } })
    .run();
}

export function getProfile() {
  bootstrap();
  return db.select().from(profile).limit(1).get()!;
}

/**
 * True when any AI provider is configured — Anthropic, Gemini or a local
 * Ollama. Features check this to explain themselves, never to refuse to run.
 */
export function hasApiKey(): boolean {
  return Boolean(
    process.env.ANTHROPIC_API_KEY?.trim() ||
      process.env.GEMINI_API_KEY?.trim() ||
      process.env.OLLAMA_BASE_URL?.trim(),
  );
}
