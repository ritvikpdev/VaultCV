import "server-only";

import { callStructuredVerbose } from "@/lib/ai-provider";
import { parseResumeHeuristically } from "@/lib/heuristic-parse";
import { ParsedImportSchema, type ParsedImport } from "@/lib/import-schema";

export type ParseSource = "claude" | "heuristic";

const TOOL_NAME = "record_parsed_resume";

function buildTool() {
  return {
    name: TOOL_NAME,
    description:
      "Record structured resume content: contact profile, entries (jobs, education, projects, etc.) with bullets, and skills.",
    input_schema: {
      type: "object" as const,
      properties: {
        profile: {
          type: "object",
          properties: {
            fullName: { type: "string" },
            email: { type: "string" },
            phone: { type: "string" },
            location: { type: "string" },
            summary: { type: "string" },
            links: {
              type: "array",
              items: {
                type: "object",
                properties: { label: { type: "string" }, url: { type: "string" } },
                required: ["label", "url"],
              },
            },
          },
        },
        entries: {
          type: "array",
          items: {
            type: "object",
            properties: {
              sectionHeading: {
                type: "string",
                description:
                  "The section heading exactly as written in the resume, e.g. WORK EXPERIENCE",
              },
              sectionType: {
                type: "string",
                enum: ["normal", "skill"],
                description:
                  "'skill' for a list of skills or technologies, 'normal' for anything with dates and bullet points",
              },
              title: { type: "string" },
              organization: { type: "string" },
              subtitle: { type: "string" },
              location: { type: "string" },
              startDate: { type: "string", description: "MM/YYYY, or empty string" },
              endDate: { type: "string", description: "MM/YYYY, or empty string" },
              isCurrent: { type: "boolean" },
              information: {
                type: "string",
                description:
                  "For skill entries only: the sub-skills under this label, separated by |",
              },
              bullets: {
                type: "array",
                items: {
                  type: "object",
                  properties: { text: { type: "string" } },
                  required: ["text"],
                },
              },
            },
            required: ["sectionHeading", "sectionType", "title"],
          },
        },
      },
      required: ["entries"],
    },
  };
}

function buildPrompt(text: string): string {
  return [
    "Extract every entry and bullet from this resume into the record_parsed_resume tool.",
    "",
    "Use the resume's OWN section headings verbatim — do not translate them into",
    "a standard vocabulary. If it says 'Side Projects', the heading is 'Side Projects'.",
    "",
    "A skills line like 'Languages — Java | C# | Python' is ONE entry with",
    "sectionType 'skill', title 'Languages' and information 'Java | C# | Python'.",
    "Each labelled group on such a line is its own entry.",
    "",
    'Dates must be formatted "MM/YYYY", or an empty string if unknown. Do not invent',
    "dates, employers, or numbers that are not in the text.",
    "Preserve bullet wording closely; do not summarize or rewrite it.",
    "",
    "----- RESUME TEXT -----",
    text,
  ].join("\n");
}

async function parseWithAi(
  text: string,
): Promise<{ result: ParsedImport; reason: string }> {
  const tool = buildTool();

  const { data, reason } = await callStructuredVerbose({
    toolName: tool.name,
    toolDescription: tool.description,
    schema: tool.input_schema,
    // Resumes produce a lot of structured output; 4096 truncated longer ones
    // mid-JSON, which surfaced only as "parsed locally".
    maxTokens: 16000,
    prompt: buildPrompt(text),
  });

  if (!data) throw new Error(reason || "No structured response");

  // Validated regardless of which provider produced it — a JSON blob is not
  // trustworthy just because it parsed.
  return { result: ParsedImportSchema.parse(data), reason: "" };
}

/**
 * Structures raw resume text into entries/bullets/skills/profile. Uses Claude
 * when a key is present; falls back to the deterministic heuristic parser on
 * any failure (missing key, network error, malformed or invalid response) so
 * import never dead-ends.
 */
export async function parseResumeText(
  text: string,
): Promise<{ result: ParsedImport; source: ParseSource; fallbackReason: string }> {
  const { aiAvailable } = await import("@/lib/ai-provider");

  if (!aiAvailable()) {
    return { result: parseResumeHeuristically(text), source: "heuristic", fallbackReason: "" };
  }

  try {
    const { result } = await parseWithAi(text);
    return { result, source: "claude", fallbackReason: "" };
  } catch (error) {
    // Falling back is fine. Falling back *silently* is not — the user sees
    // "parsed locally" and has no way to tell a rejected schema from a model
    // that simply did badly.
    const reason = error instanceof Error ? error.message : String(error);
    return {
      result: parseResumeHeuristically(text),
      source: "heuristic",
      fallbackReason: reason.slice(0, 200),
    };
  }
}
