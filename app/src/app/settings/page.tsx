import { Check, Circle, KeyRound } from "lucide-react";

import { getProfile, getSetting, hasApiKey, SETTING_KEYS } from "@/db/bootstrap";

import { LinkModeSwitch } from "./link-mode-switch";
import { ProfileForm } from "./profile-form";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  const profile = getProfile();
  const keyPresent = hasApiKey();
  const linkMode = getSetting(SETTING_KEYS.vaultLinkMode) ?? "snapshot";
  const model = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="hint mt-1">
          Everything here lives on this machine. Nothing is sent anywhere except
          the AI calls you explicitly trigger.
        </p>
      </div>

      <ProfileForm profile={profile} />

      {/* AI status. Informational only — nothing in the app is gated on it. */}
      <section className="card p-6">
        <div className="flex items-start gap-3">
          <KeyRound size={18} className="mt-0.5 text-muted" />
          <div className="flex-1">
            <h2 className="text-lg font-semibold">Anthropic API key</h2>
            <p className="hint mt-1">
              Powers JD parsing, semantic bullet matching, resume import and
              bullet rewriting.
            </p>

            <div className="mt-4 flex items-center gap-2 text-sm">
              {keyPresent ? (
                <>
                  <Check size={15} className="text-emerald-600" />
                  <span>
                    Key detected. Using <code className="text-xs">{model}</code>.
                  </span>
                </>
              ) : (
                <>
                  <Circle size={15} className="text-muted" />
                  <span className="text-muted">
                    No key set — AI features are off.
                  </span>
                </>
              )}
            </div>

            {!keyPresent && (
              <div className="mt-4 rounded-lg bg-canvas p-4 text-sm">
                <p className="font-medium">The app works without this.</p>
                <p className="hint mt-1">
                  Vault editing, resume building, customization, PDF export and
                  keyword-based JD matching all run with no key. Adding one
                  upgrades matching from keyword to semantic and unlocks import
                  parsing and rewriting.
                </p>
                <p className="mt-3">
                  When you&rsquo;re ready, add this to{" "}
                  <code className="text-xs">app/.env.local</code> and restart:
                </p>
                <pre className="mt-2 overflow-x-auto rounded bg-ink p-3 text-xs text-white">
                  ANTHROPIC_API_KEY=sk-ant-…
                </pre>
              </div>
            )}
          </div>
        </div>
      </section>

      <LinkModeSwitch mode={linkMode === "linked" ? "linked" : "snapshot"} />
    </div>
  );
}
