import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { hasApiKey } from "@/db/bootstrap";

let client: Anthropic | null | undefined;

/** Lazy singleton. Returns null with no key set — callers fall back, never crash. */
export function getAnthropicClient(): Anthropic | null {
  if (client !== undefined) return client;
  client = hasApiKey() ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;
  return client;
}

export function anthropicModel(): string {
  return process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5";
}
