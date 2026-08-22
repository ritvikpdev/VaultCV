import { NextResponse } from "next/server";
import { count } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";

import { db } from "@/db/client";
import { bootstrap, getProfile, getSetting, hasApiKey, SETTING_KEYS } from "@/db/bootstrap";
import { activeProvider, providerLabel } from "@/lib/ai-provider";
import { vaultBullets, vaultEntries, resumes } from "@/db/schema";

function rowCount(table: SQLiteTable): number {
  return db.select({ n: count() }).from(table).get()?.n ?? 0;
}

export const dynamic = "force-dynamic";

/**
 * Readiness, not liveness.
 *
 * Note what this does NOT do: gate the app. v1 put an Ollama health check in
 * front of the core features, so a stopped model server made the app look
 * broken. Here every field is informational — the UI reads it to explain what
 * is unavailable and why, and nothing else.
 */
export async function GET() {
  try {
    bootstrap();

    const profile = getProfile();

    return NextResponse.json({
      ok: true,
      database: {
        connected: true,
        path: process.env.DATABASE_PATH ?? "./data/vaultcv.db",
      },
      profile: {
        complete: Boolean(profile.fullName.trim() && profile.email.trim()),
        name: profile.fullName,
      },
      vault: {
        entries: rowCount(vaultEntries),
        bullets: rowCount(vaultBullets),
      },
      resumes: rowCount(resumes),
      ai: {
        // No provider is a normal state, not an error. Matching, editing,
        // styling and export all work without one.
        keyPresent: hasApiKey(),
        // Reports whichever provider is actually active. Hardcoding the
        // Anthropic model here meant a status endpoint that lied about the
        // system's state, which is the one thing it exists not to do.
        provider: activeProvider(),
        model: providerLabel(),
      },
      vaultLinkMode: getSetting(SETTING_KEYS.vaultLinkMode) ?? "snapshot",
    });
  } catch (error) {
    // Almost always "you haven't run npm run db:push yet". Say so plainly.
    const message = error instanceof Error ? error.message : String(error);
    const noTables = /no such table/i.test(message);

    return NextResponse.json(
      {
        ok: false,
        database: { connected: false },
        error: message,
        hint: noTables
          ? "Database tables are missing. Run `npm run db:push` in the app folder."
          : undefined,
      },
      { status: 500 },
    );
  }
}
