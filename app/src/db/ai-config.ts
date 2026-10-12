import "server-only";

import { NO_AI, type AiConfig } from "@/lib/ai-provider";
import { open } from "@/lib/secret-box";

import { getSetting, SETTING_KEYS } from "./bootstrap";

export const DEFAULT_MODELS = {
  anthropic: () => process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5",
  gemini: () => process.env.GEMINI_MODEL ?? "gemini-3.5-flash",
  ollama: () => process.env.OLLAMA_MODEL ?? "llama3.1",
};

/**
 * The current user's AI configuration. Must run inside `withVault`.
 *
 * Their own saved key first. Failing that, a server-level Ollama if the
 * operator configured one (local development). Failing that, none — which is
 * a normal state: every feature has a deterministic path.
 *
 * A key that no longer decrypts (VAULTCV_SECRET changed) reads as "no key"
 * rather than an error; Settings shows it as needing re-entry.
 */
export async function getAiConfig(): Promise<AiConfig> {
  const [provider, sealed] = await Promise.all([
    getSetting(SETTING_KEYS.aiProvider),
    getSetting(SETTING_KEYS.aiKey),
  ]);

  if ((provider === "anthropic" || provider === "gemini") && sealed) {
    const apiKey = open(sealed, process.env.VAULTCV_SECRET ?? "");
    if (apiKey) return { provider, apiKey, model: DEFAULT_MODELS[provider]() };
  }

  if (process.env.OLLAMA_BASE_URL?.trim()) {
    return { provider: "ollama", apiKey: "", model: DEFAULT_MODELS.ollama() };
  }

  return NO_AI;
}

/** True when the current user has any AI provider. Informational only — never a gate. */
export async function hasApiKey(): Promise<boolean> {
  return (await getAiConfig()).provider !== "none";
}
