import Link from "next/link";
import { count } from "drizzle-orm";
import { Check, Circle } from "lucide-react";

import { hasApiKey } from "@/db/ai-config";
import { db, first } from "@/db/client";
import { getProfile } from "@/db/bootstrap";
import { listResumes } from "@/db/resume-queries";
import { withVault } from "@/db/session";
import { vaultBullets, vaultEntries } from "@/db/schema";

import { ResumeList } from "./resume-list";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const { profile, entryCount, bulletCount, resumes, keyPresent } = await withVault(async () => ({
    profile: await getProfile(),
    entryCount: (await first(db.select({ n: count() }).from(vaultEntries)))?.n ?? 0,
    bulletCount: (await first(db.select({ n: count() }).from(vaultBullets)))?.n ?? 0,
    resumes: await listResumes(),
    keyPresent: await hasApiKey(),
  }));

  const checks = [
    {
      done: Boolean(profile.fullName.trim() && profile.email.trim()),
      label: "Profile filled in",
      href: "/settings",
      action: "Settings",
    },
    {
      done: entryCount > 0,
      label: `Vault has entries${entryCount ? ` (${entryCount})` : ""}`,
      href: "/vault",
      action: "Vault",
    },
    {
      done: bulletCount > 0,
      label: `Vault has bullets${bulletCount ? ` (${bulletCount})` : ""}`,
      href: "/vault",
      action: "Vault",
    },
    {
      done: keyPresent,
      label: "API key set (optional)",
      href: "/settings",
      action: "Settings",
      optional: true,
    },
  ];

  const remaining = checks.filter((c) => !c.done && !c.optional).length;

  return (
    <div className="space-y-8">
      <ResumeList resumes={resumes} />

      {remaining > 0 && (
        <section className="card p-6">
          <h2 className="font-semibold">Setup</h2>
          <p className="hint mt-1">Informational only — nothing here blocks you.</p>
          <ul className="mt-4 space-y-2">
            {checks.map((c) => (
              <li key={c.label} className="flex items-center gap-3 text-sm">
                {c.done ? (
                  <Check size={16} className="text-emerald-600" />
                ) : (
                  <Circle size={16} className="text-muted" />
                )}
                <span className={c.done ? "text-muted line-through" : ""}>{c.label}</span>
                {!c.done && (
                  <Link
                    href={c.href}
                    className="ml-auto text-xs font-medium text-accent hover:underline"
                  >
                    {c.action} →
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
