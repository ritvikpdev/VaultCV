import { NextResponse } from "next/server";

import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { withVault } from "@/db/session";

export const dynamic = "force-dynamic";

/**
 * Everything the signed-in user has stored, as one JSON download.
 *
 * Whole-table selects, filtered to this user by row-level security. Their AI
 * key is left out even though it's encrypted — a file that gets emailed around
 * is no place for credentials in any form.
 */
export async function GET() {
  const data = await withVault(async (user) => {
    const [
      profile,
      groups,
      sections,
      entries,
      bullets,
      resumes,
      styles,
      resumeSections,
      resumeEntries,
      resumeBullets,
      resumeSkills,
      jobDescriptions,
      tuneRuns,
      settings,
    ] = await Promise.all([
      db.select().from(schema.profile),
      db.select().from(schema.vaultGroups),
      db.select().from(schema.vaultSections),
      db.select().from(schema.vaultEntries),
      db.select().from(schema.vaultBullets),
      db.select().from(schema.resumes),
      db.select().from(schema.resumeStyles),
      db.select().from(schema.resumeSections),
      db.select().from(schema.resumeEntries),
      db.select().from(schema.resumeBullets),
      db.select().from(schema.resumeSkills),
      db.select().from(schema.jobDescriptions),
      db.select().from(schema.tuneRuns),
      db.select().from(schema.settings),
    ]);

    return {
      exportedAt: new Date().toISOString(),
      account: user.email,
      profile,
      vault: { groups, sections, entries, bullets },
      resumes: {
        resumes,
        styles,
        sections: resumeSections,
        entries: resumeEntries,
        bullets: resumeBullets,
        skills: resumeSkills,
      },
      tuner: { jobDescriptions, tuneRuns },
      settings: settings.filter((s) => !s.key.startsWith("ai_key")),
    };
  });

  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="vaultcv-${date}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
