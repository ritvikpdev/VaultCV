import "server-only";

/**
 * Optional AI refinement layer.
 *
 * Three interchangeable backends, all optional, all returning the same shape:
 * a JSON object the caller validates with Zod before trusting it.
 *
 *   anthropic — Claude, via tool-use
 *   gemini    — Google, via responseSchema structured output (has a free tier)
 *   ollama    — a model running locally, via its JSON format mode
 *
 * On the Ollama option specifically: CLAUDE.md forbids Ollama, and that rule is
 * right about what it was written for. v1 put a small local model on the ONLY
 * path for JD extraction, so when it returned unusable JSON the feature died.
 * The architecture here is inverted — deterministic parsing is the primary path
 * and always runs — so a local model is one optional refinement among several
 * and cannot take the feature down with it. The prohibition that still stands,
 * absolutely, is that no provider may ever be load-bearing.
 *
 * Every call site must treat `callStructured` returning null as normal.
 */

export type AiProvider = "anthropic" | "gemini" | "ollama" | "none";

/** Whichever provider has credentials, in order of output quality. */
export function activeProvider(): AiProvider {
  const forced = process.env.AI_PROVIDER?.trim().toLowerCase();
  if (forced === "anthropic" || forced === "gemini" || forced === "ollama") {
    return forced;
  }

  if (process.env.ANTHROPIC_API_KEY?.trim()) return "anthropic";
  if (process.env.GEMINI_API_KEY?.trim()) return "gemini";
  if (process.env.OLLAMA_BASE_URL?.trim()) return "ollama";
  return "none";
}

export function providerLabel(p: AiProvider = activeProvider()): string {
  switch (p) {
    case "anthropic":
      return `Claude (${process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5"})`;
    case "gemini":
      return `Gemini (${process.env.GEMINI_MODEL ?? "gemini-3.5-flash"})`;
    case "ollama":
      return `Ollama (${process.env.OLLAMA_MODEL ?? "llama3.1"})`;
    default:
      return "None — using local parsing";
  }
}

export function aiAvailable(): boolean {
  return activeProvider() !== "none";
}

export type StructuredRequest = {
  /** What the model should do. */
  prompt: string;
  /** Name of the "function" being filled in. Some backends surface it. */
  toolName: string;
  toolDescription: string;
  /** JSON Schema for the object we want back. Keep it simple — Gemini's
   *  responseSchema supports only a subset of JSON Schema. */
  schema: Record<string, unknown>;
  maxTokens?: number;
};

/**
 * Ask the active provider for a structured object.
 *
 * Returns `null` for every failure — no key, network error, malformed output,
 * timeout. Callers fall back to their deterministic path. Nothing here throws.
 */
export async function callStructured(
  req: StructuredRequest,
): Promise<Record<string, unknown> | null> {
  return (await callStructuredVerbose(req)).data;
}

export type StructuredOutcome = {
  data: Record<string, unknown> | null;
  /** Why it returned null. Empty when it succeeded or no provider is set. */
  reason: string;
};

/**
 * Same call, but says why it failed.
 *
 * A silent fallback is indistinguishable from "the AI just isn't very good" —
 * a rejected schema, an expired key and a rate limit all look identical to the
 * user, who sees "parsed locally" and reasonably concludes the feature is
 * broken. Surfacing the reason costs nothing and turns an invisible failure
 * into one that can be fixed.
 */
export async function callStructuredVerbose(
  req: StructuredRequest,
): Promise<StructuredOutcome> {
  const provider = activeProvider();
  if (provider === "none") return { data: null, reason: "" };

  try {
    switch (provider) {
      case "anthropic":
        return { data: await callAnthropic(req), reason: "" };
      case "gemini":
        return await callGeminiVerbose(req);
      case "ollama":
        return { data: await callOllama(req), reason: "" };
      default:
        return { data: null, reason: "" };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { data: null, reason: message.slice(0, 200) };
  }
}

async function callAnthropic(req: StructuredRequest) {
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

  const message = await client.messages.create({
    model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5",
    max_tokens: req.maxTokens ?? 3000,
    tools: [
      {
        name: req.toolName,
        description: req.toolDescription,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        input_schema: req.schema as any,
      },
    ],
    tool_choice: { type: "tool", name: req.toolName },
    messages: [{ role: "user", content: req.prompt }],
  });

  const block = message.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") return null;
  return block.input as Record<string, unknown>;
}

/**
 * Gemini via REST — no SDK dependency needed.
 *
 * `responseSchema` accepts a subset of JSON Schema, so the schemas passed in
 * here stay to plain objects, arrays, strings, booleans and enums. Anything
 * exotic gets a 400, which surfaces as null and a deterministic fallback.
 */
async function callGeminiVerbose(req: StructuredRequest): Promise<StructuredOutcome> {
  const model = process.env.GEMINI_MODEL ?? "gemini-3.5-flash";
  const key = process.env.GEMINI_API_KEY!;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: req.prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: req.schema,
          maxOutputTokens: req.maxTokens ?? 3000,
        },
      }),
      // Resume parsing on a long PDF can be slow; a short timeout would read
      // as "the model can't do it" when it simply hadn't finished.
      signal: AbortSignal.timeout(120_000),
    },
  );

  if (!response.ok) {
    // Google's error body says exactly what's wrong — a rejected schema, a bad
    // key, an unknown model. Passing it through is the difference between a
    // fixable problem and a mysterious one.
    const detail = await response.text().catch(() => "");
    const parsed = (() => {
      try {
        return JSON.parse(detail)?.error?.message as string | undefined;
      } catch {
        return undefined;
      }
    })();
    return {
      data: null,
      reason: `Gemini ${response.status}: ${parsed ?? detail.slice(0, 160) ?? "request failed"}`,
    };
  }

  const body = await response.json();

  // A response truncated by the token limit still returns 200, with the reason
  // in finishReason — otherwise it surfaces as unparseable JSON.
  const finish = body?.candidates?.[0]?.finishReason;
  if (finish && finish !== "STOP") {
    return { data: null, reason: `Gemini stopped early (${finish}) — try a shorter resume` };
  }

  const text = body?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== "string") {
    return { data: null, reason: "Gemini returned no content" };
  }

  try {
    return { data: JSON.parse(text) as Record<string, unknown>, reason: "" };
  } catch {
    return { data: null, reason: "Gemini returned malformed JSON" };
  }
}

/**
 * A locally-hosted model via Ollama's JSON format mode.
 *
 * Quality varies sharply with model size. A 3B model will often do worse than
 * the deterministic parser, which is why this is opt-in and why its output goes
 * through the same Zod validation as everything else.
 */
async function callOllama(req: StructuredRequest) {
  const base = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
  const model = process.env.OLLAMA_MODEL ?? "llama3.1";

  const response = await fetch(`${base}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      prompt: `${req.prompt}\n\nRespond with JSON matching this schema:\n${JSON.stringify(req.schema)}`,
      format: "json",
      stream: false,
      options: { temperature: 0 },
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!response.ok) return null;

  const body = await response.json();
  if (typeof body?.response !== "string") return null;

  return JSON.parse(body.response) as Record<string, unknown>;
}
