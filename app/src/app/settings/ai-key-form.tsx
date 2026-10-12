"use client";

import { useState, useTransition } from "react";

import { ConfirmButton } from "@/components/ui";

import { clearAiKey, saveAiKey } from "./actions";

type Provider = "anthropic" | "gemini";

export function AiKeyForm({
  savedProvider,
  keyHint,
  keyUnreadable,
}: {
  savedProvider: Provider | null;
  keyHint: string | null;
  keyUnreadable: boolean;
}) {
  const [provider, setProvider] = useState<Provider>(savedProvider ?? "gemini");
  const [apiKey, setApiKey] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      const result = await saveAiKey(provider, apiKey);
      if (result.ok) {
        setApiKey("");
        setStatus("Saved");
        setTimeout(() => setStatus(null), 2000);
      } else {
        setStatus(result.error);
      }
    });
  }

  return (
    <div className="mt-4 space-y-3">
      {savedProvider && keyHint && (
        <div className="flex items-center gap-3 rounded-lg bg-canvas px-3 py-2 text-sm">
          <span>
            {savedProvider === "anthropic" ? "Anthropic" : "Gemini"} key ending{" "}
            <code className="text-xs">…{keyHint}</code>
            {keyUnreadable && (
              <span className="ml-2 text-red-700">
                — can&rsquo;t be read any more; please enter it again
              </span>
            )}
          </span>
          <ConfirmButton
            className="ml-auto text-xs font-medium text-red-700 hover:underline"
            message="Remove your saved AI key? Features fall back to local parsing."
            onConfirm={() =>
              startTransition(async () => {
                await clearAiKey();
              })
            }
          >
            Remove
          </ConfirmButton>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <select
          className="field w-36"
          value={provider}
          onChange={(e) => setProvider(e.target.value as Provider)}
          aria-label="Provider"
        >
          <option value="gemini">Gemini</option>
          <option value="anthropic">Anthropic</option>
        </select>
        <input
          className="field min-w-48 flex-1"
          type="password"
          autoComplete="off"
          placeholder={savedProvider ? "Paste a new key to replace it" : "Paste your API key"}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
        />
        <button className="btn-primary" onClick={save} disabled={pending || !apiKey.trim()}>
          Save key
        </button>
      </div>
      <p className="hint">
        {provider === "gemini" ? (
          <>
            Get a free key at{" "}
            <a
              className="text-accent hover:underline"
              href="https://aistudio.google.com/apikey"
              target="_blank"
              rel="noreferrer"
            >
              aistudio.google.com/apikey
            </a>
            .
          </>
        ) : (
          <>
            Create one at{" "}
            <a
              className="text-accent hover:underline"
              href="https://console.anthropic.com/settings/keys"
              target="_blank"
              rel="noreferrer"
            >
              console.anthropic.com
            </a>
            . Paid per use — fractions of a cent per run.
          </>
        )}
      </p>
      {status && <p className="text-sm text-muted">{status}</p>}
    </div>
  );
}
