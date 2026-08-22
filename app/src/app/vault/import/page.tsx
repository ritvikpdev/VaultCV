import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { bootstrap, getProfile, hasApiKey } from "@/db/bootstrap";

import { ImportWizard } from "./import-wizard";

export const dynamic = "force-dynamic";

export default function ImportPage() {
  bootstrap();

  const profile = getProfile();
  const keyPresent = hasApiKey();

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link href="/vault" className="hint inline-flex items-center gap-1 hover:text-ink">
          <ArrowLeft size={14} /> Back to vault
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Import a resume</h1>
        <p className="hint mt-1">
          Paste text or upload a PDF. Nothing reaches your vault until you review and approve
          it below.
        </p>
      </div>

      {!keyPresent && (
        <div className="card p-4 text-sm">
          <p className="font-medium">No Anthropic API key set — that&rsquo;s fine.</p>
          <p className="hint mt-1">
            Import works fully without one, using a local parser. Add a key in{" "}
            <Link href="/settings" className="text-accent hover:underline">
              Settings
            </Link>{" "}
            later for more accurate structuring.
          </p>
        </div>
      )}

      <ImportWizard currentProfile={profile} />
    </div>
  );
}
