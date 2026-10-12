import { NextResponse } from "next/server";
import { count } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";

import { getAiConfig } from "@/db/ai-config";
import { db, first } from "@/db/client";
import { getProfile, getSetting, SETTING_KEYS } from "@/db/bootstrap";
import { getSessionUser, withVault } from "@/db/session";
import { providerLabel } from "@/lib/ai-provider";
import { resumes, vaultBullets, vaultEntries } from "@/db/schema";

async function rowCount(table: PgTable): Promise<number> {
  return (await first(db.select({ n: count() }).from(table)))?.n ?? 0;
}

export const dynamic = "force-dynamic";

/**
 * Readiness, not liveness — for the signed-in user.
 *
 * Note what this does NOT do: gate the app. v1 put an Ollama health check in
 * front of the core features, so a stopped model server made the app look
 * broken. Here every field is informational — the UI reads it to explain what
 * is unavailable and why, and nothing else.
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });

  try {
    return NextResponse.json(
      await withVault(async () => {
        const [profile, ai, entries, bullets, resumeCount, linkMode] = await Promise.all([
          getProfile(),
          getAiConfig(),
          rowCount(vaultEntries),
          rowCount(vaultBullets),
          rowCount(resumes),
          getSetting(SETTING_KEYS.vaultLinkMode),
        ]);
        return {
          ok: true,
          database: { connected: true },
          user: { email: user.email },
          profile: {
            complete: Boolean(profile.fullName.trim() && profile.email.trim()),
            name: profile.fullName,
          },
          vault: { entries, bullets },
          resumes: resumeCount,
          ai: {
            // No provider is a normal state, not an error. Matching, editing,
            // styling and export all work without one.
            keyPresent: ai.provider !== "none",
            provider: ai.provider,
            model: providerLabel(ai),
          },
          vaultLinkMode: linkMode ?? "snapshot",
        };
      }),
    );
  } catch (error) {
    // Almost always "tables don't exist yet" or an unreachable database.
    const message = error instanceof Error ? error.message : String(error);
    const noTables = /relation .* does not exist/i.test(message);

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
