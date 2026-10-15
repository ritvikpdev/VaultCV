"use server";

import { revalidatePath } from "next/cache";
import { asc, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { db, first } from "@/db/client";
import { withVault } from "@/db/session";
import { getAiConfig } from "@/db/ai-config";
import { aiAvailable, callStructured, providerLabel, type AiConfig } from "@/lib/ai-provider";
import { getResumeFull } from "@/db/resume-queries";
import {
  jobDescriptions,
  resumeBullets,
  resumeSections,
  tuneRuns,
  vaultBullets,
  vaultEntries,
  vaultSections,
  vaultSkills,
  type JdParsed,
  type Recommendation,
} from "@/db/schema";
import { parseJobDescriptionHeuristically } from "@/lib/jd-parse";
import { getSectionDef } from "@/lib/sections";
import { ensureGroupNamed } from "@/db/vault-groups";
import { tune, type TuneOutput } from "@/lib/tuner";

import { createEntry as createVaultEntry, updateEntry as updateVaultEntry } from "../vault/actions";
import {
  addSection,
  moveSection,
  pullEntryFromVault,
  pullSkillsFromVault,
  toggleBulletVisible,
} from "./actions";

/**
 * The vault section to file a newly-discovered skill under.
 *
 * Prefers an existing skill-type section — the user probably already has one
 * named however they like — and only creates "Skills" when there is none.
 * Inventing a section on every run would litter the sidebar.
 */
async function ensureVaultSkillSection(): Promise<number> {
  const existing = (
    await db.select().from(vaultSections).orderBy(asc(vaultSections.displayOrder))
  ).find((s) => s.type === "skill");

  if (existing) return existing.id;

  const last = await first(
    db
      .select({ o: vaultSections.displayOrder })
      .from(vaultSections)
      .orderBy(desc(vaultSections.displayOrder)),
  );

  return (await first(
    db
      .insert(vaultSections)
      .values({
        heading: "Skills",
        type: "skill",
        // Every section needs a group; a new one gets a group of its own name.
        groupId: await ensureGroupNamed("Skills"),
        displayOrder: (last?.o ?? -1) + 1,
      })
      .returning({ id: vaultSections.id }),
  ))!.id;
}

export type ActionResult<T = undefined> =
  ({ ok: true } & (T extends undefined ? object : { data: T })) | { ok: false; error: string };

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

export type TuneResult = TuneOutput & {
  jd: JdParsed;
  jdId: number;
  runId: number;
  /**
   * Which provider actually produced the requirements, for display.
   * `jd.source` only distinguishes AI from local; this names the AI, so the UI
   * can't claim "parsed with Claude" while running on Gemini.
   */
  providerName: string;
};

/**
 * Parse a JD and produce an advisory diff.
 *
 * Deterministic parsing always runs first and its output is what gets used if
 * anything about the Claude path fails. The AI layer improves requirement
 * extraction; it is never what makes the feature work.
 */
export async function runTune(resumeId: number, jdText: string): Promise<ActionResult<TuneResult>> {
  const parsedText = z
    .string()
    .trim()
    .min(40, "Paste a bit more of the job description")
    .safeParse(jdText);
  if (!parsedText.success) return fail(parsedText.error.issues[0]!.message);

  let jd: JdParsed = parseJobDescriptionHeuristically(parsedText.data);

  // The AI call happens between two short vault scopes rather than inside one:
  // a scope is an open transaction holding a pooled connection, and a model
  // can take tens of seconds to answer.
  const ai = await withVault(() => getAiConfig());

  if (aiAvailable(ai)) {
    try {
      const refined = await refineWithAi(parsedText.data, jd, ai);
      if (refined) jd = refined;
    } catch {
      // Keep the heuristic result. An API hiccup must not cost the user their
      // tuning run — that failure mode is exactly what sank v1.
    }
  }

  return withVault(async () => {
    const resume = await getResumeFull(resumeId);
    if (!resume) return fail("Resume not found");

    const entries = await db.select().from(vaultEntries).orderBy(asc(vaultEntries.displayOrder));
    const bullets = await db.select().from(vaultBullets).orderBy(asc(vaultBullets.displayOrder));
    const skills = await db.select().from(vaultSkills);

    const byEntry = new Map<number, typeof bullets>();
    for (const b of bullets) {
      const list = byEntry.get(b.entryId);
      if (list) list.push(b);
      else byEntry.set(b.entryId, [b]);
    }

    // Section headings ride along so the tuner can weight by them — vault
    // sections are user-named now, so there's no type to look weights up by.
    const sectionHeadings = new Map(
      (await db.select().from(vaultSections)).map((s) => [s.id, s.heading]),
    );

    const output = tune({
      jd,
      resume,
      vaultEntries: entries.map((e) => ({
        ...e,
        bullets: byEntry.get(e.id) ?? [],
        sectionHeading: sectionHeadings.get(e.sectionId) ?? "",
      })),
      vaultSkills: skills,
    });

    const jdRow = (await first(
      db
        .insert(jobDescriptions)
        .values({ rawText: parsedText.data.slice(0, 20000), parsed: jd })
        .returning({ id: jobDescriptions.id }),
    ))!;

    const runRow = (await first(
      db
        .insert(tuneRuns)
        .values({
          resumeId,
          jdId: jdRow.id,
          recommendations: output.recommendations,
          coverage: output.coverage,
        })
        .returning({ id: tuneRuns.id }),
    ))!;

    return {
      ok: true,
      data: {
        ...output,
        jd,
        jdId: jdRow.id,
        runId: runRow.id,
        // "locally" when the deterministic parser's result is what we kept —
        // whether that's because there's no provider or because one failed.
        providerName: jd.source === "heuristic" ? "locally" : `with ${providerLabel(ai)}`,
      },
    };
  });
}

/**
 * Whichever AI provider is configured refines requirement extraction.
 * Returns null on any doubt, and the caller keeps the deterministic result.
 */
async function refineWithAi(
  text: string,
  fallback: JdParsed,
  ai: AiConfig,
): Promise<JdParsed | null> {
  const raw = await callStructured(
    {
      toolName: "record_jd",
      toolDescription: "Record the structured requirements of a job description.",
      maxTokens: 3000,
      // Deliberately plain JSON Schema — Gemini's responseSchema accepts only a
      // subset, and a schema that works everywhere beats three bespoke ones.
      schema: {
        type: "object",
        properties: {
          role: { type: "string" },
          company: { type: "string" },
          seniority: { type: "string" },
          requirements: {
            type: "array",
            items: {
              type: "object",
              properties: {
                text: { type: "string" },
                kind: { type: "string", enum: ["must_have", "nice_to_have"] },
                category: {
                  type: "string",
                  enum: ["technical", "domain", "soft", "experience"],
                },
                terms: { type: "array", items: { type: "string" } },
              },
              required: ["text", "kind", "category", "terms"],
            },
          },
          keywords: { type: "array", items: { type: "string" } },
        },
        required: ["requirements", "keywords"],
      },
      prompt: [
        "Extract the requirements from this job description.",
        "Separate must-haves from nice-to-haves.",
        "For each requirement, list lowercase keywords a resume bullet would contain to satisfy it.",
        "Do not invent requirements that aren't stated in the text.",
        "",
        text,
      ].join("\n"),
    },
    ai,
  );

  if (!raw) return null;

  const schema = z.object({
    role: z.string().optional(),
    company: z.string().optional(),
    seniority: z.string().optional(),
    requirements: z
      .array(
        z.object({
          text: z.string().min(1),
          kind: z.enum(["must_have", "nice_to_have"]),
          category: z.enum(["technical", "domain", "soft", "experience"]),
          terms: z.array(z.string()),
        }),
      )
      .min(1),
    keywords: z.array(z.string()),
  });

  const parsed = schema.safeParse(raw);
  if (!parsed.success) return null;

  return {
    role: parsed.data.role || fallback.role,
    company: parsed.data.company || fallback.company,
    seniority: parsed.data.seniority || fallback.seniority,
    requirements: parsed.data.requirements.map((r, i) => ({
      id: `r${i + 1}`,
      text: r.text,
      kind: r.kind,
      category: r.category,
      terms: r.terms.map((t) => t.toLowerCase()),
    })),
    // Union with the heuristic's canonical skills so alias matching still works
    // even when the model misses one.
    keywords: [...new Set([...parsed.data.keywords, ...fallback.keywords])],
    // Section weighting stays deterministic — it's a judgement about the role
    // shape, and the heuristic is both stable and free.
    sectionWeights: fallback.sectionWeights,
    // "claude" here means "an AI produced this" rather than the vendor; the
    // vendor is reported separately as providerName.
    source: "claude",
  };
}

/* ------------------------------------------------------------------ */
/* Applying a recommendation                                           */
/* ------------------------------------------------------------------ */

/** Find or create the resume section a vault entry of this type belongs in. */
async function sectionForType(resumeId: number, sectionType: string): Promise<number | null> {
  const existing = (
    await db.select().from(resumeSections).where(eq(resumeSections.resumeId, resumeId))
  ).find((s) => s.sectionType === sectionType);

  return existing?.id ?? null;
}

export async function applyRecommendation(
  resumeId: number,
  rec: Recommendation,
): Promise<ActionResult> {
  return withVault(async () => {
    try {
      switch (rec.type) {
        case "ADD_ENTRY":
        case "ADD_BULLET": {
          const vaultEntryId = Number(rec.payload.vaultEntryId);
          const vaultBulletId = Number(rec.payload.vaultBulletId);
          const sectionType = String(rec.payload.sectionType);

          let sectionId = await sectionForType(resumeId, sectionType);
          if (!sectionId) {
            // The vault has content for a section this resume doesn't have yet.
            const created = await addSection(resumeId, sectionType);
            if (!created.ok) return fail(created.error);
            sectionId = created.data;
          }

          const existingEntry = await first(
            db.select().from(resumeSections).where(eq(resumeSections.id, sectionId)),
          );
          if (!existingEntry) return fail("Section not found");

          const alreadyThere = (await db.select().from(resumeBullets)).some(
            (b) => b.sourceBulletId === vaultBulletId,
          );
          if (alreadyThere) return { ok: true };

          // Is the parent entry already on the resume?
          const resume = await getResumeFull(resumeId);
          const parent = resume?.sections
            .flatMap((s) => s.entries)
            .find((e) => e.sourceEntryId === vaultEntryId);

          if (parent) {
            const bullet = await first(
              db.select().from(vaultBullets).where(eq(vaultBullets.id, vaultBulletId)),
            );
            if (!bullet) return fail("That bullet is no longer in your vault");

            const last = await first(
              db
                .select({ o: resumeBullets.displayOrder })
                .from(resumeBullets)
                .where(eq(resumeBullets.resumeEntryId, parent.id))
                .orderBy(desc(resumeBullets.displayOrder)),
            );

            await db.insert(resumeBullets).values({
              resumeEntryId: parent.id,
              sourceBulletId: bullet.id,
              text: bullet.text,
              displayOrder: (last?.o ?? -1) + 1,
            });
          } else {
            const result = await pullEntryFromVault(sectionId, vaultEntryId, [vaultBulletId]);
            if (!result.ok) return fail(result.error);
          }
          break;
        }

        case "ADD_SKILL": {
          let sectionId = await sectionForType(resumeId, "skill");
          if (!sectionId) {
            const created = await addSection(resumeId, "skill", getSectionDef("skill").heading);
            if (!created.ok) return fail(created.error);
            sectionId = created.data;
          }

          // Two shapes: a skill already in the vault's derived index, or one only
          // evidenced in bullet text, which has to become a vault skill entry
          // first. Creating the entry reindexes it, which is where the id comes from.
          let skillId = Number(rec.payload.vaultSkillId);

          if (!skillId && rec.payload.newSkillName) {
            const name = String(rec.payload.newSkillName);
            const category = String(rec.payload.newSkillCategory || "Skills");

            const vaultSectionId = await ensureVaultSkillSection();

            // Append to an entry with this category label if one exists, so we
            // don't accumulate a section full of one-skill entries.
            const existingEntry = (await db.select().from(vaultEntries)).find(
              (e) =>
                e.sectionId === vaultSectionId &&
                e.title.trim().toLowerCase() === category.toLowerCase(),
            );

            if (existingEntry) {
              const merged = existingEntry.information
                ? `${existingEntry.information} | ${name}`
                : name;
              const updated = await updateVaultEntry(existingEntry.id, {
                title: existingEntry.title,
                organization: existingEntry.organization,
                subtitle: existingEntry.subtitle,
                location: existingEntry.location,
                startDate: existingEntry.startDate,
                endDate: existingEntry.endDate,
                isCurrent: existingEntry.isCurrent,
                url: existingEntry.url,
                information: merged,
                level: existingEntry.level,
              });
              if (!updated.ok) return fail(updated.error);
            } else {
              const created = await createVaultEntry(vaultSectionId, {
                title: category,
                information: name,
              });
              if (!created.ok) return fail(created.error);
            }

            // Pick the freshly indexed row for this skill.
            const indexed = (await db.select().from(vaultSkills)).find(
              (s) => s.name.toLowerCase() === name.toLowerCase(),
            );
            if (!indexed) return fail("Could not index that skill");
            skillId = indexed.id;
          }

          if (!skillId) return fail("No skill to add");

          const result = await pullSkillsFromVault(sectionId, [skillId]);
          if (!result.ok) return fail(result.error);
          break;
        }

        case "REMOVE_BULLET": {
          // Hides rather than deletes — the tuner's judgment is advisory, and a
          // hidden bullet is one click from coming back.
          const result = await toggleBulletVisible(Number(rec.payload.resumeBulletId));
          if (!result.ok) return fail(result.error);
          break;
        }

        case "REORDER": {
          const sectionId = Number(rec.payload.sectionId);
          const sections = await db
            .select()
            .from(resumeSections)
            .where(eq(resumeSections.resumeId, resumeId))
            .orderBy(asc(resumeSections.displayOrder));

          const index = sections.findIndex((s) => s.id === sectionId);
          for (let i = index; i > 0; i--) {
            const result = await moveSection(sectionId, "up");
            if (!result.ok) break;
          }
          break;
        }

        case "EDIT_BULLET":
          return fail("Bullet rewriting needs an API key — add one in Settings");
      }

      revalidatePath(`/resume/${resumeId}`);
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return fail(`Could not apply that change: ${message}`);
    }
  });
}

/** Persist applied/dismissed state so decisions survive a reload. */
export async function setRecommendationStatus(
  runId: number,
  recId: string,
  status: "pending" | "applied" | "dismissed",
): Promise<ActionResult> {
  return withVault(async () => {
    const run = await first(db.select().from(tuneRuns).where(eq(tuneRuns.id, runId)));
    if (!run) return fail("Tune run not found");

    const next = run.recommendations.map((r) => (r.id === recId ? { ...r, status } : r));
    await db.update(tuneRuns).set({ recommendations: next }).where(eq(tuneRuns.id, runId));

    return { ok: true };
  });
}

export async function latestTuneRun(resumeId: number) {
  return withVault(async () => {
    return await first(
      db
        .select()
        .from(tuneRuns)
        .where(eq(tuneRuns.resumeId, resumeId))
        .orderBy(desc(tuneRuns.createdAt)),
    );
  });
}
