import { KeyRound } from "lucide-react";

import { getAiConfig } from "@/db/ai-config";
import { getProfile, getSetting, SETTING_KEYS } from "@/db/bootstrap";
import { isAdmin, withVault } from "@/db/session";
import { providerLabel } from "@/lib/ai-provider";

import { AccountSection } from "./account-section";
import { AiKeyForm } from "./ai-key-form";
import { LinkModeSwitch } from "./link-mode-switch";
import { ProfileForm } from "./profile-form";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const { user, profile, linkMode, savedProvider, keyHint, keySaved, ai } = await withVault(
    async (user) => ({
      user,
      profile: await getProfile(),
      linkMode: (await getSetting(SETTING_KEYS.vaultLinkMode)) ?? "snapshot",
      savedProvider: await getSetting(SETTING_KEYS.aiProvider),
      keyHint: await getSetting(SETTING_KEYS.aiKeyHint),
      keySaved: Boolean(await getSetting(SETTING_KEYS.aiKey)),
      ai: await getAiConfig(),
    }),
  );

  const provider =
    savedProvider === "anthropic" || savedProvider === "gemini" ? savedProvider : null;
  // A key is stored but didn't decrypt — the server's secret changed.
  const keyUnreadable = keySaved && ai.provider !== provider;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="hint mt-1">
          Signed in as {user.email}. Your vault is private to your account — nobody else
          signed in to this app can see it.
        </p>
      </div>

      <ProfileForm profile={profile} />

      {/* AI status. Informational only — nothing in the app is gated on it. */}
      <section className="card p-6">
        <div className="flex items-start gap-3">
          <KeyRound size={18} className="mt-0.5 text-muted" />
          <div className="flex-1">
            <h2 className="text-lg font-semibold">AI key (optional)</h2>
            <p className="hint mt-1">
              Your own Anthropic or Gemini key. It sharpens job-description parsing and
              resume import. Everything else — vault, resumes, customization, PDF export and
              keyword matching — works without one. Gemini has a free tier.
            </p>
            <p className="mt-3 text-sm">
              Currently: <span className="font-medium">{providerLabel(ai)}</span>
            </p>
            <AiKeyForm savedProvider={provider} keyHint={keyHint} keyUnreadable={keyUnreadable} />
            <p className="hint mt-4">
              Your key is encrypted before it&rsquo;s stored and is only ever sent to the
              provider you chose. Whoever runs this server could technically recover it —
              that&rsquo;s true of any app that calls an API on your behalf — so use a key
              you can revoke.
            </p>
          </div>
        </div>
      </section>

      <LinkModeSwitch mode={linkMode === "linked" ? "linked" : "snapshot"} />

      <AccountSection canDelete={!isAdmin(user)} />
    </div>
  );
}
